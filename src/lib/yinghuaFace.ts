export type YinghuaFace = 'front' | 'back';

export interface ResolvedYinghuaFaceImage {
  src: string;
  index: 0 | 1;
  face: YinghuaFace;
}

export function resolveYinghuaFaceImage(
  images: readonly string[],
  requestedFace: YinghuaFace,
): ResolvedYinghuaFaceImage | undefined {
  const requestedIndex = requestedFace === 'front' ? 0 : 1;
  const fallbackIndex = requestedIndex === 0 ? 1 : 0;
  const index = images[requestedIndex] ? requestedIndex : images[fallbackIndex] ? fallbackIndex : undefined;

  if (index === undefined) return undefined;

  return {
    src: images[index],
    index,
    face: index === 0 ? 'front' : 'back',
  };
}
