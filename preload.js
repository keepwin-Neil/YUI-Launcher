'use strict';

const {
  contextBridge,
  ipcRenderer,
  webFrame,
} = require('electron');

const SESSION_DURATION_MS = 2 * 60 * 1000;
const VISION_CAPTURE_WIDTH = 960;
const VISION_CAPTURE_HEIGHT = 540;
const VISION_ANALYSIS_INTERVAL_MS = 90;
const VISION_OBSERVATION_STABLE_MS = 800;
const VISION_OBSERVATION_MIN_SEND_MS = 1000;
const VISION_OBSERVATION_HEARTBEAT_MS = 5000;
const VISION_HAND_SMOOTHING_ALPHA = 0.42;
const VISION_HAND_VELOCITY_ALPHA = 0.45;
const VISION_GAZE_MIN_SEND_MS = 55;
const VISION_FACE_TRACKING_MIN_CONFIDENCE = 0.16;
const VISION_FACE_LANDMARK_MIN_CONFIDENCE = 0.28;
const VISION_FACE_MIN_RELIABLE_LANDMARKS = 8;
const VISION_BRIDGE_SOURCE = 'neko-desktop-vision';
const VISION_PAGE_SOURCE = 'neko-page-vision';
const POSE_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
];
const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];
const FACE_FEATURE_PATHS = [
  {
    indices: [17, 18, 19, 20, 21],
    closed: false,
  },
  {
    indices: [22, 23, 24, 25, 26],
    closed: false,
  },
  {
    indices: [27, 28, 29, 30],
    closed: false,
  },
  {
    indices: [31, 32, 33, 34, 35],
    closed: false,
  },
  {
    indices: [36, 37, 38, 39, 40, 41],
    closed: true,
  },
  {
    indices: [42, 43, 44, 45, 46, 47],
    closed: true,
  },
  {
    indices: [
      48, 49, 50, 51, 52, 53,
      54, 55, 56, 57, 58, 59,
    ],
    closed: true,
  },
  {
    indices: [60, 61, 62, 63, 64, 65],
    closed: true,
  },
];
const FACE_CONTOUR_INDICES = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12, 13, 14, 15, 16,
]);
const FACE_FEATURE_INDICES = new Set(
  [
    ...FACE_CONTOUR_INDICES,
    ...FACE_FEATURE_PATHS.flatMap(
      (feature) => feature.indices
    ),
  ]
);
let startupCollapseCssKey = null;

/**
 * 用户提供的 N.E.K.O Logo。内嵌后打包 App 不依赖 Downloads 目录。
 */
const LOGO_DATA_URL =
  'data:image/webp;base64,UklGRnQEAABXRUJQVlA4WAoAAAAgAAAAfwAAfwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDgghgIAAJARAJ0BKoAAgAA+kUSdS6WjoqGiFAsQsBIJZwDWFcz84stfBXvplbXDrWv7A2eatDOmXn/3HxD7+EFrqi4lIdSmWueSH4mi3KkwM2IvfR8HErN3gDybw0sGX9U/9FXC72UiD4+6aI4kquAZXk8u1r34OKXayx9f8Zn7SWA84/wDvxXXwgtob/S4jjHhYWg51Z3neMoAAP76kAAL7mF+khqDB7Sn865LfW2g2tgEgSNrUaqgMOEwjQsxXyW23o/SYBo1KqMjaeO0Fs21VJwTRU6f+alF29GACTl/XH7fk/ADflDUMfmYkOwP9KZnzSRBIdUo53QNLKjxuFGXtyOs21hGy/xRR4xHjbsqeQ7kuxccfFxkArS6Nr6kYfqIuIRa4MEnVs5B2exP7lCjDQ7X+AUZ9XQtcQ9CbQMWa9KVmgGBAVzWtT/wvWktP2UBDyvfj77oeik/dO+yIsgnGLfpcrCsdferO+yCQtavq3Isg6wOnO7UOKUktUbAA4PwtiF0sGHMRKFp9f4Xemd4IJKcCMGNmKDALHe3JgvBUkJ6RNA0EeMYKTpKLlbHs53fiMgJEGB+JPH3MR89/w9rr6PD5SNbCDmk/RLrfZgzSbrJQxqCHWVUXwP9rkTxgXeZwM+6r2ra5+hhb+pZBe6O9tmL+51VZgc8GXJEMrmCkPqUmzNCCh1+bMVBh9Q6ar+UAjGNCM1XhCs0133W+pHiRiVEQymhliOfd6O+SgPlnMOU3SwX9Nc+nz9y+9Ma5vqFXoOm1cOVvYjoE9meLG99na+VH8nu+ehLgKupS8sHerWsvGf9qB3DRLDrDIAFhUKpBmtAC6FgHVg9LRmExNuR+gokcepT9VgAAAA=';

contextBridge.exposeInMainWorld(
  'nekoDesktop',
  {
    resetApp: () =>
      ipcRenderer.invoke('neko:reset-app'),
    warmMainUi: () =>
      ipcRenderer.invoke('neko:warm-main-ui'),
    startVision: () =>
      ipcRenderer.invoke('neko:start-vision'),
    getVisionStatus: () =>
      ipcRenderer.invoke('neko:get-vision-status'),
    onVisionStatus: (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }

      const listener = (_event, status) => {
        callback(status);
      };

      ipcRenderer.on(
        'neko:vision-status',
        listener
      );

      return () => {
        ipcRenderer.removeListener(
          'neko:vision-status',
          listener
        );
      };
    },
  }
);

function isNekoPage() {
  return (
    window.location.protocol === 'http:' &&
    (
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === 'localhost'
    )
  );
}

