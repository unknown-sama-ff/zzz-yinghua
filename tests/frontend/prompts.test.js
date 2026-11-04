import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { YINGHUA_STYLES, fillName, splitName, THREE_VIEW_PROMPT, SIX_FATE_ANATOMY_PRIORITY_PREFIX, ZERO_FATE_ANATOMY_PRIORITY_PREFIX } = await loadFrontend("export * from './src/lib/prompts';");
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

test('three-view preserves accessory ownership, garment details and original markings across views', () => {
  assert.match(THREE_VIEW_PROMPT, /角色设计保真高于补全、对称、美化和细节丰富度/);
  assert.match(THREE_VIEW_PROMPT, /正面图为角色身份主参考/);
  assert.match(THREE_VIEW_PROMPT, /数量、形状、颜色、材质、花纹、佩戴位置、连接方式和相对身体的尺寸比例保持一致/);
  assert.match(THREE_VIEW_PROMPT, /左右以角色自身为准/);
  assert.match(THREE_VIEW_PROMPT, /不把单侧配饰镜像复制到另一侧/);
  assert.match(THREE_VIEW_PROMPT, /不改剪裁、覆盖范围、配色或材质关系/);
  assert.match(THREE_VIEW_PROMPT, /原有的文字、标记与图案属于角色设计，须保留/);
  assert.match(THREE_VIEW_PROMPT, /面部特写的发饰、耳饰、五官和颜色必须与三视图一致/);
});

test('three-view limits invented details and preserves nonhuman forms and natural occlusion', () => {
  assert.match(THREE_VIEW_PROMPT, /最小必要补全，不凭空添加装饰、花纹或服装部件/);
  assert.match(THREE_VIEW_PROMPT, /肢体类型、数量与手指数按原设定/);
  assert.match(THREE_VIEW_PROMPT, /保留鱼尾、蛇身、多足、翼鳍/);
  assert.match(THREE_VIEW_PROMPT, /不补不存在的手脚/);
  assert.match(THREE_VIEW_PROMPT, /被头发、衣物或身体遮挡的部分保持合理遮挡/);
  assert.match(THREE_VIEW_PROMPT, /不移动、复制配饰来强行露出/);
  assert.match(THREE_VIEW_PROMPT, /纯白干净背景/);
  assert.doesNotMatch(THREE_VIEW_PROMPT, /无任何遮挡|必须站立|两条腿、两只手|每手五指/);
});

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

test('foreground typography uses directional quotation marks at the lower corners', () => {
  for (const [id, , zhKey, enKey] of variants) {
    const chinese = prompt(id, zhKey);
    const english = prompt(id, enKey, 'en');
    assert.match(chinese, /左下角.*KARN”/s);
    assert.match(chinese, /右下角.*“KARN/s);
    assert.match(english, /bottom-left.*KARN”/s);
    assert.match(english, /bottom-right.*“KARN/s);
  }
});

test('zero-fate anatomy guard preserves canonical anatomy without changing the original camera design', () => {
  const zh = prompt(1, 'promptTemplate');
  const en = prompt(1, 'promptTemplateEn', 'en');
  assert.ok(zh.startsWith(ZERO_FATE_ANATOMY_PRIORITY_PREFIX));
  assert.match(zh, /肢体类型、数量、连接与手指数以原角色设定为准/);
  assert.match(zh, /仅当原设定为人形双腿时/);
  assert.match(zh, /髋—大腿—膝—小腿—踝—脚/);
  assert.match(zh, /躯干与原生肢体\/尾部连接自然/);
  assert.match(zh, /不补人腿/);
  assert.doesNotMatch(zh, /两条手臂、两条腿|每手五根|每手五指|一副完整且连续的人体结构/);
  assert.match(zh, /不得用换镜头、换姿势、拉远、改裁切或改变透视/);
  assert.match(en, /Only for a canonically two-legged humanoid/);
  assert.match(en, /hip–thigh–knee–calf–ankle–foot/);
  assert.match(en, /never add human legs/);
  assert.doesNotMatch(en, /two arms, two legs|five (?:naturally separated )?fingers per hand/);
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
    assert.match(text, /相对原设定的额外\/缺失部件、融合、穿插、断裂/);
    assert.doesNotMatch(text, /允许手脚与表情做小幅自然调整|第3张输入图.*仅用于武器/);
  }
  assert.match(prompt(3, 'promptTemplateFront'), /第1张为三命成图/);
  assert.match(prompt(3, 'promptTemplateFront'), /服装款式、配件与花纹不改/);
  assert.match(prompt(3, 'promptTemplateBack'), /第1张为已完成的六命阳全彩成图/);
  assert.match(prompt(3, 'promptTemplateBack'), /【服装精简·必须执行】/);
});

test('every tier preserves nonhuman forms and makes actions and garments conditional on anatomy', () => {
  for (const [id, , zhKey, enKey] of variants) {
    const style = YINGHUA_STYLES.find((candidate) => candidate.id === id);
    const zh = fillName(style[zhKey], 'MERMAID', undefined, false, '鱼尾自然蜷曲', '', '人鱼公主', 'zh', id);
    const en = fillName(style[enKey], 'MERMAID', undefined, false, 'curled fish tail', '', 'mermaid princess', 'en', id);
    assert.match(zh, /保留鱼尾、蛇身、多足、翼鳍、机械关节与外壳/);
    assert.match(zh, /不补不存在的手脚/);
    assert.match(zh, /动作、手势与支撑方式须适配该物种/);
    assert.match(en, /Retain fish tails, serpentine bodies, multiple legs, wings\/fins/);
    assert.match(en, /never add nonexistent hands\/feet/);
    assert.match(en, /Adapt actions, gestures and support to this species/);
    assert.doesNotMatch(zh, /角色只有两条腿|每手五指|每手五根/);
    assert.doesNotMatch(en, /exactly two legs|five (?:naturally separated )?fingers per hand/);
  }
  assert.match(prompt(3, 'promptTemplateBack'), /鱼尾、鳍、鳞片、毛发及机体结构不是衣物/);
  assert.match(prompt(3, 'promptTemplateBackEn', 'en'), /Fish tails, fins, scales, fur and mechanical structure are body parts, not garments/);
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

test('zero and both six-fate faces forbid knee/calf branching while preserving hidden limbs', () => {
  for (const [id, , zhKey, enKey] of variants.filter(([id]) => id !== 2)) {
    const zh = prompt(id, zhKey);
    const en = prompt(id, enKey, 'en');
    assert.match(zh, /每个膝盖只接一条小腿/);
    assert.match(zh, /不在大腿或膝盖处分叉出额外小腿/);
    assert.match(zh, /隐藏或出框部位保持原状/);
    assert.match(en, /Each knee connects to only one calf/);
    assert.match(en, /Never branch an additional calf/);
    assert.match(en, /Keep hidden\/off-frame parts hidden or off-frame/);
  }
});
