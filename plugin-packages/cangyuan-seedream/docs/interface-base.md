# 沧元 Seedream Pro 接口

供应商依据：[模型参数](https://ai.cangyuansuanli.cn/docs/models/doubao-seedream-5-0-pro)、[Image API](https://ai.cangyuansuanli.cn/docs/api/image)。仅支持文档明确列出的参数。

## 身份与配置

插件 ID `cangyuan-seedream`，Provider ID `cangyuan-seedream-5-pro`。渠道 `apiKey` 使用 Bearer 鉴权，默认入口 `https://direct-api.cangyuansuanli.cn/v1`。不在插件内保存凭据。支持后台系统渠道、自定义渠道、画布、创作与 Agent。

## 请求与参数

`model` 固定 `doubao-seedream-5-0-pro`；`prompt` 必填非空；`imageCount` 对应 `n=1`；`aspectRatio` 对应 `size`，默认 `1:1`。推荐 `1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9`，也可在后台添加自定义正整数比例或 `WIDTHxHEIGHT`。推荐比例不是上游完整允许集合，插件不将其设为不可扩展白名单；像素范围未发布，不借用其他供应商限制，最终可用范围由上游验证。

无 `images` 时 JSON POST `/v1/images/generations`；有参考图时 JSON POST `/v1/images/edits`，以相同路径 GET `/{task_id}` 轮询。`images` 按 order 排序为 HTTPS URL 数组，最多 10 张；本地素材由宿主转换为公网可读地址，插件拒绝 data URI、HTTP 和 mask。不发送未声明的 reference 字段。

`providerOptions.cangyuan-seedream-5-pro.output_format` 支持 `jpeg / png`，默认 `jpeg`；`response_format` 支持 `url / b64_json`，默认 `url`。`async` 固定 true。无取消接口，不捏造取消请求。宿主默认提示词 32000 字符、参考图 20 MB 为本应用限制；20 MB 与供应商本地上传接口上限一致，不代表远程 URL 限制。未发送 quality、resolution、watermark、background、seed、stream、sequential_image_generation 等未声明字段。

## 响应与错误

创建响应 `id / task_id` 映射统一任务 ID；`status` 交由宿主映射 queued、processing、completed、failed 等状态。沿原端点轮询，间隔由宿主控制。完成后 `data` 中全部 `url / b64_json` 结果及 `usage` 交给宿主下载、持久化。`error.code`、`error.message / message` 保持失败语义。失败不自动重新提交收费任务。
