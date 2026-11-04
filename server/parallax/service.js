import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import sharp from 'sharp';
import { assertSafeUrl, fetchBufferLimited } from '../http.js';
import { ensureParallaxModel } from './model.js';

export class ParallaxError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
const VERSION = 'anime-subject-edgefill-v1';
const STYLES = new Set(['自由创作', '动作底稿', '海报版']);
export const VALID_KEY = /^[a-f0-9]{64}$/;

export async function fetchGalleryImage(url) {
  const safe = await assertSafeUrl(url);
  const result = await fetchBufferLimited(safe.toString(), {}, 20000, 10 * 1024 * 1024);
  if (!result.ok || !/^image\/(png|jpe?g|webp)(?:;|$)/i.test(result.contentType)) throw new ParallaxError('图库图片暂时无法读取');
  return result.buffer;
}

export function runLayerWorker({ model, input, output }) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [model, input, output], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    let message = '';
    let expired = false;
    child.stderr.on('data', (bytes) => { message = (message + bytes.toString()).slice(-1000); });
    const timer = setTimeout(() => { expired = true; child.kill(); }, 60000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 && !expired) resolve();
      else reject(new Error(expired ? '分层处理超时' : message || '分层处理进程已结束'));
    });
  });
}

export function createParallaxService({ lookupImage, cacheDir = path.resolve('.cache/parallax'), loadImage = fetchGalleryImage, getModel = ensureParallaxModel, runWorker = runLayerWorker, availableMemory = () => process.availableMemory?.() ?? 0 }) {
  const root = path.resolve(cacheDir);
  const layerRoot = path.join(root, 'layers');
  const workRoot = path.join(root, 'work');
  const pending = new Map();
  let tail = Promise.resolve();

  async function removeOwnedDirectory(directory, owner) {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(owner) + path.sep)) throw new Error('Invalid cache path');
    await fs.rm(resolved, { recursive: true, force: true });
  }
  async function cached(key) {
    try {
      const directory = path.join(layerRoot, key);
      const meta = JSON.parse(await fs.readFile(path.join(directory, 'meta.json'), 'utf8'));
      await Promise.all(['foreground.webp', 'background.webp'].map((name) => fs.access(path.join(directory, name))));
      if (!Number.isFinite(meta.width) || !Number.isFinite(meta.height) || meta.width < 1 || meta.height < 1 || meta.width > 1024 || meta.height > 1024) return null;
      return { key, width: meta.width, height: meta.height };
    } catch { return null; }
  }
  async function trimCache(keep) {
    const entries = await fs.readdir(layerRoot, { withFileTypes: true });
    const folders = await Promise.all(entries.filter((entry) => entry.isDirectory() && VALID_KEY.test(entry.name)).map(async (entry) => {
      const directory = path.join(layerRoot, entry.name);
      const stats = await Promise.all(['foreground.webp', 'background.webp', 'meta.json'].map((name) => fs.stat(path.join(directory, name)).catch(() => ({ size: 0, mtimeMs: 0 }))));
      return { key: entry.name, directory, bytes: stats.reduce((sum, stat) => sum + stat.size, 0), time: Math.max(...stats.map((stat) => stat.mtimeMs)) };
    }));
    let total = folders.reduce((sum, entry) => sum + entry.bytes, 0);
    let count = folders.length;
    for (const entry of folders.sort((a, b) => a.time - b.time)) {
      if (entry.key === keep || total <= 96 * 1024 * 1024 && count <= 64) continue;
      await removeOwnedDirectory(entry.directory, layerRoot); total -= entry.bytes; count--;
    }
  }
  async function build(key, url) {
    if (availableMemory() < 1150 * 1024 * 1024) throw new ParallaxError('分层服务当前内存不足，可继续查看原图');
    const buffer = await loadImage(url);
    let normalized;
    try {
      const image = sharp(buffer, { limitInputPixels: 24_000_000, failOnError: true });
      const meta = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format)) throw new Error('format');
      normalized = await image.rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).removeAlpha().png().toBuffer();
    } catch { throw new ParallaxError('图库图片格式或尺寸暂不支持分层', 422); }
    const model = await getModel(root);
    await fs.mkdir(workRoot, { recursive: true }); await fs.mkdir(layerRoot, { recursive: true });
    const work = await fs.mkdtemp(path.join(workRoot, 'job-'));
    try {
      const input = path.join(work, 'input.png');
      await fs.writeFile(input, normalized);
      await runWorker({ model, input, output: work });
      await fs.unlink(input);
      const destination = path.resolve(layerRoot, key);
      if (!destination.startsWith(layerRoot + path.sep) || !VALID_KEY.test(key)) throw new Error('Invalid cache key');
      await removeOwnedDirectory(destination, layerRoot);
      if (!path.resolve(work).startsWith(workRoot + path.sep)) throw new Error('Invalid work path');
      await fs.rename(work, destination);
      const result = await cached(key);
      if (!result) throw new Error('分层结果不完整');
      await trimCache(key);
      return result;
    } finally { await removeOwnedDirectory(work, workRoot); }
  }

  return {
    async prepare(id) {
      const valid = typeof id === 'number' ? Number.isSafeInteger(id) && id > 0 : typeof id === 'string' && /^(?:\d{1,20}|[A-Za-z0-9-]{8,64})$/.test(id);
      if (!valid) throw new ParallaxError('无效的图库作品', 400);
      const row = await lookupImage(id);
      if (!row || !STYLES.has(row.style) || typeof row.image_url !== 'string') throw new ParallaxError('未找到可分层的图库作品', 404);
      const key = crypto.createHash('sha256').update(VERSION + row.image_url).digest('hex');
      const hit = await cached(key);
      if (hit) return hit;
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= 3) throw new ParallaxError('分层任务较多，请稍后重试', 429);
      const job = tail.then(() => build(key, row.image_url));
      tail = job.catch(() => {});
      const tracked = job.finally(() => pending.delete(key));
      pending.set(key, tracked);
      return tracked;
    },
    async asset(key, name) {
      if (!VALID_KEY.test(key) || !['foreground.webp', 'background.webp'].includes(name)) return null;
      const file = path.join(layerRoot, key, name);
      try { await fs.access(file); return file; } catch { return null; }
    },
  };
}
