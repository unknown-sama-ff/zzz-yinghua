// Run against Vite. Uses the real component with controlled input/RAF timing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});

try {
  for (const deviceScaleFactor of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      let now = 1000;
      let nextId = 0;
      const frames = new Map();
      const inputs = [];
      Object.defineProperty(performance, 'now', { value: () => now });
      Math.random = () => 0.5;
      window.requestAnimationFrame = (callback) => { frames.set(++nextId, callback); return nextId; };
      window.cancelAnimationFrame = (id) => frames.delete(id);
      window.__cursorClock = {
        setTime: (time) => { now = time; },
        frame: (time, timestamp = time) => {
          now = time;
          const pending = [...frames.values()];
          frames.clear();
          pending.forEach((callback) => callback(timestamp));
        },
        pending: () => frames.size,
        queue: (type, x, y) => {
          const event = type === 'touchmove'
            ? new TouchEvent(type, { touches: [new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y })] })
            : type === 'click'
            ? new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
            : new PointerEvent(type, { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true });
          Object.defineProperty(event, 'timeStamp', { value: now });
          inputs.push(event);
        },
        deliver: () => { inputs.splice(0).forEach((event) => window.dispatchEvent(event)); },
        move: (x, y) => {
          window.__cursorClock.queue('pointermove', x, y);
          window.__cursorClock.deliver();
        },
        leave: () => document.dispatchEvent(new MouseEvent('mouseleave')),
        pixels: (x, y) => {
          const canvas = document.querySelector('canvas');
          const image = canvas.getContext('2d').getImageData((x - 12) * devicePixelRatio, (y - 12) * devicePixelRatio, 24 * devicePixelRatio, 24 * devicePixelRatio);
          let visible = 0;
          for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 10) visible++;
          return visible;
        },
      };
    });
    await page.goto(`${base}/tests/browser/cursor-effects.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cursorTest && document.querySelector('canvas')?.width === innerWidth * devicePixelRatio);
    // Allow the component's one debounced initial resize to settle.
    await page.waitForTimeout(250);

    const pausedFrame = await page.evaluate(() => {
      const clock = window.__cursorClock;
      clock.frame(1000);
      clock.setTime(1010);
      clock.move(100, 100);
      clock.leave();
      clock.frame(1020);
      const seeded = clock.pixels(100, 100);
      // Long click work can run before a RAF whose timestamp was already set.
      clock.setTime(2300);
      clock.move(300, 100);
      clock.queue('click', 300, 300);
      clock.deliver();
      clock.leave();
      clock.frame(2310, 1030);
      return { seeded, expired: clock.pixels(100, 100), fresh: clock.pixels(300, 100) };
    });
    assert.ok(pausedFrame.seeded > 0, 'the original trail must be drawn before the pause');
    assert.equal(pausedFrame.expired, 0, 'expired trails must disappear on the FIRST resumed frame, even with a stale RAF timestamp');
    assert.ok(pausedFrame.fresh > 0, 'fresh trails must survive the first resumed frame');

    const queuedFrame = await page.evaluate(() => {
      const clock = window.__cursorClock;
      clock.setTime(2400);
      clock.queue('pointermove', 100, 400);
      clock.queue('click', 300, 400);
      clock.queue('touchmove', 700, 400);
      // Input captured during the pause is already too old when delivered.
      clock.setTime(4000);
      clock.deliver();
      clock.move(500, 100);
      clock.leave();
      clock.frame(4010);
      return { staleTrail: clock.pixels(100, 400), staleRipple: clock.pixels(300, 400), staleTouch: clock.pixels(700, 400), fresh: clock.pixels(500, 100) };
    });
    assert.equal(queuedFrame.staleTrail, 0, 'delayed input must not replay old trails as a fresh burst');
    assert.equal(queuedFrame.staleRipple, 0, 'delayed clicks must not replay old ripples');
    assert.equal(queuedFrame.staleTouch, 0, 'delayed touch input must not replay old trails');
    assert.ok(queuedFrame.fresh > 0, 'current input must still render after delayed input');

    const settled = await page.evaluate(() => {
      const clock = window.__cursorClock;
      clock.frame(5000);
      return { pixels: clock.pixels(500, 100), pending: clock.pending() };
    });
    assert.equal(settled.pixels, 0, 'trails must expire by their real lifetime');
    assert.equal(settled.pending, 0, 'the renderer must stop requesting frames when idle');

    await page.evaluate(() => window.__cursorTest.setEnabled(false));
    await page.waitForFunction(() => document.querySelector('canvas')?.style.display === 'none');
    const disabled = await page.evaluate(() => {
      const clock = window.__cursorClock;
      clock.setTime(5010);
      clock.move(100, 500);
      clock.frame(5020);
      return clock.pixels(100, 500);
    });
    assert.equal(disabled, 0, 'disabling effects must suppress new particles');
    await page.evaluate(() => window.__cursorTest.setEnabled(true));
    await page.waitForFunction(() => document.querySelector('canvas')?.style.display !== 'none');
    const reenabled = await page.evaluate(() => {
      const clock = window.__cursorClock;
      clock.setTime(5030);
      clock.move(100, 500);
      clock.leave();
      clock.frame(5040);
      return clock.pixels(100, 500);
    });
    assert.ok(reenabled > 0, 'reenabling effects must resume drawing');

    await page.evaluate(() => window.__cursorTest.setWorkspaceOpen(true));
    await page.waitForFunction(() => document.querySelector('canvas')?.style.display === 'none');
    const workspace = await page.evaluate(() => {
      const clock = window.__cursorClock;
      clock.setTime(5050);
      clock.move(300, 500);
      clock.frame(5060);
      return { previous: clock.pixels(100, 500), suppressed: clock.pixels(300, 500) };
    });
    assert.deepEqual(workspace, { previous: 0, suppressed: 0 }, 'the painting workspace must clear and suppress cursor effects');
    await page.evaluate(() => window.__cursorTest.setWorkspaceOpen(false));
    await page.waitForFunction(() => document.querySelector('canvas')?.style.display !== 'none');

    await page.evaluate(() => window.__cursorTest.setReduced(true));
    await page.waitForFunction(() => !document.querySelector('canvas'));
    await page.evaluate(() => window.__cursorClock.frame(5070));
    await page.evaluate(() => window.__cursorTest.setReduced(false));
    await page.waitForFunction(() => document.querySelector('canvas')?.width === innerWidth * devicePixelRatio);
    const motionRestored = await page.evaluate(() => {
      const clock = window.__cursorClock;
      clock.setTime(5080);
      clock.move(500, 500);
      clock.leave();
      clock.frame(5090);
      return clock.pixels(500, 500);
    });
    assert.ok(motionRestored > 0, 'turning reduced motion off must bind drawing to the new canvas');

    const blurred = await page.evaluate(() => {
      const clock = window.__cursorClock;
      window.dispatchEvent(new Event('blur'));
      clock.frame(5100);
      return clock.pixels(500, 500);
    });
    assert.equal(blurred, 0, 'focus loss must discard the current trail');

    const touch = await page.evaluate(() => {
      const clock = window.__cursorClock;
      clock.setTime(5110);
      clock.queue('touchmove', 700, 100);
      clock.deliver();
      clock.leave();
      clock.frame(5120);
      const visible = clock.pixels(700, 100);
      clock.frame(6000);
      return { visible, expired: clock.pixels(700, 100), pending: clock.pending() };
    });
    assert.ok(touch.visible > 0, 'fresh touch trails must render');
    assert.equal(touch.expired, 0, 'touch trails must expire by their own shorter lifetime');
    assert.equal(touch.pending, 0, 'touch trails must also stop scheduling when idle');
    assert.deepEqual(errors, [], 'canvas rendering must not throw');
    console.log(JSON.stringify({ deviceScaleFactor, pausedFrame, queuedFrame, settled }));
    await page.close();
  }

  // Also verify the same first-frame boundary with real browser clocks/RAF.
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/tests/browser/cursor-effects.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cursorTest && document.querySelector('canvas')?.width === innerWidth);
  await page.evaluate(() => {
    const pixels = (x, y) => {
      const canvas = document.querySelector('canvas');
      const image = canvas.getContext('2d').getImageData(x - 12, y - 12, 24, 24);
      let visible = 0;
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 10) visible++;
      return visible;
    };
    window.__cursorRealPixels = pixels;
    const trigger = document.createElement('button');
    trigger.textContent = 'Pause cursor test';
    trigger.style.cssText = 'position:fixed;left:780px;top:600px';
    trigger.addEventListener('click', () => {
      const delayedMove = new PointerEvent('pointermove', { clientX: 100, clientY: 100, pointerType: 'mouse' });
      const start = performance.now();
      while (performance.now() - start < 1200) { /* actual click work */ }
      window.dispatchEvent(delayedMove);
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 100, pointerType: 'mouse' }));
      document.dispatchEvent(new MouseEvent('mouseleave'));
      // Capture inside the FIRST resumed RAF, before a later frame can hide a failure.
      requestAnimationFrame(() => {
        window.__cursorRealFrame = { pauseMs: performance.now() - start, expired: pixels(100, 100), fresh: pixels(300, 100) };
      });
    }, { once: true });
    document.body.appendChild(trigger);
  });
  await page.getByRole('button', { name: 'Pause cursor test', exact: true }).click();
  await page.waitForFunction(() => window.__cursorRealFrame);
  const realFrame = await page.evaluate(() => window.__cursorRealFrame);
  assert.ok(realFrame.pauseMs >= 1200, 'the actual click must block longer than the particle lifetime');
  assert.equal(realFrame.expired, 0, 'real delayed input must not appear on the first resumed frame');
  assert.ok(realFrame.fresh > 0, 'real fresh input must render on the first resumed frame');
  await page.waitForFunction(() => window.__cursorRealPixels(300, 100) === 0);
  assert.deepEqual(errors, [], 'real click pauses must not break the animation loop');
  console.log(JSON.stringify({ realFrame }));
  await page.close();
} finally {
  await browser.close();
}
