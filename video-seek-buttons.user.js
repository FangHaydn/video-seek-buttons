// ==UserScript==
// @name         HTML5视频 快进快退按钮（左右纵排 5分钟/1分钟/10秒 · 全屏可用 · 手机适配）
// @namespace    https://trae.local/video-seek-buttons
// @version      1.7.2
// @description  快退键纵向排列在视频左侧、快进键纵向排列在右侧，纵向居中，自上而下为 5分钟/1分钟/10秒（步长可在 ⚙ 设置中自定义，支持站点黑名单）；容器全屏与原生视频全屏均可见，桌面+手机触摸长按连发（越按越快），自动跟随控件隐藏。
// @author       you
// @match        *://*/*
// @license      MIT
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  // ============ 可调参数 ============
  const CONFIG = {
    STEP_BIG: 300,      // 5分钟
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

  // 出厂默认值（供“恢复默认”使用；CONFIG 可能被已保存的设置覆盖）
  const DEFAULTS = Object.assign({}, CONFIG);

  // ============ 设置持久化：优先 GM 存储（跨站点全局生效），否则 localStorage（仅当前站点） ============
  const store = {
    get(key, def) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue('vsh:' + key);
          return v === undefined || v === null ? def : v;
        }
        const raw = localStorage.getItem('vsh:' + key);
        return raw === null ? def : JSON.parse(raw);
      } catch (e) {
        return def;
      }
    },
    set(key, val) {
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue('vsh:' + key, val);
          return;
        }
        localStorage.setItem('vsh:' + key, JSON.stringify(val));
      } catch (e) {}
    }
  };

  function clampNum(v, def, min, max) {
    const n = Number(v);
    if (!isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  // 启动时恢复已保存设置
  (function loadSettings() {
    const s = store.get('cfg', null);
    if (!s || typeof s !== 'object') return;
    CONFIG.STEP_BIG = Math.round(clampNum(s.STEP_BIG, DEFAULTS.STEP_BIG, 5, 28800));
    CONFIG.STEP_MID = Math.round(clampNum(s.STEP_MID, DEFAULTS.STEP_MID, 5, 3600));
    CONFIG.STEP_SMALL = Math.round(clampNum(s.STEP_SMALL, DEFAULTS.STEP_SMALL, 1, 600));
    CONFIG.REPEAT_MS = Math.round(clampNum(s.REPEAT_MS, DEFAULTS.REPEAT_MS, 40, 1000));
    CONFIG.IDLE_MS = clampNum(s.IDLE_MS, DEFAULTS.IDLE_MS, 0, 60000);
  })();

  // 站点黑名单（在设置面板中切换）
  let siteDisabled = (function () {
    const bl = store.get('blacklist', []);
    return Array.isArray(bl) && bl.includes(location.hostname);
  })();

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
  .vsh-toggle {
    position: fixed;
    z-index: ${Z};
    width: calc(34px * var(--vsh-s, 1));
    height: calc(34px * var(--vsh-s, 1));
    padding: 0;
    border: none;
    border-radius: calc(10px * var(--vsh-s, 1));
    background: rgba(20, 22, 26, 0.72);
    color: #fff;
    font-size: calc(18px * var(--vsh-s, 1));
    line-height: 1;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    opacity: .78;
    transition: opacity .18s, background .12s;
  }
  .vsh-toggle:hover,
  .vsh-toggle:focus-visible { opacity: 1; background: rgba(20, 22, 26, .9); }
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
  .vsh-gear { font-size: calc(15px * var(--vsh-s, 1)); }
  .vsh-settings {
    position: fixed;
    z-index: ${Z};
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 320px;
    max-width: calc(100vw - 32px);
    box-sizing: border-box;
    padding: 16px;
    border-radius: 14px;
    background: rgba(24, 26, 31, .96);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 8px 32px rgba(0,0,0,.5);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 13px;
    color-scheme: dark;
    display: none;
  }
  .vsh-settings.vsh-show { display: block; }
  .vsh-settings h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
  .vsh-set-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 9px 0; }
  .vsh-set-row span { opacity: .85; }
  .vsh-settings input[type="number"] {
    width: 88px;
    box-sizing: border-box;
    padding: 5px 8px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,.18);
    background: rgba(255,255,255,.08);
    color: #fff;
    font-size: 13px;
  }
  .vsh-set-check { display: flex; align-items: center; gap: 8px; margin: 12px 0 2px; cursor: pointer; }
  .vsh-set-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .vsh-set-actions button {
    appearance: none;
    border: none;
    border-radius: 10px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
    background: rgba(255,255,255,.12);
    color: #fff;
    font-family: inherit;
  }
  .vsh-set-actions button:hover { background: rgba(255,255,255,.22); }
  .vsh-set-actions .vsh-primary { background: rgba(76,139,245,.9); }
  .vsh-set-actions .vsh-primary:hover { background: rgba(76,139,245,1); }
  .vsh-chip {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: ${Z};
    width: 34px;
    height: 34px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(20, 22, 26, .6);
    color: #fff;
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    opacity: .45;
    transition: opacity .15s;
    -webkit-tap-highlight-color: transparent;
  }
  .vsh-chip:hover { opacity: 1; }
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

  // 时长/步长的中文描述：3600→“1 小时”，300→“5 分钟”，85→“1分25秒”，10→“10 秒”
  function fmtDur(sec) {
    const abs = Math.abs(sec);
    if (!isFinite(abs)) return '--';
    if (abs >= 3600 && abs % 3600 === 0) return `${abs / 3600} 小时`;
    if (abs % 60 === 0) return `${abs / 60} 分钟`;
    if (abs > 60) return `${Math.floor(abs / 60)}分${abs % 60}秒`;
    return `${abs} 秒`;
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  // ============ 每个视频的状态 ============
  // item: { video, panes:[leftPane, rightPane], toggle, settingsBtn, buttons:[{el,seconds}], tip, idleTimer, tipTimer, expanded }
  const items = [];

  // All document-level wake handling is shared by every video. This avoids
  // retaining one capture listener per video in long-lived SPA pages.
  function wakeFromDocument(e) {
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
    for (const item of items) {
      const r = item.video.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        wake(item);
      }
    }
  }

  document.addEventListener('pointerdown', wakeFromDocument, true);
  document.addEventListener('touchstart', wakeFromDocument, { capture: true, passive: true });
  document.addEventListener('pointermove', wakeFromDocument, { capture: true, passive: true });

  // 按钮定义按 CONFIG 实时生成，设置保存后可立即刷新文案与步长
  // 左侧：快退（自上而下 大/中/小），右侧：快进
  function buttonDefs() {
    const big = fmtDur(CONFIG.STEP_BIG);
    const mid = fmtDur(CONFIG.STEP_MID);
    const small = fmtDur(CONFIG.STEP_SMALL);
    return [
      { label: `« ${big}`, seconds: -CONFIG.STEP_BIG, title: `快退 ${big}` },
      { label: `‹ ${mid}`, seconds: -CONFIG.STEP_MID, title: `快退 ${mid}` },
      { label: `‹ ${small}`, seconds: -CONFIG.STEP_SMALL, title: `快退 ${small}` },
      { label: `${big} »`, seconds: CONFIG.STEP_BIG, title: `快进 ${big}` },
      { label: `${mid} ›`, seconds: CONFIG.STEP_MID, title: `快进 ${mid}` },
      { label: `${small} ›`, seconds: CONFIG.STEP_SMALL, title: `快进 ${small}` }
    ];
  }

  // 设置变更后刷新已有按钮的文案与步长（前 3 个为快退，后 3 个为快进）
  function updateButtonLabels(item) {
    const defs = buttonDefs();
    item.buttons.forEach((b, i) => {
      b.seconds = defs[i].seconds;
      b.el.textContent = defs[i].label;
      b.el.title = defs[i].title;
      b.el.setAttribute('aria-label', defs[i].title);
    });
  }

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
    const defs = buttonDefs();
    const left = buildPane(defs.slice(0, 3));
    left.pane.classList.add('vsh-pane', 'vsh-left');
    const right = buildPane(defs.slice(3));
    right.pane.classList.add('vsh-pane', 'vsh-right');

    const tip = document.createElement('div');
    tip.className = 'vsh-tip';
    tip.innerHTML =
      '<div class="vsh-arrow-ico"></div><div class="vsh-txt"></div><div class="vsh-pos"></div>';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'vsh-toggle';
    toggle.textContent = '⏩';
    toggle.title = '展开快进快退按钮';
    toggle.setAttribute('aria-label', toggle.title);

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'vsh-toggle vsh-gear';
    settingsBtn.textContent = '⚙';
    settingsBtn.title = '快进快退设置';
    settingsBtn.setAttribute('aria-label', settingsBtn.title);
    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSettings();
    });
    settingsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    settingsBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    const item = {
      video,
      panes: [left.pane, right.pane],
      buttons: left.buttons.concat(right.buttons),
      toggle,
      settingsBtn,
      tip,
      idleTimer: null,
      tipTimer: null,
      expanded: false
    };
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.expanded = !item.expanded;
      updateExpandedState(item);
      if (item.expanded) wake(item);
    });
    toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    toggle.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    bindInteractions(item);
    bindAutoHide(item);
    items.push(item);
    relocate(item);
    syncPosition(item);
    return item;
  }

  // ---------- 跳转 ----------
  // step 为本次实际跳转秒数；showSeconds 用于长按连发时显示累计偏移量
  function doSeek(item, step, showSeconds) {
    const video = item.video;
    const shown = showSeconds == null ? step : showSeconds;
    if (!isFinite(video.duration)) {
      flashTip(item, shown, null);
      return;
    }
    let target = (video.currentTime || 0) + step;
    target = Math.min(Math.max(0, target), video.duration);
    video.currentTime = target;
    flashTip(item, shown, { current: target, duration: video.duration });
  }

  function flashTip(item, seconds, pos) {
    const forward = seconds > 0;
    item.tip.querySelector('.vsh-arrow-ico').textContent = forward ? '▶' : '◀';
    item.tip.querySelector('.vsh-txt').textContent = (forward ? '快进 ' : '快退 ') + fmtDur(seconds);
    item.tip.querySelector('.vsh-pos').textContent =
      pos && isFinite(pos.duration) ? `${fmt(pos.current)} / ${fmt(pos.duration)}` : '';

    item.tip.classList.add('vsh-show');
    clearTimeout(item.tipTimer);
    item.tipTimer = setTimeout(() => item.tip.classList.remove('vsh-show'), 700);
  }

  // ---------- 按键交互：点按一次 + 长按连发（桌面/手机统一 pointer 事件） ----------
  function bindInteractions(item) {
    item.buttons.forEach(({ el, seconds }) => {
      let repeatTimer = null;
      let holdStart = 0;
      let cumulative = 0;

      const stop = () => {
        el.classList.remove('vsh-pressing');
        if (repeatTimer) {
          clearTimeout(repeatTimer);
          repeatTimer = null;
        }
      };

      // 长按连发渐进加速：按住 1.2s 后间隔减半、2.5s 后再减半（下限 40ms）
      function scheduleRepeat() {
        const held = performance.now() - holdStart;
        let delay = CONFIG.REPEAT_MS;
        if (held > 2500) delay = Math.max(40, CONFIG.REPEAT_MS / 4);
        else if (held > 1200) delay = Math.max(40, CONFIG.REPEAT_MS / 2);
        repeatTimer = setTimeout(() => {
          cumulative += seconds;
          doSeek(item, seconds, cumulative);
          scheduleRepeat();
        }, delay);
      }

      el.addEventListener('pointerdown', (e) => {
        // 只响应主键/触摸，避免右键等
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add('vsh-pressing');
        holdStart = performance.now();
        cumulative = seconds;
        doSeek(item, seconds);
        wake(item);
        scheduleRepeat();
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
    updateExpandedState(item);
    clearTimeout(item.idleTimer);
    if (item.expanded && !item.video.paused && CONFIG.IDLE_MS > 0) {
      item.idleTimer = setTimeout(() => {
        // 仅随控件淡出，保留展开记忆：再次唤起（移动/点击）时仍保持展开
        item.panes.forEach((p) => p.classList.remove('vsh-show'));
      }, CONFIG.IDLE_MS);
    }
  }

  function updateExpandedState(item) {
    item.panes.forEach((p) => p.classList.toggle('vsh-show', item.expanded));
    item.toggle.textContent = item.expanded ? '×' : '⏩';
    item.toggle.title = item.expanded ? '折叠快进快退按钮' : '展开快进快退按钮';
    item.toggle.setAttribute('aria-label', item.toggle.title);
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
      updateExpandedState(item);
    });
    item.panes.forEach((p) => p.addEventListener('pointermove', wakeFn));

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
    item.toggle.style.display = visible ? '' : 'none';
    item.settingsBtn.style.display = visible ? '' : 'none';
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
      const rotToggleLeft = Math.max(gap, w - gap - item.toggle.offsetWidth);
      item.toggle.style.top = `${gap}px`;
      item.toggle.style.left = `${rotToggleLeft}px`;
      item.settingsBtn.style.top = `${gap}px`;
      item.settingsBtn.style.left = `${Math.max(gap, rotToggleLeft - item.settingsBtn.offsetWidth - 6)}px`;
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
    const toggleLeft = Math.max(r.left + gap, r.right - gap - item.toggle.offsetWidth);
    item.toggle.style.top = `${r.top + gap}px`;
    item.toggle.style.left = `${toggleLeft}px`;
    item.settingsBtn.style.top = `${r.top + gap}px`;
    item.settingsBtn.style.left = `${Math.max(r.left + gap, toggleLeft - item.settingsBtn.offsetWidth - 6 * scale)}px`;
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
    const targets = item.panes.concat([item.tip, item.toggle, item.settingsBtn]);

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

  // ============ 设置面板（⚙）与站点禁用角标 ============
  let settingsEl = null;
  let chipEl = null;

  // 站点被禁用时在右下角保留一个小角标作为设置入口，便于随时恢复
  function ensureChip() {
    if (!siteDisabled) {
      if (chipEl) {
        chipEl.remove();
        chipEl = null;
      }
      return;
    }
    if (chipEl && chipEl.isConnected) return;
    if (!chipEl) {
      chipEl = document.createElement('button');
      chipEl.type = 'button';
      chipEl.className = 'vsh-chip';
      chipEl.textContent = '⚙';
      chipEl.title = '快进快退按钮已在此站点禁用，点按打开设置';
      chipEl.addEventListener('click', openSettings);
    }
    document.body.appendChild(chipEl);
  }

  function openSettings() {
    if (!settingsEl) settingsEl = buildSettingsPanel();
    const fs = fullscreenElement();
    if (fs && !(fs instanceof HTMLVideoElement)) {
      // 播放器容器全屏：放进容器即可正常渲染
      appendSafe(fs, settingsEl);
      exitTopLayer(settingsEl);
    } else {
      appendSafe(document.body, settingsEl);
      // 原生 <video> 全屏需要 top layer；普通页面则确保不在 top layer
      if (fs) enterTopLayer(settingsEl);
      else exitTopLayer(settingsEl);
    }
    settingsEl.querySelector('#vsh-in-big').value = CONFIG.STEP_BIG;
    settingsEl.querySelector('#vsh-in-mid').value = CONFIG.STEP_MID;
    settingsEl.querySelector('#vsh-in-small').value = CONFIG.STEP_SMALL;
    settingsEl.querySelector('#vsh-in-repeat').value = CONFIG.REPEAT_MS;
    settingsEl.querySelector('#vsh-in-idle').value = CONFIG.IDLE_MS / 1000;
    settingsEl.querySelector('#vsh-in-disable').checked = siteDisabled;
    settingsEl.classList.add('vsh-show');
  }

  function closeSettings() {
    if (!settingsEl) return;
    settingsEl.classList.remove('vsh-show');
    exitTopLayer(settingsEl);
    settingsEl.remove();
  }

  function saveSettings() {
    const q = (sel) => settingsEl.querySelector(sel);
    CONFIG.STEP_BIG = Math.round(clampNum(q('#vsh-in-big').value, CONFIG.STEP_BIG, 1, 28800));
    CONFIG.STEP_MID = Math.round(clampNum(q('#vsh-in-mid').value, CONFIG.STEP_MID, 1, 3600));
    CONFIG.STEP_SMALL = Math.round(clampNum(q('#vsh-in-small').value, CONFIG.STEP_SMALL, 1, 600));
    CONFIG.REPEAT_MS = Math.round(clampNum(q('#vsh-in-repeat').value, CONFIG.REPEAT_MS, 40, 1000));
    CONFIG.IDLE_MS = clampNum(q('#vsh-in-idle').value, CONFIG.IDLE_MS / 1000, 0, 60) * 1000;
    store.set('cfg', {
      STEP_BIG: CONFIG.STEP_BIG,
      STEP_MID: CONFIG.STEP_MID,
      STEP_SMALL: CONFIG.STEP_SMALL,
      REPEAT_MS: CONFIG.REPEAT_MS,
      IDLE_MS: CONFIG.IDLE_MS
    });

    const disable = q('#vsh-in-disable').checked;
    if (disable !== siteDisabled) {
      let bl = store.get('blacklist', []);
      if (!Array.isArray(bl)) bl = [];
      if (disable) bl.push(location.hostname);
      else bl = bl.filter((h) => h !== location.hostname);
      store.set('blacklist', bl);
    }
    siteDisabled = disable;
    ensureChip();
    if (siteDisabled) {
      items.slice().forEach(destroyItem);
    } else {
      items.forEach(updateButtonLabels);
      scan();
    }
    closeSettings();
  }

  function buildSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'vsh-settings';
    panel.innerHTML = `
      <h3>快进快退 · 设置</h3>
      <div class="vsh-set-row"><span>大步长（秒）</span><input id="vsh-in-big" type="number" min="5" max="28800" step="1"></div>
      <div class="vsh-set-row"><span>中步长（秒）</span><input id="vsh-in-mid" type="number" min="5" max="3600" step="1"></div>
      <div class="vsh-set-row"><span>小步长（秒）</span><input id="vsh-in-small" type="number" min="1" max="600" step="1"></div>
      <div class="vsh-set-row"><span>长按连发间隔（毫秒）</span><input id="vsh-in-repeat" type="number" min="40" max="1000" step="10"></div>
      <div class="vsh-set-row"><span>自动隐藏延时（秒，0 为常驻）</span><input id="vsh-in-idle" type="number" min="0" max="60" step="0.1"></div>
      <label class="vsh-set-check"><input id="vsh-in-disable" type="checkbox"><span></span></label>
      <div class="vsh-set-actions">
        <button type="button" id="vsh-reset">恢复默认</button>
        <button type="button" id="vsh-cancel">取消</button>
        <button type="button" id="vsh-save" class="vsh-primary">保存</button>
      </div>`;
    panel.querySelector('.vsh-set-check span').textContent = `在此站点禁用（${location.hostname}）`;

    panel.querySelector('#vsh-cancel').addEventListener('click', closeSettings);
    panel.querySelector('#vsh-save').addEventListener('click', saveSettings);
    panel.querySelector('#vsh-reset').addEventListener('click', () => {
      panel.querySelector('#vsh-in-big').value = DEFAULTS.STEP_BIG;
      panel.querySelector('#vsh-in-mid').value = DEFAULTS.STEP_MID;
      panel.querySelector('#vsh-in-small').value = DEFAULTS.STEP_SMALL;
      panel.querySelector('#vsh-in-repeat').value = DEFAULTS.REPEAT_MS;
      panel.querySelector('#vsh-in-idle').value = DEFAULTS.IDLE_MS / 1000;
    });

    // 阻断面板内事件透传到页面/播放器，避免输入时触发站点快捷键
    ['pointerdown', 'pointerup', 'click', 'dblclick', 'touchstart', 'touchend', 'touchcancel', 'keyup', 'keypress', 'wheel']
      .forEach((type) => panel.addEventListener(type, (e) => e.stopPropagation(), { passive: true }));
    panel.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeSettings();
    });
    return panel;
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
    if (settingsEl && settingsEl.classList.contains('vsh-show')) closeSettings();
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
    ensureChip(); // 禁用时显示角标入口，恢复启用时移除角标
    if (siteDisabled) return;
    const videos = document.querySelectorAll('video');
    videos.forEach((v) => {
      if (seen.has(v)) return;
      if (!isBigVideo(v)) return; // 小预览视频先不挂，后续扫描到变大再挂
      seen.add(v);
      createItem(v);
    });
  }

  function destroyItem(item) {
    clearTimeout(item.idleTimer);
    clearTimeout(item.tipTimer);
    item.panes.concat([item.tip, item.toggle, item.settingsBtn]).forEach((el) => {
      exitTopLayer(el);
      el.remove();
    });
    // 从已见集合移除：SPA 把同一 <video> 临时移出再插回 DOM 时能重新挂上按钮
    seen.delete(item.video);
    const index = items.indexOf(item);
    if (index !== -1) items.splice(index, 1);
  }

  function pruneItems() {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (!item.video.isConnected) destroyItem(item);
    }
  }

  injectStyle();
  scan();

  // MutationObserver 去抖：动态页面 DOM 变更非常频繁，200ms 合并一次扫描
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer || document.hidden) return; // 后台不扫，回到前台由 visibilitychange 补扫
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 200);
  }
  const mo = new MutationObserver(scheduleScan);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 有些视频是懒加载/稍后才变大：仅前台低频补扫，后台标签页完全跳过
  setInterval(() => { if (!document.hidden) scan(); }, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scan(); });

  // 油猴菜单入口（站点被禁用时也可由此打开设置重新启用）
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙ 快进快退按钮设置', openSettings);
  }

  // 每帧同步位置（滚动/页面内全屏/布局变化都能跟随），开销很小
  function frameLoop() {
    pruneItems();
    for (const item of items) {
      // 播放器在全屏时重建控件导致按钮被移出 DOM 时，自动重新挂载
      if (!item.panes[0].isConnected || !item.panes[1].isConnected) relocate(item);
      if (item.panes[0].isConnected) syncPosition(item);
    }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
})();
