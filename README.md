# 影画工坊 · YINGHUA WORKSHOP

绝区零（ZZZ）风格的角色影画生成与查看 Web 应用。上传一张角色正面立绘，调用 AI 生图 API 补全三视图与特写、生成三种「影画」风格动作图，并在完全还原游戏内「影画」界面的查看器中通过 6 个按钮自由显隐「三图层共六部分」，切换时带程序化特效。UI 配色会根据上传图片动态取色。

## 功能

- **图片上传**：拖拽 / 点击，本地预览，类型与大小校验（PNG/JPEG/WEBP，≤10MB）。
- **三 Provider**：`seedream`、`gpt-image`、`custom-url`（自定义端点 + 鉴权头），统一经后端代理调用。
- **三视图 + 特写**（可开关）：内置 prompt 模板，可微调。
- **影画三风格**：重墨黑白 / 半赛璐珞 / 全彩高饱和，背景嵌入角色英文名。
- **影画查看器**：左侧 6 按钮（01–06）分两组 STAGE，自由组合显隐；切换带扫描线 / 故障 / 辉光特效（CSS 程序化复刻，非视频叠加）。
- **动态配色**：上传后客户端 median-cut 取色，写入 CSS 变量，约 300ms 平滑过渡；取色失败回退默认 ZZZ 紫/品红主题。

## 技术栈

前端 React 18 + Vite 5 + TypeScript 5（严格模式）+ Tailwind 3 + Zustand。
后端 Node ≥18 轻量 Express 代理，密钥仅存服务端环境变量，前端永不接触明文密钥。

## 本地启动

```bash
npm install
cp .env.example .env   # 填入真实密钥
npm run dev            # 同时启动 Vite(5173) 与 Node 代理(8787)
```

打开 http://localhost:5173 。前端 `/api/*` 请求经 Vite 代理转发到本地 8787。

### 仅前端 / 仅后端

```bash
npm run dev:server     # 仅 Node 代理
npx vite               # 仅前端
```

## 构建与生产运行

```bash
npm run build          # tsc 类型检查 + vite 打包到 dist/
npm start              # Node 代理同时托管 dist/ 静态资源
```

生产模式下 `server/index.js` 检测到 `dist/` 存在即提供静态文件，单进程即可运行。

## 环境变量（`.env`）

| 键 | 说明 |
|----|------|
| `PORT` | 代理端口，默认 8787 |
| `CORS_ORIGIN` | 允许的前端源，默认 `http://localhost:5173` |
| `SEEDREAM_API_KEY` / `SEEDREAM_BASE_URL` | seedream 图编辑端点 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | gpt-image（gpt-image-1）端点 |
| `UPSTREAM_TIMEOUT_MS` | 上游超时，默认 60000 |

> `.env` 已在 `.gitignore` 中，密钥不入库、不下发前端。

## API 契约

- `POST /api/generate` — body `{ provider, prompt, imageBase64?, size?, n?, customEndpoint?, customHeaders?, customBodyTemplate? }`
- 响应：`{ ok: true, images: string[] }` 或 `{ ok: false, code, message }`
- 错误码：`INVALID_INPUT` `UNAUTHORIZED` `UPSTREAM_TIMEOUT` `UPSTREAM_ERROR` `RATE_LIMITED` `SSRF_BLOCKED`
- 代理特性：错误归一化、120s 超时（超时不重试）、瞬时错误最多 2 次指数退避重试、seedream 长任务轮询、上游非 JSON 响应容错。

## 角色保真（让生图严格参考上传立绘）

- **gpt-image**：有上传图时走 `/images/edits`（multipart 上传图片文件），使立绘真正作为图生图条件；无图时回退 `/images/generations` 纯文生图。需所用模型支持图像编辑。
- **seedream / custom-url**：以 base64 随请求体发送图片（`image` 字段 / `{image}` 占位）。
- **提示词保真前缀**：三种影画风格与三视图提示词均强约束「保留上传角色的面部、发型发色、服装与配色，确保同一角色」，在 UI 文本框可见且可微调（见 `src/lib/prompts.ts` 的 `FIDELITY_PREFIX`）。

## 部署到 Vercel

本项目为「前端静态 + Node 服务」组合。两种方式：

