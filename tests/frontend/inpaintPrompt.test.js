import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';
const { buildContextualEditPrompt } = await loadFrontend("export * from './src/lib/inpaintPrompt';");

for (const instruction of [
  '删除左下方多余的腿，保留左上方和底部中间的腿。',
  'Remove the extra lower-left leg; preserve the upper-left and bottom-center leg chains.',
]) {
  test(`leg repair preserves the requested branch selection: ${instruction}`, () => {
    const prompt = buildContextualEditPrompt(instruction, 'precise');
    assert.ok(prompt.endsWith(instruction));
    assert.match(prompt, /每个膝盖只接一条小腿/);
    assert.match(prompt, /用户明确指定保留的分支不得删除或替换/);
    assert.match(prompt, /删除多余分支及其脚踝、鞋袜，恢复其后方背景或支撑面/);
    assert.match(prompt, /不要擅自改成删除其他位置的脚/);
    assert.match(prompt, /蒙版外的内容必须保持不变/);
  });
}

test('ordinary edits do not introduce leg-reconstruction instructions', () => {
  const instruction = '只把发夹改成蓝色，其余保持不变。';
  const prompt = buildContextualEditPrompt(instruction, 'smart');
  assert.ok(prompt.endsWith(instruction));
  assert.doesNotMatch(prompt, /多余腿局部修复|双腿连接校验/);
});
