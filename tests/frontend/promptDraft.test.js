import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { promptDraftReplacement } = await loadFrontend(`export { promptDraftReplacement } from './src/lib/promptDraft';`);

test('prompt gallery fills an empty draft without asking to replace', () => {
  let asked = false;
  assert.equal(promptDraftReplacement('  ', 'gallery prompt', () => { asked = true; return false; }), 'gallery prompt');
  assert.equal(asked, false);
});

test('prompt gallery preserves a non-empty draft when replacement is declined', () => {
  assert.equal(promptDraftReplacement('existing draft', 'gallery prompt', () => false), null);
});

test('prompt gallery replaces a non-empty draft only after confirmation', () => {
  assert.equal(promptDraftReplacement('existing draft', 'gallery prompt', () => true), 'gallery prompt');
});
