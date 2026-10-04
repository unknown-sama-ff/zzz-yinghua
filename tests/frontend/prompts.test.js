import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { YINGHUA_STYLES, fillName, splitName, SIX_FATE_ANATOMY_PRIORITY_PREFIX, ZERO_FATE_ANATOMY_PRIORITY_PREFIX } = await loadFrontend("export * from './src/lib/prompts';");
const variants = [
  [1, '零命', 'promptTemplate', 'promptTemplateEn'],
  [2, '三命', 'promptTemplate', 'promptTemplateEn'],
  [3, '六命阳', 'promptTemplateFront', 'promptTemplateFrontEn'],
  [3, '六命阴', 'promptTemplateBack', 'promptTemplateBackEn'],
];
function prompt(id, key, lang = 'zh', showText = true) {
  const style = YINGHUA_STYLES.find((candidate) => candidate.id === id);
  return fillName(style[key], 'HAMAN KARN', undefined, showText, '侧躺', '半睁眼', '沉着', lang, id);
}

for (const [id, label, zh, en] of variants) {
  for (const [key, lang] of [[zh, 'zh'], [en, 'en']]) {
    test(`${label}/${lang} substitutes every name, palette and style marker`, () => {
      const text = prompt(id, key, lang);
      assert.doesNotMatch(text, /\{[A-Z_]+\}/);
      assert.match(text, /HAMAN/);
      assert.match(text, /KARN/);
      if (id !== 2) {
        assert.match(text, /侧躺/);
        assert.match(text, /半睁眼/);
      } else {
        assert.doesNotMatch(text, /侧躺|半睁眼/); // 三命 is color-only.
      }
      assert.match(text, /沉着/);
      assert.equal(text.match(lang === 'zh' ? /【角色保真】/g : /\[IDENTITY\]/g)?.length, 1);
    });
    test(`${label}/${lang} text-off removes conflicting positive typography instructions`, () => {
      const text = prompt(id, key, lang, false);
      assert.doesNotMatch(text, /HAMAN|KARN|\{[A-Z_]+\}/);
      assert.match(text, lang === 'zh' ? /【文字关闭】/ : /\[TYPOGRAPHY OFF\]/);
      assert.doesNotMatch(text, /【文字】|\[TYPOGRAPHY\]/);
    });
  }
}

test('zero-fate original Chinese view, pose, crop, occupancy and alignment requirements are unchanged', () => {
  const original = '人物构图须有强烈设计感与视觉冲击力——优先采用大仰视、大俯视、极端斜侧等非常规视角，严禁正面平视、证件照式大头、对称站像。角色动作必须是低重心姿态：侧躺、蜷缩、趴卧、瘫坐、倚靠等，身体大面积接触支撑面，避免站立式pose。整体为卸防感的非战斗姿态，放松、慵懒、毫无戒备。同时融入微动态细节——打哈欠、wink、半睁眼、比耶、拉领带、抱玩偶等，制造"时间切片"般的生动瞬间感。允许头顶、肩部、手臂、发尾大幅出框，人物大面积裁切，肢体延展至画面边缘，形成破框而出的开放感。构图偏左或偏右，避免居中；角色主体和文字共占画面约80%~85%；动作设计具有艺术感、展现角色个性特点；画风与第1张主图保持角色设计一致。';
  assert.ok(prompt(1, 'promptTemplate').includes(original));
  assert.match(prompt(1, 'promptTemplateEn', 'en'), /prioritize dramatic low-angle, high-angle, and extreme diagonal perspectives/);
  assert.match(prompt(1, 'promptTemplateEn', 'en'), /Crop aggressively with limbs extending to frame borders/);
});

test('zero-fate anatomy guard protects waist and legs without changing the original camera design', () => {
  const zh = prompt(1, 'promptTemplate');
  const en = prompt(1, 'promptTemplateEn', 'en');
  assert.ok(zh.startsWith(ZERO_FATE_ANATOMY_PRIORITY_PREFIX));
  assert.match(zh, /两条腿、两只手、每手五根/);
  assert.match(zh, /髋—大腿—膝—小腿—踝—脚/);
  assert.match(zh, /腰部与骨盆连接自然/);
  assert.match(zh, /第三条腿、重复膝盖、腿部粘连/);
  assert.match(zh, /不得用换镜头、换姿势、拉远、改裁切或改变透视/);
  assert.match(en, /TWO legs|two legs/i);
  assert.match(en, /hip–thigh–knee–calf–ankle–foot/);
  assert.match(en, /third leg|duplicate knees/i);
  assert.match(en, /never change the camera, pose, framing or perspective/);
  assert.ok(prompt(2, 'promptTemplate').startsWith('【角色保真】'));
  assert.ok(prompt(3, 'promptTemplateFront').startsWith(SIX_FATE_ANATOMY_PRIORITY_PREFIX));
});

test('three-fate remains color-only, with canonical legwear and original language-specific accent boost', () => {
  assert.match(prompt(2, 'promptTemplate'), /禁止移动、缩放、旋转、裁切/);
  assert.match(prompt(2, 'promptTemplate'), /R=G=B/);
  assert.match(prompt(2, 'promptTemplate'), /额外提亮30%/);
  assert.match(prompt(2, 'promptTemplateEn', 'en'), /plus 10% brightness/);
  assert.match(prompt(2, 'promptTemplate'), /只有三视图明确有袜装才保留/);
  assert.doesNotMatch(prompt(2, 'promptTemplate'), /第1张后续图.*附加/);
});

test('both six-fate faces prioritize original perspective, correct hidden legs without forcing them into frame', () => {
  for (const key of ['promptTemplateFront', 'promptTemplateBack']) {
    const text = prompt(3, key);
    assert.ok(text.startsWith(SIX_FATE_ANATOMY_PRIORITY_PREFIX));
    assert.match(text, /保留原有近大远小、透视缩短及前后遮挡/);
    assert.match(text, /髋—大腿—膝—小腿—踝—脚/);
    assert.match(text, /画外\/遮挡部位不强行补全入画/);
    assert.match(text, /重复膝盖、融合、穿插、断裂/);
    assert.doesNotMatch(text, /允许手脚与表情做小幅自然调整|第3张输入图.*仅用于武器/);
  }
  assert.match(prompt(3, 'promptTemplateFront'), /第1张为三命成图/);
  assert.match(prompt(3, 'promptTemplateFront'), /服装款式、配件与花纹不改/);
  assert.match(prompt(3, 'promptTemplateBack'), /第1张为已完成的六命阳全彩成图/);
  assert.match(prompt(3, 'promptTemplateBack'), /【服装精简·必须执行】/);
});

test('all four prompts are materially shorter than their previous production sizes', () => {
  // Conservative ceilings below the old Chinese runtime prompts (~3.2k/2.5k/2.4k/3.4k).
  assert.ok(prompt(1, 'promptTemplate').length < 2300);
  assert.ok(prompt(2, 'promptTemplate').length < 1750);
  assert.ok(prompt(3, 'promptTemplateFront').length < 1650);
  assert.ok(prompt(3, 'promptTemplateBack').length < 2250);
});

test('splitName retains the single-name and compound-name layout', () => {
  assert.deepEqual(splitName('CORIN'), ['CORIN', 'CORIN']);
  assert.deepEqual(splitName('HAMAN KARN'), ['HAMAN', 'KARN']);
});
