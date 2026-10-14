import { useRef, useState, memo } from 'react';
import { validateImageFile } from '../lib/validation';
import { generatePromptDeleteToken, rememberPromptToken, savePromptGallery, PROMPT_CATEGORIES, type PromptCategory } from '../lib/promptGalleryClient';

const tokenBytes = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

function suggestedTitle(prompt: string): string {
  return prompt.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 80) || '我的提示词';
}

export const PromptShareButton = memo(function PromptShareButton({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(() => suggestedTitle(prompt));
  const [category, setCategory] = useState<PromptCategory>('其他');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shared, setShared] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectFiles = (selected: FileList | null) => {
    const next = Array.from(selected || []);
    if (next.length > 3) { setError('最多选择 3 张参考图'); return; }
    for (const file of next) {
      const result = validateImageFile(file);
      if (!result.ok) { setError(result.message || '图片格式或大小不符合要求'); return; }
    }
    setFiles(next);
    setError('');
  };

  const submit = async () => {
    if (!title.trim() || [...title.trim()].length > 80) { setError('标题必填且不能超过 80 字'); return; }
    setBusy(true);
    setError('');
    const deleteToken = generatePromptDeleteToken();
    try {
      const row = await savePromptGallery({ title: title.trim(), prompt, category, deleteToken, referenceImages: files });
      rememberPromptToken(row.id, deleteToken);
      setShared(true);
    } catch (err) { setError(err instanceof Error ? err.message : '分享失败，请重试'); }
    finally { setBusy(false); }
  };

  if (shared) return <span className="font-mono text-xs text-zzz-accent">已公开分享</span>;

  return <>
    <button type="button" onClick={() => setOpen(true)} className="glass-btn px-2 py-1 font-mono text-xs text-zzz-primary">分享提示词</button>
    {open && <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/75 p-3" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="prompt-share-title" className="glass w-full max-w-lg overflow-hidden border border-zzz-text/20">
        <header className="flex items-center justify-between border-b border-zzz-text/12 px-4 py-3"><h3 id="prompt-share-title" className="zzz-heading text-base text-zzz-text">分享提示词</h3><button type="button" disabled={busy} onClick={() => setOpen(false)} aria-label="关闭分享窗口" className="glass-btn flex h-8 w-8 items-center justify-center text-zzz-text/70">×</button></header>
        <div className="space-y-4 p-4">
          <label className="block text-xs text-zzz-text/65">标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} className="mt-1.5 block w-full rounded border border-zzz-text/15 bg-black/25 px-3 py-2 text-sm text-zzz-text focus:outline-none focus:ring-2 focus:ring-zzz-cyan/50" /></label>
          <label className="block text-xs text-zzz-text/65">分类<select value={category} onChange={(event) => setCategory(event.target.value as PromptCategory)} className="mt-1.5 block w-full rounded border border-zzz-text/15 bg-zzz-ink px-3 py-2 text-sm text-zzz-text">{PROMPT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <div><div className="mb-1.5 flex items-center justify-between text-xs text-zzz-text/65"><span>提示词</span><span>{[...prompt].length}/2000</span></div><p className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded border border-zzz-text/10 bg-black/20 p-3 text-xs leading-relaxed text-zzz-text/80">{prompt}</p></div>
          <div><div className="flex items-center justify-between"><span className="text-xs text-zzz-text/65">参考图（可选，最多 3 张）</span><button type="button" onClick={() => fileInput.current?.click()} className="glass-btn px-2 py-1 text-xs text-zzz-cyan">选择图片</button><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => { selectFiles(event.target.files); event.target.value = ''; }} /></div>{files.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{files.map((file) => <span key={tokenBytes(file)} className="flex max-w-full items-center gap-1 rounded border border-zzz-text/15 px-2 py-1 text-[10px] text-zzz-text/65"><span className="max-w-40 truncate">{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))} className="text-zzz-text/50">×</button></span>)}</div>}</div>
          <p className="text-[10px] leading-relaxed text-zzz-text/45">发布后所有访客都可以查看。你可以在提示词画廊中删除自己分享的内容。</p>
          {error && <p role="alert" className="text-xs text-zzz-magenta">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setOpen(false)} className="glass-btn px-3 py-2 text-xs text-zzz-text/60">取消</button><button type="button" disabled={busy} onClick={() => void submit()} className="glass-btn px-4 py-2 text-xs text-zzz-cyan disabled:opacity-40">{busy ? '发布中…' : '公开发布'}</button></div>
        </div>
      </section>
    </div>}
  </>;
});
