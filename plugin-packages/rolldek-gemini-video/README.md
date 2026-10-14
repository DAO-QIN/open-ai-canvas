# RollDek Gemini Omni 与 Veo Fast 视频

独立 `yingce.plugin/v2` 声明式插件，无可执行插件代码。API Key 使用渠道原有 Bearer 配置，由宿主负责出站安全、任务恢复、下载与持久化。

| 协议 | 精确模型 | 默认配置 |
| --- | --- | --- |
| rolldek-gemini-omni-video | gemini-omni-1.1-flash | 4 秒，720p，16:9，单条，生成音频关闭 |
| rolldek-veo-fast-video | veo-3.1-fast | 8 秒，720p，16:9，单条，文生视频 |

Gemini 可选 4/6/8/10 秒及 16:9、9:16。平台默认普通参考图 1 张、首帧 1 张、尾帧 1 张，图片合计最多 3 张；视频和音频各 1 项。后台分别调整图片总数、普通参考图及视频/音频数量。未公布的素材字节和时长上限为 0，仍受宿主资源策略约束；提示词 8000 字符是平台默认限制。以上数量是用户选定的平台配置，不代表供应商实际极限。

Veo Fast 仅开放供应商文档示例规格；Veo Lite 暂不开放，不沿用 Gemini 的参考素材或时长范围。销售价格、成本与模型启用状态由管理员单独配置。

一手来源：[RollDek Gemini Omni & Veo](https://www.rolldek.com/docs/#/gemini-omni)。完整请求与响应见 [docs/interface.md](docs/interface.md)。运行 `python build.py` 同步完整文档并生成可安装 `.yingce-plugin` ZIP。
