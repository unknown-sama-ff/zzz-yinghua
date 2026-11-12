import type { CharacterReferenceContext, GenSlot } from '../types';
import { sameOriginalImages } from './characterOriginals';

export const CHARACTER_BREAKDOWN_PROMPT = `角色设定
你是一位顶尖的游戏与动漫概念美术设计大师，擅长制作详尽的角色设定图。你具备“像素级拆解”的能力，能够分析角色的穿着层级、捕捉微表情变化，并将与其相关的物品进行具象化还原。

任务目标
根据上传的原始角色参考图，生成一张“全景式角色深度概念分解图”。原图决定角色的面部、发型发色、年龄感、物种、体型、原有服装设计与配色；生成的三视图仅辅助补充侧背面信息，与原图冲突时以原图为准，不延续三视图中跑偏的衣装。中心必须包含同一角色的完整全身立绘，四周环绕展示服装分层、不同表情、核心道具、材质特写，以及有生活气息的私密与随身物品。

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

export function buildCharacterBreakdownPrompt(template: string, name: string): string {
  return buildNamedCharacterPrompt(`【拆解来源】输入按原始正面、可选原始侧背面、辅助三视图的顺序提供；单图接口按同样顺序拼合。原始参考是身份、可见衣装款式、配色与饰品的最高依据；辅助三视图仅补视角和被遮挡信息，不能覆盖原图，不把其错误衣装继续细化。\n${template}`, name);
}

/** The selected sheet owns clothing; original art owns identity; the base owns pose. */
export function withCharacterBreakdownReference(prompt: string, lang: 'zh' | 'en'): string {
  const instruction = lang === 'en'
    ? '[CHARACTER BREAKDOWN REFERENCE — CLOTHING AUTHORITY] The selected breakdown sheet is the highest authority for outfit design, garment layers, accessories, materials and garment/accessory colors. It overrides conflicting clothes in the original art or generated three-view. Original character references still own identity, face, hair, intrinsic skin/hair colors, species, physique and anatomy. Action settings and any approved base/draft own pose, camera and composition. Never copy the sheet layout, central standing pose, repeated heads, detached parts, arrows or annotations. Use the outfit shown on the central character; independent innerwear and personal-item studies do not require replacing the full outfit, adding props or extra anatomy. Preserve this stage’s background and typography; Yin applies its specified subtraction to the sheet’s outfit only.'
    : '【角色拆解图参考·衣装最高依据】选中的拆解图是服饰款式、内外层、饰品、材质以及服装/饰品固有配色的最高依据；与原图或生成三视图的衣装冲突时，以拆解图为准。原始角色参考仍决定身份、五官、发型、原生肤色/发色、物种、体型与身体结构。动作设置与已确认的底稿/底图决定动作、镜头与构图。不得照搬拆解图的排版、中心站姿、重复表情头、独立拆件、箭头或文字注释。采用中心人物的完整穿搭；独立内着与生活物件的设计展示不代表要求替换整套衣装、增加道具或身体部件。成图仍使用本阶段背景与文字；六命阴仅在拆解图确定的衣装基础上执行指定精简。';
  return `${instruction}\n${prompt}`;
}

export type YinghuaReferenceStage = 'draft' | 'zero-direct' | 'zero-render' | 'three' | 'six-front' | 'six-back';

const STAGE_DETAILS: Record<YinghuaReferenceStage, { zh: string; en: string }> = {
  draft: {
    zh: '以原始角色主参考作为第1张，之后为原始侧背面、辅助三视图、拆解图及可选道具。按动作设置设计自然稳定的动作；采用拆解图的完整衣装与配色，不沿用设定图的站姿。正常明暗全彩、无文字。',
    en: 'Input 1 is original character art, followed by original side/back views, auxiliary three-view, breakdown and optional prop. Design a stable action from the settings. Use the breakdown outfit and garment colors, not its standing pose. Normal full color and no lettering.',
  },
  'zero-direct': {
    zh: '第1张为原始角色主参考，随后为原始补充视角、辅助三视图、拆解图与道具，最后为风格样张。按动作设置创作，保留拆解图衣装层次；单色处理中用明度差表达材质，不复制其全彩、白底与设定图排版。',
    en: 'Input 1 is original character art, followed by original supplementary views, auxiliary three-view, breakdown, prop and final style samples. Follow action settings and preserve the breakdown outfit layers. Translate materials to monochrome values, not the sheet’s full colors, white background or layout.',
  },
  'zero-render': {
    zh: '第1张为已确认动作底稿，之后依次为原始角色参考、辅助三视图、拆解图、可选道具和风格样张。底稿锁定姿态、轮廓、透视、裁切及支撑关系；只把拆解图确定且底稿已有的衣装转换为深色表现，不新增轮廓或显露遮挡部件。',
    en: 'Input 1 is the approved draft, followed by original references, auxiliary three-view, breakdown, optional prop and style samples. Freeze pose, silhouette, perspective, crop and support. Convert the existing breakdown-based outfit to dark rendering only; add no contours or hidden parts.',
  },
  three: {
    zh: '第1张为零命成图，其后为原始角色参考、辅助三视图、拆解图及可选道具。只转换灰阶、指定点缀和背景；按拆解图区分皮肤、布料与护甲；点缀恢复拆解图对应服饰原色，不增加衣物或调整动作，不把全彩扩散到非点缀区域。',
    en: 'Input 1 is zero-fate, followed by original references, auxiliary three-view, breakdown and optional prop. Change only grayscale, designated accents and background. Use the sheet to distinguish skin, fabric and armor and restore garment accent colors. No added clothes, changed action or full colors in non-accent regions.',
  },
  'six-front': {
    zh: '第1张为三命成图，随后为原始角色参考、辅助三视图、可选正面结构锚点、拆解图和道具。仅还原全彩；肤色/发色遵循原图，衣装/饰品配色与材质遵循拆解图。不增加道具，不把设定图表情或动作覆盖底图。',
    en: 'Input 1 is three-fate, followed by originals, auxiliary three-view, optional front structure anchor, breakdown and prop. Restore full color only. Skin/hair colors follow original art; outfit/accessory colors and materials follow the breakdown. No added props or sheet expressions/actions copied over the base.',
  },
  'six-back': {
    zh: '第1张为六命阳成图，其后为原始角色参考、辅助三视图、可选正面结构锚点、拆解图和道具。仅在拆解图确定的衣装基础上执行本阶段指定精简，不替换整套服装；保留其内外层、饰品与配色关系，维持阳面动作、镜头、身体结构和文字。',
    en: 'Input 1 is six-fate Yang, followed by originals, auxiliary three-view, optional front structure anchor, breakdown and prop. Apply only this stage’s specified subtraction to the sheet’s outfit, never replace the set. Preserve its layer/accessory/color relationships and Yang’s action, camera, anatomy and typography.',
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
  if (!hasBreakdown) return identity + (lang === 'en'
    ? '[REFERENCE AUTHORITY] Original character references own identity, anatomy, costume and canonical colors. The generated three-view only supplements views; never propagate its design drift. If originals are unavailable, use the current character image as fallback.\n'
    : '【参考优先级】原始角色参考决定身份、身体结构、衣装与固有配色；生成三视图仅补充视角，不延续其跑偏设计。未关联原图时，以当前角色主图作为备用参考。\n') + prompt;
  const details = STAGE_DETAILS[stage][lang];
  const roles = lang === 'en' ? '[STAGE REFERENCE ROLES] ' : '【本阶段参考分工】';
  const packaging = lang === 'en'
    ? 'Single-image endpoints contain the same references as panels or thumbnails; their roles are unchanged.'
    : '单图接口中的相同参考可能合成为分区或缩略图，其用途与优先级不变。';
  return identity + withCharacterBreakdownReference(`${roles}${details}${packaging}\n${prompt}`, lang);
}

export function isCurrentCharacterResult(slot: GenSlot, context: CharacterReferenceContext): boolean {
  const previous = slot.characterContext;
  return !previous || (previous.sourceImage === context.sourceImage && sameOriginalImages(previous, context)
    && previous.breakdownImage === context.breakdownImage && previous.characterName === context.characterName);
}
