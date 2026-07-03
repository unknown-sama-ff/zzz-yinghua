import type { Palette, YinghuaStyle } from '../types';

/**
 * Landscape output size for yinghua art. 1536x1024 = 3:2 ratio.
 */
export const YINGHUA_SIZE = '1536x1024';

/**
 * Fidelity prefix — prepended to every yinghua style prompt so the model treats
 * the uploaded art as the character reference and keeps identity intact while
 * stylizing. Surfaced (and editable) in the UI as part of each prompt.
 */
export const FIDELITY_PREFIX =
  '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；主角色图与原始立绘是唯一角色身份参考，额外样张仅作为绝区零影画的整体构图方向、色彩关系与角落文字排版参考；严禁复制样张中的人物脸、发型、耳朵、服饰、配件、姿势或任何具体角色设计，严禁生成样张中的名字、编号、条码、logo、贴纸、标签、图标、网点纸、胶带、扫描线、做旧污渍或任何杂乱装饰元素，如与主角色冲突一律以主角色身份、服饰与面部为准；如果参考图中包含额外道具/武器/装饰元素，仅将其作为可加入角色动作设计的附加元素参考；不得改变角色身份、发型、面部和主体服饰风格；若角色不是人类，请将“肌肤展现”理解为“主体结构与代表性特征的更多展露”，例如机械结构、金属表面、关节、毛发、尾部、耳部、翅膀或外露部件，而不是强行套用人类身体逻辑；画面必须为横向构图（landscape，宽大于高，3:2 横幅），不需要展示角色全身，突出角色特点与个性，但角色腰部以上必须完整呈现于画面中；角色做出动作后人物应当撑满画面90%以上；三张影画（零命/三命/六命）必须与原三视图的角色美术风格完全一致，不可改变画风；最终画面只保留角色主体与正常比例英文名字文字，不要任何额外贴纸、徽标、条码、说明字、小标签或背景装饰。在此前提下进行如下风格化：';

/**
 * Three-view + close-up generation prompt.
 */
export const THREE_VIEW_PROMPT = `根据角色图片特点补全三视图，生成图中角色三视图并且整合到一张图中，所有视图必须与上传图片中的角色严格一致——面部、发型发色、服装与配色完全统一无改动，结构准确，无任何遮挡，统一光影，统一画风，纯白色干净背景，无多余杂物、无水印文字，细节拉满，高精度，不要文字，不要背景。同时生成角色面部特写放在图右侧。`;

/**
 * Costume-change three-view prompt.
 */
export const COSTUME_CHANGE_PROMPT = `请将角色身上的服装修改为[青春感白丝JK装]，不改变装饰和整体人物风格，按照原图生成三视图，细节拉满，高精度，不要文字，不要背景，生成角色面部特写放在图右。`;

/**
 * Split a character name into top/bottom halves for the yinghua layout.
 * "XING YUN" → ["XING", "YUN"]; single word → same word for both.
 */
export function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return [parts[0], parts[0]];
  return [parts[0], parts.slice(1).join(' ')];
}

/**
 * Text instruction: English character names in normal proportions, placed as
 * corner typography rather than stretched bands across the image.
 */
export const TEXT_INSTRUCTION =
  '英文角色名使用正常比例做旧印刷体，不得横向或纵向拉伸压缩，不得铺满整个顶部或底部边缘；将「{NAME_TOP}」和「{NAME_BOTTOM}」以四角排版方式放置在画面角落（左上/右上/左下/右下中选择两到四处），每个文字块只占角落区域，约占画面宽度25%-35%、高度10%-18%；文字可与角色局部叠压但不得遮挡脸部主体，必须保留四角留白和画面呼吸感';

/**
 * The three ZZZ yinghua art styles.
 */
