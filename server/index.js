import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { providers } from './providers.js';
import { UpstreamError } from './http.js';

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
// Large limit to accommodate base64 image uploads (spec: ~15MB ceiling).
app.use(express.json({ limit: '15mb' }));

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
  if (provider !== 'custom-url' && !body.imageBase64 && !body.imageUrl) {
    // generations-only providers can run prompt-only, but warn for image edit.
    // We allow it through; upstream decides.
  }

  try {
    const result = await providers[provider](body);
    if (!result.images || result.images.length === 0) {
      return fail(res, 502, 'UPSTREAM_ERROR', '上游未返回图片');
    }
    return res.json({ ok: true, images: result.images });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return fail(res, err.status, err.code, err.message);
    }
    console.error('[generate] unexpected error:', err);
    return fail(res, 500, 'UNKNOWN', '服务端内部错误');
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// In production, serve the built frontend from dist/.
const distDir = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
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

app.listen(PORT, () => {
  console.log(`[影画工坊] proxy listening on http://localhost:${PORT}`);
});
