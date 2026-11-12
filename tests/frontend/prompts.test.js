import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { YINGHUA_STYLES, fillName, splitName, buildZeroFateDraftPrompt, buildZeroFateRenderPrompt, SIX_FATE_ANATOMY_PRIORITY_PREFIX, ZERO_FATE_ANATOMY_PRIORITY_PREFIX } = await loadFrontend("export * from './src/lib/prompts';");
const variants = [
  [1, '零命', 'promptTemplate', 'promptTemplateEn'],
  [2, '三命', 'promptTemplate', 'promptTemplateEn'],
  [3, '六命阳', 'promptTemplateFront', 'promptTemplateFrontEn'],
  [3, '六命阴', 'promptTemplateBack', 'promptTemplateBackEn'],
];
function prompt(id, key, lang = 'zh', showText = true, hasBreakdown = false) {
  const style = YINGHUA_STYLES.find((candidate) => candidate.id === id);
  return fillName(style[key], 'HAMAN KARN', undefined, showText, '侧躺', '半睁眼', '沉着', lang, id, hasBreakdown);
}

for (const lang of ['zh', 'en']) {
  test(`all yinghua stages/${lang} use the selected breakdown for clothing without a conflicting three-view authority`, () => {
    const options = { name: 'HERO', showText: true, characterDynamic: '侧躺', microDynamic: '微笑', characterTraits: '', lang, hasBreakdown: true };
    const texts = [buildZeroFateDraftPrompt(options), buildZeroFateRenderPrompt(options),
      ...variants.map(([id, , zh, en]) => prompt(id, lang === 'zh' ? zh : en, lang, true, true))];
    for (const text of texts) {
      assert.match(text, lang === 'zh' ? /选中的角色拆解图/ : /the selected character breakdown sheet/);
      assert.doesNotMatch(text, /\{[A-Z_]+\}/);
      assert.doesNotMatch(text, /原衣装唯一权威|衣装\/花纹\/配饰结构严格按三视图|服装、花纹和配饰100%匹配第2张|Input 1.*sole costume authority|garments.*input 2.*100%/);
    }
    assert.match(texts[0], lang === 'zh' ? /衣装与服饰配色以选中的角色拆解图为准/ : /garment colors as defined by the selected character breakdown sheet/);
    assert.match(prompt(2, lang === 'zh' ? 'promptTemplate' : 'promptTemplateEn', lang, true, true),
      lang === 'zh' ? /衣装\/花纹\/配饰结构严格按选中的角色拆解图保留/ : /structures from the selected character breakdown sheet/);
  });
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

test('zero-fate retains the original composition defaults when action settings are empty', () => {
  const original = '人物构图须有强烈设计感与视觉冲击力——优先采用大仰视、大俯视、极端斜侧等非常规视角，严禁正面平视、证件照式大头、对称站像。角色动作必须是低重心姿态：侧躺、蜷缩、趴卧、瘫坐、倚靠等，身体大面积接触支撑面，避免站立式pose。整体为卸防感的非战斗姿态，放松、慵懒、毫无戒备。同时融入微动态细节——打哈欠、wink、半睁眼、比耶、拉领带、抱玩偶等，制造"时间切片"般的生动瞬间感。允许头顶、肩部、手臂、发尾大幅出框，人物大面积裁切，肢体延展至画面边缘，形成破框而出的开放感。构图偏左或偏右，避免居中；角色主体和文字共占画面约80%~85%；动作设计具有艺术感、展现角色个性特点；画风与第1张主图保持角色设计一致。';
  assert.ok(fillName(YINGHUA_STYLES[0].promptTemplate, 'HAMAN KARN').includes(original));
  assert.match(prompt(1, 'promptTemplateEn', 'en'), /prioritize dramatic low-angle, high-angle, and extreme diagonal perspectives/);
  assert.match(prompt(1, 'promptTemplateEn', 'en'), /Crop aggressively with limbs extending to frame borders/);
});

for (const lang of ['zh', 'en']) {
  for (const mode of ['draft', 'direct']) {
    test(`zero-fate ${mode}/${lang} replaces pose and micro-action defaults independently in the composition`, () => {
      const pose = lang === 'zh' ? '单脚站立，另一腿向后抬起' : 'standing on one foot with the other leg raised behind';
      const micro = lang === 'zh' ? '闭眼微笑，右手挥手' : 'smiling with closed eyes and waving the right hand';
      for (const [characterDynamic, microDynamic] of [[pose, micro], [pose, ''], ['', micro], ['  ', '  ']]) {
        const text = mode === 'draft'
          ? buildZeroFateDraftPrompt({ name: 'HERO', showText: true, characterDynamic, microDynamic, characterTraits: '沉着', lang })
          : fillName(YINGHUA_STYLES[0][lang === 'zh' ? 'promptTemplate' : 'promptTemplateEn'],
            'HERO', undefined, true, characterDynamic, microDynamic, '沉着', lang, 1);
        if (characterDynamic.trim()) {
          assert.ok(text.includes(lang === 'zh' ? `角色动作：${pose}。` : `The character's pose: ${pose}.`));
          assert.equal(text.split(pose).length - 1, 1);
          assert.doesNotMatch(text, /低重心姿态|避免站立式pose|low-center-of-gravity posture|Avoid standing poses/);
        } else {
          assert.match(text, lang === 'zh' ? /低重心姿态：侧躺、蜷缩、趴卧、瘫坐、倚靠/ : /low-center-of-gravity posture: lying on side, curled up/);
        }
        if (microDynamic.trim()) {
          assert.ok(text.includes(lang === 'zh' ? `同时融入微动态细节——${micro}，制造` : `Incorporate micro-dynamic details: ${micro} — creating`));
          assert.equal(text.split(micro).length - 1, 1);
          assert.doesNotMatch(text, /打哈欠|wink|抱玩偶|yawning|hugging a plushie/);
        } else {
          assert.match(text, lang === 'zh' ? /打哈欠、wink、半睁眼、比耶、拉领带、抱玩偶等/ : /yawning, winking, half-closed eyes, peace sign, pulling a tie, hugging a plushie/);
        }
        assert.match(text, lang === 'zh' ? /大仰视、大俯视、极端斜侧/ : /dramatic low-angle, high-angle, and extreme diagonal/);
        assert.match(text, lang === 'zh' ? /允许头顶、肩部、手臂、发尾大幅出框/ : /Crop aggressively with limbs extending to frame borders/);
        assert.match(text, lang === 'zh' ? /构图偏左或偏右/ : /Offset composition left or right/);
        assert.match(text, /80%[~-]85%/);
        assert.match(text, /沉着/);
        assert.doesNotMatch(text, /\{[A-Z_]+\}/);
      }
    });
  }
}

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
  assert.match(prompt(2, 'promptTemplate'), /只有原始角色参考明确有袜装才保留/);
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
