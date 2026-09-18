export function buildContextualEditPrompt(
  instruction: string,
  mode: 'smart' | 'precise',
): string {
  const preservation = '这是一轮连续图片编辑，输入图是当前版本。必须严格保留角色身份、面部、体型、姿势、构图、画幅比例、画风、已有文字，以及本轮指令未明确提及的所有区域；不要重绘或改动未提及内容。';
  const maskRule = mode === 'precise'
    ? '仅修改蒙版指定区域，蒙版外的内容必须保持不变。'
    : '';
  return `${preservation}${maskRule}\n\n本轮修改：${instruction.trim()}`;
}
