// ==UserScript==
// @name         HTML5视频 快进快退按钮（左右纵排 10分钟/1分钟/10秒 · 全屏可用 · 手机适配）
// @namespace    https://trae.local/video-seek-buttons
// @version      1.5.1
// @description  快退键纵向排列在视频左侧、快进键纵向排列在右侧，纵向居中，自上而下为 10分钟/1分钟/10秒；容器全屏与原生视频全屏均可见，桌面+手机触摸长按连发，自动跟随控件隐藏。
// @author       you
// @match        *://*/*
// @license      MIT
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ============ 可调参数 ============
  const CONFIG = {
    STEP_BIG: 600,      // 10分钟
    STEP_MID: 60,       // 1分钟
    STEP_SMALL: 10,     // 10秒
    REPEAT_MS: 160,     // 长按连发间隔（毫秒）
    AUTO_LANDSCAPE: true,            // 手机端进入全屏自动锁定横屏
    LANDSCAPE_ROTATE_FALLBACK: true, // 锁定失败时用 CSS 旋转 90° 兜底（iOS/Firefox 等）
    EDGE_GAP: 10,       // 侧边按钮条距视频左右边缘的距离
    PANE_SCALE_REF: 290,       // 桌面：视频高度达到该值(px)时按钮为标准大小
    PANE_SCALE_REF_TOUCH: 240, // 手机：基准更低，视频更小时就开始缩小
    PANE_SCALE_MIN: 0.6,       // 按钮缩放下限
    PANE_SCALE_MAX: 1,         // 桌面缩放上限
    PANE_SCALE_MAX_TOUCH: 0.9,       // 手机全屏缩放上限
    PANE_SCALE_MAX_TOUCH_PAGE: 0.75, // 手机非全屏（页面内嵌）缩放上限
    IDLE_MS: 2600,      // 播放中静止多久后随控件一起淡出
    MIN_W: 300,         // 只给“大视频”挂按钮，过滤小预览视频
    MIN_H: 160
  };

  const Z = 2147483647;
  // 触屏设备（手机/平板）
  const IS_TOUCH =
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window;

  // ============ 样式（只注入一次） ============
  const STYLE = `
  .vsh-pane {
    position: fixed;
    z-index: ${Z};
    top: 50%;
    display: flex;
    flex-direction: column;
    /* --vsh-s 为尺寸缩放系数，由脚本按视频高度实时计算 */
    gap: calc(8px * var(--vsh-s, 1));
    padding: calc(8px * var(--vsh-s, 1)) calc(6px * var(--vsh-s, 1));
    background: rgba(20, 22, 26, 0.62);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    box-shadow: 0 2px 12px rgba(0,0,0,.35);
    opacity: 0;
    pointer-events: none;
    transition: opacity .22s ease, transform .22s ease;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    touch-action: manipulation;
  }
  .vsh-pane.vsh-left {
    border-radius: 0 calc(14px * var(--vsh-s, 1)) calc(14px * var(--vsh-s, 1)) 0;
    transform: translateY(-50%) translateX(-12px);
  }
  .vsh-pane.vsh-right {
    border-radius: calc(14px * var(--vsh-s, 1)) 0 0 calc(14px * var(--vsh-s, 1));
    transform: translateY(-50%) translateX(12px);
  }
  .vsh-pane.vsh-show {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
  }
  .vsh-btn {
    appearance: none;
    -webkit-appearance: none;
    border: none;
    outline: none;
    min-width: calc(54px * var(--vsh-s, 1));
    height: calc(36px * var(--vsh-s, 1));
    padding: 0 calc(9px * var(--vsh-s, 1));
    border-radius: calc(12px * var(--vsh-s, 1));
    background: rgba(255,255,255,.16);
    color: #fff;
    font-size: calc(12px * var(--vsh-s, 1));
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition: background .12s, transform .06s;
  }
  .vsh-btn:hover { background: rgba(255,255,255,.28); }
  .vsh-btn:active,
  .vsh-btn.vsh-pressing { background: rgba(76,139,245,.85); transform: scale(.94); }
  /* 按钮尺寸已随视频高度自适应（--vsh-s），不再按触屏/全屏写死尺寸 */
  .vsh-tip {
    position: fixed;
    z-index: ${Z};
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 18px;
    border-radius: 12px;
    background: rgba(0,0,0,.66);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    pointer-events: none;
    opacity: 0;
    transform: translate(-50%, -50%) scale(.9);
    transition: opacity .18s, transform .18s;
    white-space: nowrap;
  }
  .vsh-tip.vsh-show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  .vsh-tip .vsh-arrow-ico { font-size: 30px; line-height: 1; }
  .vsh-tip .vsh-txt { font-size: 14px; font-weight: 600; }
  .vsh-tip .vsh-pos { font-size: 11px; opacity: .75; }
  `;

  function injectStyle() {
    if (document.getElementById('vsh-style')) return;
    const style = document.createElement('style');
    style.id = 'vsh-style';
    style.textContent = STYLE;
    document.documentElement.appendChild(style);
  }

  // ============ 工具 ============
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  // ============ 每个视频的状态 ============
  // item: { video, panes:[leftPane, rightPane], buttons:[{el,seconds}], tip, idleTimer, tipTimer }
  const items = [];

  // 左侧：快退（自上而下 10分钟 / 1分钟 / 10秒）
  const LEFT_BUTTONS = [
    { label: '« 10分钟', seconds: -CONFIG.STEP_BIG, title: '快退 10 分钟' },
    { label: '‹ 1分钟', seconds: -CONFIG.STEP_MID, title: '快退 1 分钟' },
    { label: '‹ 10秒', seconds: -CONFIG.STEP_SMALL, title: '快退 10 秒' }
  ];
  // 右侧：快进（自上而下 10分钟 / 1分钟 / 10秒）
  const RIGHT_BUTTONS = [
    { label: '10分钟 »', seconds: CONFIG.STEP_BIG, title: '快进 10 分钟' },
    { label: '1分钟 ›', seconds: CONFIG.STEP_MID, title: '快进 1 分钟' },
    { label: '10秒 ›', seconds: CONFIG.STEP_SMALL, title: '快进 10 秒' }
  ];

  function buildPane(defs) {
    const pane = document.createElement('div');
    const buttons = [];
    defs.forEach(({ label, seconds, title }) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'vsh-btn';
      el.textContent = label;
      el.title = title;
      el.setAttribute('aria-label', title);
      pane.appendChild(el);
      buttons.push({ el, seconds });
    });
    return { pane, buttons };
  }

  function createItem(video) {
    const left = buildPane(LEFT_BUTTONS);
    left.pane.classList.add('vsh-pane', 'vsh-left');
    const right = buildPane(RIGHT_BUTTONS);
    right.pane.classList.add('vsh-pane', 'vsh-right');

    const tip = document.createElement('div');
    tip.className = 'vsh-tip';
    tip.innerHTML =
      '<div class="vsh-arrow-ico"></div><div class="vsh-txt"></div><div class="vsh-pos"></div>';

    const item = {
      video,
      panes: [left.pane, right.pane],
      buttons: left.buttons.concat(right.buttons),
      tip,
      idleTimer: null,
      tipTimer: null
    };
    bindInteractions(item);
    bindAutoHide(item);
    items.push(item);
    relocate(item);
    syncPosition(item);
    return item;
  }

  // ---------- 跳转 ----------
  function doSeek(item, seconds) {
    const video = item.video;
    if (!isFinite(video.duration)) {
      flashTip(item, seconds, null);
      return;
    }
    let target = (video.currentTime || 0) + seconds;
    target = Math.min(Math.max(0, target), video.duration);
    video.currentTime = target;
    flashTip(item, seconds, { current: target, duration: video.duration });
  }

  function flashTip(item, seconds, pos) {
    const forward = seconds > 0;
    item.tip.querySelector('.vsh-arrow-ico').textContent = forward ? '▶' : '◀';
    const abs = Math.abs(seconds);
    const label = abs % 60 === 0 ? `${abs / 60} 分钟` : `${abs} 秒`;
    item.tip.querySelector('.vsh-txt').textContent = (forward ? '快进 ' : '快退 ') + label;
    item.tip.querySelector('.vsh-pos').textContent =
      pos && isFinite(pos.duration) ? `${fmt(pos.current)} / ${fmt(pos.duration)}` : '';

    item.tip.classList.add('vsh-show');
    clearTimeout(item.tipTimer);
    item.tipTimer = setTimeout(() => item.tip.classList.remove('vsh-show'), 700);
  }

  // ---------- 按键交互：点按一次 + 长按连发（桌面/手机统一 pointer 事件） ----------
  function bindInteractions(item) {
    item.buttons.forEach(({ el, seconds }) => {
      let repeat = null;

      const stop = () => {
        el.classList.remove('vsh-pressing');
        if (repeat) {
          clearInterval(repeat);
          repeat = null;
        }
      };

      el.addEventListener('pointerdown', (e) => {
        // 只响应主键/触摸，避免右键等
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add('vsh-pressing');
        doSeek(item, seconds);
        wake(item);
        repeat = setInterval(() => doSeek(item, seconds), CONFIG.REPEAT_MS);
      });

      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('lostpointercapture', stop);

      // 手机长按不要弹出系统菜单/选择
      el.addEventListener('contextmenu', (e) => e.preventDefault());

      // 键盘可达性（焦点下 Enter / 空格触发一次）
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          doSeek(item, seconds);
          wake(item);
        }
      });
    });

    // 阻断按钮区域的事件透传到播放器：快速连点不会被网站识别成
    // 双击手势（双击快进/暂停/全屏等），每次点击只叠加我们自己的跳转
    const SWALLOW = [
      'pointerdown', 'pointerup', 'pointercancel',
      'mousedown', 'mouseup', 'click', 'dblclick',
      'touchstart', 'touchend', 'touchcancel'
    ];
    item.panes.forEach((pane) => {
      SWALLOW.forEach((type) => {
        pane.addEventListener(type, (e) => {
          e.stopPropagation();
          if (type === 'dblclick') e.preventDefault();
        }, { passive: false });
      });
    });
  }

  // ---------- 自动隐藏：模拟原生控件，动一下显示，播放中静止淡出 ----------
  function wake(item) {
    item.panes.forEach((p) => p.classList.add('vsh-show'));
    clearTimeout(item.idleTimer);
    if (!item.video.paused) {
      item.idleTimer = setTimeout(() => {
        item.panes.forEach((p) => p.classList.remove('vsh-show'));
      }, CONFIG.IDLE_MS);
    }
  }

  function bindAutoHide(item) {
    const v = item.video;
    const wakeFn = () => wake(item);
    v.addEventListener('pointermove', wakeFn);
    v.addEventListener('pointerdown', wakeFn);
    v.addEventListener('touchstart', wakeFn, { passive: true });
    v.addEventListener('focus', wakeFn);
    v.addEventListener('play', wakeFn);
    v.addEventListener('pause', () => {
      clearTimeout(item.idleTimer);
      item.panes.forEach((p) => p.classList.add('vsh-show'));
    });
    item.panes.forEach((p) => p.addEventListener('pointermove', wakeFn));

    // 兜底：手机端全屏时，点击通常落在播放器的手势层/覆盖层上而非 video 本身，
    // 导致原生进度条重新出现而按钮不出现。在 document 捕获阶段监听，
    // 只要触点位于视频区域内，就视为“操作了播放器”并唤醒按钮。
    const docWake = (e) => {
      let x = null;
      let y = null;
      if (typeof e.clientX === 'number' && isFinite(e.clientX)) {
        x = e.clientX;
        y = e.clientY;
      } else if (e.touches && e.touches.length > 0) {
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
      }
      if (x === null) return;
      const r = v.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) wake(item);
    };
    document.addEventListener('pointerdown', docWake, true);
    document.addEventListener('touchstart', docWake, { capture: true, passive: true });
    document.addEventListener('pointermove', docWake, { capture: true, passive: true });

    // 初始：暂停时常驻，播放时 2.6 秒后淡出
    wake(item);
  }

  // ============ 定位：左侧快退列、右侧快进列，均相对视频纵向居中 ============
  function syncPosition(item) {
    const r = item.video.getBoundingClientRect();
    // 视频不可见（display:none / 宽高为 0）时同步隐藏
    const visible = r.width > 0 && r.height > 0;
    item.panes.forEach((p) => { p.style.display = visible ? '' : 'none'; });
    item.tip.style.display = visible ? '' : 'none';
    if (!visible) return;

    const gap = CONFIG.EDGE_GAP;
    const centerY = r.top + r.height / 2;

    // CSS 旋转兜底模式下：按钮改用旋转容器的本地坐标（横屏视角）
    if (rotateState.el && rotateState.el.contains(item.panes[0])) {
      const el = rotateState.el;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      item.panes[0].style.top = `${h / 2}px`;
      item.panes[0].style.left = `${gap}px`;
      item.panes[1].style.top = `${h / 2}px`;
      item.panes[1].style.right = `${gap}px`;
      item.tip.style.top = `${h / 2}px`;
      item.tip.style.left = `${w / 2}px`;
      return;
    }

    // 按钮尺寸随视频高度自适应：视频越小按钮越小，上下限由 CONFIG 控制；
    // 手机端分场景限幅：全屏 0.9、页面内嵌 0.75，保证非全屏更小巧
    const fs = fullscreenElement();
    const isFsVideo = !!fs && (fs === item.video || (fs.contains && fs.contains(item.video)));
    const maxScale = IS_TOUCH
      ? (isFsVideo ? CONFIG.PANE_SCALE_MAX_TOUCH : CONFIG.PANE_SCALE_MAX_TOUCH_PAGE)
      : CONFIG.PANE_SCALE_MAX;
    const ref = IS_TOUCH ? CONFIG.PANE_SCALE_REF_TOUCH : CONFIG.PANE_SCALE_REF;
    const scale = Math.min(maxScale, Math.max(CONFIG.PANE_SCALE_MIN, r.height / ref));
    item.panes.forEach((p) => p.style.setProperty('--vsh-s', scale.toFixed(3)));

    const [left, right] = item.panes;
    left.style.top = `${centerY}px`;
    left.style.left = `${r.left + gap}px`;
    right.style.top = `${centerY}px`;
    right.style.right = `${Math.max(0, window.innerWidth - r.right) + gap}px`;

    item.tip.style.top = `${centerY}px`;
    item.tip.style.left = `${r.left + r.width / 2}px`;
  }

  // ============ 全屏适配 ============
  // 情况 A：网站让“播放器容器”全屏（B站/YouTube 等绝大多数网页播放器）
  //         → 把按钮移入全屏元素内即可正常渲染。
  // 情况 B：对 <video> 本身全屏（原生全屏）
  //         → 普通 DOM 无法覆盖视频；用 Popover API 的顶层（top layer）渲染，
  //           Chrome/Edge 114+ 支持；不支持时静默降级。
  // 情况 C：iOS Safari 系统全屏（webkitEnterFullscreen）
  //         → 系统接管渲染，任何网页元素都无法显示（浏览器限制）。
  function relocate(item) {
    const fs = fullscreenElement();
    const targets = item.panes.concat([item.tip]);

    if (!fs) {
      targets.forEach((el) => exitTopLayer(el));
      targets.forEach((el) => appendSafe(document.body, el));
    } else if (fs !== item.video && fs.contains && fs.contains(item.video)) {
      // 全屏元素是“包含视频的播放器容器”：直接放进去即可渲染
      targets.forEach((el) => appendSafe(fs, el));
      targets.forEach((el) => exitTopLayer(el));
    } else {
      // <video> 自身原生全屏，或全屏的是其它元素：普通 DOM 会被压在全屏层下面，
      // 改用 Popover 顶层（top layer）渲染；不支持的浏览器静默降级
      targets.forEach((el) => appendSafe(document.body, el));
      targets.forEach((el) => enterTopLayer(el));
    }
    wake(item);
  }

  function appendSafe(parent, el) {
    if (el.parentElement !== parent) parent.appendChild(el);
  }

  function enterTopLayer(el) {
    try {
      if (el._vshPopover) return;
      el.setAttribute('popover', 'manual');
      // 关掉 UA 默认 popover 定位，改用我们自己的 top/left
      el.style.inset = 'auto';
      el.style.margin = '0';
      el.showPopover();
      el._vshPopover = true;
    } catch (e) {
      el._vshPopover = false; // 浏览器不支持则降级（原生全屏下不可见）
    }
  }

  function exitTopLayer(el) {
    if (!el._vshPopover) return;
    try { el.hidePopover(); } catch (e) {}
    el.removeAttribute('popover');
    el.style.inset = '';
    el.style.margin = '';
    el._vshPopover = false;
  }

  // ============ 移动端：进入全屏自动横屏 ============
  // 策略：① 优先系统级横屏锁定 screen.orientation.lock（Chrome/Edge 等 Chromium 系）
  //      ② 失败或不支持（iOS Safari / Firefox）时，CSS 把全屏容器旋转 90° 兜底
  const rotateState = { el: null, saved: null };
  let landscapeLocked = false;

  function applyRotate(el) {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    if (vpW >= vpH) return false; // 已处于横屏，无需旋转
    rotateState.el = el;
    rotateState.saved = {
      position: el.style.position, left: el.style.left, top: el.style.top,
      width: el.style.width, height: el.style.height,
      transform: el.style.transform, transformOrigin: el.style.transformOrigin,
      margin: el.style.margin
    };
    el.style.position = 'fixed';
    el.style.left = '50%';
    el.style.top = '50%';
    el.style.width = `${vpH}px`;
    el.style.height = `${vpW}px`;
    el.style.margin = '0';
    el.style.transformOrigin = 'center';
    el.style.transform = 'translate(-50%, -50%) rotate(90deg)';
    return true;
  }

  function undoRotate() {
    const el = rotateState.el;
    if (!el) return;
    const s = rotateState.saved;
    Object.keys(s).forEach((k) => { el.style[k] = s[k] || ''; });
    rotateState.el = null;
    rotateState.saved = null;
    items.forEach(relocate);
    items.forEach(syncPosition);
  }

  function fallbackRotate(fs) {
    // 仅旋转“播放器容器”；对 <video> 本身的原生全屏无法叠加旋转 UI
    if (!CONFIG.LANDSCAPE_ROTATE_FALLBACK) return;
    if (!fs || fs instanceof HTMLVideoElement) return;
    if (applyRotate(fs)) {
      items.forEach(relocate);
      items.forEach(syncPosition);
    }
  }

  function enableLandscape() {
    if (window.innerWidth >= window.innerHeight) return; // 已经横屏
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      const attempt = (retries) => {
        screen.orientation.lock('landscape').then(() => {
          landscapeLocked = true;
        }).catch(() => {
          // Chrome 偶发时序性拒绝，重试几次，仍失败则旋转兜底
          if (retries > 0) {
            setTimeout(() => attempt(retries - 1), 150);
          } else {
            fallbackRotate(fullscreenElement());
          }
        });
      };
      attempt(2);
    } else {
      // 浏览器不支持锁定 API（iOS Safari / Firefox 等）
      fallbackRotate(fullscreenElement());
    }
  }

  function onFullscreenChange() {
    items.forEach(relocate);
    if (!CONFIG.AUTO_LANDSCAPE || !IS_TOUCH) return;
    if (fullscreenElement()) {
      enableLandscape();
    } else {
      if (landscapeLocked) {
        try { if (screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
      }
      landscapeLocked = false;
      undoRotate(); // 退出全屏：还原旋转并交还系统自动旋转
    }
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  // ============ 视频发现：动态扫描 + MutationObserver ============
  const seen = new WeakSet();

  function isBigVideo(v) {
    const r = v.getBoundingClientRect();
    return r.width >= CONFIG.MIN_W && r.height >= CONFIG.MIN_H;
  }

  function scan() {
    const videos = document.querySelectorAll('video');
    videos.forEach((v) => {
      if (seen.has(v)) return;
      if (!isBigVideo(v)) return; // 小预览视频先不挂，后续扫描到变大再挂
      seen.add(v);
      createItem(v);
    });
  }

  injectStyle();
  scan();

  const mo = new MutationObserver(() => scan());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 有些视频是懒加载/稍后才变大，定时补扫
  setInterval(scan, 2000);

  // 每帧同步位置（滚动/页面内全屏/布局变化都能跟随），开销很小
  function frameLoop() {
    for (const item of items) {
      // 播放器在全屏时重建控件导致按钮被移出 DOM 时，自动重新挂载
      if (!item.panes[0].isConnected || !item.panes[1].isConnected) relocate(item);
      if (item.panes[0].isConnected) syncPosition(item);
    }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
})();
