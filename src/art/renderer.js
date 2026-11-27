/**
 * 渲染器 —— 把游戏状态画成晶窟画面
 * =====================================================================
 * 性能策略（保证 60fps）：
 *   · 背景（含 fbm 岩壁）按「层级」缓存到离屏画布，只在换层时重画；
 *   · 已堆叠的晶体堆缓存成一张画布，仅在锁块/消行后重画；
 *   · 活动块与预览块走 gem 精灵缓存，逐帧只是 drawImage；
 *   · 每帧只做：背景 blit → 晶尘 → 堆 → 幽灵 → 活动块 → 特效 → 面板。
 * 判定坐标系完全沿用棋盘格子，渲染插值（fallProgress）不影响任何规则。
 */

import { STAGE, BOARD, GEMS, FX, RENDER, THEMES } from '../../config/game.config.js';
import {
  rng, rgba, lighten, darken, mix, hexToRgb, hash, range, makeCanvas, ctx2d, roundRect, glowBlob, sparkle,
} from './utils.js';
import { gemSprite, ghostSprite, drawGem, gemOf } from './gems.js';
import { drawBackground, drawPreviewWell, boardRect, blobPath } from './scene.js';
import { drawPanel, drawText, drawGauge, drawBanner, FONT_DISPLAY, FONT_BODY } from './ui-art.js';

/**
 * 堆体基岩：把「所有已占格」向外扩张后一次性填充。
 * 扩张量 > 半格，相邻格必然重叠，于是整片堆体在视觉上是一整块晶岩，
 * 而不是 13×20 个各自为政的方块 —— 这是「禁止几何图形拼贴」红线的关键一步。
 */
function massPath(ctx, grid, cell, dilate) {
  ctx.beginPath();
  for (let y = 0; y < BOARD.rows; y++) {
    for (let x = 0; x < BOARD.cols; x++) {
      if (!grid[y][x]) continue;
      const px = x * cell - dilate;
      const py = y * cell - dilate;
      const s = cell + dilate * 2;
      // 每格一个带抖动的八边形，边缘才不像网格
      const j = (hash(`m|${x}|${y}`) % 100) / 100;
      const k = s * (0.10 + j * 0.06);
      ctx.moveTo(px + k, py);
      ctx.lineTo(px + s - k, py);
      ctx.lineTo(px + s, py + k);
      ctx.lineTo(px + s, py + s - k);
      ctx.lineTo(px + s - k, py + s);
      ctx.lineTo(px + k, py + s);
      ctx.lineTo(px, py + s - k);
      ctx.lineTo(px, py + k);
      ctx.closePath();
    }
  }
}

/** 两格之间的晶桥：跨过格缝的一坨小晶体，把「一整块」这件事坐实 */
function crystalBridge(ctx, x0, y0, x1, y1, gem, cell) {
  const r = rng(hash(`bridge${x0},${y0},${x1},${y1}`));
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const w = cell * 0.30;
  const len = cell * 0.62;
  const ang = Math.atan2(y1 - y0, x1 - x0);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(ang);
  ctx.beginPath();
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const px = -len / 2 + len * t;
    const py = (i % 2 ? -1 : 1) * w * (0.45 + r() * 0.55);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -w, 0, w);
  g.addColorStop(0, mixRgb(gem.colors.body, '#ffffff', 0.10));
  g.addColorStop(0.5, mixRgb(gem.colors.deep, gem.colors.body, 0.55));
  g.addColorStop(1, darken(gem.colors.deep, 0.45));
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 0.30;
  ctx.strokeStyle = rgba(gem.colors.rim, 0.6);
  ctx.lineWidth = Math.max(0.6, cell * 0.02);
  ctx.stroke();
  ctx.restore();
}

/**
 * 晶座底板：占满整格并向外溢出一点，相邻格互相咬合成一整块岩晶。
 * 顶面受光、底面背光，再叠一道斜向解理面，避免出现"方块拼贴"的观感。
 */
