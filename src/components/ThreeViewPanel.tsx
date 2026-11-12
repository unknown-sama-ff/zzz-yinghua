import { useCallback, useRef, useState } from 'react';
import { useUploadStore } from '../store/useUploadStore';
import { useProviderStore } from '../store/useProviderStore';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { useInpaintStore } from '../store/useInpaintStore';
import { useIdentityStore } from '../store/useIdentityStore';
import { useToast } from '../store/useToast';
import { validateImageFile, fileToDataUrl } from '../lib/validation';
import { refreshUploadPalette } from '../lib/uploadTheme';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';
import { ZoomButton } from './ImageLightbox';
import { memo } from 'react';
import { useCharacterSheetStore } from '../store/useCharacterSheetStore';
import { originalImagesForSource, uniqueImages } from '../lib/characterOriginals';
import { generateCharacterMaterials, canReuseMaterialThreeView } from '../lib/characterMaterials';

type ViewKey = 'front' | 'side' | 'back';

const VIEW_LABELS: Record<ViewKey, string> = { front: '正面', side: '侧面', back: '背面' };

const ViewSlot = memo(function ViewSlot({
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
          <ZoomButton src={dataUrl} alt={label} compact />
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
});

/** Section 03 — three-view generation workbench. */
export const ThreeViewPanel = memo(function ThreeViewPanel() {
  const threeViewUploads = useWorkbenchStore((s) => s.threeViewUploads);
  const setThreeViewUpload = useWorkbenchStore((s) => s.setThreeViewUpload);
  const threeViewPrompt = useWorkbenchStore((s) => s.threeViewPrompt);
  const setThreeViewPrompt = useWorkbenchStore((s) => s.setThreeViewPrompt);
  const threeViewSlot = useWorkbenchStore((s) => s.threeViewSlot);
  const materialsJob = useWorkbenchStore((s) => s.materialsJob);
  const setUpload = useUploadStore((s) => s.setUpload);
  const uploadedImage = useUploadStore((s) => s.uploadedImage);
  const provider = useProviderStore((s) => s.provider);
  const model = useProviderStore((s) => s.creds[s.provider].model);
  const characterName = useIdentityStore((s) => s.characterName);
  const originalsBySource = useCharacterSheetStore((s) => s.originalsBySource);
  const breakdownTemplate = useCharacterSheetStore((s) => s.promptTemplate);
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();
  const [readingUploads, setReadingUploads] = useState(0);
  const uploadingOriginals = useCharacterSheetStore((s) => uploadedImage ? s.sheets[uploadedImage]?.uploading : false);
  const selectionInputs = useRef({ source: uploadedImage, uploads: threeViewUploads });
  if (selectionInputs.current.source !== uploadedImage) selectionInputs.current = { source: uploadedImage, uploads: threeViewUploads };

  const handleFile = useCallback(
    async (view: ViewKey, file: File) => {
      const check = validateImageFile(file);
      if (!check.ok) {
        showError(check.message ?? '文件校验失败');
        return;
      }
      setReadingUploads((count) => count + 1);
      try { setThreeViewUpload(view, await fileToDataUrl(file)); }
      catch { showError('原始角色图读取失败，请重新选择'); }
      finally { setReadingUploads((count) => count - 1); }
    },
    [setThreeViewUpload, showError],
  );

  const useLinkedOriginals = Boolean(uploadedImage && originalsBySource[uploadedImage]?.length && selectionInputs.current.uploads === threeViewUploads);
  const originals = useLinkedOriginals ? originalImagesForSource(uploadedImage!, originalsBySource) : threeViewUploads.front
    ? uniqueImages([threeViewUploads.front, threeViewUploads.side, threeViewUploads.back])
    : originalImagesForSource(uploadedImage ?? '', originalsBySource);
  const input = { name: characterName.trim(), originals, threeViewPrompt, breakdownTemplate, provider, model };
  const busy = materialsJob?.status === 'loading' || threeViewSlot.status === 'loading' || readingUploads > 0 || uploadingOriginals;
  const canResume = canReuseMaterialThreeView(materialsJob, input);
  const run = async (includeBreakdown = false) => {
    if (!characterName.trim()) {
      showError('请先填写角色名字');
      document.getElementById('character-name')?.focus();
      return;
    }
    if (!originals.length) {
      showError('请先上传原始角色正面图片');
      return;
    }
    try {
      await generateCharacterMaterials(input, buildRequest, includeBreakdown);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败';
      showError(msg);
    }
  };

  const useAsMain = async (src: string) => {
    setUpload(src, 'three-view.png');
    if (await refreshUploadPalette(src)) showError('✓ 已设为主立绘，主题色已更新');
  };

  return (
    <section className="glass p-6" data-inpaint-zone="three-view">
        <SectionHeader title="三视图生成工作台" />

      <p className="mb-4 font-mono text-xs text-zzz-text/55">
        上传原始正面（必填）与原始侧面/背面（可选）。未单独上传正面时，使用当前角色关联的原图。三视图与拆解图分别生成，共享同一组原始参考。
      </p>
      {useLinkedOriginals && <p className="character-breakdown-hint">本次使用当前主图关联的原始参考（{originals.length}张）。如需改用其他角色，可重新上传下方正面图。</p>}

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
        onClick={() => void run(false)}
        disabled={!characterName.trim() || !originals.length || busy}
        className="glass-btn w-full py-2.5 font-mono text-sm uppercase tracking-widest text-zzz-text disabled:opacity-40"
      >
        {threeViewSlot.status === 'loading' ? '生成中…' : '生成三视图'}
      </button>
      <button type="button" onClick={() => void run(true)} disabled={!characterName.trim() || !originals.length || busy}
        className="glass-btn character-materials-generate">
        {materialsJob?.status === 'loading' ? (materialsJob.phase === 'three-view' ? '生成三视图中…' : '生成拆解图中…') : '一键生成角色素材'}
      </button>
      <p className="character-breakdown-hint">先生成三视图，再用原图和三视图生成独立拆解图，自动选用并配对；完整流程调用两次生图。{canResume ? '上次三视图已保留，再次点击仅重试拆解图。' : ''}</p>
      {materialsJob?.status === 'error' && <p role="alert" className="text-zzz-magenta">{materialsJob.error}</p>}
      {!characterName.trim() && <p className="mt-2 text-xs text-zzz-text/60">请先在上方填写角色名字，再生成三视图。</p>}

      <ResultView
        slot={threeViewSlot}
        downloadPrefix="three-view"
        saveInfo={threeViewSlot.images[0] ? {
          imageUrl: threeViewSlot.images[0],
          style: '三视图',
          characterName,
          prompt: threeViewPrompt,
          provider,
        } : undefined}
        onPick={(src) => void useAsMain(src)}
        pickLabel="用作主立绘"
        onInpaintClick={(_src, target) => {
          useInpaintStore.getState().openWorkspace(target);
        }}
        inpaintMeta={{ type: 'three-view' }}
      />
    </section>
  );
});
