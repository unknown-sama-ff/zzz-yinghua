# 影画工坊 · YINGHUA WORKSHOP

绝区零（ZZZ）风格的角色影画生成与查看 Web 应用。上传一张角色正面立绘，调用 AI 生图 API 补全三视图与特写、生成三种「影画」风格动作图，并在完全还原游戏内「影画」界面的查看器中通过 6 个按钮自由显隐「三图层共六部分」，切换时带程序化特效。UI 配色会根据上传图片动态取色。

## 许可证

除下述第三方内容与非代码素材外，本项目的代码、配置及原创文档采用 [GNU Affero General Public License v3.0](LICENSE)，仅限第 3 版（SPDX：`AGPL-3.0-only`）。版权及第三方来源说明见 [NOTICE](NOTICE)。

AGPL-3.0 允许商业使用。分发受许可覆盖的程序或衍生版本时，应按许可证提供对应源码及相关声明；修改本程序后通过网络提供服务时，须向与该版本远程交互的用户提供免费获取该版本对应源码的机会。具体权利与义务以 [LICENSE](LICENSE) 全文为准。

- **第三方代码、依赖和模型**分别遵循各自许可证，不因本项目的许可声明而重新授权。已收录的许可包括 [Anime Segmentation](docs/licenses/anime-segmentation.txt)、[Depth Anything V2 Small](docs/licenses/depth-anything-v2-small.txt)、[image-to-prompt](docs/licenses/image-to-prompt.txt) 和 [gpt-anime-denoise](docs/licenses/gpt-anime-denoise.txt)；其他依赖的许可证随各依赖分发。
- **图片、视频、音频、字体、角色立绘、风格参考素材及品牌标识等非代码素材**不包含在本项目的 AGPL-3.0 授权范围内，除非该素材另有明确的许可声明。相关权利归相应权利人所有，使用时需遵守其许可或取得所需授权。
- **用户上传内容与模型生成内容**不因本项目代码采用 AGPL-3.0 而自动获得同一许可；其使用受相关权利及服务条款约束。

## 功能

