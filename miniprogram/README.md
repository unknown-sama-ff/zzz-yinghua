# 影画工坊 · 微信小程序

原生微信小程序版（TypeScript + WXML/WXSS），与 Web 前端（`src/`）完全隔离。核心流程：**上传立绘 → 三视图/影画生成 → 查看/保存 → 微信支付赞助**。

后端复用本仓库 Express 服务（`server/index.js`），新增了微信支付模块与小程序的专用端点。**小程序代码不会改动任何 Web 代码路径。**

---

## 1. 目录结构

```
miniprogram/
├── project.config.json   # 小程序项目配置（appid 占位，需替换）
├── app.json              # 页面 / tabBar / 相册权限 / 网络超时
├── app.ts / app.wxss     # 入口 + 全局暗色主题
├── tsconfig.json         # 独立 tsconfig，不影响根目录 lint
├── types.d.ts            # wx/App/Page 最小声明（无需 npm 安装类型包）
├── utils/
│   ├── constants.ts      # API_BASE、轮询参数、金额范围、存储 key
│   ├── request.ts        # wx.request Promise 封装 + x-openid 注入 + 任务轮询
│   ├── upload.ts         # wx.uploadFile 封装
│   ├── image.ts          # 选图/压缩/读写本地文件
│   ├── idempotency.ts    # 幂等键 / 画廊删除凭证
│   ├── store.ts          # 页面间共享状态单例
│   ├── api.ts            # 业务 API（generate/composite/gallery/payments/auth）
│   └── prompts.ts        # 从 src/lib/prompts.ts 整文件移植（提示词模板）
└── pages/
    ├── index/     (tab)  # 工作台：上传立绘 + 角色名 + 模型
    ├── generate/         # 三视图 + 影画三风格（链式生成）
    ├── result/           # 大图查看 + 保存相册/画廊 + 去赞助
    ├── sponsor/          # 微信支付赞助
    ├── orders/   (tab)   # 我的订单
    └── gallery/  (tab)   # 社区画廊（经后端代理读取）
```

---

## 2. 一图流：依赖关系

```
小程序 (miniprogram/)  ──HTTPS──▶  你的 ICP 备案域名 (api.zzz-yinghua.cn)
                                        │  Nginx 反代
                                        ▼
                              Railway 后端 (server/index.js)
                                        │
        ┌───────────────┬───────────────┼────────────────┐
        ▼               ▼               ▼                ▼
    /api/generate   /api/composite   /api/payments    /api/gallery
    (multipart+      (sharp 拼图/    (wechat 微信支付)  (Supabase 代理)
     asyncMode)       嵌缩略图)        /api/proxy-image
```

关键点：小程序 `wx.request` 的合法域名必须是**开发者本人 ICP 备案的 HTTPS 域名**，因此 `*.up.railway.app`、`*.supabase.co` 都不能直接出现在小程序里——所有请求与图片都收口到你的备案域名，再反代到后端。

---

## 3. 开发期快速跑通（无需备案域名）

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 打开项目：开发者工具 →「导入项目」→ 目录选本仓库的 `miniprogram/`。
3. 若还没有小程序 AppID，可先选「测试号」，或在 `project.config.json` 把 `appid` 改为你的 AppID（默认为 `touristappid` 游客模式）。
4. **关键**：右上角「详情」→「本地设置」→ 勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**。这样开发期即可请求 Railway 后端（`miniprogram/utils/constants.ts` 里的 `API_BASE`）。
5. 编译后从「工作台」页走通：选图 → 生成三视图 → 三风格 → 查看/保存。

> 后端需先部署到 Railway 并配置好环境变量（见 §5）。本地起后端也行，但 `API_BASE` 得改成你的本地地址且 DevTools 需能访问。

---

## 4. 正式发布：备案域名（硬性前提）

小程序生产环境的 `request` / `uploadFile` / `downloadFile` 合法域名必须：

- **HTTPS**
- **ICP 备案**（中国大陆）
- 归属于小程序主体（企业/个体户认证主体）

当前后端在 `*.up.railway.app` 上，**无法备案**。因此需要：

1. 注册一个域名（如 `api.zzz-yinghua.cn`），在国内云服务商（阿里云/腾讯云）完成 ICP 备案（通常 2–4 周）。
2. 用 Nginx 反代到 Railway 后端（`proxy_pass https://zzz-yinghua-production.up.railway.app`），示例：

```nginx
server {
  listen 443 ssl http2;
  server_name api.zzz-yinghua.cn;

  ssl_certificate     /etc/nginx/certs/api.zzz-yinghua.cn.pem;
  ssl_certificate_key /etc/nginx/certs/api.zzz-yinghua.cn.key;

  location /api/ {
    proxy_pass https://zzz-yinghua-production.up.railway.app;
    proxy_http_version 1.1;
    proxy_set_header Host zzz-yinghua-production.up.railway.app;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20m;                 # 支持 10MB+ 图片上传
    proxy_read_timeout 360s;                  # 匹配 UPSTREAM_TIMEOUT_MS(300s)
  }
}
```

