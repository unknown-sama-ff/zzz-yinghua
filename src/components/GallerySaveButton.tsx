import { useState } from 'react';
import { supabase } from '../lib/supabase';

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

export function GallerySaveButton({ saveInfo }: Props) {
  const [state, setState] = useState<SaveState>('idle');

  const handleSave = async () => {
    setState('saving');
    try {
      const { error } = await supabase.from('gallery').insert({
        image_url: saveInfo.imageUrl,
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
