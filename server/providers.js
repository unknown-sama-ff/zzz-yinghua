import {
  fetchWithTimeout,
  fetchBufferLimited,
  withRetry,
  UpstreamError,
  codeFromStatus,
  assertSafeUrl,
  sleep,
  parseJsonSafe,
} from './http.js';
import { pluckImages } from './lib/pluckImages.js';
import sharp from 'sharp';
import {
  POLL_DEADLINE_MS,
  DEFAULT_TIMEOUT_MS,
  MAX_COMPRESS_DIM,
  MAX_HIGH_FIDELITY_EDIT_DIM,
  JPEG_QUALITY,
  RETRY_RESIZE_DIM,
  RETRY_SIZE_KB_THRESHOLD,
  RETRY_JPEG_QUALITY,
  MAX_INPUT_PIXELS,
  MAX_FETCH_BYTES,
  MAX_GENERATE_N,
} from './lib/constants.js';

const IS_VERCEL = Boolean(process.env.VERCEL);

/**
 * Clamp the per-request image count the client may ask the upstream for, so an
 * arbitrarily large `n` can't reach the provider.
 *
 * Known tradeoff: the server-preset budget is consumed per REQUEST, not per
 * image (see consumePresetBudget in lib/rateLimit.js), so a preset caller asking
 * for MAX_GENERATE_N images spends that many upstream images against a single
 * budget unit. Accepted deliberately — per-image accounting is a later decision.
 */
function capN(req) {
  const n = Number(req.n);
  return Number.isInteger(n) && n > 1 ? Math.min(n, MAX_GENERATE_N) : 1;
}

/**
 * OpenAI-compatible image edit endpoints require a PNG mask with an alpha
 * channel that exactly matches the primary image's final dimensions. The
 * primary image may have been converted or resized by the upload pipeline, so
 * derive the target size from its processed buffer rather than the original.
 */
async function prepareEditMask(maskBase64, targetBuffer) {
  let maskBuffer;
  try {
    maskBuffer = Buffer.from(maskBase64, 'base64');
    const [maskMeta, targetMeta] = await Promise.all([
      sharp(maskBuffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS }).metadata(),
      sharp(targetBuffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS }).metadata(),
    ]);
    if (!maskMeta.width || !maskMeta.height || !targetMeta.width || !targetMeta.height) {
      throw new Error('missing image dimensions');
    }
    if (!maskMeta.hasAlpha) {
      throw new UpstreamError('INVALID_INPUT', '重绘蒙版必须包含透明通道', 400);
    }
    return await sharp(maskBuffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS })
      .ensureAlpha()
      .resize(targetMeta.width, targetMeta.height, { fit: 'fill' })
      .png()
      .toBuffer();
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError('INVALID_INPUT', '重绘蒙版无效或无法读取', 400);
  }
}

// When running on Vercel serverless, spawn a Worker thread for long-polling
// so the function can return immediately and the Worker (own event loop) keeps
// polling upstream until the task completes.
let taskHooks = null;

export function registerTaskStore(hooks) {
  taskHooks = hooks;
}

// Push a completed/in-failed poll result into the task store so the frontend's
// GET /api/task/:id poll can resolve. Used on Railway (inline poll) and as the
// fallback when worker_threads is unavailable.
async function pollSeedreamTaskToStore(base, key, taskId, maxMs) {
  try {
    const images = await pollSeedreamTask(base, key, taskId, maxMs);
    taskHooks?.onDone?.(taskId, images);
  } catch (err) {
    taskHooks?.onError?.(taskId, err instanceof UpstreamError ? err.message : String(err?.message || err));
  }
}

