import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SectionHeader } from './SectionHeader';

interface GalleryRow {
  id: number;
  created_at: string;
  image_url: string;
  style: string;
  character_name: string;
  prompt: string;
  provider: string;
}

async function fetchGallery(): Promise<GalleryRow[]> {
  const { data, error } = await supabase
    .from('gallery')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as GalleryRow[]) ?? [];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function GalleryPanel() {
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const loadGallery = async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await fetchGallery();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (mode === 'initial') setLoading(false);
      else setRefreshing(false);
    }
  };

  const deleteRow = async (id: number) => {
    setDeletingId(id);
    setError(null);
    try {
      const { error } = await supabase.from('gallery').delete().eq('id', id);
      if (error) throw error;
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
        <p className="mt-2 font-mono text-xs text-zzz-magenta">⚠ {error}</p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="mt-2 font-mono text-xs text-zzz-text/45">还没有保存的作品，生成影画后点击「保存到画廊」按钮即可在此查看。</p>
      )}

      {rows.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {rows.map((row) => (
            <div
              key={row.id}
              className="group relative overflow-hidden rounded-xl border border-zzz-text/10 bg-zzz-text/[0.03]"
            >
              <img
                src={row.image_url}
                alt={row.style}
                loading="lazy"
                className="w-full cursor-pointer object-contain"
                onClick={() => setLightbox(row.image_url)}
              />
              <div className="p-2 font-mono text-[10px] text-zzz-text/55 leading-relaxed">
                <div className="text-zzz-primary/80 truncate">{row.style}</div>
                {row.character_name && <div>角色：{row.character_name}</div>}
                {row.provider && <div className="text-zzz-text/35">提供方：{row.provider}</div>}
                <div className="text-zzz-text/35">{formatTime(row.created_at)}</div>
                <button
                  onClick={() => void deleteRow(row.id)}
                  disabled={deletingId === row.id}
                  className="glass-btn mt-2 px-2 py-1 text-[10px] text-zzz-magenta disabled:opacity-40"
                >
                  {deletingId === row.id ? '删除中…' : '删除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="画廊大图"
            className="h-full w-full object-contain"
          />
        </div>
      )}
    </section>
  );
}
