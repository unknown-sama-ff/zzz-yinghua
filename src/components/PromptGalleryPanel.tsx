import { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { deletePromptGallery, forgetPromptToken, listPromptGallery, promptImageProxyUrl, PROMPT_CATEGORIES, readPromptTokens, type PromptCategory, type PromptGalleryRow } from '../lib/promptGalleryClient';
import { promptDraftReplacement } from '../lib/promptDraft';
import { formatTime } from '../lib/formatTime';
import { useFreeCreateStore } from '../store/useFreeCreateStore';
import { ZoomButton } from './ImageLightbox';

const PAGE_SIZE = 24;

function usePrompt(row: PromptGalleryRow) {
  const state = useFreeCreateStore.getState();
  const active = state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0];
  const nextDraft = promptDraftReplacement(active.draft, row.prompt, () => window.confirm('当前草稿不为空。替换为这个提示词吗？'));
  if (nextDraft === null) return;
  state.open();
  state.setDraft(nextDraft, active.id);
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#free-create-window textarea')?.focus());
}

const PromptImage = memo(function PromptImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const proxyUrl = promptImageProxyUrl(url);
  return <figure className="relative overflow-hidden rounded border border-zzz-text/10 bg-black/20">
    <img src={failed ? proxyUrl : url} alt={alt} loading="lazy" onError={() => setFailed(true)} className="max-h-72 w-full object-contain" />
    <ZoomButton src={failed ? proxyUrl : url} alt={alt} fallbackSrc={proxyUrl} />
  </figure>;
});

export const PromptGalleryPanel = memo(function PromptGalleryPanel() {
  const [rows, setRows] = useState<PromptGalleryRow[]>([]);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PromptCategory | ''>('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [tokens, setTokens] = useState<Record<string, string>>(readPromptTokens);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const load = useCallback(async (append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const page = await listPromptGallery({ query, category, limit: PAGE_SIZE, offset: append ? rows.length : 0 });
      setRows((current) => append ? [...current, ...page.rows] : page.rows);
      setHasMore(page.hasMore);
    } catch (err) { setError(err instanceof Error ? err.message : '加载失败'); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [query, category, rows.length]);

  useEffect(() => { void load(); }, [query, category]);

  const remove = async (id: string) => {
    const token = tokens[id];
    if (!token || !window.confirm('删除这条公开提示词及其参考图片？')) return;
    setDeleting(id);
    try {
      await deletePromptGallery(id, token);
      forgetPromptToken(id);
      setTokens((current) => { const next = { ...current }; delete next[id]; return next; });
      setRows((current) => current.filter((row) => row.id !== id));
    } catch (err) { setError(err instanceof Error ? err.message : '删除失败'); }
    finally { setDeleting(null); }
  };

  const heading = useMemo(() => <div className="flex flex-wrap items-end justify-between gap-3">
    <div><span className="font-mono text-[10px] text-zzz-cyan/65">COMMUNITY PROMPTS</span><h2 className="zzz-heading mt-1 text-xl text-zzz-text sm:text-2xl">提示词画廊</h2><p className="mt-1 text-xs text-zzz-text/45">浏览灵感，选择后带入自由创作</p></div>
    <a href="#prompt-gallery" className="glass-btn px-3 py-2 text-xs text-zzz-text/65" onClick={(event) => { event.preventDefault(); document.querySelector('#prompt-gallery-search')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>浏览提示词</a>
  </div>, []);

  return <section id="prompt-gallery" className="border-t border-zzz-text/15 py-7 sm:py-9">
    {heading}
    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="flex-1"><span className="sr-only">搜索标题或提示词</span><input id="prompt-gallery-search" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索标题或提示词" className="w-full rounded border border-zzz-text/15 bg-black/25 px-3 py-2.5 text-sm text-zzz-text placeholder:text-zzz-text/35 focus:outline-none focus:ring-2 focus:ring-zzz-cyan/40" /></label>
      <div role="group" aria-label="提示词分类" className="flex gap-1.5 overflow-x-auto pb-1">{(['', ...PROMPT_CATEGORIES] as const).map((item) => <button key={item || 'all'} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`glass-btn shrink-0 px-2.5 py-2 text-xs ${category === item ? 'text-zzz-cyan' : 'text-zzz-text/55'}`}>{item || '全部'}</button>)}</div>
    </div>

    {error && <div role="alert" className="mt-4 flex items-center gap-3 text-xs text-zzz-magenta"><span>{error}</span><button type="button" onClick={() => void load()} className="glass-btn px-2 py-1 text-zzz-text">重试</button></div>}
    {loading ? <p className="py-10 text-center text-xs text-zzz-text/45">正在载入提示词…</p> : !rows.length ? <div className="py-12 text-center"><p className="text-sm text-zzz-text/65">还没有符合条件的提示词</p><p className="mt-1 text-xs text-zzz-text/40">分享你的下一条自由创作提示词</p></div> : <>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => <article key={row.id} className="flex min-w-0 flex-col border-b border-zzz-text/12 pb-4">
          {row.reference_image_urls?.length > 0 && <div className={`mb-3 grid gap-2 ${row.reference_image_urls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>{row.reference_image_urls.map((url, index) => <PromptImage key={`${row.id}-${index}`} url={url} alt={`${row.title} 参考图 ${index + 1}`} />)}</div>}
          <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-base text-zzz-text">{row.title}</h3><span className="shrink-0 border border-zzz-primary/25 px-2 py-0.5 text-[10px] text-zzz-primary/85">{row.category}</span></div>
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-zzz-text/70">{row.prompt}</p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4"><time className="font-mono text-[10px] text-zzz-text/35">{formatTime(row.created_at, 'Asia/Shanghai')}</time><span className="flex items-center gap-2"><button type="button" onClick={() => usePrompt(row)} className="glass-btn px-3 py-1.5 text-xs text-zzz-cyan">使用提示词</button>{tokens[row.id] && <button type="button" disabled={deleting === row.id} onClick={() => void remove(row.id)} className="glass-btn px-2 py-1.5 text-xs text-zzz-magenta disabled:opacity-40">{deleting === row.id ? '删除中…' : '删除'}</button>}</span></div>
        </article>)}
      </div>
      {hasMore && <div className="mt-5 flex justify-center"><button type="button" disabled={loadingMore} onClick={() => void load(true)} className="glass-btn px-4 py-2 text-xs text-zzz-text/70 disabled:opacity-40">{loadingMore ? '载入中…' : '加载更多'}</button></div>}
    </>}
  </section>;
});
