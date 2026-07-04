import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_STYLES, YINGHUA_SIZE, fillName } from '../lib/prompts';
import { combineImagesSideBySide } from '../lib/combineImages';
import { stitchImages } from '../lib/stitchImages';
import { buildStyleReferenceSheet, preloadStyleReferenceSheets } from '../lib/styleReferences';
import { parseDataUrl, validateImageFile, fileToDataUrl } from '../lib/validation';
import { detectFace } from '../lib/detectFace';
import { computeClipRegions } from '../lib/clipRegions';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';
import type { GallerySaveInfo } from './GallerySaveButton';
import type { YinghuaStyleId } from '../types';

/** Section 2.4 — generate the three ZZZ yinghua action styles. */
export function YinghuaPanel() {
  const {
    characterName,
    yinghuaPrompts,
    setYinghuaPrompt,
    yinghuaSlots,
    setYinghuaSlot,
    yinghuaShowText,
    setYinghuaShowText,
    yinghuaActionPose,
    setYinghuaActionPose,
    yinghuaCharacterTraits,
    setYinghuaCharacterTraits,
    yinghuaAddonImage,
    setYinghuaAddonImage,
    uploadedImage,
    palette,
    provider,
    freeloadEnabled,
    visionCred,
    setViewerClipRegions,
    setDetectFaceError,
    setFaceBounds,
  } = useStore();
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();

  // Seed each style's editable prompt from its template once a name is known.
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      if (!yinghuaPrompts[style.id]) {
        setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName, palette ?? undefined, yinghuaShowText, yinghuaActionPose, yinghuaCharacterTraits));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fill prompts when the name changes.
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName, palette ?? undefined, yinghuaShowText, yinghuaActionPose, yinghuaCharacterTraits));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterName, yinghuaActionPose, yinghuaCharacterTraits]);

  // Re-fill prompts when palette changes (new image uploaded).
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName, palette ?? undefined, yinghuaShowText, yinghuaActionPose, yinghuaCharacterTraits));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, yinghuaActionPose, yinghuaCharacterTraits]);

  // Re-fill prompts when showText toggles.
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName, palette ?? undefined, yinghuaShowText, yinghuaActionPose, yinghuaCharacterTraits));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yinghuaShowText, yinghuaActionPose, yinghuaCharacterTraits]);

  // Warm the style reference sheets on mount so the first generate click
  // doesn't pay the cold-start fetch/decode/stitch cost.
  useEffect(() => {
    void preloadStyleReferenceSheets();
  }, []);

  const runFaceDetect = async (src: string) => {
    setDetectFaceError(null);
    try {
      const parsed = parseDataUrl(src);
      const bounds = await detectFace(parsed.base64, parsed.mime, freeloadEnabled
        ? { useServerPreset: true }
        : {
            apiKey: visionCred.apiKey || undefined,
            baseUrl: visionCred.baseUrl || undefined,
            model: visionCred.model || undefined,
          });
      setViewerClipRegions(computeClipRegions(bounds.faceTop, bounds.faceBottom));
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
    // 三命/六命 combine 零命 result (pose/text layout) + original upload (identity
    // and clothing colours) into a single side-by-side reference image. Then append
    // the matching style reference sheet so the model sees the target Mindscape visual language.
    let imageOverride: string | undefined;
    try {
      const styleSheet = await buildStyleReferenceSheet(id);
      if (id === 1) {
        imageOverride = await stitchImages([uploadedImage, yinghuaAddonImage, styleSheet]);
      } else {
        const baseImg = yinghuaSlots[1].images[0];
        if (!baseImg) {
          showError('请先生成零命，三命/六命需要零命结果锁定姿势与文字位置');
          return;
        }
        const paired = await combineImagesSideBySide(baseImg, uploadedImage);
        imageOverride = await stitchImages([paired, yinghuaAddonImage, styleSheet]);
      }
    } catch {
      showError('风格参考图合成失败');
      return;
    }
    setYinghuaSlot(id, { status: 'loading', error: undefined });
    try {
      const images = await generate(
        buildRequest(yinghuaPrompts[id], { size: YINGHUA_SIZE, imageOverride }),
      );
      setYinghuaSlot(id, { status: 'done', images });
      if (id === 3 && images[0]) void runFaceDetect(images[0]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setYinghuaSlot(id, { status: 'error', error: msg });
      showError(msg);
    }
  };

  return (
    <section className="glass p-6">
      <SectionHeader step="04" title="影画动作设计 · 三风格" />
      <div className="-mt-2 mb-4 rounded-lg border border-zzz-text/10 bg-zzz-text/[0.02] p-3 font-mono text-[11px] leading-relaxed text-zzz-text/55">
        <p className="mb-1.5 text-zzz-primary/80">
          ⛓ 先生成「零命」，三命/六命会将零命结果（姿势/构图/文字位置）与原始立绘（身份/服饰配色）合成双参考图；三种风格都会自动附加对应影画样式参考图，样张只用于风格，不用于角色身份。
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

        {/* Action pose input */}
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-[11px] text-zzz-text/45 whitespace-nowrap">动作姿势</span>
          <input
            type="text"
            value={yinghuaActionPose}
            onChange={(e) => setYinghuaActionPose(e.target.value)}
            placeholder="智能分析（留空自动生成）"
            className="glass-input flex-1 rounded px-2 py-1 font-mono text-xs text-zzz-text/90 placeholder:text-zzz-text/30"
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
        {YINGHUA_STYLES.map((style) => {
          const oneReady = yinghuaSlots[1].status === 'done' && Boolean(yinghuaSlots[1].images[0]);
          const needsBase = style.id !== 1 && !oneReady;
          return (
          <div
            key={style.id}
            className="flex flex-col rounded-xl border border-zzz-text/10 bg-zzz-text/[0.03] p-3"
          >
            <h3 className="font-mono text-sm font-bold text-zzz-magenta">{style.label}</h3>
            <p className="mb-2 mt-1 text-xs leading-relaxed text-zzz-text/55">{style.description}</p>
            <textarea
              value={yinghuaPrompts[style.id]}
              onChange={(e) => setYinghuaPrompt(style.id, e.target.value)}
              rows={5}
              className="glass-input w-full flex-1 resize-y px-2 py-2 text-xs leading-relaxed"
            />
            <button
              onClick={() => void run(style.id)}
              disabled={yinghuaSlots[style.id].status === 'loading' || needsBase}
              className="glass-btn mt-2 py-2 font-mono text-xs uppercase tracking-widest text-zzz-text disabled:opacity-40"
            >
              {needsBase ? '需先生成零命' : '生成'}
            </button>
            <ResultView
              slot={yinghuaSlots[style.id]}
              downloadPrefix={`yinghua-style${style.id}`}
              saveInfo={
                yinghuaSlots[style.id].images[0]
                  ? ({
                      imageUrl: yinghuaSlots[style.id].images[0],
                      style: style.label,
                      characterName,
                      prompt: yinghuaPrompts[style.id],
                      provider,
                    } satisfies GallerySaveInfo)
                  : undefined
              }
            />
          </div>
          );
        })}
      </div>
    </section>
  );
}
