/**
 * 游戏编排 —— 对齐原作 js/Tetris.js + Score.js + Leval.js + Timer.js + highscore.js
 * =====================================================================
 * 锁定的原作节奏：
 *   · 下落由 setInterval(speed) 驱动，speed = floor(1000*(1-(lv-1)/10))
 *   · 按 ↓ 会「重置计时相位」（原作 clearInterval + setInterval），这里等价
 *     地把累加器归零
 *   · 得分 lines*10*lines；升级门槛 2^lv*100，一次只升一级
 *   · 升级时原作弹 alert 并暂停 → 这里改为非阻塞横幅，仍暂停同样时长节奏，
 *     属于「优化引导动画」白名单，不改变判定
 *   · 最高分写 localStorage('high-score')，与原作同源
 * 实现上把 setInterval 换成可被 step(dtMs) 驱动的累加器 —— 时间轴完全等价，
 * 且能在无头浏览器里被 api.step() 确定性推进。
 */

import { RULES, LEVELS, BOARD as BOARD_CFG } from '../../config/game.config.js';
import { Board } from './board.js';

/** 原作 Leval.js 的升级判定（一次只升一级） */
export function checkLevel(score, current) {
  return score >= Math.pow(2, current) * 100 ? current + 1 : 0;
}

/** 原作 highscore.js 的存储 key */
export const HIGH_SCORE_KEY = RULES.highScoreKey;

export class Game {
  /**
   * @param {object} [opts]
   * @param {(type:string,payload:object)=>void} [opts.onEvent]
   * @param {()=>number} [opts.rng]
   * @param {(key:string)=>string|null} [opts.readStorage]
   * @param {(key:string,value:string)=>void} [opts.writeStorage]
   */
  constructor(opts = {}) {
    this.onEvent = opts.onEvent || (() => {});
    this.readStorage = opts.readStorage || defaultRead;
    this.writeStorage = opts.writeStorage || defaultWrite;
    this.rng = opts.rng || null;

    this.board = new Board({
      rng: this.rng,
      onEvent: (type, payload) => this._relay(type, payload),
    });

    /** 'idle' | 'playing' | 'levelup' | 'pause' | 'over' */
    this.state = 'idle';
    this.score = 0;
    this.level = 0;            // 原作 leval 从 0 开始计数，显示时 +0（原作就显示 Leval 0）
    this.lines = 0;
    this.highScore = Number(this.readStorage(HIGH_SCORE_KEY) || 0) || 0;
    this.elapsed = 0;          // 毫秒（原作 Timer 每 1000ms +1 秒）
    this._fall = 0;            // 下落累加器
    this._speed = RULES.constSpeed;
    this._levelHold = 0;       // 升级横幅剩余毫秒
    this._lastClear = null;    // 供特效/UI 播报
    this._peakCells = 0;
  }

  /* ---------------------------------------------------------------- */
  /* 生命周期                                                          */
  /* ---------------------------------------------------------------- */

  /** 原作 Tetris.prototype.startGame */
  start(rng = null) {
    if (rng !== null) this.rng = rng;
    this.board.reset(this.rng);
    this.score = 0;
    this.level = 0;
    this.lines = 0;
    this.elapsed = 0;
    this._fall = 0;
    this._speed = RULES.constSpeed;
    this._levelHold = 0;
    this._lastClear = null;
    this.state = 'playing';
    this.onEvent('start', {});
    return this;
  }

  /** 原作 pause()：停 tick、停计时、停音乐 */
  pause() {
    if (this.state === 'over') return false;
    if (this.state !== 'playing' && this.state !== 'levelup') return false;
    this._resumeTo = this.state;
    this.state = 'pause';
    this.onEvent('pause', {});
    return true;
  }

  /** 原作 resume()：over 状态直接 return，保持不变 */
  resume() {
    if (this.state === 'over') return false;
    if (this.state !== 'pause') return false;
    this.state = 'playing';
    this.onEvent('resume', {});
    return true;
  }

  /** 原作 endGame()：停音乐、停 tick、停计时 */
  end() {
    this.state = 'over';
    this.onEvent('end', { score: this.score, lines: this.lines, level: this.level });
  }

  /* ---------------------------------------------------------------- */
  /* 主循环                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * 推进一帧。
   * @param {number} dtMs 真实/模拟毫秒
   */
  step(dtMs) {
    if (this.state === 'levelup') {
      this._levelHold -= dtMs;
      if (this._levelHold <= 0) {
        this._levelHold = 0;
        this.state = 'playing';
        this.onEvent('levelResume', {});
      }
      return;
    }
    if (this.state !== 'playing') return;

    // 原作 Timer：每 1000ms 计时 +1 秒
    this.elapsed += dtMs;

    this._fall += dtMs;
    let guard = 0;
    while (this._fall >= this._speed && this.state === 'playing' && guard++ < 240) {
      this._fall -= this._speed;
      this._tick();
    }
  }

