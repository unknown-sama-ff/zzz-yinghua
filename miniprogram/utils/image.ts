export interface PickedImage {
  path: string; // local temp file path
  width?: number;
  height?: number;
  size?: number; // bytes
}

/** Choose a single image (album or camera) and compress it. */
export function chooseImage(): Promise<PickedImage> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res: any) => {
        const file = res.tempFiles?.[0];
        if (!file) {
          reject(new Error('未选择图片'));
          return;
        }
        compressImage(file.tempFilePath).then(
          (path) => resolve({ path, size: file.size, width: file.width, height: file.height }),
          reject,
        );
      },
      fail: () => reject(new Error('取消选择图片')),
    });
  });
}

/** Compress an image to JPEG to keep uploads small; falls back to original. */
function compressImage(src: string): Promise<string> {
  return new Promise((resolve) => {
    wx.compressImage({
      src,
      quality: 70,
      success: (res: any) => resolve(res.tempFilePath || src),
      fail: () => resolve(src),
    });
  });
}

/** Read a local file as base64 string (no data: prefix). */
export function fileToBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res: any) => resolve(String(res.data)),
      fail: () => reject(new Error('读取文件失败')),
    });
  });
}

/** Write a base64 string to a cache file under USER_DATA_PATH/cache/. */
export function writeBase64File(base64: string, ext = 'png'): Promise<string> {
  const filePath = cacheFilePath(ext);
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data: base64,
      encoding: 'base64',
      success: () => resolve(filePath),
      fail: () => reject(new Error('写入图片失败')),
    });
  });
}

/** A unique cache file path; ensures the cache dir exists. */
export function cacheFilePath(ext = 'png'): string {
  const dir = `${wx.env.USER_DATA_PATH}/cache`;
  const fs = wx.getFileSystemManager();
  try {
    fs.accessSync(dir);
  } catch {
    fs.mkdirSync(dir, true);
  }
  return `${dir}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
}
