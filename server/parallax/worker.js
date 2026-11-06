import fs from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { createLayerImages, needsSubjectChecks } from './pixels.js';
import { prepareModelInput, cropPrediction, MODEL_SIZE } from './input.js';
import { inferRelativeDepth } from './depth.js';
import { inferenceOptions } from './runtime.js';

const [modelPath, depthModelPath, inputPath, outputDir] = process.argv.slice(2);
process.on('disconnect', () => process.exit(1));
const sessions = new Map();
let busy = false;

async function processImage(input, output) {
  const started = Date.now();
  const cpuStarted = process.cpuUsage();
  const warm = sessions.size === 2;
  let modelLoadMs = 0;
  async function getSession(file) {
    if (!sessions.has(file)) {
      const loading = Date.now();
      sessions.set(file, await ort.InferenceSession.create(file, inferenceOptions()));
      modelLoadMs += Date.now() - loading;
    }
    return sessions.get(file);
  }
  const image = await fs.readFile(input);
  const segmentationStarted = Date.now();
  const segment = async (options) => {
    const layout = await prepareModelInput(image, options);
    const session = await getSession(modelPath);
    const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', layout.values, [1, 3, MODEL_SIZE, MODEL_SIZE]) });
    return { mask: cropPrediction(results[session.outputNames[0]].data, layout), width: layout.width, height: layout.height };
  };
  const segmentation = await segment();
  const subjectChecks = [];
  let subjectCheckFailed = false;
  if (needsSubjectChecks(segmentation.mask, segmentation.width, segmentation.height)) {
    try {
      for (const options of [{ flip: true }, { centered: true }]) subjectChecks.push((await segment(options)).mask);
    } catch {
      // A supplementary check must not discard a valid primary character mask.
      subjectChecks.length = 0;
      subjectCheckFailed = true;
    }
  }
  const segmentationMs = Date.now() - segmentationStarted;
  const depthStarted = Date.now();
  const depth = await inferRelativeDepth(image, depthModelPath, await getSession(depthModelPath));
  const depthMs = Date.now() - depthStarted;
  const layersStarted = Date.now();
  const layers = await createLayerImages(image, segmentation.mask, segmentation.width, segmentation.height, { depth, subjectChecks });
  await Promise.all([
    fs.writeFile(path.join(output, 'foreground.webp'), layers.foreground),
    fs.writeFile(path.join(output, 'subject.webp'), layers.subject),
    fs.writeFile(path.join(output, 'background.webp'), layers.background),
  ]);
  const cpu = process.cpuUsage(cpuStarted);
  const metrics = {
    processingMs: Date.now() - started, modelLoadMs, segmentationMs, depthMs,
    subjectCheckCount: subjectChecks.length, subjectCheckFailed,
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    layersMs: Date.now() - layersStarted,
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    // maxRSS covers this worker's lifetime, including previous images.
    peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    threads: inferenceOptions().intraOpNumThreads, workerPid: process.pid, warm,
  };
  await fs.writeFile(path.join(output, 'meta.json'), JSON.stringify({
    width: layers.width, height: layers.height, coverage: layers.coverage, hasForeground: layers.hasForeground, ...metrics,
  }));
  return metrics;
}

// Keep the original four-argument entry point usable for local model checks.
if (inputPath && outputDir) {
  try {
    await processImage(inputPath, outputDir);
    await Promise.all([...sessions.values()].map((session) => session.release()));
    process.exit(0);
  } catch (error) {
    console.error('[puzzle-layers/worker]', error.message);
    process.exit(1);
  }
} else {
  process.on('message', async (message) => {
    if (busy || !Number.isSafeInteger(message?.id) || typeof message.input !== 'string' || typeof message.output !== 'string') {
      process.exit(1);
    }
    busy = true;
    try {
      const metrics = await processImage(message.input, message.output);
      busy = false;
      process.send({ id: message.id, ok: true, metrics });
    } catch (error) {
      process.send({ id: message.id, ok: false, error: error.message }, () => process.exit(1));
    }
  });
}
