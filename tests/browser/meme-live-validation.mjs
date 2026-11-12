// Explicit, opt-in live validation: exactly one generation, no automatic retry or gallery publication.
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import sharp from 'sharp';

if (process.env.MEME_LIVE_VALIDATION !== '1') throw new Error('Live validation is opt-in: set MEME_LIVE_VALIDATION=1. It consumes one generation.');
const output = resolve('node_modules/.cache/meme-live-qa');
await fs.mkdir(output, { recursive: true });
const bundle = await build({ stdin: { contents: "export * from './src/lib/meme';", resolveDir: resolve('.'), sourcefile: 'live-validation.ts', loader: 'ts' }, bundle: true, platform: 'browser', format: 'esm', write: false });
const { createMemeDraft, buildMemeRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const configuration = await fs.readFile('.env', 'utf8');
const line = configuration.split(/\r?\n/).find((line) => /^VITE_API_BASE_URL\s*=/.test(line));
const backend = line?.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
if (!backend || new URL(backend).protocol !== 'https:') throw new Error('A configured HTTPS backend is required.');
const image = await fs.readFile(resolve('public/作者推荐/海报版.webp'));
const draft = createMemeDraft();
draft.character = { id: 'live-character', name: '派蒙项目样例', dataUrl: `data:image/webp;base64,${image.toString('base64')}` };
const request = buildMemeRequest(draft, { provider: 'gpt-image', useServerPreset: true, apiKey: '', baseUrl: '', model: '', denoiseEnabled: false, maxInputImages: 16, transparencySupported: true, quality: 'medium' });
const started = Date.now();
console.log(JSON.stringify({ phase: 'generating', backend: new URL(backend).origin, requestId: request.idempotencyKey, count: 9, calls: 1 }));
const summaryFile = resolve(output, 'summary.json');
try {
  const response = await fetch(`${backend}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(360000) });
  const data = await response.json();
  if (!response.ok || !data.ok || !data.images?.[0]) {
    const summary = { ok: false, status: response.status, code: data.code, message: data.message, elapsedMs: Date.now() - started, calls: 1 };
    await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary)); process.exitCode = 1;
  } else {
    const source = data.images[0];
    let bytes;
    if (source.startsWith('data:')) bytes = Buffer.from(source.slice(source.indexOf(',') + 1), 'base64');
    else {
      const generated = await fetch(source, { signal: AbortSignal.timeout(30000) });
      if (!generated.ok) throw new Error(`Generated image fetch failed (${generated.status})`);
      bytes = Buffer.from(await generated.arrayBuffer());
    }
    const png = await sharp(bytes, { limitInputPixels: 16_777_216 }).png().toBuffer();
    const { data: pixels, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let clear = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] <= 16) clear++;
    await fs.writeFile(resolve(output, 'paimon-meme-grid.png'), png);
    const summary = { ok: true, status: response.status, elapsedMs: Date.now() - started, calls: 1, width: info.width, height: info.height, clearPixelFraction: clear / (info.width * info.height), nativeAlpha: clear > 0, output: resolve(output, 'paimon-meme-grid.png'), limitation: 'Uses the existing deployed backend; new background parameter forwarding is not deployed or verified.' };
    await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
  }
} catch (error) {
  const summary = { ok: false, message: error.message, elapsedMs: Date.now() - started, calls: 1, uncertain: true };
  await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary)); process.exitCode = 1;
}
