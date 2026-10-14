import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMPT_GALLERY_CATEGORIES, PromptGalleryError, validatePromptInput } from './promptGallery.js';

const valid = {
  title: '霓虹雨夜',
  prompt: 'Create a neon-lit rainy street portrait.',
  category: '场景',
  deleteToken: 'a'.repeat(48),
  files: [],
};

test('prompt input accepts fixed categories and up to three supported images', () => {
  assert.deepEqual(PROMPT_GALLERY_CATEGORIES, ['场景', '角色', '风格', '构图', '其他']);
  assert.doesNotThrow(() => validatePromptInput({ ...valid, files: Array.from({ length: 3 }, () => ({ mimetype: 'image/webp', size: 10, buffer: Buffer.from('x') })) }));
});

test('prompt input rejects missing and overlong titles or prompts', () => {
  for (const input of [
    { ...valid, title: ' ' },
    { ...valid, title: '题'.repeat(81) },
    { ...valid, prompt: ' ' },
    { ...valid, prompt: '字'.repeat(2001) },
  ]) assert.throws(() => validatePromptInput(input), PromptGalleryError);
});

test('prompt input rejects unknown categories, weak delete tokens, too many or unsupported images', () => {
  const tooMany = Array.from({ length: 4 }, () => ({ mimetype: 'image/png', size: 1, buffer: Buffer.from('x') }));
  for (const input of [
    { ...valid, category: '热门' },
    { ...valid, deleteToken: 'short' },
    { ...valid, files: tooMany },
    { ...valid, files: [{ mimetype: 'image/svg+xml', size: 1, buffer: Buffer.from('<svg/>') }] },
    { ...valid, files: [{ mimetype: 'image/png', size: 10 * 1024 * 1024 + 1, buffer: Buffer.from('x') }] },
  ]) assert.throws(() => validatePromptInput(input), PromptGalleryError);
});
