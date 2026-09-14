import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { maxInputImagesForGptModel } from './lib/gptImageCapabilities.js';
import { providers } from './providers.js';

test('gpt-image-2.5-sunburst accepts sixteen total image inputs', () => {
  assert.equal(maxInputImagesForGptModel('gpt-image-2.5-sunburst'), 16);
  assert.equal(maxInputImagesForGptModel('gpt-image-2'), 1);
});

test('gpt-image sends primary and references as repeated image fields', async () => {
  const imageBase64 = (await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
  }).png().toBuffer()).toString('base64');
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GPT_IMAGE_API_KEY;
  const originalBase = process.env.GPT_IMAGE_BASE_URL;
  const originalModel = process.env.GPT_IMAGE_MODEL;
  const received = [];

  process.env.GPT_IMAGE_API_KEY = 'test-key';
  process.env.GPT_IMAGE_BASE_URL = 'https://openlux.invalid/v1';
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
  globalThis.fetch = async (_url, init) => {
    const images = init.body.getAll('image');
    received.push(...images);
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await providers['gpt-image']({
      useServerPreset: true,
      prompt: 'test',
      imageBase64,
      imageMime: 'image/png',
      refImages: Array.from({ length: 15 }, () => ({ base64: imageBase64, mime: 'image/png' })),
      n: 1,
    });

    assert.equal(received.length, 16);
    assert.deepEqual(received.map((image) => image.name), Array.from({ length: 16 }, (_, index) => `image-${index}.jpg`));
    assert.deepEqual(result.images, ['data:image/png;base64,ZmFrZQ==']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GPT_IMAGE_API_KEY;
    else process.env.GPT_IMAGE_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.GPT_IMAGE_BASE_URL;
    else process.env.GPT_IMAGE_BASE_URL = originalBase;
    if (originalModel === undefined) delete process.env.GPT_IMAGE_MODEL;
    else process.env.GPT_IMAGE_MODEL = originalModel;
  }
});
