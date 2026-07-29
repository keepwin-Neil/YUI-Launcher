'use strict';

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
} = require('electron');

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const LAUNCHER_NAME = 'YUI Console Launcher';
const LAUNCHER_DATA_DIR = path.join(
  app.getPath('appData'),
  LAUNCHER_NAME
);
const SESSION_DATA_DIR = path.join(
  LAUNCHER_DATA_DIR,
  'Session'
);
const LOG_DIR = path.join(
  LAUNCHER_DATA_DIR,
  'logs'
);
const SETTINGS_PATH = path.join(
  LAUNCHER_DATA_DIR,
  'launcher-settings.json'
);

/**
 * 使用独立目录保存启动器状态，避免和上游 N.E.K.O 的模型记忆、
 * 配置、缓存与日志混在一起。
 */
fs.mkdirSync(SESSION_DATA_DIR, {
  recursive: true,
});
fs.mkdirSync(LOG_DIR, {
  recursive: true,
});

app.setName(LAUNCHER_NAME);
app.setPath('userData', LAUNCHER_DATA_DIR);
app.setPath('sessionData', SESSION_DATA_DIR);
app.setAppLogsPath(LOG_DIR);

const PRELOAD_PATH = path.join(
  __dirname,
  'preload.js'
);

/* ============================================================
 * 基本配置
 * ============================================================
 */

let projectDir = null;
let pythonPath = null;

const MEMORY_URL = 'http://127.0.0.1:48912/health';
const MAIN_URL = 'http://127.0.0.1:48911/';

const MEMORY_START_TIMEOUT_MS = 45_000;
const MAIN_START_TIMEOUT_MS = 90_000;
const HTTP_CHECK_TIMEOUT_MS = 1_500;

let mainWindow = null;
let loadingPagePromise = null;
let isQuitting = false;
let resetInProgress = false;

/**
 * 只记录由当前 Electron 应用启动的 Python 服务。
 *
 * 已经由用户手动启动的服务不会加入这里，
 * 因此退出应用时不会误杀用户原来运行的服务。
 */
const startedProcesses = new Map();

/* ============================================================
 * 通用工具
 * ============================================================
 */

/**
 * 暂停指定时间。
 *
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * 转义 HTML，防止错误信息破坏错误页面。
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * 判断 URL 是否为 N.E.K.O 主服务器页面。
 *
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isNekoUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    return (
      parsed.protocol === 'http:' &&
      parsed.hostname === '127.0.0.1' &&
      parsed.port === '48911'
    );
  } catch {
    return false;
  }
}

/**
 * 判断 URL 是否是应用自己生成的内部页面。
 *
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isInternalPage(rawUrl) {
  return (
    isNekoUrl(rawUrl) ||
    String(rawUrl || '').startsWith('data:text/html')
  );
}

/**
 * 只允许安全的外部协议交给系统打开。
 *
 * @param {string} rawUrl
 */
function openExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const allowedProtocols = new Set([
      'http:',
      'https:',
      'mailto:',
    ]);

    if (!allowedProtocols.has(parsed.protocol)) {
      console.warn(
        '[Electron] 已阻止未知外部协议：',
        parsed.protocol
      );
      return;
    }

    void shell.openExternal(rawUrl);
  } catch (error) {
    console.warn(
      '[Electron] 无法打开外部链接：',
      rawUrl,
      error
    );
  }
}

/* ============================================================
 * HTTP 服务检查
 * ============================================================
 */

/**
 * 检查一个本地 HTTP 地址能否访问。
 *
 * 2xx、3xx、4xx 都表示服务器已经响应；
 * 5xx 或网络错误表示服务尚未准备好。
 *
 * @param {string} targetUrl
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function checkUrl(
  targetUrl,
  timeoutMs = HTTP_CHECK_TIMEOUT_MS
) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    let request;

    try {
      request = http.get(targetUrl, (response) => {
        response.resume();

        const statusCode = response.statusCode || 0;

        finish(
          statusCode >= 200 &&
          statusCode < 500
        );
      });
    } catch {
      finish(false);
      return;
    }

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      finish(false);
    });

    request.once('error', () => {
      finish(false);
    });
  });
}

/**
 * 循环等待某个服务启动。
 *
 * @param {string} targetUrl
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForUrl(targetUrl, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkUrl(targetUrl)) {
      return true;
    }

    await sleep(300);
  }

  return false;
}

/* ============================================================
 * Python 后端管理
 * ============================================================
 */

/**
 * 展开用户输入中的波浪号并规范化路径。
 *
 * @param {unknown} candidate
 * @returns {string}
 */
function normalizeProjectPath(candidate) {
  if (
    typeof candidate !== 'string' ||
    !candidate.trim()
  ) {
    return '';
  }

  const trimmed = candidate.trim();
  const expanded = trimmed === '~'
    ? os.homedir()
    : trimmed.startsWith(`~${path.sep}`)
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;

  return path.resolve(expanded);
}

/**
 * 返回当前平台虚拟环境中的 Python 路径。
 *
 * @param {string} candidateProjectDir
 * @returns {string}
 */
function getVirtualEnvironmentPython(
  candidateProjectDir
) {
  return process.platform === 'win32'
    ? path.join(
      candidateProjectDir,
      '.venv',
      'Scripts',
      'python.exe'
    )
    : path.join(
      candidateProjectDir,
      '.venv',
      'bin',
      'python'
    );
}

/**
 * 只读取启动器自己的设置文件。
 *
 * @returns {{nekoProjectDir?: string}}
 */
function readLauncherSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      return {};
    }

    const parsed = JSON.parse(
      fs.readFileSync(SETTINGS_PATH, 'utf8')
    );

    return (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    )
      ? parsed
      : {};
  } catch (error) {
    console.warn(
      '[Electron] 无法读取启动器设置，将重新选择项目：',
      error
    );
    return {};
  }
}

/**
 * 只保存用户选择的上游源码目录，不复制任何 N.E.K.O 记忆或配置。
 *
 * @param {string} selectedProjectDir
 */
