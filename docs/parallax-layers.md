# 拼图三层视差

抽出图片时立即预热分层请求，拼好后复用结果。展示提供原画 2D、悬浮相片、三层视差三种模式。服务器输出补全背景、主体和透明近景三个独立图片，前端分别移动。分层失败时展示原图并允许重试。

## 模型与资源

- 模型：[Anime Segmentation](https://github.com/skytnt/anime-segmentation)，通过 rembg 发布的 `isnet-anime.onnx`。上游项目使用 Apache-2.0 许可证；见 `docs/licenses/anime-segmentation.txt`。
- 固定下载地址：`https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx`。
- 大小 176,069,933 字节；SHA-256：`f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99`。下载后及首次使用预置文件时校验，拒绝未知模型。
- 相对深度模型采用 Depth Anything V2 Small 的 ONNX Community UINT8 量化转换。上游 Small 模型和转换仓库均标注 Apache-2.0，许可证与来源见 `docs/licenses/depth-anything-v2-small.txt`。[上游模型说明](https://github.com/DepthAnything/Depth-Anything-V2#license) [转换仓库模型卡](https://huggingface.co/onnx-community/depth-anything-v2-small/blob/4472b7362082ad9968fee890ca0f1e5aca36b93d/README.md)
- 深度模型固定下载地址为 `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx`，大小 27,258,801 字节，SHA-256 为 `fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d`。`PUZZLE_DEPTH_MODEL_PATH` 可指定同一模型的预置文件，仍需通过大小和哈希校验。两个模型均在启动推理子进程前准备完成。下载失败清理临时文件，后续请求可重试。
- ONNX Runtime CPU 执行，不需要 GPU。`.npmrc` 关闭不需要的 CUDA 二进制下载。也可在安装环境设置 `ONNXRUNTIME_NODE_INSTALL=skip`。
- 首次缓存未命中会下载模型，需要服务器访问 GitHub。可用 `PUZZLE_LAYER_MODEL_PATH` 指向同一模型的已下载文件，避免冷启动下载。
- 推理预处理采用模型作者的等比缩放、居中黑色填充和 RGB/255，推理后先裁掉填充再还原遮罩尺寸。旧实现使用 rembg 的方形拉伸、最大像素归一化和均值减法，与 rembg 源码一致。此次切换为模型作者的流程，避免宽图或竖图形变，同时保留输入亮度。[模型作者推理代码](https://github.com/SkyTNT/anime-segmentation/blob/main/inference.py) [rembg 模型会话](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/dis_anime.py) [rembg 预处理](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/base.py)
- 深度预处理依据固定版本的 DPT 配置，使用 RGB/255、ImageNet 均值与标准差、双三次等比缩放、14 倍数尺寸和 518 参考边。额外限制最长边 1022，约束超宽与超长图片的 CPU 和内存开销。输出按图内最小值和最大值归一化为 8 位相对逆深度，数值越大表示越靠近镜头，无法表示实际距离。显著性模型释放会话后才加载深度模型，深度会话释放后才生成图层。[固定预处理配置](https://huggingface.co/onnx-community/depth-anything-v2-small/blob/4472b7362082ad9968fee890ca0f1e5aca36b93d/preprocessor_config.json) [DPT 尺寸处理](https://github.com/huggingface/transformers/blob/v4.44.2/src/transformers/models/dpt/image_processing_dpt.py) [上游深度可视化](https://github.com/DepthAnything/Depth-Anything-V2/blob/main/run.py)
- 2026-11-05 本机海报和自由版样例的独立 Node 进程分别实测约 8.24 秒和 8.75 秒，峰值约 941 MiB。硬件和图片会影响耗时。运行时至少检查 1150 MiB 可用内存，建议服务器留出 1.5–2 GiB 总资源。Node 需要提供 `process.availableMemory()`。
- 2026-11-05 本机对用户提供的界面截图裁切区域运行两个模型，深度单独推理约 7.4 秒、峰值 537 MiB，包含最终三层提取与补洞的完整子进程约 17 秒、峰值 942 MiB。正常服务入口含校验及缓存写入约 18 秒。测试材料为截图内 `x=45,y=28,width=980,height=555` 的画面，画面带透视及界面覆盖，原始作品仍需另行验证。
- 同时只运行一个推理进程，最多接收 3 个不同图片任务；同图合并请求。进程最多运行 60 秒，完成或失败后退出并释放模型内存。

## 缓存与接口

- 默认缓存目录 `.cache/parallax/`，不进入 Git；模型单独保留，结果最多 64 张或 96 MiB。缓存随部署文件系统存在，不承诺跨部署持久。
- `POST /api/puzzle-layers` 只接受 `galleryId`。只处理画廊中自由创作、动作底稿、海报版的公开图片，不接受任意 URL 或模型文件。
- 返回 `key/width/height/hasForeground`。三个图片位于 `/api/puzzle-layers/{key}/background.webp`、`subject.webp` 和 `foreground.webp`，保持相同画布尺寸及像素位置。访问仅允许这三个派生资产。
- 每个访问身份每分钟最多 4 次准备请求；图片请求不占推理额度。远程图片沿用 SSRF 检查与 10 MiB 下载上限，解码上限 2400 万像素，生成图层最长边 1024。
- 抽取图片时即预热，完成后的展示复用同一个请求。浏览器不下载或运行模型。

## 画面限制与验证

遮罩清理保留主连通区域和有高置信像素支撑的细节，去掉极小孤立噪点。近景结合相对深度与颜色边界提取，以人物中上部的深度作为参照，选择下部明显更近、具有一定面积的区域。接触或遮挡人物的手套、道具也可进入近景层。对深度变化不连续但颜色边界明确的小型道具，扩展到完整轮廓并保留内部高光，避免戒指盒只分出下半部分。

没有识别到明显近景时，`hasForeground` 为 `false`，`foreground.webp` 为透明画布。深度图缺乏足够差异时保留透明近景。接口始终提供三个资产，实际可移动内容由图像本身决定。相对深度与颜色规则可能误分相近颜色的衣物或漏掉画面上部的遮挡物，无法提供逐物体语义分割保证。

背景与前景遮住的主角区域采用邻近像素传播和扩散修补，用于小幅视差暴露的边缘。主角层会先移除近景道具，减少移动时留下副本的双影。被大面积遮挡的纹理、文字和场景无法完整还原。主体和近景使用去背景颜色补偿的柔边透明度，三层采用无损 WebP，静止对齐时保留原始像素。用户截图验证分出了戒指盒及近处手套，脸部留在主体层，对齐复合最大单通道误差为 1/255。半透明披风和发丝仍可能出现细小孔洞或边缘残色，用户可切回原画。

当前缓存版本为 `anime-three-layer-relative-depth-v3`。服务发布前检查三张图及尺寸元数据完整性，旧版本结果会重新生成。修改分层算法时需要更新 `service.js` 的 `VERSION`。

`node --test server/parallax/parallax.test.js tests/frontend/puzzle.test.js` 验证等比输入、深度尺寸与归一化、相连近景分离、道具轮廓完整、遮挡修补、静止复合、模型失败重试、缓存、串行和接口边界。

现有浏览器检查支持 `PUZZLE_REAL_LAYERS=1`，配合 `PUZZLE_LAYER_MODEL_PATH` 与 `PUZZLE_DEPTH_MODEL_PATH` 使用真实模型和服务管线；不设置时使用测试图层。测试会覆盖分层成功、原图回退和显式重试。`PLAYWRIGHT_MODULE` 可指定现有 Playwright 安装，`PUZZLE_START_VITE=1` 可在测试进程内启动开发服务。
