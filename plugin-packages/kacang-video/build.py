"""Build the documented Kacang JSON profiles into a deterministic plugin package."""
import copy
import json
import pathlib
import zipfile

folder = pathlib.Path(__file__).resolve().parent
folder.joinpath('docs').mkdir(exist_ok=True)
profiles = [
    ('kacang-gemini-omni-video', 'gemini-omni-flash-1.1', 'Gemini Omni Flash 1.1', 3, 10, 3, '720p', 4, 1),
    ('kacang-grok-video-15', 'grok-imagine-video-1.5', 'Grok Imagine Video 1.5', 4, 15, 8, '480p', 14, 0),
    ('kacang-kling-video-30', '可灵3.0-特惠', '可灵 3.0 特惠', 1, 15, 5, '720p', 1, 0),
]

def ref(path): return {'$ref': path}
def coalesce(value, fallback): return {'$coalesce': [value, fallback]}
def choose(condition, yes, no=None): return {'$if': {'condition': condition, 'then': yes, 'else': no}}
def count(items): return {'$len': items}
def select(kind, roles):
    return {'$filter': {'from': {'$sortByOrder': ref('request.' + kind)}, 'as': 'media', 'where': {'$in': [ref('media.role'), roles]}}}
def urls(items): return {'$map': {'from': items, 'as': 'media', 'in': ref('media.value')}}
def nonempty(items): return {'$omitEmpty': items}

