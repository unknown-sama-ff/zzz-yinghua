import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { createLayerImages } from './pixels.js';

const [modelPath, inputPath, outputDir] = process.argv.slice(2);
process.on('disconnect', () => process.exit(1));
let session;
const started = Date.now();
try {
  const image = await fs.readFile(inputPath);
  const input = await sharp(image).removeAlpha().resize(1024, 1024, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const size = 1024 * 1024;
  const values = new Float32Array(size * 3);
  let max = 1;
  for (const value of input) max = Math.max(max, value);
  const mean = [0.485, 0.456, 0.406];
  for (let i = 0; i < size; i++) for (let c = 0; c < 3; c++) values[c * size + i] = input[i * 3 + c] / max - mean[c];
  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: [{ name: 'cpu', useArena: false }], executionMode: 'sequential',
    intraOpNumThreads: Math.min(2, Math.max(1, Number(process.env.PUZZLE_LAYER_THREADS) || 1)), interOpNumThreads: 1, enableMemPattern: false,
  });
  const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', values, [1, 3, 1024, 1024]) });
  const prediction = results[session.outputNames[0]].data;
  let min = Infinity; max = -Infinity;
  for (const value of prediction) { min = Math.min(min, value); max = Math.max(max, value); }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 0.00001) throw new Error('未识别到可分层的主体');
  const mask = Buffer.alloc(size);
  for (let i = 0; i < size; i++) mask[i] = Math.round((prediction[i] - min) / (max - min) * 255);
  await session.release(); session = null;
  const layers = await createLayerImages(image, mask, 1024, 1024);
  await fs.writeFile(path.join(outputDir, 'foreground.webp'), layers.foreground);
  await fs.writeFile(path.join(outputDir, 'background.webp'), layers.background);
  await fs.writeFile(path.join(outputDir, 'meta.json'), JSON.stringify({ width: layers.width, height: layers.height, coverage: layers.coverage, processingMs: Date.now() - started, peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024) }));
  process.exit(0);
} catch (error) {
  console.error('[puzzle-layers/worker]', error.message);
  if (session) await session.release().catch(() => {});
  process.exit(1);
}
