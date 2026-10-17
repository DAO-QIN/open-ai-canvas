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

模型名称相同不代表文生图和编辑具有相同路由。Grok2API 的 Web `grok-imagine-image-2.0` 提供生成，Web 编辑路由为 `grok-imagine-image-edit`，对应隐藏参数 `editModel`。实测 Web 编辑接收到正确图片但返回无关风景，不能仅凭 HTTP 200 确认效果。Console 编辑需要权限及有图片额度的账号；本渠道 Console 图片额度全部为零。用户选择不再推进 Console、Web 不可用则停止参考图。影绘因此仅保留文生图，上游模型固定为 `Web/grok-imagine-image-2.0`，参考图上限设为 0；逻辑模型身份与销售单价保持不变。此结论针对当前部署与账号池，不代表 Web 永久不支持编辑。

当前 Grok2API 编辑入口最多接受 8 张输入图，Console Image 2.0 最多 3 张；这只是接口限制，不等于效果通过。Web 编辑仅支持 n=1、resolution=1k。Web 生成路由忽略 resolution/quality；不能把选中的 2K 参数等同于上游保证返回 2K。editModel 仅允许插件声明的值，渠道可进一步收窄，不能用于任意切换计价模型。重新开放本渠道参考图前，需要重新验证真实主体保留效果。

## 响应与错误

响应解析 `data[].url` 或 `data[].b64_json`。Base64 优先使用 `mime_type`，缺省才采用 image/png。模型能力配置中的返回格式开关控制 `b64_json`/`url`。

上游 `client_key_account_scope_unavailable` 表示密钥限制范围内缺少相应账号路由，应核对模型的接口能力和账号池，不应盲目重试或改成文生图掩盖参考图失败。

## 接口资料

- [Grok2API 图片编辑](https://grok-api.dqin-666zj.top/docs/image/edits)
- [Grok2API 图片生成](https://grok-api.dqin-666zj.top/docs/image/generations)

{{CONTRACT}}
