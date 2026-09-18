import { useState, useEffect, useCallback, memo } from 'react';
import { useInpaintStore } from '../../store/useInpaintStore';
import { inpaint, ApiError } from '../../lib/apiClient';
import { buildContextualEditPrompt } from '../../lib/inpaintPrompt';
import { useToast } from '../../store/useToast';
import { useProviderStore } from '../../store/useProviderStore';
import { ModeSwitch } from './ModeSwitch';

export const PromptBar = memo(function PromptBar() {
  const prompt = useInpaintStore((s) => s.prompt);
  const setPrompt = useInpaintStore((s) => s.setPrompt);
  const mode = useInpaintStore((s) => s.mode);
  const maskDataUrl = useInpaintStore((s) => s.maskDataUrl);
  const isGenerating = useInpaintStore((s) => s.isGenerating);
  const setIsGenerating = useInpaintStore((s) => s.setIsGenerating);
  const targetImage = useInpaintStore((s) => s.targetImage);
  const currentVersionId = useInpaintStore((s) => s.currentVersionId);
  const currentVersionUrl = useInpaintStore((s) => s.currentVersionUrl);
  const appendVersion = useInpaintStore((s) => s.appendVersion);
  const closeWorkspace = useInpaintStore((s) => s.closeWorkspace);
  const featherRadius = useInpaintStore((s) => s.featherRadius);
  const brushSize = useInpaintStore((s) => s.brushSize);
  const setBrushSize = useInpaintStore((s) => s.setBrushSize);
  const setFeatherRadius = useInpaintStore((s) => s.setFeatherRadius);
  const gptCredentials = useProviderStore((s) => s.creds['gpt-image']);
  const freeloadEnabled = useProviderStore((s) => s.freeloadEnabled);

  const showError = useToast((s) => s.show);
  const [localPrompt, setLocalPrompt] = useState(prompt);

  useEffect(() => {
    setLocalPrompt(prompt);
  }, [prompt]);

  const handleGenerate = useCallback(async () => {
    if (!targetImage || !currentVersionId || !currentVersionUrl) return;
    const instruction = localPrompt.trim();
    if (!instruction) {
      showError('请输入修改说明');
      return;
    }
    if (mode === 'precise' && !maskDataUrl) {
      showError('请先在画布上涂抹要编辑的区域');
      return;
    }
    if (!freeloadEnabled && !gptCredentials.apiKey.trim()) {
      showError('请先在「接口与角色」模块填写 gpt-image API Key');
      return;
    }
    if (!freeloadEnabled && !gptCredentials.baseUrl.trim()) {
      showError('请先在「接口与角色」模块填写 gpt-image Base URL');
      return;
    }

    setIsGenerating(true);
    try {
      const canvas = window.__inpaintCanvas;
      let currentMaskDataUrl: string | undefined;
      if (mode === 'precise') {
        canvas?.applyFeather();
        currentMaskDataUrl = canvas?.exportMask() ?? undefined;
        if (!currentMaskDataUrl) {
          showError('无法导出重绘蒙版，请重新涂抹后重试');
          return;
        }
      }

      const images = await inpaint({
        imageDataUrl: currentVersionUrl,
        maskDataUrl: currentMaskDataUrl,
        prompt: buildContextualEditPrompt(instruction, mode),
        provider: 'gpt-image',
        apiKey: gptCredentials.apiKey.trim() || undefined,
        baseUrl: gptCredentials.baseUrl.trim() || undefined,
        model: gptCredentials.model.trim() || undefined,
        useServerPreset: freeloadEnabled,
      });
      if (!images[0] || !appendVersion(images[0], instruction, currentVersionId)) {
        showError('生成结果无法加入当前编辑会话，请重新打开图片后重试');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      showError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [targetImage, currentVersionId, currentVersionUrl, localPrompt, mode, maskDataUrl, gptCredentials, freeloadEnabled, appendVersion, setIsGenerating, showError]);

  return (
    <div className="border-t border-[var(--zzz-text)]/10 bg-[var(--zzz-ink)]/80 p-3 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <ModeSwitch />

        <div className="relative flex-1">
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
