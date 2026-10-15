"""Build the documented Yunfei omni-flash declarative video package."""
import copy
import json
import pathlib
import zipfile

folder = pathlib.Path(__file__).resolve().parent
(folder / "docs").mkdir(exist_ok=True)


def ref(path):
    return {"$ref": path}


def fallback(value, default):
    return {"$coalesce": [value, default]}


def choose(condition, yes, no=None):
    return {"$if": {"condition": condition, "then": yes, "else": no}}


def selected(kind, roles):
    return {"$filter": {"from": {"$sortByOrder": ref("request." + kind)}, "as": "media",
                        "where": {"$in": [ref("media.role"), roles]}}}


ordinary_roles = ["", "reference_image", "style_reference", "subject_reference", "element_reference"]
first, last = selected("images", ["first_frame"]), selected("images", ["last_frame"])
frames = selected("images", ["first_frame", "last_frame"])
ordinary = selected("images", ordinary_roles)
duration = fallback(ref("request.output.duration"), 8)
ratio = fallback(ref("request.output.aspectRatio"), "16:9")
resolution = {"$lower": fallback(ref("request.output.resolution"), "720p")}
checks = [
    ({"$eq": [ref("request.model"), "omni-flash"]}, "爱困视频协议仅适用于 omni-flash"),
    ({"$gt": [{"$len": {"$trim": ref("request.prompt")}}, 0]}, "视频提示词不能为空"),
    ({"$eq": [duration, 8]}, "当前协议开放文档示例的 8 秒规格"),
    ({"$eq": [ratio, "16:9"]}, "当前协议开放文档示例的 16:9 比例"),
    ({"$eq": [resolution, "720p"]}, "当前协议开放文档示例的 720p 分辨率"),
    ({"$lte": [fallback(ref("request.output.count"), 1), 1]}, "每次任务仅生成一个视频"),
    ({"$eq": [fallback(ref("request.output.generateAudio"), False), False]}, "供应商未公布音轨控制参数"),
    ({"$eq": [fallback(ref("request.output.watermark"), False), False]}, "供应商未公布水印控制参数"),
    ({"$lte": [{"$len": first}, 1]}, "首帧最多一张"),
    ({"$lte": [{"$len": last}, 1]}, "尾帧最多一张"),
    ({"$or": [{"$eq": [{"$len": frames}, 0]}, {"$and": [
        {"$eq": [{"$len": ordinary}, 0]},
        {"$eq": [{"$len": ref("request.videos")}, 0]},
        {"$eq": [{"$len": ref("request.audios")}, 0]},
    ]}]}, "按供应商文档，首尾帧模式与普通参考素材模式分开使用"),
]
for kind, roles in {"images": ordinary_roles + ["first_frame", "last_frame"],
                    "videos": ["", "reference_video", "source_video"],
                    "audios": ["", "reference_audio"]}.items():
    bad_roles = {"$filter": {"from": ref("request." + kind), "as": "media",
                             "where": {"$not": {"$in": [ref("media.role"), roles]}}}}
    bad_urls = {"$filter": {"from": ref("request." + kind), "as": "media",
                            "where": {"$not": {"$in": [
                                {"$first": {"$split": [ref("media.value"), ":"]}}, ["http", "https", "data"]]}}}}
    checks += [({"$eq": [{"$len": bad_roles}, 0]}, "当前视频协议不支持该素材角色"),
               ({"$eq": [{"$len": bad_urls}, 0]}, "参考素材须为 HTTP(S) 链接或含媒体类型的 Base64 data URL")]


def urls(kind):
    return {"$omitEmpty": {"$map": {"from": {"$sortByOrder": ref("request." + kind)}, "as": "media", "in": ref("media.value")}}}


