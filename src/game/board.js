/**
 * 棋盘与判定 —— 逐行对齐原作 js/Board.js
 * =====================================================================
 * 保留的既有判定（属于「严格锁定」白名单）：
 *   · 13×20 网格，占用表存 blockType（1..7）
 *   · validMove 的越界/碰撞条件（含 nextY<0 的 undefined 判定写法）
 *   · 落地即写表 → 若撞到已占用格则 game over → 再消行
 *   · clearFullRows 从下往上、`filled && y`（第 0 行永不消除）
 *   · 得分 lines * 10 * lines
 * 表现层扩展（不改判定）：ghost 落点、消行事件里附带被消格坐标供特效使用。
 */

import { BOARD, RULES, LEVELS } from '../../config/game.config.js';
import { Shape } from './shape.js';

/** 生成一行空数据 */
function createEmptyRow(cols = BOARD.cols) {
  return new Array(cols).fill(0);
}

export class Board {
  /**
   * @param {object} [opts]
   * @param {(layout:Shape)=>void} [opts.onEvent] 事件回调 (type, payload)
   * @param {()=>number} [opts.rng] 覆盖随机源
   * @param {number} [opts.rows]
   * @param {number} [opts.cols]
   */
  constructor(opts = {}) {
    this.rows = opts.rows ?? BOARD.rows;
    this.cols = opts.cols ?? BOARD.cols;
    this.onEvent = opts.onEvent || (() => {});
    this.rng = opts.rng || null;

    /** @type {number[][]} 占用表，0=空，1..7=宝石编号 */
    this.grid = [];
    this._buildGridData();

    /** 当前活动造型 */
    this.shape = this._newShape();
    /** 下一个造型（原作 nextShape） */
    this.nextShape = this._newShape();
  }

  /* ---------------------------------------------------------------- */
  /* 构建                                                              */
  /* ---------------------------------------------------------------- */

  /** 原作 Board.prototype._buildGridData */
  _buildGridData() {
    this.grid = [];
    for (let i = 0; i < this.rows; i++) this.grid.push(createEmptyRow(this.cols));
  }

  /** 原作 `new window.Shape()` */
  _newShape() {
    return new Shape(this.rng);
  }

  /** 重置（新一局） */
  reset(rng = null) {
    this.rng = rng;
    this._buildGridData();
    this.shape = this._newShape();
    this.nextShape = this._newShape();
  }