export const YINGHUA_STYLES: YinghuaStyle[] = [
  {
    id: 1,
    label: '零命 · 暗调角色 / 亮色背景',
    description: '高对比暗色剪影，保留内部层次与服装细节，接近官方影画印刷感。',
    promptTemplate:
      '参考图包含原始角色立绘与零命风格样张：原始角色立绘用于身份、面部、发型、服饰与配色参考；样张仅用于绝区零影画的整体构图方向、色彩关系与角落文字排版参考，严禁借用样张中的人物外形。绝区零官方Mindscape Cinema影画风格，暗色剪影印刷美学（Dark Silhouette Print Style）：基于原始角色立绘生成零命基准图{CHARACTER_TRAITS}；角色构图为自然动态近景，角色充满画面（占85%~95%），动作设计具有艺术感、展现角色个性特点；画风与原三视图保持完全一致。角色整体以深黑紫、深炭黑、深梅紫等极深色调为主，形成强烈剪影感，但不是纯黑实心块；必须保留角色头发层次、服装结构、布料褶皱、配饰轮廓、手部姿态与面部大轮廓的可辨识度，通过极深色内部的轻微明暗变化与边缘高光来体现细节。角色内部色彩控制：深黑色约55%~65%，带紫调/红调的深暗色约25%~35%，极少量「{DOMINANT_COLOR}」或「{ACCENT_COLOR}」只用于眼部微光、发丝受光、饰品高光和边缘描线，绝不能变成普通全彩插画。背景必须是高饱和亮色纯色平涂，优先使用偏粉、偏洋红、偏紫红的「{DOMINANT_COLOR}」或「{ACCENT_COLOR}」作为大面积底色，亮度高、色块干净、不要浅淡灰白背景，不要复杂场景；不要贴纸、条码、标签、图标、网点纸、胶带、扫描线或任何工业装饰。文字处理：正常比例做旧印刷体英文「{NAME_TOP}」和「{NAME_BOTTOM}」放置在画面四个边角中的两到四处，单个文字块只占角落区域，不得拉伸压缩，不得铺满整个上部或下部，不得遮挡角色脸部主体；文字颜色使用与背景同色系但更深或更亮一级的印刷色，保留轻微磨损与印刷质感。角色动态：{ACTION_POSE}；整体效果：高对比、强设计感、暗紫黑主体、亮粉/洋红背景、角落文字排版、局部细节可辨。',
  },
  {
    id: 2,
    label: '三命 · 暗色背景 / 亮色主角',
    description: '深黑背景，极端去饱和灰度主调 + 高饱和点缀色，严格对齐零命构图。',
    promptTemplate:
      '参考图为左右拼合双图：左侧为零命成图（姿势、构图、取景范围与文字位置参考），右侧为原始角色立绘（身份、服饰配色与细节参考）。依照左侧零命参考图保持完全相同的角色姿势、构图比例、取景范围与文字位置，严禁任何位移或缩放{CHARACTER_TRAITS}；左侧零命图和右侧原始立绘是唯一角色身份参考，后续样张只允许参考版式、印刷质感与色彩关系，严禁生成样张里的角色。角色充满画面（与零命一致）；画风与原三视图保持完全一致；三命只改变材质表现与局部配色，不改变服装覆盖范围。允许部分特色饰品、关键服装部分或标志性结构保留主色调/辅色，其余服装主体维持黑白灰逻辑；色彩处理——极端去饱和灰度主调 + 高饱和点缀色：角色整体进行彻底去饱和处理，仅保留极少数指定点缀色；服装本体（上衣、裙子、裤子、外套等）与角色肌肤统一为黑白灰三色，建立完整灰阶，通过强烈块面光影和清晰线稿体现立体层次、布料褶皱与发丝质感；眼睛虹膜保留「{DOMINANT_COLOR}」（80%色彩饱和度）并带有高光反射点；特色饰品、关键服装部分或标志性结构可保留「{ACCENT_COLOR}」或「{DOMINANT_COLOR}」高饱和点缀，其余角色全身不得出现其他颜色；背景为统一深黑色暗调（RGB 8-15），不得出现具体场景、渐变、噪点纹理、贴纸、图标或说明元素；文字处理：正常比例做旧印刷体英文「{NAME_TOP}」和「{NAME_BOTTOM}」放置在画面四个边角中的两到四处，单个文字块只占角落区域，不得拉伸压缩，不得铺满整个上部或下部，不得遮挡角色脸部主体；文字采用高饱和「{ACCENT_COLOR}」或「{DOMINANT_COLOR}」做旧色，保留轻微磨损和印刷质感。',
  },
  {
    id: 3,
    label: '六命 · 全彩 / 肤色高光',
    description: '全彩高饱和赛璐珞，明亮全彩印刷品美学，严格对齐零命构图。',
    promptTemplate:
      '参考图包含原始角色立绘与六命风格样张：原始角色立绘用于身份、服饰配色与角色细节；样张仅用于绝区零影画的构图、文字排版、色彩关系和印刷质感参考。绝区零影画风格，依照左侧零命参考图保持相同的角色姿势、构图比例、取景范围与文字位置，严禁任何位移或缩放{CHARACTER_TRAITS}；角色充满画面；画风与原三视图保持完全一致；六命应作为三种风格中布料最少、展露度最高的版本；在不改变角色身份、主体服饰风格与核心设计语言的前提下，适度减少布料覆盖、增强身体或结构的展露感。色彩与上色——全彩高饱和赛璐珞：角色进行完整全彩高饱和赛璐珞上色，色彩鲜艳饱满、明亮夺目，严禁暗淡、灰蒙、去饱和或黑白灰处理；真实自然的肤色质感（暖调蜜桃肤色，带有自然红晕与高光）；以「{DOMINANT_COLOR}」为主色调贯穿角色服装、头发、配饰，配合「{ACCENT_COLOR}」作为辉光、高光边缘、点缀色与氛围色提高整体色彩冲击力；完整保留原角色服饰设计样式、剪裁风格与配色不做任何改动，所有固有色、阴影色、高光色必须忠于原设；展露强化：在不改变角色身份、主体服饰风格与核心设计语言的前提下，尽可能减少遮挡、增强角色主体结构的可见度与表现力。若角色为人类/拟人角色：在内容合规、非露骨前提下大幅增加肌肤展现（如露肩、露臂、露背、露腰、露腿等），同时保留服饰原有设计风格与配色。若角色为机器人/机械角色：减少外层遮挡件（如外套、披风、覆盖甲片、护罩），增加机械骨架、关节、金属结构、发光元件与材质高光的可见度，强化金属光泽、反射、高光边缘与结构分层。若角色为动物/兽人/非人角色：减少遮挡主体特征的外层服饰或覆盖物，增强耳朵、尾巴、四肢、毛发层次、爪部、角、翅膀等代表性特征的可见度与表现力。总体目标是让角色身体/结构更打开、更有展示感，但仍保持原角色的身份、服饰语言、配色与设计逻辑不变；背景——纯白无杂质：背景为纯白色（#FFFFFF）铺满整个画面背景区域，绝对纯白，无任何渐变、无噪点、无杂色、无纹理、无阴影、无暗角，也不要贴纸、条码、标签、logo、图标或说明字；文字处理：正常比例做旧印刷体英文「{NAME_TOP}」和「{NAME_BOTTOM}」放置在画面四个边角中的两到四处，单个文字块只占角落区域，不得拉伸压缩，不得铺满整个上部或下部，不得遮挡角色脸部主体；文字采用高饱和「{ACCENT_COLOR}」或「{DOMINANT_COLOR}」做旧色，保留轻微磨损和印刷质感；角色主体脸部清晰，细节高精度，整体呈现绝区零官方Mindscape Cinema影画的明亮全彩印刷品美学。',
  },
];

