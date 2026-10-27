import { LEG_REPAIR_ZH } from './legStructurePrompt';

export function buildContextualEditPrompt(
  instruction: string,
  mode: 'smart' | 'precise',
): string {
  const preservation = '这是一轮连续图片编辑，输入图是当前版本。必须严格保留角色身份、面部、体型、姿势、构图、画幅比例、画风、已有文字，以及本轮指令未明确提及的所有区域；不要重绘或改动未提及内容。';
  const maskRule = mode === 'precise'
    ? '仅修改蒙版指定区域，蒙版外的内容必须保持不变。'
    : '';
  const legRepair = /(?:多余|额外|多出|第三|三条).{0,12}腿|腿.{0,10}(?:分叉|畸形|粘连)|(?:extra|third|additional|branched)\s+(?:[a-z-]+\s+){0,3}leg|three\s+legs/i.test(instruction)
    ? `\n${LEG_REPAIR_ZH}` : '';
  return `${preservation}${maskRule}${legRepair}\n\n本轮修改：${instruction.trim()}`;
}
