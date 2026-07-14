import {
  fetchWithTimeout,
  withRetry,
  UpstreamError,
  codeFromStatus,
  assertSafeUrl,
  sleep,
  parseJsonSafe,
} from './http.js';

const IS_VERCEL = Boolean(process.env.VERCEL);

// When running on Vercel serverless, spawn a Worker thread for long-polling
// so the function can return immediately and the Worker (own event loop) keeps
// polling upstream until the task completes.
let storeCallback: ((id: string, images: string[]) => void) | null = null;

export function registerTaskStore(cb: (id: string, images: string[]) => void) {
  storeCallback = cb;
}

function spawnPollWorker(base: string, key: string, taskId: string, maxMs = 180000) {
  if (!IS_VERCEL || !storeCallback) return pollSeedreamTask(base, key, taskId, maxMs);

  // Vercel: delegate polling to a Worker thread so it outlives the
  // serverless function's execution window.
  try {
    const { Worker, isMainThread, parentPort } = require('worker_threads');
    if (isMainThread) {
      const worker = new Worker(
        // Use an inline worker via a data URL — Node 20+ supports this.
        // We build the worker script inline so it has access to fetchWithTimeout
        // via a minimal reimplementation.
        `'use strict';
        const { parentPort } = require('worker_threads');
        async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
        async function fetchWithTimeout(url, opts = {}) {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 180000);
          try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
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
          const { base, key, taskId } = JSON.parse(process.env.WORKER_ARGS || '{}');
          const deadline = Date.now() + 180000;
          while (Date.now() < deadline) {
            await sleep(2000);
            const res = await fetchWithTimeout(base + '/tasks/' + taskId, { headers: { Authorization: 'Bearer ' + key } });
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
        `,
        { eval: true },
      );
      const args = JSON.stringify({ base, key, taskId });
      worker.threadData = { base, key, taskId };
      // We can't easily pass env vars to eval'd worker, so we pass via threadData
      // and read from process.env.WORKER_ARGS in the worker... Actually, let's
      // use a different approach: pass via message channel.
      // The eval'd worker above uses process.env.WORKER_ARGS — let's set it.
      const wrappedScript = `
        'use strict';
        const WORKER_ARGS = ${JSON.stringify({ base, key, taskId })};
        const { parentPort } = require('worker_threads');
        async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
        async function fetchWithTimeout(url, opts = {}) {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 180000);
          try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
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
        if (msg.type === 'done' && storeCallback) {
          storeCallback(taskId, msg.images);
        } else if (msg.type === 'error') {
          taskStore.set(taskId, { status: 'error', error: msg.message, timer: setTimeout(() => cleanupTask(taskId), TASK_TTL_MS) });
        }
        w.terminate();
      });
      w.on('error', () => {
        taskStore.set(taskId, { status: 'error', error: 'Worker 启动失败', timer: setTimeout(() => cleanupTask(taskId), TASK_TTL_MS) });
      });
      return;
    }
  } catch {
    // worker_threads not available (older Node) — fall through to inline poll
  }

  // Fallback: inline poll (works on Railway / long-running server)
  return pollSeedreamTask(base, key, taskId, maxMs);
}

/**
 * Each provider implements: async generate(req) -> { images: string[], raw }
 * `req` is the validated body from POST /api/generate.
 *
 * NOTE: upstream image-API request/response shapes vary. These implementations
 * target the common conventions (OpenAI images edit, a seedream-style task API)
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
  const model = useServerPreset
    ? process.env.SEEDREAM_MODEL
    : req.model;
  const body = {
    prompt: req.prompt,
    image: req.imageBase64,
    n: req.n || 1,
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
    spawnPollWorker(base, key, taskId);
    return { taskId, images: [] };
  }
  return { images: pluckImages(json), raw: json };
}

async function pollSeedreamTask(base, key, taskId, maxMs = 180000) {
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
  const n = req.n || 1;
  const root = base.replace(/\/$/, '');

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
    if (req.aspectRatio) {
      form.append('aspect_ratio', req.aspectRatio);
    } else {
      form.append('size', size);
    }
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
  seedream,
  'gpt-image': gptImage,
  'custom-url': customUrl,
};
