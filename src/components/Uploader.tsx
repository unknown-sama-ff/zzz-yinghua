import { useCallback, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { fileToDataUrl, validateImageFile } from '../lib/validation';
import { extractPalette } from '../lib/colorExtract';
import { applyTheme, resetTheme } from '../lib/theme';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_SIZE } from '../lib/prompts';
import { downloadImage } from '../lib/download';
import { combineImagesSideBySide } from '../lib/combineImages';
import { useBuildRequest } from './useBuildRequest';
import { SectionHeader } from './SectionHeader';

/** Image upload with drag/drop, validation, preview and palette extraction. */
export function Uploader() {
  const uploadedImage = useStore((s) => s.uploadedImage);
  const uploadedName = useStore((s) => s.uploadedName);
  const setUpload = useStore((s) => s.setUpload);
  const setPalette = useStore((s) => s.setPalette);
  const clearUpload = useStore((s) => s.clearUpload);
  const costumeChangePrompt = useStore((s) => s.costumeChangePrompt);
  const setCostumeChangePrompt = useStore((s) => s.setCostumeChangePrompt);
  const costumeChangeSlot = useStore((s) => s.costumeChangeSlot);
  const setCostumeChangeSlot = useStore((s) => s.setCostumeChangeSlot);
  const costumeChangeHistory = useStore((s) => s.costumeChangeHistory);
  const addCostumeChangeImages = useStore((s) => s.addCostumeChangeImages);
  const clearCostumeChangeHistory = useStore((s) => s.clearCostumeChangeHistory);
  const costumeChangeRefImage = useStore((s) => s.costumeChangeRefImage);
  const setCostumeChangeRefImage = useStore((s) => s.setCostumeChangeRefImage);
  const provider = useStore((s) => s.provider);
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const check = validateImageFile(file);
      if (!check.ok) {
        showError(check.message ?? '文件校验失败');
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      setUpload(dataUrl, file.name);
      addCostumeChangeImages([dataUrl]);
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
    clearCostumeChangeHistory();
    setCostumeChangeRefImage(null);
    resetTheme();
    if (inputRef.current) inputRef.current.value = '';
    if (refInputRef.current) refInputRef.current.value = '';
  };

  return (
    <section className="glass flex flex-col p-6">
      <SectionHeader step="02" title="上传三视图立绘" />
      <p className="mb-3 font-mono text-xs text-zzz-text/55">
        建议上传三视图成品以获得最佳生成效果。没有三视图？使用上方工作台生成 ↑
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
          className={`flex min-h-56 flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors duration-300 ${
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
        <div className="flex flex-1 flex-col space-y-3">
          <div className="relative flex-1 overflow-hidden rounded-xl">
            <img
              src={uploadedImage}
              alt={uploadedName ?? '已上传图片'}
              className="h-full max-h-72 w-full object-contain"
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

      {/* Costume-change three-view section */}
      <div className="mt-4 border-t border-zzz-text/10 pt-4">
        <h3 className="mb-2 font-mono text-sm font-semibold text-zzz-text/80">角色换装三视图</h3>

        <div className="flex flex-col gap-4 sm:flex-row">
          {/* Left: image history */}
          <div className="flex-1">
            {costumeChangeHistory.length > 0 ? (
              <div className="max-h-96 space-y-3 overflow-y-auto px-1 py-1 pr-3">
                {costumeChangeHistory.map((src, i) => {
                  const isActive = src === uploadedImage;
                  return (
                  <div
                    key={i}
                    className={`group relative rounded-lg transition-shadow duration-300 ${
                      isActive
                        ? 'shadow-[inset_0_0_30px_color-mix(in_srgb,var(--zzz-primary)_65%,transparent),inset_0_0_8px_color-mix(in_srgb,var(--zzz-text)_30%,transparent)] ring-[3px] ring-zzz-primary'
                        : ''
                    }`}
                  >
                    <img
                      src={src}
                      alt={`换装结果 ${costumeChangeHistory.length - i}`}
                      className={`w-full object-contain bg-zzz-ink/40 ${isActive ? 'rounded-md' : 'rounded-lg'}`}
                      loading="lazy"
                    />
                    <div className="absolute bottom-0 right-0 flex gap-1 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={async () => {
                          setUpload(src, 'history-pick.png');
                          const p = await extractPalette(src);
                          setPalette(p);
                          applyTheme(p);
                        }}
                        className="glass-btn px-2 py-1 text-[10px] text-zzz-cyan"
                      >
                        用作主立绘
                      </button>
                      <button
                        onClick={() => void downloadImage(src, `costume-change-${costumeChangeHistory.length - i}.png`)}
                        className="glass-btn px-2 py-1 text-[10px] text-zzz-text"
                      >
                        下载
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center rounded-lg border-2 border-dashed border-zzz-text/20">
                <span className="font-mono text-xs text-zzz-text/40">
                  上传立绘或生成后图片将显示在此处
                </span>
              </div>
            )}
            {costumeChangeSlot.status === 'loading' && (
              <div className="mt-2 flex h-10 items-center justify-center rounded-lg border border-zzz-text/10 bg-zzz-text/[0.03]">
                <span className="font-mono text-xs tracking-widest text-zzz-primary animate-pulse">
                  GENERATING…
                </span>
              </div>
            )}
          </div>

          {/* Right: ref image + prompt + button */}
          <div className="w-full sm:w-56 sm:shrink-0">
            {/* Clothing reference image upload */}
            <div className="mb-2">
              <span className="font-mono text-[10px] text-zzz-text/45">服装参考</span>
              {costumeChangeRefImage ? (
                <div className="relative mt-1 overflow-hidden rounded-lg">
                  <img
                    src={costumeChangeRefImage}
                    alt="服装参考"
                    className="h-16 w-full object-contain bg-zzz-ink/40"
                  />
                  <button
                    onClick={() => {
                      setCostumeChangeRefImage(null);
                      if (refInputRef.current) refInputRef.current.value = '';
                    }}
                    className="glass-btn absolute right-0.5 top-0.5 px-1.5 py-0 text-xs text-zzz-text/70"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => refInputRef.current?.click()}
                  className="mt-1 flex h-16 w-full flex-col items-center justify-center rounded-lg border border-dashed border-zzz-text/20 text-[10px] text-zzz-text/40 transition-colors hover:border-zzz-primary/50 hover:text-zzz-text/60"
                >
                  <span className="text-lg">⬆</span>
                  上传参考图
                </button>
              )}
              <input
                ref={refInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const check = validateImageFile(file);
                  if (!check.ok) {
                    showError(check.message ?? '文件校验失败');
                    return;
                  }
                  const dataUrl = await fileToDataUrl(file);
                  setCostumeChangeRefImage(dataUrl);
                }}
              />
            </div>

            <textarea
              value={costumeChangePrompt}
              onChange={(e) => setCostumeChangePrompt(e.target.value)}
              rows={4}
              className="glass-input mb-2 w-full resize-y px-3 py-2 text-sm leading-relaxed"
            />

            <button
              onClick={async () => {
                if (!uploadedImage) {
                  showError('请先上传角色立绘');
                  return;
                }
                setCostumeChangeSlot({ status: 'loading', error: undefined, images: [] });
                let imageOverride: string | undefined;
                if (costumeChangeRefImage) {
                  try {
                    imageOverride = await combineImagesSideBySide(uploadedImage, costumeChangeRefImage);
                  } catch {
                    showError('参考图合成失败');
                    setCostumeChangeSlot({ status: 'error', error: '参考图合成失败', images: [] });
                    return;
                  }
                }
                generate(buildRequest(costumeChangePrompt, {
                  imageOverride,
                  ...(provider === 'seedream' ? { size: '2848x1600' } : { size: YINGHUA_SIZE })
                }))
                  .then((images) => {
                    setCostumeChangeSlot({ status: 'done', images });
                    addCostumeChangeImages(images);
                  })
                  .catch((err) => {
                    const msg = err instanceof ApiError ? err.message : '生成失败';
                    setCostumeChangeSlot({ status: 'error', error: msg, images: [] });
                    showError(msg);
                  });
              }}
              disabled={!uploadedImage || costumeChangeSlot.status === 'loading'}
              className="glass-btn w-full py-2 font-mono text-sm uppercase tracking-widest text-zzz-text disabled:opacity-40"
            >
              {costumeChangeSlot.status === 'loading' ? '生成中…' : '生成换装三视图'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
