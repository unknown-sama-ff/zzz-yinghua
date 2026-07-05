import {
  fetchWithTimeout,
  withRetry,
  UpstreamError,
  codeFromStatus,
  assertSafeUrl,
  sleep,
  parseJsonSafe,
} from './http.js';
import sharp from 'sharp';

/**
 * Each provider implements: async generate(req) -> { images: string[], raw }
 * `req` is the validated body from POST /api/generate.
 *
 * NOTE: upstream image-API request/response shapes vary. These implementations
 * target the common conventions (OpenAI images edit, a seedance-style task API)
 * and normalize the result. Adjust field names if your endpoint differs.
 */

function pluckImages(json) {
  // Try the common shapes: OpenAI {data:[{url|b64_json}]}, or {images:[...]}.
  const out = [];
  if (Array.isArray(json?.data)) {
    for (const d of json.data) {
      if (d.url) out.push(d.url);
      else if (d.b64_json) out.push(`data:image/png;base64,${d.b64_json}`);
    }
  }
  if (Array.isArray(json?.images)) {
    for (const im of json.images) {
      if (typeof im === 'string') out.push(im);
      else if (im?.url) out.push(im.url);
      else if (im?.b64_json) out.push(`data:image/png;base64,${im.b64_json}`);
    }
  }
  if (typeof json?.output === 'string') out.push(json.output);
  if (Array.isArray(json?.output)) out.push(...json.output.filter((v) => typeof v === 'string'));
  return out;
}