function formatCountdown(milliseconds) {
  const clamped = Math.max(
    0,
    Math.ceil(milliseconds / 1000)
  );
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;

  return `00:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * preload 在页面脚本和首帧绘制之前执行。
 * 先隐藏“尚未收起”的聊天界面和角色工具栏，避免启动时闪现展开态。
 */
function installStartupCollapseShield() {
  if (startupCollapseCssKey) {
    return;
  }

  startupCollapseCssKey = webFrame.insertCSS(`
    #chat-container:not(.minimized):not(.mobile-collapsed),
    #react-chat-window-shell:not(.is-minimized),
    [id$="-floating-buttons"] {
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `);
}

function releaseStartupCollapseShield() {
  if (startupCollapseCssKey) {
    const cssKey = startupCollapseCssKey;
    startupCollapseCssKey = null;

    void Promise.resolve(
      webFrame.removeInsertedCSS(cssKey)
    ).catch(() => {});
  }

  document.body?.classList.remove(
    'neko-desktop-startup-collapsed'
  );
}

/**
 * 让角色页面以参考图中的精简状态启动：
 * - 聊天框通过项目原生按钮收起为毛线球；
 * - 角色锁定，右侧浮动工具栏保持收起。
 *
 * 这里触发现有交互逻辑，而不是永久用 CSS 隐藏，
 * 所以用户之后仍可点击毛线球或锁图标重新展开。
 */
function applyDefaultAvatarUiState() {
  if (
    !document.body ||
    document.body.dataset.nekoDesktopDefaultsApplied ===
      'true'
  ) {
    return;
  }

  document.body.dataset.nekoDesktopDefaultsApplied =
    'true';
  document.body.classList.add(
    'neko-desktop-startup-collapsed'
  );

  const statusToast =
    document.getElementById('status-toast');

  if (statusToast) {
    const suppressYuiStartedToast = () => {
      const text = (
        statusToast.textContent || ''
      ).trim();

      if (
        !/^yui\s*(?:started|已启动|已啓動)$/i.test(
          text
        )
      ) {
        return false;
      }

      statusToast.classList.remove('show');
      statusToast.classList.add('hide');
      statusToast.style.display = 'none';
      statusToast.textContent = '';
      return true;
    };

    const toastObserver = new MutationObserver(
      () => {
        if (suppressYuiStartedToast()) {
          toastObserver.disconnect();
        }
      }
    );

    toastObserver.observe(statusToast, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    window.setTimeout(
      () => {
        toastObserver.disconnect();
      },
      8000
    );
  }

  window.setTimeout(
    () => {
      const chatContainer =
        document.getElementById('chat-container');
      const toggleButton =
        document.getElementById('toggle-chat-btn');

      if (
        chatContainer &&
        toggleButton &&
        !chatContainer.classList.contains('minimized') &&
        !chatContainer.classList.contains(
          'mobile-collapsed'
        )
      ) {
        toggleButton.click();
      }
    },
    120
  );

  let reactChatDefaultCollapsed = false;

  function collapseReactChat(root = document) {
    if (reactChatDefaultCollapsed) {
      return;
    }

    const minimizeButton =
      root instanceof Element &&
      root.matches('.compact-chat-minimize-ball')
        ? root
        : root.querySelector?.(
            '.compact-chat-minimize-ball'
          );

    if (!minimizeButton) {
      return;
    }

    reactChatDefaultCollapsed = true;

    window.setTimeout(
      () => {
        if (minimizeButton.isConnected) {
          minimizeButton.click();
        }
      },
      120
    );
  }

  function lockAndCollapseToolbar(toolbar) {
    if (
      !toolbar ||
      toolbar.dataset.nekoDesktopDefaultCollapsed ===
        'true'
    ) {
      return;
    }

    toolbar.dataset.nekoDesktopDefaultCollapsed =
      'true';

    const applyInitialLock = () => {
      if (!toolbar.isConnected) {
        return;
      }

      const prefix = toolbar.id.replace(
        /-floating-buttons$/,
        ''
      );
      const lockIcon = document.getElementById(
        `${prefix}-lock-icon`
      );

      if (lockIcon) {
        const lockedImage = lockIcon.querySelector(
          'img[alt="Locked"]'
        );
        const backgroundImage =
          lockIcon.style.backgroundImage || '';
        const alreadyLocked = lockedImage
          ? Number.parseFloat(
              lockedImage.style.opacity || '0'
            ) >= 0.5
          : backgroundImage.includes(
              '/locked_icon'
            );

        if (!alreadyLocked) {
          if (
            prefix === 'vrm' ||
            prefix === 'mmd'
          ) {
            lockIcon.dispatchEvent(
              new MouseEvent(
                'mousedown',
                {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }
              )
            );
          } else {
            lockIcon.click();
          }
        }
      }

      toolbar.style.setProperty(
        'display',
        'none',
        'important'
      );
    };

    window.setTimeout(
      applyInitialLock,
      350
    );

    /**
     * 模型初始化链会在首轮锁定之后再次写入 toolbar display。
     * 延后只同步隐藏状态，不重复点击锁，避免把角色反向解锁。
     */
    [
      900,
      1800,
    ].forEach((delay) => {
      window.setTimeout(
        () => {
          if (toolbar.isConnected) {
            toolbar.style.setProperty(
              'display',
              'none',
              'important'
            );

            if (delay === 1800) {
              releaseStartupCollapseShield();
            }
          }
        },
        delay
      );
    });
  }

  function scanForDefaultUi(root = document) {
    collapseReactChat(root);

    if (
      root instanceof Element &&
      root.matches('[id$="-floating-buttons"]')
    ) {
      lockAndCollapseToolbar(root);
    }

    root
      .querySelectorAll?.(
        '[id$="-floating-buttons"]'
      )
      .forEach(lockAndCollapseToolbar);
  }

  scanForDefaultUi();

  const observer = new MutationObserver(
    (mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            scanForDefaultUi(node);
          }
        });
      });
    }
  );

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener(
    'beforeunload',
    () => {
      observer.disconnect();
    },
    {
      once: true,
    }
  );

  window.setTimeout(
    releaseStartupCollapseShield,
    6000
  );
}

function createHud() {
  if (
    !isNekoPage() ||
    document.getElementById('neko-cinematic-hud')
  ) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'neko-cinematic-hud-style';
  style.textContent = `
    :root {
      --neko-hud-ink: rgba(231, 249, 239, 0.92);
      --neko-hud-soft: rgba(210, 238, 226, 0.62);
      --neko-hud-faint: rgba(198, 229, 218, 0.26);
      --neko-hud-line: rgba(224, 248, 236, 0.68);
      --neko-hud-glass: rgba(31, 57, 57, 0.38);
      --neko-hud-deep: rgba(18, 42, 43, 0.84);
      --neko-hud-alert: #ce7f62;
    }

    #neko-cinematic-hud,
    #neko-cinematic-hud * {
      box-sizing: border-box;
    }

    body.neko-desktop-startup-collapsed
      [id$="-floating-buttons"] {
      display: none !important;
    }

    #neko-cinematic-hud {
      position: fixed;
      inset: 0;
      z-index: 2147483600;
      color: var(--neko-hud-ink);
      font-family:
        "Arial Narrow",
        "Avenir Next Condensed",
        "Helvetica Neue",
        Arial,
        sans-serif;
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.055em;
      line-height: 1.2;
      pointer-events: none;
      text-transform: uppercase;
      text-shadow:
        0 0 8px rgba(224, 255, 241, 0.38),
        0 1px 1px rgba(11, 29, 29, 0.7);
    }

    #neko-cinematic-hud::before {
      position: absolute;
      inset: 0;
      content: "";
      background:
        linear-gradient(
          90deg,
          rgba(26, 66, 63, 0.16),
          transparent 18%,
          transparent 82%,
          rgba(26, 66, 63, 0.16)
        ),
        repeating-linear-gradient(
          to bottom,
          rgba(225, 255, 242, 0.018) 0,
          rgba(225, 255, 242, 0.018) 1px,
          transparent 1px,
          transparent 4px
        ),
        radial-gradient(
          circle at 50% 42%,
          transparent 46%,
          rgba(17, 48, 46, 0.14) 100%
        );
      box-shadow:
        inset 0 0 110px rgba(19, 55, 52, 0.22),
        inset 0 0 0 1px rgba(225, 255, 243, 0.08);
      pointer-events: none;
    }

    .neko-hud__top {
      position: absolute;
      top: 23px;
      left: 32px;
      right: 32px;
      display: grid;
      grid-template-columns: minmax(176px, 0.8fr) repeat(4, minmax(130px, 1fr));
      min-height: 66px;
      border-bottom: 2px solid var(--neko-hud-line);
      box-shadow: 0 8px 18px rgba(14, 35, 34, 0.14);
    }

    .neko-hud__brand,
    .neko-hud__top-stat {
      display: flex;
      position: relative;
      min-width: 0;
      align-items: center;
    }

    .neko-hud__brand {
      gap: 12px;
      padding: 0 14px 10px 5px;
    }

    .neko-hud__brand::after,
    .neko-hud__top-stat::after {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 8px;
      width: 1px;
      content: "";
      background: linear-gradient(
        transparent,
        rgba(225, 249, 238, 0.28),
        transparent
      );
    }

    .neko-hud__logo {
      width: 50px;
      height: 50px;
      flex: 0 0 auto;
      object-fit: cover;
      filter: invert(1) grayscale(1) brightness(1.65) contrast(1.2);
      mix-blend-mode: screen;
      opacity: 0.96;
    }

    .neko-hud__brand-copy {
      min-width: 0;
    }

    .neko-hud__brand-name {
      display: block;
      margin-bottom: 4px;
      overflow: hidden;
      color: rgba(240, 255, 247, 0.96);
      font-size: 16px;
      letter-spacing: 0.17em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .neko-hud__eyebrow,
    .neko-hud__label,
    .neko-hud__micro {
      color: var(--neko-hud-soft);
      font-size: 9px;
      letter-spacing: 0.11em;
    }

    .neko-hud__top-stat {
      justify-content: center;
      gap: 9px;
      padding: 0 13px 9px;
      text-align: center;
    }

    .neko-hud__top-stat-value {
      min-width: 47px;
      padding: 5px 8px;
      border: 1px solid rgba(223, 248, 236, 0.16);
      background: rgba(215, 240, 229, 0.1);
      box-shadow: inset 0 0 10px rgba(219, 251, 238, 0.06);
      color: rgba(241, 255, 248, 0.93);
      font-size: 11px;
    }

    .neko-hud__left,
    .neko-hud__right {
      position: absolute;
      top: 118px;
      bottom: 148px;
      display: flex;
      width: min(272px, 22vw);
      flex-direction: column;
      justify-content: space-between;
    }

    .neko-hud__left {
      left: 32px;
    }

    .neko-hud__right {
      right: 32px;
      align-items: stretch;
    }

    .neko-hud__panel {
      position: relative;
      padding-top: 23px;
    }

    .neko-hud__panel-title {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 21px;
      padding: 4px 9px;
      border: 1px solid var(--neko-hud-line);
      background: rgba(35, 66, 64, 0.2);
      color: rgba(238, 254, 246, 0.92);
      font-size: 10px;
      letter-spacing: 0.085em;
    }

    .neko-hud__rows {
      padding: 8px 9px 5px;
      background: linear-gradient(
        90deg,
        rgba(26, 58, 57, 0.24),
        transparent
      );
    }

    .neko-hud__row {
      display: flex;
      min-height: 24px;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid rgba(221, 246, 234, 0.035);
    }

    .neko-hud__row:last-child {
      border-bottom: 0;
    }

    .neko-hud__value {
      color: rgba(239, 255, 247, 0.85);
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }

    .neko-hud__value--box {
      min-width: 52px;
      padding: 3px 6px;
      background: rgba(222, 244, 233, 0.14);
      color: rgba(245, 255, 250, 0.94);
      text-align: center;
    }

    .neko-hud__recognition {
      min-height: 272px;
      padding: 16px;
      border:
        1px solid rgba(222, 248, 235, 0.42);
      background:
        linear-gradient(
          rgba(39, 75, 72, 0.22),
          rgba(20, 49, 48, 0.34)
        );
      clip-path: polygon(
        0 12px,
        12px 0,
        100% 0,
        100% calc(100% - 12px),
        calc(100% - 12px) 100%,
        0 100%
      );
    }

    .neko-hud__recognition-grid {
      position: relative;
      height: 135px;
      margin-bottom: 13px;
      border: 1px solid rgba(222, 248, 235, 0.18);
      background:
        linear-gradient(
          rgba(218, 247, 234, 0.08) 1px,
          transparent 1px
        ),
        linear-gradient(
          90deg,
          rgba(218, 247, 234, 0.08) 1px,
          transparent 1px
        );
      background-size: 18px 18px;
      overflow: hidden;
    }

    .neko-hud__vision-video,
    .neko-hud__vision-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transform: scaleX(-1);
    }

    .neko-hud__vision-video {
      z-index: 1;
      background: rgba(7, 18, 18, 0.92);
      object-fit: cover;
      opacity: 0;
      transition: opacity 180ms ease;
    }

    .neko-hud__recognition-grid.has-video
      .neko-hud__vision-video {
      opacity: 0.82;
    }

    .neko-hud__vision-overlay {
      z-index: 2;
      object-fit: cover;
    }

    .neko-hud__vision-capture {
      display: none;
    }

    .neko-hud__vision-placeholder {
      position: absolute;
      z-index: 3;
      inset: 0;
      display: grid;
      place-items: center;
      background: rgba(10, 27, 27, 0.38);
      color: rgba(225, 248, 237, 0.58);
      font-size: 9px;
      letter-spacing: 0.13em;
      text-align: center;
    }

    .neko-hud__recognition-grid.has-video
      .neko-hud__vision-placeholder {
      opacity: 0;
    }

    #neko-cinematic-hud[data-vision-display="off"]
      .neko-hud__vision-video,
    .neko-hud__recognition-grid.is-display-hidden
      .neko-hud__vision-video {
      opacity: 0 !important;
      visibility: hidden !important;
    }

    .neko-hud__recognition-grid.is-display-hidden
      .neko-hud__vision-placeholder {
      opacity: 1;
    }

    .neko-hud__vision-controls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: -5px 0 8px;
    }

    .neko-hud__vision-toggle,
    .neko-hud__display-toggle,
    .neko-hud__ai-scan {
      display: flex;
      min-width: 0;
      height: 25px;
      padding: 0 8px;
      border: 1px solid rgba(225, 248, 237, 0.42);
      align-items: center;
      justify-content: center;
      background: rgba(15, 38, 38, 0.8);
      box-shadow:
        0 0 12px rgba(8, 25, 24, 0.42),
        inset 0 0 9px rgba(220, 250, 237, 0.05);
      color: rgba(235, 253, 244, 0.88);
      cursor: pointer;
      font: inherit;
      font-size: 8px;
      letter-spacing: 0.1em;
      pointer-events: auto;
      text-transform: uppercase;
    }

    .neko-hud__vision-toggle:hover,
    .neko-hud__display-toggle:hover,
    .neko-hud__ai-scan:hover {
      border-color: rgba(235, 255, 245, 0.76);
      background: rgba(31, 65, 62, 0.9);
    }

    .neko-hud__vision-toggle:focus-visible,
    .neko-hud__display-toggle:focus-visible,
    .neko-hud__ai-scan:focus-visible {
      outline: 2px solid rgba(237, 255, 247, 0.9);
      outline-offset: 2px;
    }

    .neko-hud__display-toggle:disabled,
    .neko-hud__ai-scan:disabled {
      border-color: rgba(225, 248, 237, 0.16);
      background: rgba(15, 38, 38, 0.42);
      color: rgba(235, 253, 244, 0.32);
      cursor: not-allowed;
    }

    .neko-hud__ai-scan {
      grid-column: 1 / -1;
    }

    .neko-hud__vision-indicator {
      position: absolute;
      z-index: 5;
      top: 8px;
      right: 8px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #a6f0c8;
      box-shadow: 0 0 8px rgba(166, 240, 200, 0.9);
    }

    .neko-hud__vision-indicator[
      data-state="camera-off"
    ] {
      background: var(--neko-hud-alert);
      box-shadow: 0 0 8px rgba(206, 127, 98, 0.75);
    }

    .neko-hud__vision-indicator[
      data-state="display-off"
    ] {
      background: #f1cb70;
      box-shadow: 0 0 8px rgba(241, 203, 112, 0.88);
    }

    .neko-hud__vision-frame-status {
      position: absolute;
      z-index: 4;
      right: 7px;
      bottom: 6px;
      left: 7px;
      color: rgba(230, 251, 241, 0.76);
      font-size: 7px;
      letter-spacing: 0.09em;
      text-align: left;
    }

    .neko-hud__recognition-grid::after {
      position: absolute;
      z-index: 3;
      content: "";
      pointer-events: none;
    }

    .neko-hud__recognition-grid::after {
      top: 0;
      bottom: 0;
      left: 50%;
      width: 1px;
      background: rgba(232, 255, 244, 0.3);
      box-shadow: 0 0 12px rgba(232, 255, 244, 0.4);
      animation: neko-hud-scan 3.2s ease-in-out infinite alternate;
    }

    .neko-hud__right-note {
      padding: 9px 0 7px;
      border-top: 1px solid rgba(225, 248, 237, 0.42);
      text-align: right;
    }

    .neko-hud__bottom {
      position: absolute;
      right: 32px;
      bottom: 22px;
      left: 32px;
      min-height: 105px;
      border-top: 2px solid var(--neko-hud-line);
      background: linear-gradient(
        to bottom,
        rgba(27, 56, 55, 0.12),
        rgba(27, 56, 55, 0.35)
      );
    }

    .neko-hud__timer-row {
      display: grid;
      grid-template-columns: minmax(350px, 0.95fr) 1fr 1fr;
      min-height: 70px;
      align-items: center;
    }

    .neko-hud__timer {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 14px;
    }

    .neko-hud__pause {
      display: grid;
      width: 52px;
      height: 52px;
      place-items: center;
      flex: 0 0 auto;
      border: 1px solid rgba(255, 222, 208, 0.35);
      border-radius: 0;
      background: var(--neko-hud-alert);
      box-shadow:
        0 0 18px rgba(206, 127, 98, 0.24),
        inset 0 0 18px rgba(255, 232, 220, 0.08);
      color: white;
      cursor: pointer;
      font: inherit;
      font-size: 0;
      pointer-events: auto;
      transition:
        transform 150ms ease,
        filter 150ms ease,
        background 150ms ease;
    }

    .neko-hud__pause:hover {
      filter: brightness(1.12);
      transform: translateY(-1px);
    }

    .neko-hud__pause:focus-visible {
      outline: 2px solid rgba(244, 255, 249, 0.95);
      outline-offset: 3px;
    }

    .neko-hud__pause::before {
      width: 18px;
      height: 24px;
      content: "";
      border-right: 6px solid currentColor;
      border-left: 6px solid currentColor;
    }

    .neko-hud__pause[aria-pressed="true"] {
      background: rgba(37, 73, 70, 0.96);
    }

    .neko-hud__pause[aria-pressed="true"]::before {
      width: 0;
      height: 0;
      margin-left: 4px;
      border-top: 12px solid transparent;
      border-right: 0;
      border-bottom: 12px solid transparent;
      border-left: 19px solid currentColor;
    }

    .neko-hud__time {
      overflow: hidden;
      color: rgba(248, 255, 251, 0.98);
      font-family:
        "Arial Narrow",
        "Avenir Next Condensed",
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
      font-size: clamp(34px, 4.4vw, 58px);
      font-stretch: condensed;
      font-variant-numeric: tabular-nums;
      font-weight: 760;
      letter-spacing: -0.055em;
      line-height: 0.88;
      text-overflow: clip;
      white-space: nowrap;
    }

    .neko-hud__bottom-stat {
      align-self: stretch;
      display: flex;
      padding: 15px 18px 10px;
      flex-direction: column;
      justify-content: center;
      border-left: 1px solid rgba(225, 248, 237, 0.16);
    }

    .neko-hud__bottom-stat:last-child {
      align-items: flex-end;
      text-align: right;
    }

    .neko-hud__bottom-value {
      display: inline-block;
      width: fit-content;
      min-width: 54px;
      margin-top: 7px;
      padding: 4px 8px;
      background: rgba(222, 244, 233, 0.15);
      font-variant-numeric: tabular-nums;
    }

    .neko-hud__progress-track {
      position: relative;
      height: 30px;
      border-top: 1px solid rgba(222, 247, 235, 0.1);
      background:
        repeating-linear-gradient(
          90deg,
          transparent 0,
          transparent calc(5% - 1px),
          rgba(222, 247, 235, 0.08) calc(5% - 1px),
          rgba(222, 247, 235, 0.08) 5%
        ),
        var(--neko-hud-deep);
      overflow: hidden;
    }

    .neko-hud__progress-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 100%;
      background: linear-gradient(
        90deg,
        rgba(235, 250, 243, 0.94),
        rgba(207, 233, 222, 0.72)
      );
      box-shadow: 0 0 14px rgba(226, 255, 241, 0.25);
      transform-origin: left center;
      transition: width 120ms linear;
    }

    .neko-hud__progress-marker {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 100%;
      width: 2px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 0 11px rgba(255, 255, 255, 0.8);
      transform: translateX(-1px);
      transition: left 120ms linear;
    }

    .neko-hud__paused-label,
    .neko-hud__reset-label {
      position: absolute;
      right: 10px;
      bottom: 6px;
      z-index: 1;
      color: rgba(19, 49, 47, 0.78);
      font-size: 9px;
      letter-spacing: 0.13em;
      opacity: 0;
      transition: opacity 150ms ease;
    }

    #neko-cinematic-hud.is-paused .neko-hud__paused-label,
    #neko-cinematic-hud.is-resetting .neko-hud__reset-label {
      opacity: 1;
    }

    #neko-cinematic-hud.is-resetting {
      animation: neko-hud-reset-flash 780ms ease-in-out infinite alternate;
    }

    #neko-cinematic-hud.is-resetting .neko-hud__pause {
      pointer-events: none;
    }

    @keyframes neko-hud-scan {
      from {
        transform: translateX(-48px);
        opacity: 0.3;
      }

      to {
        transform: translateX(48px);
        opacity: 0.9;
      }
    }

    @keyframes neko-hud-reset-flash {
      from {
        opacity: 0.72;
      }

      to {
        opacity: 1;
      }
    }

    @media (max-width: 1080px) {
      .neko-hud__top {
        grid-template-columns: minmax(160px, 1.1fr) repeat(3, 1fr);
      }

      .neko-hud__top-stat:nth-child(5) {
        display: none;
      }

      .neko-hud__left,
      .neko-hud__right {
        width: 230px;
      }

      .neko-hud__timer-row {
        grid-template-columns: minmax(320px, 1.15fr) 0.85fr;
      }

      .neko-hud__bottom-stat:last-child {
        display: none;
      }
    }

    @media (max-width: 900px) {
      .neko-hud__top {
        right: 20px;
        left: 20px;
        grid-template-columns: minmax(160px, 1.2fr) repeat(2, 1fr);
      }

      .neko-hud__top-stat:nth-child(4),
      .neko-hud__top-stat:nth-child(5) {
        display: none;
      }

      .neko-hud__left,
      .neko-hud__right {
        display: none;
      }

      .neko-hud__bottom {
        right: 20px;
        left: 20px;
      }
    }

    @media (max-height: 690px) {
      .neko-hud__left,
      .neko-hud__right {
        top: 105px;
        bottom: 135px;
      }

      .neko-hud__panel:nth-child(n + 4) {
        display: none;
      }

      .neko-hud__bottom {
        bottom: 14px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .neko-hud__recognition-grid::after,
      #neko-cinematic-hud.is-resetting {
        animation: none;
      }
    }
  `;

  const root = document.createElement('div');
  root.id = 'neko-cinematic-hud';
  root.dataset.visionDisplay = 'off';
  root.setAttribute('aria-label', 'N.E.K.O session HUD');
  root.innerHTML = `
    <header class="neko-hud__top" aria-hidden="true">
      <div class="neko-hud__brand">
        <img
          class="neko-hud__logo"
          alt=""
          data-hud-brand-logo
        >
        <div class="neko-hud__brand-copy">
          <span class="neko-hud__brand-name">N.E.K.O</span>
          <span class="neko-hud__eyebrow">Cognitive Interface / Online</span>
        </div>
      </div>

      <div class="neko-hud__top-stat">
        <span class="neko-hud__label">S5DA Resource Usage</span>
        <span class="neko-hud__top-stat-value" data-hud-resource>42%</span>
      </div>

      <div class="neko-hud__top-stat">
        <span class="neko-hud__label">Memory Usage</span>
        <span class="neko-hud__top-stat-value" data-hud-memory>58%</span>
      </div>

      <div class="neko-hud__top-stat">
        <span class="neko-hud__label">Alerts</span>
        <span class="neko-hud__top-stat-value">0</span>
      </div>

      <div class="neko-hud__top-stat">
        <span class="neko-hud__label">Activated Neuron Ratio</span>
        <span class="neko-hud__top-stat-value" data-hud-neural>72%</span>
      </div>
    </header>

    <aside class="neko-hud__left" aria-hidden="true">
      <section class="neko-hud__panel">
        <div class="neko-hud__panel-title">Digital Behavior Construction</div>
        <div class="neko-hud__rows">
          <div class="neko-hud__row">
            <span class="neko-hud__label">Digital Body Coverage</span>
            <span class="neko-hud__value neko-hud__value--box">6/CM</span>
          </div>
          <div class="neko-hud__row">
            <span class="neko-hud__label">Behavioral Consistency</span>
            <span class="neko-hud__value neko-hud__value--box">98%</span>
          </div>
        </div>
      </section>

      <section class="neko-hud__panel">
        <div class="neko-hud__panel-title">Speech Synthesis</div>
        <div class="neko-hud__rows">
          <div class="neko-hud__row">
            <span class="neko-hud__label">Audio Sampling Rate</span>
            <span class="neko-hud__value neko-hud__value--box">48.0KHZ</span>
          </div>
          <div class="neko-hud__row">
            <span class="neko-hud__label">Acoustic Figureprint</span>
            <span class="neko-hud__value">YUI X0</span>
          </div>
        </div>
      </section>

      <section class="neko-hud__panel">
        <div class="neko-hud__panel-title">Emotion Matching</div>
        <div class="neko-hud__rows">
          <div class="neko-hud__row">
            <span class="neko-hud__label">Emotional Stability</span>
            <span class="neko-hud__value neko-hud__value--box">Stable</span>
          </div>
        </div>
      </section>

      <section class="neko-hud__panel">
        <div class="neko-hud__panel-title">Scene Parameters</div>
        <div class="neko-hud__rows">
          <div class="neko-hud__row">
            <span class="neko-hud__label">Scene Type</span>
            <span class="neko-hud__value">Interior</span>
          </div>
          <div class="neko-hud__row">
            <span class="neko-hud__label">Area Size</span>
            <span class="neko-hud__value">36M²</span>
          </div>
          <div class="neko-hud__row">
            <span class="neko-hud__label">Temperature</span>
            <span class="neko-hud__value">22°C</span>
          </div>
          <div class="neko-hud__row">
            <span class="neko-hud__label">Basic Resolution</span>
            <span class="neko-hud__value" data-hud-resolution>--</span>
          </div>
          <div class="neko-hud__row">
            <span class="neko-hud__label">FPS</span>
            <span class="neko-hud__value">60</span>
          </div>
        </div>
      </section>
    </aside>

    <aside class="neko-hud__right">
      <section class="neko-hud__recognition">
        <div
          class="neko-hud__recognition-grid"
          data-hud-vision-grid
        >
          <video
            class="neko-hud__vision-video"
            autoplay
            muted
            playsinline
            data-hud-vision-video
          ></video>
          <canvas
            class="neko-hud__vision-overlay"
            data-hud-vision-overlay
          ></canvas>
          <canvas
            class="neko-hud__vision-capture"
            width="${VISION_CAPTURE_WIDTH}"
            height="${VISION_CAPTURE_HEIGHT}"
            data-hud-vision-capture
          ></canvas>
          <div
            class="neko-hud__vision-placeholder"
            data-hud-vision-placeholder
          >Tracking Overlay Only</div>
          <span
            class="neko-hud__vision-indicator"
            role="status"
            aria-label="摄像头与视觉识别仍在运行，画面已隐藏"
            data-state="display-off"
            data-hud-vision-indicator
          ></span>
          <div
            class="neko-hud__vision-frame-status"
            data-hud-vision-frame-status
          >Initializing Local Vision</div>
        </div>
        <div class="neko-hud__vision-controls">
          <button
            class="neko-hud__vision-toggle"
            type="button"
            aria-label="关闭摄像头与视觉识别"
            aria-pressed="true"
            data-hud-vision-toggle
          >
            <span data-hud-vision-toggle-label>Camera On</span>
          </button>
          <button
            class="neko-hud__display-toggle"
            type="button"
            aria-label="恢复显示摄像头画面"
            aria-pressed="false"
            data-hud-display-toggle
          >
            <span data-hud-display-toggle-label>Display Off</span>
          </button>
          <button
            class="neko-hud__ai-scan"
            type="button"
            aria-label="发送当前单帧给角色的视觉模型"
            data-hud-ai-scan
          >
            <span data-hud-ai-scan-label>AI Scan</span>
          </button>
        </div>
        <div class="neko-hud__row">
          <span class="neko-hud__label">Recognition Output</span>
          <span
            class="neko-hud__value neko-hud__value--box"
            data-hud-recognition-output
          >Initializing</span>
        </div>
        <div class="neko-hud__row">
          <span class="neko-hud__label">Confidence</span>
          <span
            class="neko-hud__value neko-hud__value--box"
            data-hud-confidence
          >0%</span>
        </div>
      </section>

      <div class="neko-hud__right-note">
        <div
          class="neko-hud__micro"
          data-hud-vision-note
        >Visual Cognition Starting</div>
        <div class="neko-hud__value">Local / Secure</div>
      </div>
    </aside>

    <footer class="neko-hud__bottom">
      <div class="neko-hud__timer-row">
        <div class="neko-hud__timer">
          <button
            class="neko-hud__pause"
            type="button"
            aria-label="暂停倒计时"
            aria-pressed="false"
            data-hud-pause
          ></button>
          <time
            class="neko-hud__time"
            datetime="PT2M"
            data-hud-time
          >00:02:00</time>
        </div>

        <div class="neko-hud__bottom-stat">
          <span class="neko-hud__label">Active Memory Ratio</span>
          <span class="neko-hud__bottom-value" data-hud-memory-ratio>58%</span>
        </div>

        <div class="neko-hud__bottom-stat">
          <span class="neko-hud__label">Active Memory Capacity</span>
          <span class="neko-hud__bottom-value">32PB</span>
        </div>
      </div>

      <div class="neko-hud__progress-track">
        <div class="neko-hud__progress-fill" data-hud-progress></div>
        <div class="neko-hud__progress-marker" data-hud-marker></div>
        <span class="neko-hud__paused-label">Session Paused</span>
        <span class="neko-hud__reset-label">Resetting System</span>
      </div>
    </footer>
  `;

  document.head.appendChild(style);
  document.body.appendChild(root);
  applyDefaultAvatarUiState();

  const brandLogo =
    root.querySelector('[data-hud-brand-logo]');

  void ipcRenderer.invoke(
    'neko:get-brand-logo'
  ).then((logoDataUrl) => {
    if (
      typeof logoDataUrl === 'string' &&
      logoDataUrl.startsWith('data:image/')
    ) {
      brandLogo.src = logoDataUrl;
      return;
    }

    brandLogo.src = LOGO_DATA_URL;
  }).catch(() => {
    brandLogo.src = LOGO_DATA_URL;
  });

  const pauseButton =
    root.querySelector('[data-hud-pause]');
  const timeElement =
    root.querySelector('[data-hud-time]');
  const progressElement =
    root.querySelector('[data-hud-progress]');
  const markerElement =
    root.querySelector('[data-hud-marker]');
  const resolutionElement =
    root.querySelector('[data-hud-resolution]');
  const resourceElement =
    root.querySelector('[data-hud-resource]');
  const memoryElement =
    root.querySelector('[data-hud-memory]');
  const memoryRatioElement =
    root.querySelector('[data-hud-memory-ratio]');
  const neuralElement =
    root.querySelector('[data-hud-neural]');
  const visionGrid =
    root.querySelector('[data-hud-vision-grid]');
  const visionVideo =
    root.querySelector('[data-hud-vision-video]');
  const visionOverlay =
    root.querySelector('[data-hud-vision-overlay]');
  const visionCapture =
    root.querySelector('[data-hud-vision-capture]');
  const visionPlaceholder =
    root.querySelector('[data-hud-vision-placeholder]');
  const visionToggle =
    root.querySelector('[data-hud-vision-toggle]');
  const visionToggleLabel =
    root.querySelector(
      '[data-hud-vision-toggle-label]'
    );
  const visionIndicator =
    root.querySelector(
      '[data-hud-vision-indicator]'
    );
  const displayToggle =
    root.querySelector(
      '[data-hud-display-toggle]'
    );
  const displayToggleLabel =
    root.querySelector(
      '[data-hud-display-toggle-label]'
    );
  const aiScanButton =
    root.querySelector('[data-hud-ai-scan]');
  const aiScanLabel =
    root.querySelector('[data-hud-ai-scan-label]');
  const visionFrameStatus =
    root.querySelector(
      '[data-hud-vision-frame-status]'
    );
  const recognitionOutput =
    root.querySelector(
      '[data-hud-recognition-output]'
    );
  const recognitionConfidence =
    root.querySelector('[data-hud-confidence]');
  const visionNote =
    root.querySelector('[data-hud-vision-note]');

  const width = Math.max(
    window.screen?.width || 0,
    window.innerWidth
  );
  const height = Math.max(
    window.screen?.height || 0,
    window.innerHeight
  );

  resolutionElement.textContent =
    `${width}×${height}`;

  let remainingMs = SESSION_DURATION_MS;
  let lastFrameTime = performance.now();
  let paused = false;
  let resetting = false;
  let lastMetricsUpdate = 0;
  let visionEnabled = true;
  // 隐私优先：连接后视觉识别可以运行，但摄像头原始画面默认不显示。
  let visionDisplayEnabled = false;
  let visionStream = null;
  let visionTimer = null;
  let visionGeneration = 0;
  let visionCandidateSignature = '';
  let visionCandidateState = null;
  let visionCandidateSince = 0;
  let visionPublishedSignature = '';
  let visionPublishedState = null;
  let visionLastPublishedAt = 0;
  let visionSmoothedHands = [];
  let visionGazeDetected = false;
  let visionLastGazeSentAt = 0;
  let aiScanBusy = false;
  let visionDisplayRevision = 0;
  let aiScanDisplayPreference = null;

  function updateVisionControls() {
    const indicatorState = !visionEnabled
      ? 'camera-off'
      : visionDisplayEnabled
        ? 'camera-on'
        : 'display-off';
    const indicatorLabel = !visionEnabled
      ? '摄像头与视觉识别已关闭'
      : visionDisplayEnabled
        ? '摄像头已开启，画面正在显示'
        : '摄像头与视觉识别仍在运行，画面已隐藏';

    visionIndicator.dataset.state =
      indicatorState;
    visionIndicator.setAttribute(
      'aria-label',
      indicatorLabel
    );

    visionToggle.setAttribute(
      'aria-pressed',
      String(visionEnabled)
    );
    visionToggle.setAttribute(
      'aria-label',
      visionEnabled
        ? '关闭摄像头与视觉识别'
        : '开启摄像头与视觉识别'
    );
    visionToggleLabel.textContent =
      visionEnabled ? 'Camera On' : 'Camera Off';

    displayToggle.disabled = !visionEnabled;
    displayToggle.setAttribute(
      'aria-pressed',
      String(visionDisplayEnabled)
    );
    displayToggle.setAttribute(
      'aria-label',
      visionDisplayEnabled
        ? '仅关闭摄像头画面，继续视觉识别'
        : '恢复显示摄像头画面'
    );
    displayToggleLabel.textContent =
      visionDisplayEnabled
        ? 'Display On'
        : 'Display Off';
    aiScanButton.disabled =
      !visionEnabled ||
      !visionStream ||
      aiScanBusy;

    root.dataset.visionDisplay =
      visionDisplayEnabled ? 'on' : 'off';
    visionGrid.classList.toggle(
      'is-display-hidden',
      !visionDisplayEnabled
    );
    visionGrid.classList.toggle(
      'has-video',
      Boolean(visionStream) &&
      visionDisplayEnabled
    );
  }

  /**
   * AI Scan 只读取隐藏 video 的当前帧，不应该改变用户的画面显示偏好。
   * 记录扫描开始时的偏好，并在异步状态更新时重新施加；若用户在扫描
   * 期间亲自点击 Display，则用 revision 判断并尊重用户的新选择。
   */
  function preserveAiScanDisplayPreference(
    final = false
  ) {
    const preference = aiScanDisplayPreference;

    if (
      preference &&
      visionDisplayRevision === preference.revision
    ) {
      visionDisplayEnabled = preference.enabled;
    }

    updateVisionControls();

    if (final) {
      aiScanDisplayPreference = null;
    }
  }

  function setVisionResult(
    output,
    confidence,
    frameStatus
  ) {
    const normalizedConfidence = Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(Number(confidence))
          ? Number(confidence)
          : 0
      )
    );

    recognitionOutput.textContent =
      String(output || 'ERROR').toUpperCase();
    recognitionConfidence.textContent =
      `${Math.round(normalizedConfidence * 100)}%`;

    if (frameStatus) {
      visionFrameStatus.textContent =
        String(frameStatus);
    }
  }

  function postVisionBridgeMessage(type, payload) {
    window.postMessage(
      {
        source: VISION_BRIDGE_SOURCE,
        type,
        payload: JSON.stringify(payload),
      },
      window.location.origin
    );
  }

  function publishAvatarGaze(result, forceReset = false) {
    const face = result?.face;
    const center = face?.center;
    const confidence = Math.max(
      0,
      Math.min(
        1,
        Number(face?.confidence) || 0
      )
    );
    const reliableLandmarkCount =
      Array.isArray(face?.landmarks)
        ? face.landmarks.filter(
            (landmark) =>
              Array.isArray(landmark) &&
              Number(landmark[2]) >=
                VISION_FACE_LANDMARK_MIN_CONFIDENCE
          ).length
        : 0;
    const trackingSource =
      String(face?.tracking_source || '');
    const hasStableFaceGeometry = Boolean(
      reliableLandmarkCount >=
        VISION_FACE_MIN_RELIABLE_LANDMARKS ||
      trackingSource.startsWith('pose_head')
    );
    const detected = Boolean(
      !forceReset &&
      (
        confidence >=
          VISION_FACE_TRACKING_MIN_CONFIDENCE ||
        hasStableFaceGeometry
      ) &&
      Array.isArray(center) &&
      Number.isFinite(Number(center[0])) &&
      Number.isFinite(Number(center[1]))
    );
    const attentionHands = !forceReset &&
      Array.isArray(result?.hands)
      ? result.hands
          .filter(
            (hand) =>
              normalizedHandCenter(hand) &&
              Number(hand?.confidence) >= 0.45
          )
          .slice(0, 2)
          .map((hand) => {
            const handCenter =
              normalizedHandCenter(hand);

            return {
              side: String(
                hand?.handedness || 'unknown'
              ).toLowerCase(),
              center_x: handCenter[0],
              center_y: handCenter[1],
              speed: Math.max(
                0,
                Math.min(
                  4,
                  Number(
                    hand?.attention_speed
                  ) || 0
                )
              ),
              confidence: Math.max(
                0,
                Math.min(
                  1,
                  Number(hand?.confidence) || 0
                )
              ),
              gesture: normalizeHandGestureName(
                hand?.gesture?.name ??
                  hand?.gesture
              ),
            };
          })
      : [];
    const hasAttentionTarget =
      detected || attentionHands.length > 0;
    const now = Date.now();

    if (!hasAttentionTarget) {
      if (!visionGazeDetected && !forceReset) {
        return;
      }

      visionGazeDetected = false;
      visionLastGazeSentAt = now;
      postVisionBridgeMessage(
        'NEKO_CAMERA_GAZE',
        {
          detected: false,
          reset: forceReset,
          captured_at: now,
        }
      );
      return;
    }

    if (
      now - visionLastGazeSentAt <
      VISION_GAZE_MIN_SEND_MS
    ) {
      return;
    }

    const headPose = face?.head_pose || {};
    visionGazeDetected = true;
    visionLastGazeSentAt = now;
    postVisionBridgeMessage(
      'NEKO_CAMERA_GAZE',
      {
        detected,
        captured_at: now,
        confidence,
        center_x: Math.max(
          0,
          Math.min(
            1,
            Number.isFinite(
              Number(center?.[0])
            )
              ? Number(center[0])
              : 0.5
          )
        ),
        center_y: Math.max(
          0,
          Math.min(
            1,
            Number.isFinite(
              Number(center?.[1])
            )
              ? Number(center[1])
              : 0.5
          )
        ),
        face_size: Math.max(
          0,
          Math.min(
            1,
            Number(face?.size) || 0
          )
        ),
        head_pitch: Math.max(
          -90,
          Math.min(
            90,
            Number(headPose?.pitch) || 0
          )
        ),
        head_yaw: Math.max(
          -90,
          Math.min(
            90,
            Number(headPose?.yaw) || 0
          )
        ),
        head_roll: Math.max(
          -180,
          Math.min(
            180,
            Number(headPose?.roll) || 0
          )
        ),
        hands: attentionHands,
      }
    );
  }

  function normalizedLandmarkConfidence(landmark) {
    if (!Array.isArray(landmark)) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(
        1,
        Math.min(
          Number(landmark[2]) || 0,
          Number(landmark[3]) || 0
        )
      )
    );
  }

  function normalizedHandCenter(hand) {
    const center = hand?.palm_center;

    if (
      !Array.isArray(center) ||
      !Number.isFinite(Number(center[0])) ||
      !Number.isFinite(Number(center[1]))
    ) {
      return null;
    }

    return [
      Math.max(0, Math.min(1, Number(center[0]))),
      Math.max(0, Math.min(1, Number(center[1]))),
    ];
  }

  function pointDistanceSquared(first, second) {
    if (!first || !second) {
      return Number.POSITIVE_INFINITY;
    }

    return (
      ((Number(first[0]) || 0) -
        (Number(second[0]) || 0)) ** 2 +
      ((Number(first[1]) || 0) -
        (Number(second[1]) || 0)) ** 2
    );
  }

  function interpolatePoint(previous, current, alpha) {
    if (!Array.isArray(previous)) {
      return [...current];
    }

    return current.map((value, index) => {
      const normalizedValue = Number(value) || 0;
      const previousValue =
        Number(previous[index]);

      if (!Number.isFinite(previousValue)) {
        return normalizedValue;
      }

      return (
        previousValue +
        (
          normalizedValue - previousValue
        ) * alpha
      );
    });
  }

  function smoothDetectedHands(
    hands,
    trackedAt = performance.now()
  ) {
    const detectedHands =
      Array.isArray(hands)
        ? hands.filter(
            (hand) =>
              normalizedHandCenter(hand) &&
              Number(hand?.confidence) >= 0.35
          )
        : [];
    const previousAvailable =
      new Set(
        visionSmoothedHands.map(
          (_hand, index) => index
        )
      );
    const smoothed = [];

    for (const hand of detectedHands) {
      const center = normalizedHandCenter(hand);
      let previousIndex = -1;
      let previousDistance =
        Number.POSITIVE_INFINITY;

      for (const candidateIndex of previousAvailable) {
        const candidate =
          visionSmoothedHands[candidateIndex];
        const distance = pointDistanceSquared(
          center,
          normalizedHandCenter(candidate)
        );

        if (distance < previousDistance) {
          previousDistance = distance;
          previousIndex = candidateIndex;
        }
      }

      const previous =
        previousIndex >= 0 &&
        previousDistance <= 0.09
          ? visionSmoothedHands[previousIndex]
          : null;

      if (previousIndex >= 0 && previous) {
        previousAvailable.delete(previousIndex);
      }

      const landmarks = Array.isArray(hand.landmarks)
        ? hand.landmarks.map(
            (landmark, index) =>
              interpolatePoint(
                previous?.landmarks?.[index],
                landmark,
                VISION_HAND_SMOOTHING_ALPHA
              )
          )
        : [];
      const palmCenter = interpolatePoint(
        normalizedHandCenter(previous),
        center,
        VISION_HAND_SMOOTHING_ALPHA
      );
      const previousCenter =
        normalizedHandCenter(previous);
      const previousTrackedAt =
        Number(previous?.attention_tracked_at);
      const elapsedSeconds =
        previous &&
        Number.isFinite(previousTrackedAt)
          ? Math.max(
              0.04,
              Math.min(
                0.6,
                (
                  trackedAt -
                  previousTrackedAt
                ) / 1000
              )
            )
          : 0;
      const instantaneousSpeed =
        previousCenter && elapsedSeconds > 0
          ? Math.sqrt(
              pointDistanceSquared(
                palmCenter,
                previousCenter
              )
            ) / elapsedSeconds
          : 0;
      const previousSpeed = Math.max(
        0,
        Number(
          previous?.attention_speed
        ) || 0
      );
      const attentionSpeed = previous
        ? previousSpeed +
          (
            instantaneousSpeed -
            previousSpeed
          ) * VISION_HAND_VELOCITY_ALPHA
        : 0;

      smoothed.push({
        ...hand,
        palm_center: palmCenter,
        landmarks,
        attention_speed: Math.max(
          0,
          Math.min(4, attentionSpeed)
        ),
        attention_tracked_at: trackedAt,
      });
    }

    visionSmoothedHands = smoothed;
    return smoothed;
  }

  function normalizeHandGestureName(value) {
    const normalized =
      String(value || 'None')
        .trim()
        .toLowerCase();
    const knownGestures = new Set([
      'closed_fist',
      'open_palm',
      'pointing_up',
      'thumb_down',
      'thumb_up',
      'victory',
      'iloveyou',
    ]);

    return knownGestures.has(normalized)
      ? normalized
      : 'none';
  }

  function coarseHandPosition(center) {
    if (!center) {
      return 'unknown';
    }

    // The camera preview is mirrored with CSS, so flip X to describe the
    // position exactly as the user sees it in the HUD.
    const displayX = 1 - Number(center[0]);
    const displayY = Number(center[1]);
    const horizontal = displayX < 0.34
      ? 'left'
      : displayX > 0.66
        ? 'right'
        : 'center';
    const vertical = displayY < 0.34
      ? 'upper'
      : displayY > 0.66
        ? 'lower'
        : 'middle';

    return `${vertical}_${horizontal}`;
  }

  function poseAnchor(landmarks, side) {
    const wristIndex = side === 'left' ? 15 : 16;
    const shoulderIndex = side === 'left' ? 11 : 12;
    const wrist = landmarks[wristIndex];
    const shoulder = landmarks[shoulderIndex];

    if (
      wrist &&
      normalizedLandmarkConfidence(wrist) >= 0.28
    ) {
      return wrist;
    }

    if (
      shoulder &&
      normalizedLandmarkConfidence(shoulder) >= 0.32
    ) {
      return shoulder;
    }

    return null;
  }

  function matchHandsToPose(pose, hands) {
    const landmarks =
      Array.isArray(pose?.landmarks)
        ? pose.landmarks
        : [];
    const assignments = {
      left: null,
      right: null,
    };
    const candidates = [];

    for (const side of ['left', 'right']) {
      const anchor = poseAnchor(landmarks, side);

      if (!anchor) {
        continue;
      }

      for (let index = 0; index < hands.length; index += 1) {
        const center = normalizedHandCenter(hands[index]);

        if (!center) {
          continue;
        }

        const xDistance = Math.abs(
          Number(anchor[0]) - center[0]
        );
        const yDistance = Math.abs(
          Number(anchor[1]) - center[1]
        );
        candidates.push({
          side,
          index,
          distance:
            xDistance * 1.35 +
            yDistance * 0.35,
        });
      }
    }

    candidates.sort(
      (first, second) =>
        first.distance - second.distance
    );
    const usedHands = new Set();

    for (const candidate of candidates) {
      if (
        assignments[candidate.side] ||
        usedHands.has(candidate.index) ||
        candidate.distance > 0.48
      ) {
        continue;
      }

      assignments[candidate.side] =
        hands[candidate.index];
      usedHands.add(candidate.index);
    }

    for (let index = 0; index < hands.length; index += 1) {
      if (usedHands.has(index)) {
        continue;
      }

      const handedness =
        String(
          hands[index]?.handedness || ''
        ).toLowerCase();
      // MediaPipe's handedness assumes a mirrored selfie input. The analysis
      // canvas is not mirrored, so swap the fallback label.
      const fallbackSide = handedness === 'left'
        ? 'right'
        : handedness === 'right'
          ? 'left'
          : null;

      if (
        fallbackSide &&
        !assignments[fallbackSide]
      ) {
        assignments[fallbackSide] = hands[index];
      }
    }

    return assignments;
  }

  function detectHandState(pose, hands) {
    const landmarks =
      Array.isArray(pose?.landmarks)
        ? pose.landmarks
        : [];
    const assignments =
      matchHandsToPose(pose, hands);
    const summaries = [];
    const raised = {
      left: false,
      right: false,
    };
    const shoulderVisible = 0.42;
    const raisedMargin = 0.025;

    for (const side of ['left', 'right']) {
      const hand = assignments[side];
      const center = normalizedHandCenter(hand);
      const shoulder =
        landmarks[side === 'left' ? 11 : 12];

      if (!hand || !center) {
        continue;
      }

      const isRaised = Boolean(
        shoulder &&
        normalizedLandmarkConfidence(shoulder) >=
          shoulderVisible &&
        center[1] + raisedMargin <
          Number(shoulder[1])
      );
      raised[side] = isRaised;
      summaries.push({
        side,
        gesture: normalizeHandGestureName(
          hand?.gesture?.name
        ),
        confidence: Math.max(
          0,
          Math.min(
            1,
            Number(
              hand?.gesture?.confidence
            ) || Number(hand?.confidence) || 0
          )
        ),
        position: coarseHandPosition(center),
        raised: isRaised,
      });
    }

    if (raised.left && raised.right) {
      return {
        gesture: 'both_hands_raised',
        hands: summaries,
      };
    }
    if (raised.left) {
      return {
        gesture: 'left_hand_raised',
        hands: summaries,
      };
    }
    if (raised.right) {
      return {
        gesture: 'right_hand_raised',
        hands: summaries,
      };
    }

    return {
      gesture: 'none',
      hands: summaries,
    };
  }

  function buildVisionObservationState(result) {
    const hands =
      Array.isArray(result?.hands)
        ? result.hands
        : [];
    const personPresent = Boolean(
      result?.face ||
      result?.pose ||
      hands.length > 0
    );
    const handState = personPresent
      ? detectHandState(result?.pose, hands)
      : {
          gesture: 'none',
          hands: [],
        };

    return {
      person_present: personPresent,
      face_confidence: Math.max(
        0,
        Math.min(
          1,
          Number(result?.face?.confidence) || 0
        )
      ),
      pose_confidence: Math.max(
        0,
        Math.min(
          1,
          Number(result?.pose?.confidence) || 0
        )
      ),
      gesture: handState.gesture,
      hands: handState.hands,
    };
  }

  function visionStateSignature(state) {
    return [
      state.person_present ? '1' : '0',
      state.gesture,
    ].join(':');
  }

  function visionTransitionEvent(previous, current) {
    if (!current.person_present) {
      return 'person_left';
    }
    if (
      current.gesture !== 'none' &&
      (
        !previous ||
        current.gesture !== previous.gesture ||
        !previous.person_present
      )
    ) {
      return current.gesture;
    }
    if (!previous || !previous.person_present) {
      return 'person_entered';
    }
    return 'person_present';
  }

  function publishVisionObservation(
    event,
    state,
    stableMs
  ) {
    postVisionBridgeMessage(
      'NEKO_CAMERA_OBSERVATION',
      {
        event,
        captured_at: Date.now(),
        person_present:
          state.person_present === true,
        face_confidence:
          state.face_confidence,
        pose_confidence:
          state.pose_confidence,
        gesture: state.gesture,
        hands: Array.isArray(state.hands)
          ? state.hands.slice(0, 2)
          : [],
        stable_ms: Math.max(
          0,
          Math.min(
            600000,
            Math.round(stableMs)
          )
        ),
      }
    );
  }

  function resetVisionObservationState() {
    visionCandidateSignature = '';
    visionCandidateState = null;
    visionCandidateSince = 0;
    visionPublishedSignature = '';
    visionPublishedState = null;
    visionLastPublishedAt = 0;
    visionSmoothedHands = [];
  }

  function observeVisionResult(result) {
    const now = Date.now();
    const state = buildVisionObservationState(
      result
    );
    const signature =
      visionStateSignature(state);

    if (signature !== visionCandidateSignature) {
      visionCandidateSignature = signature;
      visionCandidateState = state;
      visionCandidateSince = now;
      return;
    }

    visionCandidateState = state;
    const stableMs = now - visionCandidateSince;
    if (
      stableMs <
      VISION_OBSERVATION_STABLE_MS
    ) {
      return;
    }

    const changed =
      signature !== visionPublishedSignature;
    const heartbeatDue =
      now - visionLastPublishedAt >=
      VISION_OBSERVATION_HEARTBEAT_MS;

    if (
      (!changed && !heartbeatDue) ||
      now - visionLastPublishedAt <
        VISION_OBSERVATION_MIN_SEND_MS
    ) {
      return;
    }

    const event = changed
      ? visionTransitionEvent(
          visionPublishedState,
          visionCandidateState
        )
      : 'state_heartbeat';

    publishVisionObservation(
      event,
      visionCandidateState,
      stableMs
    );
    visionPublishedSignature = signature;
    visionPublishedState = {
      ...visionCandidateState,
    };
    visionLastPublishedAt = now;
  }

  function clearVisionOverlay() {
    visionGrid.dataset.faceTrackingSource =
      'none';
    const context =
      visionOverlay.getContext('2d');

    if (!context) {
      return;
    }

    context.clearRect(
      0,
      0,
      visionOverlay.width,
      visionOverlay.height
    );
  }

  function drawVisionOverlay(result) {
    const frameWidth = Math.max(
      1,
      Number(result?.frame?.width) ||
      VISION_CAPTURE_WIDTH
    );
    const frameHeight = Math.max(
      1,
      Number(result?.frame?.height) ||
      VISION_CAPTURE_HEIGHT
    );

    if (
      visionOverlay.width !== frameWidth ||
      visionOverlay.height !== frameHeight
    ) {
      visionOverlay.width = frameWidth;
      visionOverlay.height = frameHeight;
    }

    const context =
      visionOverlay.getContext('2d');

    if (!context) {
      return;
    }

    context.clearRect(
      0,
      0,
      frameWidth,
      frameHeight
    );
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.shadowColor = 'rgba(194, 255, 226, 0.9)';
    context.shadowBlur = 6;

    const poseLandmarks =
      result?.pose?.landmarks;

    if (Array.isArray(poseLandmarks)) {
      context.strokeStyle =
        'rgba(197, 255, 226, 0.86)';
      context.lineWidth = Math.max(
        1.5,
        frameWidth / 420
      );

      for (const [startIndex, endIndex]
        of POSE_CONNECTIONS) {
        const start = poseLandmarks[startIndex];
        const end = poseLandmarks[endIndex];

        if (
          !start ||
          !end ||
          Math.min(
            Number(start[2]) || 0,
            Number(start[3]) || 0,
            Number(end[2]) || 0,
            Number(end[3]) || 0
          ) < 0.28
        ) {
          continue;
        }

        context.beginPath();
        context.moveTo(
          start[0] * frameWidth,
          start[1] * frameHeight
        );
        context.lineTo(
          end[0] * frameWidth,
          end[1] * frameHeight
        );
        context.stroke();
      }

      context.fillStyle =
        'rgba(235, 255, 245, 0.9)';

      for (const landmark of poseLandmarks) {
        if (
          Math.min(
            Number(landmark[2]) || 0,
            Number(landmark[3]) || 0
          ) < 0.42
        ) {
          continue;
        }

        context.beginPath();
        context.arc(
          landmark[0] * frameWidth,
          landmark[1] * frameHeight,
          Math.max(1.8, frameWidth / 300),
          0,
          Math.PI * 2
        );
        context.fill();
      }
    }

    const hands =
      Array.isArray(result?.hands)
        ? result.hands
        : [];

    for (const hand of hands) {
      const handLandmarks = hand?.landmarks;

      if (!Array.isArray(handLandmarks)) {
        continue;
      }

      context.strokeStyle =
        'rgba(116, 221, 255, 0.96)';
      context.fillStyle =
        'rgba(215, 249, 255, 0.98)';
      context.lineWidth = Math.max(
        1.8,
        frameWidth / 430
      );
      context.shadowColor =
        'rgba(86, 212, 255, 0.96)';
      context.shadowBlur = 8;

      for (const [startIndex, endIndex]
        of HAND_CONNECTIONS) {
        const start = handLandmarks[startIndex];
        const end = handLandmarks[endIndex];

        if (!start || !end) {
          continue;
        }

        context.beginPath();
        context.moveTo(
          Number(start[0]) * frameWidth,
          Number(start[1]) * frameHeight
        );
        context.lineTo(
          Number(end[0]) * frameWidth,
          Number(end[1]) * frameHeight
        );
        context.stroke();
      }

      for (const landmark of handLandmarks) {
        context.beginPath();
        context.arc(
          Number(landmark[0]) * frameWidth,
          Number(landmark[1]) * frameHeight,
          Math.max(2.2, frameWidth / 310),
          0,
          Math.PI * 2
        );
        context.fill();
      }

      const center = normalizedHandCenter(hand);

      if (center) {
        context.strokeStyle =
          'rgba(255, 228, 135, 0.98)';
        context.lineWidth = Math.max(
          2,
          frameWidth / 390
        );
        context.beginPath();
        context.arc(
          center[0] * frameWidth,
          center[1] * frameHeight,
          Math.max(6, frameWidth / 95),
          0,
          Math.PI * 2
        );
        context.stroke();
      }
    }

    context.shadowColor =
      'rgba(194, 255, 226, 0.9)';
    context.shadowBlur = 6;
    const face = result?.face;
    visionGrid.dataset.faceTrackingSource =
      face?.tracking_source || 'none';

    if (Array.isArray(face?.landmarks)) {
      const faceLandmarks = face.landmarks;
      context.strokeStyle =
        'rgba(210, 255, 235, 0.96)';
      context.lineWidth = Math.max(
        1.4,
        frameWidth / 430
      );
      context.shadowColor =
        'rgba(141, 255, 214, 0.96)';
      context.shadowBlur = 7;

      for (const feature
        of FACE_FEATURE_PATHS) {
        const points = feature.indices.map(
          (index) => faceLandmarks[index]
        );
        const valid =
          points.length >= 2 &&
          points.every(
            (landmark) =>
              Array.isArray(landmark) &&
              Number.isFinite(
                Number(landmark[0])
              ) &&
              Number.isFinite(
                Number(landmark[1])
              ) &&
              (Number(landmark[2]) || 0) >=
                0.35
          );

        if (!valid) {
          continue;
        }

        context.beginPath();
        context.moveTo(
          Number(points[0][0]) * frameWidth,
          Number(points[0][1]) * frameHeight
        );

        for (
          let index = 1;
          index < points.length;
          index += 1
        ) {
          context.lineTo(
            Number(points[index][0]) *
              frameWidth,
            Number(points[index][1]) *
              frameHeight
          );
        }

        if (feature.closed) {
          context.closePath();
        }

        context.stroke();
      }

      context.fillStyle =
        'rgba(235, 255, 246, 0.96)';

      for (
        let index = 0;
        index < faceLandmarks.length;
        index += 1
      ) {
        const landmark = faceLandmarks[index];

        if (
          !FACE_FEATURE_INDICES.has(index) ||
          !Array.isArray(landmark) ||
          (Number(landmark[2]) || 0) < 0.35
        ) {
          continue;
        }

        context.beginPath();
        context.arc(
          landmark[0] * frameWidth,
          landmark[1] * frameHeight,
          FACE_CONTOUR_INDICES.includes(index)
            ? Math.max(1.35, frameWidth / 560)
            : Math.max(1.15, frameWidth / 620),
          0,
          Math.PI * 2
        );
        context.fill();
      }
    }
  }

  function scheduleVisionAnalysis(
    generation,
    delay = VISION_ANALYSIS_INTERVAL_MS
  ) {
    window.clearTimeout(visionTimer);
    visionTimer = window.setTimeout(
      () => {
        void analyzeVisionFrame(generation);
      },
      delay
    );
  }

  async function analyzeVisionFrame(generation) {
    if (
      !visionEnabled ||
      generation !== visionGeneration ||
      !visionStream
    ) {
      return;
    }

    if (
      visionVideo.readyState <
      HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      scheduleVisionAnalysis(generation, 180);
      return;
    }

    const captureContext =
      visionCapture.getContext('2d', {
        alpha: false,
      });

    if (!captureContext) {
      setVisionResult(
        'ERROR',
        0,
        'Capture Surface Error'
      );
      return;
    }

    captureContext.drawImage(
      visionVideo,
      0,
      0,
      VISION_CAPTURE_WIDTH,
      VISION_CAPTURE_HEIGHT
    );

    try {
      const blob = await new Promise(
        (resolve, reject) => {
          visionCapture.toBlob(
            (encodedBlob) => {
              if (encodedBlob) {
                resolve(encodedBlob);
                return;
              }

              reject(
                new Error('无法编码摄像头画面。')
              );
            },
            'image/jpeg',
            0.72
          );
        }
      );
      const frameBytes = new Uint8Array(
        await blob.arrayBuffer()
      );
      const result = await ipcRenderer.invoke(
        'neko:vision-analyze',
        frameBytes
      );

      if (
        !visionEnabled ||
        generation !== visionGeneration
      ) {
        return;
      }

      result.hands = smoothDetectedHands(
        result.hands
      );
      publishAvatarGaze(result);
      drawVisionOverlay(result);
      setVisionResult(
        result.output,
        result.confidence,
        `Live // ${Math.round(
          Number(result.processing_ms) || 0
        )} MS`
      );
      observeVisionResult(result);
      visionNote.textContent =
        'Visual Cognition Active';
      scheduleVisionAnalysis(generation);
    } catch (error) {
      if (
        !visionEnabled ||
        generation !== visionGeneration
      ) {
        return;
      }

      clearVisionOverlay();
      publishAvatarGaze(null);
      setVisionResult(
        'ERROR',
        0,
        'Vision Service Unavailable'
      );
      visionNote.textContent =
        'Visual Cognition Error';
      console.error(
        '[N.E.K.O HUD] 视觉识别失败：',
        error
      );
      scheduleVisionAnalysis(generation, 1000);
    }
  }

  function captureAiScanFrame() {
    if (
      !visionEnabled ||
      !visionStream ||
      visionVideo.readyState <
        HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      throw new Error(
        '摄像头画面尚未准备完成。'
      );
    }

    const captureContext =
      visionCapture.getContext('2d', {
        alpha: false,
      });
    if (!captureContext) {
      throw new Error(
        '无法读取摄像头画面。'
      );
    }

    captureContext.drawImage(
      visionVideo,
      0,
      0,
      VISION_CAPTURE_WIDTH,
      VISION_CAPTURE_HEIGHT
    );

    return visionCapture.toDataURL(
      'image/jpeg',
      0.76
    );
  }

  function requestAiScan() {
    if (aiScanBusy) {
      return;
    }

    try {
      const dataUrl = captureAiScanFrame();
      aiScanDisplayPreference = {
        enabled: visionDisplayEnabled,
        revision: visionDisplayRevision,
      };
      aiScanBusy = true;
      aiScanLabel.textContent = 'Scanning';
      preserveAiScanDisplayPreference();
      postVisionBridgeMessage(
        'NEKO_CAMERA_AI_SCAN',
        {
          captured_at: Date.now(),
          data_url: dataUrl,
        }
      );
    } catch (error) {
      aiScanDisplayPreference = null;
      aiScanLabel.textContent = 'Scan Error';
      visionNote.textContent =
        'AI Scan Requires Camera';
      window.setTimeout(
        () => {
          aiScanLabel.textContent = 'AI Scan';
        },
        1800
      );
    }
  }

  function handleAiScanStatus(event) {
    if (
      event.source !== window ||
      event.origin !== window.location.origin
    ) {
      return;
    }

    const envelope = event.data;
    if (
      !envelope ||
      envelope.source !== VISION_PAGE_SOURCE ||
      envelope.type !==
        'NEKO_CAMERA_SCAN_STATUS' ||
      typeof envelope.payload !== 'string'
    ) {
      return;
    }

    let status = null;
    try {
      status = JSON.parse(envelope.payload);
    } catch {
      return;
    }

    const state = String(status?.state || '');
    if (state === 'running') {
      aiScanBusy = true;
      aiScanLabel.textContent = 'Scanning';
      visionNote.textContent =
        'Vision Model Request Active';
      preserveAiScanDisplayPreference();
      return;
    }

    aiScanBusy = false;
    aiScanLabel.textContent =
      state === 'sent'
        ? 'Scan Sent'
        : 'Scan Error';
    visionNote.textContent =
      state === 'sent'
        ? 'AI Vision Frame Accepted'
        : 'AI Vision Request Failed';
    preserveAiScanDisplayPreference(true);

    window.setTimeout(
      () => {
        if (!aiScanBusy) {
          aiScanLabel.textContent = 'AI Scan';
          if (visionEnabled) {
            visionNote.textContent =
              'Visual Cognition Active';
          }
        }
      },
      2200
    );
  }

  function stopVisionCamera() {
    if (visionEnabled || visionStream) {
      publishVisionObservation(
        'camera_disabled',
        {
          person_present: false,
          face_confidence: 0,
          pose_confidence: 0,
          gesture: 'none',
        },
        0
      );
    }
    publishAvatarGaze(null, true);
    visionEnabled = false;
    visionGeneration += 1;
    aiScanBusy = false;
    aiScanDisplayPreference = null;
    window.clearTimeout(visionTimer);
    visionTimer = null;

    if (visionStream) {
      for (const track of visionStream.getTracks()) {
        track.stop();
      }
    }

    visionStream = null;
    visionVideo.srcObject = null;
    resetVisionObservationState();
    clearVisionOverlay();
    visionPlaceholder.textContent = 'Camera Disabled';
    updateVisionControls();
    visionNote.textContent =
      'Visual Cognition Disabled';
    setVisionResult(
      'CAMERA OFF',
      0,
      'Capture Released'
    );
  }

  async function startVisionCamera() {
    const generation = visionGeneration + 1;
    visionGeneration = generation;
    visionEnabled = true;
    aiScanBusy = false;
    resetVisionObservationState();
    visionPlaceholder.textContent =
      'Camera Starting';
    updateVisionControls();
    visionNote.textContent =
      'Visual Cognition Starting';
    setVisionResult(
      'INITIALIZING',
      0,
      'Requesting Camera'
    );

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: {
              ideal: VISION_CAPTURE_WIDTH,
            },
            height: {
              ideal: VISION_CAPTURE_HEIGHT,
            },
            frameRate: {
              ideal: 24,
              max: 30,
            },
            facingMode: 'user',
          },
        });

      if (
        !visionEnabled ||
        generation !== visionGeneration
      ) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      visionStream = stream;
      visionVideo.srcObject = stream;
      await visionVideo.play();
      visionPlaceholder.textContent =
        visionDisplayEnabled
          ? 'Camera Live'
          : 'Tracking Overlay Only';
      updateVisionControls();
      setVisionResult(
        'ANALYZING',
        0,
        'Local Camera Live'
      );
      scheduleVisionAnalysis(generation, 80);
    } catch (error) {
      if (generation !== visionGeneration) {
        return;
      }

      visionEnabled = false;
      visionStream = null;
      visionPlaceholder.textContent =
        'Camera Permission Required';
      updateVisionControls();
      visionToggle.setAttribute(
        'aria-label',
        '重新请求摄像头权限'
      );
      visionNote.textContent =
        'Visual Cognition Error';
      setVisionResult(
        'CAMERA ERROR',
        0,
        'Permission Or Device Error'
      );
      console.error(
        '[N.E.K.O HUD] 无法打开摄像头：',
        error
      );
    }
  }

  function updateMetrics(now) {
    if (now - lastMetricsUpdate < 1500) {
      return;
    }

    lastMetricsUpdate = now;

    const usedHeap =
      performance.memory?.usedJSHeapSize || 0;
    const heapLimit =
      performance.memory?.jsHeapSizeLimit || 0;
    const memoryPercent = heapLimit > 0
      ? Math.max(
          12,
          Math.min(
            96,
            Math.round(
              usedHeap / heapLimit * 100
            )
          )
        )
      : 58;
    const resourcePercent = Math.round(
      36 +
      Math.sin(now / 4700) * 5
    );
    const neuralPercent = Math.round(
      72 +
      Math.sin(now / 3100) * 4
    );

    resourceElement.textContent =
      `${resourcePercent}%`;
    memoryElement.textContent =
      `${memoryPercent}%`;
    memoryRatioElement.textContent =
      `${memoryPercent}%`;
    neuralElement.textContent =
      `${neuralPercent}%`;
  }

  function render() {
    const ratio = Math.max(
      0,
      Math.min(
        1,
        remainingMs / SESSION_DURATION_MS
      )
    );
    const percent = `${ratio * 100}%`;

    timeElement.textContent =
      formatCountdown(remainingMs);
    timeElement.setAttribute(
      'datetime',
      `PT${Math.ceil(remainingMs / 1000)}S`
    );
    progressElement.style.width = percent;
    markerElement.style.left = percent;
  }

  async function requestReset() {
    if (resetting) {
      return;
    }

    resetting = true;
    remainingMs = 0;
    root.classList.remove('is-paused');
    root.classList.add('is-resetting');
    pauseButton.setAttribute(
      'aria-pressed',
      'false'
    );
    render();

    try {
      await window.nekoDesktop.resetApp();
    } catch (error) {
      resetting = false;
      paused = true;
      root.classList.remove('is-resetting');
      root.classList.add('is-paused');
      pauseButton.setAttribute(
        'aria-pressed',
        'true'
      );
      pauseButton.setAttribute(
        'aria-label',
        '继续倒计时'
      );

      console.error(
        '[N.E.K.O HUD] 重置应用失败：',
        error
      );
    }
  }

  function frame(now) {
    const elapsed = Math.max(
      0,
      now - lastFrameTime
    );
    lastFrameTime = now;

    if (!paused && !resetting) {
      remainingMs = Math.max(
        0,
        remainingMs - elapsed
      );
    }

    updateMetrics(now);
    render();

    if (remainingMs <= 0 && !resetting) {
      void requestReset();
      return;
    }

    window.requestAnimationFrame(frame);
  }

  pauseButton.addEventListener(
    'click',
    () => {
      if (resetting) {
        return;
      }

      paused = !paused;
      lastFrameTime = performance.now();
      root.classList.toggle(
        'is-paused',
        paused
      );
      pauseButton.setAttribute(
        'aria-pressed',
        String(paused)
      );
      pauseButton.setAttribute(
        'aria-label',
        paused
          ? '继续倒计时'
          : '暂停倒计时'
      );
    }
  );

  visionToggle.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (visionEnabled) {
        stopVisionCamera();
        return;
      }

      void startVisionCamera();
    }
  );

  displayToggle.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!visionEnabled) {
        return;
      }

      visionDisplayEnabled =
        !visionDisplayEnabled;
      visionDisplayRevision += 1;
      visionPlaceholder.textContent =
        visionDisplayEnabled
          ? 'Camera Live'
          : 'Tracking Overlay Only';
      updateVisionControls();
    }
  );

  aiScanButton.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestAiScan();
    }
  );

  window.addEventListener(
    'message',
    handleAiScanStatus
  );

  window.addEventListener(
    'pagehide',
    () => {
      window.removeEventListener(
        'message',
        handleAiScanStatus
      );
      stopVisionCamera();
    },
    {
      once: true,
    }
  );

  render();
  updateVisionControls();
  void startVisionCamera();
  window.requestAnimationFrame(frame);
}

installStartupCollapseShield();

if (document.readyState === 'loading') {
  window.addEventListener(
    'DOMContentLoaded',
    createHud,
    {
      once: true,
    }
  );
} else {
  createHud();
}
