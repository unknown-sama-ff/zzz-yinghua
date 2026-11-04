import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { maxInputImagesForGptModel } from './lib/gptImageCapabilities.js';
import { providers, registerTaskStore } from './providers.js';

test('upstream error bodies and signed image URLs never appear in generation logs', async (t) => {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
  const previous = { ...process.env };
  Object.assign(process.env, { GPT_IMAGE_API_KEY: 'private-provider-credential', GPT_IMAGE_BASE_URL: 'https://provider.invalid/v1', GPT_IMAGE_MODEL: 'gpt-image-2' });
  t.after(() => {
    for (const name of ['GPT_IMAGE_API_KEY', 'GPT_IMAGE_BASE_URL', 'GPT_IMAGE_MODEL']) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  });
  const messages = [];
  t.mock.method(console, 'log', (...args) => messages.push(args.join(' ')));
  t.mock.method(console, 'warn', (...args) => messages.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('/images/edits')
    ? new Response(JSON.stringify({ error: { message: 'private-provider-credential signed-fixture-token' } }), { status: 400 })
    : new Response(image, { headers: { 'Content-Type': 'image/png' } }));
  await assert.rejects(() => providers['gpt-image']({ useServerPreset: true, prompt: 'test', imageBase64: 'https://8.8.8.8/private-art?signature=signed-fixture-token' }), error => error.status === 400);
  assert.match(messages.join('\n'), /edits failed status=400/);
  assert.doesNotMatch(messages.join('\n'), /private-provider-credential|signed-fixture-token|private-art/);
});

test('identical upstream task IDs have independent unpredictable local task IDs', async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, { SEEDREAM_API_KEY: 'fixture-key', SEEDREAM_BASE_URL: 'https://provider.invalid/v1' });
  t.after(() => {
    registerTaskStore(null);
    for (const name of ['SEEDREAM_API_KEY', 'SEEDREAM_BASE_URL']) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  });
  const completed = [];
  const polls = [];
  registerTaskStore({ onDone: (id, images) => completed.push({ id, images }) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (url) => {
    const polling = String(url).includes('/tasks/');
    if (polling) polls.push(String(url));
    return new Response(JSON.stringify(polling ? { status: 'succeeded', images: ['fixture-image'] } : { task_id: '1/shared' }));
  });
  const first = await providers.seedream({ useServerPreset: true, prompt: 'first' });
  const second = await providers.seedream({ useServerPreset: true, prompt: 'second' });
  assert.match(first.taskId, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.taskId, second.taskId);
  assert.notEqual(first.taskId, '1/shared');
  t.mock.timers.tick(2000);
  for (let i = 0; i < 100 && completed.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(completed.map(result => result.id).sort(), [first.taskId, second.taskId].sort());
  assert.deepEqual(polls, ['https://provider.invalid/v1/tasks/1%2Fshared', 'https://provider.invalid/v1/tasks/1%2Fshared']);
});

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