  /* ---------------------------------------------------------------- */
  /* 判定                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 原作 Board.prototype.validMove —— 条件顺序与写法完全保持。
   * @param {number} moveX
   * @param {number} moveY
   * @param {Shape} [shape]
   */
  validMove(moveX, moveY, shape = this.shape) {
    const nextX = shape.x + moveX;
    const nextY = shape.y + moveY;
    for (let y = 0; y < shape.layout.length; y++) {
      for (let x = 0; x < shape.layout[y].length; x++) {
        if (shape.layout[y][x]) {
          if (
            typeof this.grid[nextY + y] === 'undefined' ||
            typeof this.grid[nextY + y][nextX + x] === 'undefined' ||
            this.grid[nextY + y][nextX + x] ||
            nextX + x < 0 ||
            nextX + x >= this.cols ||
            nextY + y >= this.rows
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * 试旋转（不改变状态）。原作旋转不校验合法性，为了手感一致这里同样
   * 只依赖 _clampToBoard；本方法仅供教学/自动演示判断"旋转是否有意义"。
   */
  canRotate() {
    const probe = this.shape.clone();
    probe.rotate();
    return probe.layout.some((row, y) => row.some((v, x) =>
      v && this.grid[probe.y + y] && this.grid[probe.y + y][probe.x + x] === 0
    ));
  }

  /**
   * 幽灵落点：从当前 y 逐格下探到不能移动为止。
   * 复用 validMove，保证指引与真实判定绝对一致（纯表现层）。
   */
  ghostOffset() {
    let d = 0;
    while (this.validMove(0, d + 1)) d++;
    return d;
  }

  /* ---------------------------------------------------------------- */
  /* 主循环                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * 原作 Board.prototype.tick —— 下落一格；触底则锁块、消行、换块。
   * @returns {{moved:boolean, locked:boolean, over:boolean, cleared:number}}
   */
  tick() {
    const result = { moved: false, locked: false, over: false, cleared: 0 };
    if (this.validMove(0, 1)) {
      this.shape.y += 1;
      result.moved = true;
      this.onEvent('fall', { y: this.shape.y });
    } else {
      const over = this.addShapeToBoardList();
      result.locked = true;
      this.onEvent('lock', { shape: this.shape, x: this.shape.x, y: this.shape.y });
      if (over) {
        result.over = true;
        this.onEvent('over', {});
        return result;
      }
      result.cleared = this.clearFullRows();
      this.shape = this.nextShape;
      this.shape.setPosition(this.cols, this.rows, true); // true = 忽略 y（原作出生在第 0 行）
      this.nextShape = this._newShape();
      this.onEvent('spawn', { shape: this.shape, next: this.nextShape });
    }
    return result;
  }

  /**
   * 原作 Board.prototype.addShapeToBoardList
   * @returns {boolean} 是否触发 game over
   */
  addShapeToBoardList() {
    const s = this.shape;
    for (let y = 0; y < s.layout.length; y++) {
      for (let x = 0; x < s.layout[y].length; x++) {
        if (s.layout[y][x]) {
          const boardX = s.x + x;
          const boardY = s.y + y;
          if (this.grid[boardY] && this.grid[boardY][boardX]) {
            return true; // 原作：state = 'over'
          }
          if (this.grid[boardY]) this.grid[boardY][boardX] = s.blockType;
        }
      }
    }
    return false;
  }

  /**
   * 原作 Board.prototype.clearFullRows
   * 差异说明：原作 `if (this.boardList[boardY][boardX])` 在越界行会抛错，
   * 这里加了存在性保护 —— 属于「修复原版明显 bug」，判定结果不变。
   * @returns {number} 消除行数
   */
  clearFullRows() {
    let lines = 0;
    const clearedRows = [];
    for (let y = this.rows - 1; y >= 0; y--) {
      let filled = 0;
      for (let x = 0; x < this.cols; x++) if (this.grid[y][x] > 0) filled++;
      if (filled === this.cols && y) {
        // 记录被消格（特效需要），再删行补空
        clearedRows.push({ y, cells: this.grid[y].slice() });
        this.grid.splice(y, 1);
        this.grid.unshift(createEmptyRow(this.cols));
        lines++;
        y++; // 原作：同一行继续检查
      }
    }
    if (lines > 0) {
      const gained = lines * RULES.scorePerLine * lines;
      this.onEvent('clear', { lines, gained, rows: clearedRows });
    }
    return lines;
  }

  /* ---------------------------------------------------------------- */
  /* 玩家操作（原作 Keyboard.js 直接改 shape.x/y，这里等价封装）        */
  /* ---------------------------------------------------------------- */

  moveLeft() {
    if (!this.validMove(-1, 0)) return false;
    this.shape.x -= 1;
    this.onEvent('move', { dx: -1 });
    return true;
  }

  moveRight() {
    if (!this.validMove(1, 0)) return false;
    this.shape.x += 1;
    this.onEvent('move', { dx: 1 });
    return true;
  }

  /** 原作 ↓：下落一格并重置下落计时（由 game.js 负责重置节奏） */
  softDrop() {
    if (!this.validMove(0, 1)) return false;
    this.shape.y += 1;
    this.onEvent('softDrop', { y: this.shape.y });
    return true;
  }

  /** 原作 ↑：直接 rotate + 钳制，不做踢墙 */
  rotate() {
    const before = this.shape.layout;
    this.shape.rotate();
    const changed = before.length !== this.shape.layout.length ||
      before.some((row, y) => row.some((v, x) => v !== this.shape.layout[y][x]));
    if (changed) this.onEvent('rotate', { shape: this.shape });
    return changed;
  }

  /* ---------------------------------------------------------------- */
  /* 查询                                                              */
  /* ---------------------------------------------------------------- */

  /** 当前等级（1 起）对应的下落毫秒数；表见 config/levels.js */
  static speedForLevel(level) {
    const idx = Math.min(Math.max(level - 1, 0), LEVELS.length - 1);
    return LEVELS[idx] ? LEVELS[idx].speed : RULES.constSpeed;
  }

  /** 已占用最高行（渲染/统计用，不参与判定） */
  stackTop() {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) if (this.grid[y][x]) return y;
    }
    return this.rows;
  }

  /** 快照（verify 断言用） */
  serialize() {
    return {
      grid: this.grid.map((r) => r.slice()),
      shape: { x: this.shape.x, y: this.shape.y, type: this.shape.blockType, layout: this.shape.layout.map((r) => r.slice()) },
      next: { type: this.nextShape.blockType, layout: this.nextShape.layout.map((r) => r.slice()) },
    };
  }
}

export default Board;