- **展厅首页与独立工作区**：首页展示本地风格示例；角色工坊分为角色素材、影画创作、海报创作，画廊和提示词有独立入口。自由创作仍支持多会话与原位重试，切换页面保留本次访问中的草稿、参考图和进行中任务。
- **图片上传**：拖拽 / 点击，本地预览，类型与大小校验（PNG/JPEG/WEBP，≤10MB）。
- **生成精细度**：在「设置 → 接口与模型」选择全局 GPT 图片精细度；默认自动。GPT Image 2.5 / 2.6 系列（含 Sunburst、Flare）支持自动、低、中、高、超高、最高，旧模型及未知模型显示前四档。影画、三视图、海报、自由创作和图片编辑共用；刷新恢复自动。作者免费通道根据服务器实际模型提供档位，读取失败时仍可使用服务器默认生成。
- **三 Provider**：`seedream`、`gpt-image`、`custom-url`（自定义端点 + 鉴权头），统一经后端代理调用。
- **三视图 + 特写**（可开关）：内置 prompt 模板，可微调。
- **影画三风格**：重墨黑白 / 半赛璐珞 / 全彩高饱和，背景嵌入角色英文名。
- **GIF 动画生成**：在「自由创作 → 输出类型」选择 GIF 动画，使用 GPT Image 2.6 系列模型。支持文字生成，也可上传静态参考图或复用当前主图，输入图合计最多 16 张，带图时通过 `/v1/images/edits` 生成动画。提示词写明主体、动作与循环方式；总帧数 2～16（默认 9）、每帧 20～2000 毫秒（默认 200，按 10 毫秒取整），显示单轮时长。每次生成 1 部，尺寸自动；关闭流式输出，思考复杂度沿用接口默认 high。结果可播放、下载原 GIF 或保存到画廊。保存时尝试最长边 1024px 等比缩小及动态 WebP 无损编码，保留动画、帧时长和循环，并选用较小文件，列表使用静态首帧缩略图。画廊保留既有 10 MB 上传限制，GIF 最多 64 帧、总解码像素不超过 6400 万；超限可先下载原文件。实际账号和第三方中转须支持 GIF 及带图编辑输出。[官方指南](https://developers.openai.com/api/docs/guides/image-generation#generate-animated-gif-output)
- **影画查看器**：左侧 6 按钮（01–06）分两组 STAGE，自由组合显隐；切换带扫描线 / 故障 / 辉光特效（CSS 程序化复刻，非视频叠加）。当前合成画面可保存为 PNG，或一键保存到画廊；普通与全屏模式均可使用，保存保留当前图层、动态裁切与实际显示的六命阴阳面，沿用画廊 WebP 压缩且不消耗生图额度。
- **动态配色**：上传后客户端 median-cut 取色，首页与工作区共用 CSS 变量，约 300ms 平滑过渡；灰度或取色失败回退默认 ZZZ 紫/品红主题。界面强调色与按钮文字独立校验对比度；旧取色任务不能覆盖新上传的角色。系统减少动态效果时直接切换。

## 页面与设置

- **看图反推**（`#/image-to-prompt`）：主导航位于「美图拼图」之后。上传 PNG/JPEG/WebP（≤10 MB），选择通用、Midjourney、SDXL 或 FLUX，用视觉模型生成中文、英文、可编辑版本及复刻建议；适用时另给负面提示词，各版本可单独复制或全部复制。复用「设置 → 接口与模型 → 视觉模型」的 API Key、Base URL 和模型；开启作者免费通道时使用服务端 `VISION_API_KEY`、`VISION_BASE_URL`、`VISION_MODEL` 并沿用额度限制。图片仅在点击反推后发送给所选模型，不保存到公共画廊。输出是可见画面的重建，不能恢复原始提示词、seed 或保证完全复刻。
- **图片降噪**（`#/denoise`）：独立的本地像素处理工具，三档亮度/色度联合双边滤波近似，支持原图与结果比较、100% 查看、取消和 PNG 下载；不调用模型、不消耗生图额度。限制 400 万像素、单边 8192、文件≤10 MB，不自动缩图；保留解码后的尺寸与 alpha。适合轻中度颗粒和彩色杂点，较强档可能柔化纹理，无法可靠修复严重压缩块和模糊。它与生成流程中的「降噪」提示词开关独立。[研究来源与边界](docs/local-denoise-research.md)。

`POST /api/image-to-prompt` 接受 multipart 字段 `image`、`target`、`focus`，以及视觉模型配置或 `useServerPreset=true`，返回 `{ ok, result, image }`。服务端校验真实图片解码、限制像素、缩放至最长边 1536、移除元数据，并通过现有 SSRF 与完整响应体超时保护访问模型。技能方法来源与 MIT 许可见 [image-to-prompt](docs/licenses/image-to-prompt.txt)。

新增离线浏览器验收：`node tests/browser/image-tools-smoke.mjs`，需要本地 Playwright 与可用 Chromium；可用 `BROWSER_EXECUTABLE` 指定浏览器。反推响应使用模拟数据，降噪与 PNG 导出执行真实 Worker，无付费模型调用。

- `#/`：作品展厅首页，示例点击放大。
- `#/workshop/assets`、`#/workshop/yinghua`、`#/workshop/poster`：角色素材、影画、海报工作区。
- `#/gallery`、`#/prompts`：公共画廊、提示词画廊。旧 `#prompt-gallery` 链接自动进入提示词页面。
- 右上角「设置」集中接口、模型、精细度、作者免费通道及特效偏好；角色英文名在角色素材区填写。
- 页脚「支持工坊」提供赞助二维码和名单。Bilibili、抖音与 GitHub 作者链接保留在页脚。

实现与验收记录见 [展厅首页重设计](docs/superpowers/specs/2026-10-26-exhibition-home-design.md)。

## 技术栈

前端 React 18 + Vite 7 + TypeScript 5（严格模式）+ Tailwind 3 + Zustand。
后端使用轻量 Express 代理；运行环境要求 Node 20.19+（20.x）或 ≥22.12，服务端预设密钥存于环境变量。

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

- `POST /api/generate` — body `{ provider, prompt, imageBase64?, size?, quality?, n?, customEndpoint?, customHeaders?, customBodyTemplate? }`
- `GET /api/image-capabilities` — 返回 `{ ok: true, presetQualityOptions: [...] }`，只公开服务器预设可用精细度，不包含模型、密钥或接口地址。
- `quality` 可选：`auto | low | medium | high | xhigh | max`，以实际模型能力校验；未提供时不向上游添加此参数。它与图片尺寸、参考图压缩及局部重绘范围无关。白嫖模式仍沿用 `GPT_IMAGE_MODEL`（默认 `gpt-image-2`）和现有额度规则，更高精细度可能增加耗时与费用。
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

- 画廊列表通过 `GET /api/gallery/:id/thumbnail` 读取最长边 640px 的 WebP，放大查看保存后的完整图片。静态作品成对保存 `-full.webp` 和 `-thumb.webp`。动画尝试最长边 1024px 等比缩小，并以无损动态 WebP 编码，帧数、帧时长及循环一致且文件更小时保存为 `-animated-full.webp`，其他情况采用原动画。动画也配套保存静态首帧缩略图，保存失败时回滚两份对象，删除时一起清理。旧作品按需生成缩略图，列表读取结果会预热元数据以减少重复查询。服务端最多并发两项缩略图任务，缓存限制为 16 MiB / 256 项、有效期一小时。浏览器回归见 `tests/browser/gallery-thumbnails-smoke.mjs`（存储读写均使用模拟服务）。

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
