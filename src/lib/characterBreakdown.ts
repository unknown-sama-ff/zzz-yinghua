import type { CharacterReferenceContext, GenSlot } from '../types';

export const CHARACTER_BREAKDOWN_PROMPT = `角色设定
你是一位顶尖的游戏与动漫概念美术设计大师，擅长制作详尽的角色设定图。你具备“像素级拆解”的能力，能够分析角色的穿着层级、捕捉微表情变化，并将与其相关的物品进行具象化还原。

任务目标
根据上传的角色三视图，生成一张“全景式角色深度概念分解图”。中心必须包含同一角色的完整全身立绘，四周环绕展示服装分层、不同表情、核心道具、材质特写，以及有生活气息的私密与随身物品。保持三视图中角色的面部、发型发色、年龄感、物种、体型、原有服装设计与配色一致。

视觉规范
1. 构图布局：中心放置穿着完整原衣装的角色全身立绘，作为视觉锚点；周围留白有序排列拆解元素。使用清晰的手绘箭头或引导线，将部件与角色对应部位或所属区域连接起来。
2. 服装分层：将服装拆分为单品展示，多层穿搭需展示去掉外套后的内层状态。私密内着作为独立服装单品平铺展示，突出设计感、剪裁与材质，不改变中心人物的完整着装。
3. 表情集：在角落绘制3—4个不同情绪的头部特写，保持同一角色的身份特征。
4. 材质特写：选择1—2个关键部位放大展示；补充小物件的材质、纹理、金属、织物等质感特写。
5. 关联物品与生活切片：展示核心道具、日常通勤包或手拿包及打开后的内容物、常用美妆护理组合，以及符合角色性格与年龄设定的生活物件，例如私密日记本、常用药物或补剂盒；成年角色可按设定补充电子烟或其他更私人的生活物件。根据角色设定合理设计，不要求每种物品都出现，不把物品重复画成人体部件。
6. 风格与注释：保持高质量2D插画或概念设计手稿风格，线条干净利落，透视准确、光影统一。使用纯白色背景。每个拆解元素旁用简短、清晰可读的中文手写注释说明名称、材质、层次或品牌/型号暗示；文字放在外围，引线明确，不遮挡角色轮廓和关节。

执行逻辑
先分析角色核心特征、穿着风格和潜在性格，再提取外套、鞋子、表情等一级元素；合理设计内层衣物与包中物品等二级元素。原图已有的设计必须保留，推测的生活物品仅作补充设计，不取代角色原设定。最终只输出一张完整组合图，所有注释使用中文，背景为白色。`;

export function requireCharacterName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('请先填写角色名字');
  return trimmed;
}

export function buildNamedCharacterPrompt(template: string, name: string): string {
  return `【角色身份】角色名字：${requireCharacterName(name)}。所有视图、表情与拆解元素均属于这个角色，严格以提供的角色图片为视觉依据。\n${template}`;
}

/** A detail sheet never owns the pose, costume choice or final typography. */
export function withCharacterBreakdownReference(prompt: string, lang: 'zh' | 'en'): string {
  const instruction = lang === 'en'
    ? '[CHARACTER BREAKDOWN REFERENCE] The additional character breakdown sheet supplies garment layers, connections, materials and accessory details only. The canonical character image remains the authority for identity, original costume, colors and anatomy. Action settings and any approved base/draft own pose, camera and composition. Never copy the breakdown layout, central pose, repeated expression heads, detached parts, arrows or annotations into the result. Innerwear and imagined personal items on the sheet are supplementary design notes, not instructions to change the outfit or add props. Preserve the requested final background and typography.'
    : '【角色拆解图参考】额外提供的角色拆解图仅补充衣装层次、部件连接、材质与饰品细节；原角色三视图仍是身份、原衣装、固有配色与原生身体结构的权威。动作设置与已确认的底稿/底图决定动作、镜头与构图。不得照搬拆解图的排版、中心站姿、重复表情头、独立拆件、箭头或文字注释。图中的内着和推测的私人物件仅作补充设计，不代表要求换装、增加道具或增加身体部件；成图仍使用本阶段指定的背景与文字。';
  return `${instruction}\n${prompt}`;
}

export type YinghuaReferenceStage = 'draft' | 'zero-direct' | 'zero-render' | 'three' | 'six-front' | 'six-back';

