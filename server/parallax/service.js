import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { assertSafeUrl, fetchBufferLimited } from '../http.js';
import { ensureParallaxModel, ensureParallaxDepthModel } from './model.js';
import { createLayerWorkerPool } from './pool.js';
import { boundedInteger, resolveParallaxCacheDir } from './runtime.js';

export class ParallaxError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
const VERSION = 'anime-subject-consistency-reflection-v7';
const ASSETS = ['background.webp', 'subject.webp', 'foreground.webp'];
const STYLES = new Set(['自由创作', '动作底稿', '海报版']);
export const VALID_KEY = /^[a-f0-9]{64}$/;

export async function fetchGalleryImage(url) {
  const safe = await assertSafeUrl(url);
  const result = await fetchBufferLimited(safe.toString(), {}, 20000, 10 * 1024 * 1024);
  if (!result.ok || !/^image\/(png|jpe?g|webp)(?:;|$)/i.test(result.contentType)) throw new ParallaxError('图库图片暂时无法读取');
  return result.buffer;
}

export async function runLayerWorker(args) {
  const pool = createLayerWorkerPool({ maxWorkers: 1 });
  try { return await pool.run(args); }
  finally { await pool.close(); }
}

export function createParallaxService({
  lookupImage, cacheDir = resolveParallaxCacheDir(), loadImage = fetchGalleryImage,
  getModel = ensureParallaxModel, getDepthModel = ensureParallaxDepthModel, runWorker,
  availableMemory = () => process.availableMemory?.() ?? 0,
  concurrency = boundedInteger(process.env.PUZZLE_LAYER_CONCURRENCY, 2, 1, 2),
  maxPending = boundedInteger(process.env.PUZZLE_LAYER_MAX_PENDING, 6, 1, 16),
  queueTimeoutMs = 60000,
  onMetrics = (metrics) => console.info('[puzzle-layers/metrics]', JSON.stringify(metrics)),
}) {
  const root = path.resolve(cacheDir);
  const layerRoot = path.join(root, 'layers');
  const workRoot = path.join(root, 'work');
  const pending = new Map();
  const queue = [];
  const activeJobs = new Set();
  const activeWork = new Set();
  const capacity = boundedInteger(concurrency, 2, 1, 2);
  const pendingLimit = Math.max(capacity, boundedInteger(maxPending, 6, 1, 16));
  const pool = runWorker ? null : createLayerWorkerPool({ maxWorkers: capacity });
  const executeWorker = runWorker ?? ((args) => pool.run(args));
  let maintenance = Promise.resolve();
  let closed = false;

  function report(metrics) {
    try { onMetrics(metrics); } catch { /* Metrics must not fail an otherwise valid result. */ }
  }

  function dispatch() {
    while (!closed && queue.length && activeJobs.size < capacity) {
      // Reserve room for workers which have started but may not have allocated yet.
      // Already resident models need less headroom when their worker is reused.
      const requiredMb = pool?.hasIdleWorker() ? 512 : 1536;
      const unreservedMemory = availableMemory() - activeJobs.size * 1536 * 1024 * 1024;
      if (unreservedMemory < requiredMb * 1024 * 1024 && activeJobs.size) return;
      const task = queue.shift();
      clearTimeout(task.timer);
      if (unreservedMemory < requiredMb * 1024 * 1024) {
        task.reject(new ParallaxError('分层服务当前内存不足，可继续查看原图'));
        continue;
      }
      const queueMs = Date.now() - task.enqueuedAt;
      const running = build(task.key, task.url).then(({ result, metrics }) => {
        report({ ...metrics, cacheHit: false, queueMs, totalMs: Date.now() - task.requestedAt });
        task.resolve(result);
      }, (error) => {
        report({ cacheHit: false, failed: true, queueMs, totalMs: Date.now() - task.requestedAt });
        task.reject(error);
      }).finally(() => {
        activeJobs.delete(running);
        dispatch();
      });
      activeJobs.add(running);
    }
  }

  async function removeOwnedDirectory(directory, owner) {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(owner) + path.sep)) throw new Error('Invalid cache path');
    await fs.rm(resolved, { recursive: true, force: true });
  }
  async function readPrepared(directory, key) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(directory, 'meta.json'), 'utf8'));
      await Promise.all(ASSETS.map((name) => fs.access(path.join(directory, name))));
      if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height) || meta.width < 1 || meta.height < 1 || meta.width > 1024 || meta.height > 1024) return null;
      return { key, width: meta.width, height: meta.height, hasForeground: meta.hasForeground === true };
    } catch { return null; }
  }
  const cached = (key) => readPrepared(path.join(layerRoot, key), key);
  async function trimCache(keep) {
    // A mounted volume can retain interrupted jobs across process restarts.
    const workEntries = await fs.readdir(workRoot, { withFileTypes: true });
    for (const entry of workEntries) {
      if (!entry.isDirectory() || !/^job-[A-Za-z0-9]+$/.test(entry.name)) continue;
      const directory = path.join(workRoot, entry.name);
      if (activeWork.has(directory)) continue;
      const stats = await fs.stat(directory).catch(() => null);
      if (stats && stats.mtimeMs < Date.now() - 3600000) await removeOwnedDirectory(directory, workRoot);
    }
    const entries = await fs.readdir(layerRoot, { withFileTypes: true });
    const folders = await Promise.all(entries.filter((entry) => entry.isDirectory() && VALID_KEY.test(entry.name)).map(async (entry) => {
      const directory = path.join(layerRoot, entry.name);
      const stats = await Promise.all([...ASSETS, 'meta.json'].map((name) => fs.stat(path.join(directory, name)).catch(() => ({ size: 0, mtimeMs: 0 }))));
      return { key: entry.name, directory, bytes: stats.reduce((sum, stat) => sum + stat.size, 0), time: Math.max(...stats.map((stat) => stat.mtimeMs)) };
    }));
    let total = folders.reduce((sum, entry) => sum + entry.bytes, 0);
    let count = folders.length;
    for (const entry of folders.sort((a, b) => a.time - b.time)) {
      if (entry.key === keep || pending.has(entry.key) || total <= 96 * 1024 * 1024 && count <= 64) continue;
      await removeOwnedDirectory(entry.directory, layerRoot); total -= entry.bytes; count--;
    }
  }
  async function build(key, url) {
    const buffer = await loadImage(url);
    let normalized;
    try {
      const image = sharp(buffer, { limitInputPixels: 24_000_000, failOnError: true });
      const meta = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format)) throw new Error('format');
      normalized = await image.rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).removeAlpha().png().toBuffer();
    } catch { throw new ParallaxError('图库图片格式或尺寸暂不支持分层', 422); }
    const [model, depthModel] = await Promise.all([getModel(root), getDepthModel(root)]);
    await fs.mkdir(workRoot, { recursive: true }); await fs.mkdir(layerRoot, { recursive: true });
    const work = await fs.mkdtemp(path.join(workRoot, 'job-'));
    activeWork.add(work);
    try {
      const input = path.join(work, 'input.png');
      await fs.writeFile(input, normalized);
      const metrics = await executeWorker({ model, depthModel, input, output: work });
      const result = await readPrepared(work, key);
      if (!result) throw new Error('分层结果不完整');
      await fs.unlink(input);
      const destination = path.resolve(layerRoot, key);
      if (!destination.startsWith(layerRoot + path.sep) || !VALID_KEY.test(key)) throw new Error('Invalid cache key');
      await removeOwnedDirectory(destination, layerRoot);
      if (!path.resolve(work).startsWith(workRoot + path.sep)) throw new Error('Invalid work path');
      await fs.rename(work, destination);
      // Only one eviction pass can inspect/delete cache directories at a time.
      maintenance = maintenance.catch(() => {}).then(() => trimCache(key));
      await maintenance.catch((error) => console.warn('[puzzle-layers/cache]', error.message));
      return { result, metrics };
    } finally {
      activeWork.delete(work);
      await removeOwnedDirectory(work, workRoot);
    }
  }

  return {
    async prepare(id) {
      if (closed) throw new ParallaxError('分层服务已关闭');
      const requestedAt = Date.now();
      const valid = typeof id === 'number' ? Number.isSafeInteger(id) && id > 0 : typeof id === 'string' && /^(?:\d{1,20}|[A-Za-z0-9-]{8,64})$/.test(id);
      if (!valid) throw new ParallaxError('无效的图库作品', 400);
      const row = await lookupImage(id);
      if (!row || !STYLES.has(row.style) || typeof row.image_url !== 'string') throw new ParallaxError('未找到可分层的图库作品', 404);
      const key = crypto.createHash('sha256').update(VERSION + row.image_url).digest('hex');
      const hit = await cached(key);
      if (hit) {
        report({ cacheHit: true, queueMs: 0, totalMs: Date.now() - requestedAt });
        return hit;
      }
      if (pending.has(key)) return pending.get(key);
      if (closed) throw new ParallaxError('分层服务已关闭');
      if (pending.size >= pendingLimit) throw new ParallaxError('分层任务较多，请稍后重试', 429);
      let task;
      const job = new Promise((resolve, reject) => {
        task = { key, url: row.image_url, enqueuedAt: Date.now(), requestedAt, resolve, reject };
      });
      const tracked = job.finally(() => pending.delete(key));
      pending.set(key, tracked);
      task.timer = setTimeout(() => {
        const index = queue.indexOf(task);
        if (index < 0) return;
        queue.splice(index, 1);
        task.reject(new ParallaxError('分层排队超时，请稍后重试', 503));
      }, queueTimeoutMs);
      queue.push(task);
      dispatch();
      return tracked;
    },
    async close() {
      closed = true;
      for (const task of queue.splice(0)) {
        clearTimeout(task.timer);
        task.reject(new ParallaxError('分层服务已关闭'));
      }
      await pool?.close();
      await Promise.all(activeJobs);
    },
    async asset(key, name) {
      if (!VALID_KEY.test(key) || !ASSETS.includes(name)) return null;
      const file = path.join(layerRoot, key, name);
      try { await fs.access(file); return file; } catch { return null; }
    },
  };
}
