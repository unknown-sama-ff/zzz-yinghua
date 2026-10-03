import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';
const m = await loadFrontend(`export * from './src/lib/yinghuaLayers'; export * from './src/lib/clipRegions'; export {renderYinghuaComposite} from './src/lib/yinghuaComposite';`);
const parts = Array.from({length: 6}, (_, i) => ({code: String(i + 1).padStart(2, '0'), stage: i < 3 ? 1 : 2, styleId: i < 3 ? 2 : 3, region: i % 3, visible: false}));
const slots = {1: {status: 'done', images: ['zero']}, 2: {status: 'done', images: ['three']}, 3: {status: 'done', images: ['yang', 'yin']}};

test('export and preview use the identical ordered visible stack and defaults', () => {
  const selected = parts.map((p) => ({...p, visible: ['01','05','06'].includes(p.code)}));
  const layers = m.buildYinghuaLayers(slots, selected, null, 'back');
  assert.deepEqual(layers.map((p) => [p.code, p.src]), [['base','zero'],['01','three'],['05','yin'],['06','yin']]);
  assert.equal(layers[1].clipPath, m.DEFAULT_CLIP_REGIONS.r0);
  assert.equal(layers[2].clipPath, m.DEFAULT_CLIP_REGIONS.r1);
});

test('dynamic clip paths and requested-face fallback match the viewer', () => {
  const selected = parts.map((p) => ({...p, visible: p.code === '04'}));
  const clips = m.computeClipRegions(.19, .3, -5);
  const layers = m.buildYinghuaLayers({...slots,3:{status: 'done',images:['yang']}},selected,clips,'back');
  assert.equal(layers[1].src, 'yang');
  assert.equal(layers[1].clipPath, clips.r0);
  assert.equal(m.buildYinghuaLayers({...slots,3:{status:'idle',images:[]}},selected,clips,'back').length,1);
});

test('polygon parser supports percentage and zero coordinates without NaN or silent omission', () => {
  assert.deepEqual(m.parseClipPolygon(m.DEFAULT_CLIP_REGIONS.r1), [{x:0,y:0},{x:1,y:0},{x:1,y:.14},{x:0,y:.28}]);
  assert.deepEqual(m.parseClipPolygon('polygon(0 -5%, 100% 12.5%, 100% 110%)'), [{x:0,y:-.05},{x:1,y:.125},{x:1,y:1.1}]);
  for (const invalid of ['polygon(0 0, 100% 10%)', 'polygon(0 0, 100% garbage, 100% 100%)', 'circle(50%)', 'polygon(0 0, 10px 0, 100% 100%)']) {
    assert.throws(() => m.parseClipPolygon(invalid));
  }
});

test('object-fit contain preserves aspect and centers mixed-resolution overlays', () => {
  assert.deepEqual(m.containedImageRect(600,400,300,600), {x:200,y:0,width:200,height:400});
  assert.deepEqual(m.containedImageRect(600,400,1200,400), {x:0,y:100,width:600,height:200});
});

function browserMocks({failDecode=false, noContext=false, corsFailure=false, nullPng=false}={}) {
  const originals = {window:globalThis.window,document:globalThis.document,Image:globalThis.Image,fetch:globalThis.fetch,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const blobs = new Map(), urls = new Map(), fetches=[], revoked=[], operations=[];
  for (const [name,width,height] of [['zero',600,400],['three',300,600],['yang',600,400],['yin',600,400]]) {
    blobs.set(name, {blob: new Blob([name],{type:'image/png'}),width,height});
  }
  globalThis.window = {location:{href:'http://localhost:5173/',origin:'http://localhost:5173'},setTimeout,clearTimeout};
  globalThis.fetch = async (src) => {
    fetches.push(src);
    if (corsFailure && src.startsWith('https://cdn.example/')) throw new Error('CORS blocked');
    const name= src.includes('proxy-image') ? 'zero' : src.split('/').pop();
    return {ok:true,blob:async()=>blobs.get(name).blob};
  };
  URL.createObjectURL = (blob) => {const url='blob:test/'+urls.size;urls.set(url,[...blobs.values()].find((b)=>b.blob===blob));return url;};
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.Image = class {
    set src(value) {
      const fixture=urls.get(value);this.naturalWidth=fixture.width;this.naturalHeight=fixture.height;
      queueMicrotask(()=>failDecode?this.onerror?.():this.onload?.());
    }
  };
  const ctx=Object.fromEntries(['fillRect','save','restore','beginPath','moveTo','lineTo','closePath','clip','drawImage'].map((name)=>[name,(...args)=>operations.push([name,...args])]));
  const canvas={width:0,height:0,getContext:()=>noContext?null:ctx,toBlob:(callback,type)=>{operations.push(['toBlob',type]);callback(nullPng?null:new Blob(['png'],{type}));}};
  globalThis.document={createElement:(tag)=>{assert.equal(tag,'canvas');return canvas;}};
  return {fetches,revoked,operations,canvas,ctx,restore:()=>{
    for(const key of ['window','document','Image','fetch']) {if(originals[key]===undefined)delete globalThis[key];else globalThis[key]=originals[key];}
    URL.createObjectURL=originals.create;URL.revokeObjectURL=originals.revoke;
  }};
}

test('PNG renderer uses native base resolution, shared clipping, contain geometry and original draw order', async () => {
  const mock=browserMocks();
  try {
    const selected=parts.map((p)=>({...p,visible:['01','02','06'].includes(p.code)}));
    const result=await m.renderYinghuaComposite(m.buildYinghuaLayers(slots,selected,null,'back'),'rgb(12, 12, 16)');
    assert.equal(result.type,'image/png');
    assert.equal(mock.canvas.width,600);assert.equal(mock.canvas.height,400);
    assert.equal(mock.ctx.fillStyle,'rgb(12, 12, 16)');
    assert.equal(mock.fetches.length,3,'two three-fate regions share one image load');
    assert.equal(mock.operations.filter(([op])=>op==='drawImage').length,4);
    assert.deepEqual(mock.operations.filter(([op])=>op==='drawImage')[1].slice(2),[200,0,200,400]);
    assert.equal(mock.operations.filter(([op])=>op==='clip').length,3);
    assert.ok(mock.operations.filter(([op])=>['moveTo','lineTo'].includes(op)).every(([,x,y])=>Number.isFinite(x)&&Number.isFinite(y)));
    assert.equal(mock.revoked.length,3);
  } finally {mock.restore();}
});

for(const failure of ['failDecode','noContext','nullPng']) {
  test(`PNG renderer reports ${failure} and releases temporary image URLs`, async()=>{
    const mock=browserMocks({[failure]:true});
    try {await assert.rejects(()=>m.renderYinghuaComposite([{code:'base',src:'zero'}],'#000'));assert.equal(mock.revoked.length,1);}finally{mock.restore();}
  });
}

test('remote CORS failure reuses the existing image proxy, never a generation endpoint',async()=>{
  const mock=browserMocks({corsFailure:true});
  try {
    await m.renderYinghuaComposite([{code:'base',src:'https://cdn.example/zero'}],'#000');
    assert.deepEqual(mock.fetches,['https://cdn.example/zero','/api/proxy-image?url=https%3A%2F%2Fcdn.example%2Fzero']);
    assert.equal(mock.revoked.length,1);
  } finally {mock.restore();}
});