parameters = [
    ("model", "string", True, "model", "精确模型 ID：omni-flash。"),
    ("prompt", "string", True, "prompt", "视频描述；宿主默认 8000 字符是平台限制。"),
    ("duration", "integer", False, "duration", "当前默认及开放 8 秒，采用文档示例；不是供应商上限。"),
    ("resolution", "string", False, "resolution", "当前默认及开放 720p。"),
    ("aspectRatio", "string", False, "aspect_ratio", "当前默认及开放 16:9。"),
    ("images", "media[]", False, "reference_images", "保序对象数组；首尾帧保留 first_frame/last_frame，普通图 role=reference。支持媒体 data URL 与 HTTP(S)。"),
    ("videos", "media[]", False, "reference_videos", "保序视频数组，默认平台上限 1 项，可由管理员调整。"),
    ("audios", "media[]", False, "reference_audios", "保序音频数组，默认平台上限 1 项，可由管理员调整。"),
]
completed = {"$eq": [ref("response.status"), "completed"]}
candidate_urls = {"$concatArrays": [[ref("response.url")], {"$map": {"from": ref("response.output"), "as": "item", "in": ref("item.url")}}]}
valid_urls = {"$filter": {"from": candidate_urls, "as": "url", "where": {"$in": [{"$first": {"$split": [ref("url"), ":"]}}, ["http", "https"]]}}}
output_url = {"$first": valid_urls}
status = choose(ref("response.error"), "failed", choose(
    {"$in": [ref("response.status"), ["queued", "in_progress", "processing", "completed", "failed"]]}, ref("response.status"), "failed"))
provider = {
    "id": "yunfei-omni-flash-video", "label": "爱困 Gemini 视频 · omni-flash",
    "description": "img.yunfei.best 原生异步 JSON；默认 8秒/720p/16:9，首尾帧或图/视/音参考。",
    "capabilities": ["video"], "scopes": ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"],
    "baseUrl": "https://img.yunfei.best", "auth": {"type": "bearer", "field": "apiKey"},
    "parameters": [{"name": n, "type": t, "required": r, "mapping": m, "description": d} for n, t, r, m, d in parameters],
    "validations": [{"assert": a, "message": m} for a, m in checks],
    "create": {"method": "POST", "path": "/v1/videos", "originPath": True, "contentType": "application/json", "body": {
        "model": ref("request.model"), "prompt": ref("request.prompt"), "duration": duration,
        "resolution": resolution, "aspect_ratio": ratio,
        "reference_images": {"$omitEmpty": {"$map": {"from": {"$sortByOrder": ref("request.images")}, "as": "media", "in": {
            "url": ref("media.value"), "role": choose({"$in": [ref("media.role"), ["first_frame", "last_frame"]]}, ref("media.role"), "reference")}}}},
        "reference_videos": urls("videos"), "reference_audios": urls("audios"),
    }},
    "poll": {"method": "GET", "path": "/v1/videos/{{taskId}}", "originPath": True},
    "response": {"taskId": fallback(ref("response.id"), ref("taskId")), "status": status,
                 "message": {"$coalesce": [ref("response.error.message"), ref("response.error"), ref("response.message"), "供应商未返回有效任务状态"]},
                 "errorPaths": ["error.code", "code"], "videos": choose({"$and": [completed, {"$not": ref("response.error")}]}, output_url), "resultEphemeral": True},
}
manifest = {"apiVersion": "yingce.plugin/v2", "id": "yunfei-omni-video", "name": "爱困 Gemini 视频 · omni-flash",
            "version": "1.0.0", "author": "影策", "description": "独立适配 img.yunfei.best 的 omni-flash JSON 视频任务接口。",
            "permissions": ["generation.run", "media.read"],
            "configuration": {"fields": [{"name": "apiKey", "type": "secret", "label": "API Key", "required": True}]},
            "contributes": {"providers": [provider]}}
