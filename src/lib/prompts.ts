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
  '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；主角色图与原始立绘是唯一角色身份参考，生成的必须是上传图片中的角色本人，严禁自行设计或创造新角色，所有面部特征、五官比例、发型发色、体型、服装细节必须与三视图的角色完全一致；严禁生成参考样张中的任何角色、脸型、五官、发型、发色、身体、服装、配饰或姿势——样张仅可用于借鉴构图方向、色彩氛围和文字排版风格，任何情况下都不得复制或借用样张中的人物形象；如与主角色冲突一律以主角色身份、服饰与面部为准；如果参考图中包含额外道具/武器/装饰元素，仅将其作为可加入角色动作设计的附加元素参考；不得改变角色身份、发型、面部和主体服饰风格；画面必须为横向构图（landscape，宽大于高，3:2 横幅），不需要展示角色全身，突出角色特点与个性，但角色下胸部以上必须完整呈现于画面中；角色做出动作后人物主体约占画面70%-85%，允许为角落大字与留白预留空间；三张影画必须以原三视图的画风为准，角色动作、位置、构图与文字位置必须保持一致（三命和六命严格对齐零命），但各自的色彩与渲染风格由下方风格化指令决定；最终画面只保留角色主体与正常比例英文名字文字，不要任何额外贴纸、徽标、条码、说明字、小标签或背景装饰。在此前提下进行如下风格化：';

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
  '做旧印刷体英文「{NAME_TOP}」和「{NAME_BOTTOM}」分别放置于两个角落，形成对角或同侧配对（左上+左下 或 左上+右下 或 右上+左下 或 右上+右下 四选一），文字必须贴近所在角落的边缘位置，采用超大号字体，文字允许与角色局部叠压但不得遮挡脸部主体，文字不透明度100%、完全实心，不可透过文字看到后方角色';

/**
 * The three ZZZ yinghua art styles.
 */