async function spawnPollWorker(base, key, taskId, maxMs = POLL_DEADLINE_MS) {
  if (!IS_VERCEL || !taskHooks) return pollSeedreamTaskToStore(base, key, taskId, maxMs);

  // Vercel: delegate polling to a Worker thread so it outlives the
  // serverless function's execution window.
  try {
    const { Worker } = await import('node:worker_threads');
    const wrappedScript = `
      'use strict';
      const WORKER_ARGS = ${JSON.stringify({ base, key, taskId })};
      const { parentPort } = require('worker_threads');
      async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      async function fetchWithTimeout(url, opts = {}) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 180000);
        try { return await fetch(url, { ...opts, redirect: 'error', signal: ctrl.signal }); }
        finally { clearTimeout(t); }
      }
      async function parseJsonSafe(res) {
        try { return await res.json(); } catch { return {}; }
      }
      function pluckImages(json) {
        const out = [];
        if (Array.isArray(json?.data)) for (const d of json.data) { if (d.url) out.push(d.url); else if (d.b64_json) out.push('data:image/png;base64,' + d.b64_json); }
        if (Array.isArray(json?.images)) for (const im of json.images) { if (typeof im === 'string') out.push(im); else if (im?.url) out.push(im.url); else if (im?.b64_json) out.push('data:image/png;base64,' + im.b64_json); }
        if (typeof json?.output === 'string') out.push(json.output);
        if (Array.isArray(json?.output)) out.push(...json.output.filter(v => typeof v === 'string'));
        return out;
      }
      (async () => {
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
          await sleep(2000);
          const res = await fetchWithTimeout(WORKER_ARGS.base + '/tasks/' + WORKER_ARGS.taskId, { headers: { Authorization: 'Bearer ' + WORKER_ARGS.key } });
          if (!res.ok) continue;
          const json = await parseJsonSafe(res);
          const status = json.status || json.state;
          if (status === 'succeeded' || status === 'completed' || status === 'success') {
            parentPort.postMessage({ type: 'done', images: pluckImages(json) });
            return;
          }
          if (status === 'failed' || status === 'error') {
            parentPort.postMessage({ type: 'error', message: 'seedream 任务失败' });
            return;
          }
        }
        parentPort.postMessage({ type: 'error', message: 'seedream 任务轮询超时' });
      })().catch(e => parentPort.postMessage({ type: 'error', message: e.message }));
    `;
    const w = new Worker(wrappedScript, { eval: true });
    w.on('message', (msg) => {
      if (msg.type === 'done') taskHooks?.onDone?.(taskId, msg.images);
      else if (msg.type === 'error') taskHooks?.onError?.(taskId, msg.message);
      w.terminate();
    });
    w.on('error', () => {
      taskHooks?.onError?.(taskId, 'Worker 启动失败');
    });
    return;
  } catch {
    // worker_threads not available — fall through to inline poll
  }

  // Fallback: inline poll (works on Railway / long-running server)
  return pollSeedreamTaskToStore(base, key, taskId, maxMs);
}

/**
 * Each provider implements: async generate(req) -> { images: string[], raw }
 * `req` is the validated body from POST /api/generate.
 *
 * NOTE: upstream image-API request/response shapes vary. These implementations
 * target the common conventions (OpenAI images edit, a seedream-style task API)
 * and normalize the result. Adjust field names if your endpoint differs.
 */

