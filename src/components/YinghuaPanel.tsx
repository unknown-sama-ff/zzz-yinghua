import { useCallback, useEffect, useMemo, memo } from 'react';
import { useIdentityStore } from '../store/useIdentityStore';
import { useProviderStore } from '../store/useProviderStore';
import { useUploadStore } from '../store/useUploadStore';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { useYinghuaStore } from '../store/useYinghuaStore';
import { useViewerStore } from '../store/useViewerStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_STYLES, YINGHUA_SIZE, fillName, YINGHUA_UNDRESS_PASS, YINGHUA_UNDRESS_PASS_EN } from '../lib/prompts';
import { stitchImages, embedThumbnail } from '../lib/imageWorkerPool';
import { buildStyleReferenceSheet, preloadStyleReferenceSheets } from '../lib/styleReferences';
import { parseDataUrl, validateImageFile, fileToDataUrl, compressDataUrl } from '../lib/validation';
import { detectFace } from '../lib/detectFace';
import { computeClipRegions } from '../lib/clipRegions';
import { useBuildRequest } from './useBuildRequest';
import { useInpaintStore } from '../store/useInpaintStore';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';
import type { GallerySaveInfo } from './GallerySaveButton';
import type { GenSlot, YinghuaStyleId } from '../types';

// ---------------------------------------------------------------------------
// Per-style card — memoized so changes to one style don't re-render the others
// ---------------------------------------------------------------------------
const StyleCard = memo(function StyleCard({
  style,
  prompt,
  slot,
  characterName,
  provider,
  yinghuaSlots,
  onRun,
  onPromptChange,
  onInpaintClick,
}: {
  style: { id: YinghuaStyleId; label: string; description: string };
  prompt: string;
  slot: GenSlot;
  characterName: string;
  provider: string;
  yinghuaSlots: Record<YinghuaStyleId, GenSlot>;
  onRun: (id: YinghuaStyleId) => void;
  onPromptChange: (styleId: YinghuaStyleId, value: string) => void;
  onInpaintClick: (src: string) => void;
}) {
  const zeroReady = yinghuaSlots[1].status === 'done' && Boolean(yinghuaSlots[1].images[0]);
  // 链路：零命→三命→六命
  const needsBase = style.id === 2
    ? !zeroReady
    : style.id === 3
      ? !(yinghuaSlots[2].images[0])
      : false;

  return (
    <div
      className="flex flex-col rounded-xl border border-zzz-text/10 bg-zzz-text/[0.03] p-3"
    >
      <h3 className="font-mono text-sm font-bold text-zzz-magenta">{style.label}</h3>
      <p className="mb-2 mt-1 text-xs leading-relaxed text-zzz-text/55">{style.description}</p>
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(style.id, e.target.value)}
        rows={5}
        className="glass-input w-full flex-1 resize-y px-2 py-2 text-xs leading-relaxed"
      />
      <button
        onClick={() => onRun(style.id)}
        disabled={slot.status === 'loading' || needsBase}
        className="glass-btn mt-2 py-2 font-mono text-xs uppercase tracking-widest text-zzz-text disabled:opacity-40"
      >
        {needsBase
          ? (style.id === 2 ? '需先生成零命' : '需先生成三命')
          : '生成'}
      </button>
      <ResultView
        slot={slot}
        downloadPrefix={`yinghua-style${style.id}`}
        saveInfo={
          slot.images[0]
            ? ({
                imageUrl: slot.images[0],
                style: style.label,
                characterName,
                prompt,
                provider,
              } satisfies GallerySaveInfo)
            : undefined
        }
        onInpaintClick={onInpaintClick}
        inpaintMeta={{ type: 'yinghua', slotId: String(style.id), index: 0 }}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export const YinghuaPanel = memo(function YinghuaPanel() {
  // Per-field selectors so this component only re-renders on fields it reads.
  const characterName = useIdentityStore((s) => s.characterName);
  const yinghuaPrompts = useYinghuaStore((s) => s.yinghuaPrompts);
  const setYinghuaPrompt = useYinghuaStore((s) => s.setYinghuaPrompt);
  const yinghuaSlots = useYinghuaStore((s) => s.yinghuaSlots);
  const setYinghuaSlot = useYinghuaStore((s) => s.setYinghuaSlot);
  const yinghuaShowText = useYinghuaStore((s) => s.yinghuaShowText);
  const setYinghuaShowText = useYinghuaStore((s) => s.setYinghuaShowText);
  const yinghuaCharacterDynamic = useYinghuaStore((s) => s.yinghuaCharacterDynamic);
  const setYinghuaCharacterDynamic = useYinghuaStore((s) => s.setYinghuaCharacterDynamic);
  const yinghuaMicroDynamic = useYinghuaStore((s) => s.yinghuaMicroDynamic);
  const setYinghuaMicroDynamic = useYinghuaStore((s) => s.setYinghuaMicroDynamic);
  const yinghuaCharacterTraits = useYinghuaStore((s) => s.yinghuaCharacterTraits);
  const setYinghuaCharacterTraits = useYinghuaStore((s) => s.setYinghuaCharacterTraits);
  const yinghuaAddonImage = useYinghuaStore((s) => s.yinghuaAddonImage);
  const setYinghuaAddonImage = useYinghuaStore((s) => s.setYinghuaAddonImage);
  const yinghuaLang = useYinghuaStore((s) => s.yinghuaLang);
  const setYinghuaLang = useYinghuaStore((s) => s.setYinghuaLang);
  const uploadedImage = useUploadStore((s) => s.uploadedImage);
  const palette = useUploadStore((s) => s.palette);
  const provider = useProviderStore((s) => s.provider);
  const freeloadEnabled = useProviderStore((s) => s.freeloadEnabled);
  const creds = useProviderStore((s) => s.creds);
  const visionCred = useProviderStore((s) => s.visionCred);
  const setViewerClipRegions = useViewerStore((s) => s.setViewerClipRegions);
  const setDetectFaceError = useViewerStore((s) => s.setDetectFaceError);
  const setFaceBounds = useViewerStore((s) => s.setFaceBounds);
  const threeViewSlot = useWorkbenchStore((s) => s.threeViewSlot);
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();

  // Compute prompts once from all inputs, then write to store in one effect.
  const computedPrompts = useMemo(() => {
    const prompts: Record<number, string> = {};
    for (const style of YINGHUA_STYLES) {
      prompts[style.id] = fillName(
        yinghuaLang === 'en' && style.promptTemplateEn ? style.promptTemplateEn : style.promptTemplate,
        characterName, palette ?? undefined, yinghuaShowText,
        yinghuaCharacterDynamic, yinghuaMicroDynamic,
        yinghuaCharacterTraits, yinghuaLang, style.id,
      );
    }
    return prompts;
  }, [characterName, palette, yinghuaShowText, yinghuaCharacterDynamic,
      yinghuaMicroDynamic, yinghuaCharacterTraits, yinghuaLang]);

  useEffect(() => {
    for (const [id, prompt] of Object.entries(computedPrompts)) {
      setYinghuaPrompt(Number(id) as YinghuaStyleId, prompt);
    }
  }, [computedPrompts, setYinghuaPrompt]);

  // Warm the style reference sheets on mount.
  useEffect(() => {
    void preloadStyleReferenceSheets();
  }, []);

  const runFaceDetect = async (src: string) => {
    setDetectFaceError(null);
    try {
      let dataUrl = src;
      if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      const parsed = parseDataUrl(dataUrl);
      const bounds = await detectFace(parsed.base64, parsed.mime, freeloadEnabled
        ? { useServerPreset: true }
        : {
            apiKey: visionCred.apiKey || undefined,
            baseUrl: visionCred.baseUrl || undefined,
            model: visionCred.model || undefined,
          });
      setViewerClipRegions(computeClipRegions(bounds.faceTop, bounds.faceBottom, bounds.bodyAxisAngle));
      setFaceBounds(bounds);
    } catch (err) {
      setDetectFaceError(err instanceof Error ? err.message : '人脸检测失败');
    }
  };

  const run = async (id: YinghuaStyleId) => {
    if (!uploadedImage) {
      showError('请先上传角色正面图片');
      return;
    }
    if (!freeloadEnabled) {
      const cred = creds[provider];
      if (!cred.apiKey.trim()) {
        showError('请先在「接口与角色」模块填写 API Key');
        return;
      }
      if (!cred.baseUrl.trim()) {
        showError('请先在「接口与角色」模块填写 Base URL');
        return;
      }
    }
    let imageOverride: string | undefined;
    try {
      if (id === 1) {
        const styleSheet = await buildStyleReferenceSheet(id);
        imageOverride = await stitchImages([uploadedImage, yinghuaAddonImage, styleSheet]);
      } else {
        const baseImg = id === 3 ? yinghuaSlots[2].images[0] : yinghuaSlots[1].images[0];
        if (!baseImg) {
          showError(id === 3
            ? '请先生成三命，六命以三命成图为底图（姿态基准，就地撕衣露肤）'
            : '请先生成零命，三命需要零命结果锁定姿势与文字位置');
          return;
        }
        const threeView = threeViewSlot.images[0];
        imageOverride = threeView
          ? await embedThumbnail(baseImg, threeView)
          : baseImg;
      }

      if (provider === 'gpt-image' && imageOverride) {
        let src = imageOverride;
        if (src.startsWith('http://') || src.startsWith('https://')) {
          const res = await fetch(src);
          const blob = await res.blob();
          src = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        imageOverride = await compressDataUrl(src);
      }
    } catch {
      showError('风格参考图合成失败');
      return;
    }

    setYinghuaSlot(id, { status: 'loading', error: undefined });
    await Promise.resolve();

    try {
      const sizeOpts = provider === 'seedream'
        ? { size: '2848x1600', imageOverride }
        : { size: YINGHUA_SIZE, imageOverride };
      const images = await generate(
        buildRequest(yinghuaPrompts[id], sizeOpts),
      );

      if (id === 3 && images[0]) {
        const undressPrompt = yinghuaLang === 'en' ? YINGHUA_UNDRESS_PASS_EN : YINGHUA_UNDRESS_PASS;
        let finalImages = images;
        try {
          const threeView = threeViewSlot.images[0];
          let undressImageOverride = threeView
            ? await embedThumbnail(images[0], threeView)
            : images[0];

          if (provider === 'gpt-image' && undressImageOverride) {
            if (undressImageOverride.startsWith('http://') || undressImageOverride.startsWith('https://')) {
              const res = await fetch(undressImageOverride);
              const blob = await res.blob();
              undressImageOverride = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            }
            undressImageOverride = await compressDataUrl(undressImageOverride);
          }
          finalImages = await generate(
            buildRequest(undressPrompt, provider === 'seedream'
              ? { size: '2848x1600', imageOverride: undressImageOverride }
              : { size: YINGHUA_SIZE, imageOverride: undressImageOverride }),
          );
        } catch {
          showError('二次撕衣失败，保留一次成图（可重试生成）');
          finalImages = images;
        }

        setYinghuaSlot(3, { status: 'done', images: finalImages });
        await Promise.resolve();

        const capturedFinalImages = finalImages;
        const capturedPalette = palette;
        setTimeout(() => {
          if (capturedFinalImages[0]) {
            void runFaceDetect(capturedFinalImages[0]);
          }
          if (capturedPalette) {
            const root = document.documentElement.style;
            root.setProperty('--zzz-primary', capturedPalette.textTopBright);
            root.setProperty('--zzz-magenta', capturedPalette.textBottom);
            root.setProperty('--zzz-accent', capturedPalette.textBottom);
          }
        }, 0);
      } else {
        setYinghuaSlot(id, { status: 'done', images });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setYinghuaSlot(id, { status: 'error', error: msg });
      showError(msg);
    }
  };

  const handlePromptChange = useCallback((styleId: YinghuaStyleId, value: string) => {
    setYinghuaPrompt(styleId, value);
  }, [setYinghuaPrompt]);

  const handleInpaintClick = useCallback((src: string, styleId: YinghuaStyleId) => {
    const openWorkspace = useInpaintStore.getState().openWorkspace;
    openWorkspace({ url: src, type: 'yinghua', slotId: String(styleId), index: 0 });
  }, []);

  return (
    <section className="glass p-6" data-inpaint-zone="yinghua">
      <div className="flex items-center justify-between">
        <SectionHeader step="04" title="影画动作设计 · 三风格（生图时间可能较长，结果可能不理想，多抽几次卡）" />
        <button
          onClick={() => setYinghuaLang(yinghuaLang === 'zh' ? 'en' : 'zh')}
          className="glass-btn px-3 py-1.5 font-mono text-[10px] tracking-widest text-zzz-text"
        >
          {yinghuaLang === 'zh' ? '中 → EN' : 'EN → 中'}
        </button>
      </div>
      <div className="-mt-2 mb-4 rounded-lg border border-zzz-text/10 bg-zzz-text/[0.02] p-3 font-mono text-[11px] leading-relaxed text-zzz-text/55">
        <p className="mb-1.5 text-zzz-primary/80">
          ⛓ 生成顺序：零命 → 三命（编辑零命，锁姿态/文字，去饱和灰阶）→ 六命（编辑三命，锁脸位/大致身位/配色）。六命为【两遍生图】：先出连贯全彩图，再自动做一次专职「自然精简服装、顺势露肤」编辑，故耗时约翻倍；配色统一以三视图原色为准。
        </p>
        <button
          onClick={() => setYinghuaShowText(!yinghuaShowText)}
          className={`glass-btn py-1.5 px-3 font-mono text-xs uppercase tracking-widest ${
            yinghuaShowText ? 'text-zzz-primary' : 'text-zzz-text/50'
          }`}
        >
          {yinghuaShowText ? '文字：开' : '文字：关'}
        </button>
        <p className="mt-1 text-zzz-text/50">
          {yinghuaShowText
            ? 'prompt 中会生成角色名英文文字，AI 根据角色动作自动分配到最空旷的角落'
            : 'prompt 替换为"画面整洁不含任何文字"'}
        </p>

        {/* Character dynamic input */}
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-[11px] text-zzz-text/45 whitespace-nowrap">角色动态</span>
          <input
            type="text"
            value={yinghuaCharacterDynamic}
            onChange={(e) => setYinghuaCharacterDynamic(e.target.value)}
            className="glass-input flex-1 rounded px-2 py-1 font-mono text-xs text-zzz-text/90"
          />
        </div>

        {/* Micro-dynamic input */}
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[11px] text-zzz-text/45 whitespace-nowrap">微动态细节</span>
          <input
            type="text"
            value={yinghuaMicroDynamic}
            onChange={(e) => setYinghuaMicroDynamic(e.target.value)}
            className="glass-input flex-1 rounded px-2 py-1 font-mono text-xs text-zzz-text/90"
          />
        </div>

        {/* Character traits input */}
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[11px] text-zzz-text/45 whitespace-nowrap">角色特点</span>
          <input
            type="text"
            value={yinghuaCharacterTraits}
            onChange={(e) => setYinghuaCharacterTraits(e.target.value)}
            placeholder="性格、特性等（留空不注入）"
            className="glass-input flex-1 rounded px-2 py-1 font-mono text-xs text-zzz-text/90 placeholder:text-zzz-text/30"
          />
        </div>

        {/* Addon element image */}
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[11px] text-zzz-text/45 whitespace-nowrap">附加元素</span>
          {yinghuaAddonImage ? (
            <div className="relative flex-1 overflow-hidden rounded-lg border border-zzz-text/10 bg-zzz-text/[0.03]">
              <img src={yinghuaAddonImage} alt="附加元素" className="h-12 w-full object-contain" />
              <button
                onClick={() => setYinghuaAddonImage(null)}
                className="glass-btn absolute right-1 top-1 px-2 py-0 text-[10px] text-zzz-text/70"
              >
                ✕
              </button>
            </div>
          ) : (
            <label className="glass-input flex-1 cursor-pointer rounded px-2 py-2 font-mono text-[11px] text-zzz-text/45 hover:border-zzz-primary/45">
              上传元素图（武器/道具等）
              <input
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
                  setYinghuaAddonImage(dataUrl);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {YINGHUA_STYLES.map((style) => (
          <StyleCard
            key={style.id}
            style={style}
            prompt={yinghuaPrompts[style.id]}
            slot={yinghuaSlots[style.id]}
            characterName={characterName}
            provider={provider}
            yinghuaSlots={yinghuaSlots}
            onRun={run}
            onPromptChange={handlePromptChange}
            onInpaintClick={(src) => handleInpaintClick(src, style.id)}
          />
        ))}
      </div>
    </section>
  );
});
