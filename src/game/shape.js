/**
 * 造型与随机 —— 逐行对齐原作 js/Shape.js
 * =====================================================================
 * 原作的随机写法（min + floor(random()*max)，上界其实取不到）与 10 种
 * 非标准造型都属于「核心判定」，这里 1:1 保留，不做任何"修正"。
 * 只有渲染相关的 draw() 被移到 src/art/renderer.js。
 */

import { SHAPES, BOARD, RULES } from '../../config/game.config.js';

/** 原作 Shape.js 的 random：min + Math.floor(Math.random()*max) */
export function randomOriginal(minValue, maxValue) {
  return minValue + Math.floor(Math.random() * maxValue);
}

/** 原作 blockType = random(1, styleCount) —— styleCount = 7 */
export const GEM_STYLE_COUNT = 7;

/**
 * 一个正在下落的晶体造型。
 * 与原作一致：x/y 为格子坐标，layout 为 0/1 二维数组，blockType 为 1..7。
 */
export class Shape {
  /**
   * @param {()=>number} [rng] 覆盖随机源（verify/教学演示用），默认走原作随机
   */
  constructor(rng = null) {
    this.x = 0;
    this.y = 0;
    const roll = rng
      ? () => rng()
      : () => Math.random();
    // 原作：blockType 与 layout 各自独立随机（颜色与形状不绑定），保持不变
    this.blockType = randomOriginalWith(1, GEM_STYLE_COUNT, roll);
    this.layout = SHAPES[randomOriginalWith(0, SHAPES.length, roll)];
    this.createdAt = 0;
  }

  /** 原作 Shape.prototype._getMaxCols */
  maxCols() {
    let max = 0;
    for (const row of this.layout) max = Math.max(max, row.length);
    return max;
  }

  /** 原作 Shape.prototype._getMaxRows */
  maxRows() {
    return this.layout.length;
  }

  /**
   * 原作 Shape.prototype.rotate —— layout[len-1-x][y] 的转置翻转。
   * 注意：原作旋转后不做踢墙（RULES.wallKick=false），只做越界钳制。
   */
  rotate() {
    const src = this.layout;
    const out = [];
    for (let y = 0; y < src[0].length; y++) {
      out[y] = [];
      for (let x = 0; x < src.length; x++) {
        out[y][x] = src[src.length - 1 - x][y];
      }
    }
    this.layout = out;
    this._clampToBoard();
  }

  /** 原作 Shape.prototype._setLayout —— 防止翻转越界的钳制（非踢墙） */
  _clampToBoard() {
    if (this.x < 0) this.x = 0;
    if (this.y < 0) this.y = 0;
    if (this.x + this.layout[0].length > BOARD.cols) {
      this.x = BOARD.cols - this.layout[0].length;
    }
    if (this.y + this.layout.length > BOARD.rows) {
      this.y = BOARD.rows - this.layout.length;
    }
  }

  /**
   * 原作 Shape.prototype.setPosition
   * @param {number} cols 参考列数（棋盘为 BOARD.cols，预览窗为预览格数）
   * @param {number} rows 参考行数
   * @param {boolean} ignoreRows 棋盘出生时忽略 y（保持 y=0，原作行为）
   */
  setPosition(cols, rows, ignoreRows = false) {
    this.x = Math.floor((cols - this.maxCols()) / 2);
    if (!ignoreRows) {
      this.y = Math.floor((rows - this.maxRows()) / 2);
    }
  }

  /** 遍历占用格（渲染/求包围盒用） */
  cells() {
    const list = [];
    for (let y = 0; y < this.layout.length; y++) {
      for (let x = 0; x < this.layout[y].length; x++) {
        if (this.layout[y][x]) list.push({ x: this.x + x, y: this.y + y, gx: x, gy: y });
      }
    }
    return list;
  }

  /** 供教学/自动演示复制一个造型 */
  clone() {
    const s = Object.create(Shape.prototype);
    s.x = this.x;
    s.y = this.y;
    s.blockType = this.blockType;
    s.layout = this.layout.map((r) => r.slice());
    return s;
  }
}

/** 把原作随机式接到可注入的随机源上 */
function randomOriginalWith(minValue, maxValue, roll) {
  return minValue + Math.floor(roll() * maxValue);
}

export default Shape;
