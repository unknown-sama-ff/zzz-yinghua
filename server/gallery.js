// ── Gallery write API (server-mediated) ──────────────────────────────────────
//
// The gallery table used to allow anonymous INSERT/DELETE via the anon key,
// which let any visitor wipe the whole gallery and spam rows. Writes now go
// through this server using the service-role key, so the anon key is read-only.
//
// Ownership is enforced with a client-generated delete token: the raw token is
// sent on save/delete but only its SHA-256 hash is stored, so the anon-read
// gallery can't leak deletable tokens. A user can only delete works they saved
// in the same browser (the raw token lives in that browser's localStorage).
import crypto from 'node:crypto';

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

export async function saveGalleryItem({ imageBase64, mime, style, characterName, prompt, provider, deleteToken }) {
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
  const safeMime = /^image\/(png|jpe?g|webp)$/i.test(mime || '') ? mime : 'image/webp';
  const ext = safeMime === 'image/jpeg' || safeMime === 'image/jpg' ? 'jpg' : safeMime === 'image/png' ? 'png' : 'webp';

  const supabase = await db();
  const path = `gallery/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: safeMime,
      cacheControl: 'public, max-age=31536000, immutable',
      upsert: false,
    });
  if (uploadError) throw new GalleryStorageError(`画廊图片上传失败: ${uploadError.message}`);

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const { data: row, error: insertError } = await supabase
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
  if (insertError) {
    // Roll back the orphaned storage object.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new GalleryStorageError(`画廊记录保存失败: ${insertError.message}`);
  }
  return ensureOk({ data: row }, '画廊记录保存失败');
}

/** Read recent gallery rows, newest first. The mini program reads through this proxy. */
export async function listGallery(limit = 20) {
  const supabase = await db();
  const result = await supabase
    .from('gallery')
    .select('id, image_url, style, character_name, prompt, provider, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return ensureOk(result, '查询画廊失败');
}

export async function deleteGalleryItem({ id, deleteToken }) {
  if (!Number.isInteger(id) || id <= 0) {
    throw new GalleryStorageError('无效的画廊记录');
  }
  if (!DELETE_TOKEN_RE.test(deleteToken || '')) {
    throw new GalleryStorageError('删除凭证无效');
  }
  const supabase = await db();
  const rowResult = await supabase
    .from('gallery')
    .select('id, image_url, delete_token_hash')
    .eq('id', id)
    .maybeSingle();
  const row = ensureOk(rowResult, '查询画廊记录失败');
  if (!row) return { ok: false, reason: 'not_found' };

  const expected = crypto.createHash('sha256').update(deleteToken).digest('hex');
  if (row.delete_token_hash !== expected) return { ok: false, reason: 'forbidden' };

  const objectPath = storagePathFromPublicUrl(row.image_url);
  if (objectPath) {
    await supabase.storage.from(BUCKET).remove([objectPath]).catch((e) => {
      console.warn(`[gallery] storage remove failed: ${e?.message}`);
    });
  }
  const deleteResult = await supabase.from('gallery').delete().eq('id', id);
  if (deleteResult.error) throw new GalleryStorageError(`画廊记录删除失败: ${deleteResult.error.message}`);
  return { ok: true };
}
