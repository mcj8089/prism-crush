/**
 * UI 控制 —— 屏幕切换、弹窗、HUD 按钮、Toast、设置面板
 * =====================================================================
 * 约定：屏幕/弹窗一律用 .is-active 控制 display（verify 用 getComputedStyle
 * 判断可见性），关闭动画用 .is-closing 短暂标记。装饰层永不拦截点击。
 */

import { STAGE, TOUCH } from '../../config/game.config.js';

/** 平台图标（内联 SVG，避免任何外部请求；不是纯文字列表） */
export const PLATFORMS = [
  {
    id: 'facebook', labelKey: 'share_platform_facebook', color: '#1877F2',
    icon: '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/>',
  },
  {
    id: 'twitter', labelKey: 'share_platform_twitter', color: '#E7EBF0',
    icon: '<path d="M17.5 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L4.8 21H1.7l7.3-8.3L1.5 3H8l4.4 5.9zm-1.1 16.1h1.7L7.7 4.8H5.9z"/>',
  },
  {
    id: 'reddit', labelKey: 'share_platform_reddit', color: '#FF4500',
    icon: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5.3 11.1c.03.2.05.4.05.6 0 2.5-2.9 4.5-6.4 4.5s-6.4-2-6.4-4.5c0-.2.02-.41.05-.6a1.05 1.05 0 1 1 1.17-1.72 6.9 6.9 0 0 1 3.63-1.16l.62-2.9a.5.5 0 0 1 .6-.38l2.07.44a1.1 1.1 0 1 1 .23 1.08l-1.9-.4-.5 2.4a6.9 6.9 0 0 1 3.55 1.15 1.05 1.05 0 1 1 1.15 1.78l.08.03zM9 13.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-4.9 3.1a3.2 3.2 0 0 0 5.8 0 .48.48 0 0 0-.86-.4 2.3 2.3 0 0 1-4.1 0 .48.48 0 1 0-.86.4z"/>',
  },
  {
    id: 'whatsapp', labelKey: 'share_platform_whatsapp', color: '#25D366',
    icon: '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.6-1.2.1-.2 0-.4 0-.5l-.8-1.8c-.2-.5-.4-.5-.6-.5h-.5a1 1 0 0 0-.7.3A2.9 2.9 0 0 0 6.6 10c0 1.3.9 2.5 1 2.7a11 11 0 0 0 4.3 3.8c1.6.6 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1z"/>',
  },
  {
    id: 'telegram', labelKey: 'share_platform_telegram', color: '#29A9EB',
    icon: '<path d="M21.9 4.3 18.6 20c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-4.9 9-8.1c.7-.6-.2-.9-.6-.4L6.1 13.2l-4.8-1.5c-1-.3-1-1 .2-1.5l18.9-7.3c.9-.3 1.6.2 1.5 1.4z"/>',
  },
  {
    id: 'linkedin', labelKey: 'share_platform_linkedin', color: '#0A66C2',
    icon: '<path d="M20.4 20.4h-3.6v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.3V9h3.4v1.6h.1a3.8 3.8 0 0 1 3.4-1.9c3.6 0 4.3 2.4 4.3 5.5zM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM7.1 20.4H3.5V9h3.6z"/>',
  },
  {
    id: 'tiktok', labelKey: 'share_platform_tiktok', color: '#FE2C55',
    icon: '<path d="M16.6 2h-3.1v13.4a2.7 2.7 0 1 1-2.7-2.7c.3 0 .5 0 .8.1V9.6a5.9 5.9 0 1 0 5 5.8V8.6a7.3 7.3 0 0 0 4.3 1.4V6.9a4.3 4.3 0 0 1-4.3-4.3z"/>',
  },
  {
    id: 'instagram', labelKey: 'share_platform_instagram', color: '#E1306C',
    icon: '<path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 3.4A6.4 6.4 0 1 0 18.4 12 6.4 6.4 0 0 0 12 5.6zm0 10.5A4.1 4.1 0 1 1 16.1 12 4.1 4.1 0 0 1 12 16.1zm6.6-10.9a1.5 1.5 0 1 1-1.5-1.5 1.5 1.5 0 0 1 1.5 1.5z"/>',
  },
  {
    id: 'youtube', labelKey: 'share_platform_youtube', color: '#FF0000',
    icon: '<path d="M23 12s0-3.6-.5-5.3a2.7 2.7 0 0 0-1.9-1.9C18.8 4.3 12 4.3 12 4.3s-6.8 0-8.6.5a2.7 2.7 0 0 0-1.9 1.9C1 8.4 1 12 1 12s0 3.6.5 5.3a2.7 2.7 0 0 0 1.9 1.9c1.8.5 8.6.5 8.6.5s6.8 0 8.6-.5a2.7 2.7 0 0 0 1.9-1.9C23 15.6 23 12 23 12zM9.8 15.4V8.6l6 3.4z"/>',
  },
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export class UI {
  /**
   * @param {object} opt
   * @param {import('../core/i18n.js').I18n} opt.i18n
   * @param {(action:string)=>void} opt.onAction
   * @param {object} opt.save
   * @param {(key:string)=>void} [opt.onSound]
   */
  constructor(opt) {
    this.i18n = opt.i18n;
    this.onAction = opt.onAction;
    this.save = opt.save;
    this.onSound = opt.onSound || (() => {});
    this.screen = 'boot';
    this.overlay = null;
    this.listeners = [];
    this.el = {
      body: document.body,
      screens: {
        boot: $('#screen-boot'),
        menu: $('#screen-menu'),
        game: $('#screen-game'),
      },
      hud: $('#hud-bar'),
      pad: $('#pad-cluster'),
      toasts: $('#toast-stack'),
      overlays: {
        tutorial: $('#overlay-tutorial'),
        settings: $('#overlay-settings'),
        result: $('#overlay-result'),
        share: $('#overlay-share'),
        domain: $('#overlay-domain'),
      },
      result: {
        score: $('#res-score'), best: $('#res-best'), lines: $('#res-lines'),
        level: $('#res-level'), time: $('#res-time'), rank: $('#res-rank'),
        record: $('#res-record'),
        revive: $('#btn-revive'), double: $('#btn-double'),
      },
      menu: {
        best: $('#stat-best'), lines: $('#stat-lines'), runs: $('#stat-runs'),
      },
      boot: {
        gauge: $('#load-gauge'), fill: $('#gauge-fill'), head: $('#gauge-head'),
        seeds: $$('.gauge-seeds .seed'), step: $('#loading-step'), tip: $('#loading-tip'),
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* 事件绑定                                                          */
  /* ---------------------------------------------------------------- */

  bind(handlers = {}) {
    const click = (sel, fn, sound = 'ui_click') => {
      const el = $(sel);
      if (!el || !fn) return;
      const wrapped = (ev) => { this.onSound(sound); fn(ev); };
      el.addEventListener('click', wrapped);
      this.listeners.push([el, 'click', wrapped]);
    };
    click('#btn-play', handlers.play);
    click('#btn-howto', (e) => { handlers.howto && handlers.howto(e); this.open('tutorial'); });
    click('#btn-settings', () => this.open('settings'));
    click('#btn-share', handlers.share);
    click('#btn-reset', handlers.reset);
    click('#btn-pause', handlers.pause);
    click('#btn-home', handlers.home);
    click('#set-close', () => this.close());
    click('#set-ok', () => this.close());
    click('#tut-close', () => this.close());
    click('#share-close', () => this.close());
    click('#btn-again', handlers.again);
    click('#btn-result-home', handlers.home);
    click('#btn-share-result', handlers.share);
    click('#btn-domain-go', handlers.domainGo);
    click('#btn-revive', handlers.revive);
    click('#btn-double', handlers.double);

    // 触控板（按住连发，等价于键盘长按）
    const pad = (sel, action) => {
      const el = $(sel);
      if (!el) return;
      const down = (ev) => {
        ev.preventDefault();
        this.onSound('ui_click');
        handlers.padAction ? handlers.padAction(action, true) : this.onAction(action);
      };
      const up = (ev) => {
        ev.preventDefault();
        handlers.padAction ? handlers.padAction(action, false) : null;
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      this.listeners.push([el, 'pointerdown', down], [el, 'pointerup', up]);
    };
    pad('#pad-left', 'left');
    pad('#pad-right', 'right');
    pad('#pad-down', 'down');
    pad('#pad-rotate', 'rotate');

    // 设置开关
    const toggle = (sel, key, onChange) => {
      const el = $(sel);
      if (!el) return;
      const fn = () => { this.onSound('ui_click'); onChange(el.checked); };
      el.addEventListener('change', fn);
      this.listeners.push([el, 'change', fn]);
      this._toggles = this._toggles || {};
      this._toggles[key] = el;
    };
    toggle('#ck-sound', 'sound', handlers.onSetting);
    toggle('#ck-music', 'music', handlers.onSetting);
    toggle('#ck-shake', 'shake', handlers.onSetting);
    toggle('#ck-ghost', 'ghost', handlers.onSetting);
    toggle('#ck-particles', 'particles', handlers.onSetting);

    return this;
  }

  unbind() {
    for (const [el, type, fn] of this.listeners) el.removeEventListener(type, fn);
    this.listeners.length = 0;
  }

  /* ---------------------------------------------------------------- */
  /* 屏幕与弹窗                                                        */
  /* ---------------------------------------------------------------- */

  showScreen(name) {
    if (!this.el.screens[name]) return this;
    for (const [k, el] of Object.entries(this.el.screens)) {
      if (!el) continue;
      el.classList.toggle('is-active', k === name);
    }
    this.screen = name;
    this.el.body.setAttribute('data-screen', name);
    // 局内才显示 HUD / 触控板
    if (this.el.hud) this.el.hud.style.display = name === 'game' ? 'flex' : 'none';
    this.syncPad();
    return this;
  }

  open(key, opts = {}) {
    const el = this.el.overlays[key];
    if (!el) return this;
    // 同一时刻只允许一个模态：先关掉其它已开的，避免两层弹窗叠在一起
    for (const [k, other] of Object.entries(this.el.overlays)) {
      if (k !== key && other && other.classList.contains('is-active')) {
        other.classList.remove('is-active');
        other.classList.remove('is-closing');
      }
    }
    el.classList.remove('is-closing');
    el.classList.add('is-active');
    this.overlay = key;
    this.el.body.setAttribute('data-overlay', key);
    if (opts.focus) {
      const f = el.querySelector('input, button');
      if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
    }
    return this;
  }

  close(key) {
    const el = key ? this.el.overlays[key] : null;
    const targets = el ? [el] : Object.values(this.el.overlays).filter((o) => o && o.classList.contains('is-active'));
    for (const t of targets) {
      t.classList.add('is-closing');
      setTimeout(() => {
        t.classList.remove('is-active');
        t.classList.remove('is-closing');
      }, 240);
    }
    if (!targets.length) return this;
    this.overlay = null;
    this.el.body.removeAttribute('data-overlay');
    return this;
  }

  isOpen(key) {
    const el = this.el.overlays[key];
    return !!(el && el.classList.contains('is-active'));
  }

  /** 任何弹窗打开时，游戏输入必须静默 */
  get modalOpen() { return !!this.overlay; }

  /* ---------------------------------------------------------------- */
  /* 触控板可见性                                                      */
  /* ---------------------------------------------------------------- */

  syncPad() {
    const pad = this.el.pad;
    if (!pad) return;
    const coarse = typeof window !== 'undefined' &&
      (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false);
    const fine = typeof window !== 'undefined' &&
      (window.matchMedia ? window.matchMedia('(pointer: fine)').matches : false);
    const narrow = typeof window !== 'undefined' && window.innerWidth <= TOUCH.showPadAt;
    // 触屏设备一定给；窄窗口的鼠标用户可用，但桌面全宽时不占画面
    const show = this.screen === 'game' && !this.modalOpen && (coarse || (narrow && !fine));
    pad.hidden = !show;
  }

  /* ---------------------------------------------------------------- */
  /* 开屏加载                                                          */
  /* ---------------------------------------------------------------- */

  /** @param {number} ratio 0..1 */
  setProgress(ratio) {
    const b = this.el.boot;
    if (!b.fill) return;
    const pct = Math.max(0, Math.min(1, ratio));
    b.fill.style.width = `${(pct * 100).toFixed(1)}%`;
    if (b.head) b.head.style.left = `${(pct * 100).toFixed(1)}%`;
    if (b.gauge) b.gauge.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
    b.seeds.forEach((s, i) => s.classList.toggle('on', pct >= (i + 0.5) / b.seeds.length));
  }

  setBootStage(key) {
    if (!this.el.boot.step) return;
    const text = this.i18n.t(key);
    this.el.boot.step.setAttribute('data-i18n', key);
    this.el.boot.step.textContent = text;
  }

  setBootTip(key) {
    if (!this.el.boot.tip) return;
    this.el.boot.tip.setAttribute('data-i18n', key);
    this.el.boot.tip.textContent = this.i18n.t(key);
  }

  /* ---------------------------------------------------------------- */
  /* 菜单 / 结算 / Toast                                               */
  /* ---------------------------------------------------------------- */

  refreshMenu() {
    const s = this.save && this.save.snapshot ? this.save.snapshot() : {};
    if (this.el.menu.best) this.el.menu.best.textContent = String(s.best || 0);
    if (this.el.menu.lines) this.el.menu.lines.textContent = String(s.totalLines || 0);
    if (this.el.menu.runs) this.el.menu.runs.textContent = String(s.runs || 0);
  }

  setSettings(values) {
    if (!this._toggles) return;
    for (const [k, el] of Object.entries(this._toggles)) {
      if (values[k] !== undefined) el.checked = !!values[k];
    }
  }

  showResult(data) {
    const r = this.el.result;
    if (r.score) r.score.textContent = String(data.score | 0);
    if (r.best) r.best.textContent = String(data.highScore | 0);
    if (r.lines) r.lines.textContent = String(data.lines | 0);
    if (r.level) r.level.textContent = String(data.level | 0);
    if (r.time) r.time.textContent = data.time || '00:00:00';
    if (r.record) r.record.hidden = !data.newRecord;
    if (r.rank) r.rank.textContent = this.i18n.t('over_rank', { level: data.level | 0 });
    if (r.revive) {
      const left = data.revivesLeft | 0;
      const show = data.reviveAvailable && left > 0;
      r.revive.hidden = !show;
      if (show) r.revive.textContent = `${this.i18n.t('over_revive')} · ${this.i18n.t('over_revive_left', { n: left })}`;
    }
    if (r.double) {
      const show = !!data.doubleAvailable;
      r.double.hidden = !show;
      if (show) r.double.textContent = this.i18n.t('over_double');
    }
    this.open('result');
  }

  toast(key, vars, kind = '') {
    const stack = this.el.toasts;
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`.trim();
    el.textContent = this.i18n.t(key, vars);
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3000);
    // 最多留 3 条
    while (stack.children.length > 3) stack.removeChild(stack.firstChild);
  }

  /** 应用 i18n 到全部静态节点 */
  translate() {
    this.i18n.apply(document);
    this.refreshMenu();
  }

  /* ---------------------------------------------------------------- */
  /* 舞台缩放                                                          */
  /* ---------------------------------------------------------------- */

  stageSize() {
    const wrap = $('#stage-wrap');
    if (!wrap) return { w: STAGE.w, h: STAGE.h };
    return { w: wrap.clientWidth || STAGE.w, h: wrap.clientHeight || STAGE.h };
  }

  keyartTargets() {
    return { boot: this.el.boot && $('#boot-keyart'), menu: $('#menu-keyart') };
  }
}

export { $, $$ };
