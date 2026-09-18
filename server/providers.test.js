import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
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

test('gpt-image preserves composition, canonical three-view, structure anchor, then addon order', async () => {
  const makeImage = async (background) => (await sharp({
    create: { width: 8, height: 8, channels: 3, background },
  }).png().toBuffer()).toString('base64');
  const [baseImage, threeViewImage, structureAnchorImage, addonImage] = await Promise.all([
    makeImage('#e00000'),
    makeImage('#00d000'),
    makeImage('#e0d000'),
    makeImage('#0000e0'),
  ]);
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
    for (const image of images) {
      const pixel = await sharp(Buffer.from(await image.arrayBuffer()))
        .raw()
        .toBuffer();
      received.push([...pixel.subarray(0, 3)]);
    }
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await providers['gpt-image']({
      useServerPreset: true,
      prompt: 'test',
      imageBase64: baseImage,
      imageMime: 'image/png',
      // 六命调用方 is responsible for this semantic order.
      refImages: [
        { base64: threeViewImage, mime: 'image/png' },
        { base64: structureAnchorImage, mime: 'image/png' },
        { base64: addonImage, mime: 'image/png' },
      ],
    });

    assert.equal(received.length, 4);
    assert.ok(received[0][0] > received[0][1] && received[0][0] > received[0][2]);
    assert.ok(received[1][1] > received[1][0] && received[1][1] > received[1][2]);
    assert.ok(received[2][0] > received[2][2] && received[2][1] > received[2][2]);
    assert.ok(received[3][2] > received[3][0] && received[3][2] > received[3][1]);
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

test('gpt-image preserves the requested high-fidelity edit dimension within the server limit', async () => {
  const imageBase64 = (await sharp({
    create: { width: 1800, height: 900, channels: 3, background: '#ffffff' },
  }).png().toBuffer()).toString('base64');
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GPT_IMAGE_API_KEY;
  const originalBase = process.env.GPT_IMAGE_BASE_URL;
  const originalModel = process.env.GPT_IMAGE_MODEL;
  let receivedMeta;

  process.env.GPT_IMAGE_API_KEY = 'test-key';
  process.env.GPT_IMAGE_BASE_URL = 'https://openlux.invalid/v1';
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
  globalThis.fetch = async (_url, init) => {
    const image = init.body.get('image');
    assert.ok(image);
    receivedMeta = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await providers['gpt-image']({
      useServerPreset: true,
      prompt: 'test',
      imageBase64,
      imageMime: 'image/png',
      inputImageMaxDimension: 1536,
    });

    assert.equal(receivedMeta.width, 1536);
    assert.equal(receivedMeta.height, 768);
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

test('gpt-image normalizes a precise mask to the processed primary image dimensions', async () => {
  const imageBase64 = (await sharp({
    create: { width: 1400, height: 700, channels: 3, background: '#ffffff' },
  }).png().toBuffer()).toString('base64');
  const maskBase64 = (await sharp({
    create: { width: 1400, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
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
    const image = init.body.get('image');
    const mask = init.body.get('mask');
    assert.ok(image);
    assert.ok(mask);
    const [imageMeta, maskMeta] = await Promise.all([
      sharp(Buffer.from(await image.arrayBuffer())).metadata(),
      sharp(Buffer.from(await mask.arrayBuffer())).metadata(),
    ]);
    received.push({ imageMeta, maskMeta });
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await providers['gpt-image']({
      useServerPreset: true,
      prompt: 'test',
      imageBase64,
      imageMime: 'image/png',
      maskBase64,
      maskMime: 'image/png',
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].imageMeta.width, 1024);
    assert.equal(received[0].imageMeta.height, 512);
    assert.equal(received[0].maskMeta.width, received[0].imageMeta.width);
    assert.equal(received[0].maskMeta.height, received[0].imageMeta.height);
    assert.equal(received[0].maskMeta.format, 'png');
    assert.equal(received[0].maskMeta.hasAlpha, true);
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

test('gpt-image resizes the precise mask again for the reduced-payload retry', async () => {
  const pixels = randomFillSync(Buffer.alloc(1400 * 1400 * 3));
  const imageBase64 = (await sharp(pixels, {
    raw: { width: 1400, height: 1400, channels: 3 },
  }).png().toBuffer()).toString('base64');
  const maskBase64 = (await sharp({
    create: { width: 1400, height: 1400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
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
    const image = init.body.get('image');
    const mask = init.body.get('mask');
    assert.ok(image);
    assert.ok(mask);
    const [imageMeta, maskMeta] = await Promise.all([
      sharp(Buffer.from(await image.arrayBuffer())).metadata(),
      sharp(Buffer.from(await mask.arrayBuffer())).metadata(),
    ]);
    received.push({ imageMeta, maskMeta });
    if (received.length === 1) return new Response('payload too large', { status: 400 });
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await providers['gpt-image']({
      useServerPreset: true,
      prompt: 'test',
      imageBase64,
      imageMime: 'image/png',
      maskBase64,
      maskMime: 'image/png',
    });

    assert.equal(received.length, 2);
    for (const { imageMeta, maskMeta } of received) {
      assert.equal(maskMeta.width, imageMeta.width);
      assert.equal(maskMeta.height, imageMeta.height);
      assert.equal(maskMeta.format, 'png');
      assert.equal(maskMeta.hasAlpha, true);
    }
    assert.equal(received[0].imageMeta.width, 1024);
    assert.equal(received[0].imageMeta.height, 1024);
    assert.equal(received[1].imageMeta.width, 512);
    assert.equal(received[1].imageMeta.height, 512);
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