1. **单服务部署（推荐用于 Render/Railway/Fly 等）**：`npm run build` 后用 `npm start` 跑 Express，它同时托管 `dist/` 与 `/api`。
2. **Vercel**：将 `server/` 的处理逻辑改写为 `api/generate.js` serverless function（核心逻辑在 `server/providers.js`、`server/http.js`，可直接复用），前端按静态站点部署。环境变量在 Vercel 项目设置中配置，键名同上。

## 安全

- 密钥仅服务端读取，前端只调用 `/api/*`。
- 上传类型/大小前后端双重白名单校验。
- `custom-url` 出站请求对 `localhost`/`127.*`/`169.254.*`/内网段做基础 SSRF 拦截。
- 请求体上限 15MB，CORS 限定本应用源。

## 自定义 Provider 字段

不同上游返回结构不一。`server/providers.js` 的 `pluckImages()` 已兼容 `{data:[{url|b64_json}]}`、`{images:[...]}`、`{output}` 等常见结构。若你的端点字段不同，调整该函数即可。

## 可访问性 / 性能

- 按钮 Tab 聚焦 + Enter 触发，含 ARIA 标签。
- 图片懒加载，结果区骨架屏占位。
- 切换特效 `prefers-reduced-motion` 降级为简单淡入淡出。

## 微信小程序（`miniprogram/`）

本项目另有一个**原生微信小程序**版本（上传 → 三视图/影画生成 → 查看保存 → 微信支付赞助），代码在 [miniprogram/](miniprogram/)，与 Web 前端（`src/`）完全隔离、互不影响。

- **后端**：复用本 Express 服务的全部 `/api/*`，并新增微信支付模块（`server/payments/wechat.js`）、小程序专用端点（`/api/generate` multipart+asyncMode、`/api/task/:id/images/:index`、`/api/composite`、`/api/gallery`、`/api/proxy-image`）。
- **数据库**：`sponsor_orders` 表新增 `channel`/`openid_hash` 列以并存支付宝与微信支付，迁移 SQL 见 [Supabase-Schema.md](Supabase-Schema.md)。
- **环境变量**：微信支付相关 `WECHAT_*` 见 [.env.example](.env.example)。
- **开发与发布指南**：见 [miniprogram/README.md](miniprogram/README.md)（开发者工具导入、备案域名反代、微信支付商户资质、真机联调等）。

> 硬性前提：小程序 `wx.request` 的合法域名必须 **HTTPS + ICP 备案**，且需**企业/个体户主体**才能开通微信支付商户号（个人主体不可）。无备案域名只能靠开发者工具「不校验合法域名」自测。

## 04 连续编辑回写与 05 PNG 导出（Web）

- 在 04 成图的「继续修改」，或左下角「编辑图片」中选择成图，生成编辑版本后点击 **替换 04 原图**。只更新该命格的对应图片；六命阳/阴独立，不自动重新生成，不再次调用生图接口。04 与 05 共用图片状态，替换后立即同步。
- 原模块仍在生成或已经有更新结果时，旧编辑会话不能覆盖它；当前编辑版本与历史仍保留。原图本身已应用时按钮禁用，也可选旧版本重新回写。
- 在 05 自由开关图层后点击 **保存当前 PNG**。保存的是当前可见图层的合成画面，按零命底图的原始分辨率输出，不带网页按钮/边框。全屏也可保存。透明区域使用当前画板背景，多图比例不同则按查看器同样的 contain 规则居中合成。
- 图片未加载完成或加载失败时保存按钮禁用；远程图片跨域失败时复用现有 `/api/proxy-image`，不新增生图请求。
- 提示词采用共享身份/参考规则与独立风格段，零命镜头/动作/裁切要求保留；六命只增加原透视下的腿部连接、关节归属与遮挡校验，不改成另一镜头或姿势。字数缩短不代表模型效果已有统计证明，真实生成还需同条件抽样比较。

### 回归验证

`npm run lint` 同时检查生产源码和本地浏览器回归页；`npm test` 运行后端与前端回归测试；`npm run build` 更新生产产物。

本地开发服务启动后可访问 `/tests/browser/yinghua.html`，使用无费用的合成样图验证编辑回写、图层混合和 PNG。该回归页不打入生产构建。