// ---------------------------------------------------------------------------
// seedream — image-to-image / edit endpoint, may return a task_id to poll.
// ---------------------------------------------------------------------------
async function seedream(req) {
  const useServerPreset = req.useServerPreset === true;
  const key = useServerPreset ? process.env.SEEDREAM_API_KEY : req.apiKey;
  const base = useServerPreset ? process.env.SEEDREAM_BASE_URL : req.baseUrl;
  if (!key || !base) {
    throw new UpstreamError('UNAUTHORIZED', useServerPreset
      ? 'seedream 服务端预设缺少密钥或 Base URL'
      : 'seedream 缺少密钥或 Base URL（请在前端填写）', 401);
  }
  // Client-supplied base URL is fully attacker-controlled — same SSRF risk as
  // custom-url. Validate it before any outbound request.
  if (!useServerPreset) await assertSafeUrl(base);
  const model = useServerPreset
    ? process.env.SEEDREAM_MODEL
    : req.model;
  const body = {
    prompt: req.prompt,
    image: req.imageBase64,
    n: capN(req),
    ...(model ? { model } : {}),
  };
  // Prefer aspectRatio when provided, fall back to size or default
  if (req.aspectRatio) {
    body.aspect_ratio = req.aspectRatio;
  } else {
    body.size = req.size || '1024x1024';
  }
  const json = await withRetry(async () => {
    const res = await fetchWithTimeout(`${base.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new UpstreamError(codeFromStatus(res.status), `seedream 返回 ${res.status}`, res.status);
    }
    return parseJsonSafe(res);
  });

  // Long-task: hand off to background poller and return taskId immediately.
  const taskId = json.task_id || json.id;
  if (taskId && pluckImages(json).length === 0) {
    void spawnPollWorker(base, key, taskId);
    return { taskId, images: [] };
  }
  return { images: pluckImages(json), raw: json };
}

async function pollSeedreamTask(base, key, taskId, maxMs = POLL_DEADLINE_MS) {
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
      throw new UpstreamError('UPSTREAM_ERROR', 'seedream 任务失败');
    }
  }
  throw new UpstreamError('UPSTREAM_TIMEOUT', 'seedream 任务轮询超时', 504);
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
  // Client-supplied base URL is attacker-controlled — validate before use.
  if (!useServerPreset) await assertSafeUrl(base);
  const model = useServerPreset
    ? (process.env.GPT_IMAGE_MODEL || 'gpt-image-2')
    : req.model;
  if (!model) {
    throw new UpstreamError('UNAUTHORIZED', useServerPreset
      ? 'gpt-image 服务端预设缺少模型名称'
      : 'gpt-image 缺少模型名称（请在前端填写）', 401);
  }
  // Prefer aspectRatio when provided, otherwise use size
  const size = req.aspectRatio ? undefined : (req.size || '1024x1024');
  const n = capN(req);
  const root = base.replace(/\/$/, '');

  // With an input image → /images/edits as multipart/form-data so the upload
  // strictly conditions the result (true image-to-image). No fallback: if the
  // endpoint doesn't support edits we surface a clear error rather than silently
  // degrading to text-only generation (which would ignore the uploaded art).
  if (req.imageBase64) {
    // Handle remote URLs: fetch server-side (no CORS issues) and convert to buffer.
    // This covers the case where the upstream API returns image URLs instead
    // of base64 data (common with some relay channels).
    let buffer;
    let mime;
    let ext;
    if (/^https?:\/\//i.test(req.imageBase64)) {
      // Remote URL is fully attacker-controlled — validate (SSRF) before fetching.
      await assertSafeUrl(req.imageBase64);
      console.log(`[gpt-image] fetching remote image: ${req.imageBase64.slice(0, 120)}`);
      try {
        const { ok, status, buffer: fetched, contentType } = await fetchBufferLimited(req.imageBase64, {}, DEFAULT_TIMEOUT_MS, MAX_FETCH_BYTES);
        if (!ok) throw new UpstreamError('UPSTREAM_ERROR', `远程图片获取失败: ${status}`, status);
        buffer = fetched;
        mime = (contentType.split(';')[0] || 'image/png').trim();
        ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : 'png';
        console.log(`[gpt-image] remote image fetched: ${buffer.length} bytes (${(buffer.length/1024).toFixed(1)} KB) mime=${mime}`);
      } catch (e) {
        console.error(`[gpt-image] remote image fetch failed: ${e.message}`);
        throw new UpstreamError('UPSTREAM_ERROR', `远程图片获取失败: ${e.message}`);
      }
    } else {
      buffer = Buffer.from(req.imageBase64, 'base64');
      mime = req.imageMime || 'image/png';
      ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : 'png';
    }
    const payloadBytes = buffer.length;
    let processedBuffer = buffer;
    let processedMime = mime;
    let processedExt = ext;
    const requestedMaxDim = Number(req.inputImageMaxDimension);
    const imageMaxDim = Number.isInteger(requestedMaxDim)
      ? Math.min(Math.max(requestedMaxDim, MAX_COMPRESS_DIM), MAX_HIGH_FIDELITY_EDIT_DIM)
      : MAX_COMPRESS_DIM;
    const rawReferences = Array.isArray(req.refImages) ? req.refImages : [];
    const processedReferences = await Promise.all(rawReferences.map(async (reference) => {
      const referenceBuffer = Buffer.from(reference.base64, 'base64');
      const referenceMime = reference.mime || 'image/png';
      const referenceExt = referenceMime === 'image/jpeg' || referenceMime === 'image/jpg' ? 'jpg' : 'png';
      let buffer = referenceBuffer;
      let mime = referenceMime;
      let ext = referenceExt;
      try {
        const meta = await sharp(buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
        const needsResize = meta.width && meta.height && (meta.width > imageMaxDim || meta.height > imageMaxDim);
        const needsFormatChange = mime !== 'image/jpeg';
        if (needsResize || needsFormatChange) {
          const pipeline = sharp(buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS });
          if (needsResize) pipeline.resize(imageMaxDim, imageMaxDim, { fit: 'inside', withoutEnlargement: true });
          if (needsFormatChange) {
            mime = 'image/jpeg';
            ext = 'jpg';
            pipeline.jpeg({ quality: JPEG_QUALITY });
          }
          buffer = await pipeline.toBuffer();
        }
      } catch (e) {
        console.warn(`[gpt-image] reference processing failed, using original: ${e.message}`);
      }
      return { buffer, mime, ext };
    }));
    console.log(`[gpt-image] edits payload (raw): ${payloadBytes} bytes (${(payloadBytes/1024).toFixed(1)} KB) mime=${mime} ext=${ext}`);
    try {
      const maxDim = imageMaxDim;
      const jpegQuality = JPEG_QUALITY;
      const meta = await sharp(buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      const needsResize = meta.width && meta.height && (meta.width > maxDim || meta.height > maxDim);
      const needsFormatChange = mime !== 'image/jpeg';
      if (needsResize || needsFormatChange) {
        const pipeline = sharp(buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS });
        if (needsResize) {
          pipeline.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
        }
        if (needsFormatChange) {
          processedMime = 'image/jpeg';
          processedExt = 'jpg';
          pipeline.jpeg({ quality: jpegQuality });
        }
        processedBuffer = await pipeline.toBuffer();
        console.log(`[gpt-image] server-side processed: ${payloadBytes} -> ${processedBuffer.length} bytes (${(processedBuffer.length/1024).toFixed(1)} KB) maxDim=${maxDim} resize=${needsResize} format=${needsFormatChange ? 'to-jpeg' : 'unchanged'}`);
      }
    } catch (e) {
      console.warn(`[gpt-image] server-side processing failed, using original: ${e.message}`);
    }

    console.log(`[gpt-image] edits payload: ${processedBuffer.length} bytes (${(processedBuffer.length/1024).toFixed(1)} KB) mime=${processedMime} ext=${processedExt} size=${size || 'default'} references=${processedReferences.length}`);
    const inputImages = [
      { buffer: processedBuffer, mime: processedMime, ext: processedExt },
      ...processedReferences,
    ];
    const sourceMaskBase64 = req.maskBase64 || null;
    const preparedMask = sourceMaskBase64
      ? await prepareEditMask(sourceMaskBase64, processedBuffer)
      : null;

    async function tryEdits(formBody) {
      const res = await fetchWithTimeout(`${root}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formBody,
      });
      return res;
    }

    function buildEditForm(images, mask) {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', req.prompt);
      if (req.aspectRatio) {
        form.append('aspect_ratio', req.aspectRatio);
      } else {
        form.append('size', size || '1024x1024');
      }
      form.append('n', String(n));
      for (const [index, image] of images.entries()) {
        form.append('image', new Blob([image.buffer], { type: image.mime }), `image-${index}.${image.ext}`);
      }
      if (mask) {
        form.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
      }
      return form;
    }

    if (preparedMask) {
      console.log(`[gpt-image] normalized mask: ${preparedMask.length} bytes (${(preparedMask.length / 1024).toFixed(1)} KB)`);
    }
    let res = await tryEdits(buildEditForm(inputImages, preparedMask));
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.warn(`[gpt-image] edits failed ${res.status}: ${bodyText.slice(0, 200)}`);
      // Cheap relays may still reject. Retry with smaller size if this was a large image.
      if (res.status === 400 && (
        inputImages.some((image) => image.buffer.length > RETRY_SIZE_KB_THRESHOLD * 1024)
        || (preparedMask && preparedMask.length > RETRY_SIZE_KB_THRESHOLD * 1024)
      )) {
        console.log(`[gpt-image] retrying with reduced quality (${RETRY_RESIZE_DIM}px, ${RETRY_JPEG_QUALITY})...`);
        try {
          const reducedInputs = await Promise.all(inputImages.map(async (image) => ({
            buffer: await sharp(image.buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS })
              .resize(RETRY_RESIZE_DIM, RETRY_RESIZE_DIM, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: RETRY_JPEG_QUALITY })
              .toBuffer(),
            mime: 'image/jpeg',
            ext: 'jpg',
          })));
          const reducedMask = sourceMaskBase64
            ? await prepareEditMask(sourceMaskBase64, reducedInputs[0].buffer)
            : null;
          res = await tryEdits(buildEditForm(reducedInputs, reducedMask));
          if (!res.ok) {
            const retryText = await res.text().catch(() => '');
            console.warn(`[gpt-image] reduced retry also failed ${res.status}: ${retryText.slice(0, 200)}`);
            throw new UpstreamError(codeFromStatus(res.status), `gpt-image 图像编辑返回 ${res.status} (已尝试原图+降级)`, res.status);
          }
        } catch (error) {
          if (error instanceof UpstreamError) throw error;
          console.warn(`[gpt-image] reduced retry error: ${error.message}`);
          throw new UpstreamError(codeFromStatus(res.status), `gpt-image 图像编辑返回 ${res.status}`, res.status);
        }
      } else {
        throw new UpstreamError(codeFromStatus(res.status), `gpt-image 图像编辑返回 ${res.status}`, res.status);
      }
    }
    const json = await parseJsonSafe(res);
    return { images: pluckImages(json), raw: json };
  }

  // No image → text-only generations.
  const body = { model, prompt: req.prompt, n };
  if (req.aspectRatio) {
    body.aspect_ratio = req.aspectRatio;
  } else {
    body.size = size;
  }
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
  const url = await assertSafeUrl(req.customEndpoint);

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
      n: capN(req),
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
  seedream,
  'gpt-image': gptImage,
  'custom-url': customUrl,
};