async function stitchRefImages(refImages) {
  console.log(`[stitchRefImages] starting with ${refImages.length} refs`);
  const decoded = await Promise.all(refImages.map(async (ref, i) => {
    const input = Buffer.from(ref.base64, 'base64');
    console.log(`[stitchRefImages] ref ${i} decoded ${input.length} bytes, mime=${ref.mime}`);
    const resized = await sharp(input).resize({ height: 1024, withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(resized).metadata();
    console.log(`[stitchRefImages] ref ${i} resized to ${meta.width}x${meta.height}`);
    return { buffer: resized, width: meta.width || 1024 };
  }));

  const totalWidth = decoded.reduce((sum, img) => sum + img.width, 0);
  console.log(`[stitchRefImages] total width=${totalWidth} height=1024`);
  let x = 0;
  const composite = decoded.map((img) => {
    const out = { input: img.buffer, left: x, top: 0 };
    x += img.width;
    return out;
  });

  const result = await sharp({
    create: {
      width: totalWidth,
      height: 1024,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).composite(composite).png().toBuffer();
  console.log(`[stitchRefImages] done, result ${result.length} bytes`);
  return result;
}

// ---------------------------------------------------------------------------
// seedance — image-to-image / edit endpoint, may return a task_id to poll.
// ---------------------------------------------------------------------------
async function seedance(req) {
  const useServerPreset = req.useServerPreset === true;
  const key = useServerPreset ? process.env.SEEDANCE_API_KEY : req.apiKey;
  const base = useServerPreset ? process.env.SEEDANCE_BASE_URL : req.baseUrl;
  if (!key || !base) {
    throw new UpstreamError('UNAUTHORIZED', useServerPreset
      ? 'seedance 服务端预设缺少密钥或 Base URL'
      : 'seedance 缺少密钥或 Base URL（请在前端填写）', 401);
  }
  const body = {
    prompt: req.prompt,
    image: req.imageBase64,
    size: req.size || '1024x1024',
    n: req.n || 1,
  };
  if (useServerPreset ? process.env.SEEDANCE_MODEL : req.model) body.model = useServerPreset ? process.env.SEEDANCE_MODEL : req.model;
  const json = await withRetry(async () => {
    const res = await fetchWithTimeout(`${base.replace(/\/$/, '')}/images/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new UpstreamError(codeFromStatus(res.status), `seedance 返回 ${res.status}`, res.status);
    }
    return parseJsonSafe(res);
  });

  // Long-task: poll if a task id is returned instead of images.
  const taskId = json.task_id || json.id;
  if (taskId && pluckImages(json).length === 0) {
    const images = await pollSeedanceTask(base, key, taskId);
    return { images, raw: json };
  }
  return { images: pluckImages(json), raw: json };
}

async function pollSeedanceTask(base, key, taskId, maxMs = 180000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const res = await fetchWithTimeout(`${base.replace(/\/$/, '')}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) continue;
    const json = await parseJsonSafe(res);
    const status = json.status || json.state;
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      return pluckImages(json);
    }
    if (status === 'failed' || status === 'error') {
      throw new UpstreamError('UPSTREAM_ERROR', 'seedance 任务失败');
    }
  }
  throw new UpstreamError('UPSTREAM_TIMEOUT', 'seedance 任务轮询超时', 504);
}

// ---------------------------------------------------------------------------
// gpt-image — OpenAI gpt-image-1. Uses the image-edit endpoint (multipart) when
// an input image is present so the upload actually conditions the result;
// falls back to text-only generations when no image was provided.
// ---------------------------------------------------------------------------
async function gptImage(req) {
  const useServerPreset = req.useServerPreset === true;
  const key = useServerPreset
    ? process.env.GPT_IMAGE_API_KEY
    : req.apiKey;
  const base = useServerPreset
    ? (process.env.GPT_IMAGE_BASE_URL || 'https://api.openai.com/v1')
    : req.baseUrl;
  if (!key) {
    throw new UpstreamError('UNAUTHORIZED', useServerPreset
      ? 'gpt-image 服务端预设缺少密钥'
      : 'gpt-image 缺少密钥（请在前端填写）', 401);
  }
  if (!base) {
    throw new UpstreamError('UNAUTHORIZED', useServerPreset
      ? 'gpt-image 服务端预设缺少 Base URL'
      : 'gpt-image 缺少 Base URL（请在前端填写）', 401);
  }
  const model = useServerPreset
    ? (process.env.GPT_IMAGE_MODEL || 'gpt-image-2')
    : req.model;
  if (!model) {
    throw new UpstreamError('UNAUTHORIZED', useServerPreset
      ? 'gpt-image 服务端预设缺少模型名称'
      : 'gpt-image 缺少模型名称（请在前端填写）', 401);
  }
  const size = req.size || '1024x1024';
  const n = req.n || 1;
  const root = base.replace(/\/$/, '');

  // With multiple independent refs → stitch server-side, then upload the
  // resulting board to /images/edits so upstream still receives one image.
  if (Array.isArray(req.refImages) && req.refImages.length > 0) {
    try {
      const stitched = await stitchRefImages(req.refImages);
      req.imageBase64 = stitched.toString('base64');
      req.imageMime = 'image/png';
    } catch (err) {
      throw new UpstreamError('UPSTREAM_ERROR', `参考图拼板失败: ${err?.message || err}`);
    }
  }

  // With an input image → /images/edits as multipart/form-data so the upload
  // strictly conditions the result (true image-to-image). No fallback: if the
  // endpoint doesn't support edits we surface a clear error rather than silently
  // degrading to text-only generation (which would ignore the uploaded art).
  if (req.imageBase64) {
    const buffer = Buffer.from(req.imageBase64, 'base64');
    const blob = new Blob([buffer], { type: req.imageMime || 'image/png' });
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', req.prompt);
    form.append('size', size);
    form.append('n', String(n));
    form.append('image', blob, 'image.png');

    const json = await withRetry(async () => {
      const res = await fetchWithTimeout(`${root}/images/edits`, {
        method: 'POST',
        // Do NOT set Content-Type — fetch adds the multipart boundary itself.
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) {
        throw new UpstreamError(codeFromStatus(res.status), `gpt-image 图像编辑返回 ${res.status}`, res.status);
      }
      return parseJsonSafe(res);
    });
    return { images: pluckImages(json), raw: json };
  }

  // No image → text-only generations.
  const body = { model, prompt: req.prompt, size, n };
  const json = await withRetry(async () => {
    const res = await fetchWithTimeout(`${root}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new UpstreamError(codeFromStatus(res.status), `gpt-image 返回 ${res.status}`, res.status);
    }
    return parseJsonSafe(res);
  });
  return { images: pluckImages(json), raw: json };
}

// ---------------------------------------------------------------------------
// custom-url — forward to a user-supplied compatible endpoint (SSRF-guarded).
// ---------------------------------------------------------------------------
async function customUrl(req) {
  if (!req.customEndpoint) {
    throw new UpstreamError('INVALID_INPUT', '缺少自定义端点 URL', 400);
  }
  const url = assertSafeUrl(req.customEndpoint);

  // Body template: if provided, interpolate {prompt}/{image}; else default shape.
  let body;
  if (req.customBodyTemplate) {
    const filled = req.customBodyTemplate
      .replaceAll('{prompt}', JSON.stringify(req.prompt).slice(1, -1))
      .replaceAll('{image}', req.imageBase64 || '')
      .replaceAll('{model}', req.model || '');
    body = filled;
  } else {
    body = JSON.stringify({
      prompt: req.prompt,
      image: req.imageBase64,
      n: req.n || 1,
      ...(req.model ? { model: req.model } : {}),
    });
  }

  const json = await withRetry(async () => {
    const res = await fetchWithTimeout(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(req.customHeaders || {}) },
      body,
    });
    if (!res.ok) {
      throw new UpstreamError(codeFromStatus(res.status), `自定义端点返回 ${res.status}`, res.status);
    }
    return parseJsonSafe(res);
  });
  return { images: pluckImages(json), raw: json };
}

export const providers = {
  seedance,
  'gpt-image': gptImage,
  'custom-url': customUrl,
};
