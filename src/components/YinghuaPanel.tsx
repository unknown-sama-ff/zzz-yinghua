import { useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_STYLES, YINGHUA_SIZE, fillName, YINGHUA_UNDRESS_PASS, YINGHUA_UNDRESS_PASS_EN } from '../lib/prompts';
import { stitchImages, embedThumbnail } from '../lib/stitchImages';
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
  // Per-field selectors so this component only re-renders on fields it reads.
  const characterName = useStore((s) => s.characterName);
  const yinghuaPrompts = useStore((s) => s.yinghuaPrompts);
  const setYinghuaPrompt = useStore((s) => s.setYinghuaPrompt);
  const yinghuaSlots = useStore((s) => s.yinghuaSlots);
  const setYinghuaSlot = useStore((s) => s.setYinghuaSlot);
  const yinghuaShowText = useStore((s) => s.yinghuaShowText);
  const setYinghuaShowText = useStore((s) => s.setYinghuaShowText);
  const yinghuaCharacterDynamic = useStore((s) => s.yinghuaCharacterDynamic);
  const setYinghuaCharacterDynamic = useStore((s) => s.setYinghuaCharacterDynamic);
  const yinghuaMicroDynamic = useStore((s) => s.yinghuaMicroDynamic);
  const setYinghuaMicroDynamic = useStore((s) => s.setYinghuaMicroDynamic);
  const yinghuaCharacterTraits = useStore((s) => s.yinghuaCharacterTraits);
  const setYinghuaCharacterTraits = useStore((s) => s.setYinghuaCharacterTraits);
  const yinghuaAddonImage = useStore((s) => s.yinghuaAddonImage);
  const setYinghuaAddonImage = useStore((s) => s.setYinghuaAddonImage);
  const yinghuaLang = useStore((s) => s.yinghuaLang);
  const setYinghuaLang = useStore((s) => s.setYinghuaLang);
  const uploadedImage = useStore((s) => s.uploadedImage);
  const palette = useStore((s) => s.palette);
  const provider = useStore((s) => s.provider);
  const freeloadEnabled = useStore((s) => s.freeloadEnabled);
  const visionCred = useStore((s) => s.visionCred);
  const setViewerClipRegions = useStore((s) => s.setViewerClipRegions);
  const setDetectFaceError = useStore((s) => s.setDetectFaceError);
  const setFaceBounds = useStore((s) => s.setFaceBounds);
  const threeViewSlot = useStore((s) => s.threeViewSlot);
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
      const parsed = parseDataUrl(src);
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
    // 零命 uses the original upload + addon + style sheet.
    // 三命(2) 编辑 零命(1)——锁姿态/文字，做去饱和灰阶。
    // 六命(3) 编辑 三命(2)——三命形体清晰、同姿态，便于"就地撕衣"露肤且脸位/身位与前两张一致。
    // 三命/六命都在角落嵌入三视图缩略图作为单张 imageOverride——配色参考 + 位置锁定。
    let imageOverride: string | undefined;
    try {
      if (id === 1) {
        const styleSheet = await buildStyleReferenceSheet(id);
        imageOverride = await stitchImages([uploadedImage, yinghuaAddonImage, styleSheet]);
      } else {
        // 三命(2) edit 零命(1)；六命(3) edit 三命(2)。
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
    } catch {
      showError('风格参考图合成失败');
      return;
    }
    setYinghuaSlot(id, { status: 'loading', error: undefined });
    try {
      const images = await generate(
        buildRequest(yinghuaPrompts[id], { size: YINGHUA_SIZE, imageOverride }),
      );
      if (id === 3 && images[0]) {
        // 第二遍：专职撕衣露肤。编辑第一遍成图（干净全彩、脸/身/色/字已锁定），
        // 单一任务只改服装，其余逐像素保全——避开"保全 vs 撕衣"在同一次调用里的冲突。
        const undressPrompt = yinghuaLang === 'en' ? YINGHUA_UNDRESS_PASS_EN : YINGHUA_UNDRESS_PASS;
        let finalImages = images;
        try {
          finalImages = await generate(
            buildRequest(undressPrompt, { size: YINGHUA_SIZE, imageOverride: images[0] }),
          );
        } catch {
          // 第二遍失败：保留第一遍连贯全彩图，不丢弃。
          showError('二次撕衣失败，保留一次成图（可重试生成）');
          finalImages = images;
        }
        setYinghuaSlot(3, { status: 'done', images: finalImages });
        if (finalImages[0]) {
          void runFaceDetect(finalImages[0]);
          if (palette) {
            const root = document.documentElement.style;
            root.setProperty('--zzz-primary', palette.textTopBright);
            root.setProperty('--zzz-magenta', palette.textBottom);
            root.setProperty('--zzz-accent', palette.textBottom);
          }
        }
      } else {
        setYinghuaSlot(id, { status: 'done', images });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setYinghuaSlot(id, { status: 'error', error: msg });
      showError(msg);
    }
  };

  return (
    <section className="glass p-6">
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
          ⛓ 生成顺序：零命 → 三命（编辑零命，锁姿态/文字，去饱和灰阶）→ 六命（编辑三命，锁脸位/大致身位/配色）。六命为【两遍生图】：先出连贯全彩图，再自动做一次专职「撕衣露肤」编辑，故耗时约翻倍；配色统一以三视图原色为准。
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
        {YINGHUA_STYLES.map((style) => {
          const zeroReady = yinghuaSlots[1].status === 'done' && Boolean(yinghuaSlots[1].images[0]);
          const threeReady = yinghuaSlots[2].status === 'done' && Boolean(yinghuaSlots[2].images[0]);
          // 链路：零命→三命→六命。三命(2)依赖零命(1)；六命(3)依赖三命(2)。
          const needsBase = (style.id === 2 && !zeroReady) || (style.id === 3 && !threeReady);
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
              {needsBase ? (style.id === 3 ? '需先生成三命' : '需先生成零命') : '生成'}
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
