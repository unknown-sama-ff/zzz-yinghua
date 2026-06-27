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
const PORT = Number(process.env.PORT || 8787);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  }),
);
// Large limit to accommodate base64 image uploads. Three-view stitching tiles
// several images into one PNG, whose base64 is ~33% larger than the bytes —
// hence the generous ceiling beyond any single 10MB upload.
app.use(express.json({ limit: '25mb' }));

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
    return fail(res, 500, 'UNKNOWN', `服务端内部错误: ${err?.message || err}`);
  }
});

app.post('/api/detect-face', async (req, res) => {
  const { imageBase64, imageMime, apiKey, baseUrl, model } = req.body || {};
  if (!imageBase64) return fail(res, 400, 'INVALID_INPUT', '缺少图片');
  const key = apiKey || process.env.VISION_API_KEY;
  if (!key) return fail(res, 401, 'UNAUTHORIZED', '视觉模型缺少 API Key，请在前端填写');
  const root = (baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const mime = imageMime || 'image/png';

  const body = {
    model: model || process.env.VISION_MODEL || 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}`, detail: 'high' } },
        { type: 'text', text: 'Find the character\'s face in this image. faceTop = the very top of the forehead / above eyebrows (both eyes must be below this line). faceBottom = bottom of chin. Return ONLY raw JSON: {"faceTop":0.05,"faceBottom":0.48} — values are 0-1 fractions of image height from the top edge. No markdown, no explanation.' },
      ],
    }],
    max_tokens: 60,
  };

  try {
    const response = await fetchWithTimeout(`${root}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }, 120000);
    if (!response.ok) {
      throw new UpstreamError(codeFromStatus(response.status), `detect-face 返回 ${response.status}`, response.status);
    }
    const json = await parseJsonSafe(response);
    const text = json.choices?.[0]?.message?.content ?? '';
    console.log(`[detect-face] raw response: ${text.slice(0, 200)}`);
    const match = text.match(/\{[^}]+\}/);
    if (!match) throw new UpstreamError('UPSTREAM_ERROR', '视觉模型未返回有效坐标');
    const coords = JSON.parse(match[0]);
    const faceTop = Math.max(0, Math.min(1, Number(coords.faceTop)));
    const faceBottom = Math.max(0, Math.min(1, Number(coords.faceBottom)));
    console.log(`[detect-face] faceTop=${faceTop} faceBottom=${faceBottom}`);
    return res.json({ ok: true, faceTop, faceBottom });
  } catch (err) {
    if (err instanceof UpstreamError) return fail(res, err.status, err.code, err.message);
    console.error('[detect-face] unexpected error:', err);
    return fail(res, 500, 'UNKNOWN', '人脸检测失败');
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// In production, serve the built frontend from dist/.
const distDir = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback for client-side routes only — never swallow /api/* so a
  // mistyped method or unknown API path returns a real 404/JSON error instead
  // of silently serving index.html.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

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

const server = app.listen(PORT, () => {
  console.log(`[影画工坊] proxy listening on http://localhost:${PORT}`);
});

// Allow long image-to-image requests to complete. Node's default requestTimeout
// (≈300s) would otherwise race the upstream ceiling and sever the connection;
// give it headroom beyond UPSTREAM_TIMEOUT_MS.
const upstreamMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 300000);
server.requestTimeout = upstreamMs + 60000;
server.headersTimeout = upstreamMs + 60000;

