# 本地图片降噪：选型与实现

核实日期：2026-11-04。下列链接均为官方 GitHub 仓库；这是源码和许可证审阅，不是本项目对这些模型的实测排名。未下载权重、未调用外部推理服务、未复制第三方算法源码。

| 方案 | 可以借鉴的内容 | 当前浏览器落地成本与适用性 | 已核实许可证 |
| --- | --- | --- | --- |
| [OpenCV 双边滤波](https://github.com/opencv/opencv/blob/5.x/modules/imgproc/src/bilateral_filter.dispatch.cpp) | 空间距离和颜色距离联合加权，在平滑时减少跨边缘污染；用查找表减少指数计算 | 不需要模型。直接打包 OpenCV.js 有额外 WASM 体积；完整二维邻域扫描成本随半径平方增长。本站独立实现固定半径的两遍一维近似，成本更可控，结果不等价于 OpenCV | 仓库 [Apache-2.0](https://github.com/opencv/opencv/blob/5.x/LICENSE)；此具体源文件仍含 BSD 风格三条款 notice，不能因仓库总许可证而忽略 |
| [OpenCV 非局部均值](https://github.com/opencv/opencv/blob/5.x/modules/photo/src/denoising.cpp) | 使用相似图块，而非仅比较邻接单像素，适合重复结构及颗粒噪声 | 不需要模型，但搜索窗与图块距离计算增加算力/内存成本；后续可考虑 WASM 加速，未在本次接入 | 同上，具体源文件也含 Intel/BSD 风格 notice |
| [Restormer](https://github.com/swz30/Restormer) | 专门的真实噪声和高斯噪声训练任务、面向高分辨率的 Transformer 恢复结构 | 官方路径为 Python/PyTorch 与单独下载的预训练权重。浏览器需另做 ONNX/WebGPU 转换、算子兼容、分块及接缝验证，还要承担模型下载与激活内存；没有现成验证可直接承诺质量/速度 | [MIT](https://github.com/swz30/Restormer/blob/main/LICENSE.md)，后续还需核查所选权重、依赖和数据条款 |
| [NAFNet](https://github.com/megvii-research/NAFNet/blob/main/readme.md) | 结构简单的卷积恢复网络，官方有 SIDD 真实图像降噪任务；是后续神经网络方案的优先候选之一 | 官方 Python/PyTorch，width32/64 等不同检查点，均需权重。仍需验证 WebGPU 转换、动态尺寸、内存与插画领域效果。官方 SIDD 指标不能当本站插画实测 | [MIT，且 LICENSE 内包含 BasicSR 的 Apache-2.0](https://github.com/megvii-research/NAFNet/blob/main/LICENSE) |
| [Intel Open Image Denoise](https://github.com/RenderKit/oidn) | 面向渲染的神经降噪，以及用 albedo/normal 辅助缓冲保护细节 | 官方 C/C++ CPU/GPU 原生库及预训练滤镜，主要目标为光线追踪 Monte Carlo 噪声；浏览器移植和一般 JPEG/插画输入都不是此仓库直接提供的即插即用路径。无需把它的渲染成绩泛化成摄影/插画优势 | [Apache-2.0](https://github.com/RenderKit/oidn/blob/master/LICENSE.txt) |

没有下载检查点，因此不写未经核实的模型文件 MB 数。网络结构、精度、量化和导出格式都会影响大小；权重大小也不能代表峰值显存。

## 本次实现

`src/lib/localDenoise.ts` 是独立编写的可分离双边滤波近似：先横向后纵向，每遍用亮度 Y 及色度 Co/Cg 的联合范围权重，避免等亮度颜色边缘被合并；亮度和色度使用不同平滑混合比例，让轻度/标准档较多保留明暗细节。空间、范围及透明度权重均预计算为小查找表。透明像素不参与邻域，alpha 差异也影响权重；输出 alpha 逐像素保持。

- 固定两遍，半径分别为 2/3/4，时间为 O(N × r)，缓冲区为 O(N)，无需模型或新增依赖。
- 上传 PNG/JPEG/WebP，复用现有 10 MB 校验；解码后限制 400 万像素及单边 8192，不静默缩图。
- 解码、像素滤波和 PNG 编码都在独立 Web Worker 内；取消/换图/卸载终止 worker，过时结果不能覆盖新图。每次都从保留的原图计算。
- 保持解码后的尺寸和 alpha。Canvas 是 8 位浏览器解码结果，可能转换色彩空间、清空透明像素隐藏 RGB；导出静态 PNG 不保存 EXIF/ICC/动画。这不是原文件逐字节保真。
- 实际峰值还包含浏览器解码缓存、Canvas、PNG 编码和图片预览。400 万像素上限在解码后检查，不能作为畸形压缩文件在解码阶段绝不会分配大内存的保证。

## 质量和性能边界

它适合轻到中度颗粒和彩色杂点，不能代替学习式恢复，也不可靠修复失焦、运动模糊、严重 JPEG 方块或坏点。两遍近似有方向性，不旋转等变；高强度会抹掉细纹、笔触和刻意颗粒。未实测真实用户插画或低端手机延迟，不能承诺具体秒数或优于上述模型。

`tests/frontend/localDenoise.test.js` 使用确定性合成数据检查平坦区域噪声 MSE 降低、阶跃边缘对比度、等亮度色彩边缘、alpha/透明邻域、常量图与单像素、输入不变、尺寸限制与进度。测试中同时对比 5×5 均值模糊的全图误差；这只能证明测试噪声/图案条件下的行为，不能推导所有真实图像质量。

组件导出 `LocalDenoisePanel`，自身导入专用 CSS，无必需 props；在路由切换时卸载它可以立即终止任务和释放 URL。它与现有生成提示词型 `DenoiseToggle` 独立。
