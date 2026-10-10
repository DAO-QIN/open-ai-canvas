"""Synchronize readable documentation and build a deterministic plugin package."""
import json
import copy
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
manifest.pop('documentation', None)
manifest['contributes']['providers'][0].pop('documentation', None)
documentation = (root / 'docs/interface.md').read_text(encoding='utf-8').split('<!-- YINGCE_MANIFEST_CONTRACT_START -->')[0].rstrip() + '\n\n'
documented = copy.deepcopy(manifest)
documented['documentation'] = '<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>'
documentation += '<!-- YINGCE_MANIFEST_CONTRACT_START -->\n## Manifest 完整接口定义\n\n```json\n' + json.dumps(documented, ensure_ascii=False, indent=2) + '\n```\n<!-- YINGCE_MANIFEST_CONTRACT_END -->\n'
(root / 'docs/interface.md').write_text(documentation, encoding='utf-8', newline='\n')
manifest['documentation'] = (root / 'README.md').read_text(encoding='utf-8').strip() + '\n\n---\n\n' + documentation.strip()
(root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
target = root.parent / 'kacang-audio.yingce-plugin'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in ['manifest.json', 'README.md', 'docs/interface.md']:
        info = zipfile.ZipInfo(name, (2026, 10, 10, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes())
print(target.name)
