import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const MODEL_SHA256 = 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99';
const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx';
const MODEL_BYTES = 176069933;
export const DEPTH_MODEL_SHA256 = 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d';
const DEPTH_MODEL_URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx';
const DEPTH_MODEL_BYTES = 27258801;
const pending = new Map();

async function validModel(file, size, checksum) {
  try {
    if ((await fs.stat(file)).size !== size) return false;
    const hash = crypto.createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    return hash.digest('hex') === checksum;
  } catch { return false; }
}

async function ensurePinnedModel(cacheDir, { environment, name, url, size, checksum }) {
  const configured = process.env[environment];
  const file = configured ? path.resolve(configured) : path.resolve(cacheDir, 'models', name);
  const key = checksum + ':' + file;
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    if (await validModel(file, size, checksum)) return file;
    if (configured) throw new Error('分层模型文件缺失或校验失败');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + crypto.randomUUID() + '.download';
    const handle = await fs.open(temporary, 'wx');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body) throw new Error('分层模型下载失败');
      const length = response.headers.get('content-length');
      if (length && Number(length) !== size) {
        await response.body.cancel();
        throw new Error('分层模型大小异常');
      }
      let total = 0;
      for await (const bytes of response.body) {
        total += bytes.length;
        if (total > size) throw new Error('分层模型大小异常');
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
          if (!bytesWritten) throw new Error('分层模型写入失败');
          offset += bytesWritten;
        }
      }
      await handle.close();
      if (!await validModel(temporary, size, checksum)) throw new Error('分层模型校验失败');
      try {
        await fs.rename(temporary, file);
      } catch (error) {
        if (!await validModel(file, size, checksum)) throw error;
        await fs.unlink(temporary);
      }
      return file;
    } catch (error) { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); throw error; }
  })();
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}

/** Fixed publisher URLs and pinned checksums; requests cannot supply model paths or URLs. */
export function ensureParallaxModel(cacheDir) {
  return ensurePinnedModel(cacheDir, { environment: 'PUZZLE_LAYER_MODEL_PATH', name: 'isnet-anime.onnx', url: MODEL_URL, size: MODEL_BYTES, checksum: MODEL_SHA256 });
}

export function ensureParallaxDepthModel(cacheDir) {
  return ensurePinnedModel(cacheDir, { environment: 'PUZZLE_DEPTH_MODEL_PATH', name: 'depth-anything-v2-small-quantized.onnx', url: DEPTH_MODEL_URL, size: DEPTH_MODEL_BYTES, checksum: DEPTH_MODEL_SHA256 });
}
