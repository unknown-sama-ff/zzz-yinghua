import { useCallback, useState, memo } from 'react';
import { useInpaintStore } from '../../store/useInpaintStore';
import { useToast } from '../../store/useToast';
import { ToolPanel } from './ToolPanel';
import { CanvasEditor } from './CanvasEditor';
import { PromptBar } from './PromptBar';
import { canReplaceInpaintTarget, inpaintTargetLabel, replaceInpaintTarget } from '../../lib/inpaintTarget';

export const InpaintWorkspace = memo(function InpaintWorkspace() {
  const isWorkspaceOpen = useInpaintStore((s) => s.isWorkspaceOpen);
  const targetImage = useInpaintStore((s) => s.targetImage);
  const setTargetImage = useInpaintStore((s) => s.setTargetImage);
  const closeWorkspace = useInpaintStore((s) => s.closeWorkspace);
  const setMaskDataUrl = useInpaintStore((s) => s.setMaskDataUrl);
  const versions = useInpaintStore((s) => s.versions);
  const currentVersionId = useInpaintStore((s) => s.currentVersionId);
  const currentVersionUrl = useInpaintStore((s) => s.currentVersionUrl);
  const selectVersion = useInpaintStore((s) => s.selectVersion);
  const isGenerating = useInpaintStore((s) => s.isGenerating);

  const showError = useToast((s) => s.show);
  const [isApplying, setIsApplying] = useState(false);

  const applyCurrentVersion = async () => {
    if (!targetImage || !currentVersionUrl || isApplying) return;
    if (!canReplaceInpaintTarget(targetImage)) {
      showError('此图片仅可预览编辑结果，无法替换到可写模块');
      return;
    }
    setIsApplying(true);
    try {
      const replaced = await replaceInpaintTarget(targetImage, currentVersionUrl);
      if (!replaced) {
        showError('当前模块图片已更新，未覆盖较新的结果');
        return;
      }
      setTargetImage({ ...targetImage, url: currentVersionUrl });
      showError(`✓ 已应用到${inpaintTargetLabel(targetImage)}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleMaskEmpty = useCallback(() => {
    setMaskDataUrl(null);
  }, [setMaskDataUrl]);

  if (!isWorkspaceOpen || !targetImage || !currentVersionUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeWorkspace();
      }}
    >
      <div className="flex items-center justify-between gap-4 border-b border-[var(--zzz-text)]/10 bg-[var(--zzz-ink)]/80 px-4 py-3 backdrop-blur-md">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-sm font-bold tracking-wider text-[var(--zzz-primary)]">
              ✨ 连续编辑
            </h2>
            <span className="truncate font-mono text-[10px] text-[var(--zzz-text)]/40">
              {inpaintTargetLabel(targetImage)}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-[var(--zzz-text)]/45">
            当前版本会成为下一轮修改的图片上下文；未应用前不会覆盖页面原图。
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void applyCurrentVersion()}
            disabled={isApplying || isGenerating || !canReplaceInpaintTarget(targetImage)}
            title={canReplaceInpaintTarget(targetImage) ? '将当前草稿应用到原模块' : '预览图片无法替换到模块'}
            className="glass-btn px-3 py-1.5 font-mono text-xs text-[var(--zzz-primary)] disabled:opacity-40"
          >
            {isApplying ? '应用中…' : '应用当前版本'}
          </button>
          <button
            onClick={closeWorkspace}
            className="glass-btn px-3 py-1.5 font-mono text-xs text-[var(--zzz-text)]/70 hover:text-[var(--zzz-text)]"
          >
            ✕ 关闭
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--zzz-text)]/10 bg-[var(--zzz-ink)]/60 px-4 py-2.5">
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-[var(--zzz-text)]/45">
          <span>编辑版本 · 点击任一版本可从它继续修改</span>
          <span>{versions.length} 个版本</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {versions.map((version, index) => {
            const isCurrent = version.id === currentVersionId;
            const parentIndex = version.parentId
              ? versions.findIndex((candidate) => candidate.id === version.parentId)
              : -1;
            return (
              <button
                key={version.id}
                type="button"
                disabled={isGenerating}
                onClick={() => selectVersion(version.id)}
                className={`flex min-w-36 max-w-52 shrink-0 items-center gap-2 rounded-lg border p-1.5 text-left transition-colors disabled:cursor-not-allowed ${
                  isCurrent
                    ? 'border-[var(--zzz-primary)] bg-[var(--zzz-primary)]/15 shadow-[0_0_12px_var(--zzz-primary)]/20'
                    : 'border-[var(--zzz-text)]/15 bg-black/20 hover:border-[var(--zzz-primary)]/55'
                }`}
              >
                <img
                  src={version.url}
                  alt={index === 0 ? '原图' : `编辑版本 ${index}`}
                  className="h-10 w-12 rounded object-cover"
                />
                <span className="min-w-0 font-mono text-[10px] text-[var(--zzz-text)]/75">
                  <strong className="block truncate font-semibold text-[var(--zzz-text)]">
                    {index === 0 ? '原图' : `v${index}`}{parentIndex >= 0 && parentIndex !== index - 1 ? ` · 来自 v${parentIndex}` : ''}
                  </strong>
                  <span className="block truncate text-[var(--zzz-text)]/45">
                    {version.instruction ?? '会话起点'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ToolPanel />
        <CanvasEditor
          onMaskChange={(dataUrl) => setMaskDataUrl(dataUrl)}
          onMaskEmpty={handleMaskEmpty}
        />
      </div>

      <PromptBar />
    </div>
  );
});
