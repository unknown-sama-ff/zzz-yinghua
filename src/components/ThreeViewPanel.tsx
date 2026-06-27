import { useCallback, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_SIZE } from '../lib/prompts';
import { stitchImages } from '../lib/stitchImages';
import { validateImageFile, fileToDataUrl } from '../lib/validation';
import { extractPalette } from '../lib/colorExtract';
import { applyTheme } from '../lib/theme';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';

type ViewKey = 'front' | 'side' | 'back';

const VIEW_LABELS: Record<ViewKey, string> = { front: '正面', side: '侧面', back: '背面' };

function ViewSlot({
  label,
  dataUrl,
  onFile,
  onClear,
}: {
  label: string;
  dataUrl: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs text-zzz-text/60">{label}</span>
      {dataUrl ? (
        <div className="relative overflow-hidden rounded-lg">
          <img
            src={dataUrl}
            alt={label}
            className="h-28 w-full bg-zzz-ink/40 object-contain"
            loading="lazy"
          />
          <button
            onClick={onClear}
            className="glass-btn absolute right-1 top-1 px-2 py-0.5 text-[10px] text-zzz-text/70"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="flex h-28 flex-col items-center justify-center rounded-lg border-2 border-dashed border-zzz-text/20 transition-colors hover:border-zzz-primary/60"
        >
          <span className="text-2xl text-zzz-primary/60">⬆</span>
          <span className="mt-1 font-mono text-[10px] text-zzz-text/50">点击上传</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Section 03 — three-view generation workbench. */
export function ThreeViewPanel() {
  const {
    threeViewUploads,
    setThreeViewUpload,
    threeViewPrompt,
    setThreeViewPrompt,
    threeViewSlot,
    setThreeViewSlot,
    setUpload,
    setPalette,
  } = useStore();
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();

  const handleFile = useCallback(
    async (view: ViewKey, file: File) => {
      const check = validateImageFile(file);
      if (!check.ok) {
        showError(check.message ?? '文件校验失败');
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      setThreeViewUpload(view, dataUrl);
    },
    [setThreeViewUpload, showError],
  );

  const run = async () => {
    if (!threeViewUploads.front) {
      showError('请至少上传正面图片');
      return;
    }
    setThreeViewSlot({ status: 'loading', error: undefined, images: [] });
    try {
      const stitched = await stitchImages([
        threeViewUploads.front,
        threeViewUploads.side,
        threeViewUploads.back,
      ]);
      const images = await generate(
        buildRequest(threeViewPrompt, { imageOverride: stitched, size: YINGHUA_SIZE }),
      );
      setThreeViewSlot({ status: 'done', images });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setThreeViewSlot({ status: 'error', error: msg, images: [] });
      showError(msg);
    }
  };

  const useAsMain = async (src: string) => {
    setUpload(src, 'three-view.png');
    const palette = await extractPalette(src);
    setPalette(palette);
    applyTheme(palette);
    showError('✓ 已设为主立绘，主题色已更新');
  };

  return (
    <section className="glass p-6">
      <SectionHeader step="03" title="三视图生成工作台" />

      <p className="mb-4 font-mono text-xs text-zzz-text/55">
        上传正面（必填）+ 侧面/背面（可选），自动拼合后发给 AI 生成完整三视图。（建议上传 PNG 透明背景图；只上传正面可能效果不佳）
        生成完成后可将结果设为主立绘用于影画生成。
      </p>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {(['front', 'side', 'back'] as ViewKey[]).map((view) => (
          <ViewSlot
            key={view}
            label={VIEW_LABELS[view]}
            dataUrl={threeViewUploads[view]}
            onFile={(f) => void handleFile(view, f)}
            onClear={() => setThreeViewUpload(view, null)}
          />
        ))}
      </div>

      <textarea
        value={threeViewPrompt}
        onChange={(e) => setThreeViewPrompt(e.target.value)}
        rows={3}
        className="glass-input mb-3 w-full resize-y px-3 py-2 text-sm leading-relaxed"
      />

      <button
        onClick={() => void run()}
        disabled={!threeViewUploads.front || threeViewSlot.status === 'loading'}
        className="glass-btn w-full py-2.5 font-mono text-sm uppercase tracking-widest text-zzz-text disabled:opacity-40"
      >
        {threeViewSlot.status === 'loading' ? '生成中…' : '生成三视图'}
      </button>

      <ResultView
        slot={threeViewSlot}
        downloadPrefix="three-view"
        onPick={(src) => void useAsMain(src)}
        pickLabel="用作主立绘"
      />
    </section>
  );
}
