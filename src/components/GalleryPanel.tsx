import { useEffect, useState, memo } from 'react';
import {
  deleteFromGallery,
  galleryImageProxyUrl,
  listGalleryPage,
  GALLERY_PAGE_SIZE,
  type GalleryRow,
} from '../lib/galleryClient';
import { formatTime } from '../lib/formatTime';
import { SectionHeader } from './SectionHeader';
import { ZoomButton } from './ImageLightbox';

const TOKENS_KEY = 'yinghua_gallery_tokens';

function readTokens(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * A gallery thumbnail that falls back to the backend image proxy.
 *
 * Images live on *.supabase.co, which some visitors can't reach. The direct URL
 * is tried first so a healthy connection costs us no bandwidth; on error we
 * switch to the proxy once. `failed` only ever flips false→true, so if the
 * proxy fails too the browser shows a broken image instead of looping.
 */
const GalleryImage = memo(function GalleryImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const proxied = galleryImageProxyUrl(url);
  return (
    <div className="relative">
      <img
        src={failed ? proxied : url}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-full object-contain"
      />
      {/* Enlarge the URL this thumbnail actually resolved with, so visitors who
          can't reach supabase directly get the proxied full image too. */}
      <ZoomButton src={failed ? proxied : url} alt={alt} fallbackSrc={proxied} />
    </div>
  );
});

export const GalleryPanel = memo(function GalleryPanel() {
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | string | null>(null);
  // Tokens are read fresh from localStorage on every render, so a work saved
  // after this panel already mounted is still deletable without a reload.
  const tokens = readTokens();

  const loadGallery = async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const page = await listGalleryPage({ offset: 0 });
      setRows(page.rows);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (mode === 'initial') setLoading(false);
      else setRefreshing(false);
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listGalleryPage({ offset: rows.length });
      // Append rather than replace; a concurrent save could shift rows, but a
      // duplicate thumbnail is a far better failure than losing the page.
      setRows((prev) => [...prev, ...page.rows]);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const deleteRow = async (id: number | string) => {
    const token = readTokens()[String(id)];
    if (!token) {
      setError('只有保存该作品的浏览器可以删除它');
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      await deleteFromGallery(id, token);
      const next = { ...readTokens() };
      delete next[id];
      try { localStorage.setItem(TOKENS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      await loadGallery('refresh');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    void loadGallery();
  }, []);

  return (
    <section className="glass p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <SectionHeader step="07" title="画廊 · 生成作品" />
          <p className="mt-1 font-mono text-[10px] text-zzz-text/40">（共预计可存800张，一般来说不用删除，上传你认为好看的，值得大家一起欣赏的作品吧！）</p>
        </div>
        <button
          onClick={() => void loadGallery('refresh')}
          disabled={refreshing || loading}
          className="glass-btn px-3 py-1.5 font-mono text-xs text-zzz-text disabled:opacity-40"
        >
          {refreshing ? '刷新中…' : '刷新画廊'}
        </button>
      </div>

      {loading && (
        <p className="mt-2 font-mono text-xs text-zzz-text/50">加载中…</p>
      )}

      {error && (
        <div className="mt-2 flex items-center gap-3">
          <p className="font-mono text-xs text-zzz-magenta">⚠ {error}</p>
          <button
            onClick={() => void loadGallery('initial')}
            disabled={loading || refreshing}
            className="glass-btn px-2 py-1 font-mono text-[10px] text-zzz-text disabled:opacity-40"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="mt-2 font-mono text-xs text-zzz-text/45">还没有保存的作品，生成影画后点击「保存到画廊」按钮即可在此查看。</p>
      )}

      {rows.length > 0 && (
        // max-h caps the panel to roughly 5 rows at the 4-column breakpoint;
        // overflow-y-auto scrolls internally instead of growing the page to
        // fit every fetched row.
        <div className="mt-3 max-h-[900px] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {rows.map((row) => (
            <div
              key={row.id}
              className="group relative overflow-hidden rounded-xl border border-zzz-text/10 bg-zzz-text/[0.03]"
            >
              <GalleryImage url={row.image_url} alt={row.style} />
              <div className="p-2 font-mono text-[10px] text-zzz-text/55 leading-relaxed">
                <div className="text-zzz-primary/80 truncate">{row.style}</div>
                {row.character_name && <div>角色：{row.character_name}</div>}
                {row.provider && <div className="text-zzz-text/35">提供方：{row.provider}</div>}
                <div className="text-zzz-text/35">{formatTime(row.created_at, 'Asia/Shanghai')}</div>
                {tokens[String(row.id)] && (
                  <button
                    onClick={() => void deleteRow(row.id)}
                    disabled={deletingId === row.id}
                    className="glass-btn mt-2 px-2 py-1 text-[10px] text-zzz-magenta disabled:opacity-40"
                  >
                    {deletingId === row.id ? '删除中…' : '删除'}
                  </button>
                )}
              </div>
            </div>
          ))}
          </div>

          {hasMore && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore || refreshing}
                className="glass-btn px-4 py-1.5 font-mono text-xs text-zzz-text disabled:opacity-40"
              >
                {loadingMore ? '加载中…' : `加载更多（每次 ${GALLERY_PAGE_SIZE} 张）`}
              </button>
            </div>
          )}
        </div>
      )}

    </section>
  );
});
