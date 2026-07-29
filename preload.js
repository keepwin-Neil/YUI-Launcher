'use strict';

const {
  contextBridge,
  ipcRenderer,
  webFrame,
} = require('electron');

const SESSION_DURATION_MS = 2 * 60 * 1000;
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
      min-height: 182px;
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
      height: 92px;
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

    .neko-hud__recognition-grid::after {
      position: absolute;
      content: "";
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
  root.setAttribute('aria-label', 'N.E.K.O session HUD');
  root.innerHTML = `
    <header class="neko-hud__top" aria-hidden="true">
      <div class="neko-hud__brand">
        <img
          class="neko-hud__logo"
          src="${LOGO_DATA_URL}"
          alt=""
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

    <aside class="neko-hud__right" aria-hidden="true">
      <section class="neko-hud__recognition">
        <div class="neko-hud__recognition-grid"></div>
        <div class="neko-hud__row">
          <span class="neko-hud__label">Recognition Output</span>
          <span class="neko-hud__value neko-hud__value--box">Error</span>
        </div>
        <div class="neko-hud__row">
          <span class="neko-hud__label">Confidence</span>
          <span class="neko-hud__value neko-hud__value--box">0%</span>
        </div>
      </section>

      <div class="neko-hud__right-note">
        <div class="neko-hud__micro">Visual Cognition Active</div>
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

  render();
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