readme = """# 爱困 Gemini 视频 · omni-flash

标准 `yingce.plugin/v2` 声明式插件，无可执行代码和内置密钥。渠道 Bearer 凭据由宿主读取，网络、任务恢复及媒体持久化沿用宿主实现。

协议 `yunfei-omni-flash-video`，精确模型 `omni-flash`，站点 `https://img.yunfei.best`。后台选中协议即填入 8 秒、720p、16:9、单条输出、默认文生视频。该规格来自供应商通用示例，不代表 omni-flash 的全部能力或上限。

按用户确认，平台默认普通参考图 1 张、首帧与尾帧各 1 张（图片总数最多 3），视频和音频各 1 项；后台可调整数量。依文档，首尾帧模式与普通参考素材模式分开使用。未知素材大小和时长上限为 0，仍受宿主资源策略约束。音轨和水印控制未公开，不提供可控开关。

创建 `POST /v1/videos`，查询 `GET /v1/videos/{id}`；成片取响应 `url` 或 `output[].url`。素材用 `reference_images/reference_videos/reference_audios`，支持 HTTP(S) 与带媒体类型的 Base64 data URL。该合同与 Rolldek Gemini 的精确模型及字段不同，独立发布，不复用或改变 Rolldek 插件。

一手资料：[视频接口文档](https://doc.yunfei.best/#video-doc)、[请求示例](https://doc.yunfei.best/#video-input)、[响应示例](https://doc.yunfei.best/#video-output)、[模型广场](https://img.yunfei.best/pricing)。运行 `python build.py` 生成安装包；完整合同见 [docs/interface.md](docs/interface.md)。
"""
interface = """# omni-flash 视频接口合同

## 请求和素材

- 创建与查询均设置 `originPath=true`，渠道地址已有 `/v1` 时不会重复拼接；鉴权使用 `Authorization: Bearer`，凭据不放入 URL。
- 顶层 JSON 仅发送 `model/prompt/duration/resolution/aspect_ratio` 及实际使用的素材数组。时长为整数；不发送兼容字段 seconds、size、images、音轨控制、随机种子、n 或未公布参数。
- 图片按用户顺序映射为 `reference_images` 对象数组，普通参考使用 `role=reference`，首尾帧分别使用 `first_frame/last_frame`。首尾帧各最多一张；拒绝与普通图、参考音频或视频同时使用。
- 音频与视频按用户顺序映射到 `reference_audios/reference_videos`。空数组省略，避免覆盖上游兼容字段优先级。HTTP(S) 与 data URL 的实际安全和媒体校验由宿主执行，插件不放宽出站限制。
- 文档未列 omni-flash 专属规格上限；仅默认开放通用示例 8秒/720p/16:9。默认引用数量由用户选定，属于平台限制。后台可调整引用数量；提示词 8000 字符及宿主媒体策略继续生效。

## 任务状态、响应和成片

- 创建返回 `id`；queued 为排队，in_progress/processing 为生成中，completed 为完成，failed 为失败。error 对象/字符串、非成功业务 code、缺失或未知状态保留失败语义。
- 仅 completed 时取有效 HTTP(S) 的顶层 url，缺省时取 output 数组中第一个有效 url。提前返回 URL 不视为完成；completed 未提供媒体地址则宿主返回失败。
- 成片 URL 为临时资源，宿主及时下载并保存。没有声明供应商未公布的 /content 或取消端点；查询、下载重试与恢复始终使用原任务 ID，不重新创建付费任务。
- 真实测试按文档建议每 5 秒查询，遇到 completed/failed 结束。未将模型广场的价格自动换算为平台售卖积分，启用及定价由管理员决定。

## 字段映射

| 统一字段 | 类型 | 上游字段 | 说明 |
| --- | --- | --- | --- |
"""
for field in provider["parameters"]:
    interface += "| `" + field["name"] + "` | " + field["type"] + " | `" + field["mapping"] + "` | " + field["description"] + " |\n"
documented = copy.deepcopy(manifest)
documented["documentation"] = "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
interface += "\n<!-- YINGCE_MANIFEST_CONTRACT_START -->\n## Manifest 完整接口定义\n\n```json\n" + json.dumps(documented, ensure_ascii=False, indent=2) + "\n```\n<!-- YINGCE_MANIFEST_CONTRACT_END -->\n"
(folder / "README.md").write_text(readme, encoding="utf-8", newline="\n")
(folder / "docs/interface.md").write_text(interface, encoding="utf-8", newline="\n")
manifest["documentation"] = readme.strip() + "\n\n---\n\n" + interface.strip()
(folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
with zipfile.ZipFile(folder.parent / "yunfei-omni-video.yingce-plugin", "w", zipfile.ZIP_DEFLATED) as package:
    for name in ["manifest.json", "README.md", "docs/interface.md"]:
        info = zipfile.ZipInfo(name, (2026, 10, 15, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, (folder / name).read_bytes())
print("Built yunfei-omni-video: documented omni-flash JSON video provider")
