"""Build RollDek's documented flat JSON video protocols and embedded contract."""
import copy
import json
import pathlib
import zipfile

folder = pathlib.Path(__file__).resolve().parent
folder.joinpath("docs").mkdir(exist_ok=True)

def ref(path):
    return {"$ref": path}

def choose(condition, yes, no=None):
    return {"$if": {"condition": condition, "then": yes, "else": no}}

def fallback(value, default):
    return {"$coalesce": [value, default]}

def omit(value):
    return {"$omitEmpty": value}

def select(kind, roles):
    return {"$filter": {"from": {"$sortByOrder": ref("request." + kind)}, "as": "media",
                        "where": {"$in": [ref("media.role"), roles]}}}

def urls(items):
    return {"$map": {"from": items, "as": "media", "in": ref("media.value")}}

providers = []
for provider, model, label, durations, ratios in [
    ("rolldek-gemini-omni-video", "gemini-omni-1.1-flash", "Gemini Omni 1.1 Flash", [4, 6, 8, 10], ["16:9", "9:16"]),
    ("rolldek-veo-fast-video", "veo-3.1-fast", "Veo 3.1 Fast", [8], ["16:9"]),
]:
    omni = provider == "rolldek-gemini-omni-video"
    duration = fallback(ref("request.output.duration"), durations[0])
    ratio = fallback(ref("request.output.aspectRatio"), "16:9")
    resolution = {"$lower": fallback(ref("request.output.resolution"), "720p")}
    body = {"model": ref("request.model"), "prompt": ref("request.prompt"),
            "duration": duration, "resolution": resolution, "aspect_ratio": ratio, "n": 1}
    checks = [
        ({"$eq": [ref("request.model"), model]}, "当前 RollDek 协议仅适用于 " + model),
        ({"$gt": [{"$len": {"$trim": ref("request.prompt")}}, 0]}, "视频提示词不能为空"),
        ({"$in": [duration, durations]}, "当前 RollDek 协议开放时长：" + "/".join(map(str, durations)) + " 秒"),
        ({"$in": [ratio, ratios]}, "当前 RollDek 协议不支持所选比例"),
        ({"$eq": [resolution, "720p"]}, "当前 RollDek 协议开放 720p"),
        ({"$lte": [fallback(ref("request.output.count"), 1), 1]}, "每次任务只生成一个视频"),
        ({"$eq": [fallback(ref("request.output.watermark"), False), False]}, "RollDek 未公布可控水印参数"),
    ]
    parameters = [
        ("model", "string", True, "model", "精确模型 ID：" + model),
        ("prompt", "string", True, "prompt", "非空提示词；宿主默认 8000 字符，不代表供应商上限。"),
        ("duration", "integer", False, "duration", "整数秒，开放 " + "/".join(map(str, durations)) + "，默认 " + str(durations[0]) + "。"),
        ("resolution", "string", False, "resolution", "默认及当前开放 720p。"),
        ("aspectRatio", "string", False, "aspect_ratio", "开放 " + "/".join(ratios) + "，默认 16:9。"),
        ("imageCount", "integer", False, "n", "固定单条输出，n=1。"),
    ]
    if omni:
        first = select("images", ["first_frame"])
        last = select("images", ["last_frame"])
        ordinary = select("images", ["", "reference_image", "style_reference", "subject_reference", "element_reference"])
        body.update({
            "images": omit(urls(ordinary)),
            "first_frame_url": {"$first": urls(first)},
            "last_frame_url": {"$first": urls(last)},
            "videos": omit(urls({"$sortByOrder": ref("request.videos")})),
            "audios": omit(urls({"$sortByOrder": ref("request.audios")})),
            "generateAudio": False,
            "preprocess": omit(ref("request.providerOptions." + provider + ".preprocess")),
            "seed": omit(ref("request.providerOptions." + provider + ".seed")),
        })
        checks.extend([
            ({"$lte": [{"$len": first}, 1]}, "首帧最多一张"),
            ({"$lte": [{"$len": last}, 1]}, "尾帧最多一张"),
            ({"$eq": [fallback(ref("request.output.generateAudio"), False), False]}, "音轨由上游决定，当前未开放音频生成开关"),
        ])
        parameters.extend([
            ("images", "media[]", False, "images/first_frame_url/last_frame_url", "普通图片保序，首尾帧使用独立字段，不在 images 中重复。数量取后台能力配置。"),
            ("videos", "media[]", False, "videos", "HTTPS 视频地址数组；默认最多一项，后台可调整。"),
            ("audios", "media[]", False, "audios", "HTTPS 音频地址数组；默认最多一项，后台可调整。"),
            ("generateAudio", "boolean", False, "generateAudio=false", "固定发送 false；实测仍返回有声音轨，暂不提供可控开关，与输入参考音频 audios 分开。"),
            ("providerOptions." + provider + ".preprocess", "boolean", False, "preprocess", "可选人脸预处理开关，显式 false 保留。"),
            ("providerOptions." + provider + ".seed", "integer", False, "seed", "可选随机种子，显式 0 保留。"),
        ])
        roles_by_kind = {
            "images": ["", "reference_image", "first_frame", "last_frame", "style_reference", "subject_reference", "element_reference"],
            "videos": ["", "reference_video", "source_video"],
            "audios": ["", "reference_audio"],
        }
        for kind, roles in roles_by_kind.items():
            invalid_roles = {"$filter": {"from": ref("request." + kind), "as": "media", "where": {"$not": {"$in": [ref("media.role"), roles]}}}}
            invalid_urls = {"$filter": {"from": ref("request." + kind), "as": "media", "where": {"$ne": [{"$first": {"$split": [ref("media.value"), ":"]}}, "https"]}}}
            checks.extend([
                ({"$eq": [{"$len": invalid_roles}, 0]}, "当前 RollDek 协议不支持该素材角色"),
                ({"$eq": [{"$len": invalid_urls}, 0]}, "RollDek 参考素材需要可公开下载的 HTTPS 地址"),
            ])
    else:
        for kind in ["images", "videos", "audios"]:
            checks.append(({"$eq": [{"$len": ref("request." + kind)}, 0]}, "Veo Fast 当前仅开放已公布的文生视频规格"))
        checks.append(({"$eq": [fallback(ref("request.output.generateAudio"), False), False]}, "Veo Fast 当前文档未声明音轨控制参数"))
    completed = {"$eq": [ref("response.status"), "completed"]}
    output_url = {"$coalesce": [ref("response.metadata.url"), ref("response.url"), ref("response.video_url")]}
    absolute_url = {"$eq": [{"$first": {"$split": [output_url, ":"]}}, "https"]}
    status = choose(ref("response.error"), "failed", choose({"$in": [ref("response.status"), ["queued", "in_progress", "completed", "failed"]]}, ref("response.status"), "failed"))
    providers.append({
        "id": provider, "label": "RollDek " + label,
        "description": ("原生异步 JSON；默认 4秒/720p/16:9，支持首尾帧及图/视/音参考。" if omni else "原生异步 JSON；仅开放公开示例 8秒/720p/16:9 文生视频，不适用于 Lite。"),
        "capabilities": ["video"], "scopes": ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"],
        "baseUrl": "https://rolldek.com", "requiresPublicMediaUrls": True,
        "auth": {"type": "bearer", "field": "apiKey"},
        "parameters": [{"name": n, "type": t, "required": r, "mapping": m, "description": d} for n, t, r, m, d in parameters],
        "validations": [{"assert": a, "message": m} for a, m in checks],
        "create": {"method": "POST", "path": "/v1/videos", "originPath": True, "contentType": "application/json", "body": body},
        "poll": {"method": "GET", "path": "/v1/videos/{{taskId}}", "originPath": True},
        "result": {"method": "GET", "path": "/v1/videos/{{taskId}}/content", "originPath": True, "headers": {"Accept": "video/mp4"}},
        "response": {"taskId": {"$coalesce": [ref("response.id"), ref("taskId")]}, "status": status,
                     "message": {"$coalesce": [ref("response.error.message"), ref("response.message"), "RollDek 未返回有效任务状态"]},
                     "errorPaths": ["error.code", "code"], "videos": choose({"$and": [completed, absolute_url]}, output_url), "resultEphemeral": True},
    })

