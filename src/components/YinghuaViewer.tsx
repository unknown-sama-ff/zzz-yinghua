import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { validateImageFile, fileToDataUrl, parseDataUrl } from '../lib/validation';
import { detectFace } from '../lib/detectFace';
import { computeClipRegions } from '../lib/clipRegions';
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
export function YinghuaViewer() {
  const {
    parts, togglePart, yinghuaSlots, setSlotManual,
    freeloadEnabled, visionCred, viewerClipRegions, setViewerClipRegions,
    detectFaceError, setDetectFaceError,
  } = useStore();
  const showError = useToast((s) => s.show);
  const [sweeping, setSweeping] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const isMobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const sectionRef = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const slotInputRefs = useRef<Record<YinghuaStyleId, HTMLInputElement | null>>({ 1: null, 2: null, 3: null });

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
        const parsed = parseDataUrl(src);
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
    }
  }, [fullscreen, isMobile]);

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
    const src = yinghuaSlots[3].images[0] || yinghuaSlots[1].images[0];
    if (src) void runFaceDetect(src);
  }, [yinghuaSlots, runFaceDetect]);

  const handleSlotUpload = useCallback(
    async (id: YinghuaStyleId, file: File) => {
      const check = validateImageFile(file);
      if (!check.ok) { showError(check.message ?? '文件校验失败'); return; }
      const dataUrl = await fileToDataUrl(file);
      setSlotManual(id, dataUrl);
      if (id === 1) void runFaceDetect(dataUrl);
    },
    [setSlotManual, showError, runFaceDetect],
  );

  // The three generated tiers; first image of each yinghua style slot.
  const tierImage = (id: 1 | 2 | 3): string | undefined => yinghuaSlots[id].images[0];
  const baseImg = tierImage(1); // 零命
  const hasBase = Boolean(baseImg);

  return (
    <section ref={sectionRef} className={`${fullscreen ? 'fixed inset-0 z-50 flex flex-col' : ''} glass overflow-hidden`}>
      <h2 className={`zzz-heading flex items-center gap-3 border-b border-zzz-text/10 p-4 text-lg text-zzz-text ${fullscreen ? 'hidden' : ''}`}>
        <span className="step-badge">05</span>
        影画查看器
        {hasBase && (
          <button
            onClick={toggleFullscreen}
            className="glass-btn ml-auto px-3 py-1 font-mono text-[10px] tracking-widest text-zzz-text"
          >
            {fullscreen ? '退出全屏' : '全屏'}
          </button>
        )}
      </h2>

      <div className={`flex flex-col md:flex-row ${fullscreen ? 'flex-1 min-h-0 flex-row items-stretch' : ''}`}>
        <ControlBar onToggle={handleToggle} fullscreen={fullscreen} />

        {/* Main stage */}
        <div
          className={`relative overflow-hidden bg-zzz-bg ${fullscreen ? 'flex-1 min-h-0 flex items-center justify-center' : 'aspect-[3/2] flex-1'} ${glitch ? 'fx-glitch' : ''}`}
        >
          {fullscreen ? (
            <div className="relative aspect-[3/2] h-full max-w-full">
              {baseImg && <img src={baseImg} alt="零命 底图" className="layer-part" data-visible="true" loading="lazy" />}
              {parts.map((p) => {
                const src = tierImage(p.styleId);
                if (!src || !p.visible) return null;
                const regionStyle = viewerClipRegions
                  ? { clipPath: [viewerClipRegions.r0, viewerClipRegions.r1, viewerClipRegions.r2][p.region] }
                  : {};
                return <img key={p.code} src={src} alt={`区域 ${p.code}`} data-visible="true" className={`layer-part fx-enter${viewerClipRegions ? '' : ` region-${p.region}`}`} style={regionStyle} loading="lazy" />;
              })}
              {sweeping && <div className="fx-sweep" />}
            </div>
          ) : (
            <>
              {baseImg && <img src={baseImg} alt="零命 底图" className="layer-part" data-visible="true" loading="lazy" />}
              {parts.map((p) => {
                const src = tierImage(p.styleId);
                if (!src || !p.visible) return null;
                const regionStyle = viewerClipRegions
                  ? { clipPath: [viewerClipRegions.r0, viewerClipRegions.r1, viewerClipRegions.r2][p.region] }
                  : {};
                return <img key={p.code} src={src} alt={`区域 ${p.code}`} data-visible="true" className={`layer-part fx-enter${viewerClipRegions ? '' : ` region-${p.region}`}`} style={regionStyle} loading="lazy" />;
              })}
              {sweeping && <div className="fx-sweep" />}
            </>
          )}

          {/* Fullscreen exit button */}
          {fullscreen && (
            <button
              onClick={toggleFullscreen}
              className="glass-btn absolute right-3 top-3 z-10 px-3 py-1.5 font-mono text-[10px] tracking-widest text-zzz-text"
            >
              退出全屏
            </button>
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
          { id: 3 as YinghuaStyleId, label: '04–06 = 六命对角区域' },
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
      </div>
    </section>
  );
}
