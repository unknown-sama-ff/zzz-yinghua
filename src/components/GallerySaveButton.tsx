import { useRef, useState, memo } from 'react';
import { saveGalleryImage, type GalleryImageMetadata } from '../lib/gallerySave';

export interface GallerySaveInfo extends GalleryImageMetadata {
  imageUrl: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  saveInfo: GallerySaveInfo;
}

export const GallerySaveButton = memo(function GallerySaveButton({ saveInfo }: Props) {
  const [state, setState] = useState<SaveState>('idle');
  const savingRef = useRef(false);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setState('saving');
    try {
      await saveGalleryImage(saveInfo.imageUrl, saveInfo);
      setState('saved');
    } catch {
      setState('error');
      savingRef.current = false;
      // Let the user retry after a moment.
      setTimeout(() => {
        if (!savingRef.current) setState('idle');
      }, 3000);
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
