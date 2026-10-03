import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';
const {downloadBlob} = await loadFrontend("export {downloadBlob} from './src/lib/download';");

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
