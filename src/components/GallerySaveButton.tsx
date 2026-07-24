import { useState, memo } from 'react';
import { supabase } from '../lib/supabase';
import { parseDataUrl } from '../lib/validation';

export interface GallerySaveInfo {
  imageUrl: string;
  style: string;
  characterName: string;
  prompt: string;
  provider: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  saveInfo: GallerySaveInfo;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片解码失败'));
    };
    image.src = objectUrl;
  });
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('WebP 编码失败'));
      },
      'image/webp',
      0.9,
    );
  });
}

async function convertToWebp(source: Blob): Promise<Blob> {
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;

  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(source);
    } else {
      image = await loadImageFromBlob(source);
    }
  } catch {
    image = await loadImageFromBlob(source);
  }

  const width = bitmap?.width ?? image?.naturalWidth;
  const height = bitmap?.height ?? image?.naturalHeight;
  if (!width || !height) throw new Error('图片尺寸无效');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片画布');

  try {
    context.drawImage(bitmap ?? image!, 0, 0);
    return await canvasToWebp(canvas);
  } finally {
    bitmap?.close();
  }
}

export const GallerySaveButton = memo(function GallerySaveButton({ saveInfo }: Props) {
  const [state, setState] = useState<SaveState>('idle');

  const handleSave = async () => {
    setState('saving');
    try {
      const { mime, base64 } = parseDataUrl(saveInfo.imageUrl);
      const bytes = base64ToUint8Array(base64);
      const arrayBuffer = new Uint8Array(bytes).buffer as ArrayBuffer;
      const source = new Blob([arrayBuffer], { type: mime || 'image/png' });
      const webp = await convertToWebp(source);
      const path = `gallery/${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;

      const { error: uploadError } = await supabase.storage
        .from('gallery-images')
        .upload(path, webp, {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage
        .from('gallery-images')
        .getPublicUrl(path);

      const { error } = await supabase.from('gallery').insert({
        image_url: publicData.publicUrl,
        style: saveInfo.style,
        character_name: saveInfo.characterName,
        prompt: saveInfo.prompt,
        provider: saveInfo.provider,
      });
      if (error) throw error;
      setState('saved');
    } catch {
      setState('error');
      // Let the user retry after a moment.
      setTimeout(() => setState('idle'), 3000);
    }
  };

  if (state === 'saved') {
    return <span className="font-mono text-xs text-zzz-accent">已保存</span>;
  }

  if (state === 'saving') {
    return <span className="font-mono text-xs text-zzz-text/50">保存中…</span>;
  }

  return (
    <button onClick={handleSave} className="glass-btn px-3 py-1 text-xs text-zzz-text">
      {state === 'error' ? '保存失败，重试' : '保存到画廊'}
    </button>
  );
});
