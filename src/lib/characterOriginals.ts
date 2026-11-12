export function uniqueImages(images: (string | null | undefined)[]): string[] {
  return [...new Set(images.filter((image): image is string => Boolean(image)))];
}

export function originalImagesForSource(source: string, originalsBySource: Record<string, string[]>): string[] {
  return originalsBySource[source]?.length ? originalsBySource[source] : source ? [source] : [];
}

export function sameImages(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((image, index) => image === second[index]);
}

export function sameOriginalImages(first: { sourceImage: string; originalImages?: string[] }, second: { sourceImage: string; originalImages?: string[] }): boolean {
  return sameImages(first.originalImages ?? [first.sourceImage], second.originalImages ?? [second.sourceImage]);
}
