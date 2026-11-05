// ── Gallery write API (server-mediated) ──────────────────────────────────────
//
// The gallery table used to allow anonymous INSERT/DELETE via the anon key,
// which let any visitor wipe the whole gallery and spam rows. Writes now go
// through this server using the service-role key, so the anon key is read-only.
//
// Ownership is enforced with a client-generated delete token: the raw token is
// sent on save/delete but only its SHA-256 hash is stored, so the token itself
// can't be recovered from the gallery. A user can only delete works they saved
// in the same browser (the raw token lives in that browser's localStorage).
//
// NOTE: the RLS `anon_select` policy must be column-restricted so the public
// read path never exposes `delete_token_hash` (see Supabase-Schema.md). With a
// strong CSPRNG token the hash is unbrute-forceable, but the hash must not be
// queryable by the browser's anon key either.
import crypto from 'node:crypto';
import sharp from 'sharp';
import { MAX_INPUT_PIXELS } from './lib/constants.js';
import { validateGalleryGif } from './lib/galleryGif.js';
import { createGalleryThumbnailService, encodeGalleryThumbnail, galleryThumbnailPath } from './lib/galleryThumbnails.js';

const MAX_GALLERY_IMAGE_BYTES = 10 * 1024 * 1024;
const DELETE_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const BUCKET = 'gallery-images';

export class GalleryStorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GalleryStorageError';
  }
}

let client;

function getClient() {
  if (client) return client;
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    throw new GalleryStorageError('画廊存储尚未配置 Supabase 服务端凭据（SUPABASE_SERVICE_ROLE_KEY）');
  }
  return import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return client;
  });
}

async function db() {
  return client || await getClient();
}

function ensureOk(result, message) {
  if (result.error) throw new GalleryStorageError(`${message}: ${result.error.message}`);
  return result.data;
}

function str(value, maxLen) {
  return typeof value === 'string' ? value.slice(0, maxLen) : '';
}

/** Pull the storage object path out of a public storage URL. */
function storagePathFromPublicUrl(publicUrl) {
  try {
    const url = new URL(publicUrl);
    const prefix = `/storage/v1/object/public/${BUCKET}/`;
    return url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : null;
  } catch {
    return null;
  }
}

export async function saveGalleryItem({ imageBase64, style, characterName, prompt, provider, deleteToken }, storageClient) {
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    throw new GalleryStorageError('缺少图片数据');
  }
  const buffer = Buffer.from(imageBase64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_GALLERY_IMAGE_BYTES) {
    throw new GalleryStorageError('图片数据无效或超过 10MB');
  }
  if (!DELETE_TOKEN_RE.test(deleteToken || '')) {
    throw new GalleryStorageError('删除凭证无效');
  }
  // Detect the actual image format. Static images are re-encoded to WebP. GIFs
  // receive complete structural and decoder validation before their animation
  // bytes are preserved, including rejection of trailing polyglot payloads.
  let uploadBuffer;
  let format = 'webp';
  try {
    const meta = await sharp(buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!meta.format || !meta.width || !meta.height || !['png', 'jpeg', 'jpg', 'webp', 'gif'].includes(meta.format)) {
      throw new Error('unsupported');
    }
    if (meta.format === 'gif') {
      await validateGalleryGif(buffer, meta);
      uploadBuffer = buffer;
      format = 'gif';
    } else {
      uploadBuffer = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).webp({ quality: 90 }).toBuffer();
    }
  } catch {
    throw new GalleryStorageError('图片数据无效（支持 PNG/JPEG/WebP/GIF，GIF 最多 64 帧且总解码像素不超过 6400 万）');
  }

  const thumbnail = await encodeGalleryThumbnail(uploadBuffer);
  const supabase = storageClient || await db();
  const path = `gallery/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-full.${format}`;
  const thumbnailPath = galleryThumbnailPath(path);
  const storage = supabase.storage.from(BUCKET);
  let row;
  try {
    for (const [objectPath, bytes, contentType] of [[path, uploadBuffer, `image/${format}`], [thumbnailPath, thumbnail, 'image/webp']]) {
      const { error } = await storage.upload(objectPath, bytes, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw new GalleryStorageError(`画廊图片上传失败: ${error.message}`);
    }

    const { data: publicData } = storage.getPublicUrl(path);
    const { data: savedRow, error: insertError } = await supabase
      .from('gallery')
      .insert({
        image_url: publicData.publicUrl,
        style: str(style, 100),
        character_name: str(characterName, 100),
        prompt: str(prompt, 2000),
        provider: str(provider, 50),
        delete_token_hash: crypto.createHash('sha256').update(deleteToken).digest('hex'),
      })
      .select('id, image_url, style, character_name, prompt, provider, created_at')
      .single();
    if (insertError) throw new GalleryStorageError(`画廊记录保存失败: ${insertError.message}`);
    row = savedRow;
  } catch (error) {
    // Roll back both objects, including rejected network promises and DB errors.
    await storage.remove([path, thumbnailPath]).catch(() => {});
    throw error;
  }
  galleryThumbnails.prime(row, thumbnail);
  return ensureOk({ data: row }, '画廊记录保存失败');
}

/**
 * Read gallery rows, newest first. Both the web client and the mini program
 * read through this proxy — browsers in some regions can't reach *.supabase.co
 * reliably, and mini program request domains can't whitelist it at all.
 */
export async function listGallery(limit = 20, offset = 0) {
  const supabase = await db();
  const result = await supabase
    .from('gallery')
    .select('id, image_url, style, character_name, prompt, provider, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  const rows = ensureOk(result, '查询画廊失败');
  galleryThumbnails.remember(rows);
  return rows;
}

/** Public metadata only; the layer service validates the id and eligible source style. */
export async function getGalleryImage(id) {
  const supabase = await db();
  return ensureOk(await supabase.from('gallery').select('image_url, style').eq('id', id).maybeSingle(), '查询画廊作品失败');
}

export async function deleteGalleryItem({ id, deleteToken }, storageClient) {
  // Accept both integer and UUID ids (the table may use either).
  const validId = Number.isInteger(id)
    ? id > 0
    : typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id.trim());
  if (!validId) {
    throw new GalleryStorageError('无效的画廊记录');
  }
  const idValue = Number.isInteger(id) ? id : id.trim();
  if (!DELETE_TOKEN_RE.test(deleteToken || '')) {
    throw new GalleryStorageError('删除凭证无效');
  }
  const supabase = storageClient || await db();
  const rowResult = await supabase
    .from('gallery')
    .select('id, image_url, delete_token_hash')
    .eq('id', idValue)
    .maybeSingle();
  const row = ensureOk(rowResult, '查询画廊记录失败');
  if (!row) return { ok: false, reason: 'not_found' };

  const expected = crypto.createHash('sha256').update(deleteToken).digest('hex');
  if (row.delete_token_hash !== expected) return { ok: false, reason: 'forbidden' };

  const objectPath = storagePathFromPublicUrl(row.image_url);
  if (objectPath) {
    await supabase.storage.from(BUCKET).remove([objectPath, galleryThumbnailPath(objectPath)].filter(Boolean)).catch((e) => {
      console.warn(`[gallery] storage remove failed: ${e?.message}`);
    });
  }
  const deleteResult = await supabase.from('gallery').delete().eq('id', idValue);
  if (deleteResult.error) throw new GalleryStorageError(`画廊记录删除失败: ${deleteResult.error.message}`);
  galleryThumbnails.invalidate(idValue);
  return { ok: true };
}

export const galleryThumbnails = createGalleryThumbnailService({ lookupImage: getGalleryImage });
