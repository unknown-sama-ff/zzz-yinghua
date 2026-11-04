import { galleryImageProxyUrl, listGalleryPage, type GalleryPage, type GalleryRow } from './galleryClient';

const PUZZLE_STYLES = new Set(['自由创作', '动作底稿', '海报版']);

export function eligiblePuzzleImages(rows: GalleryRow[]): GalleryRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!PUZZLE_STYLES.has(row.style.trim()) || !row.image_url || seen.has(row.image_url)) return false;
    seen.add(row.image_url);
    return true;
  });
}

/** Read every page once, rather than limiting random draws to the newest gallery page. */
export async function loadPuzzleGallery(
  listPage: (options: { limit: number; offset: number }) => Promise<GalleryPage> = listGalleryPage,
): Promise<GalleryRow[]> {
  const rows: GalleryRow[] = [];
  const ids = new Set<string>();
  let offset = 0;
  while (true) {
    const page = await listPage({ limit: 200, offset });
    const fresh = page.rows.filter((row) => !ids.has(String(row.id)));
    for (const row of fresh) ids.add(String(row.id));
    rows.push(...fresh);
    if (!page.hasMore || fresh.length === 0) break;
    offset += page.rows.length;
  }
  return eligiblePuzzleImages(rows);
}

export function pickPuzzleImage(rows: GalleryRow[], currentUrl?: string, random = Math.random): GalleryRow | null {
  const alternatives = rows.filter((row) => row.image_url !== currentUrl);
  const candidates = alternatives.length ? alternatives : rows;
  return candidates.length ? candidates[Math.floor(random() * candidates.length)] : null;
}

export async function loadPuzzleImage(url: string): Promise<{ src: string; width: number; height: number }> {
  const load = (src: string, timeout: number) => new Promise<{ src: string; width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => done(false), timeout);
    const done = (success: boolean) => {
      window.clearTimeout(timer);
      image.onload = image.onerror = null;
      if (success && image.naturalWidth && image.naturalHeight) resolve({ src, width: image.naturalWidth, height: image.naturalHeight });
      else { image.src = ''; reject(new Error('这张图片暂时无法加载，请换一张重试。')); }
    };
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = src;
  });
  try { return await load(url, 8000); }
  catch { return load(galleryImageProxyUrl(url), 15000); }
}
