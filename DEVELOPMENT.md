# 开发、测试与打包

本仓库只维护本地运行的软件。GitHub 用于开发源码和 Release 分发，不启用 Pages，也不部署在线处理服务。

## 目录

```text
ExcelBomb.html                生成的现代浏览器离线版
启动 ExcelBomb.command        macOS 本地启动入口
site/dist/                   现代版网页、核心逻辑和随包资源
site/src/worker-runtime.js    后台任务入口
site/scripts/                Worker、离线 HTML 构建和本地服务
site/tests/                  核心与浏览器测试
site/win7/                   ES5 / IE11 适配、构建和测试
site/win7/launcher/           Go 原生本地启动器
scripts/package-macos.py     macOS 使用包构建
test/                        7 份虚构测试表格
docs/releases/               发布说明
releases/                    本地构建产物，不提交 Git
```

## 本地运行与修改

开发使用 Node.js 18 或更新版本；本地 HTTP 服务使用 Python 3。最终用户打开现代版离线 HTML 不需要安装这些开发工具。

```sh
git clone https://github.com/SEU-Peter/ExcekBomb.git
cd ExcekBomb
python3 site/scripts/local_server.py --serve
```

打开 `http://127.0.0.1:8769/`。修改 `site/dist/` 后，同步后台 Worker 和根目录离线文件：

```sh
cd site
npm run build:offline
npm test
```

`dist/worker.js` 从 `dist/core.js` 和 `src/worker-runtime.js` 生成，勿单独修改生成内容。现代版运行库已随源码附带，构建上述离线文件无需 `npm install`。

## 浏览器测试

在 `site/` 下安装可选测试依赖并准备 Chromium：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser.test.mjs
```

先在另一个终端启动本地服务。测试会生成临时表格并回读实际下载的 XLSX / ZIP，覆盖拆表文件名、分组合并和撤销、顺序合表、Lookup 空白与重复记录、格式保护、替换确认、分页、响应式布局和后台处理。

`PLAYWRIGHT_MODULE` 可指定现有 Playwright 模块入口，`BROWSER_EXECUTABLE` 可指定浏览器可执行文件。`EXCELBOMB_TEST_URL` 默认指向本机服务，也可设为离线入口的 `file:///绝对路径/ExcelBomb.html`；文件入口会在断网的浏览器上下文中测试。

## macOS 使用包

在仓库根目录执行：

```sh
python3 scripts/package-macos.py
```

脚本先同步离线 HTML，再打包启动脚本、本地服务、全部网页资源、离线 HTML、虚构测试表格和中文说明，保留 `.command` 执行权限。输出 `releases/ExcelBomb-macOS-1.1.0.zip` 及对应 `.sha256`；使用包不含 Node/Python 运行时。

## Win7 使用包

构建需要 Node.js、`site/win7/package-lock.json` 锁定的开发依赖，以及**精确版本 Go 1.20.14**。开发工具不在目标 Win7 电脑上运行。

```sh
cd site/win7
npm ci
node package.mjs /绝对路径/go1.20.14/bin/go
```

脚本生成 ES5 网页并检查语法，关闭 CGO，分别交叉构建 x86（softfloat）和 x64 启动器，核对 PE 架构、Windows GUI 6.1 子系统及静态导入。输出 `releases/ExcelBomb-Win7-1.1.0.zip`、对应 `.sha256` 和解压目录，附构建检查信息、第三方许可证与测试数据。

只重建兼容网页可执行 `node build.mjs`。生成目录 `launcher/web/` 不提交；直接编译 Go 前必须先完成网页构建。

Go 测试在 `site/win7/launcher/` 下执行（先构建网页）：

```sh
CGO_ENABLED=0 /绝对路径/go1.20.14/bin/go test ./...
```

浏览器兼容测试仍使用 `site/tests/browser.test.mjs`，设置：

- `EXCELBOMB_TEST_URL`：兼容 HTML 的 `file:///.../site/win7/launcher/web/index.html`，或已启动的 Win7 本地服务地址。
- `EXCELBOMB_LEGACY_PROFILE=1`：模拟旧浏览器接口缺失，并检查 FileReader、无 Worker 和 IE 保存分支。

`node site/win7/adapters.test.mjs` 检查 HTTP Worker、线程失败降级、两个 IE 保存接口、弹窗、ZIP 上限和不支持浏览器提示。它需要先运行兼容版服务；默认测试地址为 `http://127.0.0.1:18769/`，可通过 `EXCELBOMB_WIN7_TEST_URL` 覆盖。macOS 开发机可在 `launcher/` 中以 Go 1.20.14 编译宿主启动器，再使用 `--addr 127.0.0.1:18769 --no-browser` 启动，避免与日常 8769 服务冲突。

这些检查区分构建、静态检查、现代浏览器内的接口模拟与目标机器测试。当前没有真实 Win7 / IE11 验证记录，发布说明须保留这一限制。

## 发布

保持两平台版本一致，核对两个 ZIP、许可证、测试文件和 SHA-256，按 [发布说明](docs/releases/v1.1.0.md) 更新说明。将平台 ZIP 与 `SHA256SUMS.txt` 上传到同一 Release；不要把 `node_modules`、历史站点配置、运行日志、实际业务数据或凭据提交到仓库。构建产物留在 `releases/`，开发源码通过 Git 管理。