function socketPlate(ctx, px, py, cell, gem) {
  const o = cell * 0.045;
  const j = (hash(`${gem.id}|${px}|${py}`) % 100) / 100;   // 0..1 稳定抖动
  const pts = [
    [px - o, py + cell * (0.20 + j * 0.06)],
    [px + cell * 0.24, py - o],
    [px + cell * 0.80, py - o],
    [px + cell + o, py + cell * (0.24 + (1 - j) * 0.06)],
    [px + cell + o, py + cell * (0.76 + j * 0.05)],
    [px + cell * 0.78, py + cell + o],
    [px + cell * 0.22, py + cell + o],
    [px - o, py + cell * (0.74 + (1 - j) * 0.05)],
  ];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  // 晶座往中性岩石色靠：只留一点晶种反光，堆体才不像彩色糖条
  // 抖动幅度要够大，否则一整排同色晶座又会变成一条横向色带
  const base = mixRgb(gem.colors.deep, '#1b1636', 0.62 + j * 0.22);
  const g = ctx.createLinearGradient(px, py - o, px + cell * 0.4, py + cell + o);
  g.addColorStop(0, mixRgb(base, gem.colors.body, 0.13));
  g.addColorStop(0.5, base);
  g.addColorStop(1, darken(base, 0.5));
  ctx.fillStyle = g;
  ctx.fill();
  // 斜向解理面
  ctx.beginPath();
  ctx.moveTo(pts[1][0], pts[1][1]);
  ctx.lineTo(px + cell * 0.52, py + cell * 0.56);
  ctx.lineTo(pts[6][0], pts[6][1]);
  ctx.lineTo(pts[7][0], pts[7][1]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();
  // 顶缘一条受光棱
  ctx.beginPath();
  ctx.moveTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.strokeStyle = rgba(gem.colors.rim, 0.09);
  ctx.lineWidth = Math.max(0.8, cell * 0.035);
  ctx.stroke();
}

/** 两色按 rgb()/hex 混合，返回 hex（utils.mix 返回 rgb()，不能再喂给 darken） */
function mixRgb(a, b, t) {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const h = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

/** 一枚实心小菱形（层名前的活动指示） */
function diamondChipMark(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.72, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.72, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** 面板布局（右侧信息区 + 顶部标题），全部按 1280×720 舞台定位 */
export const LAYOUT = (() => {
  const b = boardRect();
  const colX = b.x + b.w + 34;
  const colW = STAGE.w - colX - 34;
  /* 标题右侧要让位给 .hud-bar 的暂停/菜单键：它们在 CSS 像素里固定占
     14(右距) + 44 + 10(gap) + 44 = 112px，而画布是等比缩放的，
     所以按最坏情况（scale=1）预留 116px，任何缩放下都不会被压住。 */
  const titleW = Math.max(180, colW - 116);
  return {
    board: b,
    title: { x: colX, y: 26, w: titleW, h: 62 },
    score: { x: colX, y: 100, w: colW, h: 104 },
    stats: { x: colX, y: 216, w: colW, h: 96 },
    next: { x: colX, y: 324, w: colW, h: 168 },
    gauge: { x: colX, y: 512, w: colW, h: 22 },
    controls: { x: colX, y: 546, w: colW, h: 124 },
    left: { x: 34, y: b.y, w: b.x - 68, h: b.h },
  };
})();

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opt]
   */
  constructor(canvas, opt = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cell = opt.cell || BOARD.cell;
    this.dpr = 1;
    this.view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0 };
    this._bgCache = new Map();
    this._stackCanvas = null;
    this._stackDirty = true;
    this._lastGridRef = null;
    this._lastGridRev = -1;
    this.options = { ghost: true, panels: true, ...opt.options };
  }

  /* ---------------------------------------------------------------- */
  /* 尺寸                                                              */
  /* ---------------------------------------------------------------- */

  /** 适配窗口：等比缩放 + 居中黑边（黑边由 CSS 背景填成深紫，不用纯黑） */
  resize(cssW, cssH) {
    const dpr = Math.min(RENDER.dprMax, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.dpr = dpr;
    const scale = Math.min(cssW / STAGE.w, cssH / STAGE.h);
    const w = Math.max(1, Math.floor(STAGE.w * scale * dpr));
    const h = Math.max(1, Math.floor(STAGE.h * scale * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${Math.floor(STAGE.w * scale)}px`;
    this.canvas.style.height = `${Math.floor(STAGE.h * scale)}px`;
    this.view = {
      scale,
      dpr,
      ox: Math.floor((cssW - STAGE.w * scale) / 2),
      oy: Math.floor((cssH - STAGE.h * scale) / 2),
      w: Math.floor(STAGE.w * scale),
      h: Math.floor(STAGE.h * scale),
      // 画布在页面里的实际位置（GIF 裁剪要用）
      left: Math.floor((cssW - STAGE.w * scale) / 2),
      top: Math.floor((cssH - STAGE.h * scale) / 2),
      viewportPx: { w, h },
      offX: 0,
      offY: 0,
    };
    this._bgCache.clear();
    return this.view;
  }

  /** 舞台坐标 → 画布像素 */
  toScreen(x, y) {
    return [(x + 0) * this.view.scale * this.dpr, (y + 0) * this.view.scale * this.dpr];
  }

  /* ---------------------------------------------------------------- */
  /* 缓存                                                              */
  /* ---------------------------------------------------------------- */

  _bg(tier, theme) {
    if (this._bgCache.has(tier.name)) return this._bgCache.get(tier.name);
    const cv = makeCanvas(STAGE.w, STAGE.h);
    const ctx = ctx2d(cv);
    drawBackground(ctx, { tier: THEMES.tiers.indexOf(tier), cell: this.cell });
    // 面板一并烘进背景（静态部分）
    this._bgCache.set(tier.name, cv);
    return cv;
  }

  /** 已堆叠晶体堆（只在网格变化时重画） */
  _stack(grid, rev) {
    const b = boardRect(this.cell);
    if (!this._stackCanvas) {
      this._stackCanvas = makeCanvas(Math.ceil(b.w), Math.ceil(b.h));
      this._stackCtx = ctx2d(this._stackCanvas);
    }
    if (rev !== undefined && rev === this._lastGridRev && grid === this._lastGridRef) return this._stackCanvas;
    const ctx = this._stackCtx;
    const cell = this.cell;
    ctx.clearRect(0, 0, b.w, b.h);

    /* 0) 堆体基岩：整片占格一次性铸成一块连体晶岩，格缝先被填掉 */
    let massGem = null;
    for (let y = 0; y < BOARD.rows && !massGem; y++) {
      for (let x = 0; x < BOARD.cols && !massGem; x++) if (grid[y][x]) massGem = gemOf(grid[y][x]);
    }
    if (massGem) {
      ctx.save();
      massPath(ctx, grid, cell, cell * 0.10);
      const mg = ctx.createLinearGradient(0, 0, b.w * 0.35, b.h);
      mg.addColorStop(0, '#3a3358');
      mg.addColorStop(0.55, '#241d42');
      mg.addColorStop(1, '#130f2a');
      ctx.fillStyle = mg;
      ctx.fill();
      ctx.clip();
      // 基岩上的岩屑与层纹：让整块堆体有岩石材质，而不是一坨纯色
      const mr = rng(hash('mass') + 31 * BOARD.rows);
      for (let i = 0; i < 300; i++) {
        const px = range(mr, 0, b.w);
        const py = range(mr, 0, b.h);
        ctx.globalAlpha = range(mr, 0.05, 0.16);
        ctx.fillStyle = mr() > 0.5 ? '#ded9f5' : '#080618';
        blobPath(ctx, px, py, range(mr, 2, 8), range(mr, 2, 7), mr, 5, 0.4);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    /* 1) 晶座：先把整片堆体铸成互相咬合的岩晶，晶体才不像散落的糖果 */
    for (let y = 0; y < BOARD.rows; y++) {
      for (let x = 0; x < BOARD.cols; x++) {
        if (grid[y][x]) socketPlate(ctx, x * cell, y * cell, cell, gemOf(grid[y][x]));
      }
    }
    /* 1b) 晶桥：跨过相邻格缝的一坨小晶体，坐实「一整块」而不是拼贴 */
    for (let y = 0; y < BOARD.rows; y++) {
      for (let x = 0; x < BOARD.cols; x++) {
        const t = grid[y][x];
        if (!t) continue;
        const gem = gemOf(t);
        if (x + 1 < BOARD.cols && grid[y][x + 1]) {
          crystalBridge(ctx, x * cell + cell / 2, y * cell + cell / 2,
            (x + 1) * cell + cell / 2, y * cell + cell / 2, gem, cell);
        }
        if (y + 1 < BOARD.rows && grid[y + 1][x]) {
          crystalBridge(ctx, x * cell + cell / 2, y * cell + cell / 2,
            x * cell + cell / 2, (y + 1) * cell + cell / 2, gem, cell);
        }
      }
    }
    /* 2) 晶体本体：探出晶座并互相搭接，晶座只当岩底，读者看到的是一整块晶岩 */
    const size = cell * 1.24;
    for (let y = 0; y < BOARD.rows; y++) {
      for (let x = 0; x < BOARD.cols; x++) {
        const t = grid[y][x];
        if (!t) continue;
        const sp = gemSprite(gemOf(t), size, { seed: (x * 7 + y * 13) % 5 });
        ctx.drawImage(sp.canvas,
          x * cell + (cell - size) / 2 - sp.pad,
          y * cell + (cell - size) / 2 - sp.pad);
      }
    }
    /* 3) 顶面受光：堆体轮廓上沿打一道冷高光，晶堆才有体块感 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let y = 0; y < BOARD.rows; y++) {
      for (let x = 0; x < BOARD.cols; x++) {
        if (!grid[y][x]) continue;
        if (y > 0 && grid[y - 1][x]) continue;
        const px = x * cell;
        const py = y * cell;
        const g = ctx.createLinearGradient(0, py, 0, py + cell * 0.5);
        g.addColorStop(0, 'rgba(226,240,255,0.16)');
        g.addColorStop(1, 'rgba(226,240,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px, py, cell, cell * 0.5);
        glowBlob(ctx, px + cell / 2, py, cell * 0.7, gemOf(grid[y][x]).colors.glow, 0.13);
      }
    }
    ctx.restore();
    /* 4) 堆体底部压暗，做出重量 */
    ctx.save();
    const baseY = (BOARD.rows - 4) * cell;
    const bg = ctx.createLinearGradient(0, baseY, 0, b.h);
    bg.addColorStop(0, 'rgba(2,1,10,0)');
    bg.addColorStop(1, 'rgba(2,1,10,0.35)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, baseY, b.w, b.h - baseY);
    ctx.restore();

    this._lastGridRev = rev;
    this._lastGridRef = grid;
    return this._stackCanvas;
  }

  invalidateStack() {
    this._lastGridRev = -1;
    this._lastGridRef = null;
  }

  /** 换深度（升级跨层）时丢掉背景缓存，下一帧重烘 */
  invalidateBg() {
    this._bgCache.clear();
  }

  /* ---------------------------------------------------------------- */
  /* 主绘制                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * @param {object} snap Game.snapshot()
   * @param {object} vis 视觉状态 {fx, timeMs, tier, banners, comboText, paused, over}
   */
  render(snap, vis = {}) {
    const ctx = this.ctx;
    const s = this.view.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, STAGE.w, STAGE.h);

    const tier = THEMES.tiers[Math.min(THEMES.tiers.length - 1, Math.max(0, vis.tierIndex || 0))];
    const b = boardRect(this.cell);

    ctx.save();
    if (vis.fx && vis.fx.shake) ctx.translate(vis.fx.shake.x, vis.fx.shake.y);

    /* 1) 背景 */
    ctx.drawImage(this._bg(tier), 0, 0);

    /* 2) 氛围晶尘 */
    if (vis.fx) vis.fx.drawAmbient(ctx);

    /* 3) 已堆叠晶体 */
    ctx.drawImage(this._stack(snap.grid, vis.gridRev), b.x, b.y);

    /* 4) 幽灵落点（纯表现，不改变判定） */
    if (this.options.ghost && snap.state === 'playing' && vis.ghostOffset > 0) {
      this._drawShape(ctx, snap.shape, vis.ghostOffset, true, b);
    }

    /* 5) 活动块（带下落插值与落地挤压） */
    if (snap.state === 'playing' || snap.state === 'levelup' || snap.state === 'pause') {
      this._drawShape(ctx, snap.shape, 0, false, b, snap, vis);
    }

    /* 6) 特效层 */
    if (vis.fx) vis.fx.drawFx(ctx);

    /* 7) 面板 */
    if (this.options.panels) this._panels(ctx, snap, vis, tier);

    /* 8) 播报 */
    if (vis.banners && vis.banners.length) {
      for (const bn of vis.banners) {
        drawBanner(ctx, bn.text, b.x + b.w / 2, b.y + b.h * bn.at, bn.t, {
          size: bn.size || 62,
          mid: bn.mid,
          deep: bn.deep,
          glow: bn.glow,
        });
      }
    }

    /* 9) 暂停遮罩 */
    if (snap.state === 'pause') {
      ctx.save();
      ctx.fillStyle = 'rgba(6,4,20,0.62)';
      ctx.fillRect(0, 0, STAGE.w, STAGE.h);
      drawText(ctx, vis.pausedLabel || 'PAUSED', STAGE.w / 2, STAGE.h / 2 - 16, {
        size: 72, color: '#ffffff', stroke: 'rgba(8,4,24,0.9)', strokeWidth: 10,
        glow: undefined, letterSpacing: 6,
      });
      drawText(ctx, vis.pausedHint || '', STAGE.w / 2, STAGE.h / 2 + 44, {
        size: 24, color: '#cfe6ff', font: FONT_BODY, stroke: 'rgba(8,4,24,0.8)', strokeWidth: 4,
      });
      ctx.restore();
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** 画一个造型（活动块 / 幽灵） */
  _drawShape(ctx, shape, extraY, ghost, b, snap, vis) {
    const gem = gemOf(shape.type);
    const prog = ghost ? 0 : Math.min(1, (snap && snap.fallProgress) || 0);
    // 下落插值：只在即将落格时做亚格偏移，视觉更顺滑
    const ease = vis && vis.smoothFall ? prog * 0.55 : 0;
    const squash = vis && vis.squash ? vis.squash : 0;
    for (let y = 0; y < shape.layout.length; y++) {
      for (let x = 0; x < shape.layout[y].length; x++) {
        if (!shape.layout[y][x]) continue;
        const gx = shape.x + x;
        const gy = shape.y + y + extraY + ease;
        if (gy < -1) continue;
        if (ghost) {
          // 幽灵是「格子」的记号，按格宽画；晶体本体是 1.24 倍格宽，两者不是一回事
          const gs = this.cell;
          const sp = ghostSprite(gem, gs);
          ctx.drawImage(
            sp.canvas,
            b.x + gx * this.cell + (this.cell - gs) / 2,
            b.y + gy * this.cell + (this.cell - gs) / 2,
          );
          continue;
        }
        const big = this.cell * 1.24;
        const ox = b.x + gx * this.cell + (this.cell - big) / 2;
        const oy = b.y + gy * this.cell + (this.cell - big) / 2;
        if (squash > 0.001) {
          ctx.save();
          ctx.translate(b.x + gx * this.cell + this.cell / 2, b.y + (gy + 1) * this.cell);
          ctx.scale(1 + squash * 0.5, 1 - squash);
          ctx.translate(-(b.x + gx * this.cell + this.cell / 2), -(b.y + (gy + 1) * this.cell));
        }
        socketPlate(ctx, b.x + gx * this.cell, b.y + gy * this.cell, this.cell, gem);
        const sp = gemSprite(gem, big, { seed: (x * 5 + y * 11) % 4 });
        ctx.drawImage(sp.canvas, ox - sp.pad, oy - sp.pad);
        if (squash > 0.001) ctx.restore();
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 面板                                                              */
  /* ---------------------------------------------------------------- */

  _panels(ctx, snap, vis, tier) {
    const L = LAYOUT;
    const t = (vis.timeMs || 0) % 4000;
    const accent = tier.tint;

    /* 标题 */
    drawText(ctx, vis.title || 'PRISM CRUSH', L.title.x + L.title.w / 2, L.title.y + 26, {
      size: 40, letterSpacing: 4,
      gradient: [[0, '#ffffff'], [0.5, lighten(accent, 0.35)], [1, accent]],
      shadowColor: rgba(accent, 0.8), shadowBlur: 22,
      stroke: 'rgba(8,4,24,0.85)', strokeWidth: 6,
    });
    drawText(ctx, vis.subtitle || '', L.title.x + L.title.w / 2, L.title.y + 52, {
      size: 16, color: '#b9c8ee', font: FONT_BODY, weight: 600, letterSpacing: 2,
    });

    /* 得分 */
    drawPanel(ctx, L.score, { accent, active: true });
    drawText(ctx, vis.labels.score || 'SCORE', L.score.x + L.score.w / 2, L.score.y + 26, {
      size: 17, color: '#9fb4dd', font: FONT_BODY, weight: 700, letterSpacing: 3,
    });
    drawText(ctx, String(snap.score), L.score.x + L.score.w / 2, L.score.y + 64, {
      size: 46,
      gradient: [[0, '#ffffff'], [1, lighten(accent, 0.2)]],
      stroke: 'rgba(6,4,20,0.9)', strokeWidth: 7,
      shadowColor: rgba(accent, 0.9), shadowBlur: 26,
    });

    /* 最高分 / 深度 / 时间 */
    drawPanel(ctx, L.stats, { accent, studs: false });
    const cellW = L.stats.w / 3;
    const stat = (i, label, value) => {
      const cx = L.stats.x + cellW * (i + 0.5);
      drawText(ctx, label, cx, L.stats.y + 26, {
        size: 13, color: '#8fa4cf', font: FONT_BODY, weight: 700, letterSpacing: 1.5,
      });
      drawText(ctx, value, cx, L.stats.y + 60, {
        size: 26, color: '#eaf3ff', stroke: 'rgba(6,4,20,0.8)', strokeWidth: 4,
      });
      if (i) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(L.stats.x + cellW * i, L.stats.y + 18);
        ctx.lineTo(L.stats.x + cellW * i, L.stats.y + L.stats.h - 18);
        ctx.stroke();
        ctx.restore();
      }
    };
    stat(0, vis.labels.best || 'BEST', String(snap.highScore));
    stat(1, vis.labels.level || 'LEVEL', String(snap.level));
    stat(2, vis.labels.time || 'TIME', snap.time);

    /* 下一块 */
    drawPanel(ctx, L.next, { accent });
    drawText(ctx, vis.labels.next || 'NEXT', L.next.x + L.next.w / 2, L.next.y + 26, {
      size: 15, color: '#9fb4dd', font: FONT_BODY, weight: 700, letterSpacing: 3,
    });
    const well = { x: L.next.x + 26, y: L.next.y + 42, w: L.next.w - 52, h: L.next.h - 62 };
    drawPreviewWell(ctx, well, tier);
    this._drawPreview(ctx, snap.next, well);

    /* 充能条（当前分 / 下一级门槛） */
    drawGauge(ctx, L.gauge, vis.levelRatio || 0, accent);
    drawText(ctx, vis.gaugeLabel || '', L.gauge.x + L.gauge.w / 2, L.gauge.y - 12, {
      size: 12, color: '#8fa4cf', font: FONT_BODY, weight: 700, letterSpacing: 2,
    });
    void t;

    /* 操作提示 */
    drawPanel(ctx, L.controls, { accent, studs: false, radius: 14 });
    drawText(ctx, vis.labels.controls || 'CONTROLS', L.controls.x + L.controls.w / 2, L.controls.y + 24, {
      size: 14, color: '#9fb4dd', font: FONT_BODY, weight: 700, letterSpacing: 3,
    });
    const keys = vis.keys || [];
    keys.slice(0, 4).forEach((k, i) => {
      const ky = L.controls.y + 48 + i * 20;
      const [badge, text] = k;
      ctx.save();
      roundRect(ctx, L.controls.x + 22, ky - 11, 44, 22, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();
      ctx.strokeStyle = rgba(accent, 0.5);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      drawText(ctx, badge, L.controls.x + 44, ky, { size: 14, color: '#ffffff', font: FONT_BODY });
      drawText(ctx, text, L.controls.x + 78, ky, {
        size: 14, color: '#c6d6f2', font: FONT_BODY, align: 'left', weight: 600,
      });
      ctx.restore();
    });

    /* 左侧：深度竖井（当前行数 + 四层矿道 + 下潜标记） */
    drawPanel(ctx, L.left, { accent, studs: false, radius: 14 });
    drawText(ctx, vis.labels.lines || 'ROWS', L.left.x + L.left.w / 2, L.left.y + 34, {
      size: 14, color: '#9fb4dd', font: FONT_BODY, weight: 700, letterSpacing: 3,
    });
    drawText(ctx, String(snap.lines), L.left.x + L.left.w / 2, L.left.y + 78, {
      size: 42, gradient: [[0, '#ffffff'], [1, accent]],
      stroke: 'rgba(6,4,20,0.9)', strokeWidth: 6,
    });
    this._depthShaft(ctx, {
      x: L.left.x + 18, y: L.left.y + 104, w: L.left.w - 36, h: L.left.h - 122,
    }, snap, vis, tier);
  }

  /**
   * 深度竖井：把「第几层」画成一口往下打的矿井。
   * 四层矿道各用自己的主题色，右侧标层名与起始深度，
   * 一枚晶钻标记沿井壁下滑，井底有焦散辉光。
   */
  _depthShaft(ctx, rect, snap, vis, curTier) {
    const tiers = THEMES.tiers;
    const bandH = rect.h / tiers.length;
    const shaftW = Math.min(52, rect.w * 0.34);
    const sx = rect.x + 6;
    const timeMs = vis.timeMs || 0;

    ctx.save();
    drawText(ctx, vis.labels.depth || 'DEPTH', rect.x + rect.w / 2, rect.y + 12, {
      size: 13, color: '#8fa4cf', font: FONT_BODY, weight: 700, letterSpacing: 3,
    });

    /* 井壁轨道底 */
    roundRect(ctx, sx, rect.y + 24, shaftW, rect.h - 24, shaftW * 0.3);
    const track = ctx.createLinearGradient(sx, 0, sx + shaftW, 0);
    track.addColorStop(0, 'rgba(4,3,14,0.85)');
    track.addColorStop(0.45, 'rgba(22,18,52,0.85)');
    track.addColorStop(1, 'rgba(4,3,14,0.9)');
    ctx.fillStyle = track;
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,205,255,0.14)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    /* 四层矿道 */
    tiers.forEach((t, i) => {
      const by = rect.y + 24 + bandH * i;
      ctx.save();
      roundRect(ctx, sx + 4, by + 3, shaftW - 8, bandH - 6, 8);
      ctx.clip();
      const g = ctx.createLinearGradient(0, by, 0, by + bandH);
      const active = t.name === curTier.name;
      g.addColorStop(0, rgba(t.tint, active ? 0.55 : 0.16));
      g.addColorStop(0.5, rgba(t.deep, 0.9));
      g.addColorStop(1, rgba(t.tint, active ? 0.34 : 0.10));
      ctx.fillStyle = g;
      ctx.fillRect(sx, by, shaftW, bandH);
      // 井道里的横向凿痕
      for (let k = 0; k < 7; k++) {
        const ly = by + (k + 0.5) * (bandH / 7);
        ctx.beginPath();
        ctx.moveTo(sx + 5, ly);
        ctx.lineTo(sx + shaftW - 5, ly);
        ctx.strokeStyle = `rgba(210,230,255,${active ? 0.13 : 0.06})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (active) {
        ctx.globalCompositeOperation = 'lighter';
        glowBlob(ctx, sx + shaftW / 2, by + bandH / 2, shaftW * 1.1, t.tint, 0.20 + 0.08 * Math.sin(timeMs / 620));
      }
      ctx.restore();
      // 层间石台
      if (i) {
        ctx.beginPath();
        ctx.moveTo(sx - 3, by);
        ctx.lineTo(sx + shaftW + 3, by);
        ctx.strokeStyle = 'rgba(8,6,22,0.9)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - 3, by + 1.6);
        ctx.lineTo(sx + shaftW + 3, by + 1.6);
        ctx.strokeStyle = 'rgba(200,220,255,0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // 右侧层名
      const lx = sx + shaftW + 14;
      const names = vis.tierNames || [];
      drawText(ctx, names[i] || t.name.toUpperCase(), lx, by + bandH / 2 - 7, {
        size: 13, color: active ? '#ffffff' : '#8b9dc7', font: FONT_BODY,
        weight: active ? 800 : 600, align: 'left', letterSpacing: 1,
      });
      drawText(ctx, `Lv ${t.from}+`, lx, by + bandH / 2 + 11, {
        size: 12, color: active ? t.tint : '#5d6d95', font: FONT_BODY, weight: 700, align: 'left',
      });
      if (active) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        diamondChipMark(ctx, lx - 9, by + bandH / 2 - 7, 4, t.tint);
        ctx.restore();
      }
    });

    /* 井底焦散 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowBlob(ctx, sx + shaftW / 2, rect.y + rect.h, shaftW * 1.3, curTier.tint, 0.28);
    ctx.restore();

    /* 下潜标记：一枚晶钻 + 一道贯穿井壁的光带 */
    const maxDepth = tiers[tiers.length - 1].from + 3;
    const ratio = Math.max(0, Math.min(1, snap.level / maxDepth));
    const my = rect.y + 24 + ratio * (rect.h - 24);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beamG = ctx.createLinearGradient(sx - 4, 0, sx + shaftW + 4, 0);
    beamG.addColorStop(0, rgba(curTier.tint, 0));
    beamG.addColorStop(0.5, rgba(curTier.tint, 0.55));
    beamG.addColorStop(1, rgba(curTier.tint, 0));
    ctx.fillStyle = beamG;
    ctx.fillRect(sx - 4, my - 2.5, shaftW + 8, 5);
    ctx.restore();
    const gs = shaftW * 0.62;
    drawGem(ctx, gemOf(7), sx + shaftW / 2 - gs / 2, my - gs / 2, gs, { glow: 0.9 });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    sparkle(ctx, sx + shaftW / 2, my, gs * 0.55, '#ffffff', 0.5, timeMs / 2400);
    ctx.restore();

    ctx.restore();
  }

  /** 预览窗内画下一块（居中，格径 previewCell） */
  _drawPreview(ctx, shape, well) {
    const cell = BOARD.previewCell;
    const rows = shape.layout.length;
    const cols = Math.max(...shape.layout.map((r) => r.length));
    const ox = well.x + (well.w - cols * cell) / 2;
    const oy = well.y + (well.h - rows * cell) / 2;
    const gem = gemOf(shape.type);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < shape.layout[y].length; x++) {
        if (!shape.layout[y][x]) continue;
        const sp = gemSprite(gem, cell - 3, { seed: (x + y) % 3 });
        ctx.drawImage(sp.canvas, ox + x * cell - sp.pad + 1.5, oy + y * cell - sp.pad + 1.5);
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowBlob(ctx, well.x + well.w / 2, well.y + well.h / 2, cell * 3, gem.colors.glow, 0.16);
    ctx.restore();
  }

  /** 供 GIF/截图裁剪：棋盘在画布像素里的位置 */
  boardClip() {
    const b = boardRect(this.cell);
    const s = this.view.scale * this.dpr;
    return { x: Math.round(b.x * s), y: Math.round(b.y * s), w: Math.round(b.w * s), h: Math.round(b.h * s) };
  }
}

export { FONT_DISPLAY, FONT_BODY, boardRect, FX };
