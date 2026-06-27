import { useCallback, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { fileToDataUrl, validateImageFile } from '../lib/validation';
import { extractPalette } from '../lib/colorExtract';
import { applyTheme, resetTheme } from '../lib/theme';
import { SectionHeader } from './SectionHeader';

/** Image upload with drag/drop, validation, preview and palette extraction. */
export function Uploader() {
  const { uploadedImage, uploadedName, setUpload, setPalette, clearUpload } = useStore();
  const showError = useToast((s) => s.show);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const check = validateImageFile(file);
      if (!check.ok) {
        showError(check.message ?? '文件校验失败');
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      setUpload(dataUrl, file.name);
      // Extract palette and theme the UI to the character's art.
      const palette = await extractPalette(dataUrl);
      setPalette(palette);
      applyTheme(palette);
    },
    [setUpload, setPalette, showError],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onClear = () => {
    clearUpload();
    resetTheme();
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="glass p-6">
      <SectionHeader step="01" title="上传三视图立绘" />
      <p className="mb-3 font-mono text-xs text-zzz-text/55">
        建议上传三视图成品以获得最佳生成效果。没有三视图？使用下方工作台生成 ↓
      </p>

      {!uploadedImage ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="拖拽或点击上传角色三视图立绘"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex h-56 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors duration-300 ${
            dragging
              ? 'border-zzz-magenta bg-zzz-text/5'
              : 'border-zzz-text/20 hover:border-zzz-primary/60'
          }`}
        >
          <span className="mb-2 text-4xl text-zzz-primary">⬆</span>
          <p className="text-sm text-zzz-text">拖拽图片到此 // 或点击选择</p>
          <p className="mt-1 font-mono text-xs text-zzz-text/50">PNG · JPEG · WEBP · ≤10MB</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl">
            <img
              src={uploadedImage}
              alt={uploadedName ?? '已上传图片'}
              className="max-h-72 w-full object-contain"
              loading="lazy"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="truncate font-mono text-xs text-zzz-text/50">{uploadedName}</span>
            <div className="flex gap-2">
              <button
                onClick={() => inputRef.current?.click()}
                className="glass-btn px-3 py-1.5 text-xs text-zzz-text"
              >
                更换
              </button>
              <button
                onClick={onClear}
                className="glass-btn px-3 py-1.5 text-xs text-zzz-text/70"
              >
                清除
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </section>
  );
}
