# 沧元 Seedream 5.0 Pro

独立 `yingce.plugin/v2` 声明式图片协议。仅适配 `doubao-seedream-5-0-pro`，不复用方舟 `/api/v3` 或可美模型别名。

选择协议后，能力与参数默认配置为 1:1、单张生成、最多 10 张参考图、JPEG 输出、URL 响应；关闭分辨率档、质量档、透明背景和蒙版。支持八种推荐比例和自定义像素尺寸。Pro 文档未声明 1K/2K/4K 档，插件不发送这些字段。

文生图和参考图编辑分别创建、轮询；使用宿主渠道鉴权、HTTPS 出站校验、参考素材 URL 转换及结果持久化。异步仅提交一次，不自动换模型重试。Flash 不属于此 Provider。

接口见 [docs/interface.md](docs/interface.md)。运行 `python3 build.py` 可重建 manifest、完整文档和插件包。
