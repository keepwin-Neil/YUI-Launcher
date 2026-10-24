# YUI Console Launcher · 摄像头版

为 Project N.E.K.O 制作的非官方 Electron 启动器，保存本地使用的摄像头模块版本。
包含数字生命控制台、CONNECT 启动流程、全屏展示、会话计时器，以及实时视觉 HUD。

## 摄像头模块

- Electron 统一采集摄像头画面，将缩小后的 JPEG 帧发送到本机 Python 服务。
- OpenSeeFace 提供人脸与头部姿态追踪；MediaPipe 提供身体姿态与手势识别。
- 点击 CONNECT 后才加载视觉模型并申请摄像头权限。
- 支持开启/关闭摄像头、单独隐藏/显示预览，以及 AI Scan 控件。
- 隐藏预览时视觉识别仍可运行；关闭摄像头会停止采集与识别。
- Python 视觉服务仅监听 `127.0.0.1:48913`，在内存中处理画面，不保存摄像头帧。
- AI Scan 交互通过配置的 N.E.K.O 后端处理；其 AI 服务与数据传输方式取决于后端配置。

## 仓库内容

```text
main.js                         Electron 主进程与启动界面
preload.js                      页面覆盖层、摄像头采集与视觉 HUD
vision_service/service.py       本地人脸、姿态、手势分析服务
vision_service/requirements.txt  独立视觉环境的 Python 依赖
build/                          应用图标
scripts/verify-release.sh       发布包内容检查
.github/workflows/              macOS 构建工作流
```

仓库不包含 N.E.K.O 后端、Python 虚拟环境、视觉模型权重、角色模型、对话记忆、
个人配置或 API 密钥。摄像头服务源码和依赖清单会随启动器安装包分发。

## 运行要求

- macOS、Node.js 与 npm。
- 已安装并配置好的 Project N.E.K.O 后端，包含 `app.memory_server`、
  `app.main_server` 和可用的 `.venv/bin/python`。
- Python 3.11 的独立视觉环境，默认位于 N.E.K.O 根目录的 `.venv-vision/`。
- 在 N.E.K.O 根目录准备下列视觉资源：

```text
third_party/OpenSeeFace/                         OpenSeeFace 源码及其 models/
assets/models/vision/mediapipe/pose_landmarker_full.task
assets/models/vision/mediapipe/gesture_recognizer.task
```

此快照使用 OpenSeeFace + MediaPipe 的本地视觉管线；只安装普通 N.E.K.O
后端不足以启用摄像头分析。模型文件需要自行准备，启动器不会自动下载。

## 本地启动

在启动器目录安装 Node 依赖：

```bash
npm ci
npm run check
```

为视觉服务创建独立环境，把示例中的路径替换成你的实际路径：

```bash
python3.11 -m venv /path/to/N.E.K.O/.venv-vision
/path/to/N.E.K.O/.venv-vision/bin/python -m pip install -r vision_service/requirements.txt
```

然后启动：

```bash
NEKO_PROJECT_DIR="/path/to/N.E.K.O" npm start
```

可指定已有的视觉 Python 环境：

```bash
NEKO_PROJECT_DIR="/path/to/N.E.K.O" \
NEKO_VISION_PYTHON="/path/to/vision-env/bin/python" \
npm start
```

未设置 `NEKO_PROJECT_DIR` 时，默认使用 `~/Projects/N.E.K.O`。
这个摄像头快照沿用本地开发版的路径配置，不包含旧发布版的目录选择窗口。

N.E.K.O 主服务、记忆服务和视觉服务分别使用 `127.0.0.1:48911`、
`127.0.0.1:48912` 和 `127.0.0.1:48913`；已运行的服务会被复用。

## 构建 macOS 应用

```bash
npm run check
npm run build:mac
npm run verify:release
```

生成 Apple Silicon 和 Intel 的 DMG/ZIP：

```bash
npm run build:release
npm run verify:release
```

产物位于 `dist/`，需要单独配置上面的 N.E.K.O 后端、视觉环境和模型。
当前构建未配置 Apple 开发者签名或公证。

## 本地数据

此摄像头快照保留开发版的 `N.E.K.O` 应用名称及 Electron 会话数据行为。
服务日志保存在 `~/Library/Logs/N.E.K.O/`，上游后端仍使用自己的数据目录。
`.gitignore` 排除了虚拟环境、缓存、构建产物、密钥和常见个人运行数据。

## 许可证与归属

启动器原创代码使用 [MIT License](LICENSE)。N.E.K.O、OpenSeeFace、
MediaPipe 及其模型属于各自项目；详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
本启动器为非官方项目。MIT 许可证不授予第三方角色、标志、字体或模型的使用权。
