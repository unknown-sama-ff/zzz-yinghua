import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInpaintStore } from '../../store/useInpaintStore';

export function CanvasEditor({
  onMaskChange,
  onMaskEmpty,
}: {
  onMaskChange: (dataUrl: string) => void;
  onMaskEmpty: () => void;
}) {
  const { mode, tool, brushSize, featherRadius, setMaskDataUrl, maskDataUrl } = useInpaintStore((s) => s);
  const targetImage = useInpaintStore((s) => s.targetImage);
  const isWorkspaceOpen = useInpaintStore((s) => s.isWorkspaceOpen);

  const displayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const imageSizeRef = useRef(imageSize);
  imageSizeRef.current = imageSize;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const brushCursorRef = useRef<HTMLDivElement>(null);
  const brushColorRef = useRef<string>('rgba(255,255,255,0.85)');
  const [themeColor, setThemeColor] = useState(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--zzz-primary').trim() || '#b026ff',
  );

  const isDrawingRef = useRef(false);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const rectPreviewRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedSizeRef = useRef({ width: 0, height: 0, offsetX: 0, offsetY: 0, scale: 1 });
  // Keep current pan values in refs for the wheel-zoom layout effect to read
  // without stale closures.
  const currentPanRef = useRef({ x: 0, y: 0 });
  const vpWRef = useRef(0);
  const vpHRef = useRef(0);
  // Stores pre-zoom state so the layout effect can adjust pan to keep the
  // cursor's image-point fixed after a zoom change.
  const wheelAdjustRef = useRef<{
    mouseX: number; mouseY: number;
    prevZoom: number; newZoom: number;
    imgW: number; imgH: number;
    vpW: number; vpH: number;
  } | null>(null);

  // --- Undo system ---
  const historyRef = useRef<string[]>([]);
  const MAX_UNDO = 20;

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    // Restore the mask canvas from the history entry
    restoreMaskFromDataUrl(prev);
    setMaskDataUrl(prev);
    // Notify parent if the restored mask is empty
    if (isMaskEmptyDataUrl(prev)) {
      onMaskEmpty();
    }
  }, [setMaskDataUrl, onMaskEmpty]);

  // Helper: check if a mask data URL represents an empty mask
  // (all alpha = 0, meaning no strokes were drawn)
  const isMaskEmptyDataUrl = useCallback((dataUrl: string | null): boolean => {
    if (!dataUrl) return true;
    if (!dataUrl.startsWith('data:image/png;base64,')) return true;
    try {
      const binary = atob(dataUrl.split(',')[1]);
      // Check last byte of each pixel (alpha channel)
      // A pixel with alpha=0 means that area was NOT drawn
      let hasContent = false;
      for (let i = 3; i < binary.length; i += 4) {
        if (binary.charCodeAt(i) > 0) { hasContent = true; break; }
      }
      return !hasContent;
    } catch {
      return true;
    }
  }, []);

  // Helper: restore mask canvas from a data URL (used by undo)
  // NOTE: does NOT call redraw() — the maskDataUrl useEffect handles that.
  const restoreMaskFromDataUrl = useCallback((dataUrl: string | null) => {
    const mask = maskRef.current;
    if (!dataUrl) {
      if (mask) {
        const ctx = mask.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, mask.width, mask.height);
      }
      return;
    }
    if (!mask) return;
    const img = new Image();
    img.onload = () => {
      const ctx = mask.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, mask.width, mask.height);
      // Invert back: stored mask has transparent=drawn, opaque=keep
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, mask.width, mask.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    };
    img.src = dataUrl;
  }, []); // no deps — only uses refs

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

  // RAF throttle for canvas redraws during drawing. Without this, mousemove
  // (which can fire 200+ Hz) calls redraw() each time — for 2848×1600 images
  // that means 200 full canvas redraws/sec when the screen only needs 60.
  const rafIdRef = useRef<number>(0);
  const dirtyRef = useRef(false);
  const scheduleRedraw = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafIdRef.current = requestAnimationFrame(() => {
      dirtyRef.current = false;
      redraw();
    });
  }, [redraw]);

  const cancelScheduledRedraw = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    dirtyRef.current = false;
  }, []);

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

  // Sync maskDataUrl from store back to canvas (undo / clear / persistence restore)
  // Also create a blob URL for API upload (more memory-efficient than base64).
  const maskBlobUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!maskRef.current || imageSize.width === 0) return;
    const ctx = maskRef.current.getContext('2d');
    if (!ctx) return;

    // Revoke previous blob URL to avoid memory leaks
    if (maskBlobUrlRef.current) {
      URL.revokeObjectURL(maskBlobUrlRef.current);
      maskBlobUrlRef.current = null;
    }

    if (!maskDataUrl) {
      ctx.clearRect(0, 0, imageSize.width, imageSize.height);
      redraw();
      return;
    }

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, imageSize.width, imageSize.height);
      // maskDataUrl stores the AI-format inverted mask (transparent=drawn, opaque=keep).
      // Invert it back to recover user strokes on the mask canvas.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, imageSize.width, imageSize.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      redraw();
    };
    img.src = maskDataUrl;

    // Create blob URL for efficient API upload
    try {
      const byteChars = atob(maskDataUrl.split(',')[1]);
      const byteNumbers = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteNumbers], { type: 'image/png' });
      maskBlobUrlRef.current = URL.createObjectURL(blob);
    } catch {
      // If conversion fails, upload path will fall back to dataUrl
    }
  }, [maskDataUrl, imageSize.width, imageSize.height, redraw]);

  // Redraw on mask/theme changes
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Convert screen coords to image coords.
  // Uses the actual rendered content dimensions (not the CSS box), because
  // object-fit: contain can introduce letterboxing that shifts the content
  // area away from the CSS box edges. Using the wrong rect dimensions causes
  // the mask to drift away from the cursor, especially toward the edges.
  const screenToImage = useCallback(
    (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
      const canvas = displayRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const rs = renderedSizeRef.current;
      // rs.offsetX/Y = letterbox offset from CSS box edge to rendered content edge
      const contentLeft = rect.left + rs.offsetX;
      const contentTop = rect.top + rs.offsetY;
      const contentW = rs.width;
      const contentH = rs.height;
      if (contentW === 0 || contentH === 0) {
        // Fallback: treat CSS box as content area
        return {
          x: (e.clientX - rect.left) * (imageSizeRef.current.width / rect.width),
          y: (e.clientY - rect.top) * (imageSizeRef.current.height / rect.height),
        };
      }

      let clientX: number, clientY: number;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      return {
        x: (clientX - contentLeft) * (imageSizeRef.current.width / contentW),
        y: (clientY - contentTop) * (imageSizeRef.current.height / contentH),
      };
    },
    [],
  );

  // Sample the image pixel at the given image coordinates and return a
  // high-contrast cursor color (white on dark backgrounds, black on light).
  const getImageAt = useCallback((imgX: number, imgY: number): string => {
    const canvas = displayRef.current;
    if (!canvas) return brushColorRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return brushColorRef.current;

    const ix = Math.max(0, Math.min(Math.round(imgX), canvas.width - 1));
    const iy = Math.max(0, Math.min(Math.round(imgY), canvas.height - 1));

    try {
      const px = ctx.getImageData(ix, iy, 1, 1).data;
      // Perceived luminance (sRGB)
      const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
      const dark = lum < 128;
      const color = dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)';
      brushColorRef.current = color;
      return color;
    } catch {
      return brushColorRef.current;
    }
  }, []);

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
        // Feather via gradient alpha instead of CSS filter:blur.
        // Build a feathered alpha mask (opaque at center, fading at edges)
        // and composite it onto the mask with destination-in.
        const offscreen = document.createElement('canvas');
        offscreen.width = mask.width;
        offscreen.height = mask.height;
        const offCtx = offscreen.getContext('2d');
        if (!offCtx) return;
        const w = mask.width;
        const h = mask.height;
        const r = featherRadius;
        // Horizontal gradient: fade in from left, fade out at right
        const hGrad = offCtx.createLinearGradient(0, 0, w, 0);
        hGrad.addColorStop(0, 'rgba(0,0,0,0)');
        hGrad.addColorStop(Math.max(0, r / w), 'rgba(0,0,0,1)');
        hGrad.addColorStop(Math.min(1, 1 - r / w), 'rgba(0,0,0,1)');
        hGrad.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = hGrad;
        offCtx.fillRect(0, 0, w, h);
        // Vertical gradient: fade in from top, fade out at bottom
        const vGrad = offCtx.createLinearGradient(0, 0, 0, h);
        vGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vGrad.addColorStop(Math.max(0, r / h), 'rgba(0,0,0,1)');
        vGrad.addColorStop(Math.min(1, 1 - r / h), 'rgba(0,0,0,1)');
        vGrad.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = vGrad;
        offCtx.fillRect(0, 0, w, h);
        // Apply: keep mask content where gradient is opaque, feather at edges
        const ctx = mask.getContext('2d');
        if (!ctx) return;
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(offscreen, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        redraw();
      },
      exportMask,
      getMaskBlobUrl: () => maskBlobUrlRef.current,
      undo: () => undoRef.current(),
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

  // Cleanup blob URL + cancel pending redraw on unmount
  useEffect(() => {
    return () => {
      if (maskBlobUrlRef.current) {
        URL.revokeObjectURL(maskBlobUrlRef.current);
        maskBlobUrlRef.current = null;
      }
      cancelScheduledRedraw();
    };
  }, [cancelScheduledRedraw]);

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
        cancelScheduledRedraw();
        const preStrokeMask = exportMask();
        if (preStrokeMask) {
          historyRef.current = [...historyRef.current, preStrokeMask];
          if (historyRef.current.length > MAX_UNDO) historyRef.current.shift();
        }
        drawDot(pos.x, pos.y, tool === 'eraser');
        redraw();
      }
    },
    [spaceHeld, tool, screenToImage, drawDot, redraw, isWorkspaceOpen],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = displayRef.current;
      if (!canvas) return;

      // Update brush cursor position via DOM ref (avoids React re-render per mousemove)
      if (mode === 'precise' && tool !== 'rect') {
        const brushEl = brushCursorRef.current;
        if (brushEl) {
          let clientX: number, clientY: number;
          if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
          } else {
            clientX = e.clientX;
            clientY = e.clientY;
          }
          // Brush cursor is a fixed viewport overlay — track the actual mouse
          // pointer directly. The offset correction is only needed inside
          // screenToImage (content-coordinate math), not here.
          const rs = renderedSizeRef.current;
          // Convert brushSize (image pixels) to screen pixels using the
          // object-fit: contain scale factor so the circle matches the actual
          // visual brush size.
          const screenBrushSize = Math.max(4, brushSize * rs.scale);
          brushEl.style.width = `${screenBrushSize}px`;
          brushEl.style.height = `${screenBrushSize}px`;
          brushEl.style.transform = `translate(${clientX - screenBrushSize / 2}px, ${clientY - screenBrushSize / 2}px)`;

          // Sample the image color under the cursor and adapt the circle's
          // border/shadow so it's always visible (white on dark, black on light).
          const imgPos = screenToImage({ clientX, clientY } as unknown as React.MouseEvent);
          const color = getImageAt(imgPos.x, imgPos.y);
          if (brushEl.style.borderColor !== color) {
            brushEl.style.borderColor = color;
            brushEl.style.boxShadow = `0 0 0 1px ${color.replace('0.9', '0.5').replace('0.75', '0.4')}`;
          }
        }
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
        scheduleRedraw();
      }
    },
    [spaceHeld, tool, mode, screenToImage, drawLine, scheduleRedraw, brushSize],
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
        rectPreviewRef.current = null;
        redraw();
      }

      isDrawingRef.current = false;
      rectStartRef.current = null;
      lastPosRef.current = null;
      cancelScheduledRedraw();

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
    [spaceHeld, tool, fillRect, redraw, screenToImage, checkMaskEmpty, exportMask, setMaskDataUrl, onMaskChange, onMaskEmpty],
  );

  // Wheel zoom: cursor-centered (keeps the image-point under the cursor fixed)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
      const newZoom = Math.max(0.5, Math.min(3, zoom * factor));
      if (newZoom === zoom) return;

      // Capture pre-zoom state for the layout effect
      const vp = containerRef.current;
      const rect = vp?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
      wheelAdjustRef.current = {
        mouseX: e.clientX - rect.left,
        mouseY: e.clientY - rect.top,
        prevZoom: zoom,
        newZoom,
        imgW: imageSize.width,
        imgH: imageSize.height,
        vpW: rect.width,
        vpH: rect.height,
      };
      setZoom(newZoom);
    },
    [zoom, imageSize],
  );

  // After zoom changes (from wheel), adjust pan to keep cursor point fixed.
  // Runs synchronously before paint — no visible jump.
  useLayoutEffect(() => {
    const adj = wheelAdjustRef.current;
    if (!adj) return;
    wheelAdjustRef.current = null;

    const { mouseX, mouseY, prevZoom, newZoom, imgW, imgH, vpW, vpH } = adj;
    // Read current pan from refs (avoids stale closure on state)
    const curPanX = currentPanRef.current.x;
    const curPanY = currentPanRef.current.y;

    // The image's top-left offset from viewport top-left:
    //   offset = (vpSize - imgSize * zoom) / 2 + pan
    const oldOffsetX = (vpW - imgW * prevZoom) / 2 + curPanX;
    const oldOffsetY = (vpH - imgH * prevZoom) / 2 + curPanY;

    // Image point under cursor (in image pixels, unchanged by zoom)
    const imgPX = (mouseX - oldOffsetX) / prevZoom;
    const imgPY = (mouseY - oldOffsetY) / prevZoom;

    // After zoom, that same image point should stay under the cursor:
    //   mouseX = newOffsetX + imgPX * newZoom  →  newOffsetX = mouseX - imgPX * newZoom
    const newOffsetX = mouseX - imgPX * newZoom;
    const newOffsetY = mouseY - imgPY * newZoom;

    // Convert back to pan: newOffset = (vpSize - imgSize * newZoom) / 2 + newPan
    const newPanX = newOffsetX - (vpW - imgW * newZoom) / 2;
    const newPanY = newOffsetY - (vpH - imgH * newZoom) / 2;

    setPan({ x: newPanX, y: newPanY });
    currentPanRef.current = { x: newPanX, y: newPanY };
  }, [zoom]);

  // Sync pan ref for the wheel-zoom effect
  useEffect(() => {
    currentPanRef.current = { x: pan.x, y: pan.y };
  }, [pan.x, pan.y]);

  // Track viewport size for zoom calculations
  useEffect(() => {
    const vp = containerRef.current;
    if (!vp) return;
    vpWRef.current = vp.clientWidth;
    vpHRef.current = vp.clientHeight;
    const observer = new ResizeObserver(() => {
      vpWRef.current = vp.clientWidth;
      vpHRef.current = vp.clientHeight;
    });
    observer.observe(vp);
    return () => observer.disconnect();
  }, []);

  // Compute the actual rendered content dimensions of the canvas, accounting
  // for object-fit: contain letterboxing. The CSS box (from getBoundingClientRect)
  // may be larger than the rendered content when aspect ratios don't match.
  // We store the content area + its offset from the CSS box edge so that
  // screenToImage and the brush cursor can position themselves correctly.
  useLayoutEffect(() => {
    const canvas = displayRef.current;
    if (!canvas || imageSize.width === 0 || imageSize.height === 0) return;

    const update = () => {
      const rect = canvas.getBoundingClientRect();
      const imgW = imageSize.width;
      const imgH = imageSize.height;
      const boxW = rect.width;
      const boxH = rect.height;

      if (boxW === 0 || boxH === 0) return;

      // object-fit: contain scales the bitmap to fit the box while preserving
      // aspect ratio. The rendered content fills one axis and may letterbox
      // the other. Compute the actual content dimensions.
      const scaleToFitW = boxW / imgW;
      const scaleToFitH = boxH / imgH;
      const scale = Math.min(scaleToFitW, scaleToFitH);
      const contentW = imgW * scale;
      const contentH = imgH * scale;
      const offsetX = (boxW - contentW) / 2;
      const offsetY = (boxH - contentH) / 2;

      renderedSizeRef.current = { width: contentW, height: contentH, offsetX, offsetY, scale };
    };

    update();

    // Recompute on resize (viewport change affects the max-width/max-height
    // constraints, which changes the CSS box and thus the letterboxing).
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [imageSize.width, imageSize.height]);

  // Sync undo function in a ref so the keyboard listener always has the latest version
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); setSpaceHeld(true); }
      if (e.key === 'b') useInpaintStore.getState().setTool('brush');
      if (e.key === 'e') useInpaintStore.getState().setTool('eraser');
      if (e.key === 'r') useInpaintStore.getState().setTool('rect');
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoRef.current(); }
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
      {mode === 'precise' && tool !== 'rect' && (
        <div
          ref={brushCursorRef}
          className="pointer-events-none fixed z-50 rounded-full"
          style={{
            left: 0,
            top: 0,
            // Size is set dynamically in handlePointerMove based on the
            // image-to-screen scale factor, so the circle matches the actual
            // brush size as it appears on screen.
            width: 0,
            height: 0,
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
