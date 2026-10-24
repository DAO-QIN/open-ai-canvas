"""Build a deterministic declarative video protocol package."""
import copy
import json
from pathlib import Path
import zipfile

folder = Path(__file__).resolve().parent
def ref(path): return {'$ref': path}
def fallback(value, default): return {'$coalesce': [value, default]}
def choose(condition, yes, no=None): return {'$if': {'condition': condition, 'then': yes, 'else': no}}
def count(value): return {'$len': value}
def ordered(kind): return {'$sortByOrder': ref('request.' + kind)}
def select(kind, roles): return {'$filter': {'from': ordered(kind), 'as': 'media', 'where': {'$in': [ref('media.role'), roles]}}}
def urls(items): return {'$map': {'from': items, 'as': 'media', 'in': ref('media.value')}}
def omit(value): return {'$omitEmpty': value}

duration = choose({'$gt': [ref('request.output.duration'), 0]}, ref('request.output.duration'), 5)
ratio = fallback(ref('request.output.aspectRatio'), '16:9')
resolution = {'$lower': fallback(ref('request.output.resolution'), '720p')}
explicit_frames = select('images', ['first_frame'])
implicit_frame = {'$and': [{'$eq': [count(ref('request.images')), 1]}, {'$eq': [count(select('images', [''])), 1]}]}
frames = choose(implicit_frame, ordered('images'), explicit_frames)
images = choose(implicit_frame, [], select('images', ['', 'reference_image']))
video_duration = {'$divide': [ref('media.metadata.durationMs'), 1000]}
total_video_ms = {'$add': [fallback(ref(f'request.videos.{index}.metadata.durationMs'), 0) for index in range(5)]}
checks = [
    ({'$gt': [count({'$trim': ref('request.model')}), 0]}, '请选择视频模型'),
    ({'$gt': [count({'$trim': ref('request.prompt')}), 0]}, '请填写视频描述'),
    ({'$gte': [ref('request.output.duration'), 0]}, '视频时长不能为负数'),
    ({'$and': [{'$gte': [duration, 3]}, {'$lte': [duration, 30]}]}, '视频时长需为 3 至 30 秒'),
    ({'$in': [ratio, ['16:9', '9:16', '1:1', '21:9']]}, '请选择支持的画面比例'),
    ({'$in': [resolution, ['720p', '1080p']]}, '请选择 720p 或 1080p'),
    ({'$lte': [ref('request.output.count'), 1]}, '每次生成一个视频'),
    ({'$eq': [fallback(ref('request.output.generateAudio'), False), False]}, '当前模型不提供音轨开关'),
    ({'$eq': [fallback(ref('request.output.watermark'), False), False]}, '当前模型不提供水印开关'),
    ({'$lte': [count(explicit_frames), 1]}, '首帧最多一张'),
    ({'$lte': [{'$add': [count(ref('request.images')), count(ref('request.videos')), count(ref('request.audios'))]}, 15]}, '参考素材合计最多 15 项'),
    ({'$lte': [total_video_ms, 30000]}, '参考视频总时长不能超过 30 秒'),
]
for kind, limit, roles in [('images', 10, ['', 'first_frame', 'reference_image']), ('videos', 5, ['', 'reference_video']), ('audios', 3, ['', 'reference_audio', 'audio_reference'])]:
    checks.append(({'$lte': [count(ref('request.' + kind)), limit]}, {'images': '图片最多 10 张', 'videos': '参考视频最多 5 段', 'audios': '参考音频最多 3 段'}[kind]))
    bad_roles = {'$filter': {'from': ref('request.' + kind), 'as': 'media', 'where': {'$not': {'$in': [ref('media.role'), roles]}}}}
    checks.append(({'$eq': [count(bad_roles), 0]}, '不支持该素材用途，当前模型不支持尾帧'))
    bad_urls = {'$filter': {'from': ref('request.' + kind), 'as': 'media', 'where': {'$not': {'$in': [{'$first': {'$split': [ref('media.value'), ':']}}, ['http', 'https']]}}}}
    checks.append(({'$eq': [count(bad_urls), 0]}, '参考素材需使用可访问的网址'))