export function fillName(
  template: string,
  name: string,
  palette?: Palette,
  showText?: boolean,
  actionPose?: string,
  characterTraits?: string,
): string {
  const upper = (name || 'CHARACTER').toUpperCase();
  const [top, bottom] = splitName(upper);
  const dominant = palette?.dominant ?? '#b026ff';
  const accent = palette?.accent ?? '#ff2d9b';

  // Replace name/color markers first, then handle text toggle.
  let filled = template
    .replaceAll('{ACTION_POSE}', actionPose || '自然动态的动作姿势')
    .replaceAll('{CHARACTER_TRAITS}', characterTraits ? `，角色性格特点：${characterTraits}` : '')
    .replaceAll('{NAME_TOP}', top)
    .replaceAll('{NAME_BOTTOM}', bottom)
    .replaceAll('{NAME}', upper)
    .replaceAll('{DOMINANT_COLOR}', dominant)
    .replaceAll('{ACCENT_COLOR}', accent);
  if (showText === false) {
    filled = filled.replace(
      /英文角色名使用正常比例做旧印刷体，不得横向或纵向拉伸压缩，不得铺满整个顶部或底部边缘；将「[^」]+」和「[^」]+」以四角排版方式放置在画面角落[^']*/,
      '画面整洁不含任何文字，无水印',
    );
  }
  return FIDELITY_PREFIX + filled;
}
