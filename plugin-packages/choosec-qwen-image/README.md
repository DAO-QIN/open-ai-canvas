# ChooseC 千问 2.1 图片

独立 `yingce.plugin/v2` 声明式协议插件，适配 ChooseC 的 `qwen-image-2.1-turbo` 文生图与参考图请求，默认 2K。使用宿主已有插件安装、参数、鉴权、中转、媒体下载和保存流程。

文生图依据为 [ChooseC 模型广场](https://api.choosec.cn/pricing) 的 image-generation。参考图按 [千问官方兼容接口](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference) 的 JSON `image` 字段适配，ChooseC 兼容性由使用者实测；默认不开放 4K。完整合同见 [docs/interface.md](docs/interface.md)。
