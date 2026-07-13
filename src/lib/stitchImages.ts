/**
 * Stitch an array of image data URLs into a single horizontally-tiled PNG.
 * Null/undefined entries are skipped.
 *
 * Implementation moved to imageWorkerPool.ts (runs OffscreenCanvas in a Worker).
 * This file re-exports the same API so existing import paths stay valid.
 */

export { stitchImages, embedThumbnail } from './imageWorkerPool';
