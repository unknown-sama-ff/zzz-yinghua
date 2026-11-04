// Against a production build: inject the same missing-dynamic-module failure as production.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('node_modules/.cache/puzzle-build');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const rewrites = config.rewrites.map((rule) => new RegExp('^' + rule.source + '$'));
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try { const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(bytes); }
  catch {
    if (rewrites.some((rule) => rule.test(pathname))) res.writeHead(200, { 'Content-Type': 'text/html' }).end(await readFile(resolve(root, 'index.html')));
    else res.writeHead(404).end('Not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
try {
  for (const feature of ['puzzle', 'gallery']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    let blocked = 0; let documents = 0; let blockGallery = true;
    await context.route('**/*', (route) => {
      const request = route.request(); const url = new URL(request.url());
      if (request.isNavigationRequest()) documents++;
      if (url.pathname.includes('/api/')) return route.fulfill({ json: { ok: true, rows: [], hasMore: false, sponsors: [] } });
      if (url.origin !== base) return route.abort();
      if (/\/assets\/PuzzlePanel-.*\.js$/.test(url.pathname) || feature === 'gallery' && blockGallery && /\/assets\/GalleryPanel-.*\.js$/.test(url.pathname)) { blocked++; return route.abort('failed'); }
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(base + '/#/' + feature, { waitUntil: 'domcontentloaded' });
    if (feature === 'puzzle') {
      try { await page.locator('.puzzle-toolbar').waitFor({ timeout: 4000 }); }
      catch (error) { console.log('Captured exact failure:', await page.locator('.studio-page[aria-label="美图拼图"]').innerText()); throw error; }
      assert.equal(blocked, 0, 'puzzle does not depend on a late-loading hashed chunk');
      assert.equal(documents, 1, 'does not automatically refresh and lose active tasks');
      console.log('PASS production puzzle loads with detached chunk requests blocked');
    } else {
      await page.getByText('页面资源暂时无法加载', { exact: true }).waitFor();
      assert.equal(documents, 1);
      await page.getByText(/等待生图结束/).waitFor();
      blockGallery = false;
      await page.getByRole('button', { name: '刷新页面加载最新版', exact: true }).click();
      await page.getByRole('button', { name: '刷新画廊', exact: true }).waitFor();
      assert.equal(documents, 2, 'only the explicit recovery button refreshes the page');
      console.log('PASS failed lazy module offers an explicit, working refresh recovery');
    }
    await context.close();
  }
  const missing = await fetch(base + '/assets/nonexistent-module.js');
  assert.equal(missing.status, 404, 'missing scripts must not return SPA HTML');
  assert.equal((await fetch(base + '/a-spa-route')).status, 200);
  console.log('PASS assets return 404 while SPA fallback remains available');
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
