import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const MODEL_SHA256 = 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99';
const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx';
const MODEL_BYTES = 176069933;
let pending;

async function validModel(file) {
  try {
    if ((await fs.stat(file)).size !== MODEL_BYTES) return false;
    const hash = crypto.createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    return hash.digest('hex') === MODEL_SHA256;
  } catch { return false; }
}

/** Fixed publisher URL and pinned checksum; requests cannot supply model paths or URLs. */
export async function ensureParallaxModel(cacheDir) {
  if (pending) return pending;
  pending = (async () => {
    const configured = process.env.PUZZLE_LAYER_MODEL_PATH;
    const file = configured ? path.resolve(configured) : path.join(cacheDir, 'models', 'isnet-anime.onnx');
    if (await validModel(file)) return file;
    if (configured) throw new Error('分层模型文件缺失或校验失败');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + process.pid + '.download';
    const handle = await fs.open(temporary, 'w');
    try {
      const response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body) throw new Error('分层模型下载失败');
      let total = 0;
      for await (const bytes of response.body) {
        total += bytes.length;
        if (total > MODEL_BYTES) throw new Error('分层模型大小异常');
        let offset = 0;
        while (offset < bytes.length) { const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset); offset += bytesWritten; }
      }
      await handle.close();
      if (!await validModel(temporary)) throw new Error('分层模型校验失败');
      await fs.rename(temporary, file);
      return file;
    } catch (error) { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); throw error; }
  })();
  try { return await pending; } catch (error) { pending = null; throw error; }
}
