# 卡藏视频

独立 `yingce.plugin/v2` 声明式插件，不含可执行运行时。宿主管理渠道凭证、出站安全、任务恢复与结果持久化。

一手依据：[卡藏公开文档](https://console.prompt-hubs.com/docs)。仅适配以下五个精确模型，不能套用同品牌其他线路。

| 协议 | API 模型 ID | 时长范围 / 默认 | 分辨率 / 默认 | 图片 / 视频 / 音频 |
| --- | --- | --- | --- | --- |
| kacang-gemini-omni-video | gemini-omni-flash-1.1 | 3–10 秒 / 3 秒 | 720p | 4 / 1 / 0，合计最多 4 项 |
| kacang-grok-video-15 | grok-imagine-video-1.5 | 4–15 秒 / 8 秒 | 480p、720p、1080p / 480p | 14 / 0 / 0 |
| kacang-kling-video-30 | 可灵3.0-特惠 | 1–15 秒 / 5 秒 | 720p | 1 / 0 / 0 |
| kacang-grok-video-15-fast | grok-imagine-video-1.5-fast | 4–15 秒 / 6 秒；多张参考图最长 10 秒 | 720p、1080p / 720p | 7 / 0 / 0 |
| kacang-grok-video-15-route8 | grok-imagine-video-1.5-线路八 | 4–15 秒 / 6 秒 | 720p、1080p / 720p | 7 / 0 / 0 |

默认文生视频、16:9，逐秒时长。Grok 另支持 1:1、4:3、3:4、3:2、2:3；Gemini 和可灵仅开放 16:9、9:16。音轨和水印开关未公开，不发送；成片是否含音轨由上游决定。未公布的素材字节/时长上限为 0，仍受宿主策略约束。提示词沿用宿主 8000 字符默认上限，不将其说成供应商限制。

Fast 和线路八仅支持 16:9、9:16、1:1、4:3、3:4，不提供 480p；首帧图生视频的实际输出比例跟随输入图片。两者使用 `first_frame_url/reference_images`，不能套用原 Grok 1.5 的 `image/images` 字段。文档的通用角色列表含尾帧，但模型说明和“已确认不可传”明确禁止尾帧，因此按明确禁用规则拒绝。

选择协议会自动填入“能力与参数”的默认配置；售价、成本与启用状态由管理员独立设置，不由插件改变。

完整映射见 [docs/interface.md](docs/interface.md)。运行 `python build.py` 同步文档、Manifest 和可安装包。
