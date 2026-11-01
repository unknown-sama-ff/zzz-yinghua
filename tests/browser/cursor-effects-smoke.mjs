// Run against Vite with Edge and Playwright. Models a click-triggered main-thread pause.
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  await page.addInitScript(() => { window.__cursorPause = null; });
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  const canvas = page.locator('canvas.z-\\[10000\\]');
  await canvas.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('canvas.z-\\[10000\\]')?.width > 0);
  const settings = page.getByRole('button', { name: '设置', exact: true });
  const bounds = await settings.boundingBox();
  assert.ok(bounds, 'settings button is available for the click trigger');

  await page.mouse.move(80, 400);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const beforePixels = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.z-\\[10000\\]');
    const dpr = window.devicePixelRatio || 1;
    const image = canvas.getContext('2d').getImageData(68 * dpr, 388 * dpr, 24 * dpr, 24 * dpr);
    let visible = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 10) visible++;
    return visible;
  });
  assert.ok(beforePixels > 0, `expected the seeded cursor trail to be visible, got ${beforePixels} pixels`);

  await page.evaluate(() => {
    window.addEventListener('click', (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('button[aria-label="设置"]')) return;
      const start = performance.now();
      while (performance.now() - start < 1200) { /* simulate click work pausing RAF */ }
      window.__cursorPause = { start, end: performance.now() };
    }, { once: true });
  });
  await settings.click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const resumedPixels = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.z-\\[10000\\]');
    const dpr = window.devicePixelRatio || 1;
    const image = canvas.getContext('2d').getImageData(68 * dpr, 388 * dpr, 24 * dpr, 24 * dpr);
    let visible = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 10) visible++;
    return { pixels: visible, pauseMs: Math.round(window.__cursorPause.end - window.__cursorPause.start) };
  });
  console.log(JSON.stringify({ beforePixels, ...resumedPixels }));
  assert.ok(resumedPixels.pauseMs >= 1100, 'the click pause must exceed the cursor particle lifetime');
  assert.equal(resumedPixels.pixels, 0, 'expired trail pixels must not reappear after a click pause');
} finally {
  await browser.close();
}
