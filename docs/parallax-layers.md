# 拼图主体分层

拼好后默认进入主体分层：服务器生成透明前景和补全背景，前端使用两个独立图片做差速位移。原画 2D、悬浮相片、透镜模式继续保留。分层失败时展示原图并允许重试。

## 模型与资源

- 模型：[Anime Segmentation](https://github.com/skytnt/anime-segmentation)，通过 rembg 发布的 `isnet-anime.onnx`。上游项目使用 Apache-2.0 许可证；见 `docs/licenses/anime-segmentation.txt`。
- 固定下载地址：`https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx`。
- 大小 176,069,933 字节；SHA-256：`f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99`。下载后及首次使用预置文件时校验，拒绝未知模型。
- ONNX Runtime CPU 执行，不需要 GPU。`.npmrc` 关闭不需要的 CUDA 二进制下载。也可在安装环境设置 `ONNXRUNTIME_NODE_INSTALL=skip`。
- 首次缓存未命中会下载模型，需要服务器访问 GitHub。可用 `PUZZLE_LAYER_MODEL_PATH` 指向同一模型的已下载文件，避免冷启动下载。
- 本机海报样例的独立 Node 进程实测约 4 秒、峰值约 943 MiB。硬件和图片会影响耗时；运行时至少检查 1150 MiB 可用内存，建议服务器留出 1.5–2 GiB 总资源。Node 需要提供 `process.availableMemory()`。
- 同时只运行一个推理进程，最多接收 3 个不同图片任务；同图合并请求。进程最多运行 60 秒，完成或失败后退出并释放模型内存。

## 缓存与接口

- 默认缓存目录 `.cache/parallax/`，不进入 Git；模型单独保留，结果最多 64 张或 96 MiB。缓存随部署文件系统存在，不承诺跨部署持久。
- `POST /api/puzzle-layers` 只接受 `galleryId`。只处理画廊中自由创作、动作底稿、海报版的公开图片，不接受任意 URL 或模型文件。
- 返回 `key/width/height`。两个图片位于 `/api/puzzle-layers/{key}/foreground.webp` 和 `background.webp`；不开放源文件、元数据或模型下载。
- 每个访问身份每分钟最多 4 次准备请求；图片请求不占推理额度。远程图片沿用 SSRF 检查与 10 MiB 下载上限，解码上限 2400 万像素，生成图层最长边 1024。
- 第一次拼接成功时预热，完成后的展示复用同一个请求。浏览器不下载或运行模型。

## 画面限制与验证

背景补全采用邻近背景传播和扩散，用于小幅视差暴露的边缘，不是生成式重绘。大字、半透明特效、复杂发丝和多主体仍可能分错；这类图片可切回原画。修改分层算法时需要更新 `service.js` 的 `VERSION`，避免复用旧结果。

`node --test server/parallax/parallax.test.js tests/frontend/puzzle.test.js` 验证遮罩、背景移除、缓存、串行和接口边界。

现有浏览器检查支持 `PUZZLE_REAL_LAYERS=1`，配合 `PUZZLE_LAYER_MODEL_PATH` 使用真实模型和服务管线；不设置时使用测试图层。测试会覆盖分层成功、原图回退和显式重试。`PLAYWRIGHT_MODULE` 可指定现有 Playwright 安装，`PUZZLE_START_VITE=1` 可在测试进程内启动开发服务。
