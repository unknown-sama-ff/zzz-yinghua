import { useCallback, useRef, useState } from 'react';

export interface CanvasImage {
  width: number;
  height: number;
  dataUrl: string;
}

export function useCanvasTools() {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const isDrawingRef = useRef(false);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const initCanvas = useCallback(async (imageDataUrl: string) => {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = imageDataUrl;
    });

    const w = img.naturalWidth;
    const h = img.naturalHeight;

    setCanvasSize({ width: w, height: h });
    setImageSize({ width: w, height: h });

    // Set canvas dimensions
    const displayCanvas = displayCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!displayCanvas || !maskCanvas) return;

    displayCanvas.width = w;
    displayCanvas.height = h;
    maskCanvas.width = w;
    maskCanvas.height = h;

    // Draw original image on display canvas
    const displayCtx = displayCanvas.getContext('2d');
    if (displayCtx) {
      displayCtx.drawImage(img, 0, 0);
    }

    // Clear mask canvas (transparent = all editable)
    const maskCtx = maskCanvas.getContext('2d');
    if (maskCtx) {
      maskCtx.clearRect(0, 0, w, h);
    }
  }, []);

  // Convert screen coordinates to canvas image coordinates
  const screenToCanvas = useCallback(
    (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

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
    [],
  );

  const getMaskCtx = useCallback(() => {
    return maskCanvasRef.current?.getContext('2d') ?? null;
  }, []);

  const getDisplayCtx = useCallback(() => {
    return displayCanvasRef.current?.getContext('2d') ?? null;
  }, []);

  return {
    displayCanvasRef,
    maskCanvasRef,
    canvasSize,
    imageSize,
    isDrawingRef,
    rectStartRef,
    lastPosRef,
    initCanvas,
    screenToCanvas,
    getMaskCtx,
    getDisplayCtx,
  };
}
