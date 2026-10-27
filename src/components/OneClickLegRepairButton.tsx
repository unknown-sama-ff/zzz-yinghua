import { useInpaintStore } from '../store/useInpaintStore';
import { useYinghuaStore } from '../store/useYinghuaStore';
import { useToast } from '../store/useToast';
import { startOneClickLegRepair } from '../lib/oneClickLegRepair';
import type { InpaintTarget } from '../types';

export function OneClickLegRepairButton({ target }: { target: InpaintTarget }) {
  const editing = useInpaintStore((s) => s.isGenerating);
  const generating = useYinghuaStore((s) => Boolean(s.activeGeneration));
  const showMessage = useToast((s) => s.show);
  const repair = async () => {
    try {
      const result = await startOneClickLegRepair(target);
      if (result.status === 'complete') showMessage('✓ 修复版已生成，请检查后替换');
    } catch (error) { showMessage(error instanceof Error ? error.message : '腿部修复失败，原图已保留'); }
  };
  return (
    <div className="yinghua-leg-repair-action">
      <button type="button" className="glass-btn" onClick={() => void repair()} disabled={editing || generating}
        title="AI 局部修复多余腿和错接关节，优先保留完整连接的上方腿；先预览后替换">
        一键修腿
      </button>
      <small>优先保留完整连接的上方腿<br />每次调用一次图片编辑，确认后替换</small>
    </div>
  );
}
