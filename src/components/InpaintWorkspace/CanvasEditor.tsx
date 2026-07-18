import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInpaintStore } from '../../store/useInpaintStore';

export function CanvasEditor({
  onMaskChange,
  onMaskEmpty,
}: {
  onMaskChange: (dataUrl: string) => void;
  onMaskEmpty: () => void;
}) {
  const { mode, tool, brushSize, featherRadius, shapeType, setMaskDataUrl, maskDataUrl } = useInpaintStore((s) => s);
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
  const [middleHeld, setMiddleHeld] = useState(false);
  const brushCursorRef = useRef<HTMLDivElement>(null);
  const brushColorRef = useRef<string>('rgba(255,255,255,0.85)');
  const [themeColor, setThemeColor] = useState(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--zzz-primary').trim() || '#b026ff',
  );

  const isDrawingRef = useRef(false);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const middlePanStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const rectPreviewRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentPanRef = useRef({ x: 0, y: 0 });
  const vpWRef = useRef(0);
  const vpHRef = useRef(0);
  const wheelAdjustRef = useRef<{
    mouseX: number; mouseY: number;
    prevZoom: number; newZoom: number;
    imgW: number; imgH: number;
    vpW: number; vpH: number;
  } | null>(null);

  const maskRestoreVersionRef = useRef(0);
  const historyRef = useRef<string[]>([]);
  const MAX_UNDO = 20;

  const restoreMaskFromDataUrl = useCallback((dataUrl: string | null) => {
    const mask = maskRef.current;
    if (!mask) return;
    const ctx = mask.getContext('2d');
    if (!ctx) return;

    if (!dataUrl) {
      ctx.clearRect(0, 0, mask.width, mask.height);
      return;
    }

    const version = ++maskRestoreVersionRef.current;
    const img = new Image();
    img.onload = () => {
      if (version !== maskRestoreVersionRef.current) return;
      ctx.clearRect(0, 0, mask.width, mask.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, mask.width, mask.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      setMaskDataUrl(dataUrl);
      redrawRef.current();
    };
    img.src = dataUrl;
  }, [setMaskDataUrl]);

  const isMaskEmptyDataUrl = useCallback((dataUrl: string | null): boolean => {
    if (!dataUrl) return true;
    if (!dataUrl.startsWith('data:image/png;base64,')) return true;
    try {
      const binary = atob(dataUrl.split(',')[1]);
      let hasContent = false;
      for (let i = 3; i < binary.length; i += 4) {
        if (binary.charCodeAt(i) > 0) { hasContent = true; break; }
      }
      return !hasContent;
    } catch {
      return true;
    }
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    restoreMaskFromDataUrl(prev);
    if (isMaskEmptyDataUrl(prev)) {
      onMaskEmpty();
    }
  }, [restoreMaskFromDataUrl, isMaskEmptyDataUrl, onMaskEmpty]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeColor(getComputedStyle(document.documentElement).getPropertyValue('--zzz-primary').trim() || '#b026ff');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);

  const hexToRgb = useCallback((hex: string): { r: number; g: number; b: number } => {
    const m = hex.replace('#', '').match(/../g);
    if (!m || m.length < 3) return { r: 176, g: 38, b: 255 };
    return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
  }, []);

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

    dCtx.drawImage(originalImgRef.current, 0, 0);

    const { r, g, b } = hexToRgb(themeColor);
    oCtx.clearRect(0, 0, w, h);
    oCtx.fillStyle = `rgb(${r},${g},${b})`;
    oCtx.fillRect(0, 0, w, h);
    oCtx.globalCompositeOperation = 'destination-in';
    oCtx.drawImage(mask, 0, 0);
    oCtx.globalCompositeOperation = 'source-over';

    dCtx.globalAlpha = 0.7;
    dCtx.drawImage(overlay, 0, 0, w, h);
    dCtx.globalAlpha = 1;

    if (rectPreviewRef.current && tool === 'shape') {
      const { x1, y1, x2, y2 } = rectPreviewRef.current;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const cx = Math.min(x1, x2) + rx;
      const cy = Math.min(y1, y2) + ry;
      dCtx.save();
      dCtx.strokeStyle = themeColor;
      dCtx.lineWidth = 2;
      dCtx.setLineDash([6, 4]);
      if (shapeType === 'circle') {
        const r = Math.max(rx, ry, 0.001);
        dCtx.beginPath();
        dCtx.arc(cx, cy, r, 0, Math.PI * 2);
        dCtx.stroke();
      } else if (shapeType === 'ellipse') {
        dCtx.beginPath();
        dCtx.ellipse(cx, cy, Math.max(rx, 0.001), Math.max(ry, 0.001), 0, 0, Math.PI * 2);
        dCtx.stroke();
      } else {
        dCtx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      }
      dCtx.restore();
    }
  }, [themeColor, imageSize, tool, shapeType, hexToRgb]);

  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

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

  useEffect(() => {
    if (!isWorkspaceOpen || !targetImage) return;
    const img = new Image();
    img.onload = () => {
      originalImgRef.current = img;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setImageSize({ width: w, height: h });
      [displayRef, maskRef, overlayRef].forEach((ref) => {
        const canvas = ref.current;
        if (canvas) { canvas.width = w; canvas.height = h; }
      });
      const mCtx = maskRef.current?.getContext('2d');
      if (mCtx) mCtx.clearRect(0, 0, w, h);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    };
    img.src = targetImage.url;
  }, [isWorkspaceOpen, targetImage]);

  const maskBlobUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!maskRef.current || imageSize.width === 0) return;
    const ctx = maskRef.current.getContext('2d');
    if (!ctx) return;
    if (maskBlobUrlRef.current) {
      URL.revokeObjectURL(maskBlobUrlRef.current);
      maskBlobUrlRef.current = null;
    }
    if (!maskDataUrl) {
      ctx.clearRect(0, 0, imageSize.width, imageSize.height);
      redraw();
      return;
    }
    const version = ++maskRestoreVersionRef.current;
    const img = new Image();
    img.onload = () => {
      if (version !== maskRestoreVersionRef.current) return;
      ctx.clearRect(0, 0, imageSize.width, imageSize.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, imageSize.width, imageSize.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      redraw();
      try {
        const byteChars = atob(maskDataUrl.split(',')[1]);
        const byteNumbers = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteNumbers[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteNumbers], { type: 'image/png' });
        maskBlobUrlRef.current = URL.createObjectURL(blob);
      } catch { /* fallback to dataUrl */ }
    };
    img.src = maskDataUrl;
  }, [maskDataUrl, imageSize.width, imageSize.height, redraw]);

  useEffect(() => { redraw(); }, [redraw]);

  const screenToImage = useCallback(
    (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
      const canvas = displayRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const imgW = imageSizeRef.current.width;
      const imgH = imageSizeRef.current.height;
      if (imgW === 0 || imgH === 0) return { x: 0, y: 0 };
      const boxW = rect.width, boxH = rect.height;
      const contentW = Math.min(boxW, imgW * boxH / imgH);
      const contentH = Math.min(imgH * boxW / imgW, boxH);
      const offsetX = (boxW - contentW) / 2;
      const offsetY = (boxH - contentH) / 2;
      let clientX = 0, clientY = 0;
      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX; clientY = e.touches[0].clientY;
      } else if (!('touches' in e)) {
        clientX = (e as React.MouseEvent).clientX; clientY = (e as React.MouseEvent).clientY;
      } else { return { x: 0, y: 0 }; }
      return {
        x: (clientX - (rect.left + offsetX)) / contentW * imgW,
        y: (clientY - (rect.top + offsetY)) / contentH * imgH,
      };
    }, [],
  );

  const getImageAt = useCallback((imgX: number, imgY: number): string => {
    const canvas = displayRef.current;
    if (!canvas) return brushColorRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return brushColorRef.current;
    const ix = Math.max(0, Math.min(Math.round(imgX), canvas.width - 1));
    const iy = Math.max(0, Math.min(Math.round(imgY), canvas.height - 1));
    try {
      const px = ctx.getImageData(ix, iy, 1, 1).data;
      const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
      const color = lum < 128 ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,0.7)';
      brushColorRef.current = color;
      return color;
    } catch { return brushColorRef.current; }
  }, []);

  const drawDot = useCallback((x: number, y: number, eraser: boolean) => {
    const ctx = maskRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fill();
    ctx.restore();
  }, [brushSize]);

  const drawLine = useCallback((x1: number, y1: number, x2: number, y2: number, eraser: boolean) => {
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
  }, [brushSize]);

  const fillShape = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const ctx = maskRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,255,255,1)';
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    const cx = Math.min(x1, x2) + rx;
    const cy = Math.min(y1, y2) + ry;
    if (shapeType === 'circle') {
      const r = Math.max(rx, ry, 0.001);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    } else if (shapeType === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(rx, 0.001), Math.max(ry, 0.001), 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    ctx.restore();
  }, [shapeType]);

  const checkMaskEmpty = useCallback((): boolean => {
    const mask = maskRef.current;
    if (!mask) return true;
    const ctx = mask.getContext('2d');
    if (!ctx) return true;
    const data = ctx.getImageData(0, 0, mask.width, mask.height).data;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) return false; }
    return true;
  }, []);

  const exportMask = useCallback((): string | null => {
    const mask = maskRef.current;
    if (!mask) return null;
    const w = mask.width, h = mask.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
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
    window.__inpaintCanvas = {
      applyFeather: () => {
        if (featherRadius === 0) return;
        const mask = maskRef.current;
        if (!mask) return;
        const offscreen = document.createElement('canvas');
        offscreen.width = mask.width; offscreen.height = mask.height;
        const offCtx = offscreen.getContext('2d');
        if (!offCtx) return;
        const w = mask.width, h = mask.height, r = featherRadius;
        const hGrad = offCtx.createLinearGradient(0, 0, w, 0);
        hGrad.addColorStop(0, 'rgba(0,0,0,0)');
        hGrad.addColorStop(Math.max(0, r / w), 'rgba(0,0,0,1)');
        hGrad.addColorStop(Math.min(1, 1 - r / w), 'rgba(0,0,0,1)');
        hGrad.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = hGrad; offCtx.fillRect(0, 0, w, h);
        const vGrad = offCtx.createLinearGradient(0, 0, 0, h);
        vGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vGrad.addColorStop(Math.max(0, r / h), 'rgba(0,0,0,1)');
        vGrad.addColorStop(Math.min(1, 1 - r / h), 'rgba(0,0,0,1)');
        vGrad.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = vGrad; offCtx.fillRect(0, 0, w, h);
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

  useEffect(() => {
    return () => {
      if (maskBlobUrlRef.current) URL.revokeObjectURL(maskBlobUrlRef.current);
      cancelScheduledRedraw();
    };
  }, [cancelScheduledRedraw]);

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (spaceHeld || !isWorkspaceOpen) return;
      e.preventDefault();
      if ('button' in e && e.button === 1) {
        setMiddleHeld(true);
        middlePanStartRef.current = { x: e.clientX, y: e.clientY, px: currentPanRef.current.x, py: currentPanRef.current.y };
        return;
      }
      const pos = screenToImage(e);
      if (tool === 'shape') {
        rectStartRef.current = pos;
        isDrawingRef.current = true;
        rectPreviewRef.current = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
        const preDrawMask = exportMask();
        if (preDrawMask) {
          historyRef.current = [...historyRef.current, preDrawMask];
          if (historyRef.current.length > MAX_UNDO) historyRef.current.shift();
        }
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
    [spaceHeld, tool, screenToImage, drawDot, redraw, isWorkspaceOpen, exportMask],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = displayRef.current;
      if (!canvas) return;
      let clientX = 0, clientY = 0;
      if ('touches' in e) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
      else { clientX = e.clientX; clientY = e.clientY; }

      if (mode === 'precise' && tool !== 'shape') {
        const brushEl = brushCursorRef.current;
        if (brushEl) {
          const canvasRect = canvas.getBoundingClientRect();
          const scaleX = canvasRect.width / imageSize.width;
          const scaleY = canvasRect.height / imageSize.height;
          const contentScale = Math.min(scaleX, scaleY);
          const screenBrushSize = Math.max(4, brushSize * contentScale);
          brushEl.style.width = `${screenBrushSize}px`;
          brushEl.style.height = `${screenBrushSize}px`;
          brushEl.style.transform = `translate(${clientX - screenBrushSize / 2}px, ${clientY - screenBrushSize / 2}px)`;
          const imgPos = screenToImage({ clientX, clientY } as React.MouseEvent);
          const color = getImageAt(imgPos.x, imgPos.y);
          if (brushEl.style.borderColor !== color) {
            brushEl.style.borderColor = color;
            brushEl.style.boxShadow = `0 0 0 1px ${color.replace('0.9', '0.5').replace('0.75', '0.4')}`;
          }
        }
      }

      if (middleHeld && middlePanStartRef.current) {
        setPan({ x: middlePanStartRef.current.px + (clientX - middlePanStartRef.current.x), y: middlePanStartRef.current.py + (clientY - middlePanStartRef.current.y) });
        return;
      }
      if (spaceHeld) {
        if (panStartRef.current) {
          setPan({ x: panStartRef.current.px + (clientX - panStartRef.current.x), y: panStartRef.current.py + (clientY - panStartRef.current.y) });
        }
        return;
      }
      if (!isDrawingRef.current) return;
      const pos = screenToImage(e);
      if (tool === 'shape' && rectStartRef.current) {
        rectPreviewRef.current = { x1: rectStartRef.current.x, y1: rectStartRef.current.y, x2: pos.x, y2: pos.y };
        redraw();
      } else if (lastPosRef.current) {
        drawLine(lastPosRef.current.x, lastPosRef.current.y, pos.x, pos.y, tool === 'eraser');
        lastPosRef.current = pos;
        scheduleRedraw();
      }
    },
    [spaceHeld, middleHeld, tool, mode, screenToImage, drawLine, scheduleRedraw, brushSize],
  );

  const handlePointerUp = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (spaceHeld) { panStartRef.current = null; return; }
      if (middleHeld) { middlePanStartRef.current = null; setMiddleHeld(false); return; }
      if (tool === 'shape' && rectStartRef.current && isDrawingRef.current) {
        const pos = screenToImage(e);
        fillShape(rectStartRef.current.x, rectStartRef.current.y, pos.x, pos.y);
        rectPreviewRef.current = null;
        redraw();
      }
      isDrawingRef.current = false;
      rectStartRef.current = null;
      lastPosRef.current = null;
      cancelScheduledRedraw();
      if (!checkMaskEmpty()) {
        const dataUrl = exportMask();
        if (dataUrl) { setMaskDataUrl(dataUrl); onMaskChange(dataUrl); }
      } else { onMaskEmpty(); }
    },
    [spaceHeld, middleHeld, tool, fillShape, redraw, screenToImage, checkMaskEmpty, exportMask, setMaskDataUrl, onMaskChange, onMaskEmpty],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
    const newZoom = Math.max(0.5, Math.min(3, zoom * factor));
    if (newZoom === zoom) return;
    const vp = containerRef.current;
    const rect = vp?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
    wheelAdjustRef.current = { mouseX: e.clientX - rect.left, mouseY: e.clientY - rect.top, prevZoom: zoom, newZoom, imgW: imageSize.width, imgH: imageSize.height, vpW: rect.width, vpH: rect.height };
    setZoom(newZoom);
  }, [zoom, imageSize]);

  useLayoutEffect(() => {
    const adj = wheelAdjustRef.current;
    if (!adj) return;
    wheelAdjustRef.current = null;
    const { mouseX, mouseY, prevZoom, newZoom, imgW, imgH, vpW, vpH } = adj;
    const curPanX = currentPanRef.current.x, curPanY = currentPanRef.current.y;
    const oldOffsetX = (vpW - imgW * prevZoom) / 2 + curPanX;
    const oldOffsetY = (vpH - imgH * prevZoom) / 2 + curPanY;
    const imgPX = (mouseX - oldOffsetX) / prevZoom;
    const imgPY = (mouseY - oldOffsetY) / prevZoom;
    const newOffsetX = mouseX - imgPX * newZoom;
    const newOffsetY = mouseY - imgPY * newZoom;
    const newPanX = newOffsetX - (vpW - imgW * newZoom) / 2;
    const newPanY = newOffsetY - (vpH - imgH * newZoom) / 2;
    setPan({ x: newPanX, y: newPanY });
    currentPanRef.current = { x: newPanX, y: newPanY };
  }, [zoom]);

  useEffect(() => { currentPanRef.current = { x: pan.x, y: pan.y }; }, [pan.x, pan.y]);

  useEffect(() => {
    const vp = containerRef.current;
    if (!vp) return;
    vpWRef.current = vp.clientWidth; vpHRef.current = vp.clientHeight;
    const observer = new ResizeObserver(() => { vpWRef.current = vp.clientWidth; vpHRef.current = vp.clientHeight; });
    observer.observe(vp);
    return () => observer.disconnect();
  }, []);

  const undoRef = useRef(undo);
  undoRef.current = undo;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); setSpaceHeld(true); }
      if (e.key === 'b') useInpaintStore.getState().setTool('brush');
      if (e.key === 'e') useInpaintStore.getState().setTool('eraser');
      if (e.key === 'u') useInpaintStore.getState().setTool('shape');
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoRef.current(); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, []);

  if (!targetImage || !isWorkspaceOpen) return null;

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-black/50" onWheel={handleWheel}>
      <div className="absolute inset-0 flex items-center justify-center" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 80ms ease-out' }}>
        <div className="relative">
          <canvas ref={displayRef} className="max-h-[calc(100vh-180px)] max-w-[calc(100vw-180px)] object-contain" style={{ width: imageSize.width ? `${imageSize.width}px` : 'auto', height: imageSize.height ? `${imageSize.height}px` : 'auto' }} onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp} onMouseLeave={handlePointerUp} onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={handlePointerUp} onContextMenu={(e) => e.preventDefault()} />
        </div>
      </div>
      <canvas ref={maskRef} className="hidden" width={imageSize.width} height={imageSize.height} />
      <canvas ref={overlayRef} className="hidden" width={imageSize.width} height={imageSize.height} />
      {mode === 'precise' && tool !== 'shape' && (
        <div ref={brushCursorRef} className="pointer-events-none fixed z-50 rounded-full" style={{ left: 0, top: 0, width: 0, height: 0 }} />
      )}
      <div className="absolute bottom-4 left-4 font-mono text-[10px] text-[var(--zzz-text)]/40 select-none">
        {Math.round(zoom * 100)}%{spaceHeld && ' · 抓手模式'}
      </div>
    </div>
  );
}
