# Image Tools

影策图片工具协议插件，提供去背景和图层拆分两个异步能力。

## 能力

- `image-tools-remove-background`：`bria/remove-background`
- `image-tools-layer-decomposition`：`bytedance/seedream-v5.0-pro/layer-decomposition`

两个 provider 都接受统一的 `images[]` 源图输入，结果 URL 会由宿主下载并持久化。

图层拆分固定请求 PNG，避免 JPEG 丢失透明通道。画布按完整分辨率验收多张同尺寸图片，允许一张不透明底图，其余必须有真实透明通道。透明层保留接口返回顺序，可在画布中调整顺序与可见性；接口未声明语义名称和偏移时，不自动推断物体名称或裁切坐标。