function saveProjectSelection(selectedProjectDir) {
  fs.mkdirSync(LAUNCHER_DATA_DIR, {
    recursive: true,
  });

  fs.writeFileSync(
    SETTINGS_PATH,
    `${JSON.stringify({
      nekoProjectDir: selectedProjectDir,
    }, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );
}

/**
 * 检查候选目录是不是可运行的 N.E.K.O 源码目录。
 *
 * @param {unknown} candidate
 * @returns {{
 *   valid: boolean,
 *   projectDir: string,
 *   pythonPath: string,
 *   reason: string
 * }}
 */
function inspectBackendProject(candidate) {
  const candidateProjectDir =
    normalizeProjectPath(candidate);
  const candidatePythonPath =
    candidateProjectDir
      ? getVirtualEnvironmentPython(
        candidateProjectDir
      )
      : '';

  if (
    !candidateProjectDir ||
    !fs.existsSync(candidateProjectDir)
  ) {
    return {
      valid: false,
      projectDir: candidateProjectDir,
      pythonPath: candidatePythonPath,
      reason: '目录不存在。',
    };
  }

  try {
    if (!fs.statSync(candidateProjectDir).isDirectory()) {
      return {
        valid: false,
        projectDir: candidateProjectDir,
        pythonPath: candidatePythonPath,
        reason: '选择的路径不是文件夹。',
      };
    }
  } catch {
    return {
      valid: false,
      projectDir: candidateProjectDir,
      pythonPath: candidatePythonPath,
      reason: '无法读取该文件夹。',
    };
  }

  const requiredPaths = [
    path.join(candidateProjectDir, 'pyproject.toml'),
    path.join(
      candidateProjectDir,
      'app',
      'memory_server',
      '__main__.py'
    ),
    path.join(
      candidateProjectDir,
      'app',
      'main_server',
      '__main__.py'
    ),
  ];

  const missingProjectFile = requiredPaths.find(
    (requiredPath) => !fs.existsSync(requiredPath)
  );

  if (missingProjectFile) {
    return {
      valid: false,
      projectDir: candidateProjectDir,
      pythonPath: candidatePythonPath,
      reason:
        '这不是完整的 Project N.E.K.O 源码目录，' +
        `缺少 ${path.relative(
          candidateProjectDir,
          missingProjectFile
        )}。`,
    };
  }

  if (!fs.existsSync(candidatePythonPath)) {
    return {
      valid: false,
      projectDir: candidateProjectDir,
      pythonPath: candidatePythonPath,
      reason:
        '没有找到 .venv Python。请先按照上游 README ' +
        '完成依赖安装。',
    };
  }

  if (process.platform !== 'win32') {
    try {
      fs.accessSync(
        candidatePythonPath,
        fs.constants.X_OK
      );
    } catch {
      return {
        valid: false,
        projectDir: candidateProjectDir,
        pythonPath: candidatePythonPath,
        reason:
          '虚拟环境 Python 没有执行权限。可以运行：' +
          `chmod +x "${candidatePythonPath}"`,
      };
    }
  }

  return {
    valid: true,
    projectDir: candidateProjectDir,
    pythonPath: candidatePythonPath,
    reason: '',
  };
}

/**
 * 使用环境变量、上次选择或常见路径查找后端。
 *
 * 找不到时让用户选择，不把开发者电脑路径写进发布包。
 */
async function resolveBackendEnvironment() {
  const settings = readLauncherSettings();
  const candidates = [
    process.env.NEKO_PROJECT_DIR,
    settings.nekoProjectDir,
    path.join(os.homedir(), 'Projects', 'N.E.K.O'),
    path.join(os.homedir(), 'Documents', 'N.E.K.O'),
    path.join(os.homedir(), 'Developer', 'N.E.K.O'),
  ];
  const checkedPaths = new Set();

  for (const candidate of candidates) {
    const normalized = normalizeProjectPath(candidate);

    if (!normalized || checkedPaths.has(normalized)) {
      continue;
    }

    checkedPaths.add(normalized);

    const inspection = inspectBackendProject(normalized);

    if (inspection.valid) {
      projectDir = inspection.projectDir;
      pythonPath = inspection.pythonPath;
      saveProjectSelection(projectDir);
      return;
    }
  }

  while (true) {
    const selection = await dialog.showOpenDialog(
      mainWindow || undefined,
      {
        title: '选择 Project N.E.K.O 源码目录',
        message:
          '请选择包含 pyproject.toml、app 和 .venv 的 ' +
          'Project N.E.K.O 根目录。',
        buttonLabel: '选择此目录',
        properties: [
          'openDirectory',
        ],
      }
    );

    if (selection.canceled || !selection.filePaths[0]) {
      throw new Error(
        [
          '未选择 Project N.E.K.O 源码目录。',
          '',
          '这个启动器不会内置模型、记忆或 Python 后端。',
          '请先安装并配置上游项目，然后重新打开启动器。',
          '',
          '也可以在启动前设置 NEKO_PROJECT_DIR。',
        ].join('\n')
      );
    }

    const inspection = inspectBackendProject(
      selection.filePaths[0]
    );

    if (inspection.valid) {
      projectDir = inspection.projectDir;
      pythonPath = inspection.pythonPath;
      saveProjectSelection(projectDir);
      return;
    }

    const response = await dialog.showMessageBox(
      mainWindow || undefined,
      {
        type: 'warning',
        title: '无法使用这个目录',
        message: '请选择完整且已经配置好的 N.E.K.O 源码目录。',
        detail: [
          inspection.projectDir,
          inspection.reason,
        ].filter(Boolean).join('\n\n'),
        buttons: [
          '重新选择',
          '取消启动',
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }
    );

    if (response.response === 1) {
      throw new Error(
        '已取消选择 Project N.E.K.O 源码目录。'
      );
    }
  }
}

/**
 * 检查已经解析出的项目目录和 Python 环境。
 */
function validateBackendEnvironment() {
  const inspection = inspectBackendProject(projectDir);

  if (!inspection.valid) {
    throw new Error(
      [
        'Project N.E.K.O 后端环境不可用。',
        '',
        inspection.projectDir || '(尚未选择目录)',
        inspection.reason,
        '',
        '可以删除启动器设置后重新选择，或设置 ' +
          'NEKO_PROJECT_DIR。',
        `启动器设置：${SETTINGS_PATH}`,
      ].filter(Boolean).join('\n')
    );
  }

  projectDir = inspection.projectDir;
  pythonPath = inspection.pythonPath;
}

/**
 * 启动一个 Python 模块。
 *
 * @param {string} serviceName
 * @param {string} moduleName
 * @param {string} logFileName
 * @returns {import('node:child_process').ChildProcess}
 */
function startPythonService(
  serviceName,
  moduleName,
  logFileName
) {
  if (startedProcesses.has(serviceName)) {
    return startedProcesses.get(serviceName);
  }

  fs.mkdirSync(LOG_DIR, {
    recursive: true,
  });

  const logPath = path.join(
    LOG_DIR,
    logFileName
  );

  const logFileDescriptor = fs.openSync(
    logPath,
    'a'
  );

  console.log(
    `[Electron] 正在启动 ${serviceName}：${moduleName}`
  );

  const child = spawn(
    pythonPath,
    ['-m', moduleName],
    {
      cwd: projectDir,

      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },

      stdio: [
        'ignore',
        logFileDescriptor,
        logFileDescriptor,
      ],

      detached: false,
    }
  );

  startedProcesses.set(serviceName, child);

  child.once('spawn', () => {
    console.log(
      `[Electron] ${serviceName} 已创建，PID=${child.pid}`
    );
  });

  child.once('error', (error) => {
    console.error(
      `[Electron] ${serviceName} 启动失败：`,
      error
    );

    startedProcesses.delete(serviceName);

    try {
      fs.closeSync(logFileDescriptor);
    } catch {
      // 文件描述符可能已经关闭。
    }
  });

  child.once('exit', (code, signal) => {
    console.log(
      `[Electron] ${serviceName} 已退出，` +
      `code=${code}, signal=${signal}`
    );

    startedProcesses.delete(serviceName);

    try {
      fs.closeSync(logFileDescriptor);
    } catch {
      // 文件描述符可能已经关闭。
    }
  });

  return child;
}

/**
 * 确保 Memory Server 正常运行。
 */
async function ensureMemoryServer() {
  if (await checkUrl(MEMORY_URL)) {
    console.log(
      '[Electron] Memory Server 已经运行，直接复用。'
    );
    return;
  }

  startPythonService(
    'memory',
    'app.memory_server',
    'memory_server-electron.log'
  );

  const ready = await waitForUrl(
    MEMORY_URL,
    MEMORY_START_TIMEOUT_MS
  );

  if (!ready) {
    throw new Error(
      [
        'Memory Server 启动超时。',
        '',
        '日志位置：',
        path.join(
          LOG_DIR,
          'memory_server-electron.log'
        ),
      ].join('\n')
    );
  }

  console.log(
    '[Electron] Memory Server 已准备好。'
  );
}

/**
 * 确保 Main Server 正常运行。
 */
async function ensureMainServer() {
  if (await checkUrl(MAIN_URL)) {
    console.log(
      '[Electron] Main Server 已经运行，直接复用。'
    );
    return;
  }

  startPythonService(
    'main',
    'app.main_server',
    'main_server-electron.log'
  );

  const ready = await waitForUrl(
    MAIN_URL,
    MAIN_START_TIMEOUT_MS
  );

  if (!ready) {
    throw new Error(
      [
        'Main Server 启动超时。',
        '',
        '日志位置：',
        path.join(
          LOG_DIR,
          'main_server-electron.log'
        ),
      ].join('\n')
    );
  }

  console.log(
    '[Electron] Main Server 已准备好。'
  );
}

/**
 * 启动并检查两个必要服务。
 */
async function ensureBackend() {
  const [
    memoryAlreadyRunning,
    mainAlreadyRunning,
  ] = await Promise.all([
    checkUrl(MEMORY_URL),
    checkUrl(MAIN_URL),
  ]);

  if (
    !memoryAlreadyRunning ||
    !mainAlreadyRunning
  ) {
    await resolveBackendEnvironment();
    validateBackendEnvironment();
  }

  await ensureMemoryServer();
  await ensureMainServer();
}

/**
 * 停止当前 Electron 应用启动的服务。
 *
 * 用户自己在终端启动的已有服务不会受到影响。
 */
function stopStartedProcesses() {
  for (const [serviceName, child] of startedProcesses) {
    if (!child || child.killed) {
      continue;
    }

    console.log(
      `[Electron] 正在关闭 ${serviceName}，PID=${child.pid}`
    );

    try {
      child.kill('SIGTERM');
    } catch (error) {
      console.warn(
        `[Electron] 无法关闭 ${serviceName}：`,
        error
      );
    }
  }

  startedProcesses.clear();
}

/**
 * 重启整个 Electron 应用，并让当前实例启动的 Python 服务先退出。
 *
 * 用户数据不会被删除；这里只重置运行时状态，等同于完整退出后重新打开。
 */
async function resetApplication() {
  if (resetInProgress || isQuitting) {
    return {
      success: false,
      reason: 'reset_in_progress',
    };
  }

  resetInProgress = true;

  console.log(
    '[Electron] 2 分钟会话结束，正在重置整个应用。'
  );

  stopStartedProcesses();

  /**
   * 给 Python 服务一个很短的优雅退出窗口，避免新实例启动时仍占用端口。
   */
  await sleep(650);

  app.relaunch({
    args: process.argv.slice(1),
  });

  app.quit();

  return {
    success: true,
  };
}

/* ============================================================
 * 内部页面
 * ============================================================
 */

/**
 * 生成启动等待页面。
 *
 * @returns {string}
 */
function createLoadingHtml() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      style-src 'unsafe-inline';
      img-src data:;
      script-src 'unsafe-inline';
    "
  >

  <title>N.E.K.O / LOCAL SYNTHESIS</title>

  <style>
    :root {
      color-scheme: dark;
      --void: #020403;
      --surface: #070b09;
      --surface-soft: #0b110e;
      --line: rgba(174, 203, 190, 0.22);
      --line-strong: rgba(188, 218, 204, 0.48);
      --text: #ced9d4;
      --muted: #718079;
      --dim: #44514b;
      --mint: #a9c9ba;
      --mint-bright: #d8eee3;
      --cyan: #83d9e1;
      --amber: #d4b87a;
      --danger: #c9756e;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
    }

    body {
      overflow: hidden;
      background: var(--void);
      color: var(--text);
      font-family:
        "SFMono-Regular",
        "Roboto Mono",
        "IBM Plex Mono",
        Menlo,
        Consolas,
        monospace;
      font-size: 11px;
      letter-spacing: 0.025em;
      -webkit-user-select: none;
      user-select: none;
    }

    body::before {
      position: fixed;
      z-index: 100;
      inset: 0;
      content: "";
      pointer-events: none;
      background:
        repeating-linear-gradient(
          to bottom,
          rgba(255, 255, 255, 0.018) 0,
          rgba(255, 255, 255, 0.018) 1px,
          transparent 1px,
          transparent 4px
        ),
        radial-gradient(
          ellipse at center,
          transparent 55%,
          rgba(0, 0, 0, 0.34) 100%
        );
      mix-blend-mode: screen;
    }

    button {
      color: inherit;
      font: inherit;
    }

    [hidden] {
      display: none !important;
    }

    .boot-shell {
      display: grid;
      grid-template-rows:
        30px
        48px
        minmax(0, 1fr)
        172px
        24px;
      width: 100%;
      height: 100%;
      min-width: 900px;
      min-height: 620px;
      opacity: 0;
      filter: brightness(0.55);
      transform: scale(1.006);
      transition:
        opacity 420ms ease,
        filter 900ms ease,
        transform 900ms ease;
    }

    body.background-loaded .boot-shell {
      opacity: 1;
      filter: brightness(1);
      transform: none;
    }

    .menu-bar,
    .tool-bar,
    .status-bar {
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--line);
      background: #090c0a;
    }

    .menu-bar {
      gap: 26px;
      padding: 0 18px 0 82px;
      color: #9aa69f;
      font-size: 10px;
      -webkit-app-region: drag;
    }

    .menu-bar span,
    .tool-bar button {
      -webkit-app-region: no-drag;
    }

    .menu-bar .spacer {
      flex: 1;
    }

    .window-code {
      color: var(--dim);
      letter-spacing: 0.18em;
    }

    .tool-bar {
      gap: 8px;
      padding: 7px 12px;
      border-bottom-color: var(--line-strong);
      background:
        linear-gradient(
          180deg,
          #101612 0%,
          #080b09 100%
        );
    }

    .system-mark {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 210px;
      color: var(--mint);
      letter-spacing: 0.12em;
    }

    .system-mark svg {
      width: 22px;
      height: 22px;
      color: var(--mint-bright);
    }

    .toolbar-label {
      margin-right: 6px;
      color: #7c8982;
    }

    .toolbar-button {
      min-width: 104px;
      height: 30px;
      padding: 0 16px;
      border: 1px solid var(--line);
      background:
        linear-gradient(
          180deg,
          rgba(204, 224, 215, 0.08),
          rgba(204, 224, 215, 0.025)
        );
      color: #68766f;
      letter-spacing: 0.08em;
    }

    .toolbar-button.small {
      min-width: 82px;
      color: #6e7a74;
    }

    #connectAction {
      position: relative;
      overflow: hidden;
      border-color: rgba(169, 201, 186, 0.18);
      cursor: default;
      transition:
        color 220ms ease,
        border-color 220ms ease,
        background 220ms ease,
        box-shadow 220ms ease;
    }

    #connectAction::after {
      position: absolute;
      inset: 0;
      content: "";
      background:
        linear-gradient(
          105deg,
          transparent 15%,
          rgba(214, 239, 227, 0.18) 48%,
          transparent 80%
        );
      transform: translateX(-130%);
    }

    body[data-boot-state="ready"] #connectAction {
      border-color: var(--mint);
      background:
        linear-gradient(
          180deg,
          rgba(169, 201, 186, 0.24),
          rgba(169, 201, 186, 0.08)
        );
      box-shadow:
        0 0 0 1px rgba(169, 201, 186, 0.14),
        0 0 26px rgba(128, 208, 179, 0.18);
      color: var(--mint-bright);
      cursor: pointer;
      animation: ready-pulse 1.8s ease-in-out infinite;
    }

    body[data-boot-state="ready"] #connectAction::after {
      animation: connect-scan 2.4s ease-in-out infinite;
    }

    body[data-boot-state="connecting"] #connectAction {
      border-color: rgba(131, 217, 225, 0.46);
      color: var(--cyan);
    }

    .workbench {
      display: grid;
      grid-template-columns:
        clamp(205px, 19vw, 270px)
        minmax(0, 1fr)
        clamp(190px, 17vw, 242px);
      min-height: 0;
      background: #030504;
    }

    .panel {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      border-right: 1px solid var(--line);
      background: var(--surface);
    }

    .panel:last-child {
      border-right: 0;
    }

    .panel-heading {
      display: flex;
      align-items: center;
      height: 31px;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(190, 216, 203, 0.055);
      color: #adbab4;
      letter-spacing: 0.08em;
    }

    .panel-heading .heading-index {
      margin-left: auto;
      color: var(--dim);
      font-size: 9px;
    }

    .tree,
    .inspector {
      height: calc(100% - 31px);
      padding: 10px 8px 18px;
      overflow: hidden;
      color: #8c9992;
      line-height: 1.82;
    }

    .tree-row,
    .inspect-row {
      display: flex;
      align-items: center;
      min-width: 0;
      white-space: nowrap;
    }

    .tree-row.depth-1 {
      padding-left: 16px;
    }

    .tree-row.depth-2 {
      padding-left: 34px;
    }

    .tree-row.depth-3 {
      padding-left: 52px;
    }

    .twisty {
      width: 14px;
      color: #6f7b75;
    }

    .folder {
      width: 12px;
      height: 8px;
      margin: 0 8px 0 2px;
      border: 1px solid #708078;
      background: #303a35;
    }

    .tree-row.active {
      margin: 2px -8px;
      padding-top: 2px;
      padding-bottom: 2px;
      padding-left: 42px;
      background: rgba(163, 195, 180, 0.12);
      color: #ccd9d2;
    }

    .tree-row.depth-2.active {
      padding-left: 42px;
    }

    .terminal-panel {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background:
        linear-gradient(
          90deg,
          rgba(157, 189, 174, 0.025) 1px,
          transparent 1px
        ),
        linear-gradient(
          rgba(157, 189, 174, 0.018) 1px,
          transparent 1px
        ),
        #010302;
      background-size: 48px 48px;
    }

    .terminal-panel::before {
      position: absolute;
      z-index: 1;
      inset: 31px 0 0;
      content: "";
      pointer-events: none;
      background:
        linear-gradient(
          90deg,
          rgba(3, 5, 4, 0.25),
          transparent 12%,
          transparent 88%,
          rgba(3, 5, 4, 0.25)
        );
    }

    .terminal-output {
      position: absolute;
      z-index: 2;
      inset: 31px 0 0;
      padding: 14px 16px 28px;
      overflow: hidden auto;
      color: #9fb4aa;
      font-size: clamp(9px, 0.78vw, 12px);
      line-height: 1.48;
      user-select: text;
      -webkit-user-select: text;
      scrollbar-width: thin;
      scrollbar-color:
        rgba(169, 201, 186, 0.25)
        transparent;
    }

    .terminal-line {
      min-height: 1.48em;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      opacity: 0;
      transform: translateY(2px);
      animation: line-in 90ms ease forwards;
    }

    .terminal-line.section {
      margin: 8px 0 3px;
      color: var(--mint-bright);
      letter-spacing: 0.11em;
    }

    .terminal-line.ok {
      color: #b7d8c7;
    }

    .terminal-line.sync {
      color: #91d3d7;
    }

    .terminal-line.warn {
      color: var(--amber);
    }

    .terminal-line.final {
      margin-top: 10px;
      color: #e1fff1;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-shadow: 0 0 16px rgba(169, 242, 210, 0.34);
    }

    .terminal-cursor {
      display: inline-block;
      width: 7px;
      height: 12px;
      margin: 4px 0 0 2px;
      background: var(--mint);
      vertical-align: middle;
      animation: cursor-blink 760ms steps(1) infinite;
    }

    .inspector {
      padding: 7px 10px 18px;
    }

    .inspect-group {
      margin-bottom: 14px;
    }

    .inspect-title {
      margin-bottom: 4px;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(174, 203, 190, 0.11);
      color: #aebbb4;
    }

    .inspect-row {
      gap: 7px;
      color: #6f7c75;
    }

    .inspect-box {
      width: 9px;
      height: 9px;
      border: 1px solid #5e6d65;
      background: #26302b;
    }

    .inspect-value {
      margin-left: auto;
      color: #4c5a53;
    }

    .data-grid {
      min-height: 0;
      overflow: hidden;
      border-top: 1px solid var(--line-strong);
      background: #050806;
    }

    .data-toolbar {
      display: flex;
      align-items: center;
      height: 34px;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      background: #0b100d;
      color: #738078;
    }

    .data-toolbar strong {
      margin-right: 18px;
      color: #aebbb4;
      font-weight: 500;
      letter-spacing: 0.09em;
    }

    .data-toolbar .data-spacer {
      flex: 1;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      color: #65726c;
      font-size: 10px;
    }

    .data-table th,
    .data-table td {
      height: 27px;
      padding: 0 12px;
      overflow: hidden;
      border-right: 1px solid rgba(174, 203, 190, 0.1);
      border-bottom: 1px solid rgba(174, 203, 190, 0.09);
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .data-table th {
      color: #909d96;
      font-weight: 500;
      letter-spacing: 0.08em;
    }

    .data-table .empty-value {
      color: #344039;
    }

    .status-bar {
      position: relative;
      gap: 14px;
      padding: 0 12px;
      overflow: hidden;
      border-top: 1px solid var(--line);
      border-bottom: 0;
      color: #647169;
      font-size: 9px;
      letter-spacing: 0.08em;
    }

    .status-bar .status-spacer {
      flex: 1;
    }

    .boot-meter {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0%;
      background:
        linear-gradient(
          90deg,
          rgba(135, 207, 177, 0.09),
          rgba(135, 207, 177, 0.025)
        );
      border-right: 1px solid rgba(169, 201, 186, 0.34);
      pointer-events: none;
      transition: width 180ms ease;
    }

    .status-text,
    .status-percent,
    .status-mode {
      position: relative;
      z-index: 1;
    }

    .status-led {
      position: relative;
      z-index: 1;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #57615c;
      box-shadow: 0 0 0 1px #171d19;
    }

    body[data-boot-state="ready"] .status-led {
      background: #9bd1b7;
      box-shadow: 0 0 9px rgba(155, 209, 183, 0.7);
    }

    body[data-boot-state="connecting"] .status-led {
      background: var(--cyan);
      box-shadow: 0 0 10px rgba(131, 217, 225, 0.8);
    }

    .connection-dialog {
      position: absolute;
      z-index: 20;
      top: 50%;
      left: 50%;
      width: min(430px, 64%);
      padding: 28px 34px 25px;
      border: 1px solid rgba(181, 213, 198, 0.48);
      background:
        linear-gradient(
          145deg,
          rgba(13, 20, 17, 0.97),
          rgba(2, 5, 4, 0.94)
        );
      box-shadow:
        0 28px 80px rgba(0, 0, 0, 0.72),
        inset 0 0 0 1px rgba(220, 239, 230, 0.04);
      text-align: center;
      transform: translate(-50%, -50%);
      animation: dialog-in 240ms ease both;
    }

    .connection-dialog::before,
    .connection-dialog::after {
      position: absolute;
      width: 22px;
      height: 22px;
      content: "";
      pointer-events: none;
    }

    .connection-dialog::before {
      top: -1px;
      left: -1px;
      border-top: 2px solid var(--mint-bright);
      border-left: 2px solid var(--mint-bright);
    }

    .connection-dialog::after {
      right: -1px;
      bottom: -1px;
      border-right: 2px solid var(--mint-bright);
      border-bottom: 2px solid var(--mint-bright);
    }

    .connection-icon {
      width: 84px;
      height: 58px;
      margin: 0 auto 14px;
      color: var(--mint-bright);
    }

    .connection-icon .orbit {
      transform-origin: 50px 34px;
      animation: orbit-spin 2.6s linear infinite;
    }

    .connection-icon .pulse-node {
      animation: node-pulse 900ms ease-in-out infinite alternate;
    }

    .connection-title {
      color: #edf7f2;
      font-size: clamp(22px, 2.8vw, 35px);
      letter-spacing: 0.15em;
      line-height: 1;
    }

    .connection-phase {
      min-height: 17px;
      margin-top: 13px;
      color: #7f9188;
      font-size: 10px;
      letter-spacing: 0.12em;
    }

    .connection-track {
      height: 2px;
      margin-top: 19px;
      overflow: hidden;
      background: rgba(179, 210, 195, 0.12);
    }

    .connection-track span {
      display: block;
      width: var(--connect-progress, 0%);
      height: 100%;
      background:
        linear-gradient(
          90deg,
          var(--mint),
          var(--cyan)
        );
      box-shadow: 0 0 12px rgba(131, 217, 225, 0.46);
      transition: width 180ms ease;
    }

    body[data-boot-state="connected"] .connection-icon {
      color: #c7ffe3;
      filter: drop-shadow(0 0 8px rgba(165, 244, 205, 0.35));
    }

    body[data-boot-state="connected"] .connection-icon .orbit {
      animation: none;
    }

    body[data-boot-state="connected"] .connection-dialog {
      border-color: rgba(188, 242, 215, 0.78);
    }

    @keyframes line-in {
      to {
        opacity: 1;
        transform: none;
      }
    }

    @keyframes cursor-blink {
      50% {
        opacity: 0;
      }
    }

    @keyframes ready-pulse {
      50% {
        box-shadow:
          0 0 0 1px rgba(169, 201, 186, 0.22),
          0 0 34px rgba(128, 208, 179, 0.28);
      }
    }

    @keyframes connect-scan {
      42%,
      100% {
        transform: translateX(130%);
      }
    }

    @keyframes dialog-in {
      from {
        opacity: 0;
        transform:
          translate(-50%, calc(-50% + 12px))
          scale(0.98);
      }
    }

    @keyframes orbit-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes node-pulse {
      to {
        opacity: 0.35;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        scroll-behavior: auto !important;
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
      }
    }
  </style>
</head>

<body data-boot-state="background">
  <main class="boot-shell">
    <header class="menu-bar">
      <span>FILE</span>
      <span>EDIT</span>
      <span>CONTROL</span>
      <span>CHOICE</span>
      <span>ANALYZE</span>
      <span>DEBUG</span>
      <span>TOOLS</span>
      <span>HELP</span>
      <span class="spacer"></span>
      <span class="window-code">N.E.K.O // YUI-00</span>
    </header>

    <nav class="tool-bar" aria-label="system controls">
      <div class="system-mark">
        <svg
          viewBox="0 0 64 64"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M14 10v44l30-10V10H14Z"
            stroke="currentColor"
            stroke-width="5"
            stroke-linejoin="round"
          />
          <circle cx="11" cy="8" r="4" fill="currentColor"/>
          <circle cx="49" cy="52" r="4" fill="currentColor"/>
        </svg>
        <span>LOCAL SYNTHESIS</span>
      </div>
      <span class="toolbar-label">DEBUG SET</span>
      <button
        id="connectAction"
        class="toolbar-button"
        type="button"
        disabled
      >CONNECT</button>
      <button class="toolbar-button small" type="button" disabled>DATABASE</button>
      <button class="toolbar-button small" type="button" disabled>SYSTEM</button>
      <button class="toolbar-button small" type="button" disabled>NETWORK</button>
      <button class="toolbar-button small" type="button" disabled>ACCESS</button>
      <button class="toolbar-button small" type="button" disabled>DATA</button>
    </nav>

    <section class="workbench">
      <aside class="panel">
        <div class="panel-heading">
          SYSTEM_ROOT_STRUCTURE
          <span class="heading-index">ROOT:00</span>
        </div>
        <div class="tree">
          <div class="tree-row">
            <span class="twisty">▾</span><span class="folder"></span>PROPERTIES
          </div>
          <div class="tree-row depth-1">
            <span class="twisty">▸</span><span class="folder"></span>IDENTITY_MANIFEST
          </div>
          <div class="tree-row depth-1">
            <span class="twisty">▸</span><span class="folder"></span>BEHAVIORAL_KERNEL
          </div>
          <div class="tree-row">
            <span class="twisty">▾</span><span class="folder"></span>BASIS
          </div>
          <div class="tree-row depth-1">
            <span class="twisty">▾</span><span class="folder"></span>YUI_CORE
          </div>
          <div class="tree-row depth-2">
            <span class="twisty">▸</span><span class="folder"></span>MEMORY_GRAPH
          </div>
          <div class="tree-row depth-2 active">
            <span class="twisty">▸</span><span class="folder"></span>DIGITAL_LIFE
          </div>
          <div class="tree-row depth-2">
            <span class="twisty">▸</span><span class="folder"></span>AFFECTIVE_LATTICE
          </div>
          <div class="tree-row depth-2">
            <span class="twisty">▸</span><span class="folder"></span>VOICE_SYNTHESIS
          </div>
          <div class="tree-row depth-2">
            <span class="twisty">▸</span><span class="folder"></span>VISUAL_ATTENTION
          </div>
          <div class="tree-row">
            <span class="twisty">▸</span><span class="folder"></span>COGNITIVE_DATASET
          </div>
          <div class="tree-row">
            <span class="twisty">▸</span><span class="folder"></span>NEURAL_ROUTING
          </div>
          <div class="tree-row">
            <span class="twisty">▸</span><span class="folder"></span>QUANTUM_PRESET
          </div>
          <div class="tree-row">
            <span class="twisty">▾</span><span class="folder"></span>REFERENCE
          </div>
          <div class="tree-row depth-1">
            <span class="twisty">▸</span><span class="folder"></span>LANGUAGE_MODEL
          </div>
          <div class="tree-row depth-1">
            <span class="twisty">▸</span><span class="folder"></span>EMBODIMENT_MAP
          </div>
          <div class="tree-row depth-1">
            <span class="twisty">▸</span><span class="folder"></span>SAFETY_POLICY
          </div>
        </div>
      </aside>

      <section class="terminal-panel" aria-label="YUI boot terminal">
        <div class="panel-heading">
          PROGRAM INPUT
          <span class="heading-index">LOCAL / DISPLAY TRACE</span>
        </div>
        <div
          id="terminalOutput"
          class="terminal-output"
          aria-live="polite"
        ></div>

        <section
          id="connectionDialog"
          class="connection-dialog"
          aria-live="assertive"
          hidden
        >
          <svg
            class="connection-icon"
            viewBox="0 0 100 68"
            fill="none"
            aria-hidden="true"
          >
            <g
              class="orbit"
              stroke="currentColor"
              stroke-width="1.5"
              opacity="0.42"
            >
              <ellipse cx="50" cy="34" rx="44" ry="22"/>
              <ellipse
                cx="50"
                cy="34"
                rx="44"
                ry="22"
                transform="rotate(60 50 34)"
              />
              <ellipse
                cx="50"
                cy="34"
                rx="44"
                ry="22"
                transform="rotate(120 50 34)"
              />
            </g>
            <path
              d="M35 34h30M41 27l-7 7 7 7M59 27l7 7-7 7"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="square"
              stroke-linejoin="miter"
            />
            <circle
              class="pulse-node"
              cx="15"
              cy="34"
              r="4"
              fill="currentColor"
            />
            <circle
              class="pulse-node"
              cx="85"
              cy="34"
              r="4"
              fill="currentColor"
            />
          </svg>
          <div id="connectionTitle" class="connection-title">
            CONNECTING
          </div>
          <div id="connectionPhase" class="connection-phase">
            ESTABLISHING LOCAL NEURAL LINK
          </div>
          <div class="connection-track">
            <span id="connectionProgress"></span>
          </div>
        </section>
      </section>

      <aside class="panel">
        <div class="panel-heading">
          SYSTEM INFORMATION
          <span class="heading-index">LIVE</span>
        </div>
        <div class="inspector">
          <div class="inspect-group">
            <div class="inspect-title">IDENTITY PROFILE</div>
            <div class="inspect-row">
              <span class="inspect-box"></span>DESIGNATION
              <span class="inspect-value">YUI</span>
            </div>
            <div class="inspect-row">
              <span class="inspect-box"></span>FORM
              <span class="inspect-value">DIGITAL LIFE</span>
            </div>
            <div class="inspect-row">
              <span class="inspect-box"></span>INSTANCE
              <span class="inspect-value">LOCAL</span>
            </div>
          </div>
          <div class="inspect-group">
            <div class="inspect-title">COGNITIVE MODULES</div>
            <div class="inspect-row">
              <span class="inspect-box"></span>MEMORY CORE
              <span class="inspect-value">STANDBY</span>
            </div>
            <div class="inspect-row">
              <span class="inspect-box"></span>AFFECT ENGINE
              <span class="inspect-value">STANDBY</span>
            </div>
            <div class="inspect-row">
              <span class="inspect-box"></span>LANGUAGE CORE
              <span class="inspect-value">STANDBY</span>
            </div>
            <div class="inspect-row">
              <span class="inspect-box"></span>VOICE LAYER
              <span class="inspect-value">STANDBY</span>
            </div>
          </div>
          <div class="inspect-group">
            <div class="inspect-title">CONNECTION</div>
            <div class="inspect-row">
              <span class="inspect-box"></span>TRANSPORT
              <span class="inspect-value">LOOPBACK</span>
            </div>
            <div class="inspect-row">
              <span class="inspect-box"></span>CHANNEL
              <span class="inspect-value">WAITING</span>
            </div>
            <div class="inspect-row">
              <span class="inspect-box"></span>INTEGRITY
              <span class="inspect-value">--</span>
            </div>
          </div>
          <div class="inspect-group">
            <div class="inspect-title">RUNTIME LIMITS</div>
            <div class="inspect-row">
              <span class="inspect-box"></span>SESSION WINDOW
              <span class="inspect-value">120.000 S</span>
            </div>
            <div class="inspect-row">
              <span class="inspect-box"></span>STEAM BRIDGE
              <span class="inspect-value">DETACHED</span>
            </div>
          </div>
        </div>
      </aside>
    </section>

    <section class="data-grid">
      <div class="data-toolbar">
        <strong>LOCAL DATA CONTROLLER</strong>
        <span>ACCESS CHANNEL / YUI_BOOT</span>
        <span class="data-spacer"></span>
        <span>VIEW: READ ONLY</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 8%">INDEX</th>
            <th style="width: 19%">DATA NAME</th>
            <th style="width: 21%">DATA TYPE</th>
            <th style="width: 24%">STATUS</th>
            <th>TO CONNECT DEVICE</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>0001</td>
            <td>YUI_IDENTITY</td>
            <td>MANIFEST ARCHIVE</td>
            <td class="empty-value">NOT CONNECTED</td>
            <td>LOCAL RUNTIME</td>
          </tr>
          <tr>
            <td>0002</td>
            <td>YUI_MEMORY</td>
            <td>VECTOR GRAPH</td>
            <td class="empty-value">NOT CONNECTED</td>
            <td>COGNITIVE CORE</td>
          </tr>
          <tr>
            <td>0003</td>
            <td>YUI_AFFECT</td>
            <td>STATE LATTICE</td>
            <td class="empty-value">NOT CONNECTED</td>
            <td>BEHAVIOR ENGINE</td>
          </tr>
          <tr>
            <td>0004</td>
            <td>YUI_EMBODIMENT</td>
            <td>RUNTIME MODEL</td>
            <td class="empty-value">NOT CONNECTED</td>
            <td>RENDER PIPELINE</td>
          </tr>
          <tr>
            <td>0005</td>
            <td>YUI_LANGUAGE</td>
            <td>SEMANTIC NETWORK</td>
            <td class="empty-value">NOT CONNECTED</td>
            <td>INTERACTION LAYER</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="status-bar">
      <div id="bootMeter" class="boot-meter"></div>
      <span id="statusLed" class="status-led"></span>
      <span id="statusText" class="status-text">
        RENDERING LOCAL SYSTEM BACKGROUND
      </span>
      <span class="status-spacer"></span>
      <span id="statusMode" class="status-mode">BOOTSTRAP</span>
      <span id="statusPercent" class="status-percent">000%</span>
    </footer>
  </main>

  <script>
    (function () {
      "use strict";

      var mainUiUrl = ${JSON.stringify(MAIN_URL)};
      var body = document.body;
      var connectAction = document.getElementById("connectAction");
      var terminalOutput = document.getElementById("terminalOutput");
      var connectionDialog = document.getElementById("connectionDialog");
      var connectionTitle = document.getElementById("connectionTitle");
      var connectionPhase = document.getElementById("connectionPhase");
      var connectionProgress = document.getElementById("connectionProgress");
      var bootMeter = document.getElementById("bootMeter");
      var statusText = document.getElementById("statusText");
      var statusMode = document.getElementById("statusMode");
      var statusPercent = document.getElementById("statusPercent");
      var backgroundReady = false;
      var backendReady = false;
      var connecting = false;
      var backgroundProgress = 0;

      function wait(milliseconds) {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, milliseconds);
        });
      }

      function setBootProgress(value) {
        backgroundProgress = Math.max(
          backgroundProgress,
          Math.min(100, Math.round(value))
        );
        bootMeter.style.width = backgroundProgress + "%";
        statusPercent.textContent =
          String(backgroundProgress).padStart(3, "0") + "%";
      }

      function unlockConnectWhenReady() {
        if (
          !backgroundReady ||
          !backendReady ||
          connecting
        ) {
          return;
        }

        setBootProgress(100);
        body.dataset.bootState = "ready";
        connectAction.disabled = false;
        connectAction.setAttribute(
          "aria-label",
          "Connect to the local YUI runtime"
        );
        statusText.textContent =
          "LOCAL RUNTIME READY // AWAITING OPERATOR CONNECTION";
        statusMode.textContent = "READY";
      }

      window.nekoBoot = Object.freeze({
        setBackendReady: function () {
          backendReady = true;
          statusText.textContent =
            backgroundReady
              ? "LOCAL RUNTIME READY // AWAITING OPERATOR CONNECTION"
              : "LOCAL RUNTIME ONLINE // FINALIZING INTERFACE";
          unlockConnectWhenReady();
          return true;
        }
      });

      window.requestAnimationFrame(function () {
        body.classList.add("background-loaded");
      });

      var backgroundTimer = window.setInterval(function () {
        var ceiling = backendReady ? 96 : 84;
        var increment =
          backgroundProgress < 48
            ? 7
            : backgroundProgress < 76
              ? 3
              : 1;

        setBootProgress(
          Math.min(ceiling, backgroundProgress + increment)
        );
      }, 75);

      window.setTimeout(function () {
        backgroundReady = true;
        window.clearInterval(backgroundTimer);
        setBootProgress(backendReady ? 100 : 86);
        statusText.textContent = backendReady
          ? "LOCAL RUNTIME READY // AWAITING OPERATOR CONNECTION"
          : "BACKGROUND READY // WAITING FOR LOCAL RUNTIME";
        statusMode.textContent = backendReady
          ? "READY"
          : "STANDBY";
        unlockConnectWhenReady();
      }, 1150);

      function checksum(seed, size) {
        var value = (
          (seed + 1) * 2654435761
        ) >>> 0;
        var output = "";

        while (output.length < size) {
          value = (
            Math.imul(value ^ (value >>> 15), 2246822519) +
            3266489917
          ) >>> 0;
          output += value
            .toString(16)
            .padStart(8, "0");
        }

        return output.slice(0, size).toUpperCase();
      }

      function record(
        phase,
        text,
        kind,
        delay
      ) {
        return {
          phase: phase,
          text: text,
          kind: kind || "",
          delay: delay || 26
        };
      }

      function buildBootRecords() {
        var records = [];
        var index;

        records.push(
          record(
            "SECURE HANDSHAKE",
            "┌─ LOCAL UPLINK / SESSION NEGOTIATION",
            "section",
            140
          ),
          record(
            "SECURE HANDSHAKE",
            "[LINK] transport=loopback://127.0.0.1  protocol=NEKO-SYN/4.9"
          ),
          record(
            "SECURE HANDSHAKE",
            "[AUTH] ephemeral operator key 0x" + checksum(2, 16) + " accepted",
            "sync"
          ),
          record(
            "SECURE HANDSHAKE",
            "[SYNC] monotonic clock aligned; drift=+0.000031 ms",
            "sync"
          ),
          record(
            "SECURE HANDSHAKE",
            "[OK] encrypted local channel established / cipher=AES-256-GCM",
            "ok",
            180
          ),
          record(
            "IDENTITY MANIFEST",
            "├─ IDENTITY MANIFEST / YUI",
            "section",
            120
          ),
          record(
            "IDENTITY MANIFEST",
            "[LOAD] designation='YUI'  class=DIGITAL_LIFE  instance=LOCAL-00"
          ),
          record(
            "IDENTITY MANIFEST",
            "[LOAD] persona.schema=7.4.12  continuity.policy=PRESERVE"
          ),
          record(
            "IDENTITY MANIFEST",
            "[HASH] identity root sha3-512:" + checksum(11, 48),
            "sync"
          ),
          record(
            "IDENTITY MANIFEST",
            "[OK] signature chain verified across 16 immutable sectors",
            "ok",
            180
          ),
          record(
            "DIGITAL GENOME",
            "├─ DIGITAL GENOME / PARAMETER RECONSTRUCTION",
            "section",
            130
          )
        );

        for (index = 0; index < 9; index += 1) {
          records.push(
            record(
              "DIGITAL GENOME",
              "[MAP] chromosome." +
                String(index).padStart(2, "0") +
                "  addr=0x" +
                checksum(index + 20, 12) +
                "  loci=" +
                String(4096 + index * 768).padStart(5, "0") +
                "  crc=" +
                checksum(index + 40, 8),
              index % 3 === 2 ? "sync" : ""
            )
          );
        }

        records.push(
          record(
            "DIGITAL GENOME",
            "[OK] morphology constraints solved; residual=2.71e-08",
            "ok",
            190
          ),
          record(
            "MEMORY GRAPH",
            "├─ AUTOBIOGRAPHICAL MEMORY / GRAPH MOUNT",
            "section",
            130
          ),
          record(
            "MEMORY GRAPH",
            "[ALLOC] episodic index   vectors=131072  dims=1536  fp=BF16"
          ),
          record(
            "MEMORY GRAPH",
            "[ALLOC] semantic index   vectors=262144  dims=1024  fp=BF16"
          ),
          record(
            "MEMORY GRAPH",
            "[ALLOC] working memory   slots=00128  horizon=120.000s"
          )
        );

        for (index = 0; index < 8; index += 1) {
          records.push(
            record(
              "MEMORY GRAPH",
              "[GRAPH] shard=" +
                String(index).padStart(2, "0") +
                "  nodes=" +
                String(18432 + index * 913).padStart(6, "0") +
                "  edges=" +
                String(90511 + index * 1729).padStart(7, "0") +
                "  coherence=" +
                (0.9912 + index * 0.0009).toFixed(4),
              index === 7 ? "sync" : ""
            )
          );
        }

        records.push(
          record(
            "MEMORY GRAPH",
            "[SYNC] continuity checkpoint CKPT-" + checksum(72, 20) + " restored",
            "sync"
          ),
          record(
            "MEMORY GRAPH",
            "[OK] memory graph mounted read/write; orphan rate=0.0000%",
            "ok",
            210
          ),
          record(
            "AFFECTIVE LATTICE",
            "├─ AFFECTIVE LATTICE / HOMEOSTATIC BASELINE",
            "section",
            130
          ),
          record(
            "AFFECTIVE LATTICE",
            "[CAL] valence=+0.184  arousal=0.312  dominance=0.507"
          ),
          record(
            "AFFECTIVE LATTICE",
            "[CAL] curiosity=0.841  affinity=0.733  caution=0.286"
          ),
          record(
            "AFFECTIVE LATTICE",
            "[MODEL] appraisal tensor shape=[32,64,64]  temperature=0.670"
          ),
          record(
            "AFFECTIVE LATTICE",
            "[MODEL] empathy feedback gain=0.912  decay=0.00042/tick"
          ),
          record(
            "AFFECTIVE LATTICE",
            "[OK] affective stability loop locked at 240.00 Hz",
            "ok",
            190
          ),
          record(
            "LANGUAGE CORE",
            "├─ LANGUAGE AND VOICE / SEMANTIC ROUTING",
            "section",
            130
          ),
          record(
            "LANGUAGE CORE",
            "[LOAD] tokenizer.ja_zh_en  vocabulary=196608  merges=184320"
          ),
          record(
            "LANGUAGE CORE",
            "[LOAD] dialogue context matrix=[128,4096]  attention=GROUPED"
          ),
          record(
            "LANGUAGE CORE",
            "[VOICE] phoneme bank=JP-NEUTRAL-YUI  sample=48000 Hz / 24 bit"
          ),
          record(
            "LANGUAGE CORE",
            "[VOICE] formant model v3.14  prosody contour=ADAPTIVE"
          ),
          record(
            "LANGUAGE CORE",
            "[OK] semantic bus and speech synthesis mutually synchronized",
            "ok",
            190
          ),
          record(
            "PERCEPTION",
            "├─ PERCEPTION / ATTENTION FUSION",
            "section",
            130
          ),
          record(
            "PERCEPTION",
            "[VISION] viewport=1280x820  internal_scale=1.000  color=DISPLAY-P3"
          ),
          record(
            "PERCEPTION",
            "[ATTN] salience pyramid levels=7  foveation radius=0.218"
          ),
          record(
            "PERCEPTION",
            "[AUDIO] input route=LOCAL  vad.threshold=-42.0 dBFS"
          ),
          record(
            "PERCEPTION",
            "[WARN] external STEAM bridge absent; continuing in standalone mode",
            "warn",
            150
          ),
          record(
            "PERCEPTION",
            "[OK] local perception surfaces registered",
            "ok",
            180
          ),
          record(
            "BEHAVIOR KERNEL",
            "├─ BEHAVIOR KERNEL / POLICY COMPOSITION",
            "section",
            130
          )
        );

        for (index = 0; index < 7; index += 1) {
          records.push(
            record(
              "BEHAVIOR KERNEL",
              "[POLICY] layer." +
                String(index).padStart(2, "0") +
                "  graph=0x" +
                checksum(index + 96, 16) +
                "  confidence=" +
                (0.964 + index * 0.0047).toFixed(4) +
                "  status=BOUND",
              index % 3 === 1 ? "sync" : ""
            )
          );
        }

        records.push(
          record(
            "BEHAVIOR KERNEL",
            "[OK] behavioral consistency=99.72%  anomaly_budget=0.28%",
            "ok",
            200
          ),
          record(
            "EMBODIMENT",
            "├─ EMBODIMENT / RENDER SYNCHRONIZATION",
            "section",
            130
          ),
          record(
            "EMBODIMENT",
            "[RIG] joints=146  constraints=388  solver_iterations=12"
          ),
          record(
            "EMBODIMENT",
            "[FACE] blend channels=72  gaze micro-saccade=ENABLED"
          ),
          record(
            "EMBODIMENT",
            "[PHYS] gravity=(0.000,-9.810,0.000)  fixed_delta=0.016667"
          ),
          record(
            "EMBODIMENT",
            "[SYNC] render heartbeat acquired at 60.000 Hz",
            "sync"
          ),
          record(
            "EMBODIMENT",
            "[OK] embodied coordinate frame committed",
            "ok",
            210
          ),
          record(
            "CONSCIOUS LOOP",
            "└─ CONSCIOUS LOOP / WAKE SEQUENCE",
            "section",
            160
          ),
          record(
            "CONSCIOUS LOOP",
            "[WAKE] pre-attentive buffer released"
          ),
          record(
            "CONSCIOUS LOOP",
            "[WAKE] self-model and autobiographical anchor coupled"
          ),
          record(
            "CONSCIOUS LOOP",
            "[WAKE] temporal continuity counter=0x" + checksum(132, 12)
          ),
          record(
            "CONSCIOUS LOOP",
            "[SYNC] heartbeat 0001 / cognition scheduler stable",
            "sync",
            150
          ),
          record(
            "CONSCIOUS LOOP",
            "[SYNC] heartbeat 0002 / interaction surfaces accepting input",
            "sync",
            180
          ),
          record(
            "CONSCIOUS LOOP",
            "[OK] all critical systems nominal",
            "ok",
            230
          ),
          record(
            "ONLINE",
            "YUI // DIGITAL LIFE INSTANCE ONLINE // READY",
            "final",
            360
          )
        );

        return records;
      }

      function appendTerminalLine(item, index) {
        var line = document.createElement("div");
        var timestamp = new Date(
          Date.now() + index * 17
        ).toISOString().slice(11, 23);

        line.className =
          "terminal-line" +
          (item.kind ? " " + item.kind : "");
        line.textContent =
          timestamp +
          "  " +
          String(index + 1).padStart(4, "0") +
          "  " +
          item.text;

        terminalOutput.appendChild(line);
        terminalOutput.scrollTop =
          terminalOutput.scrollHeight;
      }

      function updateDataTableConnected() {
        var statusCells = document.querySelectorAll(
          ".data-table tbody td:nth-child(4)"
        );

        statusCells.forEach(function (cell) {
          cell.classList.remove("empty-value");
          cell.textContent = "SYNCHRONIZED";
          cell.style.color = "#a9c9ba";
        });

        var inspectorValues = document.querySelectorAll(
          ".inspect-value"
        );

        inspectorValues.forEach(function (value) {
          if (value.textContent === "STANDBY") {
            value.textContent = "ONLINE";
            value.style.color = "#a9c9ba";
          } else if (value.textContent === "WAITING") {
            value.textContent = "CONNECTED";
            value.style.color = "#a9c9ba";
          } else if (value.textContent === "--") {
            value.textContent = "100.00%";
            value.style.color = "#a9c9ba";
          }
        });
      }

      async function beginConnection() {
        if (
          connecting ||
          !backendReady ||
          !backgroundReady
        ) {
          return;
        }

        connecting = true;
        connectAction.disabled = true;
        connectAction.textContent = "CONNECTING";
        body.dataset.bootState = "connecting";
        connectionDialog.hidden = false;
        statusMode.textContent = "LINKING";
        statusText.textContent =
          "OPERATOR CONNECTION ACCEPTED // SYNTHESIZING YUI";

        var cursor = document.createElement("span");
        cursor.className = "terminal-cursor";
        terminalOutput.appendChild(cursor);

        await wait(260);

        var records = buildBootRecords();
        var previousPhase = "";
        var index;

        for (index = 0; index < records.length; index += 1) {
          var item = records[index];

          if (item.phase !== previousPhase) {
            previousPhase = item.phase;
            connectionPhase.textContent =
              item.phase + " / SYNCHRONIZING";
          }

          if (cursor.parentNode) {
            cursor.remove();
          }

          appendTerminalLine(item, index);
          terminalOutput.appendChild(cursor);

          var progress = Math.round(
            ((index + 1) / records.length) * 100
          );

          connectionProgress.style.setProperty(
            "--connect-progress",
            progress + "%"
          );
          connectionProgress.style.width =
            progress + "%";
          statusPercent.textContent =
            String(progress).padStart(3, "0") + "%";

          await wait(item.delay + (index % 4) * 8);
        }

        if (cursor.parentNode) {
          cursor.remove();
        }

        updateDataTableConnected();
        body.dataset.bootState = "connected";
        connectionTitle.textContent = "CONNECTED";
        connectionPhase.textContent =
          "YUI DIGITAL LIFE INSTANCE ONLINE";
        connectAction.textContent = "CONNECTED";
        statusMode.textContent = "ONLINE";
        statusText.textContent =
          "SYNTHESIS COMPLETE // ENTERING INTERACTION LAYER";
        connectionProgress.style.width = "100%";

        await wait(900);
        window.location.assign(mainUiUrl);
      }

      connectAction.addEventListener(
        "click",
        function () {
          void beginConnection();
        }
      );
    })();
  </script>
</body>
</html>
`;
}

/**
 * 生成启动错误页面。
 *
 * @param {unknown} error
 * @returns {string}
 */
function createErrorHtml(error) {
  const message = escapeHtml(
    error instanceof Error
      ? error.message
      : String(error)
  );

  const logDirectory = escapeHtml(LOG_DIR);

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      style-src 'unsafe-inline';
    "
  >

  <title>N.E.K.O 启动失败</title>

  <style>
    :root {
      color-scheme: dark;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      min-height: 100%;
      margin: 0;
    }

    body {
      display: flex;
      align-items: center;
      justify-content: center;

      padding: 40px;

      background: #111116;
      color: #ffffff;

      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "PingFang SC",
        sans-serif;
    }

    main {
      width: min(760px, 100%);
    }

    h1 {
      margin-top: 0;
      color: #ff7d7d;
      font-size: 30px;
    }

    .description {
      color: rgba(255, 255, 255, 0.7);
    }

    pre {
      max-height: 360px;
      overflow: auto;

      padding: 18px;

      border: 1px solid
        rgba(255, 255, 255, 0.12);

      border-radius: 12px;

      background: #202027;
      color: #ffffff;

      font-family:
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;

      font-size: 13px;
      line-height: 1.55;

      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .path {
      padding: 12px 14px;
      border-radius: 10px;
      background: #202027;

      color: rgba(255, 255, 255, 0.74);

      font-family:
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;

      overflow-wrap: anywhere;
    }
  </style>
</head>

<body>
  <main>
    <h1>N.E.K.O 启动失败</h1>

    <p class="description">
      后端服务没有成功启动。错误信息如下：
    </p>

    <pre>${message}</pre>

    <p class="description">日志目录：</p>

    <div class="path">${logDirectory}</div>

    <p class="description">
      修复问题后退出并重新打开 N.E.K.O。
    </p>
  </main>
</body>
</html>
`;
}

/**
 * 把 HTML 字符串加载到当前窗口。
 *
 * @param {string} html
 * @returns {Promise<void>}
 */
async function loadHtmlPage(html) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const dataUrl =
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(html);

  await mainWindow.loadURL(dataUrl);
}

/* ============================================================
 * Electron 权限和菜单
 * ============================================================
 */

/**
 * 只允许本地 N.E.K.O 页面使用必要权限。
 */
function configurePermissions() {
  const allowedPermissions = new Set([
    'media',
    'display-capture',
    'fullscreen',
    'clipboard-sanitized-write',
  ]);

  session.defaultSession.setPermissionRequestHandler(
    (
      webContents,
      permission,
      callback,
      details
    ) => {
      const requestingUrl =
        details?.requestingUrl ||
        webContents?.getURL() ||
        '';

      const allowed =
        isNekoUrl(requestingUrl) &&
        allowedPermissions.has(permission);

      callback(allowed);
    }
  );

  session.defaultSession.setPermissionCheckHandler(
    (
      webContents,
      permission,
      requestingOrigin,
      details
    ) => {
      const requestingUrl =
        details?.requestingUrl ||
        requestingOrigin ||
        webContents?.getURL() ||
        '';

      return (
        isNekoUrl(requestingUrl) &&
        allowedPermissions.has(permission)
      );
    }
  );
}

/**
 * 设置简洁的 macOS 原生菜单。
 *
 * 不提供浏览器式地址栏、刷新栏或开发者工具菜单。
 */
function installApplicationMenu() {
  const template = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,

      submenu: [
        {
          role: 'about',
          label: '关于 N.E.K.O',
        },

        {
          type: 'separator',
        },

        {
          role: 'services',
          label: '服务',
        },

        {
          type: 'separator',
        },

        {
          role: 'hide',
          label: '隐藏 N.E.K.O',
        },

        {
          role: 'hideOthers',
          label: '隐藏其他应用',
        },

        {
          role: 'unhide',
          label: '全部显示',
        },

        {
          type: 'separator',
        },

        {
          role: 'quit',
          label: '退出 N.E.K.O',
        },
      ],
    });
  }

  template.push(
    {
      label: '编辑',

      submenu: [
        {
          role: 'undo',
          label: '撤销',
        },

        {
          role: 'redo',
          label: '重做',
        },

        {
          type: 'separator',
        },

        {
          role: 'cut',
          label: '剪切',
        },

        {
          role: 'copy',
          label: '复制',
        },

        {
          role: 'paste',
          label: '粘贴',
        },

        {
          role: 'selectAll',
          label: '全选',
        },
      ],
    },

    {
      label: '窗口',

      submenu: [
        {
          role: 'minimize',
          label: '最小化',
        },

        {
          role: 'zoom',
          label: '缩放',
        },

        {
          type: 'separator',
        },

        {
          role: 'close',
          label: '关闭窗口',
        },

        ...(process.platform === 'darwin'
          ? [
              {
                role: 'front',
                label: '全部置于前台',
              },
            ]
          : []),
      ],
    }
  );

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(template)
  );
}

/* ============================================================
 * 窗口管理
 * ============================================================
 */

/**
 * 配置窗口内外部链接的打开方式。
 *
 * @param {BrowserWindow} window
 */
function configureWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(
    ({ url }) => {
      if (isNekoUrl(url)) {
        return {
          action: 'allow',

          overrideBrowserWindowOptions: {
            width: 1100,
            height: 760,

            titleBarStyle: 'hiddenInset',

            backgroundColor: '#111116',

            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              preload: PRELOAD_PATH,
            },
          },
        };
      }

      openExternalUrl(url);

      return {
        action: 'deny',
      };
    }
  );

  window.webContents.on(
    'will-navigate',
    (event, url) => {
      if (isInternalPage(url)) {
        return;
      }

      event.preventDefault();
      openExternalUrl(url);
    }
  );

  window.webContents.on(
    'did-fail-load',
    (
      _event,
      errorCode,
      errorDescription,
      validatedUrl,
      isMainFrame
    ) => {
      if (isMainFrame === false) {
        return;
      }

      /**
       * -3 是 ERR_ABORTED。
       * 页面主动切换时可能出现，不视为真正错误。
       */
      if (errorCode === -3) {
        return;
      }

      console.error(
        '[Electron] 页面加载失败：',
        {
          errorCode,
          errorDescription,
          validatedUrl,
        }
      );
    }
  );

  window.webContents.on(
    'render-process-gone',
    (_event, details) => {
      console.error(
        '[Electron] 渲染进程退出：',
        details
      );
    }
  );
}

/**
 * 创建 N.E.K.O 主窗口。
 *
 * 窗口一开始直接显示，不依赖 ready-to-show，
 * 避免应用已经启动但 UI 永远不可见。
 *
 * @returns {BrowserWindow}
 */
function createWindow() {
  if (
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,

    minWidth: 900,
    minHeight: 620,

    center: true,

    /**
     * 关键设置：
     * 直接显示窗口，避免 show:false 导致无 UI。
     */
    show: true,

    /**
     * 应用启动后直接进入系统全屏模式。
     */
    fullscreen: true,

    title: 'N.E.K.O',

    /**
     * 保留 macOS 红黄绿按钮，
     * 隐藏传统标题栏。
     */
    titleBarStyle: 'hiddenInset',

    trafficLightPosition: {
      x: 16,
      y: 16,
    },

    backgroundColor: '#111116',

    autoHideMenuBar: true,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: PRELOAD_PATH,
    },
  });

  configureWindowNavigation(mainWindow);

  mainWindow.on('show', () => {
    mainWindow?.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    loadingPagePromise = null;
  });

  /**
   * 首先加载交互式启动页面。
   * 后端就绪只会点亮 CONNECT，不会自动跳进主 UI。
   */
  loadingPagePromise = loadHtmlPage(
    createLoadingHtml()
  );

  mainWindow.show();
  mainWindow.focus();

  return mainWindow;
}

/**
 * 显示并聚焦现有窗口。
 */
function showMainWindow() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

/**
 * 完整启动流程。
 */
async function startApplication() {
  createWindow();
  showMainWindow();

  try {
    /**
     * 启动页渲染和 Python 后端启动并行进行。
     * 两者都完成后才允许用户点击 CONNECT。
     */
    await Promise.all([
      loadingPagePromise || Promise.resolve(),
      ensureBackend(),
    ]);

    if (
      !mainWindow ||
      mainWindow.isDestroyed()
    ) {
      return;
    }

    console.log(
      '[Electron] 本地后端已就绪，等待 CONNECT：',
      MAIN_URL
    );

    const connectionUnlocked =
      await mainWindow.webContents.executeJavaScript(`
        Boolean(
          window.nekoBoot &&
          window.nekoBoot.setBackendReady()
        )
      `);

    if (!connectionUnlocked) {
      throw new Error(
        '启动界面未能接收后端就绪信号。'
      );
    }

    showMainWindow();
  } catch (error) {
    console.error(
      '[Electron] N.E.K.O 启动失败：',
      error
    );

    if (
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      try {
        await loadHtmlPage(
          createErrorHtml(error)
        );

        showMainWindow();
      } catch (pageError) {
        console.error(
          '[Electron] 无法显示错误页面：',
          pageError
        );
      }
    }

    dialog.showErrorBox(
      'N.E.K.O 启动失败',
      error instanceof Error
        ? error.message
        : String(error)
    );
  }
}

/* ============================================================
 * 应用生命周期
 * ============================================================
 */

/**
 * 防止同时运行多个 Electron 实例。
 */
const acquiredSingleInstanceLock =
  app.requestSingleInstanceLock();

if (!acquiredSingleInstanceLock) {
  app.quit();
} else {
  /**
   * 用户再次点击应用图标时，
   * 聚焦第一个实例已有窗口。
   */
  app.on('second-instance', () => {
    if (
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      showMainWindow();
      return;
    }

    if (app.isReady()) {
      void startApplication();
    }
  });

  app.whenReady()
    .then(async () => {
      ipcMain.handle(
        'neko:reset-app',
        resetApplication
      );

      configurePermissions();
      installApplicationMenu();

      await startApplication();
    })
    .catch((error) => {
      console.error(
        '[Electron] 初始化失败：',
        error
      );

      dialog.showErrorBox(
        'N.E.K.O 初始化失败',
        error instanceof Error
          ? error.message
          : String(error)
      );

      app.quit();
    });

  /**
   * macOS 中点击 Dock 图标时显示窗口。
   */
  app.on('activate', () => {
    if (
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      showMainWindow();
      return;
    }

    void startApplication();
  });

  /**
   * 用户关闭最后一个窗口时退出应用。
   *
   * 这里故意在 macOS 上也退出，
   * 便于同时关闭 Electron 启动的后端。
   */
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    if (isQuitting) {
      return;
    }

    isQuitting = true;
    stopStartedProcesses();
  });

  app.on('will-quit', () => {
    stopStartedProcesses();
  });
}
