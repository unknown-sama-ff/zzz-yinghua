import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import multer from 'multer';
import { providers, registerTaskStore } from './providers.js';
import { UpstreamError, fetchWithTimeout, parseJsonSafe, codeFromStatus } from './http.js';

// Load .env without a dependency: minimal parser for KEY=VALUE lines.
loadEnv();

import { TASK_TTL_MS, MAX_UPLOAD_BYTES } from './lib/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const IS_VERCEL = Boolean(process.env.VERCEL);
// Railway (and most PaaS) inject PORT and route the public domain to it.
// Fall back to 8080 — Railway's default target port — so a missing PORT var
// still lands where the proxy forwards. Local dev sets PORT=8787 via .env.
const PORT = Number(process.env.PORT || 8080);

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',   // Vite dev server
  'http://localhost:8787',   // direct backend access
  'https://www.zzz-yinghua.asia',  // production frontend (www)
  'https://zzz-yinghua.asia',      // production frontend (apex)
  ...(process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : []),
]);

const corsOrigin = (origin, callback) => {
  if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
  return callback(null, false);  // reflect: block unknown origins
};

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
// Large limit to accommodate base64 image uploads. Three-view stitching tiles
// several images into one PNG, whose base64 is ~33% larger than the bytes —
// hence the generous ceiling beyond any single 10MB upload.
app.use(express.json({ limit: '50mb' }));

// Multer for multipart/form-data (inpaint endpoint).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const VALID_PROVIDERS = new Set(['seedream', 'gpt-image', 'custom-url']);

// ── In-memory task registry for async image generation ────────────────────
// Vercel serverless functions have execution time limits. When running on
// Vercel, generate() returns a taskId immediately and the frontend polls
// GET /api/task/:id for completion.
const taskStore = new Map();

function cleanupTask(id) {
  const entry = taskStore.get(id);
  if (entry?.timer) clearTimeout(entry.timer);
  taskStore.delete(id);
}

// Let providers register task results (needed for async Vercel worker pattern).
registerTaskStore((id, images) => {
  const entry = taskStore.get(id);
  if (!entry) return;
  entry.status = 'done';
  entry.images = images;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => cleanupTask(id), TASK_TTL_MS);
});

app.get('/api/task/:id', (req, res) => {
  const { id } = req.params;
  const task = taskStore.get(id);
  if (!task) return fail(res, 404, 'NOT_FOUND', '任务不存在或已过期');
  if (task.status === 'done') {
    cleanupTask(id);
    return res.json({ ok: true, images: task.images ?? [], taskId: id });
  }
  if (task.status === 'error') {
    cleanupTask(id);
    return fail(res, 502, 'UPSTREAM_ERROR', task.error ?? '生成失败');
  }
  // Still pending/running — 202 Accepted
  res.status(202).json({ ok: true, taskId: id, status: task.status });
});

app.post('/api/generate', async (req, res) => {
  const body = req.body || {};
  const { provider, prompt } = body;

  if (!provider || !VALID_PROVIDERS.has(provider)) {
    return fail(res, 400, 'INVALID_INPUT', '无效的 provider');
  }
  if (!prompt || typeof prompt !== 'string') {
    return fail(res, 400, 'INVALID_INPUT', '缺少 prompt');
  }

  const started = Date.now();
  const hasImage = Boolean(body.imageBase64 || body.imageUrl);
  console.log(
    `[generate] provider=${provider} hasImage=${hasImage} size=${body.size || 'default'} endpoint=${body.customEndpoint || body.baseUrl || '(env/default)'}`,
  );

  try {
    const result = await providers[provider](body);

    // Long-task: provider returned a task_id → register and return immediately.
    const taskId = result.taskId;
    if (taskId && (!result.images || result.images.length === 0)) {
      taskStore.set(taskId, {
        status: 'pending',
        timer: setTimeout(() => cleanupTask(taskId), TASK_TTL_MS),
      });
      console.log(`[generate] provider=${provider} task queued id=${taskId} (${Date.now() - started}ms)`);
      return res.json({ ok: true, taskId });
    }

    if (!result.images || result.images.length === 0) {
      console.warn(`[generate] provider=${provider} 上游未返回图片 (${Date.now() - started}ms)`);
      return fail(res, 502, 'UPSTREAM_ERROR', '上游未返回图片');
    }
    console.log(`[generate] provider=${provider} ok images=${result.images.length} (${Date.now() - started}ms)`);
    return res.json({ ok: true, images: result.images });
  } catch (err) {
    if (err instanceof UpstreamError) {
      console.warn(`[generate] provider=${provider} ${err.code}: ${err.message} (${Date.now() - started}ms)`);
      return fail(res, err.status, err.code, err.message);
    }
    console.error('[generate] unexpected error:', err);
    return fail(res, 500, 'UNKNOWN', '服务端内部错误');
  }
});

