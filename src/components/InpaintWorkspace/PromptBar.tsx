import { useState, useEffect, useCallback, memo } from 'react';
import { useInpaintStore } from '../../store/useInpaintStore';
import { ApiError } from '../../lib/apiClient';
import { submitImageEdit } from '../../lib/submitImageEdit';
import { ONE_CLICK_LEG_REPAIR_INSTRUCTION } from '../../lib/oneClickLegRepair';
import { useToast } from '../../store/useToast';
import { ModeSwitch } from './ModeSwitch';

export const PromptBar = memo(function PromptBar() {
  const prompt = useInpaintStore((s) => s.prompt);
  const setPrompt = useInpaintStore((s) => s.setPrompt);
  const mode = useInpaintStore((s) => s.mode);
  const maskDataUrl = useInpaintStore((s) => s.maskDataUrl);
  const isGenerating = useInpaintStore((s) => s.isGenerating);
  const targetImage = useInpaintStore((s) => s.targetImage);
  const closeWorkspace = useInpaintStore((s) => s.closeWorkspace);
  const featherRadius = useInpaintStore((s) => s.featherRadius);
  const brushSize = useInpaintStore((s) => s.brushSize);
  const setBrushSize = useInpaintStore((s) => s.setBrushSize);
  const setFeatherRadius = useInpaintStore((s) => s.setFeatherRadius);

  const showError = useToast((s) => s.show);
  const [localPrompt, setLocalPrompt] = useState(prompt);

  useEffect(() => {
    setLocalPrompt(prompt);
  }, [prompt]);

  const handleGenerate = useCallback(async (preset?: string) => {
    if (useInpaintStore.getState().isGenerating) return;
    const instruction = (preset ?? localPrompt).trim();
    if (preset) { setPrompt(preset); setLocalPrompt(preset); }
    try {
      let currentMaskDataUrl: string | undefined;
      if (mode === 'precise') {
        if (!maskDataUrl) { showError('请先在画布上涂抹要编辑的区域'); return; }
        const canvas = window.__inpaintCanvas;
        canvas?.applyFeather();
        currentMaskDataUrl = canvas?.exportMask() ?? undefined;
        if (!currentMaskDataUrl) throw new ApiError('INVALID_INPUT', '无法导出重绘蒙版，请重新涂抹后重试');
      }
      await submitImageEdit({ instruction, editMode: mode, maskDataUrl: currentMaskDataUrl });
    } catch (error) {
      showError(error instanceof Error ? error.message : '生成失败');
    }
  }, [localPrompt, maskDataUrl, mode, setPrompt, showError]);

  return (
    <div className="border-t border-[var(--zzz-text)]/10 bg-[var(--zzz-ink)]/80 p-3 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-3">
        <ModeSwitch />

        <div className="relative min-w-[180px] flex-1">
          <textarea
            value={localPrompt}
            onChange={(e) => {
              setLocalPrompt(e.target.value);
              setPrompt(e.target.value);
            }}
            placeholder={
              mode === 'smart'
                ? '直接描述下一步改进，例如“让左眼高光更明显，其他不变”…'
                : '描述要对涂抹区域做什么修改…'
            }
            rows={1}
            className="w-full resize-none rounded-xl border border-black/20 bg-white px-4 py-2.5 font-mono text-sm text-black placeholder:text-black/45 focus:border-[var(--zzz-primary)]/70 focus:outline-none focus:shadow-[0_0_0_3px_var(--zzz-primary)]/15"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleGenerate();
              }
            }}
          />
        </div>

        {mode === 'precise' && (
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap font-mono text-[10px] text-[var(--zzz-text)]/40">
              笔刷 {brushSize}px
            </span>
            <input
              type="range"
              min="5"
              max="80"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="h-1 w-16 accent-[var(--zzz-primary)]"
            />
            <span className="whitespace-nowrap font-mono text-[10px] text-[var(--zzz-text)]/40">
              羽化 {featherRadius}px
            </span>
            <input
              type="range"
              min="0"
              max="30"
              value={featherRadius}
              onChange={(e) => setFeatherRadius(Number(e.target.value))}
              className="h-1 w-16 accent-[var(--zzz-primary)]"
            />
          </div>
        )}

        {(targetImage?.type === 'yinghua' || targetImage?.type === 'yinghua-draft') && (
          <button type="button" onClick={() => void handleGenerate(ONE_CLICK_LEG_REPAIR_INSTRUCTION)}
            disabled={isGenerating || (mode === 'precise' && !maskDataUrl)}
            title="优化当前版本的多余腿与错接；优先保留连接完整的上方腿，精确模式遵守当前选区"
            className="glass-btn px-3 py-2.5 font-mono text-xs text-[var(--zzz-primary)] disabled:opacity-40">
            一键修腿
          </button>
        )}

        <button
          onClick={() => void handleGenerate()}
          disabled={isGenerating || !localPrompt.trim() || (mode === 'precise' && !maskDataUrl)}
          className="glass-btn flex items-center gap-2 px-6 py-2.5 font-mono text-sm text-[var(--zzz-primary)] disabled:opacity-40"
        >
          {isGenerating ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--zzz-primary)]/30 border-t-[var(--zzz-primary)]" />
              生成中...
            </>
          ) : (
            <>✨ 继续生成</>
          )}
        </button>

        <button
          onClick={closeWorkspace}
          className="glass-btn px-3 py-2 font-mono text-xs text-[var(--zzz-text)]/60 hover:text-[var(--zzz-text)]"
        >
          ✕ 关闭
        </button>
      </div>
    </div>
  );
});
