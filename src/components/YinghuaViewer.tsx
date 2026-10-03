import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useProviderStore } from '../store/useProviderStore';
import { useYinghuaStore } from '../store/useYinghuaStore';
import { useViewerStore } from '../store/useViewerStore';
import { useToast } from '../store/useToast';
import { validateImageFile, fileToDataUrl, parseDataUrl } from '../lib/validation';
import { detectFace } from '../lib/detectFace';
import { computeClipRegions } from '../lib/clipRegions';
import { resolveYinghuaFaceImage } from '../lib/yinghuaFace';
import { downloadBlob } from '../lib/download';
import { renderYinghuaComposite } from '../lib/yinghuaComposite';
import { buildYinghuaLayers, containedImageRect, type YinghuaLayer } from '../lib/yinghuaLayers';
import { ControlBar } from './ControlBar';
import '../styles/viewer.css';
import type { YinghuaStyleId } from '../types';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Section 3 — the ZZZ yinghua viewer. Mirrors 六种样式/0~6.png:
 *  - 零命 (yinghua style 1) is the always-on base layer filling the stage.
 *  - 三命 (style 2) overlays on top, diagonally split into 3 regions → 01-03.
 *  - 六命 (style 3) overlays above that, split into 3 regions → 04-06.
 * Toggling a button reveals that diagonal region of the higher-tier image, so
 * the picture builds progressively from 零命 up to a full 六命, with a
 * programmatic transition (scanline sweep + glitch). Honors reduced-motion.
 */
/**
 * Shared stage content — identical for fullscreen and non-fullscreen modes.
 * Only the outer wrapper className differs, handled by the caller.
 */
const StageContent = memo(function StageContent({
  layers, sweeping, displayedSixFace, width, height, onLoad, onError,
}: {
  layers: readonly YinghuaLayer[];
  sweeping: boolean;
  displayedSixFace: 'front' | 'back' | undefined;
  width: number;
  height: number;
  onLoad: (layer: YinghuaLayer, image: HTMLImageElement) => void;
  onError: (layer: YinghuaLayer) => void;
}) {
  const previousFace = useRef(displayedSixFace);
  const previousParts = useRef(new Set(layers.map((layer) => layer.code)));
  const shouldFlip = Boolean(displayedSixFace && previousFace.current && previousFace.current !== displayedSixFace);
  useEffect(() => {
    previousFace.current = displayedSixFace;
    previousParts.current = new Set(layers.map((layer) => layer.code));
  }, [displayedSixFace, layers]);

  return (
    <div className="relative shrink-0" data-yinghua-artboard style={{ width, height }}>
      {layers.map((layer) => {
        const effect = Number(layer.code) >= 4 && shouldFlip
          ? 'fx-face-flip'
          : layer.code !== 'base' && !previousParts.current.has(layer.code) ? 'fx-enter' : '';
        return (
          <img
            key={layer.code}
            src={layer.src}
            alt={layer.code === 'base' ? '零命 底图' : `区域 ${layer.code}`}
            data-visible="true"
            className={`layer-part ${effect}`}
            style={layer.clipPath ? { clipPath: layer.clipPath } : undefined}
            onLoad={(event) => onLoad(layer, event.currentTarget)}
            onError={() => onError(layer)}
            decoding="async"
          />
        );
      })}
      {sweeping && <div className="fx-sweep" />}
    </div>
  );
});