// ── Inpaint (image + optional mask + prompt) via gpt-image ───────────────────
app.post('/api/inpaint', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]), async (req, res) => {
  if (!req.files?.image || !Array.isArray(req.files.image) || req.files.image.length === 0) {
    return fail(res, 400, 'INVALID_INPUT', '缺少图片文件 (field: image)');
  }
  const imageFile = req.files.image[0];
  const maskFile = req.files.mask?.[0];

  const { prompt, provider, model, apiKey, baseUrl, useServerPreset } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return fail(res, 400, 'INVALID_INPUT', '缺少 prompt');
  }

  const targetProvider = (typeof provider === 'string' && VALID_PROVIDERS.has(provider))
    ? provider
    : 'gpt-image';
  if (targetProvider !== 'gpt-image') {
    return fail(res, 400, 'INVALID_INPUT', '局部重绘目前仅支持 gpt-image 提供方');
  }

  const imageBase64 = imageFile.buffer.toString('base64');
  const maskBase64 = maskFile ? maskFile.buffer.toString('base64') : undefined;

  const body = {
    provider: targetProvider,
    prompt,
    imageBase64,
    imageMime: imageFile.mimetype,
    maskBase64,
    maskMime: maskFile ? maskFile.mimetype : undefined,
    n: 1,
    ...(typeof model === 'string' && model ? { model } : {}),
    ...(typeof apiKey === 'string' && apiKey ? { apiKey } : {}),
    ...(typeof baseUrl === 'string' && baseUrl ? { baseUrl } : {}),
    ...(useServerPreset === true ? { useServerPreset: true } : {}),
  };

  const started = Date.now();
  try {
    const result = await providers[targetProvider](body);
    const taskId = result.taskId;
    if (taskId && (!result.images || result.images.length === 0)) {
      taskStore.set(taskId, {
        status: 'pending',
        timer: setTimeout(() => cleanupTask(taskId), TASK_TTL_MS),
      });
      console.log(`[inpaint] task queued id=${taskId} (${Date.now() - started}ms)`);
      return res.json({ ok: true, taskId });
    }
    if (!result.images || result.images.length === 0) {
      return fail(res, 502, 'UPSTREAM_ERROR', '上游未返回图片');
    }
    console.log(`[inpaint] ok images=${result.images.length} (${Date.now() - started}ms) mask=${Boolean(maskBase64)}`);
    return res.json({ ok: true, images: result.images });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return fail(res, err.status, err.code, err.message);
    }
    console.error('[inpaint] unexpected error:', err);
    return fail(res, 500, 'UNKNOWN', '服务端内部错误');
  }
});

