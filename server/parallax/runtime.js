import path from 'node:path';

export function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum ? Math.min(number, maximum) : fallback;
}

export function inferenceOptions() {
  return {
    executionProviders: [{ name: 'cpu', useArena: false }],
    executionMode: 'sequential',
    intraOpNumThreads: boundedInteger(process.env.PUZZLE_LAYER_THREADS, 2, 1, 2),
    interOpNumThreads: 1,
    enableMemPattern: false,
  };
}

export function resolveParallaxCacheDir(environment = process.env) {
  if (environment.PUZZLE_LAYER_CACHE_DIR) return path.resolve(environment.PUZZLE_LAYER_CACHE_DIR);
  if (environment.RAILWAY_VOLUME_MOUNT_PATH) return path.resolve(environment.RAILWAY_VOLUME_MOUNT_PATH, 'puzzle-layers');
  return path.resolve('.cache/parallax');
}
