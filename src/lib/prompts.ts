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
  '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；画面必须为横向构图（landscape，宽大于高，3:2 横幅），不需要展示角色全身，突出角色特点与个性，但角色腰部以上必须完整呈现于画面中；角色做出动作后人物应当撑满画面90%以上；三张影画（零命/三命/六命）必须与原三视图的角色美术风格完全一致，不可改变画风；在此前提下进行如下风格化：';

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
 * Text instruction: two oversized English names auto-assigned to the two emptiest
 * corners based on the character's pose and spatial distribution in the image.
 */
export const TEXT_INSTRUCTION =
  '根据角色动作姿势与位置，超大做旧印刷体英文「{NAME_TOP}」和「{NAME_BOTTOM}」分别自动分配到四个角落中最空旷的两个位置（左上/右上/左下/右下各选一），确保不被角色遮挡';

/**
 * The three ZZZ yinghua art styles.
 */
export const YINGHUA_STYLES: YinghuaStyle[] = [
  {
    id: 1,
    label: '零命 · 暗调角色 / 亮色背景',
    description: '主题色混合暗调剪影，布料发丝层次感，文字微光染色。',
    promptTemplate:
      '绝区零影画风格，纯黑剪影美学（Silhouette Style）：角色主体为纯黑剪影（RGB 0-10），全身、服装、头发、肌肤统一为极深黑色；仅在最外轮廓边缘保留1-2像素的#b026ff微弱轮廓光，眼睛处保留极小的高纯度#b026ff高光点（占比不超过眼睛的5%）；五官、发丝、布料褶皱、配饰全部通过剪影轮廓的负空间与纯黑内部的极深灰（RGB 8-15）微妙暗示，严禁添加任何中间色调、渐变填充或固有色，确保角色在明亮背景前呈现强烈的黑色轮廓冲击；极端高对比与背景：背景为明亮高饱和的#b026ff纯色平涂（HSV明度V>90%，均匀无变化），铺满整个画面，不允许出现任何第二种颜色、渐变、暗角或过渡；辅以极少量#ff2d9b作为胶带/贴纸边缘的细节点缀；斜切几何色块、胶带/贴纸做旧质感、噪点与扫描线；文字处理：超大做旧印刷体英文「CHARACTER」和「CHARACTER」尺寸极大（单字高度占画面高度的30%-45%），分别分配到画面中上下或左右两个最空旷的边缘，允许与角色剪影产生前后遮挡与叠压关系，文字填充为略带#b026ff微光的深黑色或#ff2d9b做旧色，边缘带有粗糙磨损、噪点与印刷错位感；角色动态：自然动态的动作姿势，角色充满画面（占85%~95%），动作设计具有艺术感、展现角色个性特点；角色主体脸部轮廓与发型轮廓必须清晰可辨，整体呈现"强光下纯黑剪影"的戏剧化影画效果。',
  },
  {
    id: 2,
    label: '三命 · 暗色背景 / 亮色主角',
    description: '深黑背景，极端去饱和灰度主调 + 高饱和点缀色，严格对齐零命构图。',
    promptTemplate:
      '参考图为左右拼合双图：左侧为零命成图（姿势构图与文字位置参考），右侧为原始角色立绘（服饰配色参考）。绝区零影画风格，依照左侧零命参考图保持完全相同的角色姿势、构图比例、取景范围与文字位置，严禁任何位移或缩放{CHARACTER_TRAITS}；角色充满画面（与零命一致）；画风与原三视图保持完全一致；色彩处理——极端去饱和灰度主调 + 高饱和点缀色：角色整体进行彻底去饱和处理，仅保留极少数指定点缀色；服装本体（上衣、裙子、裤子、外套等）与角色肌肤统一为黑白灰三色，建立从近白（亮度230-255）到近黑（亮度10-30）的完整灰阶，通过强烈的块面光影明暗（高光→中间调→阴影）与清晰外轮廓线稿体现立体层次、布料褶皱与发丝质感；角色肌肤为浅灰至中灰色调（亮度100-180，完全去饱和）；眼睛虹膜保留「#b026ff」（80%色彩饱和度），并带有明显的高光反射点；指定点缀部位（包括但不限于：指甲、唇舌、心形/星形等标志性配饰、发饰、道具挂饰、领结纹饰等）保留「#ff2d9b」或「#b026ff」高饱和色彩（90%饱和度），与灰度主体形成强烈视觉焦点，除此之外角色全身不得出现任何其他颜色；背景与明暗对比：背景为统一深黑色暗调（RGB 8-15），可带有极微弱的工业噪点纹理，但不得出现任何具体场景、第二种颜色、渐变过渡或暗角；角色与背景形成极端强烈的明暗对比，角色外轮廓清晰锐利，高光区域可接近纯白；文字处理——超大做旧印刷体叠压：超大做旧印刷体英文「CHARACTER」和「CHARACTER」尺寸极大（单字高度占画面高度的30%-45%），采用高饱和「#ff2d9b」做旧色，边缘带有粗糙磨损、噪点、印刷错位与墨点飞溅质感；文字分布于画面上下边缘或左右边缘（非角落），必须与角色产生前后遮挡与叠压关系——文字可被角色头发、肢体、道具、服装部分覆盖，也可衬于角色身体后方，形成丰富的空间纵深感；严禁为避免遮挡而缩小文字、改变文字位置或移动至空旷角落；质感强化：工业贴纸UI质感，斜切几何色块，网点纸/半调纹理（halftone dot pattern），印刷做旧质感，扫描线，角色主体脸部清晰可辨，整体呈现绝区零官方Mindscape Cinema影画的印刷品美学。',
  },
  {
    id: 3,
    label: '六命 · 全彩 / 肤色高光',
    description: '全彩高饱和赛璐珞，明亮全彩印刷品美学，严格对齐零命构图。',
    promptTemplate:
      '参考图为左右拼合双图：左侧为零命成图（姿势构图与文字位置参考），右侧为原始角色立绘（服饰配色参考）。绝区零影画风格，依照左侧零命参考图保持完全相同的角色姿势、构图比例、取景范围与文字位置，严禁任何位移或缩放{CHARACTER_TRAITS}；角色充满画面（与零命一致）；画风与原三视图保持完全一致；色彩与上色——全彩高饱和赛璐珞：角色进行完整全彩高饱和赛璐珞上色，色彩鲜艳饱满、明亮夺目，严禁暗淡、灰蒙、去饱和或黑白灰处理；真实自然的肤色质感（暖调蜜桃肤色，带有自然红晕与高光）；以「#b026ff」为主色调贯穿角色服装、头发、配饰，配合「#ff2d9b」作为辉光、高光边缘、点缀色与氛围色提高整体色彩冲击力；完整保留原角色服饰设计样式、剪裁风格与配色不做任何改动，所有固有色、阴影色、高光色必须忠于原设；肌肤展现：在内容合规、非露骨的前提下大幅增加肌肤展现（露肩、露臂、露背、露腰、露腿等），但完整保留服饰原有的设计样式、剪裁风格与配色不做改动；背景——纯白无杂质：背景为纯白色（#FFFFFF）铺满整个画面背景区域，绝对纯白，无任何渐变、无噪点、无杂色、无纹理、无阴影、无暗角，呈现干净的印刷品底色质感；文字处理——超大做旧印刷体叠压：超大做旧印刷体英文「CHARACTER」和「CHARACTER」尺寸极大（单字高度占画面高度的30%-45%），采用高饱和「#ff2d9b」或「#b026ff」做旧色，边缘带有粗糙磨损、噪点、印刷错位与墨点飞溅质感；文字分布于画面上下边缘（顶部一行、底部一行），必须与角色产生前后遮挡与叠压关系——文字可被角色头发、肢体、道具、服装部分覆盖，也可衬于角色身体后方，形成丰富的空间纵深感；严禁为避免遮挡而缩小文字、改变文字位置或移动至空旷角落；质感与细节：强烈明暗对比，做旧噪点，斜切几何色块，工业贴纸UI质感，网点纸/半调纹理（halftone dot pattern），印刷做旧质感，扫描线；角色主体脸部清晰，细节高精度，整体呈现绝区零官方Mindscape Cinema影画的明亮全彩印刷品美学。',
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
  // Text toggle: replace the auto-placement instruction with a no-text directive.
  // Use a regex that matches regardless of which names were filled in.
  if (showText === false) {
    filled = filled.replace(
      /根据角色动作姿势与位置，超大做旧印刷体英文「[^」]+」和「[^」]+」分别自动分配到四个角落中最空旷的两个位置（左上\/右上\/左下\/右下各选一），确保不被角色遮挡；底部一行小字星级副标题信息/,
      '画面整洁不含任何文字，无水印',
    );
  }
  return FIDELITY_PREFIX + filled;
}
