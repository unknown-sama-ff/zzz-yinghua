import { useUploadStore } from '../store/useUploadStore';
import { useCharacterSheetStore } from '../store/useCharacterSheetStore';
import { useIdentityStore } from '../store/useIdentityStore';
import { useProviderStore } from '../store/useProviderStore';
import { useToast } from '../store/useToast';
import { fileToDataUrl, validateImageFile } from '../lib/validation';
import { downloadImage } from '../lib/download';
import { ZoomButton } from './ImageLightbox';
import { GallerySaveButton } from './GallerySaveButton';
import '../styles/character-breakdown.css';

/** Selection is always scoped to the current canonical image, including uploads. */
export function CharacterBreakdownReference({ compact = false }: { compact?: boolean }) {
  const source = useUploadStore((state) => state.uploadedImage);
  const sheet = useCharacterSheetStore((state) => source ? state.sheets[source] : undefined);
  const name = useIdentityStore((state) => state.characterName);
  const provider = useProviderStore((state) => state.provider);
  const selected = sheet?.images.find((image) => image.url === sheet.selectedImage);
  const busy = sheet?.uploading || sheet?.slot.status === 'loading';
  return <div className={`character-breakdown-reference${compact ? ' is-compact' : ''}`} aria-busy={busy}>
    <label>配套角色拆解图
      <select className="glass-input" aria-label="配套角色拆解图" disabled={!source || busy}
        value={selected ? String(sheet!.images.indexOf(selected)) : ''}
        onChange={(event) => source && useCharacterSheetStore.getState().selectImage(source,
          event.target.value === '' ? null : sheet!.images[Number(event.target.value)].url)}>
        <option value="">不使用拆解图</option>
        {sheet?.images.map((image, index) => <option key={image.url} value={index}>拆解图 {index + 1}{image.characterName ? ` · ${image.characterName}` : ''}</option>)}
      </select>
    </label>
    <label className="character-breakdown-upload">手动上传配套拆解图
      <input type="file" aria-label="上传角色拆解图" accept="image/png,image/jpeg,image/webp" disabled={!source || busy}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || !source) return;
          const check = validateImageFile(file);
          if (!check.ok) { useToast.getState().show(check.message ?? '文件校验失败'); return; }
          useCharacterSheetStore.getState().setUploading(source, true);
          try {
            const url = await fileToDataUrl(file);
            if (name.trim()) useCharacterSheetStore.getState().registerSources([source], name);
            useCharacterSheetStore.getState().addImages(source, [{ url, characterName: name.trim(), prompt: '手动上传的角色拆解图', provider }]);
            useCharacterSheetStore.getState().setSlot(source, { status: 'done', error: undefined, images: [url] });
          } catch {
            useToast.getState().show('拆解图读取失败，请重新选择');
          } finally { useCharacterSheetStore.getState().setUploading(source, false); }
        }} />
    </label>
    <p className="character-breakdown-hint">{!source ? '请先选择或上传角色三视图。' : selected ? '已与当前三视图配对，后续影画的服饰、配饰与服装配色以此拆解图为准。' : '当前三视图尚未选用拆解图，可生成后自动配对，也可手动上传。'}</p>
    {selected && <figure className="character-breakdown-preview">
      <div className="relative"><img src={selected.url} alt="当前配套角色拆解图" data-no-inpaint /><ZoomButton src={selected.url} alt="当前配套角色拆解图" /></div>
      <figcaption>
        <button type="button" className="glass-btn" onClick={() => void downloadImage(selected.url, 'character-breakdown.png')}>下载拆解图</button>
        <GallerySaveButton key={selected.url} saveInfo={{ imageUrl: selected.url, style: '角色拆解图', characterName: selected.characterName, prompt: selected.prompt, provider: selected.provider }} />
      </figcaption>
    </figure>}
  </div>;
}
