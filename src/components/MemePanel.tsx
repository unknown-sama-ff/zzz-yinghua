import { useEffect, useState } from 'react';
import { useMemeStore, type MemeResult } from '../store/useMemeStore';
import { useProviderStore } from '../store/useProviderStore';
import { useUploadStore } from '../store/useUploadStore';
import { useIdentityStore } from '../store/useIdentityStore';
import { useLightboxStore } from '../store/useLightboxStore';
import { useToast } from '../store/useToast';
import { memeReferenceCount, type MemeReference } from '../lib/meme';
import { defaultMemeCuts, readMemeImage, zipMemeTiles, type MemeCuts } from '../lib/memeImages';
import { maxInputImagesForModel, supportsGptImageTransparency } from '../lib/gptImageCapabilities';
import { fileToDataUrl, validateImageFile } from '../lib/validation';
import { downloadBlob, downloadImage } from '../lib/download';
import { GallerySaveButton } from './GallerySaveButton';
import '../styles/meme.css';

function MemeUpload({ label, items, max, onChange, compact = false }: {
  label: string; items: MemeReference[]; max: number; onChange: (items: MemeReference[]) => void; compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const open = useLightboxStore((s) => s.open);
  const notify = useToast((s) => s.show);
  const select = async (files: File[]) => {
    if (!files.length || loading) return;
    if (max > 1 && items.length + files.length > max) { notify(`${label}最多${max}张。`); return; }
    setLoading(true);
    useMemeStore.getState().trackUpload(1);
    try {
      const added: MemeReference[] = [];
      for (const file of files.slice(0, max)) {
        const check = validateImageFile(file);
        if (!check.ok || !file.size) throw new Error(check.message || '图片内容为空，请重新选择。');
        const dataUrl = await fileToDataUrl(file);
        await readMemeImage(dataUrl);
        added.push({ id: crypto.randomUUID(), name: file.name, dataUrl });
      }
      onChange(max === 1 ? added : [...items, ...added]);
    } catch (error) { notify(error instanceof Error ? error.message : '图片读取失败'); }
    finally { setLoading(false); useMemeStore.getState().trackUpload(-1); }
  };
  return <div className={`meme-upload ${compact ? 'meme-upload-compact' : ''}`}>
    <div className="meme-upload-items">
      {items.map((image) => <div className="meme-reference" key={image.id}>
        <button type="button" onClick={() => open(image.dataUrl, image.name)} title={image.name} aria-label={`预览${label}：${image.name}`}><img src={image.dataUrl} alt={image.name} /></button>
        <button type="button" disabled={loading} className="meme-remove" onClick={() => onChange(items.filter((item) => item.id !== image.id))} aria-label={`移除${label}：${image.name}`}>×</button>
      </div>)}
      {(max === 1 || items.length < max) && <label className={`meme-upload-target ${items.length ? 'meme-upload-replace' : ''}`}>
        <span aria-hidden="true">{loading ? '…' : '+'}</span><span>{loading ? '读取图片中…' : items.length && max === 1 ? '更换图片' : label}</span>
        {!compact && !items.length && <small>PNG / JPG / WebP · 每张 ≤10 MB</small>}
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple={max > 1} disabled={loading} aria-label={`上传${label}`} onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void select(files);
        }} />
      </label>}
    </div>
  </div>;
}

