# 卡藏 Gemini 语音合成

独立 `yingce.plugin/v2` 声明式音频插件，无可执行运行时。适配精确模型 `gemini-3.8-flash-tts`，通过渠道原有 Bearer 凭证调用 Gemini 原生接口。

选择 `kacang-gemini-tts` 后，“能力与参数”自动配置纯文本语音、单段输出、Kore 默认音色、自然/友好/清晰的声音指令、30 个预置音色、24kHz 单声道 16-bit WAV、8192/16384 token 输入/输出上限和非流式调用。生成页可选择音色及声音指令；稿件原文不被默认指令改写。音色扩展 ID 按用户明确输入传递。

音频按次计费。售价、成本和启用状态由管理员单独设置。旧 Suno 音乐插件与本插件分别使用自己的接口和默认值。

完整映射见 [docs/interface.md](docs/interface.md)。运行 `python build.py` 同步完整包内文档并生成 `.yingce-plugin` 安装包。
