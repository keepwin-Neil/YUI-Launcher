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

const PRELOAD_PATH = path.join(
  __dirname,
  'preload.js'
);

/**
 * 用户提供的新 Logo。
 *
 * 已缩放为 256×256 的 JPEG 后内嵌，打包 App 不依赖 Downloads 目录。
 */
const BRAND_LOGO_DATA_URL =
  'data:image/jpeg;base64,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';

/* ============================================================
 * 基本配置
 * ============================================================
 */

/**
 * N.E.K.O 源码目录。
 *
 * 默认查找当前用户的 Projects/N.E.K.O，可通过 NEKO_PROJECT_DIR 指定。
 */
const PROJECT_DIR =
  process.env.NEKO_PROJECT_DIR ||
  path.join(os.homedir(), 'Projects', 'N.E.K.O');

/**
 * 使用项目现有的 uv 虚拟环境。
 */
const PYTHON_PATH = path.join(
  PROJECT_DIR,
  '.venv',
  'bin',
  'python'
);

/**
 * 视觉模块使用独立环境，避免 OpenCV / NumPy 与主项目依赖冲突。
 */
const VISION_PYTHON_PATH =
  process.env.NEKO_VISION_PYTHON ||
  path.join(
    PROJECT_DIR,
    '.venv-vision',
    'bin',
    'python'
  );

const VISION_SERVICE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'vision_service')
  : path.join(__dirname, 'vision_service');

const VISION_SERVICE_PATH = path.join(
  VISION_SERVICE_DIR,
  'service.py'
);

/**
 * Electron 启动的后端日志目录。
 */
const LOG_DIR = path.join(
  os.homedir(),
  'Library',
  'Logs',
  'N.E.K.O'
);

const MEMORY_URL = 'http://127.0.0.1:48912/health';
const MAIN_URL = 'http://127.0.0.1:48911/';
const VISION_URL = 'http://127.0.0.1:48913/health';
const VISION_ANALYZE_URL =
  'http://127.0.0.1:48913/analyze';

const MEMORY_START_TIMEOUT_MS = 45_000;
const MAIN_START_TIMEOUT_MS = 90_000;
const VISION_START_TIMEOUT_MS = 30_000;
const HTTP_CHECK_TIMEOUT_MS = 1_500;
const VISION_REQUEST_TIMEOUT_MS = 8_000;
const MAX_VISION_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_VISION_RESPONSE_BYTES = 256 * 1024;
const UI_WARMUP_REQUEST_TIMEOUT_MS = 10_000;
const UI_WARMUP_CONCURRENCY = 10;
const UI_WARMUP_MAX_ASSETS = 240;

let mainWindow = null;
let loadingPagePromise = null;
let isQuitting = false;
let resetInProgress = false;
let visionStartupPromise = null;
let mainUiWarmupPromise = null;
let visionStartupStatus = Object.freeze({
  phase: 'IDLE',
  message:
    '[VISION] deferred until operator selects CONNECT',
  kind: '',
  ready: false,
  error: null,
  updatedAt: Date.now(),
});

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
 * 使用 Chromium 自己的网络栈读取本地主界面资源。
 *
 * 这样 CONNECTING 阶段取到的响应会进入与主窗口相同的
 * HTTP 缓存；正式跳转时无需再从磁盘重复读取大量 JS/CSS。
 *
 * @param {string} targetUrl
 * @param {RequestCache} cacheMode
 * @returns {Promise<{
 *   bytes: number,
 *   text: string,
 *   contentType: string
 * }>}
 */