providers = []
for provider, model, label, minimum, maximum, seconds, resolution, max_images, max_videos in profiles:
    gemini, grok = provider == 'kacang-gemini-omni-video', provider == 'kacang-grok-video-15'
    duration = choose({'$gt': [ref('request.output.duration'), 0]}, ref('request.output.duration'), seconds)
    ratio = coalesce(ref('request.output.aspectRatio'), '16:9')
    quality = {'$lower': coalesce(ref('request.output.resolution'), resolution)}
    ratios = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'] if grok else ['16:9', '9:16']
    qualities = ['480p', '720p', '1080p'] if grok else ['720p']
    body = {'model': ref('request.model'), 'prompt': ref('request.prompt'), 'duration_seconds': duration, 'aspect_ratio': ratio, 'resolution': quality, 'n': 1}
    checks = [
        ({'$eq': [ref('request.model'), model]}, '当前卡藏协议仅适用于 ' + model),
        ({'$gte': [count({'$trim': ref('request.prompt')}), 1]}, '卡藏视频提示词不能为空'),
        ({'$gte': [ref('request.output.duration'), 0]}, '卡藏视频时长不能为负数'),
        ({'$and': [{'$gte': [duration, minimum]}, {'$lte': [duration, maximum]}]}, f'当前卡藏模型支持 {minimum}–{maximum} 秒'),
        ({'$in': [ratio, ratios]}, '当前卡藏模型不支持所选比例'),
        ({'$in': [quality, qualities]}, '当前卡藏模型不支持所选分辨率'),
        ({'$lte': [ref('request.output.count'), 1]}, '卡藏每次任务只返回一个视频'),
        ({'$eq': [coalesce(ref('request.output.generateAudio'), False), False]}, '当前卡藏文档未声明可控音轨开关'),
        ({'$eq': [coalesce(ref('request.output.watermark'), False), False]}, '当前卡藏文档未声明可控水印开关'),
    ]
    image_roles = ['', 'first_frame', 'reference_image'] if gemini or grok else ['', 'first_frame']
    if gemini: image_roles += ['style_reference', 'subject_reference', 'element_reference']
    video_roles = ['', 'source_video', 'reference_video'] if gemini else []
    for kind, limit, roles in [('images', max_images, image_roles), ('videos', max_videos, video_roles), ('audios', 0, [])]:
        checks.append(({'$lte': [count(ref('request.' + kind)), limit]}, f'当前卡藏模型最多支持 {limit} 项 {kind}'))
        invalid_roles = {'$filter': {'from': ref('request.' + kind), 'as': 'media', 'where': {'$not': {'$in': [ref('media.role'), roles]}}}}
        checks.append(({'$eq': [count(invalid_roles), 0]}, '当前卡藏模型不支持该素材角色（包括尾帧）'))
        schemes = ['http', 'https'] if grok else ['http', 'https', 'data']
        invalid_urls = {'$filter': {'from': ref('request.' + kind), 'as': 'media', 'where': {'$not': {'$in': [{'$first': {'$split': [ref('media.value'), ':']}}, schemes]}}}}
        checks.append(({'$eq': [count(invalid_urls), 0]}, '卡藏素材地址格式不符合该模型合同'))
    if gemini:
        frames = select('images', ['', 'first_frame', 'reference_image'])
        styles = select('images', ['style_reference'])
        elements = select('images', ['subject_reference', 'element_reference'])
        checks += [
            ({'$lte': [count(frames), 1]}, 'Gemini Omni 普通帧参考最多一张'),
            ({'$lte': [count(styles), 4]}, 'Gemini Omni 风格参考最多四张'),
            ({'$lte': [count(elements), 3]}, 'Gemini Omni 元素参考最多三张'),
            ({'$lte': [{'$add': [count(ref('request.images')), count(ref('request.videos'))]}, 4]}, 'Gemini Omni 全部参考素材合计最多四项'),
        ]
        body.update(images=nonempty(urls(frames)), style_references=nonempty(urls(styles)), element_references=nonempty(urls(elements)), input_video={'$first': urls({'$sortByOrder': ref('request.videos')})})
    elif grok:
        explicit_frames = select('images', ['first_frame'])
        checks.append(({'$or': [{'$eq': [count(explicit_frames), 0]}, {'$eq': [count(ref('request.images')), 1]}]}, 'Grok 首帧与多张参考图不能混用'))
        single_frame = {'$and': [{'$eq': [count(ref('request.images')), 1]}, {'$eq': [count(select('images', ['', 'first_frame'])), 1]}]}
        body.update(image=choose(single_frame, {'$first': urls(ref('request.images'))}), images=choose(single_frame, None, nonempty(urls({'$sortByOrder': ref('request.images')}))))
    else:
        body['first_frame_url'] = {'$first': urls(ref('request.images'))}
        body['negative_prompt'] = nonempty(ref('request.providerOptions.' + provider + '.negativePrompt'))
    # The documented flat JSON fields are explicitly supported at the public
    # request boundary and normalized by Kacang into video.v1. No guessed
    # operation/role aliases are sent to the versioned contract.
    output_url = {'$coalesce': [ref('response.outputs.0.content_url'), ref('response.video_url'), ref('response.url'), ref('response.result_url')]}
    absolute_output = choose({'$in': [{'$first': {'$split': [output_url, ':']}}, ['http', 'https']]}, output_url)
    parameters = [
        ('model', 'string', True, 'model', '精确 API 模型 ID：' + model),
        ('prompt', 'string', True, 'prompt', '主体、动作和镜头描述；上游未公布最大字符数，宿主默认 8000。'),
        ('duration', 'integer', False, 'duration_seconds', f'{minimum}–{maximum} 秒，默认 {seconds} 秒。'),
        ('aspectRatio', 'string', False, 'aspect_ratio', '支持 ' + '、'.join(ratios) + '，默认 16:9。'),
        ('resolution', 'string', False, 'resolution', '支持 ' + '、'.join(qualities) + '，默认 ' + resolution + '。'),
        ('images', 'media[]', False, 'images/image/first_frame_url/style_references/element_references', '按明确素材角色映射，保持同类素材顺序；不支持尾帧。'),
    ]
    if gemini: parameters.append(('videos', 'media[]', False, 'input_video', '源视频最多一个，与图片合计最多四项。'))
    if not gemini and not grok: parameters.append(('providerOptions.' + provider + '.negativePrompt', 'string', False, 'negative_prompt', '可选反向提示词，省略不发送。'))
    providers.append({
        'id': provider, 'label': '卡藏 ' + label, 'description': f'{model} 专用 JSON 视频协议；默认 {seconds} 秒、{resolution}、16:9。',
        'capabilities': ['video'], 'scopes': ['admin.system-channel', 'user.custom-channel', 'canvas', 'creation', 'agent'],
        'baseUrl': 'https://newapi.prompt-hubs.com/v1', 'requiresPublicMediaUrls': True, 'auth': {'type': 'bearer', 'field': 'apiKey'},
        'parameters': [{'name': name, 'type': typ, 'required': required, 'mapping': mapping, 'description': desc} for name, typ, required, mapping, desc in parameters],
        'validations': [{'assert': assertion, 'message': message} for assertion, message in checks],
        'create': {'method': 'POST', 'path': '/v1/videos', 'contentType': 'application/json', 'body': body},
        'poll': {'method': 'GET', 'path': '/v1/videos/{{taskId}}'},
        'result': {'method': 'GET', 'path': '/v1/videos/{{taskId}}/content', 'query': {'download': '1'}},
        'response': {'taskId': {'$coalesce': [ref('response.id'), ref('response.task_id'), ref('taskId')]}, 'status': coalesce(ref('response.status'), 'queued'), 'message': coalesce(ref('response.error.message'), ref('response.message')), 'errorPaths': ['error.code'], 'videos': absolute_output, 'resultEphemeral': True},
    })
