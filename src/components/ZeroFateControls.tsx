import { useYinghuaStore } from '../store/useYinghuaStore';
import { ResultView } from './ResultView';
import type { InpaintTarget } from '../types';

export function ZeroFateControls({ isCurrent, onGenerateDraft, onInpaintClick }: {
  isCurrent: boolean;
  onGenerateDraft: () => void;
  onInpaintClick: (src: string, target: InpaintTarget) => void;
}) {
  const mode = useYinghuaStore((s) => s.zeroFateMode);
  const setMode = useYinghuaStore((s) => s.setZeroFateMode);
  const draft = useYinghuaStore((s) => s.zeroFateDraft);
  const prompt = useYinghuaStore((s) => s.zeroFateDraftPrompt);
  const setPrompt = useYinghuaStore((s) => s.setZeroFateDraftPrompt);
  const active = useYinghuaStore((s) => s.activeGeneration);
  // A failed retry keeps the last usable draft visible and editable.
  const preview = draft.images[0] && draft.status !== 'loading' ? { ...draft, status: 'done' as const } : draft;
  return (
    <div className="mb-3 space-y-2">
      <div role="group" aria-label="零命生成模式" className="flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(active)} aria-pressed={mode === 'two-stage'}
          onClick={() => setMode('two-stage')}
          className={`glass-btn px-2 py-1.5 text-xs ${mode === 'two-stage' ? 'text-zzz-primary' : 'text-zzz-text/55'}`}>
          两阶段生成
        </button>
        <button type="button" disabled={Boolean(active)} aria-pressed={mode === 'direct'}
          onClick={() => setMode('direct')}
          className={`glass-btn px-2 py-1.5 text-xs ${mode === 'direct' ? 'text-zzz-primary' : 'text-zzz-text/55'}`}>
          直接生成
        </button>
      </div>
      {mode === 'two-stage' && (
        <div className="rounded-lg border border-zzz-text/10 bg-zzz-text/[0.02] p-2.5" aria-label="零命动作底稿">
          <p className="text-xs font-bold text-zzz-primary">第一阶段 · 动作底稿</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zzz-text/60">
            先生成无字全彩底稿，检查两腿连接、膝盖和遮挡，再确认转为零命剪影。每个阶段分别调用一次生图；底稿保留在当前页面，可单独重试或修改。
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-zzz-text/65">编辑底稿提示词</summary>
            <textarea aria-label="动作底稿提示词" value={prompt} onChange={(e) => setPrompt(e.target.value)}
              rows={5} className="glass-input mt-2 w-full resize-y px-2 py-2 text-xs leading-relaxed" />
          </details>
          {draft.images[0] && !isCurrent && (
            <p role="status" className="mt-2 text-[11px] text-zzz-magenta">角色、动作或底稿提示词已更新，请重新生成底稿。</p>
          )}
          {draft.error && <p role="alert" className="mt-2 text-[11px] text-red-400">{draft.error}</p>}
          <ResultView slot={preview} downloadPrefix="yinghua-action-draft"
            onInpaintClick={onInpaintClick} inpaintMeta={{ type: 'yinghua-draft' }} />
          {draft.images[0] && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => onInpaintClick(draft.images[0], { type: 'yinghua-draft', index: 0, url: draft.images[0] })}
                disabled={Boolean(active)} className="glass-btn flex-1 px-2 py-2 text-xs text-zzz-primary disabled:opacity-40">
                修改动作底稿
              </button>
              <button type="button" onClick={onGenerateDraft} disabled={Boolean(active)}
                className="glass-btn flex-1 px-2 py-2 text-xs text-zzz-text disabled:opacity-40">
                重新生成动作底稿
              </button>
            </div>
          )}
          {isCurrent && <p className="mt-2 text-[11px] text-zzz-text/60">检查结构无误后，点击下方“确认结构并生成零命”。底稿不会直接替代六命。</p>}
        </div>
      )}
    </div>
  );
}