async function fetchUiWarmupResource(
  targetUrl,
  cacheMode = 'force-cache'
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, UI_WARMUP_REQUEST_TIMEOUT_MS);

  try {
    const response =
      await session.defaultSession.fetch(
        targetUrl,
        {
          method: 'GET',
          cache: cacheMode,
          credentials: 'include',
          signal: controller.signal,
        }
      );

    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText}`
      );
    }

    const body = await response.arrayBuffer();
    const bytes = body.byteLength;
    const contentType =
      response.headers.get('content-type') || '';
    const text =
      contentType.includes('text/') ||
      contentType.includes('json') ||
      targetUrl.endsWith('.js') ||
      targetUrl.includes('.js?') ||
      targetUrl.endsWith('.css') ||
      targetUrl.includes('.css?')
        ? Buffer.from(body).toString('utf8')
        : '';

    return {
      bytes,
      text,
      contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 限制并发地预取一组本机资源，避免一次性创建上百个请求。
 *
 * @param {string[]} urls
 * @returns {Promise<{
 *   loaded: number,
 *   failed: number,
 *   bytes: number
 * }>}
 */
async function warmUiResourceList(urls) {
  const queue = Array.from(
    new Set(urls)
  ).slice(0, UI_WARMUP_MAX_ASSETS);
  let nextIndex = 0;
  let loaded = 0;
  let failed = 0;
  let bytes = 0;

  async function worker() {
    while (nextIndex < queue.length) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        const result =
          await fetchUiWarmupResource(
            queue[index]
          );
        loaded += 1;
        bytes += result.bytes;
      } catch (error) {
        failed += 1;
        console.debug(
          '[Electron] CONNECTING 资源预取跳过：',
          queue[index],
          error instanceof Error
            ? error.message
            : String(error)
        );
      }
    }
  }

  const workerCount = Math.max(
    1,
    Math.min(
      UI_WARMUP_CONCURRENCY,
      queue.length
    )
  );

  await Promise.all(
    Array.from(
      { length: workerCount },
      () => worker()
    )
  );

  return {
    loaded,
    failed,
    bytes,
  };
}

/**
 * 从主页 HTML 提取同源静态资源。
 *
 * @param {string} html
 * @returns {string[]}
 */
function extractMainUiStaticUrls(html) {
  const urls = new Set();
  const attributePattern =
    /\b(?:src|href)\s*=\s*["']([^"'#]+)["']/giu;
  let match;

  while (
    (match = attributePattern.exec(html)) !== null
  ) {
    try {
      const parsed = new URL(match[1], MAIN_URL);

      if (
        parsed.origin === new URL(MAIN_URL).origin &&
        parsed.pathname.startsWith('/static/')
      ) {
        urls.add(parsed.href);
      }
    } catch {
      // 模板中无法解析的占位符不参与预取。
    }
  }

  return Array.from(urls);
}

/**
 * 从 Cubism model3.json 中提取首次加载可能用到的模型文件。
 *
 * @param {Record<string, unknown>} manifest
 * @param {string} manifestUrl
 * @returns {string[]}
 */
function extractLive2dAssetUrls(
  manifest,
  manifestUrl
) {
  const urls = new Set();
  const references =
    manifest?.FileReferences ||
    manifest?.fileReferences ||
    {};

  function addRelative(value) {
    if (typeof value !== 'string' || !value) {
      return;
    }

    try {
      const parsed = new URL(value, manifestUrl);

      if (
        parsed.origin === new URL(MAIN_URL).origin
      ) {
        urls.add(parsed.href);
      }
    } catch {
      // 忽略模型清单中无效的可选路径。
    }
  }

  addRelative(references.Moc);
  addRelative(references.Physics);
  addRelative(references.Pose);
  addRelative(references.UserData);
  addRelative(references.DisplayInfo);

  for (const texture of references.Textures || []) {
    addRelative(texture);
  }

  for (
    const expression of references.Expressions || []
  ) {
    addRelative(expression?.File);
  }

  for (
    const motionGroup of Object.values(
      references.Motions || {}
    )
  ) {
    if (!Array.isArray(motionGroup)) {
      continue;
    }

    for (const motion of motionGroup) {
      addRelative(motion?.File);
      addRelative(motion?.Sound);
    }
  }

  return Array.from(urls);
}

/**
 * 预取当前角色模型的清单和首屏依赖。
 *
 * 这里只执行无副作用的 GET，不创建角色实例、不连接聊天会话。
 *
 * @returns {Promise<{
 *   loaded: number,
 *   failed: number,
 *   bytes: number
 * }>}
 */
async function warmCurrentAvatarAssets() {
  const emptyResult = {
    loaded: 0,
    failed: 0,
    bytes: 0,
  };

  try {
    const pageConfigResult =
      await fetchUiWarmupResource(
        new URL(
          '/api/config/page_config',
          MAIN_URL
        ).href,
        'no-store'
      );
    const pageConfig = JSON.parse(
      pageConfigResult.text
    );
    const modelPath = pageConfig?.model_path;

    if (
      pageConfig?.success !== true ||
      typeof modelPath !== 'string' ||
      !modelPath
    ) {
      return emptyResult;
    }

    const modelUrl = new URL(
      modelPath,
      MAIN_URL
    );

    if (
      modelUrl.origin !== new URL(MAIN_URL).origin
    ) {
      return emptyResult;
    }

    const modelType = String(
      pageConfig.model_type || 'live2d'
    ).toLowerCase();

    if (
      modelType === 'live2d' &&
      (
        modelUrl.pathname.endsWith('.json') ||
        modelUrl.pathname.endsWith('.model3.json')
      )
    ) {
      const manifestResult =
        await fetchUiWarmupResource(
          modelUrl.href
        );
      const manifest = JSON.parse(
        manifestResult.text
      );
      const assetResult =
        await warmUiResourceList(
          extractLive2dAssetUrls(
            manifest,
            modelUrl.href
          )
        );

      return {
        loaded: assetResult.loaded + 1,
        failed: assetResult.failed,
        bytes:
          assetResult.bytes +
          manifestResult.bytes,
      };
    }

    const modelResult =
      await fetchUiWarmupResource(
        modelUrl.href
      );

    return {
      loaded: 1,
      failed: 0,
      bytes: modelResult.bytes,
    };
  } catch (error) {
    console.debug(
      '[Electron] 当前角色资源预取未完成：',
      error instanceof Error
        ? error.message
        : String(error)
    );

    return {
      loaded: 0,
      failed: 1,
      bytes: 0,
    };
  }
}

/**
 * 在 CONNECTING 动画期间预热主界面和当前角色资源。
 *
 * 多次调用复用同一个 Promise，避免重复读取大文件。
 */
function warmMainUiResources() {
  if (mainUiWarmupPromise) {
    return mainUiWarmupPromise;
  }

  const startedAt = Date.now();

  mainUiWarmupPromise = (async () => {
    const documentResult =
      await fetchUiWarmupResource(MAIN_URL);
    const staticUrls =
      extractMainUiStaticUrls(
        documentResult.text
      );
    const [
      staticResult,
      avatarResult,
    ] = await Promise.all([
      warmUiResourceList(staticUrls),
      warmCurrentAvatarAssets(),
    ]);

    const result = {
      success: true,
      durationMs: Date.now() - startedAt,
      documentBytes: documentResult.bytes,
      staticAssetCount: staticResult.loaded,
      avatarAssetCount: avatarResult.loaded,
      failedCount:
        staticResult.failed +
        avatarResult.failed,
      totalBytes:
        documentResult.bytes +
        staticResult.bytes +
        avatarResult.bytes,
    };

    console.log(
      '[Electron] CONNECTING 主界面预热完成：',
      result
    );

    return result;
  })().catch((error) => {
    mainUiWarmupPromise = null;
    console.warn(
      '[Electron] CONNECTING 主界面预热失败：',
      error
    );

    return {
      success: false,
      durationMs: Date.now() - startedAt,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  });

  return mainUiWarmupPromise;
}

/**
 * 把一帧 JPEG 发送给本机视觉服务并读取派生识别数据。
 *
 * @param {Uint8Array | ArrayBuffer} frameBytes
 * @returns {Promise<Record<string, unknown>>}
 */
function analyzeVisionFrame(frameBytes) {
  const frameBuffer = Buffer.from(frameBytes);

  if (
    frameBuffer.length <= 0 ||
    frameBuffer.length > MAX_VISION_FRAME_BYTES
  ) {
    return Promise.reject(
      new Error('摄像头帧大小无效。')
    );
  }

  return new Promise((resolve, reject) => {
    const target = new URL(VISION_ANALYZE_URL);
    let settled = false;

    const finishWithError = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': frameBuffer.length,
          'Cache-Control': 'no-store',
        },
      },
      (response) => {
        const chunks = [];
        let receivedBytes = 0;

        response.on('data', (chunk) => {
          receivedBytes += chunk.length;

          if (
            receivedBytes >
            MAX_VISION_RESPONSE_BYTES
          ) {
            request.destroy(
              new Error('视觉服务响应过大。')
            );
            return;
          }

          chunks.push(chunk);
        });

        response.once('end', () => {
          if (settled) {
            return;
          }

          const statusCode =
            response.statusCode || 0;
          const body = Buffer.concat(chunks)
            .toString('utf8');

          if (
            statusCode < 200 ||
            statusCode >= 300
          ) {
            finishWithError(
              new Error(
                `视觉服务返回 ${statusCode}：${body}`
              )
            );
            return;
          }

          try {
            const payload = JSON.parse(body);

            if (!payload || payload.ok !== true) {
              finishWithError(
                new Error('视觉服务返回无效数据。')
              );
              return;
            }

            settled = true;
            resolve(payload);
          } catch (error) {
            finishWithError(error);
          }
        });
      }
    );

    request.setTimeout(
      VISION_REQUEST_TIMEOUT_MS,
      () => {
        request.destroy(
          new Error('视觉识别请求超时。')
        );
      }
    );

    request.once('error', finishWithError);
    request.end(frameBuffer);
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

/**
 * 更新 CONNECT 页面可见的真实视觉启动状态。
 *
 * @param {string} phase
 * @param {string} message
 * @param {string} [kind]
 * @param {object} [options]
 */
function setVisionStartupStatus(
  phase,
  message,
  kind = '',
  options = {}
) {
  visionStartupStatus = Object.freeze({
    phase: String(phase || 'UNKNOWN'),
    message: String(message || ''),
    kind: String(kind || ''),
    ready: options.ready === true,
    error:
      options.error == null
        ? null
        : String(options.error),
    updatedAt: Date.now(),
  });

  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed()
  ) {
    mainWindow.webContents.send(
      'neko:vision-status',
      visionStartupStatus
    );
  }

  return visionStartupStatus;
}

/**
 * 解析视觉进程通过 stdout 发出的模型加载阶段。
 *
 * @param {string} line
 */
function handleVisionServiceOutputLine(line) {
  const prefix = 'NEKO_VISION_STATUS:';

  if (!line.startsWith(prefix)) {
    return;
  }

  try {
    const payload = JSON.parse(
      line.slice(prefix.length)
    );

    setVisionStartupStatus(
      payload.phase,
      payload.message,
      payload.kind,
      {
        ready:
          payload.phase === 'VISION_SERVICE_READY',
      }
    );
  } catch (error) {
    console.warn(
      '[Electron] 无法解析视觉服务状态：',
      line,
      error
    );
  }
}

/* ============================================================
 * Python 后端管理
 * ============================================================
 */

/**
 * 检查项目目录和 Python 环境。
 */
function validateBackendEnvironment() {
  if (!fs.existsSync(PROJECT_DIR)) {
    throw new Error(
      [
        '找不到 N.E.K.O 项目目录：',
        PROJECT_DIR,
        '',
        '请确认项目仍然位于：',
        '~/Projects/N.E.K.O',
      ].join('\n')
    );
  }

  if (!fs.existsSync(PYTHON_PATH)) {
    throw new Error(
      [
        '找不到 N.E.K.O Python 虚拟环境：',
        PYTHON_PATH,
        '',
        '请确认项目中的 .venv 没有被删除。',
      ].join('\n')
    );
  }

  try {
    fs.accessSync(PYTHON_PATH, fs.constants.X_OK);
  } catch {
    throw new Error(
      [
        'N.E.K.O Python 文件没有执行权限：',
        PYTHON_PATH,
        '',
        '可以在终端执行：',
        `chmod +x "${PYTHON_PATH}"`,
      ].join('\n')
    );
  }
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
    PYTHON_PATH,
    ['-m', moduleName],
    {
      cwd: PROJECT_DIR,

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
 * 启动本地视觉服务。该进程不打开摄像头，只分析 Electron 发送的帧。
 */
function startVisionService() {
  const serviceName = 'vision';

  if (startedProcesses.has(serviceName)) {
    return startedProcesses.get(serviceName);
  }

  fs.mkdirSync(LOG_DIR, {
    recursive: true,
  });

  const logPath = path.join(
    LOG_DIR,
    'vision_service-electron.log'
  );
  const logFileDescriptor = fs.openSync(
    logPath,
    'a'
  );

  console.log(
    `[Electron] 正在启动视觉服务：${VISION_SERVICE_PATH}`
  );
  setVisionStartupStatus(
    'PYTHON_RUNTIME_LOADING',
    '[VISION] starting isolated .venv-vision Python runtime'
  );

  const child = spawn(
    VISION_PYTHON_PATH,
    [
      VISION_SERVICE_PATH,
      '--project-dir',
      PROJECT_DIR,
      '--port',
      '48913',
    ],
    {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        NEKO_PROJECT_DIR: PROJECT_DIR,
        NEKO_VISION_PORT: '48913',
      },
      stdio: [
        'ignore',
        'pipe',
        logFileDescriptor,
      ],
      detached: false,
    }
  );

  startedProcesses.set(serviceName, child);
  let stdoutBuffer = '';

  child.stdout?.on('data', (chunk) => {
    try {
      fs.writeSync(logFileDescriptor, chunk);
    } catch {
      // 退出过程中日志文件可能已经关闭。
    }

    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      handleVisionServiceOutputLine(line.trim());
    }
  });

  child.stdout?.once('end', () => {
    if (stdoutBuffer.trim()) {
      handleVisionServiceOutputLine(
        stdoutBuffer.trim()
      );
      stdoutBuffer = '';
    }
  });

  child.once('spawn', () => {
    console.log(
      `[Electron] 视觉服务已创建，PID=${child.pid}`
    );
  });

  child.once('error', (error) => {
    console.error(
      '[Electron] 视觉服务启动失败：',
      error
    );
    setVisionStartupStatus(
      'VISION_SERVICE_ERROR',
      '[ERROR] failed to start local vision process',
      'warn',
      {
        error,
      }
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
      '[Electron] 视觉服务已退出，' +
      `code=${code}, signal=${signal}`
    );

    if (!isQuitting && !resetInProgress) {
      setVisionStartupStatus(
        'VISION_SERVICE_ERROR',
        '[ERROR] local vision process exited unexpectedly',
        'warn',
        {
          error:
            `code=${code}, signal=${signal}`,
        }
      );
    }

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
 * 确保独立视觉环境、模型和本地服务可用。
 */
async function ensureVisionService() {
  setVisionStartupStatus(
    'ENVIRONMENT_CHECKING',
    '[VISION] checking isolated environment and loopback service'
  );

  if (await checkUrl(VISION_URL)) {
    console.log(
      '[Electron] 视觉服务已经运行，直接复用。'
    );
    setVisionStartupStatus(
      'VISION_SERVICE_READY',
      '[OK] existing local vision service is ready',
      'ok',
      {
        ready: true,
      }
    );
    return;
  }

  if (!fs.existsSync(VISION_PYTHON_PATH)) {
    throw new Error(
      [
        '找不到视觉模块 Python 环境：',
        VISION_PYTHON_PATH,
      ].join('\n')
    );
  }

  if (!fs.existsSync(VISION_SERVICE_PATH)) {
    throw new Error(
      [
        '找不到视觉服务脚本：',
        VISION_SERVICE_PATH,
      ].join('\n')
    );
  }

  setVisionStartupStatus(
    'ENVIRONMENT_READY',
    '[OK] .venv-vision and local service entrypoint verified',
    'ok'
  );
  startVisionService();

  const ready = await waitForUrl(
    VISION_URL,
    VISION_START_TIMEOUT_MS
  );

  if (!ready) {
    throw new Error(
      [
        '视觉服务启动超时。',
        '',
        '日志位置：',
        path.join(
          LOG_DIR,
          'vision_service-electron.log'
        ),
      ].join('\n')
    );
  }

  console.log('[Electron] 视觉服务已准备好。');
  setVisionStartupStatus(
    'VISION_SERVICE_READY',
    '[OK] face, pose, and hand models ready on loopback:48913',
    'ok',
    {
      ready: true,
    }
  );
}

/**
 * 只在用户点击 CONNECT 后启动视觉环境和模型。
 *
 * 多次调用会复用同一个启动 Promise，避免重复加载模型。
 */
function prepareVisionAfterConnect() {
  if (visionStartupStatus.ready) {
    return Promise.resolve({
      success: true,
      status: visionStartupStatus,
    });
  }

  if (visionStartupPromise) {
    return visionStartupPromise;
  }

  visionStartupPromise = ensureVisionService()
    .then(() => ({
      success: true,
      status: visionStartupStatus,
    }))
    .catch((error) => {
      console.error(
        '[Electron] CONNECT 后视觉服务启动失败：',
        error
      );

      setVisionStartupStatus(
        'VISION_SERVICE_ERROR',
        '[ERROR] local face / pose / hand models failed to initialize',
        'warn',
        {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        }
      );

      visionStartupPromise = null;

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
        status: visionStartupStatus,
      };
    });

  return visionStartupPromise;
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
  validateBackendEnvironment();

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

    .system-mark img {
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
      object-fit: cover;
      filter:
        invert(1)
        grayscale(1)
        brightness(1.75)
        contrast(1.22);
      mix-blend-mode: screen;
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
        <img
          src="${BRAND_LOGO_DATA_URL}"
          alt=""
          aria-hidden="true"
        >
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
      var terminalSequence = 0;
      var bootstrapCameraStream = null;

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

      function appendTerminalLine(item) {
        var line = document.createElement("div");
        var index = terminalSequence;
        var timestamp = new Date()
          .toISOString()
          .slice(11, 23);

        terminalSequence += 1;

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

      function appendLiveTerminalLine(
        cursor,
        item
      ) {
        if (cursor.parentNode) {
          cursor.remove();
        }

        appendTerminalLine(item);
        terminalOutput.appendChild(cursor);
      }

      async function prepareMainInterface(
        cursor
      ) {
        appendLiveTerminalLine(
          cursor,
          record(
            "INTERACTION LAYER",
            "[UI] prefetching main shell, static runtimes and current avatar assets",
            "sync",
            0
          )
        );

        try {
          if (
            !window.nekoDesktop ||
            !window.nekoDesktop.warmMainUi
          ) {
            throw new Error(
              "desktop UI warmup bridge unavailable"
            );
          }

          var result =
            await window.nekoDesktop.warmMainUi();

          if (!result || result.success !== true) {
            throw new Error(
              result && result.error
                ? result.error
                : "unknown warmup error"
            );
          }

          var totalAssetCount =
            Number(result.staticAssetCount || 0) +
            Number(result.avatarAssetCount || 0);
          var totalMegabytes =
            Number(result.totalBytes || 0) /
            1024 /
            1024;

          appendLiveTerminalLine(
            cursor,
            record(
              "INTERACTION LAYER",
              "[OK] UI cache primed // " +
                totalAssetCount +
                " assets // " +
                totalMegabytes.toFixed(1) +
                " MB // " +
                Math.round(
                  Number(result.durationMs) || 0
                ) +
                " MS",
              "ok",
              0
            )
          );

          if (Number(result.failedCount || 0) > 0) {
            appendLiveTerminalLine(
              cursor,
              record(
                "INTERACTION LAYER",
                "[WARN] optional UI assets deferred // count=" +
                  Number(result.failedCount || 0),
                "warn",
                0
              )
            );
          }

          return result;
        } catch (error) {
          appendLiveTerminalLine(
            cursor,
            record(
              "INTERACTION LAYER",
              "[WARN] UI cache warmup deferred: " +
                String(
                  error && error.message
                    ? error.message
                    : error
                ),
              "warn",
              0
            )
          );

          return {
            success: false,
          };
        }
      }

      async function prepareVisionAndCamera(
        cursor
      ) {
        var lastStatusToken = "";
        var stopListening = function () {};

        function showVisionStatus(status) {
          if (!status || !status.phase) {
            return;
          }

          var token =
            status.phase +
            ":" +
            String(status.updatedAt || "");

          if (token === lastStatusToken) {
            return;
          }

          lastStatusToken = token;
          connectionPhase.textContent =
            "LOCAL VISION / " + status.phase;
          statusText.textContent =
            status.message ||
            "LOCAL VISION INITIALIZING";

          appendLiveTerminalLine(
            cursor,
            record(
              "LOCAL VISION",
              status.message ||
                "[VISION] state=" + status.phase,
              status.kind || "",
              0
            )
          );
        }

        try {
          if (
            !window.nekoDesktop ||
            !window.nekoDesktop.startVision
          ) {
            throw new Error(
              "desktop vision bridge unavailable"
            );
          }

          if (
            window.nekoDesktop.onVisionStatus
          ) {
            stopListening =
              window.nekoDesktop.onVisionStatus(
                showVisionStatus
              ) || function () {};
          }

          if (
            window.nekoDesktop.getVisionStatus
          ) {
            showVisionStatus(
              await window.nekoDesktop
                .getVisionStatus()
            );
          }

          var visionResult =
            await window.nekoDesktop.startVision();

          if (!visionResult.success) {
            appendLiveTerminalLine(
              cursor,
              record(
                "LOCAL VISION",
                "[WARN] face / pose service unavailable: " +
                  String(
                    visionResult.error ||
                    "unknown error"
                  ),
                "warn",
                0
              )
            );
          }
        } catch (error) {
          appendLiveTerminalLine(
            cursor,
            record(
              "LOCAL VISION",
              "[WARN] vision initialization error: " +
                String(
                  error && error.message
                    ? error.message
                    : error
                ),
              "warn",
              0
            )
          );
        } finally {
          stopListening();
        }

        connectionPhase.textContent =
          "CAMERA / REQUESTING LOCAL DEVICE";
        statusText.textContent =
          "REQUESTING CAMERA AFTER OPERATOR CONNECTION";
        appendLiveTerminalLine(
          cursor,
          record(
            "CAMERA",
            "[CAM] requesting local camera permission after CONNECT",
            "sync",
            0
          )
        );

        try {
          bootstrapCameraStream =
            await navigator.mediaDevices
              .getUserMedia({
                audio: false,
                video: {
                  width: {
                    ideal: 640,
                  },
                  height: {
                    ideal: 360,
                  },
                  frameRate: {
                    ideal: 24,
                    max: 30,
                  },
                  facingMode: "user",
                },
              });

          var cameraTrack =
            bootstrapCameraStream
              .getVideoTracks()[0];
          var cameraSettings =
            cameraTrack.getSettings();
          var cameraWidth =
            cameraSettings.width || 0;
          var cameraHeight =
            cameraSettings.height || 0;
          var cameraFps =
            cameraSettings.frameRate || 0;

          appendLiveTerminalLine(
            cursor,
            record(
              "CAMERA",
              "[OK] camera stream live // " +
                cameraWidth +
                "x" +
                cameraHeight +
                " @ " +
                Number(cameraFps).toFixed(1) +
                " FPS // track=" +
                cameraTrack.readyState.toUpperCase(),
              "ok",
              0
            )
          );
          statusText.textContent =
            "CAMERA LIVE // LOCAL VISION READY";

          return {
            visionReady: true,
            cameraReady: true,
          };
        } catch (error) {
          appendLiveTerminalLine(
            cursor,
            record(
              "CAMERA",
              "[WARN] camera unavailable: " +
                String(
                  error && error.name
                    ? error.name
                    : error
                ),
              "warn",
              0
            )
          );
          statusText.textContent =
            "CAMERA UNAVAILABLE // CONTINUING";

          return {
            visionReady: true,
            cameraReady: false,
          };
        }
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

        var mainUiPreparation =
          prepareMainInterface(cursor);
        var visionPreparation =
          prepareVisionAndCamera(cursor);

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

        await Promise.all([
          mainUiPreparation,
          visionPreparation,
        ]);

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

        if (bootstrapCameraStream) {
          bootstrapCameraStream
            .getTracks()
            .forEach(function (track) {
              track.stop();
            });
          bootstrapCameraStream = null;
        }

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
        isInternalPage(requestingUrl) &&
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
        isInternalPage(requestingUrl) &&
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
      // 摄像头追踪必须在窗口短暂失焦（例如截屏或切到聊天窗口）时
      // 继续以正常频率运行。Chromium 默认会把后台页面计时器降到约
      // 1~2 秒一次，这会让人脸目标在两帧之间失效并反复回正。
      backgroundThrottling: false,
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

app.setName('N.E.K.O');

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

      ipcMain.handle(
        'neko:get-brand-logo',
        (event) => {
          const senderUrl =
            event.senderFrame?.url ||
            event.sender?.getURL() ||
            '';

          if (!isInternalPage(senderUrl)) {
            throw new Error(
              '已阻止外部页面读取品牌资源。'
            );
          }

          return BRAND_LOGO_DATA_URL;
        }
      );

      ipcMain.handle(
        'neko:warm-main-ui',
        (event) => {
          const senderUrl =
            event.senderFrame?.url ||
            event.sender?.getURL() ||
            '';

          if (!isInternalPage(senderUrl)) {
            throw new Error(
              '已阻止外部页面预热主界面资源。'
            );
          }

          return warmMainUiResources();
        }
      );

      ipcMain.handle(
        'neko:start-vision',
        (event) => {
          const senderUrl =
            event.senderFrame?.url ||
            event.sender?.getURL() ||
            '';

          if (!isInternalPage(senderUrl)) {
            throw new Error(
              '已阻止外部页面启动视觉服务。'
            );
          }

          return prepareVisionAfterConnect();
        }
      );

      ipcMain.handle(
        'neko:get-vision-status',
        (event) => {
          const senderUrl =
            event.senderFrame?.url ||
            event.sender?.getURL() ||
            '';

          if (!isInternalPage(senderUrl)) {
            throw new Error(
              '已阻止外部页面读取视觉状态。'
            );
          }

          return visionStartupStatus;
        }
      );

      ipcMain.handle(
        'neko:vision-analyze',
        (event, frameBytes) => {
          const senderUrl =
            event.senderFrame?.url ||
            event.sender?.getURL() ||
            '';

          if (!isNekoUrl(senderUrl)) {
            throw new Error(
              '已阻止非 N.E.K.O 页面访问视觉服务。'
            );
          }

          return analyzeVisionFrame(frameBytes);
        }
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
