import { useUploadStore } from '../store/useUploadStore';
import { useCharacterSheetStore } from '../store/useCharacterSheetStore';
import { useToast } from '../store/useToast';
import { fileToDataUrl, validateImageFile } from '../lib/validation';
import { ZoomButton } from './ImageLightbox';
import '../styles/character-breakdown.css';

export function CharacterOriginalReferences({ compact = false }: { compact?: boolean }) {
  const source = useUploadStore((state) => state.uploadedImage);
  const originals = useCharacterSheetStore((state) => source ? state.originalsBySource[source] : undefined);
  const sheet = useCharacterSheetStore((state) => source ? state.sheets[source] : undefined);
  const busy = sheet?.uploading || sheet?.slot.status === 'loading';
  return <div className={`character-originals${compact ? ' is-compact' : ''}`}>
    <strong>关联原始角色参考</strong>
    <p className="character-breakdown-hint">{originals?.length
      ? '原图已与当前三视图关联：生成拆解图时优先还原原图；后续影画中，原图负责身份与体型，选中的拆解图负责衣装。'
      : '尚未关联独立原图，暂用当前主图。若三视图衣装跑偏，请在这里补充原始角色图。'}</p>
    <label>上传原始正面、侧面或背面（最多3张，重新选择会替换）
      <input type="file" multiple aria-label="上传原始角色参考" accept="image/png,image/jpeg,image/webp" disabled={!source || busy}
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (!source || !files.length) return;
          if (files.length > 3) { useToast.getState().show('原始角色参考最多3张'); return; }
          for (const file of files) {
            const check = validateImageFile(file);
            if (!check.ok) { useToast.getState().show(check.message ?? '文件校验失败'); return; }
          }
          const store = useCharacterSheetStore.getState();
          store.setUploading(source, true);
          try { store.setOriginals([source], await Promise.all(files.map(fileToDataUrl))); }
          catch { useToast.getState().show('原始角色图读取失败，请重新选择'); }
          finally { store.setUploading(source, false); }
        }} />
    </label>
    {originals?.length ? <div className="character-originals-previews">
      {originals.map((url, index) => <div key={url} className="relative"><img src={url} alt={`关联原始角色参考 ${index + 1}`} data-no-inpaint /><ZoomButton src={url} alt={`关联原始角色参考 ${index + 1}`} compact /></div>)}
    </div> : null}
  </div>;
}
