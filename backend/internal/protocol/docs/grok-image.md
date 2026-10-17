# xAI Grok Images

插件 `xai-grok-images`（Provider `grok-image`）使用 Bearer 鉴权及 JSON 请求。无参考图调用 `POST /v1/images/generations`，存在有效参考图时调用 `POST /v1/images/edits`，不使用 multipart。

## 参数

{{OPERATIONS}}

{{PARAMETERS}}

- `model`、`prompt`、`imageCount -> n`。
- `aspectRatio -> aspect_ratio`，像素输入按已声明规则转换；不发送 OpenAI 的 `size`。
- `resolution -> resolution`，兼容旧质量值的 1k/2k 映射。
- 单张参考图使用 `image: {url: ...}`；多张使用 `images: [{url: ...}, ...]`，按 order 排序，仅接收 edit_source/reference_image/空 role。支持 URL 和 Data URL；无参考图时省略两个图片字段。蒙版未开放。
- 后台隐藏参数 `editModel` 绑定 `providerOptions.grok-image.edit_model`：仅编辑请求替换上游模型，留空沿用当前模型；不改变无图请求、逻辑模型身份或计价规则。

## Grok2API Web 账号池

模型名称相同不代表文生图和编辑具有相同路由。Grok2API 的 Web `grok-imagine-image-2.0` 提供生成，Web 编辑使用 `grok-imagine-image-edit`。仅允许 Web 账号池的密钥，应为该渠道模型设置 `editModel=grok-imagine-image-edit`；同名 Console Image 2.0 编辑需要 Console 账号池权限，插件不自动扩大密钥范围。

当前 Grok2API 编辑入口校验 1–8 张输入图，渠道参考图上限应相应设置为 8。Web 生成路由忽略 resolution/quality；不能把选中的 2K 参数等同于上游保证返回 2K。输出数量与编辑能力以当前账号及模型实际支持为准。

## 响应与错误

响应解析 `data[].url` 或 `data[].b64_json`。Base64 优先使用 `mime_type`，缺省才采用 image/png。模型能力配置中的返回格式开关控制 `b64_json`/`url`。

上游 `client_key_account_scope_unavailable` 表示密钥限制范围内缺少相应账号路由，应核对模型的接口能力和账号池，不应盲目重试或改成文生图掩盖参考图失败。

## 接口资料

- [Grok2API 图片编辑](https://grok-api.dqin-666zj.top/docs/image/edits)
- [Grok2API 图片生成](https://grok-api.dqin-666zj.top/docs/image/generations)

{{CONTRACT}}
