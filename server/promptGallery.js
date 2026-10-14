import crypto from 'node:crypto';
import sharp from 'sharp';
import { MAX_INPUT_PIXELS } from './lib/constants.js';

const BUCKET = 'gallery-images';
const CATEGORIES = new Set(['场景', '角色', '风格', '构图', '其他']);
const DELETE_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 3;
let client;

export class PromptGalleryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PromptGalleryError';
  }
}

export const PROMPT_GALLERY_CATEGORIES = [...CATEGORIES];

function ensureOk(result, message) {
  if (result.error) throw new PromptGalleryError(`${message}: ${result.error.message}`);
  return result.data;
}

async function db() {
  if (!client) {
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) throw new PromptGalleryError('提示词画廊尚未配置 Supabase 服务端凭据');
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return client;
}

function publicObjectPath(url) {
  try {
    const parsed = new URL(url);
    const prefix = `/storage/v1/object/public/${BUCKET}/prompt-gallery/`;
    return parsed.pathname.startsWith(prefix) ? `prompt-gallery/${parsed.pathname.slice(prefix.length)}` : null;
  } catch {
    return null;
  }
}

export function validatePromptInput({ title, prompt, category, deleteToken, files = [] }) {
  if (typeof title !== 'string' || !title.trim() || [...title.trim()].length > 80) throw new PromptGalleryError('标题必填且不能超过 80 字');
  if (typeof prompt !== 'string' || !prompt.trim() || [...prompt.trim()].length > 2000) throw new PromptGalleryError('提示词必填且不能超过 2000 字');
  if (!CATEGORIES.has(category)) throw new PromptGalleryError('提示词分类无效');
  if (!DELETE_TOKEN_RE.test(deleteToken || '')) throw new PromptGalleryError('删除凭证无效');
  if (!Array.isArray(files) || files.length > MAX_IMAGES) throw new PromptGalleryError('每条提示词最多上传 3 张参考图');
  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) throw new PromptGalleryError('图片仅支持 PNG、JPEG 或 WebP');
    if (!file.buffer?.length || file.size > MAX_IMAGE_BYTES) throw new PromptGalleryError('图片为空或超过 10 MB');
  }
}

export async function savePrompt({ title, prompt, category, deleteToken, files = [] }) {
  validatePromptInput({ title, prompt, category, deleteToken, files });
  const supabase = await db();
  const paths = [];
  try {
    const imageUrls = [];
    for (const file of files) {
      let webp;
      try {
        const meta = await sharp(file.buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
        if (!meta.format || !['png', 'jpeg', 'jpg', 'webp'].includes(meta.format)) throw new Error('unsupported');
        webp = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS }).webp({ quality: 88 }).toBuffer();
      } catch {
        throw new PromptGalleryError('图片数据无效（仅支持 PNG/JPEG/WebP）');
      }
      const path = `prompt-gallery/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.webp`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, webp, {
        contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable', upsert: false,
      });
      if (error) throw new PromptGalleryError(`提示词图片上传失败: ${error.message}`);
      paths.push(path);
      imageUrls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
    }

    const result = await supabase.from('prompt_gallery').insert({
      title: title.trim(), prompt: prompt.trim(), category, reference_image_urls: imageUrls,
      delete_token_hash: crypto.createHash('sha256').update(deleteToken).digest('hex'),
    }).select('id, created_at, title, prompt, category, reference_image_urls').single();
    if (result.error) throw new PromptGalleryError(`提示词保存失败: ${result.error.message}`);
    return result.data;
  } catch (error) {
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
    throw error;
  }
}

export async function listPrompts({ limit = 24, offset = 0, query = '', category = '' } = {}) {
  const supabase = await db();
  let request = supabase.from('prompt_gallery')
    .select('id, created_at, title, prompt, category, reference_image_urls')
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (query) {
    const escaped = query.normalize('NFKC').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (escaped) request = request.or(`title.ilike.%${escaped}%,prompt.ilike.%${escaped}%`);
  }
  if (category && CATEGORIES.has(category)) request = request.eq('category', category);
  return ensureOk(await request, '查询提示词失败');
}

export async function deletePrompt({ id, deleteToken }) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id) || !DELETE_TOKEN_RE.test(deleteToken || '')) {
    throw new PromptGalleryError('提示词记录或删除凭证无效');
  }
  const supabase = await db();
  const row = ensureOk(await supabase.from('prompt_gallery').select('id, reference_image_urls, delete_token_hash').eq('id', id).maybeSingle(), '查询提示词失败');
  if (!row) return { ok: false, reason: 'not_found' };
  const expected = crypto.createHash('sha256').update(deleteToken).digest('hex');
  if (row.delete_token_hash !== expected) return { ok: false, reason: 'forbidden' };
  const paths = (row.reference_image_urls || []).map(publicObjectPath).filter(Boolean);
  if (paths.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) console.warn('[prompt-gallery] image cleanup failed:', error.message);
  }
  ensureOk(await supabase.from('prompt_gallery').delete().eq('id', id), '删除提示词失败');
  return { ok: true };
}

export function setPromptGalleryClientForTests(value) { client = value; }