app.post('/api/detect-face', async (req, res) => {
  const { imageBase64, imageMime, apiKey, baseUrl, model, useServerPreset } = req.body || {};
  if (!imageBase64) return fail(res, 400, 'INVALID_INPUT', '缺少图片');

  const usingPreset = useServerPreset === true;
  const key = usingPreset ? process.env.VISION_API_KEY : apiKey;
  if (!key) {
    console.warn(`[detect-face] missing key useServerPreset=${Boolean(useServerPreset)} usingPreset=${usingPreset} frontHasKey=${Boolean(apiKey)} envHasKey=${Boolean(process.env.VISION_API_KEY)}`);
    return fail(res, 401, 'UNAUTHORIZED', usingPreset ? '视觉模型服务端预设缺少 API Key' : '视觉模型缺少 API Key，请在前端填写');
  }
  const root = (usingPreset
    ? (process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    : baseUrl).replace(/\/$/, '');
  if (!root) {
    return fail(res, 401, 'UNAUTHORIZED', usingPreset ? '视觉模型服务端预设缺少 Base URL' : '视觉模型缺少 Base URL，请在前端填写');
  }
  const mime = imageMime || 'image/png';

  const resolvedModel = usingPreset
    ? (process.env.VISION_MODEL || 'gpt-4o-mini')
    : model;
  if (!resolvedModel) {
    return fail(res, 401, 'UNAUTHORIZED', usingPreset ? '视觉模型服务端预设缺少模型名称' : '视觉模型缺少模型名称，请在前端填写');
  }
  console.log(`[detect-face] useServerPreset=${Boolean(useServerPreset)} usingPreset=${usingPreset} frontHasKey=${Boolean(apiKey)} envHasKey=${Boolean(process.env.VISION_API_KEY)} root=${root} model=${resolvedModel}`);

  const body = {
    model: resolvedModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
        { type: 'text', text: 'Detect the character\'s facial region and body motion axis. The character may be human, robot, animal, or any creature — adapt to their anatomy:\n\nfaceTop = top of the facial feature area (human: above eyebrows; robot: top of visor/screen/faceplate; animal: above eyes)\nfaceBottom = bottom of the facial feature area (human: bottom of chin; robot: bottom of faceplate; animal: bottom of muzzle/snout)\nfaceLeft = leftmost edge of the facial feature cluster\nfaceRight = rightmost edge of the facial feature cluster\n\nCRITICAL: Both eyes must be COMPLETELY visible within [faceLeft, faceRight] — the crop window must contain the full eyes, not cut off either eye. If one eye is near the edge, expand faceLeft/faceRight outward to include it fully. Only exclude the eyes if the character genuinely has no visible eyes.\n\nbodyAxisAngle = the angle in degrees of the character\'s primary body motion axis — their spine, torso, or core limb direction. This is the dominant directional line of their pose. 0 = horizontal, positive = right side higher (counter-clockwise), range roughly -60 to +60. For a standing upright character use 90, for a lying horizontal character use 0.\n\nReturn ONLY raw JSON: {"faceTop":0.05,"faceBottom":0.48,"faceLeft":0.10,"faceRight":0.55,"bodyAxisAngle":8}\nValues are 0-1 fractions: top/bottom = fraction of image height from top, left/right = fraction of image width from left. No markdown, no explanation.' },
      ],
    }],
    max_tokens: 200,
    response_format: { type: 'json_object' },
  };

  try {
    const response = await fetchWithTimeout(`${root}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }, 180000);
    if (!response.ok) {
      throw new UpstreamError(codeFromStatus(response.status), `detect-face 返回 ${response.status}`, response.status);
    }
    const json = await parseJsonSafe(response);
    const text = json.choices?.[0]?.message?.content ?? '';
    console.log(`[detect-face] raw response: ${text.slice(0, 200)}`);
    let coords;
    try {
      coords = JSON.parse(text);
    } catch {
      const match = text.match(/\{[^}]+\}/);
      if (!match) throw new UpstreamError('UPSTREAM_ERROR', '视觉模型未返回有效坐标');
      coords = JSON.parse(match[0]);
    }
    const faceTop = Math.max(0, Math.min(1, Number(coords.faceTop)));
    const faceBottom = Math.max(0, Math.min(1, Number(coords.faceBottom)));
    const faceLeft = Math.max(0, Math.min(1, Number(coords.faceLeft ?? 0.25)));
    const faceRight = Math.max(0, Math.min(1, Number(coords.faceRight ?? 0.75)));
    const bodyAxisAngle = Number.isFinite(Number(coords.bodyAxisAngle)) ? Number(coords.bodyAxisAngle) : 8;
    console.log(`[detect-face] faceTop=${faceTop} faceBottom=${faceBottom} faceLeft=${faceLeft} faceRight=${faceRight} bodyAxisAngle=${bodyAxisAngle}`);
    return res.json({ ok: true, faceTop, faceBottom, faceLeft, faceRight, bodyAxisAngle });
  } catch (err) {
    if (err instanceof UpstreamError) return fail(res, err.status, err.code, err.message);
    console.error('[detect-face] unexpected error:', err);
    return fail(res, 500, 'UNKNOWN', '人脸检测失败');
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, port: PORT }));

// In production, serve the built frontend from dist/.
const distDir = path.resolve(__dirname, '..', 'dist');
const hasDist = fs.existsSync(distDir);
console.log(`[影画工坊] distDir=${distDir} exists=${hasDist}`);

// Root handler — explicit, no dependency on express.static index resolution.
app.get('/', (_req, res) => {
  if (hasDist) return res.sendFile(path.join(distDir, 'index.html'));
  res.type('html').send('<!DOCTYPE html><html><body><h1>影画工坊</h1><p>dist/ not found</p></body></html>');
});

if (hasDist) {
  // Cache hashed assets (Vite chunks contain `-` in the filename) for 1 year,
  // and everything else for 1 hour. This avoids re-downloading unchanged JS/CSS.
  app.use((req, res, next) => {
    if (req.path.match(/^\/assets\/.*-[a-f0-9]+\.(js|css)$/)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (req.path.match(/\.(js|css|woff2|png|webp|jpg|ico)$/)) {
      res.set('Cache-Control', 'public, max-age=3600');
    }
    next();
  });
  app.use(express.static(distDir));
  // SPA fallback for client-side routes — never swallow /api/*
  app.get(/^(?!\/api\/).*/, (req, _res, next) => {
    // Only reach here if the path doesn't match a file in dist/
    if (req.path === '/') return next(); // already handled above
    _res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Global error handler — must not crash the server
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err?.message || err);
  if (!res.headersSent) res.status(500).json({ ok: false, code: 'UNKNOWN', message: '服务端内部错误' });
});

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Vercel serverless: export the app so the runtime can use it as a handler.
// Local / Railway: start the HTTP server as before.
// Vercel serverless: export the app so the runtime uses it as a handler.
// Local / Railway: also start the HTTP server below.
export default app;

if (!IS_VERCEL) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[影画工坊] proxy listening on http://0.0.0.0:${PORT} dist=${hasDist} node=${process.version}`);
  });

  // Allow long image-to-image requests to complete.
  if (typeof server.requestTimeout === 'number') {
    const upstreamMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 300000);
    server.requestTimeout = upstreamMs + 60000;
    server.headersTimeout = upstreamMs + 60000;
  }
}

