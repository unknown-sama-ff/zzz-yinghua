const MAX_INPUT_IMAGES_BY_MODEL = new Map([
  ['gpt-image-2.5-sunburst', 16],
]);

export function maxInputImagesForGptModel(model) {
  return MAX_INPUT_IMAGES_BY_MODEL.get(String(model || '').trim().toLowerCase()) ?? 1;
}
