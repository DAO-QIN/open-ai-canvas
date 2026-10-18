"""Build the self-contained Cangyuan Seedream Pro declarative package."""
import copy
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parent
provider_id = 'cangyuan-seedream-5-pro'
ref = lambda key: {'$ref': key}
op = lambda key, *values: {'$' + key: list(values)}
option = lambda key, default: {'$coalesce': [ref('request.providerOptions.' + provider_id + '.' + key), default]}
images = ref('request.images')
length = lambda value: {'$len': value}
has_images = op('gt', length(images), 0)
endpoint = {'$if': {'condition': has_images, 'then': '/v1/images/edits', 'else': '/v1/images/generations'}}
ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']
size = {'$coalesce': [ref('request.aspectRatio'), '1:1']}
dimensions = {'$split': [size, 'x']}
dimension = lambda index: {'$toInt': {'$at': [dimensions, index]}}
ratio_parts = {'$split': [size, ':']}
ratio_part = lambda index: {'$toInt': {'$at': [ratio_parts, index]}}
validations = [
    (op('eq', ref('request.model'), 'doubao-seedream-5-0-pro'), '此协议仅适用于沧元 doubao-seedream-5-0-pro。'),
    (op('lte', ref('request.imageCount'), 1), 'Seedream Pro 每次只能生成 1 张图片。'),
    (op('gt', length({'$trim': ref('request.prompt')}), 0), '图片提示词不能为空。'),
    (op('lte', length(images), 10), '参考图最多 10 张。'),
    (op('eq', length({'$filter': {'from': images, 'as': 'media', 'where': op('eq', ref('media.role'), 'mask')}}), 0), '此协议不支持蒙版。'),
    (op('eq', length({'$filter': {'from': images, 'as': 'media', 'where': op('ne', {'$first': {'$split': [ref('media.value'), ':']}}, 'https')}}), 0), '参考图必须为 HTTPS URL，由宿主转换本地素材。'),
    (op('or', op('and', op('eq', length(ratio_parts), 2), op('gt', ratio_part(0), 0), op('gt', ratio_part(1), 0), op('eq', size, {'$concat': [{'$toString': ratio_part(0)}, ':', {'$toString': ratio_part(1)}]})), op('and', op('eq', length(dimensions), 2), op('gt', dimension(0), 0), op('gt', dimension(1), 0), op('eq', size, {'$concat': [{'$toString': dimension(0)}, 'x', {'$toString': dimension(1)}]}))), '尺寸必须为正整数比例或 WIDTHxHEIGHT；可用范围由上游验证。'),
    (op('in', option('output_format', 'jpeg'), ['jpeg', 'png']), '输出格式仅支持 jpeg / png。'),
    (op('in', option('response_format', 'url'), ['url', 'b64_json']), '响应格式仅支持 url / b64_json。'),
]
provider = {
    'id': provider_id, 'label': '沧元 Seedream 5.0 Pro', 'capabilities': ['image'],
    'scopes': ['admin.system-channel', 'user.custom-channel', 'canvas', 'creation', 'agent'],
    'baseUrl': 'https://direct-api.cangyuansuanli.cn/v1', 'requiresPublicMediaUrls': True,
    'auth': {'type': 'bearer', 'field': 'apiKey'},
    'imageParameters': [
        {'name': 'size', 'label': '画幅 / 尺寸', 'type': 'string', 'binding': 'aspectRatio', 'default': '1:1', 'pricing': True},
        {'name': 'count', 'label': '生成数量', 'type': 'integer', 'binding': 'imageCount', 'min': 1, 'max': 1, 'step': 1, 'default': 1},
        {'name': 'outputFormat', 'label': '输出格式', 'type': 'string', 'binding': 'providerOptions.' + provider_id + '.output_format', 'values': ['jpeg', 'png'], 'default': 'jpeg'},
        {'name': 'responseFormat', 'label': '响应格式', 'type': 'string', 'binding': 'providerOptions.' + provider_id + '.response_format', 'values': ['url', 'b64_json'], 'default': 'url', 'userVisible': False},
    ],
    'parameters': [
        {'name': name, 'type': kind, 'required': required, 'mapping': mapping, 'description': description}
        for name, kind, required, mapping, description in [
            ('model', 'string', True, 'model', '仅 doubao-seedream-5-0-pro，不使用方舟或可美模型别名。'),
            ('prompt', 'string', True, 'prompt', '非空图片描述；32000 字符为宿主默认限制。'),
            ('aspectRatio', 'string', False, 'size', '默认 1:1，八种推荐比例或自定义 WIDTHxHEIGHT。'),
            ('imageCount', 'integer', False, 'n', '固定 1 张。'),
            ('images', 'media[]', False, 'images', '最多 10 张 HTTPS 参考图，按 order 排序；不支持 mask。'),
            ('providerOptions', 'object', False, 'providerOptions.' + provider_id, 'output_format 默认 jpeg；response_format 默认 url。'),
        ]
    ],
    'validations': [{'assert': condition, 'message': message} for condition, message in validations],
    'create': {
        'method': 'POST', 'path': '/v1/images/generations', 'pathTemplate': endpoint, 'contentType': 'application/json',
        'body': {
            'model': ref('request.model'), 'prompt': ref('request.prompt'), 'n': 1, 'size': size,
            'images': {'$if': {'condition': has_images, 'then': {'$map': {'from': {'$sortByOrder': images}, 'as': 'media', 'in': ref('media.value')}}, 'else': None}},
            'async': True, 'response_format': option('response_format', 'url'), 'output_format': option('output_format', 'jpeg'),
        },
    },
    'poll': {'method': 'GET', 'path': '/v1/images/generations/{{taskId}}', 'pathTemplate': {'$concat': [endpoint, '/', ref('taskId')]}},
    'response': {
        'taskIdPaths': ['id', 'task_id'], 'statusPaths': ['status'], 'errorPaths': ['error.code'], 'messagePaths': ['error.message', 'message'],
        'images': ref('response.data'), 'usage': ref('response.usage'),
    },
}
manifest = {
    'apiVersion': 'yingce.plugin/v2', 'id': 'cangyuan-seedream', 'name': '沧元 Seedream 5.0 Pro', 'version': '1.0.0',
    'author': '沧元算力 / 影绘', 'description': '沧元 Seedream Pro 异步文生图与多参考图编辑协议。',
    'enabled': True, 'installable': True, 'permissions': ['generation.run', 'media.read'],
    'configuration': {'fields': [{'name': 'apiKey', 'type': 'secret', 'label': 'API Key', 'required': True}]},
    'contributes': {'providers': [provider]},
}
interface = (root / 'docs/interface-base.md').read_text(encoding='utf-8').strip()
contract = copy.deepcopy(manifest)
contract['documentation'] = '<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>'
interface += '\n\n<!-- YINGCE_MANIFEST_CONTRACT_START -->\n## Manifest 完整接口定义\n\n```json\n' + json.dumps(contract, ensure_ascii=False, indent=2) + '\n```\n<!-- YINGCE_MANIFEST_CONTRACT_END -->\n'
(root / 'docs/interface.md').write_text(interface, encoding='utf-8', newline='\n')
manifest['documentation'] = (root / 'README.md').read_text(encoding='utf-8').strip() + '\n\n---\n\n' + interface.strip()
(root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
with zipfile.ZipFile(root.parent / 'cangyuan-seedream.yingce-plugin', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['manifest.json', 'README.md', 'docs/interface.md']:
        info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes())