function MemeCutEditor({ result }: { result: MemeResult }) {
  const [cuts, setCuts] = useState<MemeCuts>(() => ({ x: [...result.cuts.x], y: [...result.cuts.y] }));
  const busy = useMemeStore((s) => s.busy);
  const recut = useMemeStore((s) => s.recut);
  useEffect(() => { setCuts({ x: [...result.cuts.x], y: [...result.cuts.y] }); }, [result.cuts]);
  return <details className="meme-cut-editor">
    <summary>调整拆图切线 <span>排版偏移时使用 · 不消耗额度</span></summary>
    <div className="meme-cut-layout">
      <div className="meme-cut-preview meme-checker" aria-label="原图与切线预览">
        <img src={result.original.dataUrl} alt="表情包原图" />
        {cuts.x.slice(1, -1).map((x, i) => <i key={`x${i}`} className="meme-cut-vertical" style={{ left: `${x / result.original.width * 100}%` }} />)}
        {cuts.y.slice(1, -1).map((y, i) => <i key={`y${i}`} className="meme-cut-horizontal" style={{ top: `${y / result.original.height * 100}%` }} />)}
      </div>
      <fieldset disabled={busy} className="meme-cut-controls">
        <p>切线以原图为准；已经重做的单张会保留。</p>
        {(['x', 'y'] as const).map((axis) => cuts[axis].slice(1, -1).map((value, index) => <label key={`${axis}${index}`}>
          {axis === 'x' ? '竖' : '横'}线 {index + 1}<output>{value} px</output>
          <input type="range" aria-label={`${axis === 'x' ? '竖' : '横'}向切线${index + 1}`} min={cuts[axis][index] + 1} max={cuts[axis][index + 2] - 1} value={value}
            onChange={(event) => setCuts({ ...cuts, [axis]: cuts[axis].map((old, i) => i === index + 1 ? Number(event.target.value) : old) })} />
        </label>))}
        <div className="meme-button-row"><button type="button" className="glass-btn" onClick={() => setCuts(defaultMemeCuts(result.original.width, result.original.height, result.snapshot.count === 9 ? 3 : 5, 3))}>恢复等分</button>
          <button type="button" className="glass-btn" onClick={() => void recut(cuts)}>应用切线</button></div>
      </fieldset>
    </div>
  </details>;
}

