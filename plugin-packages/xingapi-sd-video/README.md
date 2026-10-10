# 星光 API SD 视频

独立 `yingce.plugin/v2` 声明式协议插件。源码和 `.yingce-plugin` 包内 Manifest 一致，宿主负责凭证、出站安全、轮询及结果持久化。

接入依据：用户提供的 XingAPI 视频模型对接文档及 [星光模型广场](https://xingapi.top/available-channels) 当前详情。实际模型授权必须以当前 Key 的 `/v1/models` 为准；显示名与 API ID 大小写不能互换。

## 模型默认参数

| Provider | 精确 API 模型名 | 秒数范围（默认 5） | 分辨率 | 图片/视频/音频上限 |
| --- | --- | --- | --- | --- |
| `xingapi-sd-mini-480p` | `seedance-2.0-mini-480P` | 5–10 | 480p | 9/0/3 |
| `xingapi-sd-mini-720p` | `seedance-2.0-mini-720P` | 5–15 | 720p | 9/0/0 |
| `xingapi-sd-933` | `seedance2.0-933` | 4–15 | 720p | 9/0/3 |
| `xingapi-sd-933-v` | `seedance2.0-933-V` | 5–15 | 720p | 9/3/3 |
| `xingapi-sd25` | `seedance2.5` | 5–30 | 720p | 30/10/10 |

默认比例 `16:9`，已明确的比例为 `16:9`、`9:16`；时长逐秒选择。生成音频和水印开关不开放。提示词沿用宿主默认 8000 字符，不作为上游限额声明。上游未公布素材字节和参考时长限制，能力配置为 0，仍受宿主资源策略约束。

在系统模型编辑器选择任一协议，“能力与参数”自动加载该模型的默认配置。价格及启用状态由管理员独立管理，插件不代替价格决策。

完整接口见 [docs/interface.md](docs/interface.md)。