  /** 原作 Board.tick 的一次迭代 */
  _tick() {
    const r = this.board.tick();
    if (r.over) {
      this.end();
      return;
    }
    if (r.locked) {
      this._peakCells = this.board.stackTop();
    }
  }

  /** 内部事件转接：把 Board 事件翻译成原作那套分数/等级流程 */
  _relay(type, payload) {
    if (type === 'clear') {
      this.lines += payload.lines;
      this._applyScore(payload.gained);
      this._lastClear = { lines: payload.lines, gained: payload.gained, rows: payload.rows, at: this.elapsed };
      this.onEvent('clear', this._lastClear);
      return;
    }
    this.onEvent(type, payload);
  }

  /**
   * 原作 clearFullRows 的分数 + 等级 + 速度三段流程
   * @param {number} gained
   */
  _applyScore(gained) {
    // Score.addScore
    this.score += gained;
    // HighScore.checkScore
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try { this.writeStorage(HIGH_SCORE_KEY, String(this.highScore)); } catch (e) { /* 隐私模式忽略 */ }
      this.onEvent('highscore', { highScore: this.highScore });
    }
    // Leval.checkLeval
    const next = checkLevel(this.score, this.level);
    if (next) {
      this.level = next;
      // 原作：speed = floor(constSpeed * (1 - (level-1)/10))
      const idx = Math.min(Math.max(this.level - 1, 0), LEVELS.length - 1);
      this._speed = LEVELS[idx] ? LEVELS[idx].speed : Board.speedForLevel(this.level);
      this._fall = 0;
      // 原作 pause() + alert + resume() → 非阻塞横幅，同样暂停节奏
      this.state = 'levelup';
      this._levelHold = LEVEL_UP_HOLD_MS;
      this.onEvent('levelup', { level: this.level, speed: this._speed });
    }
  }

  /* ---------------------------------------------------------------- */
  /* 输入                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 原作 Keyboard.prototype.press 的等价封装。
   * @param {'left'|'right'|'down'|'rotate'|'pause'} action
   */
  input(action) {
    if (this.state === 'levelup') return false;      // 原作 alert 阻塞期间不响应
    if (this.state !== 'playing') return false;      // 原作：_state != 'playing' 直接 return
    switch (action) {
      case 'left': return this._after(this.board.moveLeft());
      case 'right': return this._after(this.board.moveRight());
      case 'rotate': return this._after(this.board.rotate());
      case 'down': {
        const ok = this.board.softDrop();
        if (ok) this._fall = 0; // 原作：↓ 会 clearInterval + 重新 setInterval（重置相位）
        return this._after(ok);
      }
      case 'pause':
        if (this.state === 'pause') return this.resume();
        return this.pause();
      default: return false;
    }
  }

  _after(ok) {
    if (ok) this.onEvent('redraw', {});
    return ok;
  }

  /* ---------------------------------------------------------------- */
  /* 查询                                                              */
  /* ---------------------------------------------------------------- */

  get speed() { return this._speed; }
  get levelIndex() { return this.level; }
  /** 显示用等级（原作面板显示 'Leval ' + leval，leval 从 0 起） */
  get levelLabel() { return this.level; }
  /** 0..1 当前帧在两格之间的下落进度（仅渲染插值用，不参与判定） */
  get fallProgress() {
    if (this.state !== 'playing') return 0;
    return Math.min(1, Math.max(0, this._fall / this._speed));
  }
  get timeSeconds() { return Math.floor(this.elapsed / 1000); }

  /** 原作 Timer._format */
  formatTime(second = this.timeSeconds) {
    let s = second;
    const hours = Math.floor(s / 3600);
    s -= hours * 3600;
    const minutes = Math.floor(s / 60);
    s -= minutes * 60;
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return `${p(hours)}:${p(minutes)}:${p(s)}`;
  }

  /** verify 契约：状态快照 */
  snapshot() {
    return {
      state: this.state,
      score: this.score,
      level: this.level,
      lines: this.lines,
      highScore: this.highScore,
      speed: this._speed,
      time: this.formatTime(),
      timeSeconds: this.timeSeconds,
      fallProgress: this.fallProgress,
      stackTop: this.board.stackTop(),
      shape: {
        x: this.board.shape.x, y: this.board.shape.y,
        type: this.board.shape.blockType, layout: this.board.shape.layout,
      },
      next: { type: this.board.nextShape.blockType, layout: this.board.nextShape.layout },
      grid: this.board.grid,
      cols: this.board.cols,
      rows: this.board.rows,
    };
  }
}

/** 升级横幅的暂停时长：原作是 alert（玩家点掉才继续），这里给一个固定的短停 */
export const LEVEL_UP_HOLD_MS = 1200;

function defaultRead(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function defaultWrite(key, value) {
  try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}

export default Game;