export function MemePanel() {
  const state = useMemeStore();
  const { draft, result, busy } = state;
  const uploaded = useUploadStore((s) => s.uploadedImage);
  const uploadedName = useUploadStore((s) => s.uploadedName);
  const characterName = useIdentityStore((s) => s.characterName);
  const settings = useProviderStore();
  const open = useLightboxStore((s) => s.open);
  const notify = useToast((s) => s.show);
  const [exporting, setExporting] = useState(false);
  const maxInputs = settings.freeloadEnabled ? settings.presetMaxInputImages ?? 1 : maxInputImagesForModel(settings.provider, settings.creds['gpt-image'].model);
  const transparent = settings.freeloadEnabled ? settings.presetTransparencySupported === true : supportsGptImageTransparency(settings.creds['gpt-image'].model);
  const count = memeReferenceCount(draft);
  const blocked = busy || Boolean(state.uploads || state.uncertain || state.pendingOutput);
  const updateRefs = (patch: Partial<typeof draft>) => {
    if (memeReferenceCount({ ...useMemeStore.getState().draft, ...patch }) > 16) {
      notify('输入图片合计最多16张，请减少参考图。'); return;
    }
    state.patchDraft(patch);
  };
  const exportZip = async () => {
    if (!result || exporting) return;
    setExporting(true);
    try { downloadBlob(await zipMemeTiles(result.tiles, result.snapshot.tiles.map((tile) => tile.caption)), `表情包-${result.snapshot.count}张.zip`); }
    catch (error) { notify(error instanceof Error ? error.message : '打包失败，请重试'); }
    finally { setExporting(false); }
  };

  return <div className="meme-page">
    <header className="meme-heading">
      <div><p className="studio-eyebrow">CHARACTER → STICKERS</p><h1>同一个角色，<br /><span>每一种心情。</span></h1><p>把角色的喜怒哀乐，装进你的聊天框。</p></div>
      <div className="meme-heading-stickers" aria-hidden="true"><span>嗨～</span><span>好耶！</span><small>YOUR CHARACTER. YOUR MOOD.</small></div>
    </header>

    <fieldset disabled={busy} className="meme-draft">
      <legend className="sr-only">表情包创作配置</legend>
      <div className="meme-setup">
        <section className="meme-character">
          <div className="meme-section-heading"><h2>角色图</h2><span>决定画谁</span></div>
          <MemeUpload label="角色图" items={draft.character ? [draft.character] : []} max={1} onChange={(items) => updateRefs({ character: items[0] ?? null })} />
          <button type="button" className="meme-reuse glass-btn" disabled={!uploaded} onClick={() => {
            if (uploaded) updateRefs({ character: { id: crypto.randomUUID(), dataUrl: uploaded, name: uploadedName || '当前角色' } });
          }}>复用当前角色</button>
          <p className="meme-help">{draft.character?.name || '上传一张清晰角色图，保留角色的脸、服装和辨识特征。'}</p>
        </section>
        <div className="meme-references">
          <section><div className="meme-section-heading"><h2>风格参考</h2><span>决定怎么画 · 可选 / 最多3张</span></div>
            <p className="meme-help">参考线条、上色与Q版比例。不上传时，沿用角色原画风。</p>
            <MemeUpload label="风格参考" items={draft.styles} max={3} onChange={(styles) => updateRefs({ styles })} />
          </section>
          <section><div className="meme-section-heading"><h2>共用表情参考</h2><span>决定怎么演 · 可选 / 最多3张</span></div>
            <p className="meme-help">上传喜欢的梗图，参考整套的神态、动作与情绪张力。</p>
            <MemeUpload label="共用表情参考" items={draft.expressions} max={3} onChange={(expressions) => updateRefs({ expressions })} />
          </section>
        </div>
      </div>

      <section className="meme-content">
        <div className="meme-content-heading"><div className="meme-section-heading"><h2>这一套，想说什么？</h2><span>每格都能改</span></div>
          <div className="meme-content-actions">
            <button type="button" className="meme-clear-captions glass-btn" disabled={draft.tiles.every((tile) => !tile.caption)} onClick={() => state.patchDraft({ tiles: draft.tiles.map((tile) => ({ ...tile, caption: '' })) })}>一键全套无字</button>
            <div className="meme-count" role="group" aria-label="表情包格数">{([9, 15] as const).map((number) => <button key={number} type="button" aria-pressed={draft.count === number} onClick={() => state.patchDraft({ count: number })}>{number === 9 ? '九宫格' : '15 格'}</button>)}</div>
          </div>
        </div>
        <p className="meme-help">文案留空即为无字表情包；一键清空全套文案，保留动作、神态与参考图。</p>
        <div className="meme-draft-grid">
          {draft.tiles.slice(0, draft.count).map((tile, index) => <article className="meme-tile-draft" key={tile.id}>
            <div className="meme-tile-heading"><span>{String(index + 1).padStart(2, '0')}</span><label>文案<input aria-label={`第${index + 1}格文案`} maxLength={40} value={tile.caption} placeholder="留空则不加字" onChange={(event) => state.patchTile(index, { caption: event.target.value })} /></label></div>
            <label className="meme-expression-label">动作与神态<textarea aria-label={`第${index + 1}格动作与神态`} rows={2} maxLength={600} value={tile.expression} onChange={(event) => state.patchTile(index, { expression: event.target.value })} /></label>
            <MemeUpload label={`第${index + 1}格表情参考`} compact items={tile.reference ? [tile.reference] : []} max={1} onChange={(items) => {
              const next = { ...useMemeStore.getState().draft, tiles: useMemeStore.getState().draft.tiles.map((item, i) => i === index ? { ...item, reference: items[0] ?? null } : item) };
              if (memeReferenceCount(next) > 16) { notify('输入图片合计最多16张，请减少参考图。'); return; }
              state.patchTile(index, { reference: items[0] ?? null });
            }} />
          </article>)}
        </div>
      </section>
    </fieldset>

    <div className="meme-generate-bar">
      <div><strong>一套生成，再拆成单张。</strong><p>AI绘制中文 · 透明PNG · 输入图 {count}/16 张{settings.provider === 'gpt-image' ? ` · 当前通道上限${maxInputs}张` : ''}</p><small>单张清晰度取决于整图尺寸；拆图、调整切线和下载不消耗额度。</small></div>
      <button type="button" className="studio-action studio-action-primary" disabled={blocked} onClick={() => void state.generateSet()}>{busy ? state.phase : state.uploads ? '正在读取参考图片…' : result ? '重新生成整套' : '一键生成表情包'}<span aria-hidden="true">↗</span></button>
    </div>
    {(settings.provider !== 'gpt-image' || !transparent) && <p className="meme-capability-note">需要支持透明输出的 GPT 图片通道。可在右上角「设置」配置接口或开启作者免费通道；不会自动更换模型。</p>}
    {settings.freeloadEnabled && settings.presetQualityStatus !== 'ready' && <p className="meme-capability-note">{settings.presetQualityStatus === 'loading' ? '正在读取通道能力…' : <button type="button" className="glass-btn" onClick={() => void settings.loadPresetQualityOptions()}>重新读取通道能力</button>}</p>}
    {busy && <p className="meme-status" role="status">{state.phase} 可以切换页面，任务会继续运行。</p>}
    {state.error && <div className="meme-error" role="alert">{state.error}</div>}
    {state.warning && <div className="meme-warning" role="alert">{state.warning}</div>}
    {state.uncertain && <div className="meme-recovery"><p>原任务可能仍在运行或已经消耗额度。重试会沿用原请求编号；另发新请求可能重复计费。</p><button type="button" className="glass-btn" disabled={busy} onClick={() => void state.recheck()}>重试原请求</button><button type="button" className="glass-btn" disabled={busy} onClick={state.dismissUncertain}>放弃等待</button></div>}
    {state.pendingOutput && <div className="meme-recovery"><button type="button" className="glass-btn" disabled={busy} onClick={() => void state.retryProcessing()}>重试图片处理（不生图）</button><button type="button" className="glass-btn" disabled={busy} onClick={state.dismissProcessing}>保留原图，结束处理</button></div>}
    {state.rawOutput && <div className="meme-raw-links"><button type="button" onClick={() => open(state.rawOutput!, '最近一次生成的原图')}>查看最近生成原图 ↗</button><button type="button" onClick={() => void downloadImage(state.rawOutput!, '表情包-生成原图.png')}>下载原始结果</button></div>}

    {result && <section className="meme-results" aria-labelledby="meme-results-title">
      <div className="meme-result-heading"><div><p className="studio-eyebrow">YOUR STICKER SHEET</p><h2 id="meme-results-title">这一套，很有戏<span>。</span></h2><p>{result.snapshot.count} 张 · {result.composite.width} × {result.composite.height} px · {result.composite.hasTransparency ? '已检测到透明区域' : '背景不透明'}</p></div>
        <div className="meme-button-row"><button type="button" className="glass-btn" onClick={() => open(result.composite.dataUrl, '当前整套表情包')}>预览整套</button>
          <button type="button" className="glass-btn" onClick={() => void downloadImage(result.composite.dataUrl, '表情包-整套.png')}>下载整图</button>
          <button type="button" className="glass-btn" disabled={exporting} onClick={() => void exportZip()}>{exporting ? '打包中…' : '下载全部 PNG（ZIP）'}</button>
          <GallerySaveButton key={`${result.id}-${result.version}`} saveInfo={{ imageUrl: result.composite.dataUrl, style: '角色表情包', characterName, prompt: result.prompt, provider: 'gpt-image' }} />
        </div>
      </div>
      <MemeCutEditor key={result.id} result={result} />
      <p className="meme-help">单张重做沿用本套的角色与风格，动作、文案和专属参考使用上方对应格的当前配置；其余单张保持不变。</p>
      <div className="meme-result-grid">{result.tiles.map((image, index) => <article className="meme-result-tile" key={`${result.id}-${index}`}>
        <button type="button" className="meme-tile-image meme-checker" onClick={() => open(image.dataUrl, `第${index + 1}张表情：${result.snapshot.tiles[index].caption}`)} aria-label={`预览第${index + 1}张表情`}><img src={image.dataUrl} alt={result.snapshot.tiles[index].caption || `第${index + 1}张表情`} /></button>
        <div className="meme-result-caption"><strong>{String(index + 1).padStart(2, '0')} <span>{result.snapshot.tiles[index].caption || '无字表情'}</span></strong><small>{image.width} × {image.height} px{image.hasTransparency ? '' : ' · 不透明'}{result.revised.includes(index) ? ' · 已重做' : ''}</small></div>
        <div className="meme-tile-actions"><button type="button" onClick={() => void downloadImage(image.dataUrl, `表情包-${String(index + 1).padStart(2, '0')}.png`)}>下载 PNG</button><button type="button" disabled={blocked} onClick={() => void state.redoTile(index)}>{state.busyTile === index ? '重做中…' : '重做这张'}</button>
          <GallerySaveButton key={`${result.id}-${index}-${result.tileVersions[index]}`} saveInfo={{ imageUrl: image.dataUrl, style: '角色表情包', characterName, prompt: result.snapshot.tiles[index].expression + '\n文案：' + result.snapshot.tiles[index].caption, provider: 'gpt-image' }} />
        </div>
      </article>)}</div>
    </section>}
  </div>;
}