3. 把 `miniprogram/utils/constants.ts` 的 `API_BASE` 改为 `https://api.zzz-yinghua.cn/api`。
4. 微信公众平台 →「开发管理」→「开发设置」→「服务器域名」，把 `https://api.zzz-yinghua.cn` 加入 **request / uploadFile / downloadFile** 合法域名。
5. 微信支付回调 `WECHAT_NOTIFY_URL` 指向 `https://api.zzz-yinghua.cn/api/payments/wechat/notify`。

---

## 5. 后端配置

### 5.1 环境变量（在 Railway 后端新增）

小程序端不暴露 API Key，所有生成走 `useServerPreset`——因此后端需配好 AI 提供方密钥：`SEEDREAM_API_KEY` / `SEEDREAM_BASE_URL`、`OPENAI_API_KEY` / `OPENAI_BASE_URL`（见根 `.env.example`）。这些调用会消耗服务端预设免费额度（`PRESET_DAILY_CAP`，默认 200 次/日）。

除现有 Web 变量外，追加微信支付相关（见 `.env.example`）：

| 键 | 说明 |
|----|------|
| `WECHAT_APPID` | 小程序 AppID |
| `WECHAT_APP_SECRET` | 小程序密钥（AppSecret） |
| `WECHAT_MCHID` | 微信支付商户号 |
| `WECHAT_API_V3_KEY` | 商户平台设置的 APIv3 密钥（32 字节） |
| `WECHAT_MERCHANT_SERIAL_NO` | 商户 API 证书序列号 |
| `WECHAT_MERCHANT_PRIVATE_KEY` | 商户 APIv3 私钥（PKCS8 PEM；因 `.env` 按行解析，需存成单行 `\n` 转义或 base64） |
| `WECHAT_PLATFORM_PUBLIC_KEY` | 微信支付平台公钥（推荐平台公钥模式，免证书轮换） |
| `WECHAT_PLATFORM_PUBLIC_KEY_SERIAL` | （可选）平台公钥序列号，用于校验回调头 |
| `WECHAT_NOTIFY_URL` | 公网 HTTPS 回调，指向备案域名 |

### 5.2 Supabase 迁移

在 Supabase SQL Editor 执行 `Supabase-Schema.md` 中的 **「WeChat Pay channel migration」** SQL（给 `sponsor_orders` 加 `channel`/`openid_hash` 列，给 `payment_notify_events` 加 `channel` 列）。纯加列、可回滚，不影响既有支付宝订单。

---

## 6. 微信支付商户资质（第二个硬性前提）

- **个人主体不能开通微信支付**。需要：
  - 企业 / 个体户主体认证的小程序；
  - 在微信支付商户平台申请商户号；
  - 将小程序 AppID 与商户号完成绑定（商户平台 → 产品中心 → AppID 账号管理）。
- 开通 JSAPI 支付（`JSAPI` / `小程序支付`）产品。

### 6.1 支付流程（已实现）

```
sponsor 页 → wx.login 拿 code
           → POST /api/auth/wechat-login        (后端 code2session 换 openid)
           → POST /api/payments/wechat/orders   (建单 + 微信 JSAPI 下单 → 返回 paySign)
           → wx.requestPayment                  (拉起微信支付收银台)
           → 成功后轮询 GET /api/payments/orders/:orderNo 直到 paid
微信侧同时 POST /api/payments/wechat/notify    (验签 + 解密 + 幂等入账)
```

支付宝 Web 支付完全不受影响（`channel` 区分渠道）。

---

## 7. 真机联调

1. 开发者工具预览 → 手机扫码。
2. 真机打开「开发调试」（右上角 `…` → 开发调试），可绕过域名校验。
3. **`wx.requestPayment` 在模拟器无法真实支付**，必须真机走 0.01 元真实单验证：
   - 检查 `WECHAT_NOTIFY_URL` 能被微信回调（备案域名 / 开发期可用隧道）。
   - 支付成功后回小程序，订单页应显示「已支付」；后端日志应有 `[payments/wechat/notify]` 成功记录。
4. 相册保存：首次点击会弹授权，拒绝后二次点击会引导去设置页开启。

---

## 8. 提交审核注意事项

- 服务类目需与「AI 生图 + 图片社区」匹配，按平台要求补充资质/说明。
- **内容合规**：六命「阴」版涉及露肤内容有被驳回风险，当前小程序版本**默认只使用安全的正面提示词**（`prompts.ts` 中样式 3 的 `promptTemplate`，不包含服装精简指令）。画廊为公开社区内容，运营上需有内容清理手段（`gallery` 表已支持按删除凭证删除）。
- 确保 `scope.writePhotosAlbum` 授权文案明确。
- 涉及 AI 生成内容，按平台要求在产品说明中标注。

---

## 9. 验收清单

- [ ] DevTools 编译通过、tabBar 三个 tab 可切换
- [ ] `miniprogram/utils/constants.ts` 的 `API_BASE` 指向可达后端
- [ ] 工作台选图 → 生成页三视图 → 三风格链式生成 → 结果页保存相册/画廊
- [ ] 画廊页经代理加载缩略图
- [ ] 真机 0.01 元微信支付成功、订单页显示已支付、后端回调入账
- [ ] Web 端回归：支付宝赞助、生成、画廊直连全部照旧
