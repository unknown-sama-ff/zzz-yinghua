import { useState, useEffect, useCallback, memo } from 'react';
import { useInpaintStore } from '../../store/useInpaintStore';
import { inpaint, ApiError } from '../../lib/apiClient';
import { useToast } from '../../store/useToast';
import { ModeSwitch } from './ModeSwitch';

export const PromptBar = memo(function PromptBar({ onResult }: { onResult: (images: string[]) => void }) {
  const prompt = useInpaintStore((s) => s.prompt);
  const setPrompt = useInpaintStore((s) => s.setPrompt);
  const mode = useInpaintStore((s) => s.mode);
  const maskDataUrl = useInpaintStore((s) => s.maskDataUrl);
  const isGenerating = useInpaintStore((s) => s.isGenerating);
  const setIsGenerating = useInpaintStore((s) => s.setIsGenerating);
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

  const handleGenerate = useCallback(async () => {
    if (!targetImage) return;
    if (!localPrompt.trim()) {
      showError('请输入重绘提示词');
      return;
    }
    if (mode === 'precise' && !maskDataUrl) {
      showError('请先在画布上涂抹要编辑的区域');
      return;
    }

    setIsGenerating(true);
    try {
      // Apply feather before generating
      const canvas = (window as unknown as Record<string, unknown>).__inpaintCanvas;
      if (mode === 'precise' && canvas && typeof (canvas as Record<string, unknown>).applyFeather === 'function') {
        await (canvas as { applyFeather: () => void }).applyFeather();
      }

      const images = await inpaint({
        imageDataUrl: targetImage.url,
        maskDataUrl: mode === 'precise' ? maskDataUrl || undefined : undefined,
        maskBlobUrl: mode === 'precise'
          ? (window as unknown as Record<string, { getMaskBlobUrl: () => string | null }>).__inpaintCanvas?.getMaskBlobUrl?.() || undefined
          : undefined,
        prompt: localPrompt,
        provider: 'gpt-image',
      });
      onResult(images);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      showError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [targetImage, localPrompt, mode, maskDataUrl, setIsGenerating, onResult, showError]);

  return (
    <div className="border-t border-[var(--zzz-text)]/10 bg-[var(--zzz-ink)]/80 p-3 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {/* Mode switch */}
        <ModeSwitch />

        {/* Prompt input */}
        <div className="flex-1 relative">
          <textarea
            value={localPrompt}
            onChange={(e) => {
              setLocalPrompt(e.target.value);
              setPrompt(e.target.value);
            }}
            placeholder={
              mode === 'smart'
                ? '描述你想如何修改这张图片...'
                : '描述你想对涂抹区域做什么修改...'
            }
            rows={1}
            className="w-full resize-none rounded-xl border border-[var(--zzz-text)]/10 bg-[var(--zzz-bg)]/60 px-4 py-2.5 font-mono text-sm text-[var(--zzz-text)] placeholder:text-[var(--zzz-text)]/30 focus:border-[var(--zzz-primary)]/50 focus:outline-none focus:shadow-[0_0_0_3px_var(--zzz-primary)]/15"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleGenerate();
              }
            }}
          />
        </div>

        {/* Brush size slider (precise mode) */}
        {mode === 'precise' && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[var(--zzz-text)]/40 whitespace-nowrap">
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
            <span className="font-mono text-[10px] text-[var(--zzz-text)]/40 whitespace-nowrap">
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

        {/* Generate button */}
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
            <>🚀 生成</>
          )}
        </button>

        {/* Close button */}
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
