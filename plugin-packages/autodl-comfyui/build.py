"""Build the AutoDL manifest from plugin-owned workflow media contracts."""
import copy
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
IMAGE_ROLES = ["", "reference_image", "subject_reference", "style_reference", "edit_source", "first_frame", "last_frame"]


def ref(path):
    return {"$ref": path}


def count(items):
    return {"$len": items}


def select(items, condition):
    return {"$filter": {"from": items, "as": "media", "where": condition}}


def values(items):
    return {"$map": {"from": items, "as": "media", "in": ref("media.value")}}


def role_items(role):
    return select({"$sortByOrder": ref("request.images")}, {"$eq": [ref("media.role"), role]})


def frame_body():
    # Only unassigned references fill a vacant frame; never reuse an explicit
    # last frame as the first frame (or an explicit first frame as the last).
    ordinary = values(select({"$sortByOrder": ref("request.images")},
                             {"$not": {"$in": [ref("media.role"), ["first_frame", "last_frame"]]}}))
    explicit_first = {"$first": values(role_items("first_frame"))}
    explicit_last = {"$first": values(role_items("last_frame"))}
    last_index = {"$if": {"condition": {"$gt": [count(role_items("first_frame")), 0]}, "then": 0, "else": 1}}
    return {
        "first_frame": {"$omitEmpty": {"$coalesce": [explicit_first, {"$at": [ordinary, 0]}]}},
        "last_frame": {"$omitEmpty": {"$coalesce": [explicit_last, {"$at": [ordinary, last_index]}]}},
    }


def index_media(kind, maximum):
    return {"$indexObject": {"from": {"$sortByOrder": ref("request." + kind)},
                             "as": "media", "prefix": "ref_image_" if kind == "images" else "ref_audio_",
                             "max": maximum, "value": ref("media.value")}}


def validation(assertion, message):
    return {"assert": assertion, "message": message}


def workflow_validations(contract):
    minimum, maximum = contract["minImages"], contract["maxImages"]
    image_count, audio_count = count(ref("request.images")), count(ref("request.audios"))
    rules = [validation({"$gte": [image_count, minimum]}, f"当前模型至少需要 {minimum} 张参考图片，请添加后重试。")]
    rules += [validation({"$lte": [image_count, maximum]},
                         f"当前模型最多支持 {maximum} 张参考图片，请减少图片后重试。" if maximum else "当前模型不支持参考图片，请移除图片或切换模型。")]
    audio_max = contract["maxAudios"]
    rules += [validation({"$lte": [audio_count, audio_max]},
                         f"当前模型最多支持 {audio_max} 段参考音频，请减少音频后重试。" if audio_max else "当前模型不支持参考音频，请移除音频或切换模型。")]
    if contract["imageMode"] == "frames":
        for role, label in [("first_frame", "首帧"), ("last_frame", "尾帧")]:
            rules += [validation({"$lte": [count(role_items(role)), 1]}, f"请只选择一张{label}图片。")]
    return rules


def build():
    manifest = json.loads((ROOT / "manifest.template.json").read_text(encoding="utf-8"))
    contracts = json.loads((ROOT / "workflow-media.json").read_text(encoding="utf-8"))
    workflow_ids = {item["id"] for item in manifest["contributes"]["workflows"] if item["id"] != "*"}
    if workflow_ids != set(contracts):
        raise ValueError("Every contributed workflow must have exactly one media contract")
    provider = manifest["contributes"]["providers"][0]
    passthrough_body = copy.deepcopy(provider["create"]["body"])
    provider["parameters"][3]["description"] = "由工作流媒体契约决定首尾帧或参考图语义；参考图按 order 全量编号，包含历史首尾帧标记。"
    provider["parameters"][4]["description"] = "按 order 生成 ref_audio_N；超出工作流数量限制时在发送前拒绝，不截断。"
    cases, rules = [], []
    rules.append(validation({"$eq": [count(ref("request.videos")), 0]}, "当前模型不支持参考视频，请移除视频或切换模型。"))
    rules.append(validation({"$eq": [count(select(ref("request.images"), {"$not": {"$in": [ref("media.role"), IMAGE_ROLES]}})), 0]}, "参考图片用途不受支持，请重新选择参考图片。"))
    for kind, label in [("images", "图片"), ("audios", "音频")]:
        empty = select(ref("request." + kind), {"$eq": [{"$trim": {"$coalesce": [ref("media.value"), ""]}}, ""]})
        rules.append(validation({"$eq": [count(empty), 0]}, f"参考{label}尚未就绪，请重新上传后重试。"))
    for workflow_id, contract in contracts.items():
        mode = contract["imageMode"]
        if mode not in {"none", "frames", "references"} or not 0 <= contract["minImages"] <= contract["maxImages"]:
            raise ValueError("Invalid media contract: " + workflow_id)
        matches = {"$eq": [ref("request.model"), workflow_id]}
        base = {contract.get("durationField", "duration"): ref("request.duration"),
                "resolution": {"$omitEmpty": {"$lower": ref("request.resolution")}}}
        if contract.get("sendPrompt", True):
            base["prompt"] = ref("request.prompt")
        parts = [base]
        if mode == "frames":
            parts.append(frame_body())
        elif mode == "references":
            # Role describes the canvas source; this workflow's contract decides
            # how to serialize it. Filtering frame roles here loses user input.
            parts.append(index_media("images", contract["maxImages"]))
        if contract["maxAudios"]:
            parts.append(index_media("audios", contract["maxAudios"]))
        cases.append({"when": matches, "then": {"$merge": parts}})
        for rule in workflow_validations(contract):
            rules.append(validation({"$or": [{"$not": matches}, rule["assert"]]}, rule["message"]))
    rules.append(validation({"$or": [{"$in": [ref("request.model"), list(contracts)]}, {"$lte": [count(ref("request.audios")), 3]}]}, "当前模型最多支持 3 段参考音频，请减少音频后重试。"))
    provider["create"]["body"] = {"$switch": {"cases": cases, "default": passthrough_body}}
    provider["validations"] = rules

    documentation = (ROOT / "docs/interface.md").read_text(encoding="utf-8").split("<!-- YINGCE_MANIFEST_CONTRACT_START -->")[0].rstrip()
    documented = copy.deepcopy(manifest)
    documented["documentation"] = "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
    documentation += "\n\n<!-- YINGCE_MANIFEST_CONTRACT_START -->\n## Manifest 完整接口定义\n\n```json\n" + json.dumps(documented, ensure_ascii=False, indent=2) + "\n```\n<!-- YINGCE_MANIFEST_CONTRACT_END -->\n"
    manifest["documentation"] = (ROOT / "README.md").read_text(encoding="utf-8").strip() + "\n\n---\n\n" + documentation.strip()
    files = {"manifest.json": (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode(),
             "README.md": (ROOT / "README.md").read_bytes(), "docs/interface.md": documentation.encode()}
    target = ROOT.parent / "autodl-comfyui.yingce-plugin"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, (2026, 10, 15, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data.replace(b"\r\n", b"\n"))
    print(target.name)


if __name__ == "__main__":
    build()