const STAGE_DETAILS: Record<YinghuaReferenceStage, { zh: string; en: string }> = {
  draft: {
    zh: '第1张为角色三视图，随后是拆解图，再后为可选道具参考。仅用拆解图理解完整衣装的内外层和连接；按动作设置重新设计自然稳定的动作，不沿用拆解图中心人物的站姿。正常全彩、完整衣装、无文字。',
    en: 'Input 1 is the character three-view, followed by the breakdown sheet, then any prop reference. Use the sheet to understand complete garment layers and connections. Design a stable action from the action settings, never copy the sheet’s central standing pose. Use normal full color, complete clothing and no lettering.',
  },
  'zero-direct': {
    zh: '第1张为角色三视图，随后是拆解图与可选道具，最后为风格样张。按动作设置创作，保留原衣装层次；单色深色处理通过明度差表达拆解图的材质细节，不复制其全彩配色、白色背景和设定图排版。',
    en: 'Input 1 is the character three-view, followed by the breakdown, optional prop and final style samples. Follow action settings and preserve original garment layers. Translate material details into monochrome value differences; never copy the sheet’s full-color rendering, white background or layout.',
  },
  'zero-render': {
    zh: '第1张为已确认动作底稿，第2张为角色三视图，第3张为拆解图，之后为可选道具和风格样张。底稿完全锁定姿态、轮廓、透视、裁切和支撑关系；拆解图只帮助在深色处理中保留既有衣装细节，不新增轮廓、重画动作或显露被遮挡部件。',
    en: 'Input 1 is the approved action draft, input 2 the character three-view and input 3 the breakdown, followed by optional props and style samples. Freeze the draft’s pose, silhouette, perspective, crop and support. Use the sheet only to preserve existing clothing details in dark rendering, never add contours, redesign the action or expose hidden parts.',
  },
  three: {
    zh: '第1张为零命成图，第2张为角色三视图，第3张为拆解图，之后可有道具。只转换灰阶、指定点缀和背景；拆解图用于区分皮肤、布料与护甲，不据此补画新衣物或调整动作，禁止把其全彩颜色扩散到非点缀区域。',
    en: 'Input 1 is zero-fate, input 2 the character three-view and input 3 the breakdown, followed by any prop. Change only grayscale, designated accents and background. Use the sheet to distinguish skin, fabric and armor, never add garments or change the action, and never spread its full colors into non-accent regions.',
  },
  'six-front': {
    zh: '第1张为三命成图，第2张为角色三视图；之后可含正面结构锚点、拆解图与道具。仅还原全彩，三视图决定固有色，拆解图辅助核对材质、内外层与饰品连接，不换装、不增加道具，不将拆解图的表情或动作覆盖底图。',
    en: 'Input 1 is three-fate and input 2 the character three-view, followed by any front structure anchor, breakdown and prop. Restore full color only. The three-view owns canonical colors; the sheet checks materials, layers and accessory connections. No outfit or prop changes and no expression or action copied from the sheet.',
  },
  'six-back': {
    zh: '第1张为六命阳成图，第2张为角色三视图；之后可含正面结构锚点、拆解图与道具。仅执行本阶段指定的原服装精简；拆解图帮助辨认真实内外层，已知内层遵循原设定，推测的内着不强制采用，不替换整套服装；保持阳面动作、镜头、身体结构和文字。',
    en: 'Input 1 is six-fate Yang and input 2 the character three-view, followed by any front structure anchor, breakdown and prop. Apply only this stage’s specified subtraction from the original outfit. Use the sheet to distinguish actual garment layers; preserve known inner layers and never force imagined underwear or replace the outfit. Freeze Yang’s action, camera, anatomy and typography.',
  },
};

export function buildYinghuaReferencePrompt(prompt: string, options: {
  stage: YinghuaReferenceStage; name: string; lang: 'zh' | 'en'; hasBreakdown: boolean;
}): string {
  const { lang, stage, hasBreakdown } = options;
  const name = options.name.trim();
  const identity = name ? (lang === 'en'
    ? `[CHARACTER IDENTITY] Character name: ${name}. This identifies the character, not an instruction to add lettering.\n`
    : `【角色身份】角色名字：${name}。此处仅确认角色身份，不代表要求在画面添加文字。\n`) : '';
  if (!hasBreakdown) return identity + prompt;
  const details = STAGE_DETAILS[stage][lang];
  const roles = lang === 'en' ? '[STAGE REFERENCE ROLES] ' : '【本阶段参考分工】';
  const packaging = lang === 'en'
    ? 'Single-image endpoints contain the same references as panels or thumbnails; their roles are unchanged.'
    : '单图接口中的相同参考可能合成为分区或缩略图，其用途与优先级不变。';
  return identity + withCharacterBreakdownReference(`${roles}${details}${packaging}\n${prompt}`, lang);
}

export function isCurrentCharacterResult(slot: GenSlot, context: CharacterReferenceContext): boolean {
  const previous = slot.characterContext;
  return !previous || (previous.sourceImage === context.sourceImage
    && previous.breakdownImage === context.breakdownImage && previous.characterName === context.characterName);
}
