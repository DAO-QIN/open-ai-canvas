# ChooseC 千问 2.1 图片

独立 `yingce.plugin/v2` 声明式协议插件，适配 ChooseC 的 `qwen-image-2.1-turbo` 文生图与参考图请求，默认 1K。使用宿主已有插件安装、参数、鉴权、中转、媒体下载和保存流程。

文生图依据为 [ChooseC 模型广场](https://api.choosec.cn/pricing) 的 image-generation。该中转站明确要求参考图使用 `/v1/images/edits`，由宿主通过 multipart `image[]` 上传文件，与千问官方托管 API 的 JSON `image` 入口分别适配。默认不开放 4K。完整合同见 [docs/interface.md](docs/interface.md)。
