import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { loadFrontend } from './loadFrontend.js';
const { downloadBlob, downloadImage } = await loadFrontend("export * from './src/lib/download';");

test('GIF downloads keep their bytes and use .gif for data URLs and remote blobs', async () => {
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch,
    create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const links = [];
  let downloaded;
  globalThis.window = { open: () => assert.fail('download should not fall back') };
  globalThis.document = { createElement: () => { const link = { click() {}, remove() {} }; links.push(link); return link; }, body: { appendChild() {} } };
  globalThis.fetch = async () => new Response(Buffer.from(gif, 'base64'), { headers: { 'Content-Type': 'image/gif' } });
  URL.createObjectURL = (blob) => { downloaded = blob; return 'blob:gif'; };
  URL.revokeObjectURL = () => {};
  try {
    await downloadImage('data:image/gif;base64,' + gif, 'creation-1.png');
    assert.equal(links[0].download, 'creation-1.gif');
    assert.equal(links[0].href, 'data:image/gif;base64,' + gif);
    await downloadImage('https://cdn.invalid/result', 'creation-2.png');
    assert.equal(links[1].download, 'creation-2.gif');
    assert.equal(Buffer.from(await downloaded.arrayBuffer()).toString('base64'), gif);
  } finally {
    for (const key of ['window', 'document', 'fetch']) {
      if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key];
    }
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
  }
});

test('animated WebP downloads preserve animation bytes and use the matching extension', async () => {
  const gif = Buffer.from('R0lGODlhAgABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFBAAAACwAAAAAAgABAAACAkwKACH5BAUJAAAALAAAAAACAAEAgExpcQAA/wICTAoAOw==', 'base64');
  const webp = await sharp(gif, { animated: true }).webp({ lossless: true }).toBuffer();
  const originals = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const links = []; let downloaded;
  globalThis.window = { open: () => assert.fail('download should succeed') };
  globalThis.document = { createElement: () => { const link = { click() {}, remove() {} }; links.push(link); return link; }, body: { appendChild() {} } };
  globalThis.fetch = async () => new Response(webp, { headers: { 'Content-Type': 'image/webp' } });
  URL.createObjectURL = (blob) => { downloaded = blob; return 'blob:webp'; };
  URL.revokeObjectURL = () => {};
  try {
    const dataUrl = 'data:image/webp;base64,' + webp.toString('base64');
    await downloadImage(dataUrl, 'animation.png');
    assert.equal(links[0].download, 'animation.webp'); assert.equal(links[0].href, dataUrl);
    await downloadImage('https://cdn.invalid/optimized-animation', 'animation.png');
    assert.equal(links[1].download, 'animation.webp');
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), webp);
  } finally {
    Object.assign(globalThis, { window: originals.window, document: originals.document, fetch: originals.fetch });
    URL.createObjectURL = originals.create; URL.revokeObjectURL = originals.revoke;
  }
});

test('PNG download uses its Blob and filename, clicks and removes the link, then releases the URL', () => {
  const original={window:globalThis.window,document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const events=[];let cleanup;
  const blob=new Blob(['image'],{type:'image/png'});
  const link={click:()=>events.push('click'),remove:()=>events.push('remove')};
  globalThis.window={setTimeout:(fn,ms)=>{assert.equal(ms,60_000);cleanup=fn;}};
  globalThis.document={createElement:(tag)=>{assert.equal(tag,'a');return link;},body:{appendChild:(node)=>assert.equal(node,link)}};
  URL.createObjectURL=(value)=>{assert.equal(value,blob);return 'blob:test-png';};
  URL.revokeObjectURL=(value)=>events.push(value);
  try {
    downloadBlob(blob,'影画合成-01-05-06-六命阴.png');
    assert.equal(link.href,'blob:test-png');
    assert.equal(link.download,'影画合成-01-05-06-六命阴.png');
    assert.deepEqual(events,['click','remove']);
    cleanup();assert.deepEqual(events,['click','remove','blob:test-png']);
  } finally {
    for(const key of ['window','document']) {if(original[key]===undefined)delete globalThis[key];else globalThis[key]=original[key];}
    URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;
  }
});