unknown_duration = {'$filter': {'from': ref('request.videos'), 'as': 'media', 'where': {'$not': {'$gt': [ref('media.metadata.durationMs'), 0]}}}}
checks.append(({'$eq': [count(unknown_duration), 0]}, '请先读取参考视频时长后再生成'))
output_url = {'$coalesce': [ref('response.outputs.0.content_url'), ref('response.video_url'), ref('response.url'), ref('response.result_url')]}
absolute_output = choose({'$in': [{'$first': {'$split': [output_url, ':']}}, ['http', 'https']]}, output_url)
provider = {
    'id': 'kling-video-omni', 'label': '可灵全能视频',
    'description': '文本、首帧和多素材参考视频；默认 5 秒、720p、16:9，适用于相同接口与能力范围的模型。',
    'capabilities': ['video'], 'scopes': ['admin.system-channel', 'user.custom-channel', 'canvas', 'creation', 'agent'],
    'requiresPublicMediaUrls': True, 'auth': {'type': 'bearer', 'field': 'apiKey'},
    'parameters': [
        {'name': name, 'type': typ, 'required': required, 'mapping': mapping, 'description': description}
        for name, typ, required, mapping, description in [
            ('model', 'string', True, 'model', '由模型配置提供，不限制模型名称；须使用相同接口和能力范围。'),
            ('prompt', 'string', True, 'prompt', '视频描述不能为空；默认宿主上限 8000 字符，管理员可调整。'),
            ('duration', 'integer', False, 'duration_seconds', '3–30 秒，默认 5 秒。'),
            ('aspectRatio', 'string', False, 'aspect_ratio', '16:9、9:16、1:1、21:9，默认 16:9。'),
            ('resolution', 'string', False, 'resolution', '720p、1080p，默认 720p。'),
            ('images', 'media[]', False, 'first_frame_url/reference_images', '最多 10 张，首帧最多一张；单张空角色作为首帧，其他普通图片作为参考图。不支持尾帧。'),
            ('videos', 'media[]', False, 'reference_videos/referenceVideoDurations', '最多 5 段，每段 metadata.durationMs 必须为正数；按 order 保持地址和秒数一一对应，总时长最多 30 秒。'),
            ('audios', 'media[]', False, 'reference_audios', '最多 3 段；全部素材合计最多 15 项。'),
        ]
    ],
    'validations': [{'assert': assertion, 'message': message} for assertion, message in checks],
    'create': {'method': 'POST', 'path': '/v1/videos', 'contentType': 'application/json', 'body': {
        'model': ref('request.model'), 'prompt': ref('request.prompt'), 'duration_seconds': duration,
        'aspect_ratio': ratio, 'resolution': resolution,
        'first_frame_url': {'$first': urls(frames)}, 'reference_images': omit(urls(images)),
        'reference_videos': omit(urls(ordered('videos'))),
        'referenceVideoDurations': omit({'$map': {'from': ordered('videos'), 'as': 'media', 'in': video_duration}}),
        'reference_audios': omit(urls(ordered('audios'))),
    }},
    'poll': {'method': 'GET', 'path': '/v1/videos/{{taskId}}'},
    'result': {'method': 'GET', 'path': '/v1/videos/{{taskId}}/content', 'query': {'download': '1'}},
    'response': {'taskId': {'$coalesce': [ref('response.id'), ref('response.task_id'), ref('taskId')]},
                 'status': fallback(ref('response.status'), 'queued'),
                 'message': fallback(ref('response.error.message'), ref('response.message')),
                 'errorPaths': ['error.code'], 'videos': absolute_output, 'resultEphemeral': True},
}
manifest = {'apiVersion': 'yingce.plugin/v2', 'id': 'kling-video-omni', 'name': '可灵全能视频', 'version': '1.0.0',
            'author': '影绘', 'description': provider['description'], 'permissions': ['generation.run', 'media.read'],
            'configuration': {'fields': [{'name': 'apiKey', 'type': 'secret', 'label': 'API Key', 'required': True}]},
            'contributes': {'providers': [provider]}}
