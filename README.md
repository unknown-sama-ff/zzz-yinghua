# 影画工坊 · YINGHUA WORKSHOP

绝区零（ZZZ）风格的角色影画生成与查看 Web 应用。上传一张角色正面立绘，调用 AI 生图 API 补全三视图与特写、生成三种「影画」风格动作图，并在完全还原游戏内「影画」界面的查看器中通过 6 个按钮自由显隐「三图层共六部分」，切换时带程序化特效。UI 配色会根据上传图片动态取色。

## 功能

- **图片上传**：拖拽 / 点击，本地预览，类型与大小校验（PNG/JPEG/WEBP，≤10MB）。
- **三 Provider**：`seedance`、`gpt-image`、`custom-url`（自定义端点 + 鉴权头），统一经后端代理调用。
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
| `SEEDANCE_API_KEY` / `SEEDANCE_BASE_URL` | seedance 图编辑端点 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | gpt-image（gpt-image-1）端点 |
| `UPSTREAM_TIMEOUT_MS` | 上游超时，默认 60000 |

> `.env` 已在 `.gitignore` 中，密钥不入库、不下发前端。

## API 契约

- `POST /api/generate` — body `{ provider, prompt, imageBase64?, size?, n?, customEndpoint?, customHeaders?, customBodyTemplate? }`
- 响应：`{ ok: true, images: string[] }` 或 `{ ok: false, code, message }`
- 错误码：`INVALID_INPUT` `UNAUTHORIZED` `UPSTREAM_TIMEOUT` `UPSTREAM_ERROR` `RATE_LIMITED` `SSRF_BLOCKED`
- 代理特性：错误归一化、60s 超时、最多 2 次指数退避重试、seedance 长任务轮询。

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
