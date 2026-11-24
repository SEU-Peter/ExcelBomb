# ExcelBomb

浏览器本地 Excel 工作台：拆表、合表、Lookup。无需后端，处理文件不发送网络请求。

## 运行

本项目仅在本地部署和运行，后续不再发布或更新线上版本。

在此目录执行 `npm start`，访问 http://127.0.0.1:8769 。服务只绑定本机地址。所有脚本、字体均已随站点打包。

macOS 可直接双击项目根目录的 `启动 ExcelBomb.command`。启动器复用已有的本机服务，服务未运行时会启动并打开浏览器。重复双击不会重复启动服务，也不会打开占用同一端口的其他程序。启动器需要 Python 3；未安装时可使用下述离线 HTML。

也可执行 `npm run build:offline`，在上一级目录生成自包含的 `ExcelBomb.html`。双击即可在浏览器运行，无需服务器和网络连接。离线版与网页版使用同一份功能代码。可以用 `EXCELBOMB_TEST_URL=file:///绝对路径/ExcelBomb.html` 运行同一套浏览器端到端检查。

## 功能

- 拆表：选择工作表和表头行，提取字段，按单个字段分组；支持分组搜索、分页、查看数据、改名、合并及撤销。按 `名称-条目数.xlsx` 打包下载，清理特殊字符、处理重名后的最终文件名会提前显示。
- 合表：多文件上传，每个文件指定一张工作表和表头行；拖拽或按钮排序；按表头名称对齐列，合并预览并导出。
- Lookup：选择两张表及匹配列，支持多个返回字段、重复值处理、空格及大小写设置。未匹配单元格始终保留为空。点击统计可筛选已匹配、未匹配记录；支持查看和单独导出未匹配、重复记录，暂停匹配时也可核对重复值。

数据预览支持搜索全部数据及 25/50/100 行分页。加载真实文件后点击“试试示例”或替换文件会先确认，有未下载的修改时刷新或离开页面会收到浏览器提醒。计算与导出在本地 Web Worker 中执行，显示阶段和 ZIP 打包进度，不向外部服务发送文件。

支持 XLSX、XLS、CSV，统一导出 XLSX。单文件 30 MB，输入工作表最多 20 万行、1000 列，读取范围总计最多 500 万个单元格（含范围内空白）。数据保存在内存，刷新或关闭即清空。默认把 `00001` 这类使用补零数字格式的编号转为显示文本，可在源文件下取消；普通金额仍保留为数值，数字及日期时间格式随导出保留。其他源样式、宏、图表、合并单元格不保留；公式依赖文件已有的缓存值。CSV 编码由 SheetJS 自动识别，旧编码文件可先用 Excel 另存 XLSX。

## 检查

`npm test` 覆盖实际 XLSX 读写、表头、拆分及重新组合、列对齐合并、重复与空白匹配值、文件名冲突。

修改 `dist/core.js` 或 `src/worker-runtime.js` 后执行 `npm run build:worker`，或者直接执行 `npm run build:offline`（同时生成 Worker 和离线 HTML）。

浏览器端到端检查：安装 Playwright 并准备其 Chromium 后，先启动本地服务，再执行 `node tests/browser.test.mjs`。也可通过 `PLAYWRIGHT_MODULE` 指定包入口，通过 `BROWSER_EXECUTABLE` 指定现有 Chromium。测试使用临时生成的文件，并核对实际下载内容。

## Win7 独立兼容包

Win7 版本由 `win7/build.mjs` 从现有功能代码生成，使用 ES5、IE11 DOM/保存兼容层、传统布局和后台线程降级路径，Mac 页面保持原样。Win7 的限制为单文件 10 MB、总加载 20 MB、单表 5 万行/200 列/50 万单元格、单个 ZIP 最多 500 个文件。

开发时在 `win7/` 执行 `npm ci`，再执行 `node package.mjs /绝对路径/go1.20.14/bin/go`。必须使用 Go 1.20.14、CGO=0，构建脚本会核对工具链、两种 PE 架构和 Windows 7 的 6.1 子系统版本，并拒绝常见的新系统静态导入。输出在根目录 `releases/`，包含启动、关闭、诊断入口、离线 HTML、虚构测试表格和许可证。

Win7 1.1.1 增加原生 x86 一键安装器：安装到当前用户目录、创建桌面入口、默认登录后后台自启，并提供关闭自启和卸载入口。使用包分为 x86 专用与 32/64 位通用，清单明确 `asInvoker`，无需管理员权限或脚本运行库。完整操作、原生 API 和构建说明见根目录 README 与 DEVELOPMENT.md。自启注册表和 Shell 快捷方式仍需真实 Windows 机器验收。

`EXCELBOMB_LEGACY_PROFILE=1` 可对同一套浏览器测试启用接口缺失模拟；`win7/adapters.test.mjs` 检查 IE 保存、弹窗、无线程及线程失败恢复等路径。这些是在现代浏览器内执行的适配测试，不能替代真实 Win7/IE11 验证。

## 第三方资源

- SheetJS CE 0.20.3（Apache-2.0），[官方文档](https://docs.sheetjs.com/)
- JSZip 3.10.1（MIT），[项目](https://github.com/Stuk/jszip)
- Pacifico / DM Sans 字体（SIL Open Font License），[Google Fonts](https://fonts.google.com/)
