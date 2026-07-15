import { useCallback, useEffect, useRef, useState } from 'react';
import { useInpaintStore } from '../../store/useInpaintStore';

export function CanvasEditor({
  onMaskChange,
  onMaskEmpty,
}: {
  onMaskChange: (dataUrl: string) => void;
  onMaskEmpty: () => void;
}) {
  const { mode, tool, brushSize, featherRadius, pushHistory, setMaskDataUrl } = useInpaintStore((s) => s);
  const targetImage = useInpaintStore((s) => s.targetImage);
  const isWorkspaceOpen = useInpaintStore((s) => s.isWorkspaceOpen);

  const displayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [themeColor, setThemeColor] = useState(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--zzz-primary').trim() || '#b026ff',
  );

  const isDrawingRef = useRef(false);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const rectPreviewRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Watch theme color changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeColor(getComputedStyle(document.documentElement).getPropertyValue('--zzz-primary').trim() || '#b026ff');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);

  // Parse hex color to RGB
  const hexToRgb = useCallback((hex: string): { r: number; g: number; b: number } => {
    const m = hex.replace('#', '').match(/../g);
    if (!m || m.length < 3) return { r: 176, g: 38, b: 255 };
    return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
  }, []);

  // Redraw: image + mask overlay
  const redraw = useCallback(() => {
    const display = displayRef.current;
    const mask = maskRef.current;
    const overlay = overlayRef.current;
    if (!display || !mask || !overlay || !originalImgRef.current) return;

    const w = imageSize.width;
    const h = imageSize.height;
    if (w === 0 || h === 0) return;

    const dCtx = display.getContext('2d');
    const mCtx = mask.getContext('2d');
    const oCtx = overlay.getContext('2d');
    if (!dCtx || !mCtx || !oCtx) return;

    // 1. Draw original image
    dCtx.drawImage(originalImgRef.current, 0, 0);

    // 2. Build overlay: theme color masked by user strokes
    const { r, g, b } = hexToRgb(themeColor);
    oCtx.clearRect(0, 0, w, h);
    oCtx.fillStyle = `rgb(${r},${g},${b})`;
    oCtx.fillRect(0, 0, w, h);
    oCtx.globalCompositeOperation = 'destination-in';
    oCtx.drawImage(mask, 0, 0);
    oCtx.globalCompositeOperation = 'source-over';

    // 3. Draw overlay on display with alpha
    dCtx.drawImage(overlay, 0, 0, w, h);

    // 4. Draw rect preview if active
    if (rectPreviewRef.current && tool === 'rect') {
      const { x1, y1, x2, y2 } = rectPreviewRef.current;
      dCtx.save();
      dCtx.strokeStyle = themeColor;
      dCtx.lineWidth = 2;
      dCtx.setLineDash([6, 4]);
      dCtx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      dCtx.restore();
    }
  }, [themeColor, imageSize, tool, hexToRgb]);

  // Load image when workspace opens
  useEffect(() => {
    if (!isWorkspaceOpen || !targetImage) return;

    const img = new Image();
    img.onload = () => {
      originalImgRef.current = img;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setImageSize({ width: w, height: h });

      // Init canvases
      [displayRef, maskRef, overlayRef].forEach((ref) => {
        const canvas = ref.current;
        if (canvas) {
          canvas.width = w;
          canvas.height = h;
        }
      });

      // Clear mask
      const mCtx = maskRef.current?.getContext('2d');
      if (mCtx) mCtx.clearRect(0, 0, w, h);

      setZoom(1);
      setPan({ x: 0, y: 0 });
    };
    img.src = targetImage.url;
  }, [isWorkspaceOpen, targetImage]);

  // Redraw on mask/theme changes
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Convert screen coords to image coords
  const screenToImage = useCallback(
    (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
      const canvas = displayRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = imageSize.width / rect.width;
      const scaleY = imageSize.height / rect.height;

      let clientX: number, clientY: number;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [imageSize],
  );

  // Draw operations on mask
  const drawDot = useCallback(
    (x: number, y: number, eraser: boolean) => {
      const ctx = maskRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fill();
      ctx.restore();
    },
    [brushSize],
  );

  const drawLine = useCallback(
    (x1: number, y1: number, x2: number, y2: number, eraser: boolean) => {
      const ctx = maskRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    },
    [brushSize],
  );

  const fillRect = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const ctx = maskRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.restore();
    },
    [],
  );

  const checkMaskEmpty = useCallback((): boolean => {
    const mask = maskRef.current;
    if (!mask) return true;
    const ctx = mask.getContext('2d');
    if (!ctx) return true;
    const data = ctx.getImageData(0, 0, mask.width, mask.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return false;
    }
    return true;
  }, []);

  const exportMask = useCallback((): string | null => {
    const mask = maskRef.current;
    if (!mask) return null;
    const w = mask.width;
    const h = mask.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) return null;

    // Fill opaque black (keep area)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Copy mask alpha, inverted: drawn(white,alpha=255) → transparent in output
    const maskData = mask.getContext('2d')!.getImageData(0, 0, w, h);
    const outData = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < maskData.data.length; i += 4) {
      outData.data[i + 3] = 255 - maskData.data[i + 3];
    }
    ctx.putImageData(outData, 0, 0);
    return out.toDataURL('image/png');
  }, []);

  // Expose to PromptBar
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__inpaintCanvas = {
      applyFeather: () => {
        if (featherRadius === 0) return;
        const mask = maskRef.current;
        if (!mask) return;
        const offscreen = document.createElement('canvas');
        offscreen.width = mask.width;
        offscreen.height = mask.height;
        const offCtx = offscreen.getContext('2d');
        if (!offCtx) return;
        offCtx.filter = `blur(${featherRadius}px)`;
        offCtx.drawImage(mask, 0, 0);
        const ctx = mask.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, mask.width, mask.height);
        ctx.drawImage(offscreen, 0, 0);
        redraw();
      },
      exportMask,
      clearMask: () => {
        const ctx = maskRef.current?.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, imageSize.width, imageSize.height);
        rectPreviewRef.current = null;
        redraw();
        onMaskEmpty();
      },
    };
  }, [featherRadius, exportMask, imageSize, redraw, onMaskEmpty]);

  // --- Pointer handlers ---
  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (spaceHeld || !isWorkspaceOpen) return;
      e.preventDefault();
      const pos = screenToImage(e);

      if (tool === 'rect') {
        rectStartRef.current = pos;
        isDrawingRef.current = true;
        rectPreviewRef.current = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
      } else {
        isDrawingRef.current = true;
        lastPosRef.current = pos;
        pushHistory();
        drawDot(pos.x, pos.y, tool === 'eraser');
        redraw();
      }
    },
    [spaceHeld, tool, screenToImage, pushHistory, drawDot, redraw, isWorkspaceOpen],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = displayRef.current;
      if (!canvas) return;

      // Update cursor position for brush cursor
      if (mode === 'precise' && tool !== 'rect') {
        let clientX: number, clientY: number;
        if ('touches' in e) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
        } else {
          clientX = e.clientX;
          clientY = e.clientY;
        }
        setCursorPos({ x: clientX, y: clientY });
      }

      // Pan with space held
      if (spaceHeld) {
        if (panStartRef.current) {
          const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
          const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
          setPan({
            x: panStartRef.current.px + (clientX - panStartRef.current.x),
            y: panStartRef.current.py + (clientY - panStartRef.current.y),
          });
        }
        return;
      }

      if (!isDrawingRef.current) return;
      const pos = screenToImage(e);

      if (tool === 'rect' && rectStartRef.current) {
        rectPreviewRef.current = { x1: rectStartRef.current.x, y1: rectStartRef.current.y, x2: pos.x, y2: pos.y };
        redraw();
      } else if (lastPosRef.current) {
        drawLine(lastPosRef.current.x, lastPosRef.current.y, pos.x, pos.y, tool === 'eraser');
        lastPosRef.current = pos;
        redraw();
      }
    },
    [spaceHeld, tool, mode, screenToImage, drawLine, redraw],
  );

  const handlePointerUp = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (spaceHeld) {
        panStartRef.current = null;
        return;
      }

      if (tool === 'rect' && rectStartRef.current && isDrawingRef.current) {
        const pos = screenToImage(e);
        fillRect(rectStartRef.current.x, rectStartRef.current.y, pos.x, pos.y);
        pushHistory();
        rectPreviewRef.current = null;
        redraw();
      }

      isDrawingRef.current = false;
      rectStartRef.current = null;
      lastPosRef.current = null;

      // Notify
      if (!checkMaskEmpty()) {
        const dataUrl = exportMask();
        if (dataUrl) {
          setMaskDataUrl(dataUrl);
          onMaskChange(dataUrl);
        }
      } else {
        onMaskEmpty();
      }
    },
    [spaceHeld, tool, fillRect, pushHistory, redraw, screenToImage, checkMaskEmpty, exportMask, setMaskDataUrl, onMaskChange, onMaskEmpty],
  );

  // Wheel zoom (centered on cursor)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      setZoom((z) => Math.max(0.5, Math.min(3, z * delta)));
    },
    [],
  );

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); setSpaceHeld(true); }
      if (e.key === 'b') useInpaintStore.getState().setTool('brush');
      if (e.key === 'e') useInpaintStore.getState().setTool('eraser');
      if (e.key === 'r') useInpaintStore.getState().setTool('rect');
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); useInpaintStore.getState().undo(); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, []);

  if (!targetImage || !isWorkspaceOpen) return null;

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden bg-black/50"
      onWheel={handleWheel}
    >
      {/* Canvas wrapper with zoom/pan */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          transition: 'transform 80ms ease-out',
        }}
      >
        <div className="relative">
          <canvas
            ref={displayRef}
            className="max-h-[calc(100vh-180px)] max-w-[calc(100vw-180px)] object-contain"
            style={{ width: imageSize.width ? `${imageSize.width}px` : 'auto', height: imageSize.height ? `${imageSize.height}px` : 'auto' }}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>

      {/* Hidden mask & overlay canvases */}
      <canvas ref={maskRef} className="hidden" width={imageSize.width} height={imageSize.height} />
      <canvas ref={overlayRef} className="hidden" width={imageSize.width} height={imageSize.height} />

      {/* Brush cursor */}
      {mode === 'precise' && tool !== 'rect' && cursorPos && (
        <div
          className="pointer-events-none fixed z-50 rounded-full border border-white/60"
          style={{
            width: brushSize,
            height: brushSize,
            left: cursorPos.x - brushSize / 2,
            top: cursorPos.y - brushSize / 2,
            boxShadow: `0 0 0 1px ${themeColor}66`,
          }}
        />
      )}

      {/* Zoom indicator */}
      <div className="absolute bottom-4 left-4 font-mono text-[10px] text-[var(--zzz-text)]/40 select-none">
        {Math.round(zoom * 100)}%
        {spaceHeld && ' · 抓手模式'}
      </div>
    </div>
  );
}
