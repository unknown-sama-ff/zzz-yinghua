import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { providers } from './providers.js';
import { UpstreamError, fetchWithTimeout, parseJsonSafe, codeFromStatus } from './http.js';

// Load .env without a dependency: minimal parser for KEY=VALUE lines.
loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Railway (and most PaaS) inject PORT and route the public domain to it.
// Fall back to 8080 — Railway's default target port — so a missing PORT var
// still lands where the proxy forwards. Local dev sets PORT=8787 via .env.
const PORT = Number(process.env.PORT || 8080);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  }),
);
// Large limit to accommodate base64 image uploads. Three-view stitching tiles
// several images into one PNG, whose base64 is ~33% larger than the bytes —
// hence the generous ceiling beyond any single 10MB upload.
app.use(express.json({ limit: '50mb' }));

const VALID_PROVIDERS = new Set(['seedance', 'gpt-image', 'custom-url']);

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
        { type: 'text', text: 'Look at this character image and locate their face. It may be human, robot, animal, or any creature.\n\nReturn a JSON object with these fields (all values are 0-1 fractions):\n- faceTop: top edge of face/head (above eyes/brow for human, above visor for robot, above eyes for animal)\n- faceBottom: bottom edge of face (bottom of chin for human, bottom of faceplate for robot, bottom of muzzle for animal)\n- faceLeft: leftmost edge of facial features\n- faceRight: rightmost edge of facial features\n- bodyAxisAngle: the angle in degrees of the character\'s primary body motion axis — the dominant directional line of their pose (spine, torso, or core limb extension). This is NOT the head tilt but the full-body posture angle. Imagine drawing a line through the character\'s spine or core body direction: 0° = perfectly horizontal (lying flat), 90° = perfectly vertical (standing straight), positive = right side higher than left. Examples: a character leaning forward diagonally: ~35°; a character stretching an arm upward at an angle: ~60°; a side-lying character: ~5°; standing upright: ~85°. Range roughly -60 to +60.\n\nFor example, a standing character centered in the upper half: {"faceTop":0.15,"faceBottom":0.40,"faceLeft":0.30,"faceRight":0.55,"bodyAxisAngle":85}\n\nReply with ONLY the JSON object. No markdown, no explanation.' },
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

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[影画工坊] proxy listening on http://0.0.0.0:${PORT} dist=${hasDist} node=${process.version}`);
});

// Allow long image-to-image requests to complete.
if (typeof server.requestTimeout === 'number') {
  const upstreamMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 300000);
  server.requestTimeout = upstreamMs + 60000;
  server.headersTimeout = upstreamMs + 60000;
}

