import crypto from 'node:crypto';

const WECHAT_API_BASE = 'https://api.mch.weixin.qq.com';
const WECHAT_SESSION_API = 'https://api.weixin.qq.com/sns/jscode2session';

export class WechatConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WechatConfigError';
  }
}

/**
 * Normalize a PEM key value read from an env var. The project's .env parser is
 * line-based, so multi-line PEMs must be stored either as single-line `\n`
 * escapes or as base64. Decode both back to a real PEM here.
 */
function normalizePem(value) {
  let text = String(value || '').replace(/\\n/g, '\n').trim();
  if (text.includes('-----BEGIN')) return text;
  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) return decoded.trim();
  } catch {
    // not base64 — fall through
  }
  return text;
}

function readConfig() {
  const appId = (process.env.WECHAT_APPID || '').trim();
  const appSecret = (process.env.WECHAT_APP_SECRET || '').trim();
  const mchid = (process.env.WECHAT_MCHID || '').trim();
  const apiV3Key = (process.env.WECHAT_API_V3_KEY || '').trim();
  const merchantSerialNo = (process.env.WECHAT_MERCHANT_SERIAL_NO || '').trim();
  const merchantPrivateKey = normalizePem(process.env.WECHAT_MERCHANT_PRIVATE_KEY);
  const platformPublicKey = normalizePem(process.env.WECHAT_PLATFORM_PUBLIC_KEY);
  const platformPublicKeySerial = (process.env.WECHAT_PLATFORM_PUBLIC_KEY_SERIAL || '').trim();
  const notifyUrl = (process.env.WECHAT_NOTIFY_URL || '').trim();

  if (!appId || !appSecret || !mchid || !apiV3Key || !merchantSerialNo || !merchantPrivateKey || !platformPublicKey) {
    throw new WechatConfigError('微信支付尚未配置 AppID、小程序密钥、商户号、APIv3 密钥或商户/平台公钥');
  }

  return {
    appId,
    appSecret,
    mchid,
    apiV3Key,
    merchantSerialNo,
    merchantPrivateKey,
    platformPublicKey,
    platformPublicKeySerial,
    notifyUrl,
  };
}

function sign(message, privateKey) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  return signer.sign(privateKey, 'base64');
}

function buildAuthHeader(method, path, body, config) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = sign(message, config.merchantPrivateKey);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.merchantSerialNo}"`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function apiRequest(method, path, bodyObj, config = readConfig()) {
  const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  const url = `${WECHAT_API_BASE}${path}`;
  const response = await fetchWithTimeout(url, {
    method,
    headers: {
      Authorization: buildAuthHeader(method, path, body, config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body || undefined,
  }, 15000);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON error body — surface raw text below
  }
  if (!response.ok) {
    const error = new Error(`微信支付 API 返回 ${response.status}: ${data.message || text.slice(0, 200)}`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

/** Exchange a wx.login() code for the user's openid (secret never leaves the server). */
export async function code2Session(code) {
  const config = readConfig();
  const url = `${WECHAT_SESSION_API}?appid=${encodeURIComponent(config.appId)}`
    + `&secret=${encodeURIComponent(config.appSecret)}`
    + `&js_code=${encodeURIComponent(code)}`
    + '&grant_type=authorization_code';
  const response = await fetchWithTimeout(url, { method: 'GET' }, 15000);
  const data = await response.json();
  if (!data.openid) {
    const error = new Error(`微信登录失败: ${data.errmsg || data.errcode || 'unknown'}`);
    error.code = data.errcode;
    throw error;
  }
  return {
    openid: data.openid,
    sessionKey: data.session_key || null,
    unionid: data.unionid || null,
  };
}

/** Create a JSAPI (mini program) payment order and return the prepay_id. */
export async function createJsapiOrder({ orderNo, amountCents, openid }) {
  const config = readConfig();
  if (!config.notifyUrl) throw new WechatConfigError('微信支付尚未配置回调地址 WECHAT_NOTIFY_URL');
  const data = await apiRequest('POST', '/v3/pay/transactions/jsapi', {
    appid: config.appId,
    mchid: config.mchid,
    description: '影画工坊赞助',
    out_trade_no: orderNo,
    notify_url: config.notifyUrl,
    amount: { total: amountCents, currency: 'CNY' },
    payer: { openid },
  }, config);
  if (!data.prepay_id) throw new WechatConfigError('微信支付下单失败：未返回 prepay_id');
  return data.prepay_id;
}

/** Build the params passed directly to wx.requestPayment(). */
export function buildPaymentParams({ orderNo, prepayId }) {
  const config = readConfig();
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageValue = `prepay_id=${prepayId}`;
  const message = `${config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign: sign(message, config.merchantPrivateKey),
  };
}

/** Verify the WeChat Pay notify signature, then decrypt the resource → plaintext event. */
export function verifyAndDecryptNotify(headers, rawBody) {
  const config = readConfig();
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  const serial = headers['wechatpay-serial'];
  if (!timestamp || !nonce || !signature || !serial) {
    throw new WechatConfigError('微信支付回调缺少签名头');
  }
  if (config.platformPublicKeySerial && serial !== config.platformPublicKeySerial) {
    throw new WechatConfigError('微信支付回调公钥序列号不匹配');
  }
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(message);
  verifier.end();
  if (!verifier.verify(config.platformPublicKey, signature, 'base64')) {
    throw new WechatConfigError('微信支付回调验签失败');
  }
  const body = JSON.parse(rawBody);
  const resource = body.resource;
  if (!resource) throw new WechatConfigError('微信支付回调缺少 resource');
  const plaintext = decryptResource(resource, config.apiV3Key);
  return JSON.parse(plaintext);
}

function decryptResource(resource, apiV3Key) {
  const { ciphertext, nonce, associated_data: associatedData } = resource;
  const data = Buffer.from(ciphertext, 'base64');
  const key = Buffer.from(apiV3Key, 'utf8');
  const authTag = data.subarray(data.length - 16);
  const payload = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(associatedData || '', 'utf8'));
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
}

/** Query an order's current state from WeChat Pay. */
export async function queryOrder(orderNo) {
  const config = readConfig();
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(config.mchid)}`;
  return apiRequest('GET', path, undefined, config);
}

// ── Maintenance helpers (mirror alipay.js paymentMaintenance) ───────────────

export async function refundTrade({ orderNo, transactionId, amountCents, requestNo }) {
  const config = readConfig();
  const data = await apiRequest('POST', '/v3/refund/domestic/refunds', {
    out_trade_no: orderNo,
    out_refund_no: requestNo,
    ...(transactionId ? { transaction_id: transactionId } : {}),
    amount: { refund: amountCents, total: amountCents, currency: 'CNY' },
  }, config);
  return data;
}

export async function queryRefund(requestNo) {
  const path = `/v3/refund/domestic/refunds/${encodeURIComponent(requestNo)}`;
  return apiRequest('GET', path, undefined);
}

export function getConfiguredNotifyUrl() {
  return (process.env.WECHAT_NOTIFY_URL || '').trim();
}
