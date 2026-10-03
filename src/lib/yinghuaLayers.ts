import { DEFAULT_CLIP_REGIONS, type ClipRegions } from './clipRegions';
import { resolveYinghuaFaceImage } from './yinghuaFace';
import type { GenSlot, LayerPart, YinghuaStyleId } from '../types';

export interface YinghuaLayer {
  code: string;
  src: string;
  clipPath?: string;
}

/** The exact ordered, visible image stack used by both preview and export. */
export function buildYinghuaLayers(
  slots: Record<YinghuaStyleId, GenSlot>,
  parts: readonly LayerPart[],
  clipRegions: ClipRegions | null,
  face: 'front' | 'back',
): YinghuaLayer[] {
  const base = slots[1].images[0];
  const layers: YinghuaLayer[] = base ? [{ code: 'base', src: base }] : [];
  const six = resolveYinghuaFaceImage(slots[3].images, face);
  const regions = clipRegions ?? DEFAULT_CLIP_REGIONS;
  const paths = [regions.r0, regions.r1, regions.r2];
  for (const part of parts) {
    if (!part.visible) continue;
    const src = part.styleId === 3 ? six?.src : slots[2].images[0];
    // The viewer does not draw a missing tier, so the exporter must not either.
    if (src) layers.push({ code: part.code, src, clipPath: paths[part.region] });
  }
  return layers;
}

export interface ClipPoint { x: number; y: number }

/** CSS percentages, including the unitless zero used by our clip polygons. */
export function parseClipPolygon(clipPath: string): ClipPoint[] {
  const polygon = /^polygon\((.+)\)$/.exec(clipPath.trim());
  if (!polygon) throw new Error('图层裁切区域无效');
  const points = polygon[1].split(',').map((point) => {
    const pair = point.trim().split(/\s+/);
    if (pair.length !== 2) throw new Error('图层裁切坐标无效');
    return { x: clipFraction(pair[0]), y: clipFraction(pair[1]) };
  });
  if (points.length < 3) throw new Error('图层裁切区域不完整');
  return points;
}

function clipFraction(coordinate: string): number {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(%?)$/.exec(coordinate);
  if (!match) throw new Error('图层裁切坐标无效');
  const value = Number(match[1]);
  if (match[2] === '%') return value / 100;
  if (value === 0) return 0;
  throw new Error('图层裁切坐标必须为百分比');
}

/** Same scaling/centering as the viewer's object-fit: contain. */
export function containedImageRect(width: number, height: number, imageWidth: number, imageHeight: number) {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}