export const YINGHUA_STYLES: YinghuaStyle[] = [
  {
    id: 1,
    label: '零命 · 暗调角色 / 亮色背景',
    description: '高对比暗色剪影，保留内部层次与服装细节，接近官方影画印刷感。',
    promptTemplate:
      '参考图包含原始角色立绘与风格样张：原始角色立绘用于身份、面部、发型、服饰与配色参考；样张仅用于绝区零影画的整体构图方向、色彩关系与角落文字排版参考，严禁借用样张中的人物外形和名字。绝区零官方Mindscape Cinema影画风格，暗色剪影印刷美学（Dark Silhouette Print Style）：基于原始角色立绘生成基准图{CHARACTER_TRAITS}；人物构图允许明显偏左或偏右，严禁正面平视、证件照式大头、对称站像；允许头顶、肩部、手臂、发尾等局部出框，人物主体大面积裁切，优先冲击感而不是完整呈现；角色主体和文字共占约占画面80%~85%；动作设计具有艺术感、展现角色个性特点；画风与原三视图保持完全一致。文字排版为画面强制核心要素：采用超大号且必须水平排版的做旧印刷体英文{NAME_TOP}和{NAME_BOTTOM}，以双角配对方式放置，文字必须贴近所在角落的边缘位置，严禁旋转、斜切、弧排或透视变形；{NAME_TOP}文字组为三者中最大最宽的文字层，宽度接近画面左右边缘，高度约达画面的四分之一强；{NAME_BOTTOM}文字组明显小于{NAME_TOP}，约为{NAME_TOP}的五到六成大小；{NAME_TOP}位于角色后方作为背景层，{NAME_BOTTOM}压于角色前方作为前景层；文字必须与角色产生重叠和前后遮挡关系，严禁将文字缩到空白角落或边缘空旷处；文字可压住肩、发、手臂等局部，但不得遮挡脸部主体；{NAME_TOP}文字颜色强制使用比背景更深一阶的近黑版印刷色，{NAME_BOTTOM}文字颜色强制使用比{DOMINANT_COLOR}亮一阶的颜色，不得使用其他颜色；文字不透明度100%、完全实心，不可透过文字看到后方角色。角色主体以接近纯黑的深黑块面为主（不是背景色），形成平面压印效果；主体的明暗仅由配色占比决定，严禁任何方向性光源、模拟打光、阴影投射，同一材质不得出现左亮右暗的分裂明暗；只保留极弱的明暗差异与少量边缘轮廓变化来提示结构。角色内部色彩控制：脸部与身体肤色保持接近纯黑的深黑色，在黑色基础上叠加薄薄一层约5%的{DOMINANT_COLOR}或{ACCENT_COLOR}作为肤色罩染，严禁脸部发亮；毛发、服饰、挂饰、配件、发饰等所有非皮肤部位必须全部为亮色，不得出现暗色头发或暗色服装，且不得比肌肤更黑，颜色亮度可上下浮动30%来表达层次感；主体与背景必须明确分离，只允许极少量边缘被背景色轻微染边，大面积块面绝不能变成背景色本身。服装本体、花纹、布料印花、袖口纹样、腰带图案不得做任何改动，必须与原三视图完全一致，严禁自行修改、增减、简化或重新设计任何服装部件，仅可改变其色彩亮暗以符合深暗色域要求；花纹仅以低对比度暗纹或压印感存在，不得形成可读亮花纹。高光只限极细外轮廓描线和少量发丝边缘，眼睛不得出现任何高光或发光点。背景使用高饱和亮色纯色平涂，优先使用{DOMINANT_COLOR}或{ACCENT_COLOR}作为大面积底色。角色动态：{ACTION_POSE}；整体效果：高对比、强设计感、深黑压印主体、主题色背景、水平超大角落压版文字、强烈留白与斜向冲击感。',
  },
  {
    id: 2,
    label: '三命 · 暗色背景 / 亮色主角',
    description: '深黑背景，极端去饱和灰度主调 + 高饱和点缀色，严格对齐零命构图。',
    promptTemplate:
      '你正在对一张已有的零命成图做风格变换。输入图片本身即为零命成图，你需要严格保留其全部角色姿势、构图比例、取景范围、文字位置、文字大小和裁切范围不做任何改变，仅改变其色彩与渲染风格为极端去饱和灰度主调 + 高饱和点缀色。你收到的参考板左侧为零命成图（仅用于风格变换基础），右侧为风格样张（仅用于影画色彩排版参考）。画风与原三视图保持完全一致；色彩处理——极端去饱和灰度主调 + 高饱和点缀色：角色整体进行彻底去饱和处理，仅保留极少数指定点缀色；注意文字颜色不受去饱和影响，必须保留高饱和色彩；服装本体（上衣、裙子、裤子、外套等）必须与原三视图完全一致，不得自行修改或增减任何服装部件，仅可改变其色彩，统一为黑白灰三色，建立从近白（亮度230-255）到近黑（亮度10-30）的完整灰阶，通过强烈的块面光影明暗（高光→中间调→阴影）与清晰外轮廓线稿体现立体层次、布料褶皱与发丝质感；角色肌肤为浅灰至中灰色调（亮度100-180，完全去饱和）；眼睛虹膜保留「{DOMINANT_COLOR}」（80%色彩饱和度），并带有明显的高光反射点；指定点缀部位（包括但不限于：披风、指甲、手套、唇舌、心形/星形等标志性配饰、发饰、道具挂饰、领结纹饰等）的颜色应恢复至与原始三视图完全一致的配色，保留「{ACCENT_COLOR}」或「{DOMINANT_COLOR}」100%饱和色彩并在当前基础上提亮30%，与灰度主体形成强烈视觉焦点，除此之外角色全身不得出现任何其他颜色；背景与明暗对比：背景为统一深黑色暗调（RGB 8-15），可带有极微弱的工业噪点纹理，但不得出现任何具体场景、第二种颜色、渐变过渡或暗角；角色与背景形成极端强烈的明暗对比，角色外轮廓清晰锐利，高光区域可接近纯白；文字处理：采用超大号且必须水平排版的做旧印刷体英文{NAME_TOP}和{NAME_BOTTOM}，以双角配对方式放置，文字必须贴近所在角落的边缘位置，严禁旋转、斜切、弧排或透视变形；{NAME_TOP}文字组为三者中最大最宽的文字层，宽度接近画面左右边缘，高度约达画面的四分之一强；{NAME_BOTTOM}文字组明显小于{NAME_TOP}，约为{NAME_TOP}的五到六成大小；{NAME_TOP}位于角色后方作为背景层，{NAME_BOTTOM}压于角色前方作为前景层；文字必须与角色产生重叠和前后遮挡关系，严禁将文字缩到空白角落或边缘空旷处；文字可压住肩、发、手臂等局部，但不得遮挡脸部主体；字体不得横向或纵向拉伸以填满画面，保持正常字形比例；文字不透明度100%、完全实心，不可透过文字看到后方角色；{NAME_TOP}和{NAME_BOTTOM}的文字颜色强制使用比{DOMINANT_COLOR}亮一阶的高饱和颜色，100%不透明度实心字体，不得被去饱和处理影响，不得使用其他颜色',
  },
  {
    id: 3,
    label: '六命 · 全彩 / 肤色高光',
    description: '全彩高饱和赛璐珞，明亮全彩印刷品美学，严格对齐零命构图。',
    promptTemplate:
      '你正在对一张已有的零命成图做风格变换。输入图片本身即为零命成图，你需要严格保留其全部角色姿势、构图比例、取景范围、文字位置、文字大小和裁切范围不做任何改变，仅改变其色彩与渲染风格为全彩高饱和赛璐珞。你收到的参考板左侧为零命成图（仅用于风格变换基础），右侧为风格样张（仅用于影画色彩排版参考）。画风与原三视图保持完全一致；色彩与上色——全彩高饱和赛璐珞：角色进行完整全彩高饱和赛璐珞上色，色彩鲜艳饱满、明亮夺目，严禁暗淡、灰蒙、去饱和或黑白灰处理；真实自然的肤色质感（暖调蜜桃肤色，带有自然红晕与高光）；以「{DOMINANT_COLOR}」为主色调贯穿角色服装、头发、配饰，配合「{ACCENT_COLOR}」作为辉光、高光边缘、点缀色与氛围色提高整体色彩冲击力；肌肤展现（六命专属核心要求，优先级最高）：在保持角色姿势和面部身份不变的前提下，原三视图的服装必须进行大幅删减以大幅增加肌肤露出。必须执行以下至少4项处理：去除外套/披风、去除外层遮挡/护甲、大幅缩短裙摆至大腿以上、大幅缩短袖长至肩部附近、降低领口露出锁骨与肩颈、开放整个背部、开放腰腹、减少腿部布料覆盖至短裤/热裤程度。保留的服装必须保持原三视图的版型与材质，删减不是修改服装本身的设计。背景——纯白无杂质：纯白色（#FFFFFF）铺满整个画面背景区域，无任何渐变、噪点、纹理、阴影或暗角；文字处理：采用超大号且必须水平排版的做旧印刷体英文{NAME_TOP}和{NAME_BOTTOM}，以双角配对方式放置，文字必须贴近所在角落的边缘位置，严禁旋转、斜切、弧排或透视变形；{NAME_TOP}文字组为三者中最大最宽的文字层，宽度接近画面左右边缘，高度约达画面的四分之一强；{NAME_BOTTOM}文字组明显小于{NAME_TOP}，约为{NAME_TOP}的五到六成大小；{NAME_TOP}位于角色后方作为背景层，{NAME_BOTTOM}压于角色前方作为前景层；文字必须与角色产生重叠和前后遮挡关系，严禁将文字缩到空白角落或边缘空旷处；文字可压住肩、发、手臂等局部，但不得遮挡脸部主体；字体不得横向或纵向拉伸以填满画面，保持正常字形比例；文字不透明度100%、完全实心，不可透过文字看到后方角色；{NAME_TOP}和{NAME_BOTTOM}的文字颜色强制使用比{DOMINANT_COLOR}亮一阶的高饱和颜色，两者均不得使用其他颜色。角色动态：{ACTION_POSE}；质感与细节：强烈明暗对比，做旧噪点，斜切几何色块，工业贴纸UI质感，网点纸/半调纹理（halftone dot pattern），印刷做旧质感，扫描线；角色主体脸部清晰，细节高精度，整体呈现绝区零官方Mindscape Cinema影画的明亮全彩印刷品美学。',
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
      /做旧印刷体英文「[^」]+」和「[^」]+」分别放置于两个角落[^']*/,
      '画面整洁不含任何文字，无水印',
    );
  }
  return FIDELITY_PREFIX + filled;
}
