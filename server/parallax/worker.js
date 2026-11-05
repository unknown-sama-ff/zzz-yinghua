import fs from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { createLayerImages } from './pixels.js';
import { prepareModelInput, cropPrediction, MODEL_SIZE } from './input.js';

const [modelPath, inputPath, outputDir] = process.argv.slice(2);
process.on('disconnect', () => process.exit(1));
let session;
const started = Date.now();
try {
  const image = await fs.readFile(inputPath);
  const layout = await prepareModelInput(image);
  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: [{ name: 'cpu', useArena: false }], executionMode: 'sequential',
    intraOpNumThreads: Math.min(2, Math.max(1, Number(process.env.PUZZLE_LAYER_THREADS) || 1)), interOpNumThreads: 1, enableMemPattern: false,
  });
  const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', layout.values, [1, 3, MODEL_SIZE, MODEL_SIZE]) });
  const prediction = results[session.outputNames[0]].data;
  const mask = cropPrediction(prediction, layout);
  await session.release(); session = null;
  const layers = await createLayerImages(image, mask, layout.width, layout.height);
  await fs.writeFile(path.join(outputDir, 'foreground.webp'), layers.foreground);
  await fs.writeFile(path.join(outputDir, 'subject.webp'), layers.subject);
  await fs.writeFile(path.join(outputDir, 'background.webp'), layers.background);
  await fs.writeFile(path.join(outputDir, 'meta.json'), JSON.stringify({ width: layers.width, height: layers.height, coverage: layers.coverage, hasForeground: layers.hasForeground, processingMs: Date.now() - started, peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024) }));
  process.exit(0);
} catch (error) {
  console.error('[puzzle-layers/worker]', error.message);
  if (session) await session.release().catch(() => {});
  process.exit(1);
}
