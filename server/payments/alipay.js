import { AlipaySdk } from 'alipay-sdk';

const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PRODUCTION_GATEWAY = 'https://openapi.alipay.com/gateway.do';

export class AlipayConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AlipayConfigError';
  }
}

function readConfig() {
  const appId = (process.env.ALIPAY_APP_ID || '').trim();
  const privateKey = process.env.ALIPAY_PRIVATE_KEY || '';
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY || '';
  const gateway = (process.env.ALIPAY_GATEWAY || SANDBOX_GATEWAY).trim();

  if (!appId || !privateKey || !alipayPublicKey) {
    throw new AlipayConfigError('支付宝支付尚未配置 App ID、应用私钥或支付宝公钥');
  }
  if (!process.env.ALIPAY_SELLER_ID?.trim() && !process.env.ALIPAY_SELLER_EMAIL?.trim()) {
    throw new AlipayConfigError('支付宝支付尚未配置卖家 ID 或卖家邮箱');
  }
  if (gateway !== SANDBOX_GATEWAY && gateway !== PRODUCTION_GATEWAY) {
    throw new AlipayConfigError('支付宝网关配置无效');
  }

  return {
    appId,
    privateKey,
    alipayPublicKey,
    gateway,
    sellerId: (process.env.ALIPAY_SELLER_ID || '').trim(),
    sellerEmail: (process.env.ALIPAY_SELLER_EMAIL || '').trim(),
  };
}

function createSdk(config = readConfig()) {
  return new AlipaySdk({
    appId: config.appId,
    privateKey: config.privateKey,
    alipayPublicKey: config.alipayPublicKey,
    gateway: config.gateway,
    signType: 'RSA2',
    keyType: 'PKCS1',
  });
}

export function getPaymentIdentity() {
  const config = readConfig();
  return {
    appId: config.appId,
    sellerId: config.sellerId,
    sellerEmail: config.sellerEmail,
  };
}

export function createPagePayment({ orderNo, amount, returnUrl, notifyUrl }) {
  const config = readConfig();
  const request = {
    returnUrl,
    bizContent: {
      outTradeNo: orderNo,
      totalAmount: amount,
      subject: '影画工坊赞助',
      productCode: 'FAST_INSTANT_TRADE_PAY',
    },
  };
  if (notifyUrl) request.notifyUrl = notifyUrl;
  return createSdk(config).pageExec('alipay.trade.page.pay', 'POST', request);
}

function responseData(result) {
  return result?.data?.alipayTradeQueryResponse
    || result?.data?.alipayTradeRefundResponse
    || result?.data?.alipayTradeFastpayRefundQueryResponse
    || result?.data?.alipayTradeCloseResponse
    || result?.data
    || {};
}

export async function queryTrade(orderNo) {
  const result = await createSdk().exec('alipay.trade.query', {
    bizContent: { outTradeNo: orderNo },
  });
  const data = responseData(result);
  return {
    code: data.code,
    status: data.tradeStatus || null,
    tradeNo: data.tradeNo || null,
    appId: data.appId || null,
    sellerId: data.sellerId || null,
    sellerEmail: data.sellerEmail || null,
    totalAmount: data.totalAmount || null,
  };
}

export async function refundTrade({ orderNo, tradeNo, amount, requestNo }) {
  const result = await createSdk().exec('alipay.trade.refund', {
    bizContent: {
      ...(tradeNo ? { tradeNo } : { outTradeNo: orderNo }),
      refundAmount: amount,
      outRequestNo: requestNo,
    },
  });
  return responseData(result);
}

export async function queryRefund({ orderNo, tradeNo, requestNo }) {
  const result = await createSdk().exec('alipay.trade.fastpay.refund.query', {
    bizContent: {
      ...(tradeNo ? { tradeNo } : { outTradeNo: orderNo }),
      outRequestNo: requestNo,
    },
  });
  return responseData(result);
}

export async function closeTrade({ orderNo, tradeNo }) {
  const result = await createSdk().exec('alipay.trade.close', {
    bizContent: tradeNo ? { tradeNo } : { outTradeNo: orderNo },
  });
  return responseData(result);
}

export function verifyNotify(params) {
  return createSdk().checkNotifySignV2(params);
}

export function isPaidTrade(params) {
  return (params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED')
    && !params.out_biz_no
    && !params.gmt_refund
    && !params.refund_fee;
}

export function sellerMatches(params, identity = getPaymentIdentity()) {
  return Boolean(
    (identity.sellerId && params.seller_id === identity.sellerId)
      || (identity.sellerEmail && params.seller_email === identity.sellerEmail),
  );
}

export function amountText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return `${BigInt(match[1]).toString()}.${(match[2] || '').padEnd(2, '0')}`;
}

export function formatAmountCents(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function formatAlipayTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function getConfiguredNotifyUrl() {
  return (process.env.ALIPAY_NOTIFY_URL || '').trim();
}

export function getConfiguredReturnUrl() {
  return (process.env.ALIPAY_RETURN_URL || '').trim();
}
