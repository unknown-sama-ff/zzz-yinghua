import { useEffect, useState, useCallback, memo } from 'react';
import { useInpaintStore } from '../../store/useInpaintStore';
import { useToast } from '../../store/useToast';
import { ToolPanel } from './ToolPanel';
import { CanvasEditor } from './CanvasEditor';
import { PromptBar } from './PromptBar';

export const InpaintWorkspace = memo(function InpaintWorkspace() {
  const isWorkspaceOpen = useInpaintStore((s) => s.isWorkspaceOpen);
  const targetImage = useInpaintStore((s) => s.targetImage);
  const closeWorkspace = useInpaintStore((s) => s.closeWorkspace);
  const setMode = useInpaintStore((s) => s.setMode);
  const setMaskDataUrl = useInpaintStore((s) => s.setMaskDataUrl);

  const showError = useToast((s) => s.show);
  const [resultImages, setResultImages] = useState<string[]>([]);

  // Reset to smart mode when opening
  useEffect(() => {
    if (isWorkspaceOpen) {
      setMode('smart');
      setResultImages([]);
    }
  }, [isWorkspaceOpen, setMode]);

  const handleResult = (images: string[]) => {
    setResultImages(images);
  };

  const handleClose = () => {
    if (targetImage) {
      // If there are results, the parent component should handle replacement
      // For now, just close
    }
    closeWorkspace();
  };

  const handleMaskEmpty = useCallback(() => {
    // Keep mask but note it's empty
  }, []);

  if (!isWorkspaceOpen || !targetImage) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={(e) => {
        // Close on backdrop click (not on children)
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-[var(--zzz-text)]/10 bg-[var(--zzz-ink)]/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <h2 className="font-mono text-sm font-bold tracking-wider text-[var(--zzz-primary)]">
            🎨 局部重绘
          </h2>
          <span className="font-mono text-[10px] text-[var(--zzz-text)]/40">
            {targetImage.type === 'yinghua' ? '影画结果' : targetImage.type === 'gallery' ? '画廊作品' : '图片'}
            {targetImage.slotId && ` · ${targetImage.slotId === '1' ? '零命' : targetImage.slotId === '2' ? '三命' : '六命'}`}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Result images preview */}
          {resultImages.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-[var(--zzz-text)]/40">生成结果：</span>
              {resultImages.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`result-${i}`}
                  className="h-12 w-16 cursor-pointer rounded border border-[var(--zzz-primary)]/30 object-cover hover:border-[var(--zzz-primary)]"
                  onClick={() => {
                    // In a real implementation, this would replace the target image
                    // For now, just show a message
                    showError('结果已生成（替换功能需要集成到父组件）');
                  }}
                />
              ))}
            </div>
          )}

          <button
            onClick={handleClose}
            className="glass-btn px-3 py-1.5 font-mono text-xs text-[var(--zzz-text)]/70 hover:text-[var(--zzz-text)]"
          >
            ✕ 关闭
          </button>
        </div>
      </div>

      {/* Main content: toolbar + canvas */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left toolbar */}
        <ToolPanel />

        {/* Center canvas */}
        <CanvasEditor
          onMaskChange={(dataUrl) => setMaskDataUrl(dataUrl)}
          onMaskEmpty={handleMaskEmpty}
        />
      </div>

      {/* Bottom bar */}
      <PromptBar onResult={handleResult} />
    </div>
  );
});
