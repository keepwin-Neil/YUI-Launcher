# YUI Console Launcher

一个为 [Project N.E.K.O](https://github.com/Project-N-E-K-O/N.E.K.O)
制作的非官方 Electron 启动器。它提供自定义的数字生命控制台启动界面、
全屏展示、CONNECT 加载流程，以及两分钟可暂停的会话计时器。

> [!IMPORTANT]
> 本项目目前不是 Project N.E.K.O 官方发行版，也不代表原项目团队。
> 在获得原作者明确同意前，请使用 “unofficial / 非官方” 标识发布，
> 不要把仓库或安装包描述成联合发布。

## 这个仓库包含什么

- Electron 启动器源码：`main.js`、`preload.js`
- 自定义启动 UI 和 N.E.K.O 页面覆盖层
- macOS 构建配置与 GitHub Actions 工作流
- 发布包隐私检查脚本

这个仓库和安装包**不包含**：

- Project N.E.K.O 的 Python 源码或虚拟环境
- 角色模型、人物图片、语音或其他第三方素材
- 用户对话、模型记忆、API Key、Token 统计或个人配置
- Steam 凭据或 Steam 连接代码

## 使用要求

- macOS
- 已单独下载的 Project N.E.K.O 源码
- Python 3.11 和 `uv`
- 已在 N.E.K.O 根目录运行 `uv sync`，并生成可用的 `.venv`

首次启动时，启动器会优先检查 `NEKO_PROJECT_DIR`、上次选择的目录和几个
常见开发目录。找不到时会弹出文件夹选择窗口。请选择同时包含
`pyproject.toml`、`app/` 和 `.venv/` 的 N.E.K.O 根目录。

启动器只会在自己的设置中保存这个目录路径，不会复制 N.E.K.O 的模型记忆。

## 本地运行

```bash
npm ci
npm start
```

也可以临时指定上游目录：

```bash
NEKO_PROJECT_DIR="/path/to/N.E.K.O" npm start
```

如果上游服务已经在 `127.0.0.1:48911` 和 `127.0.0.1:48912` 运行，
启动器会直接复用它们。

## 构建 macOS Beta

检查源码：

```bash
npm run audit:runtime
npm run check
```

构建 Apple Silicon 测试应用：

```bash
npm run build:mac
```

构建 ARM64 与 Intel 的 DMG/ZIP：

```bash
npm run build:release
npm run verify:release
```

产物位于 `dist/`。当前 Beta 故意不配置开发者签名和 Apple 公证，
下载者第一次打开时可能需要在“系统设置 → 隐私与安全性”中确认。
正式公开分发前，建议配置你自己的 Developer ID、签名和公证。
