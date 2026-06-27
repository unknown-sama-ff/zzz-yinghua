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
  '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；在此前提下进行如下风格化：';

/**
 * Three-view + close-up generation prompt.
 */
export const THREE_VIEW_PROMPT = `根据角色正面图片特点补全三视图，生成图中角色三视图并且整合到一张图中，所有视图必须与上传图片中的角色严格一致——面部、发型发色、服装与配色完全统一无改动，结构准确，无任何遮挡，统一光影，统一画风，纯白色干净背景，无多余杂物、无水印文字，细节拉满，高精度，不要文字，不要背景。同时生成角色面部特写放在图右侧。`;

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
    label: '零命 · 重墨黑白单色强调',
    description: '高对比明暗，大块墨色剪影，仅单一主色点缀。',
    promptTemplate:
      '绝区零影画风格，角色动态动作姿势，重墨黑白线稿与大块剪影，高对比明暗，仅以单一「{DOMINANT_COLOR}」色作点缀强调，辅以「{ACCENT_COLOR}」，图片顶部左侧超大做旧印刷体英文「{NAME_TOP}」，图片底部右侧超大做旧印刷体英文「{NAME_BOTTOM}」，角色主体站在画面中央人物脸部清晰不被文字遮挡，底部有一行小字星级副标题信息，斜切几何色块，胶带/贴纸做旧质感，噪点与扫描线，无水印。',
  },
  {
    id: 2,
    label: '三命 · 半赛璐珞',
    description: '清晰线稿 + 中等饱和上色，柔和阴影与体积感。',
    promptTemplate:
      '绝区零影画风格，角色动态动作姿势，清晰线稿 + 中等饱和半赛璐珞上色，柔和阴影与体积感，以「{DOMINANT_COLOR}」为主色调，辅以「{ACCENT_COLOR}」，角色主体占据画面中央人物脸部清晰，工业贴纸 UI 质感，斜切色块，干净构图，无文字，无水印。',
  },
  {
    id: 3,
    label: '六命 · 全彩高饱和赛璐珞',
    description: '全彩完整上色，高饱和鲜明配色，霓虹辉光。',
    promptTemplate:
      '绝区零影画风格，角色动态动作姿势，全彩赛璐珞完整上色，以「{DOMINANT_COLOR}」为主色调配合「{ACCENT_COLOR}」辉光，高饱和鲜明配色，强烈明暗对比，角色主体占据画面中央人物脸部清晰，做旧噪点，斜切几何，画风统一，细节拉满，高精度，无文字，无水印。',
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