test('gpt-image denoise mode keeps a resized PNG input lossless', async () => {
  const imageBase64 = (await sharp({
    create: { width: 1800, height: 900, channels: 3, background: '#ffffff' },
  }).png().toBuffer()).toString('base64');
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GPT_IMAGE_API_KEY;
  const originalBase = process.env.GPT_IMAGE_BASE_URL;
  const originalModel = process.env.GPT_IMAGE_MODEL;
  let received;

  process.env.GPT_IMAGE_API_KEY = 'test-key';
  process.env.GPT_IMAGE_BASE_URL = 'https://openlux.invalid/v1';
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
  globalThis.fetch = async (_url, init) => {
    const image = init.body.get('image');
    received = {
      name: image.name,
      metadata: await sharp(Buffer.from(await image.arrayBuffer())).metadata(),
    };
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await providers['gpt-image']({
      useServerPreset: true,
      prompt: 'clean three-view sheet',
      imageBase64,
      imageMime: 'image/png',
      inputImageMaxDimension: 1536,
      preserveInputQuality: true,
    });
    assert.equal(received.name, 'image-0.png');
    assert.equal(received.metadata.format, 'png');
    assert.equal(received.metadata.width, 1536);
    assert.equal(received.metadata.height, 768);
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
    if (received.length === 1) return new Response(JSON.stringify({ error: { message: 'payload too large', safety_violations: [] } }), { status: 400 });
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

test('gpt-image preserves a safety rejection and never resizes or retries the rejected image', async () => {
  const pixels = randomFillSync(Buffer.alloc(1200 * 1200 * 3));
  const imageBase64 = (await sharp(pixels, { raw: { width: 1200, height: 1200, channels: 3 } }).png().toBuffer()).toString('base64');
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(['GPT_IMAGE_API_KEY', 'GPT_IMAGE_BASE_URL', 'GPT_IMAGE_MODEL'].map((key) => [key, process.env[key]]));
  process.env.GPT_IMAGE_API_KEY = 'test-key';
  process.env.GPT_IMAGE_BASE_URL = 'https://openlux.invalid/v1';
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'Your request was rejected by the safety system. safety_violations=[sexual].', request_id: 'req-local-safety-test' } }), { status: 400 });
  };
  try {
    await assert.rejects(providers['gpt-image']({
      useServerPreset: true,
      prompt: 'a fully clothed game character action study', imageBase64, imageMime: 'image/png',
    }), (error) => {
      assert.equal(error.code, 'CONTENT_REJECTED');
      assert.match(error.message, /内容审核/);
      assert.match(error.message, /sexual/);
      assert.match(error.message, /req-local-safety-test/);
      return true;
    });
    assert.equal(calls, 1, 'a safety rejection must not trigger reduced-image resubmission');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('gpt-image preserves precise-mask alpha semantics for the upstream edit', async () => {
  const width = 4;
  const height = 4;
  const sourcePixels = Buffer.alloc(width * height * 3, 255);
  const sourceImage = (await sharp(sourcePixels, {
    raw: { width, height, channels: 3 },
  }).png().toBuffer()).toString('base64');
  // This is the exact convention emitted by CanvasEditor: selected pixels are
  // transparent, while everything outside the selection remains opaque.
  const maskPixels = Buffer.alloc(width * height * 4, 0);
  for (let i = 3; i < maskPixels.length; i += 4) maskPixels[i] = 255;
  const selectedOffset = (1 * width + 2) * 4 + 3;
  maskPixels[selectedOffset] = 0;
  const maskBase64 = (await sharp(maskPixels, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer()).toString('base64');
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GPT_IMAGE_API_KEY;
  const originalBase = process.env.GPT_IMAGE_BASE_URL;
  const originalModel = process.env.GPT_IMAGE_MODEL;
  let upstreamMask;

  process.env.GPT_IMAGE_API_KEY = 'test-key';
  process.env.GPT_IMAGE_BASE_URL = 'https://openlux.invalid/v1';
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
  globalThis.fetch = async (_url, init) => {
    const mask = init.body.get('mask');
    assert.ok(mask);
    upstreamMask = await sharp(Buffer.from(await mask.arrayBuffer()))
      .ensureAlpha()
      .raw()
      .toBuffer();
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await providers['gpt-image']({
      useServerPreset: true,
      prompt: 'edit only the selected pixel',
      imageBase64: sourceImage,
      imageMime: 'image/png',
      maskBase64,
      maskMime: 'image/png',
    });

    assert.equal(upstreamMask[selectedOffset], 0, 'the brushed selection must remain transparent');
    assert.equal(upstreamMask[3], 255, 'unselected pixels must remain opaque');
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
test('denoise avoids another JPEG encode when resizing reference images', async (t) => {
  const source = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#aaccee' } }).jpeg().toBuffer();
  const originalFetch = globalThis.fetch;
  let received;
  globalThis.fetch = async (_url, init) => {
    received = await Promise.all(init.body.getAll('image').map(async (image) => ({
      name: image.name,
      meta: await sharp(Buffer.from(await image.arrayBuffer())).metadata(),
    })));
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await providers['gpt-image']({
    prompt: 'preserve details', apiKey: 'test-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2',
    imageBase64: source.toString('base64'), imageMime: 'image/jpeg',
    refImages: [{ base64: source.toString('base64'), mime: 'image/jpeg' }],
    inputImageMaxDimension: 1536, preserveInputQuality: true,
  });
  assert.equal(received.length, 2);
  for (const [index, image] of received.entries()) {
    assert.equal(image.meta.format, 'png', 'input ' + index + ' keeps resized pixels lossless');
    assert.equal(image.name, 'image-' + index + '.png');
    assert.equal(image.meta.width, 1536);
    assert.equal(image.meta.height, 768);
  }
});
