# 支付宝 AI 付网站赞助接入设计

日期：2026-07-30

## Context

影画工坊是 React 18 + Vite 5 前端与 Express 4 + Node 后端的单页应用。当前没有支付、订单或账号系统；现有服务端 AI 预设和生图能力保持无限免费。目标是通过支付宝 AI 付 Skill 接入一个不改变生图权限的赞助入口，同时支持 PC 与手机浏览器。

已确认范围：

- 支付宝网站支付统一使用 `alipay.trade.page.pay`，PC 与手机浏览器共用接口。
- 赞助金额由用户自定义，服务端限制为 ¥0.01–¥100,000，并按整数分精确校验。
- 使用访客令牌绑定订单，不新增注册登录。
- 赞助成功只展示感谢和订单状态，不增加或扣减生图额度，也不改变 `useServerPreset`。
- UI 采用设置区卡片布局，颜色复用 `--zzz-primary` 等现有自适应主题变量。

## Architecture

### Payment adapter

新增 `server/payments/alipay.js`，通过当前项目实际安装并核验过的 `alipay-sdk` 暴露以下边界：

- `pageExec('alipay.trade.page.pay', 'POST', ...)` 生成支付 HTML 表单。
- `exec` 封装交易查询、退款、退款查询与关闭交易。
- 通知验签封装使用目标 SDK 实际存在的 `checkNotifySignV2` 或等效 API；不凭记忆猜方法名。
- 支付配置只从服务端环境读取，私钥不进入前端、源码或日志。
- `notify_url` 仅在配置为真实公网 HTTPS 地址时发送；本地缺少地址时省略，但仍保留通知处理代码并用查询兜底。

### Order service

新增 `server/payments/orderService.js`，负责：

- 规范化并校验金额。
- 生成本地订单号和随机访客令牌。
- 使用 Supabase service role 保存与查询订单。
- 通过通知事件唯一约束和单向状态转换实现幂等。
- 绑定并验证访客令牌哈希，避免只凭订单号越权查询。
- 在通知缺失或状态未知时调用支付宝交易查询。

### Express routes

在 `server/index.js` 注册：

- `POST /api/payments/orders`：接受金额和客户端幂等键，创建 pending 订单并返回支付 HTML。
- `GET /api/payments/orders/:orderNo`：校验访客令牌并返回订单摘要；状态不确定时查询支付宝。
- `POST /api/payments/alipay/notify`：用 urlencoded 表单接收回调，验签、校验 app/卖家/订单/金额/状态，幂等更新并返回纯文本 `success` 或 `fail`。
- `GET /api/payments/alipay/return`：同步回跳结果页入口；不信任回跳参数，不直接改订单状态。

支付路由必须在 SPA fallback 之前注册。异步通知不能走 JSON parser，也不能重定向。

### Persistence

在 `Supabase-Schema.md` 补充服务端专用 SQL：

- `sponsor_orders`：本地订单号、金额分、状态、令牌哈希、支付宝交易号、创建/更新/支付时间。
- `payment_notify_events`：`notify_id`、支付宝交易号、本地订单号、交易状态和处理时间，并对通知事件建立唯一约束。

支付表不开放匿名客户端写入；现有 gallery 的匿名策略保持不变。若缺少后端 Supabase service role 配置，支付接口应明确返回未配置错误而不是使用内存订单。

## Frontend

新增 `src/lib/paymentClient.ts` 与 `src/components/PaymentPanel.tsx`，并在 `src/App.tsx` Provider 配置区域挂载。

交互流程：

1. 输入金额并显示范围提示。
2. 调用创建订单接口，使用 `credentials: 'include'`。
3. 将服务端返回的 HTML 表单放入临时容器并自动提交；禁止把 HTML 当 URL 跳转。
4. 支付宝回跳后查询本地订单状态，不读取 URL 的 `trade_status` 作为成功依据。
5. `pending` 短时轮询并允许手动刷新；`paid` 显示感谢；`closed`/`refunded` 显示未完成。
6. 只在内存或页面状态中保留订单号，不保存支付凭据或敏感字段。

视觉：

- 使用现有卡片结构、间距、圆角和交互样式。
- 边框、强调色、按钮和状态提示使用 `var(--zzz-primary)`、`var(--zzz-magenta)`、`var(--zzz-text)` 与 `color-mix()`。
- 无立绘主题时沿用 CSS 默认主题；主题变化由现有 palette 流程自动传导。
- 桌面端横向排列输入与按钮，窄屏堆叠。

## Security and failure handling

- 浏览器不能提交可信价格、标题、商户号、支付宝交易号或支付状态。
- 回调验签失败、关键字段不匹配或订单不存在时返回 `fail`，不改变订单。
- 只接受 `TRADE_SUCCESS`/`TRADE_FINISHED` 且排除退款、关单、分账事件作为已支付。
- 重复通知返回 `success`，但不重复更新订单。
- 查询超时保留 pending，不引导重复付款。
- 日志脱敏，不记录私钥、签名和完整回调。
- 生产上线前必须使用公网 HTTPS `notify_url` 并完成支付宝服务器可访问联调；本地验收只能标记公网通知待验证。

## Verification

- 检查安装器 diff、Skill 产物、依赖和密钥泄露风险。
- `npm run lint`、`npm run build`。
- 启动 `npm run dev`，验证健康检查、创建订单、金额上下限、幂等、订单归属和回跳路由。
- 测试错误签名、错误 app/seller、金额篡改、未知订单、重复通知和通知早于回跳。
- 检查支付 HTML 是 POST 表单自动提交。
- 验证赞助成功不影响现有免费生图逻辑。
- 有支付宝沙箱与公网地址后，再分别进行 PC/H5 付款体验及异步通知联调；无这些条件时明确保留人工待验证项。

## Out of scope

- 登录、注册与跨设备订单恢复。
- 按量计费、会员订阅、生图额度和权限改造。
- 前端退款、关单管理界面。
- 对账单下载和其他支付宝产品。
