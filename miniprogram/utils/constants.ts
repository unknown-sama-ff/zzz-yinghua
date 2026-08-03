// 小程序 API 基址。生产环境必须指向你的 ICP 备案域名（如 https://api.zzz-yinghua.cn）。
// 开发期可在微信开发者工具勾选「不校验合法域名」后指向任意 HTTPS 后端。
export const API_BASE = 'https://zzz-yinghua-production.up.railway.app/api';

// 生成任务轮询（对齐 Web 端 src/lib/constants.ts）
export const POLL_INTERVAL_MS = 3000;
export const POLL_DEADLINE_MS = 180000;

// 上传上限
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// 赞助金额范围（元字符串）
export const MIN_AMOUNT = '0.01';
export const MAX_AMOUNT = '100000';

// 画廊一次读取条数
export const GALLERY_LIMIT = 20;

// 本地存储 key
export const STORAGE_OPENID = 'yinghua_openid';
export const STORAGE_SESSION_TOKEN = 'yinghua_session_token';
export const STORAGE_GALLERY_DELETE_TOKEN = 'yinghua_gallery_delete_token';

// 服务端预设免费额度模式：小程序不暴露 API Key 输入，统一走 useServerPreset。
export const USE_SERVER_PRESET = true;
