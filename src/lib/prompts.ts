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
      '绝区零影画风格，{ACTION_POSE}{CHARACTER_TRAITS}，角色充满画面（占85%~95%），动作设计具有艺术感、展现角色个性特点；角色非纯黑：肌肤与眼睛为「{DOMINANT_COLOR}」（50%）+ 深黑色调RGB<40（50%）混合，保留五官轮廓可辨；服装、头发、眉毛为「{DOMINANT_COLOR}」（70%~75%）+ 深黑色调（20%~25%），体现布料褶皱与发丝层次、光线亮暗渐变；文字（{NAME_TOP}、{NAME_BOTTOM}）略带「{DOMINANT_COLOR}」微光染色；背景为明亮高饱和的「{DOMINANT_COLOR}」纯色平涂铺满画面、不允许出现任何第二种颜色或渐变过渡，辅以极少量「{ACCENT_COLOR}」作为细节点缀；斜切几何色块，胶带/贴纸做旧质感，噪点与扫描线，角色主体脸部清晰，' + TEXT_INSTRUCTION + '。',
  },
  {
    id: 2,
    label: '三命 · 暗色背景 / 亮色主角',
    description: '深黑背景，配件保留色彩，服装黑白灰光影层次，严格对齐零命构图。',
    promptTemplate:
      '参考图为左右拼合双图：左侧为零命成图（姿势构图与文字位置参考），右侧为原始角色立绘（服饰配色参考）。绝区零影画风格，依照左侧零命参考图保持完全相同的角色姿势、构图比例、取景范围与文字位置，严禁任何位移或缩放{CHARACTER_TRAITS}；角色充满画面（与零命一致）；画风与原三视图保持完全一致；角色服装配饰（徽章、纹饰、领结、发饰、首饰等，不含服装本体）保留原三视图90%色彩饱和度；眼睛虹膜保留「{DOMINANT_COLOR}」（80%色彩饱和度）；服装本体（上衣、裙子、裤子、外套等）仅使用黑白灰三色，以清晰线稿勾勒轮廓，通过光影明暗（高光→中间调→阴影）体现立体层次与布料质感；角色肌肤为浅灰至中灰色调（亮度100-180，去饱和）；背景深黑色暗调，角色与背景强烈明暗对比；工业贴纸UI质感，斜切色块，角色主体脸部清晰，' + TEXT_INSTRUCTION + '。',
  },
  {
    id: 3,
    label: '六命 · 全彩 / 肤色高光',
    description: '全彩赛璐珞，大幅肌肤展现，真实肤色，严格对齐零命构图。',
    promptTemplate:
      '参考图为左右拼合双图：左侧为零命成图（姿势构图与文字位置参考），右侧为原始角色立绘（服饰配色参考）。绝区零影画风格，依照左侧零命参考图保持完全相同的角色姿势、构图比例、取景范围与文字位置，严禁任何位移或缩放{CHARACTER_TRAITS}；角色充满画面（与零命一致）；画风与原三视图保持完全一致；全彩高饱和赛璐珞完整上色，角色必须色彩鲜艳饱满、明亮夺目（不可暗淡或灰蒙），真实自然的肤色质感；以「{DOMINANT_COLOR}」为主色调配合「{ACCENT_COLOR}」辉光提高色彩冲击力，完整保留原角色服饰设计样式与配色不做改动；在内容合规、非露骨的前提下大幅增加肌肤展现（露肩、露臂、露背、露腰、露腿等），但完整保留服饰原有的设计样式、剪裁风格与配色不做改动；背景为纯白色（#FFFFFF）铺满整个画面背景区域，无任何渐变、无噪点、无杂色；强烈明暗对比，做旧噪点，斜切几何，角色主体脸部清晰，细节高精度，' + TEXT_INSTRUCTION + '。',
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
