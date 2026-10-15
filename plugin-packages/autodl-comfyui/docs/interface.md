# AutoDL ComfyUI 接口字段

## 协议身份

- 插件 ID：`autodl-comfyui`
- 视频 Provider：`autodl-comfyui`
- 创建：`POST /api/v1/comfyui/comfyui_workflow/{workflow_id}`
- 查询：`GET /api/v1/comfyui/comfyui_workflow/result/{task_id}`
- 鉴权：`Authorization: <AutoDL Token>`

## 配置字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | AutoDL Token，由宿主写入 Authorization 请求头。 |

## 视频统一字段

| 统一字段 | 类型 | 上游映射 | 规则 |
| --- | --- | --- | --- |
| `model` | string | URL `{workflow_id}` | 必须是清单中工作流 ID。 |
| `prompt` | string | `prompt` | `minimax_h3_image_audio_to_video` 工作流不发送。 |
| `duration` | integer | `duration` / `audio_duration` | 单图音频同步工作流使用 `audio_duration`。 |
| `resolution` | string | `resolution` | 转小写后发送。 |
| `images[role=first_frame]` | media | `first_frame` | 首帧工作流优先按 role 选择；旧无 role 请求才按 order 回退。 |
| `images[role=last_frame]` | media | `last_frame` | 尾帧工作流优先按 role 选择；旧无 role 请求才按 order 回退。 |
| 参考图工作流中的全部图片 | media[] | `ref_image_0` … `ref_image_8` | 按 order 稳定编号，包括历史 `first_frame/last_frame`；角色不导致图片丢失。 |
| `audios` / 参考音频 | media[] | `ref_audio_0` … `ref_audio_2` | 按 order 编号；仅音频相关 H3 工作流发送。 |

## 工作流分支

| 工作流 | 图片字段 | 音频字段 | 其他差异 |
| --- | --- | --- | --- |
| `minimax_h3_b99_001` | 无 | 无 | 文生视频。 |
| `minimax_h3_lightx2v_no_pic` | 无 | 无 | 文生视频。 |
| `minimax_h3_b99_002` | `first_frame/last_frame` | 无 | 显式首尾帧。 |
| `minimax_h3_lightx2v` | `first_frame/last_frame` | 无 | 显式首尾帧。 |
| `minimax_h3_b99_003_12s` | `ref_image_0…8` | 无 | 多图参考。 |
| `minimax_h3_lightx2v_v5` / `_15s` | `ref_image_0…8` | 无 | 多图参考。 |
| `minimax_h3_zm_u24` / `minimax_h3_zm_u08` | `ref_image_0…8` | 无 | ZM 多参考视频；`@图片1` 对应 `ref_image_0`。 |
| `minimax_h3_z0901` | 无 | 无 | 文生视频（高质量直出）。 |
| `minimax_h3_z0902` | `ref_image_0…5` | 无 | 六图生视频（多图一致性创作）。 |
| `minimax_h3_z0903` | `ref_image_0…5` | `ref_audio_0…2` | 六图三音频生视频（高质量音画融合）。 |
| `minimax_h3_image_audio_to_video` | `ref_image_0` | `ref_audio_0` | 使用 `audio_duration`，不发送 `prompt/duration`。 |
| `minimax_h3_image_audio_to_video_v2` / `_15s` | `ref_image_0…8` | `ref_audio_0…2` | 多图多音频。 |

## 响应

- `data.task_id` → 统一任务 ID。
- `data.status` → `pending/processing/succeeded/failed/cancelled`。
- `data.results` → 视频或音频结果列表；音频结果为 `type=audio` 的 wav 地址。
- `data.message` / `msg` → 统一错误消息。
- 结果 URL 按临时地址处理，宿主成功后立即下载并持久化。

## 发送前校验

`workflow-media.json` 是媒体限制的唯一维护入口，构建时生成声明式请求和校验。U24 至少需要一张参考图；文生视频工作流不接收图片；各工作流按上述表限制图片与音频数量。不支持的媒体、空地址、超量输入与重复首尾帧在发送前拒绝，禁止静默丢弃或截断。多参考图工作流接受历史首尾帧角色，但不承诺固定首尾帧效果。真正的首尾帧工作流仅用未分配角色的图片填充空缺，不复用另一帧。

插件校验提示使用平台语言。原始工作流 ID、请求字段及响应详情只供管理员排查；普通任务错误由公共输出层和前端错误助手转换为可操作提示。