manifest = {"apiVersion": "yingce.plugin/v2", "id": "rolldek-gemini-video", "name": "RollDek Gemini Omni 与 Veo Fast 视频",
            "version": "1.0.0", "author": "RollDek / 影策", "description": "独立适配 RollDek Gemini Omni 1.1 Flash 与 Veo 3.1 Fast 原生异步视频接口。",
            "permissions": ["generation.run", "media.read"],
            "configuration": {"fields": [{"name": "apiKey", "type": "secret", "label": "API Key", "required": True}]},
            "contributes": {"providers": providers}}
readme = """# RollDek Gemini Omni 与 Veo Fast 视频

独立 `yingce.plugin/v2` 声明式插件，无可执行插件代码。API Key 使用渠道原有 Bearer 配置，由宿主负责出站安全、任务恢复、下载与持久化。

| 协议 | 精确模型 | 默认配置 |
| --- | --- | --- |
| rolldek-gemini-omni-video | gemini-omni-1.1-flash | 4 秒，720p，16:9，单条，音轨由上游决定 |
| rolldek-veo-fast-video | veo-3.1-fast | 8 秒，720p，16:9，单条，文生视频 |

Gemini 可选 4/6/8/10 秒及 16:9、9:16。平台默认普通参考图 1 张、首帧 1 张、尾帧 1 张，图片合计最多 3 张；视频和音频各 1 项。后台分别调整图片总数、普通参考图及视频/音频数量。未公布的素材字节和时长上限为 0，仍受宿主资源策略约束；提示词 8000 字符是平台默认限制。以上数量是用户选定的平台配置，不代表供应商实际极限。

真实验证中，顶层 `generateAudio:false` 被发送，但供应商返回的 MP4 仍带有声 AAC 音轨。按用户选择暂不提供音频生成开关，不宣称能控制成片静音；参考音频输入继续独立支持。测试原片保留，另行移除音轨得到无声交付副本，视频数据不重新编码；该交付处理不代表在线宿主自动去音轨。

Veo Fast 仅开放供应商文档示例规格；Veo Lite 暂不开放，不沿用 Gemini 的参考素材或时长范围。销售价格、成本与模型启用状态由管理员单独配置。

一手来源：[RollDek Gemini Omni & Veo](https://www.rolldek.com/docs/#/gemini-omni)。完整请求与响应见 [docs/interface.md](docs/interface.md)。运行 `python build.py` 同步完整文档并生成可安装 `.yingce-plugin` ZIP。
"""
interface = """# RollDek 视频接口合同

## 请求与鉴权

- 插件 ID `rolldek-gemini-video`；两个 Provider ID 见 README。`apiKey` 为必填 secret，使用 Bearer 请求头，不写入 URL 或包内。
- 创建 `POST /v1/videos`；查询 `GET /v1/videos/{{taskId}}`；结果 `GET /v1/videos/{{taskId}}/content`。均使用 `originPath=true`，渠道已有 `/v1` 时也只从站点根路径拼接一次。
- 请求为顶层 JSON：`model`、`prompt`、整数 `duration`、`resolution`、`aspect_ratio`、`n=1`。不发送 WAN 的 `seconds`、`reference_images` 或嵌套 metadata；可选 `size` 与已发送清晰度和比例重复，故省略。
- Gemini `images`、`videos`、`audios` 是保序 HTTPS 地址数组。`first_frame` / `last_frame` 分别映射 `first_frame_url` / `last_frame_url`，不重复放入 `images`。其他明确图片参考角色映射普通参考图；未知角色拒绝，首尾帧各最多一张。
- Gemini `generateAudio` 使用驼峰字段，固定显式 false。实测上游仍返回有声音轨，当前能力配置关闭并隐藏可控音轨开关，音轨由上游决定；输入 `audios` 独立支持。`providerOptions.rolldek-gemini-omni-video.preprocess` 和 `.seed` 可选；false 和 0 保留，未设置时省略。
- Veo Fast 不发送参考输入、音轨开关、水印或未知字段；拒绝 Lite 及其他模型 ID。只开放文档所证实的 8 秒/720p/16:9。
- 普通参考图上限为能力配置 `video.references.maxReferenceImages`，图片总数为 `maxImages`，视频/音频上限分别为 `maxVideos` / `maxAudios`，宿主生成前校验。管理员可调整平台数量；插件不把未知供应商极限写死为该默认值。

## 响应、查询与下载

- 创建返回 `id`；`queued` 为排队，`in_progress` 为生成中，`completed` 为完成，`failed` 为失败。缺失或未知状态、error 对象、非成功业务 code 均保持失败语义。
- 仅 `completed` 时读取 `metadata.url`，兼容文档声明的 `url`、`video_url`。提前返回 URL 不得把排队响应视为成功。URL 标记 ephemeral，由宿主及时下载保存；没有有效 HTTPS URL 时使用带 Bearer 的 `/content` 结果端点。
- HTTP 错误、`error.code` / `error.message` 向上返回真实失败。失败停止轮询，取消接口未公布，不虚构取消端点。
- 创建只提交一次。查询超时或服务恢复时继续同一个任务 ID，不重新发起付费创建；真实验证按文档建议每 15 秒查询。

## 参数逐字段定义

"""
for p in providers:
    interface += "### " + p["id"] + "\n\n| 统一字段 | 类型 | 上游字段 | 说明 |\n| --- | --- | --- | --- |\n"
    for field in p["parameters"]:
        interface += "| `" + field["name"] + "` | " + field["type"] + " | `" + field["mapping"] + "` | " + field["description"] + " |\n"
    interface += "\n"
interface += "<!-- YINGCE_MANIFEST_CONTRACT_START -->\n## Manifest 完整接口定义\n\n"
documented = copy.deepcopy(manifest)
documented["documentation"] = "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
interface += "```json\n" + json.dumps(documented, ensure_ascii=False, indent=2) + "\n```\n<!-- YINGCE_MANIFEST_CONTRACT_END -->\n"
(folder / "README.md").write_text(readme, encoding="utf-8", newline="\n")
(folder / "docs/interface.md").write_text(interface, encoding="utf-8", newline="\n")
manifest["documentation"] = readme.strip() + "\n\n---\n\n" + interface.strip()
(folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
with zipfile.ZipFile(folder.parent / "rolldek-gemini-video.yingce-plugin", "w", zipfile.ZIP_DEFLATED) as package:
    for name in ["manifest.json", "README.md", "docs/interface.md"]:
        info = zipfile.ZipInfo(name, (2026, 10, 14, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, (folder / name).read_bytes())
print("Built rolldek-gemini-video: 2 documented declarative providers")
