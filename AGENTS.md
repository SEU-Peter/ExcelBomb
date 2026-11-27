# ExcelBomb 项目约定

- 用户于 2026-11-27 明确授权将仓库更名为 `SEU-Peter/ExcelBomb`、设为公开并部署 GitHub Pages。本次指令更新此前“仅本地”的限制，同时继续保留本地服务和离线版。
- 功能源码维护在 `site/dist/`，同步本机服务和根目录的 `ExcelBomb.html` 离线文件；GitHub Pages 通过 `.github/workflows/deploy-pages.yml` 发布同一份静态网页。
- 本机服务固定绑定 `127.0.0.1:8769`，在 `site/` 下执行 `npm start`。
- 修改页面后执行 `npm run build:offline` 同步离线文件，并进行与改动相称的检查。
- 已授权向公开仓库 `SEU-Peter/ExcelBomb` 推送开发代码并部署 GitHub Pages；不代表授权创建其他托管平台上的站点。
- 现有 `.openai/hosting.json` 和站点发布记录仅为历史配置，不代表继续线上部署的授权。
- 仓库曾误名为 `ExcekBomb`，现名为 `ExcelBomb`。用户此前授权的 macOS / Win7 Release 分发继续保留。根目录 Git 为开发仓库，历史站点 Git 已移到不提交的 `.local-backups/`。
- `test/` 中是供用户手动体验功能的测试表格，后续修改须保留。
- Lookup 未匹配的返回单元格必须保留为空，不默认填入“未匹配”等文字。
- 拆表导出按“名称-条目数.xlsx”命名，例如“一室-23.xlsx”；重命名、合并和文件名冲突处理后，页面预览必须与 ZIP 实际文件名一致。
- `dist/worker.js` 由 `scripts/build-worker.mjs` 生成。处理逻辑改动后运行 `npm run build:offline`，同步后台 Worker 与离线 HTML，并测试两种入口。
- 用户要求独立 Win7 版本，保留当前 Mac 版。Win7 源码与构建放在 `site/win7/`，交付包放在 `releases/`；禁止使用新 Go/Python/Node 运行时假充 Win7 兼容程序。
- Win7 启动器必须固定 Go 1.20.14、CGO=0，分别生成 x86/x64；网页必须检查 ES5 语法、IE11 文件读取和保存分支、弹窗/折叠区、无后台线程降级与旧布局。明确区分模拟、静态检查和 Win7 真机验证。
- Win7 一键安装器本身必须为 x86，内嵌 asInvoker 清单；默认安装当前用户目录、创建桌面入口并启用登录后后台自启，不弹网页。保留自启开关、卸载、免安装入口和 x86 专用包；安装不得依赖 PowerShell、VBScript 或目标电脑额外运行时。
- Win7 包解压后顶层仅保留 `00-Start-Here.html` 中文图文说明、`01-Install-ExcelBomb.exe` 唯一安装程序和 `Support/` 辅助目录；安装器查找新布局资源时需兼容旧布局。ZIP 内文件名保持 ASCII，避免旧系统解压乱码。
- 用户要求：仅在后续明确要求“打包”或“生成 Release”时才生成安装包和 Release；日常优化仅修改与验证本地代码，不自动打包、打标签或发布 Release。
- Excel 容量判断必须按实际非空行和有效列执行，不能直接根据 `!ref` 判断或遍历整张声明范围；忽略空行、外围空白列及纯格式单元格，同时保留原始行号、零、false 和有效数据。
- 拆分分组全部连续展示，不分页；数据预览使用全宽布局并支持展开核对。
