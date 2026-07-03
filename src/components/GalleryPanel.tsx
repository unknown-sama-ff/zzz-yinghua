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

  useEffect(() => {
    fetchGallery()
      .then((data) => {
        setRows(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载失败');
        setLoading(false);
      });
  }, []);

  return (
    <section className="glass p-6">
      <SectionHeader step="07" title="画廊 · 生成作品" />

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
                className="w-full object-contain"
              />
              <div className="p-2 font-mono text-[10px] text-zzz-text/55 leading-relaxed">
                <div className="text-zzz-primary/80 truncate">{row.style}</div>
                {row.character_name && <div>角色：{row.character_name}</div>}
                {row.provider && <div className="text-zzz-text/35">提供方：{row.provider}</div>}
                <div className="text-zzz-text/35">{formatTime(row.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