readme = '''# 可灵全能视频

标准 `yingce.plugin/v2` 声明式插件，无可执行运行时，仅使用 generation.run、media.read。
协议不限制模型名，默认能力针对可灵 v4；其他模型须先核对相同接口和能力范围，不能仅按品牌套用。
选择协议会自动填好“能力与参数”，不自动改价格、成本或启用状态。默认 5 秒、720p、16:9；支持 3–30 秒逐秒选择、720p/1080p、16:9/9:16/1:1/21:9。
最多 10 张图片（含首帧）、5 段视频、3 段音频，合计最多 15 项；参考视频逐条声明时长，合计最多 30 秒。不支持尾帧，不发送未公开的音轨、水印或其他参数。

接口依据：[可灵 v4 文档](https://console.prompt-hubs.com/docs/model/kling-video-v4)。
完整合同见 [docs/interface.md](docs/interface.md)。执行 `python build.py` 重建文档、Manifest 和安装包。
'''
interface = '''# 接口合同

- 创建：POST /v1/videos，JSON、Bearer；model 从模型配置读取。duration_seconds、resolution、aspect_ratio 从统一输出合同读取。使用文档明确继续接受的扁平字段，由服务端归一成 video.v1，不猜测全能参考 operation 值。
- 图片按角色拆成 first_frame_url/reference_images；单张空角色是首帧，多张空角色是普通参考。禁止 last_frame、mask、风格/主体等未声明的特殊角色，避免静默丢弃用途。
- 视频地址与 referenceVideoDurations 按相同 order 稳定排序；durationMs 除以 1000，保留小数，不向下取整。缺失/非正时长、总时长超过 30 秒会在创建前拒绝。
- 音频映射 reference_audios。所有媒体须为公网 HTTP(S) 引用；宿主负责上传与出站安全。
- 查询响应 GET /v1/videos/{id}；id/task_id 是同一任务。queued/in_progress/completed/failed 映射宿主状态。
- 完成优先读 outputs[0].content_url，兼容 video_url/url/result_url；相对链接不直接下载，改走鉴权 GET /v1/videos/{id}/content?download=1。临时结果立即保存，已知任务 ID 只查询和下载，不重新创建；创建超时不得自动重试计费请求。
- 签名结果链接有效期按当前文档为 30 小时；过期重新查询取得链接。宿主下载使用实际 Content-Type，不伪造格式。
- 不发送 n、Extra、未知 providerOptions、凭证或未声明的字段。没有公开取消接口，不声明取消。
- 参考视频有额外成本，插件不推断售价或汇率；管理员应确认价格规则后再开放相应能力。
- 提示词最大长度与素材文件大小没有文档硬上限；8000 字符是宿主默认值，字节上限 0 表示未单独限制，仍受宿主策略约束。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下定义与安装包一致；documentation 使用等义占位，避免递归。

'''
documented = copy.deepcopy(manifest)
documented['documentation'] = '<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>'
interface += '```json\n' + json.dumps(documented, ensure_ascii=False, indent=2) + '\n```\n<!-- YINGCE_MANIFEST_CONTRACT_END -->\n'
(folder/'docs').mkdir(exist_ok=True)
(folder/'README.md').write_text(readme, encoding='utf-8', newline='\n')
(folder/'docs/interface.md').write_text(interface, encoding='utf-8', newline='\n')
manifest['documentation'] = readme.strip() + '\n\n---\n\n' + interface.strip()
(folder/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
with zipfile.ZipFile(folder.parent/'kling-video-omni.yingce-plugin', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['README.md', 'docs/interface.md', 'manifest.json']:
        entry = zipfile.ZipInfo(name, (2026, 10, 24, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, (folder/name).read_bytes())
