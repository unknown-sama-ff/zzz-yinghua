import { extractPalette } from './colorExtract';
import { useUploadStore } from '../store/useUploadStore';
import type { Palette } from '../types';

/** Commit only to the exact upload revision that requested the extraction. */
export async function refreshUploadPalette(
  source: string,
  extract: (source: string) => Promise<Palette> = extractPalette,
): Promise<boolean> {
  const { uploadedImage, uploadRevision } = useUploadStore.getState();
  if (uploadedImage !== source) return false;
  const palette = await extract(source);
  return useUploadStore.getState().setPaletteForUpload(palette, uploadRevision);
}