manifest = {'apiVersion': 'yingce.plugin/v2', 'id': 'kacang-video', 'name': '卡藏视频', 'version': '1.0.0', 'author': '卡藏 API / 影策', 'description': '适配卡藏 Gemini Omni Flash 1.1、Grok Imagine Video 1.5 和可灵 3.0 特惠，按公开合同提交、查询和下载。', 'permissions': ['generation.run', 'media.read'], 'configuration': {'fields': [{'name': 'apiKey', 'type': 'secret', 'label': 'API Key', 'required': True}]}, 'contributes': {'providers': providers}}
readme = '''# 卡藏视频

独立 `yingce.plugin/v2` 声明式插件，不含可执行运行时。宿主管理渠道凭证、出站安全、任务恢复与结果持久化。

一手依据：[卡藏公开文档](https://console.prompt-hubs.com/docs)。仅适配以下三个精确模型，不能套用同品牌其他线路。

| 协议 | API 模型 ID | 时长范围 / 默认 | 分辨率 / 默认 | 图片 / 视频 / 音频 |
| --- | --- | --- | --- | --- |
| kacang-gemini-omni-video | gemini-omni-flash-1.1 | 3–10 秒 / 3 秒 | 720p | 4 / 1 / 0，合计最多 4 项 |
| kacang-grok-video-15 | grok-imagine-video-1.5 | 4–15 秒 / 8 秒 | 480p、720p、1080p / 480p | 14 / 0 / 0 |
| kacang-kling-video-30 | 可灵3.0-特惠 | 1–15 秒 / 5 秒 | 720p | 1 / 0 / 0 |

默认文生视频、16:9，逐秒时长。Grok 另支持 1:1、4:3、3:4、3:2、2:3；Gemini 和可灵仅开放 16:9、9:16。音轨和水印开关未公开，不发送；成片是否含音轨由上游决定。未公布的素材字节/时长上限为 0，仍受宿主策略约束。提示词沿用宿主 8000 字符默认上限，不将其说成供应商限制。

选择协议会自动填入“能力与参数”的默认配置；售价、成本与启用状态由管理员独立设置，不由插件改变。

完整映射见 [docs/interface.md](docs/interface.md)。运行 `python build.py` 同步文档、Manifest 和可安装包。
'''
interface = '''# 卡藏视频接口合同

- Base URL：`https://newapi.prompt-hubs.com/v1`；宿主去重路径中的 `/v1`。
- 创建：`POST /v1/videos`，JSON 和 Bearer 鉴权；字段 `model`、`prompt`、`duration_seconds`、`aspect_ratio`、`resolution`、`n=1`。
- 参考素材使用供应商明确保留的扁平 JSON 字段，供应商在请求边界归一为 `video.v1`。本插件不发送未确认的 operation 别名。
- Gemini：`first_frame`、`reference_image` 或空角色映射 `images`（最多 1）；`style_reference` 映射 `style_references`（最多 4）；`subject_reference/element_reference` 映射 `element_references`（最多 3）；源视频映射 `input_video`（最多 1）；合计最多 4 项。
- Grok：单个 `first_frame` 或空角色映射 `image`；其他普通参考映射 `images`（最多 14），首帧不能与参考数组混用。素材需要公网 HTTP(S) URL。多图参考最高 720p，上游将 1080p 自动降为 720p；这里保留已请求档位，不伪称实际成片为 1080p。
- 可灵：仅一个 `first_frame` 或空角色映射 `first_frame_url`。可选反向提示词仅从 `providerOptions.kacang-kling-video-30.negativePrompt` 映射；故事板 `multi_prompt` 未公开分段元素的完整合同，暂不声明支持。
- 三类均拒绝尾帧、超额引用及未支持的音视频。Gemini/可灵文档接受内联数据，但系统路径仍由宿主将媒体转换成受控公网引用。风格/元素的精细角色由统一请求合同提供，当前画布只提供普通首帧/参考图选择。
- 查询：`GET /v1/videos/{id}`；响应读取 `id`（或 `task_id`）、`queued/in_progress/completed/failed`、`error.code/error.message`。
- 优先读取 `outputs[0].content_url`，兼容文档中的 `video_url/url/result_url`，标记临时结果并立即下载。创建即完成但仅返回相对内容地址时，使用独立鉴权结果端点 `GET /v1/videos/{id}/content?download=1`，不会把相对地址送给公网下载器。
- 内容端点实际 Content-Type 是媒体类型真相，不能把兼容 mime_type 当作必然 MP4。签名链接约一小时有效；已知 taskId 只查询/下载，不重新创建。未公开取消端点，不声明 DELETE。
- 请求只取声明字段，不透传 Extra、凭证或未知 Provider Options。插件包和源码不含渠道密钥。

模型文档：[Gemini](https://console.prompt-hubs.com/docs/model/gemini-omni-flash-1.1)、[Grok](https://console.prompt-hubs.com/docs/model/grok-imagine-video-1.5)、[可灵](https://console.prompt-hubs.com/docs/model/%E5%8F%AF%E7%81%B53.0-%E7%89%B9%E6%83%A0)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与包内 Manifest 逐字段一致；documentation 以等义占位避免递归。

'''
documented = copy.deepcopy(manifest)
documented['documentation'] = '<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>'
interface += '```json\n' + json.dumps(documented, ensure_ascii=False, indent=2) + '\n```\n<!-- YINGCE_MANIFEST_CONTRACT_END -->\n'
(folder/'README.md').write_text(readme, encoding='utf-8', newline='\n')
(folder/'docs/interface.md').write_text(interface, encoding='utf-8', newline='\n')
manifest['documentation'] = readme.strip() + '\n\n---\n\n' + interface.strip()
(folder/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
with zipfile.ZipFile(folder.parent/'kacang-video.yingce-plugin', 'w', zipfile.ZIP_DEFLATED) as package:
    for path in sorted(folder.rglob('*')):
        if path.is_file() and path.relative_to(folder).as_posix() in {'manifest.json', 'README.md', 'docs/interface.md'}:
            info = zipfile.ZipInfo(path.relative_to(folder).as_posix(), (2026, 10, 10, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(info, path.read_bytes())
print('Built kacang-video: 3 documented profiles')
