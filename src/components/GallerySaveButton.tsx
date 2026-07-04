import { useState } from 'react';
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

function extensionFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  return 'png';
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function GallerySaveButton({ saveInfo }: Props) {
  const [state, setState] = useState<SaveState>('idle');

  const handleSave = async () => {
    setState('saving');
    try {
      const { mime, base64 } = parseDataUrl(saveInfo.imageUrl);
      const bytes = base64ToUint8Array(base64);
      const arrayBuffer = new Uint8Array(bytes).buffer as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: mime || 'image/png' });
      const ext = extensionFromMime(mime || 'image/png');
      const path = `gallery/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('gallery-images')
        .upload(path, blob, { contentType: mime || 'image/png', upsert: false });
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
}
