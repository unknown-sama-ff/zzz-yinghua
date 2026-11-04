import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
const baseline = process.env.CANVAS_BASELINE === '1';
// Pin the before-state so this comparison remains meaningful after committing.
const baselineRef = process.env.CANVAS_BASELINE_REF || 'daf93306adcfec3cb5ff2d10f3b1e19b8f3e06e3';
const originals = new Map(baseline ? ['src/components/InpaintWorkspace/CanvasEditor.tsx', 'src/store/useInpaintStore.ts'].map((path) => [path, execFileSync('git', ['show', `${baselineRef}:${path}`], { encoding: 'utf8' })]) : []);
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CanvasEditor} from '/src/components/InpaintWorkspace/CanvasEditor.tsx';
import {useInpaintStore as store} from '/src/store/useInpaintStore.ts';
window.store=store; window.calls={encode:0,readPixels:0,readBytes:0};
const encode=HTMLCanvasElement.prototype.toDataURL; HTMLCanvasElement.prototype.toDataURL=function(...a){window.calls.encode++;return encode.apply(this,a)};
const read=CanvasRenderingContext2D.prototype.getImageData; CanvasRenderingContext2D.prototype.getImageData=function(...a){window.calls.readPixels++;window.calls.readBytes+=a[2]*a[3]*4;return read.apply(this,a)};
const source=document.createElement('canvas');source.width=2048;source.height=2048;source.getContext('2d').fillRect(0,0,2048,2048); const url=source.toDataURL();
store.getState().openWorkspace({type:'free',url});store.getState().setMode('precise');store.getState().setFeatherRadius(0);
createRoot(document.getElementById('test')).render(React.createElement(CanvasEditor,{onMaskChange:d=>store.getState().setMaskDataUrl(d),onMaskEmpty:()=>store.getState().setMaskDataUrl(null)}));
`;
const entryId = '/__mask-test-entry.js';
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'mask-test', enforce: 'pre',
  resolveId(id) { if (id === entryId) return '\0mask-test-entry.js'; },
  load(id) {
    if (id === '\0mask-test-entry.js') return entry;
    for (const [path, source] of originals) if (id.replaceAll('\\', '/').endsWith('/' + path)) return source;
  },
  configureServer(server) {
    server.middlewares.use('/__mask-test', async (_req, res, next) => {
      if (_req.originalUrl !== '/__mask-test') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml('/__mask-test', `<html><head><style>body{margin:0}.hidden{display:none}</style></head><body><div id="test"></div><script type="module" src="${entryId}"></script></body></html>`));
    });
  },
}] });
await server.listen();
const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const page=await browser.newPage({viewport:{width:900,height:800}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
await page.goto(server.resolvedUrls.local[0]+'__mask-test');await page.waitForFunction(()=>document.querySelector('canvas')?.width===2048 && window.__inpaintCanvas);
const canvas=page.locator('canvas').first();
await canvas.evaluate(el=>{el.style.width='600px';el.style.height='600px'});
await page.evaluate(()=>{window.calls={encode:0,readPixels:0,readBytes:0}});
const point={x:180,y:180};const box=await canvas.boundingBox();
const stroke=async(x=point.x,y=point.y)=>{await page.mouse.move(box.x+x,box.y+y);await page.mouse.down();await page.mouse.move(box.x+x+35,box.y+y+25,{steps:4});await page.mouse.up();};
const start=performance.now();await stroke();await stroke(300,300);await stroke(420,420);const elapsed=performance.now()-start;
await page.waitForTimeout(100);const calls=await page.evaluate(()=>window.calls);console.log(JSON.stringify({phase:baseline?'baseline':'optimized',size:2048,strokes:3,elapsedMs:Math.round(elapsed),...calls}));
if(baseline){assert.ok(calls.encode>=6);assert.ok(calls.readBytes>2048*2048*4);}
else {assert.equal(calls.encode,0,'strokes must not encode PNGs');assert.ok(calls.readBytes<4*1024*1024,'small strokes read patches, not full frames');}
if (!baseline) {
  const settled = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = () => page.evaluate(() => window.store.getState().hasMask);
  const maskAt = (x, y) => page.evaluate(async ({ x, y }) => {
    const url = window.__inpaintCanvas.exportMask();
    const image = new Image(); image.src = url; await image.decode();
    const target = document.createElement('canvas'); target.width = image.width; target.height = image.height;
    const ctx = target.getContext('2d'); ctx.drawImage(image, 0, 0);
    return ctx.getImageData(Math.floor(x / 600 * image.width), Math.floor(y / 600 * image.height), 1, 1).data[3];
  }, { x, y });
  assert.equal(await state(), true);
  assert.equal(await maskAt(180, 180), 0, 'selected region exports transparent alpha');
  assert.equal(await maskAt(50, 50), 255, 'unselected region stays opaque');
  await page.evaluate(() => { window.calls={encode:0,readPixels:0,readBytes:0}; window.store.getState().setPrompt('typing'); }); await settled();
  assert.deepEqual(await page.evaluate(() => window.calls), { encode:0,readPixels:0,readBytes:0 }, 'prompt edits do not redraw or serialize the mask');
  await page.evaluate(() => { for (let i=0;i<3;i++) window.__inpaintCanvas.undo(); }); await settled();
  assert.equal(await state(), false, 'undo reaches the empty canvas without PNG decoding');

  await stroke();
  await page.evaluate(() => { window.store.getState().setTool('eraser'); window.store.getState().setBrushSize(80); }); await settled();
  await stroke(); assert.equal(await state(), false, 'erasing the only stroke clears hasMask');
  await page.evaluate(() => window.__inpaintCanvas.undo()); await settled(); assert.equal(await state(), true, 'undo restores an erased stroke');
  // The same URL can belong to a different version or a fresh editing session.
  await page.evaluate(() => window.store.getState().appendVersion(window.store.getState().currentVersionUrl, 'same image'));
  await settled(); assert.equal(await state(), false); assert.equal(await maskAt(180,180), 255);
  await page.evaluate(() => { window.__inpaintCanvas.undo(); window.store.getState().setTool('shape'); window.store.getState().setShapeType('rect'); }); await settled();
  assert.equal(await state(), false, 'old undo patches cannot cross version boundaries');
  const freshBox=await canvas.boundingBox();
  await page.mouse.move(freshBox.x+100,freshBox.y+100);await page.mouse.down();await page.mouse.move(freshBox.x+200,freshBox.y+180);await page.mouse.up();
  assert.equal(await maskAt(150,140), 0);assert.equal(await maskAt(50,50),255);
  // Import an encoded mask, then edit/erase it; clearing the import string must
  // not clear the live canvas or its undo patches.
  await page.evaluate(() => window.store.getState().setMaskDataUrl(window.__inpaintCanvas.exportMask())); await settled();
  assert.equal(await state(), true);
  await page.evaluate(() => { window.store.getState().setTool('eraser');window.store.getState().setBrushSize(80); });await settled();
  await stroke(150,140);await page.evaluate(() => window.__inpaintCanvas.undo());await settled();
  assert.equal(await maskAt(150,140),0,'imported mask remains undoable after internal edits');
  await page.evaluate(() => window.store.getState().clearMask()); await settled();assert.equal(await state(),false);assert.equal(await maskAt(150,140),255);
  await page.evaluate(() => { const url=window.store.getState().currentVersionUrl;window.store.getState().openWorkspace({type:'free',url});window.store.getState().setMode('precise'); });
  await settled();assert.equal(await state(),false);assert.equal(await maskAt(150,140),255);
  for (const shape of ['circle','ellipse']) {
    await page.evaluate((shape) => { window.store.getState().setTool('shape');window.store.getState().setShapeType(shape); }, shape);await settled();
    const bounds=await canvas.boundingBox();await page.mouse.move(bounds.x+100,bounds.y+100);await page.mouse.down();await page.mouse.move(bounds.x+200,bounds.y+160);await page.mouse.up();
    assert.equal(await maskAt(150,130),0);
    assert.equal(await maskAt(150,85),shape==='circle'?0:255);
    await page.evaluate(()=>window.__inpaintCanvas.undo());await settled();assert.equal(await state(),false);assert.equal(await maskAt(150,85),255);
  }
  console.log('PASS mask orientation, no work on typing, undo/erase, external mask imports, same-URL versions/session reset, shapes and clear');
}
assert.deepEqual(errors,[]);
} catch(error) { console.error('Browser errors:', errors); throw error; }
finally{await browser.close();await server.close();}
