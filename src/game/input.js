/**
 * 输入 —— 桌面端 1:1 还原原作四向键，移动端做等价触控适配
 * =====================================================================
 * 原作 Keyboard.js：keydown 监听 keyCode 37/38/39/40 → left/top/right/down，
 * 且仅在 gameInst._state === 'playing' 时响应（这里由 Game.input 内部把关）。
 * 额外保留：空格暂停（原作面板按钮的键盘等价）、P 暂停。不新增任何影响
 * 核心爽点的操作（没有硬降、没有 hold）。
 */

import { TOUCH } from '../../config/game.config.js';

/** 原作 keys 映射 */
export const KEY_MAP = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowUp: 'rotate',
  // 兼容老键盘的 keyCode 写法（原作就是用 keyCode）
  37: 'left',
  39: 'right',
  40: 'down',
  38: 'rotate',
};

const PAUSE_KEYS = new Set(['Space', 'KeyP', 'Pause', 32, 80]);

export class InputController {
  /**
   * @param {object} opts
   * @param {(action:string)=>any} opts.onAction
   * @param {HTMLElement} [opts.target] 触控监听元素（画布容器）
   * @param {()=>boolean} [opts.shouldIgnore] 返回 true 时不处理输入（弹窗/暂停界面）
   */
  constructor(opts) {
    this.onAction = opts.onAction;
    this.target = opts.target || null;
    this.shouldIgnore = opts.shouldIgnore || (() => false);
    this._bound = [];
    this._touch = null;
    this._repeat = null;
    this._swipeStepMs = 55;   // 连续滑动的最小步进（≈ 原作按住方向键的手感）
  }

  attach() {
    const on = (el, type, fn, opt) => {
      if (!el) return;
      el.addEventListener(type, fn, opt);
      this._bound.push([el, type, fn, opt]);
    };
    on(window, 'keydown', this._onKeyDown.bind(this), false);
    if (this.target) {
      on(this.target, 'touchstart', this._onTouchStart.bind(this), { passive: false });
      on(this.target, 'touchmove', this._onTouchMove.bind(this), { passive: false });
      on(this.target, 'touchend', this._onTouchEnd.bind(this), { passive: false });
      on(this.target, 'pointerdown', this._onPointerDown.bind(this), false);
      on(this.target, 'pointerup', this._onPointerUp.bind(this), false);
    }
    return this;
  }

  detach() {
    for (const [el, type, fn, opt] of this._bound) el.removeEventListener(type, fn, opt);
    this._bound.length = 0;
    this._stopRepeat();
  }

  /* ---------------- 键盘 ---------------- */

  _onKeyDown(evt) {
    if (this.shouldIgnore()) return;
    const code = evt.code;
    if (PAUSE_KEYS.has(code) || PAUSE_KEYS.has(evt.keyCode)) {
      evt.preventDefault();
      this.onAction('pause');
      return;
    }
    const action = KEY_MAP[code] ?? KEY_MAP[evt.keyCode];
    if (!action) return;
    evt.preventDefault();
    this.onAction(action);
  }

  /* ---------------- 触控（移动端） ---------------- */

  _onTouchStart(evt) {
    if (this.shouldIgnore()) return;
    if (evt.touches.length !== 1) return;
    const t = evt.touches[0];
    this._touch = { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, t: performance.now(), axis: null, steps: 0 };
  }

  _onTouchMove(evt) {
    if (!this._touch || this.shouldIgnore()) return;
    evt.preventDefault();
    const t = evt.touches[0];
    const dx = t.clientX - this._touch.x0;
    const dy = t.clientY - this._touch.y0;
    if (!this._touch.axis) {
      if (Math.abs(dx) < TOUCH.swipeThreshold && Math.abs(dy) < TOUCH.swipeThreshold) return;
      this._touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    const last = this._touch.x;
    this._touch.x = t.clientX;
    this._touch.y = t.clientY;
    if (this._touch.axis === 'x') {
      // 横向拖动：每移动一格阈值就平移一格，等价于按住方向键
      const step = this._swipeStepMs * 0.9;
      if (Math.abs(t.clientX - last) >= 14) {
        this.onAction(t.clientX > last ? 'right' : 'left');
        this._touch.steps++;
        void step;
      }
    } else if (dy > TOUCH.swipeThreshold) {
      this.onAction('down');
      this._touch.steps++;
    }
  }

  _onTouchEnd(evt) {
    if (!this._touch) return;
    const moved = Math.hypot(this._touch.x - this._touch.x0, this._touch.y - this._touch.y0);
    const quick = performance.now() - this._touch.t < 320;
    if (moved < TOUCH.swipeThreshold && quick && TOUCH.tapRotate) {
      this.onAction('rotate'); // 轻点 = 旋转（移动端等价 ↑）
    }
    void evt;
    this._touch = null;
  }

  /* ---------------- 桌面端鼠标（仅用于点击触控按钮，不改变玩法） -------- */

  _onPointerDown() { this._stopRepeat(); }
  _onPointerUp() { this._stopRepeat(); }

  /** 供屏幕按钮使用：按住连发 */
  startRepeat(action) {
    this._stopRepeat();
    this.onAction(action);
    this._repeat = setInterval(() => this.onAction(action), TOUCH.longPressRepeatMs);
  }

  stopRepeat() { this._stopRepeat(); }

  _stopRepeat() {
    if (this._repeat) { clearInterval(this._repeat); this._repeat = null; }
  }
}

export default InputController;
