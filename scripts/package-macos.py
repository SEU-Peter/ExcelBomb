#!/usr/bin/env python3
"""Build a local-only macOS distribution, preserving launcher permissions."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'site/package.json').read_text())['version']


def main():
    subprocess.run(['node', str(ROOT / 'site/scripts/build-offline.mjs')], check=True)
    output = ROOT / 'releases'
    output.mkdir(exist_ok=True)
    archive = output / ('ExcelBomb-macOS-' + VERSION + '.zip')
    with tempfile.TemporaryDirectory(prefix='excelbomb-macos-') as temporary:
        bundle = Path(temporary) / 'ExcelBomb-macOS'
        (bundle / 'site/scripts').mkdir(parents=True)
        shutil.copytree(ROOT / 'site/dist', bundle / 'site/dist', ignore=shutil.ignore_patterns('.DS_Store'))
        shutil.copytree(ROOT / 'test', bundle / 'test', ignore=shutil.ignore_patterns('.DS_Store'))
        shutil.copy2(ROOT / 'site/scripts/local_server.py', bundle / 'site/scripts/local_server.py')
        for name in ['ExcelBomb.html', '启动 ExcelBomb.command']:
            shutil.copy2(ROOT / name, bundle / name)
        (bundle / '启动 ExcelBomb.command').chmod(0o755)
        (bundle / 'README.txt').write_text(
            'ExcelBomb macOS 本地/离线版 ' + VERSION + '\n'
            '© 2026 万晔 · 版权所有\n\n'
            '1. 完整解压 ZIP，不要直接在压缩包内运行。\n'
            '2. 双击“启动 ExcelBomb.command”，使用 Python 3 启动本地服务并打开浏览器。\n'
            '3. 未安装 Python 3 时，直接用现代浏览器打开 ExcelBomb.html，无需安装运行时。\n'
            '4. 本地服务地址为 http://127.0.0.1:8769/，只监听本机；关闭页面不会停止服务。\n'
            '5. 所有脚本、字体、处理库均已随包提供。文件只在浏览器内处理，不上传。\n'
            '6. 本包是网页与启动脚本的组合，不是签名 .app；不需要 Office。\n\n'
            '功能：拆表（重命名、合并分组、名称-条目数.xlsx）、拖动排序合表、Lookup。\n'
            'Lookup 未匹配单元格留空；支持搜索、分页、重复值查看、编号保护和图文说明。\n'
            '建议先用 test 文件夹中的虚构数据核对；页面右上角“使用说明”有分步骤操作。\n\n'
            '单文件最多 30 MB，每张输入表最多 20 万行、1000 列、500 万个单元格。\n'
            '支持 XLSX/XLS/CSV，统一导出 XLSX；保留数据值及数字、日期格式。\n'
            '不保留宏、图表、合并单元格和其他原样式；公式依赖输入文件已有的缓存结果。\n'
            '数据在内存中，刷新或关闭页面即清空，请及时下载结果。\n\n'
            '第三方许可证位于 site/dist/vendor/licenses。\n'
            '源码与发布说明：https://github.com/SEU-Peter/ExcekBomb\n', encoding='utf-8')
        manifest = {
            'version': VERSION,
            'platform': 'macOS-local-web',
            'requiresPythonForLauncher': True,
            'offlineHtmlRequiresPython': False,
            'files': {
                str(file.relative_to(bundle)): hashlib.sha256(file.read_bytes()).hexdigest()
                for file in sorted(bundle.rglob('*')) if file.is_file()
            },
        }
        (bundle / 'build-info.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zipper:
            for file in sorted(bundle.rglob('*')):
                if file.is_file():
                    zipper.write(file, file.relative_to(bundle.parent))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(archive.suffix + '.sha256').write_text(digest + '  ' + archive.name + '\n', encoding='ascii')
    print(str(archive))
    print('SHA256: ' + digest)


if __name__ == '__main__':
    main()
