#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  print '未找到 Python 3。可以直接用浏览器打开同文件夹内的 ExcelBomb.html。'
  read '?按回车退出…'
  exit 1
fi
if ! python3 site/scripts/local_server.py; then
  read '?启动失败，按回车退出…'
  exit 1
fi
