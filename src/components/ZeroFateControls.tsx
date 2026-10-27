import { useYinghuaStore } from '../store/useYinghuaStore';
import { ResultView } from './ResultView';
import { GenerationErrorNotice } from './GenerationErrorNotice';
import { YinghuaStagePreview } from './YinghuaStagePreview';
import type { InpaintTarget } from '../types';

export function ZeroFateControls({ isCurrent, onGenerateDraft, onConfirmDraft, onResetPrompt, onInpaintClick }: {
  isCurrent: boolean;
  onGenerateDraft: () => void;
  onConfirmDraft: () => void;
  onResetPrompt: () => void;
  onInpaintClick: (src: string, target: InpaintTarget) => void;
}) {
  const draft = useYinghuaStore((s) => s.zeroFateDraft);
  const prompt = useYinghuaStore((s) => s.zeroFateDraftPrompt);
  const setPrompt = useYinghuaStore((s) => s.setZeroFateDraftPrompt);
  const active = useYinghuaStore((s) => s.activeGeneration);
  const preview = { ...draft, status: 'done' as const, images: draft.images.slice(0, 1) };
  const loading = active?.phase === 'draft';
  return (
    <div className="yinghua-stage" data-yinghua-stage="draft">
      <div className="yinghua-stage-controls">
        <p className="yinghua-stage-eyebrow">动作与结构 / ACTION STUDY</p>
        <h3>动作底稿</h3>
        <p className="yinghua-stage-description">先确定动作，再处理光影。生成无字全彩底稿，检查两腿连接、膝盖弯曲和前后遮挡。</p>
        <div className="yinghua-stage-note"><strong>保留完整衣装</strong><p>正常明暗、自然表情。保留原角色服装与镜头设计，便于看清动作结构。</p></div>
        <details className="yinghua-prompt-editor">
          <summary>编辑底稿提示词 <span aria-hidden="true">＋</span></summary>
          <textarea aria-label="动作底稿提示词" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={9} className="glass-input" />
          <button type="button" onClick={onResetPrompt} disabled={Boolean(active)} className="yinghua-text-button">恢复默认底稿提示词</button>
        </details>
        {draft.images[0] && !isCurrent && <p role="status" className="yinghua-stage-warning">角色、动作或提示词已更新，请重新生成底稿。</p>}
        <GenerationErrorNotice message={draft.error} upstreamError={draft.upstreamError} />
        <div className="yinghua-stage-actions">
          <button type="button" onClick={isCurrent ? onConfirmDraft : onGenerateDraft} disabled={Boolean(active)} className="yinghua-primary-action">
            {loading ? '生成动作底稿中…' : isCurrent ? '确认结构并生成零命' : draft.images[0] ? '重新生成动作底稿' : '生成动作底稿'}
            <span aria-hidden="true">↗</span>
          </button>
          {draft.images[0] && <div className="yinghua-secondary-actions">
            <button type="button" onClick={() => onInpaintClick(draft.images[0], { type: 'yinghua-draft', index: 0, url: draft.images[0] })} disabled={Boolean(active)} className="glass-btn">修改动作底稿</button>
            {isCurrent && <button type="button" onClick={onGenerateDraft} disabled={Boolean(active)} className="glass-btn">重新生成动作底稿</button>}
          </div>}
          <p>本步调用一次生图。确认后才会开始零命转换。</p>
        </div>
      </div>
      <YinghuaStagePreview slot={draft} title="动作底稿" hint="确认前请检查关节连接与遮挡；底稿可下载、修改，也可保留后重新生成。"
        repairTarget={draft.images[0] ? { type: 'yinghua-draft', index: 0, url: draft.images[0] } : undefined}>
        <ResultView slot={preview} downloadPrefix="yinghua-action-draft" onInpaintClick={onInpaintClick} inpaintMeta={{ type: 'yinghua-draft' }} />
      </YinghuaStagePreview>
    </div>
  );
}
