import type { YinghuaStyle } from '../types';

/**
 * Landscape output size for yinghua art, matching the viewer's 16:9 stage so the
 * generated image fills it without cropping. 1536x1024 is the closest landscape
 * size gpt-image-1 supports; providers that ignore it fall back gracefully.
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
 * Three-view + close-up generation prompt (from the project spec, strengthened
 * to bind the result to the uploaded character).
 */
export const THREE_VIEW_PROMPT = `根据角色正面图片特点补全三视图，生成图中角色三视图并且整合到一张图中，所有视图必须与上传图片中的角色严格一致——面部、发型发色、服装与配色完全统一无改动，结构准确，无任何遮挡，统一光影，统一画风，纯白色干净背景，无多余杂物、无水印文字，细节拉满，高精度，不要文字，不要背景。同时生成角色面部特写放在图右侧。`;

/**
 * The three ZZZ yinghua art styles. `{NAME}` is replaced with the character's
 * English name before sending. Derived from the reference folders 影画样式1/2/3.
 */
export const YINGHUA_STYLES: YinghuaStyle[] = [
  {
    id: 1,
    label: '零命 · 重墨黑白单色强调',
    description: '高对比明暗，大块墨色剪影，仅单一品红/紫色点缀。',
    promptTemplate:
      '绝区零影画风格，角色动态动作姿势，重墨黑白线稿与大块剪影，高对比明暗，仅以单一品红/紫色作点缀强调，背景为巨大角色英文名「{NAME}」做旧排版字 + 斜切几何色块，胶带/贴纸做旧质感，噪点与扫描线，无多余杂物，无水印。',
  },
  {
    id: 2,
    label: '三命 · 半赛璐珞',
    description: '清晰线稿 + 中等饱和上色，柔和阴影与体积感。',
    promptTemplate:
      '绝区零影画风格，角色动态动作姿势，清晰线稿 + 中等饱和半赛璐珞上色，柔和阴影与体积感，紫/品红主色调，背景为巨大角色英文名「{NAME}」排版字 + 斜切色块，工业贴纸 UI 质感，干净构图，无水印。',
  },
  {
    id: 3,
    label: '六命 · 全彩高饱和赛璐珞',
    description: '全彩完整上色，高饱和鲜明配色，霓虹辉光。',
    promptTemplate:
      '绝区零影画风格，角色动态动作姿势，全彩赛璐珞完整上色，高饱和鲜明配色，强烈明暗对比与霓虹辉光，背景为巨大角色英文名「{NAME}」排版字 + 斜切几何，做旧噪点，画风统一，细节拉满，高精度，无水印。',
  },
];

/**
 * Fill the {NAME} placeholder with the character's English name, and prepend the
 * fidelity prefix so generated yinghua art stays true to the uploaded character.
 */
export function fillName(template: string, name: string): string {
  const filled = template.replaceAll('{NAME}', (name || 'CHARACTER').toUpperCase());
  return FIDELITY_PREFIX + filled;
}
