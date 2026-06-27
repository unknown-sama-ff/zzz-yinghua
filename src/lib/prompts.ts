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
  '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；画面必须为横向构图（landscape，宽大于高，3:2 横幅），角色横向布局充满画面，禁止竖向/纵向构图；在此前提下进行如下风格化：';

/**
 * Three-view + close-up generation prompt.
 */
export const THREE_VIEW_PROMPT = `根据角色图片特点补全三视图，生成图中角色三视图并且整合到一张图中，所有视图必须与上传图片中的角色严格一致——面部、发型发色、服装与配色完全统一无改动，结构准确，无任何遮挡，统一光影，统一画风，纯白色干净背景，无多余杂物、无水印文字，细节拉满，高精度，不要文字，不要背景。同时生成角色面部特写放在图右侧。`;

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
 * The three ZZZ yinghua art styles.
 * {NAME_TOP} / {NAME_BOTTOM} are replaced with the split character name.
 * Layout: {NAME_TOP} as oversized print text at the top-left, {NAME_BOTTOM} at
 * the bottom-right, character body in the centre between them.
 */
export const YINGHUA_STYLES: YinghuaStyle[] = [
  {
    id: 1,
    label: '零命 · 暗调角色 / 亮色背景',
    description: '角色压暗为深色剪影，背景填充明亮的角色主题色，强烈明暗反差。',
    promptTemplate:
      '绝区零影画风格，角色动态动作姿势，角色整体压暗处理为深色暗调（仅保留极少高光与轮廓细节，近似深色剪影但保留五官辨识度），背景为明亮高饱和的「{DOMINANT_COLOR}」主题色平涂，角色与亮色背景形成强烈明暗反差，辅以「{ACCENT_COLOR}」点缀，斜切几何色块，胶带/贴纸做旧质感，噪点与扫描线，角色主体居中脸部清晰，画面整洁不含任何文字，无水印。',
  },
  {
    id: 2,
    label: '三命 · 暗色背景 / 亮色主角',
    description: '深黑背景，角色为明亮浅色调主体，清晰线稿 + 半赛璐珞。',
    promptTemplate:
      '绝区零影画风格，保持与参考图完全相同的角色姿势、构图、取景与位置，背景改为深黑色暗调，角色为明亮浅色调主体（清晰线稿 + 中等饱和半赛璐珞上色，肤色与发色明亮突出），以「{DOMINANT_COLOR}」为点缀，辅以「{ACCENT_COLOR}」，柔和阴影与体积感，角色与暗背景形成强烈对比，工业贴纸 UI 质感，斜切色块，角色主体居中脸部清晰，画面整洁不含任何文字，无水印。',
  },
  {
    id: 3,
    label: '六命 · 全彩 / 肤色高光',
    description: '全彩完整上色，真实肤色质感，适度增加肌肤展现、减少服饰遮挡（保持服饰原风格）。',
    promptTemplate:
      '绝区零影画风格，保持与参考图完全相同的角色姿势、构图、取景与位置，全彩赛璐珞完整上色，真实自然的肌肤质感与健康肤色，高饱和鲜明配色，以「{DOMINANT_COLOR}」为主色调配合「{ACCENT_COLOR}」辉光；在内容合规、非露骨的前提下适度增加肌肤展现、减少服饰遮挡面积（如露肩、露臂、露背等），但完整保留服饰原有的设计样式、剪裁风格与配色不做改动；强烈明暗对比，做旧噪点，斜切几何，角色主体居中脸部清晰，细节高精度，画面整洁不含任何文字，无水印。',
  },
];

/**
 * Fill name and palette placeholders, then prepend the fidelity prefix.
 * {DOMINANT_COLOR}/{ACCENT_COLOR} are replaced with hex values from palette,
 * falling back to ZZZ defaults when no palette is available.
 */
export function fillName(template: string, name: string, palette?: Palette): string {
  const upper = (name || 'CHARACTER').toUpperCase();
  const [top, bottom] = splitName(upper);
  const dominant = palette?.dominant ?? '#b026ff';
  const accent = palette?.accent ?? '#ff2d9b';
  const filled = template
    .replaceAll('{NAME_TOP}', top)
    .replaceAll('{NAME_BOTTOM}', bottom)
    .replaceAll('{NAME}', upper)
    .replaceAll('{DOMINANT_COLOR}', dominant)
    .replaceAll('{ACCENT_COLOR}', accent);
  return FIDELITY_PREFIX + filled;
}
