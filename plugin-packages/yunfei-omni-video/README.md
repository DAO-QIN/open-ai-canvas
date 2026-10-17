# 爱困 Gemini 视频 · omni-flash

标准 `yingce.plugin/v2` 声明式插件，无可执行代码和内置密钥。渠道 Bearer 凭据由宿主读取，网络、任务恢复及媒体持久化沿用宿主实现。

协议 `yunfei-omni-flash-video` 保留为稳定绑定 ID，使用 Key 可用清单中的 `gemini-omni-1.1-flash` 或 `gemini-omni-1.1-flash-10s`，站点 `https://img.yunfei.best`。后台选中协议即填入 10 秒、720p、16:9，另支持 9:16、单条输出、默认文生视频。旧名 `omni-flash` 不再作为上游模型发送。延长模型 `-extend` 需要独立操作合同，不套用普通生成。

按用户确认，平台默认普通参考图 1 张、首帧与尾帧各 1 张（图片总数最多 3），视频和音频各 1 项；后台可调整数量。依文档，首尾帧模式与普通参考素材模式分开使用。未知素材大小和时长上限为 0，仍受宿主资源策略约束。音轨和水印控制未公开，不提供可控开关。

创建 `POST /v1/videos`，查询 `GET /v1/videos/{id}`；成片取响应 `url` 或 `output[].url`。素材用 `reference_images/reference_videos/reference_audios`，支持 HTTP(S) 与带媒体类型的 Base64 data URL。该合同与 Rolldek Gemini 的精确模型及字段不同，独立发布，不复用或改变 Rolldek 插件。

一手资料：[视频接口文档](https://doc.yunfei.best/#video-doc)、[请求示例](https://doc.yunfei.best/#video-input)、[响应示例](https://doc.yunfei.best/#video-output)、[模型广场](https://img.yunfei.best/pricing)。运行 `python build.py` 生成安装包；完整合同见 [docs/interface.md](docs/interface.md)。