export const YinghuaViewer = memo(function YinghuaViewer() {
  const parts = useViewerStore((s) => s.parts);
  const togglePart = useViewerStore((s) => s.togglePart);
  const yinghuaSlots = useYinghuaStore((s) => s.yinghuaSlots);
  const setYinghuaSlot = useYinghuaStore((s) => s.setYinghuaSlot);
  const style3Face = useYinghuaStore((s) => s.style3Face);
  const setSlotManual = useYinghuaStore((s) => s.setSlotManual);
  const freeloadEnabled = useProviderStore((s) => s.freeloadEnabled);
  const visionCred = useProviderStore((s) => s.visionCred);
  const viewerClipRegions = useViewerStore((s) => s.viewerClipRegions);
  const setViewerClipRegions = useViewerStore((s) => s.setViewerClipRegions);
  const setViewerFullscreen = useViewerStore((s) => s.setViewerFullscreen);
  const detectFaceError = useViewerStore((s) => s.detectFaceError);
  const setDetectFaceError = useViewerStore((s) => s.setDetectFaceError);
  const showError = useToast((s) => s.show);
  const [sweeping, setSweeping] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState<number>(16 / 9); // 默认 16:9
  const isMobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const exportInProgress = useRef(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [loadedLayers, setLoadedLayers] = useState<Record<string, string>>({});
  const [failedLayers, setFailedLayers] = useState<Record<string, string>>({});
  const timers = useRef<number[]>([]);
  const slotInputRefs = useRef<Record<string, HTMLInputElement | null>>({ 1: null, 2: null, 3: null, '3-front': null, '3-back': null });

  const baseImg = yinghuaSlots[1].images[0]; // 零命
  const hasBase = Boolean(baseImg);

  const layers = useMemo(
    () => buildYinghuaLayers(yinghuaSlots, parts, viewerClipRegions, style3Face),
    [yinghuaSlots, parts, viewerClipRegions, style3Face],
  );
  const displayedSixImage = resolveYinghuaFaceImage(yinghuaSlots[3].images, style3Face);
  const exportReady = hasBase && layers.every((layer) => loadedLayers[layer.code] === layer.src);
  const imageLoadFailed = layers.some((layer) => failedLayers[layer.code] === layer.src);
  const exportTitle = exportReady
    ? '按当前可见图层保存原始分辨率 PNG'
    : imageLoadFailed ? '图层图片加载失败，请重新上传后保存' : '请等待当前图层图片加载完成';
  const artboard = containedImageRect(stageSize.width, stageSize.height, imageAspectRatio, 1);

  const handleLayerLoad = useCallback((layer: YinghuaLayer, image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    setLoadedLayers((current) => current[layer.code] === layer.src ? current : { ...current, [layer.code]: layer.src });
    setFailedLayers((current) => {
      if (!current[layer.code]) return current;
      const next = { ...current };
      delete next[layer.code];
      return next;
    });
    if (layer.code === 'base') setImageAspectRatio(image.naturalWidth / image.naturalHeight);
  }, []);
  const handleLayerError = useCallback((layer: YinghuaLayer) => {
    setLoadedLayers((current) => {
      const next = { ...current };
      delete next[layer.code];
      return next;
    });
    setFailedLayers((current) => ({ ...current, [layer.code]: layer.src }));
  }, []);

  // Keep the actual artboard at the base image ratio even in fullscreen. Clip
  // polygons are then canvas-relative, not relative to viewport letterboxing.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateSize = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    updateSize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => timers.current.forEach((t) => clearTimeout(t));
  }, []);

  const handleToggle = useCallback(
    (code: string) => {
      togglePart(code);
      if (prefersReducedMotion()) return;
      setSweeping(true);
      setGlitch(true);
      timers.current.push(
        window.setTimeout(() => setGlitch(false), 220),
        window.setTimeout(() => setSweeping(false), 440),
      );
    },
    [togglePart],
  );

  const runFaceDetect = useCallback(
    async (src: string) => {
      setDetectFaceError(null);
      setDetecting(true);
      try {
        // Normalize remote URLs from upstream APIs to data URLs.
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
      } catch (err) {
        setDetectFaceError(err instanceof Error ? err.message : '人脸检测失败');
      } finally {
        setDetecting(false);
      }
    },
    [visionCred, freeloadEnabled, setViewerClipRegions, setDetectFaceError],
  );

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) {
      if (isMobile) {
        try { if ('orientation' in screen) (screen.orientation as any).unlock?.(); } catch {}
        try { await document.exitFullscreen(); } catch {}
      }
      setFullscreen(false);
      setViewerFullscreen(false);
    } else {
      if (isMobile) {
        const el = sectionRef.current;
        if (!el) return;
        try {
          await el.requestFullscreen();
          if ('orientation' in screen && (screen.orientation as any).lock) {
            await (screen.orientation as any).lock('landscape');
          }
        } catch {}
      }
      setFullscreen(true);
      setViewerFullscreen(true);
    }
  }, [fullscreen, isMobile, setViewerFullscreen]);

  useEffect(() => {
    if (!isMobile) return;
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setFullscreen(false);
        try { if ('orientation' in screen) (screen.orientation as any).unlock?.(); } catch {}
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [isMobile]);

  const handleRefreshClip = useCallback(() => {
    const displayedSixImage = resolveYinghuaFaceImage(yinghuaSlots[3].images, style3Face);
    if (yinghuaSlots[3].status !== 'done' || !displayedSixImage) {
      showError('请先完成六命图片生成');
      return;
    }
    void runFaceDetect(displayedSixImage.src);
  }, [yinghuaSlots, style3Face, runFaceDetect, showError]);

  const handleExportPng = useCallback(async () => {
    if (!exportReady || exportInProgress.current || !stageRef.current) return;
    exportInProgress.current = true;
    setExporting(true);
    const snapshot = layers.map((layer) => ({ ...layer }));
    const background = getComputedStyle(stageRef.current).backgroundColor;
    const selected = snapshot.filter((layer) => layer.code !== 'base').map((layer) => layer.code).join('-') || '零命';
    const sixSuffix = snapshot.some((layer) => Number(layer.code) >= 4)
      ? `-六命${displayedSixImage?.face === 'back' ? '阴' : '阳'}` : '';
    try {
      const blob = await renderYinghuaComposite(snapshot, background);
      downloadBlob(blob, `影画合成-${selected}${sixSuffix}.png`);
      showError('✓ 已导出当前图层 PNG');
    } catch (error) {
      showError(error instanceof Error ? `PNG 保存失败：${error.message}` : 'PNG 保存失败，请重试');
    } finally {
      exportInProgress.current = false;
      setExporting(false);
    }
  }, [exportReady, layers, displayedSixImage?.face, showError]);

  const handleSlotUpload = useCallback(
    async (id: YinghuaStyleId, file: File) => {
      const check = validateImageFile(file);
      if (!check.ok) { showError(check.message ?? '文件校验失败'); return; }
      const dataUrl = await fileToDataUrl(file);
      setSlotManual(id, dataUrl);
      if (id === 3) void runFaceDetect(dataUrl);
    },
    [setSlotManual, showError, runFaceDetect],
  );

  const handleSixSlotUpload = useCallback(
    async (id: YinghuaStyleId, file: File, face: 'front' | 'back') => {
      const check = validateImageFile(file);
      if (!check.ok) { showError(check.message ?? '文件校验失败'); return; }
      const dataUrl = await fileToDataUrl(file);
      const existing = yinghuaSlots[id].images;
      const newImages = [...existing];
      newImages[face === 'front' ? 0 : 1] = dataUrl;
      // Use setYinghuaSlot to preserve both front and back images
      setYinghuaSlot(id, { status: 'done', images: newImages });
      if (id === 3) void runFaceDetect(dataUrl);
    },
    [setYinghuaSlot, showError, runFaceDetect, yinghuaSlots],
  );

  return (
    <section ref={sectionRef} className={`${fullscreen ? 'fixed inset-0 z-50 flex flex-col' : 'flex flex-col'} glass overflow-hidden`}>
      <h2 className={`zzz-heading flex flex-wrap items-center gap-3 border-b border-zzz-text/10 p-4 text-lg text-zzz-text ${fullscreen ? 'hidden' : ''}`}>
        <span className="step-badge">05</span>
        影画查看器
        {hasBase && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void handleExportPng()}
              disabled={!exportReady || exporting}
              className="glass-btn px-3 py-1 font-mono text-[10px] tracking-widest text-zzz-primary disabled:opacity-40"
              title={exportTitle}
              aria-busy={exporting}
            >
              {exporting ? '保存中…' : '保存当前 PNG'}
            </button>
            <button
              onClick={toggleFullscreen}
              className="glass-btn px-3 py-1 font-mono text-[10px] tracking-widest text-zzz-text"
            >
              {fullscreen ? '退出全屏' : '全屏'}
            </button>
          </div>
        )}
      </h2>

      <div className={`flex flex-col md:flex-row ${fullscreen ? 'flex-1 min-h-0 flex-row items-stretch' : 'flex-1 min-h-0'}`}>
        <ControlBar onToggle={handleToggle} fullscreen={fullscreen} />

        {/* Main stage */}
        <div
          ref={stageRef}
          className={`flex-1 min-h-0 relative overflow-hidden bg-zzz-bg flex items-center justify-center ${glitch ? 'fx-glitch' : ''}`}
          style={{ aspectRatio: `${imageAspectRatio}` }}
        >
          <StageContent
            layers={layers}
            sweeping={sweeping}
            displayedSixFace={displayedSixImage?.face}
            width={artboard.width}
            height={artboard.height}
            onLoad={handleLayerLoad}
            onError={handleLayerError}
          />

          {/* Fullscreen exit button */}
          {fullscreen && (
            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
              {hasBase && (
                <button
                  onClick={() => void handleExportPng()}
                  disabled={!exportReady || exporting}
                  className="glass-btn px-3 py-1.5 font-mono text-[10px] tracking-widest text-zzz-primary disabled:opacity-40"
                >
                  {exporting ? '保存中…' : '保存 PNG'}
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="glass-btn px-3 py-1.5 font-mono text-[10px] tracking-widest text-zzz-text"
              >
                退出全屏
              </button>
            </div>
          )}

          {/* Empty-state hint */}
          {!hasBase && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="glass px-4 py-2 text-center font-mono text-xs text-zzz-text/70">
                尚未生成影画 // 先在上方 04 模块生成三种风格
                <br />（零命=底图，三命/六命=按钮揭示的对角区域）
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Legend + manual upload */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zzz-text/10 p-3">
        {imageLoadFailed && (
          <p role="alert" className="w-full font-mono text-[11px] text-red-400">
            图层图片加载失败，请重新上传对应图片后保存 PNG。
          </p>
        )}
        {/* Face detection status — refresh button always visible when 零命 exists */}
        <div className="flex w-full items-center gap-2">
          {detecting && (
            <span className="font-mono text-[11px] text-zzz-text/60">裁切中…</span>
          )}
          {!detecting && detectFaceError && (
            <span className="font-mono text-[11px] text-red-400">{detectFaceError}</span>
          )}
          {!detecting && !detectFaceError && viewerClipRegions && (
            <span className="font-mono text-[11px] text-zzz-primary/70">✓ 已动态裁切</span>
          )}
          {!detecting && !detectFaceError && !viewerClipRegions && hasBase && (
            <span className="font-mono text-[11px] text-zzz-text/40">动态裁切未运行</span>
          )}
          {hasBase && (
            <button
              onClick={handleRefreshClip}
              disabled={detecting}
              className="glass-btn px-2 py-0.5 font-mono text-[10px] text-zzz-magenta disabled:opacity-40"
            >
              {detecting ? '裁切中…' : '重新裁切'}
            </button>
          )}
        </div>

        {([
          { id: 1 as YinghuaStyleId, label: '零命 = 底图（始终显示）' },
          { id: 2 as YinghuaStyleId, label: '01–03 = 三命对角区域' },
        ] as const).map(({ id, label }) => (
          <div key={id} className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-zzz-text/55">{label}</span>
            <button
              onClick={() => slotInputRefs.current[id]?.click()}
              className="glass-btn px-2 py-0.5 font-mono text-[10px] text-zzz-text/70"
            >
              上传
            </button>
            <input
              ref={(el) => { slotInputRefs.current[id] = el; }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleSlotUpload(id, f);
                e.target.value = '';
              }}
            />
          </div>
        ))}
        {/* 六命分阳阴上传 */}
        {[
          { face: 'front' as const, label: '04–06 = 六命阳' },
          { face: 'back' as const, label: '04–06 = 六命阴' },
        ].map(({ face, label }) => (
          <div key={face} className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-zzz-text/55">{label}</span>
            <button
              onClick={() => slotInputRefs.current[`3-${face}`]?.click()}
              className="glass-btn px-2 py-0.5 font-mono text-[10px] text-zzz-text/70"
            >
              上传
            </button>
            <input
              ref={(el) => { slotInputRefs.current[`3-${face}`] = el; }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleSixSlotUpload(3, f, face);
                e.target.value = '';
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
});
