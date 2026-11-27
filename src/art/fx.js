/**
 * 特效系统 —— 晶体爆裂、横扫光带、冲击波、晶尘、震屏
 * =====================================================================
 * 这是需求里「炫酷爆炸效果 + 砸砖反馈」的落点。所有粒子都是真实绘制的
 * 晶体碎片（带旋转、重力、加色辉光、寿命淡出），不是圆点贴图。
 */

import { STAGE, BOARD, FX } from '../../config/game.config.js';
import { rng, hash, range, rgba, lighten, glowBlob, sparkle, beam } from './utils.js';
import { chunkSprites, gemOf } from './gems.js';

/**
 * 晶化冲击波：一圈带棱角的爆裂波前。
 * 绝不用 ctx.arc 画光溜溜的圆 —— 那正是「圆圈拼凑画风」的红线。
 * 这里画的是内外半径交替的锯齿星环 + 每三个尖角一根放射晶刺，
 * 再补一道略小的光滑内环当余震，读者看到的是「岩层被崩开的一道环状裂口」。
 */
function crystalRing(ctx, x, y, r, width, color, alpha, seed) {
  if (r < 2 || alpha <= 0.002) return;
  const rr = rng(hash('ring') + seed);
  const n = Math.max(14, Math.min(46, Math.round(r / 5)));
  const inner = Math.max(1, r - width);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const out = i % 2 === 0;
    const rad = out ? r * (1 + range(rr, -0.02, 0.06)) : inner * (1 + range(rr, -0.05, 0.03));
    pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad, a, out]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.lineJoin = 'bevel';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width * 0.42);
  ctx.stroke();
  // 环体本身：沿环带一圈渐变填充，冲击波才有厚度而不是一条线
  const band = ctx.createRadialGradient(x, y, inner * 0.85, x, y, r * 1.04);
  band.addColorStop(0, rgba(color, 0));
  band.addColorStop(0.62, rgba(color, 0.30));
  band.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = band;
  ctx.fill();
  // 放射晶刺：只在偶数尖角上，长短不一。
  // 刺长必须跟着环宽走，否则环一大就长成海葵，反而不像崩开的岩裂。
  ctx.lineWidth = Math.max(0.8, width * 0.22);
  for (let i = 0; i < pts.length; i += 2) {
    const [px, py, a, out] = pts[i];
    if (!out) continue;
    const len = Math.min(width * 0.85, r * range(rr, 0.06, 0.20));
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x + Math.cos(a) * (r + len), y + Math.sin(a) * (r + len));
    ctx.stroke();
  }
  // 余震内环：细一道，带同样的锯齿，避免退回成规整圆
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = inner * (1 + (i % 2 ? 0.012 : -0.012));
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = rgba('#ffffff', 0.35);
  ctx.lineWidth = Math.max(0.6, width * 0.14);
  ctx.stroke();
}

/** 单个粒子 */
class Particle {
  constructor() { this.alive = false; }

  spawnChunk(x, y, vx, vy, size, spin, life, imgs, variant, glowColor) {
    this.kind = 'chunk';
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.size = size; this.rot = Math.random() * 6.283;
    this.spin = spin;
    this.life = life; this.maxLife = life;
    this.imgs = imgs; this.variant = variant;
    this.glow = glowColor;
    this.alive = true;
    return this;
  }

  spawnDust(x, y, vx, vy, size, life, color) {
    this.kind = 'dust';
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.size = size; this.life = life; this.maxLife = life; this.color = color;
    this.alive = true;
    return this;
  }

  spawnRing(x, y, r0, r1, life, color, width) {
    this.kind = 'ring';
    this.x = x; this.y = y; this.r0 = r0; this.r1 = r1;
    this.life = life; this.maxLife = life; this.color = color; this.width = width;
    // 每道环的锯齿形状固定下来，同一局重跑画面可复现
    this.seed = hash(`r${x | 0},${y | 0},${r1 | 0}`);
    this.alive = true;
    return this;
  }

  spawnBeam(y, x0, x1, life, color) {
    this.kind = 'beam';
    this.y = y; this.x0 = x0; this.x1 = x1;
    this.life = life; this.maxLife = life; this.color = color;
    this.alive = true;
    return this;
  }

  spawnGlint(x, y, size, life, color, rot) {
    this.kind = 'glint';
    this.x = x; this.y = y; this.size = size;
    this.life = life; this.maxLife = life; this.color = color; this.rot = rot;
    this.alive = true;
    return this;
  }
}

/** 漂浮晶尘（常驻氛围，不随粒子池回收） */
class Mote {
  constructor(rnd, W, H, color) {
    this.reset(rnd, W, H, color, true);
  }

  reset(rnd, W, H, color, initial = false) {
    this.x = rnd() * W;
    this.y = initial ? rnd() * H : H + rnd() * 40;
    this.r = range(rnd, 0.8, 2.8);
    this.vy = -range(rnd, 6, 26);
    this.vx = range(rnd, -8, 8);
    this.phase = rnd() * 6.28;
    this.twinkle = range(rnd, 0.6, 2.2);
    this.color = color;
  }
}

export class FxSystem {
  /**
   * @param {object} [opt]
   * @param {boolean} [opt.shake] 是否允许震屏（设置项）
   * @param {boolean} [opt.particles] 是否允许爆裂粒子（设置项）
   */
  constructor(opt = {}) {
    this.allowShake = opt.shake !== false;
    this.allowParticles = opt.particles !== false;
    this.pool = [];
    this.motes = [];
    this.shake = { x: 0, y: 0, amp: 0 };
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.rnd = rng(20260101);
    this._initMotes();
  }

  _initMotes() {
    for (let i = 0; i < FX.ambient.motes; i++) {
      this.motes.push(new Mote(this.rnd, STAGE.w, STAGE.h, '#bfe9ff'));
    }
  }

  setOptions({ shake, particles }) {
    if (shake !== undefined) this.allowShake = shake;
    if (particles !== undefined) this.allowParticles = particles;
    if (particles === false) this.pool.length = 0;
  }

  /* ---------------------------------------------------------------- */
  /* 触发器                                                            */
  /* ---------------------------------------------------------------- */

  _take() {
    for (const p of this.pool) if (!p.alive) return p;
    const p = new Particle();
    this.pool.push(p);
    return p;
  }

  /**
   * 消行爆裂：每格炸出碎晶 + 晶尘 + 光带 + 冲击波 + 震屏
   * @param {Array<{y:number,cells:number[]}>} rows 被消除的行
   * @param {number} lines 行数（决定强度）
   */
  shatter(rows, lines) {
    if (!this.allowParticles) {
      this.addShake(Math.min(FX.shake.max, FX.shake.perLine * lines));
      return;
    }
    const b = this.boardRect();
    const cell = b.w / BOARD.cols;
    const power = 1 + (lines - 1) * 0.55;
    for (const row of rows) {
      const y = b.y + row.y * cell + cell / 2;
      for (let i = 0; i < row.cells.length; i++) {
        const type = row.cells[i];
        if (!type) continue;
        const gem = gemOf(type);
        const imgs = chunkSprites(gem, Math.max(10, Math.round(cell * 0.5)));
        const x = b.x + i * cell + cell / 2;
        const n = Math.round(FX.shatter.chunksPerCell * (lines >= 3 ? 1.25 : 1));
        for (let k = 0; k < n; k++) {
          const dir = -Math.PI / 2 + range(this.rnd, -1.35, 1.35);
          const sp = range(this.rnd, 120, 620) * power;
          this._take().spawnChunk(
            x + range(this.rnd, -cell * 0.4, cell * 0.4),
            y + range(this.rnd, -cell * 0.4, cell * 0.4),
            Math.cos(dir) * sp,
            Math.sin(dir) * sp,
            cell * range(this.rnd, 0.34, 0.86),
            range(this.rnd, -FX.shatter.spinMax, FX.shatter.spinMax),
            FX.shatter.chunkLifeMs * range(this.rnd, 0.7, 1.25),
            imgs,
            Math.floor(this.rnd() * imgs.length),
            gem.colors.glow
          );
        }
        for (let k = 0; k < FX.shatter.dustPerCell; k++) {
          this._take().spawnDust(
            x + range(this.rnd, -cell * 0.5, cell * 0.5),
            y + range(this.rnd, -cell * 0.5, cell * 0.5),
            range(this.rnd, -90, 90),
            range(this.rnd, -220, -40),
            cell * range(this.rnd, 0.16, 0.42),
            FX.shatter.glowLifeMs * range(this.rnd, 0.8, 1.5),
            gem.colors.glow
          );
        }
        if (this.rnd() < 0.5) {
          this._take().spawnGlint(x, y, cell * range(this.rnd, 0.7, 1.5),
            FX.shatter.glowLifeMs, gem.colors.rim, this.rnd() * 3);
        }
      }
      // 横扫光带
      this._take().spawnBeam(y, b.x - cell, b.x + b.w + cell, FX.shatter.beamLifeMs,
        lines >= 4 ? '#fff2b0' : '#cfefff');
    }
    // 中心冲击波
    const cx = b.x + b.w / 2;
    const cy = rows.length ? b.y + (rows[0].y + 0.5) * (b.h / BOARD.rows) : b.y + b.h / 2;
    for (let i = 0; i < (lines >= 3 ? 3 : 1); i++) {
      this._take().spawnRing(cx, cy, cell * 0.5, b.w * (0.75 + i * 0.35) * power,
        520 + i * 160, lines >= 4 ? '#ffd88a' : '#9fe9ff', cell * (0.5 - i * 0.12));
    }
    this.addShake(Math.min(FX.shake.max, FX.shake.perLine * lines * (lines >= 4 ? 1.5 : 1)));
    if (lines >= 3) this.flashUp(lines >= 4 ? 0.42 : 0.22, lines >= 4 ? '#ffe9a8' : '#d6f4ff');
  }

  /** 落地砸击：小片晶尘 + 涟漪 */
  land(x, y, size, type, heavy = false) {
    if (!this.allowParticles) return;
    const gem = gemOf(type);
    const n = heavy ? FX.land.dust * 2 : FX.land.dust;
    for (let i = 0; i < n; i++) {
      this._take().spawnDust(
        x + range(this.rnd, -size * 0.5, size * 0.5),
        y + size * 0.45,
        range(this.rnd, -140, 140),
        range(this.rnd, -120, -20),
        size * range(this.rnd, 0.12, 0.3),
        320 + this.rnd() * 220,
        gem.colors.glow
      );
    }
    this._take().spawnRing(x, y + size * 0.4, size * 0.3, size * (heavy ? 2.4 : 1.5),
      FX.land.rippleMs, gem.colors.rim, size * 0.10);
  }

  /** 升级演出：从棋盘中心炸开数圈光环 + 白闪 */
  levelUp(cx, cy, strength = 1) {
    const b = this.boardRect();
    const x = cx ?? b.x + b.w / 2;
    const y = cy ?? b.y + b.h / 2;
    for (let i = 0; i < FX.levelUp.burstRings; i++) {
      this._take().spawnRing(x, y, 10, b.w * (1.1 + i * 0.5), FX.levelUp.flashMs + i * 220,
        ['#ffe9a8', '#9fe9ff', '#d8a8ff'][i % 3], 10 - i * 2);
    }
    if (this.allowParticles) {
      for (let i = 0; i < 60 * strength; i++) {
        const ang = this.rnd() * Math.PI * 2;
        const sp = range(this.rnd, 200, 760);
        const gem = gemOf(1 + Math.floor(this.rnd() * 7));
        const imgs = chunkSprites(gem, 14);
        this._take().spawnChunk(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp,
          range(this.rnd, 6, 16), range(this.rnd, -10, 10), range(this.rnd, 500, 1100),
          imgs, Math.floor(this.rnd() * imgs.length), gem.colors.glow);
      }
    }
    this.flashUp(0.30, '#fff4cf');
    this.addShake(this.allowShake ? 8 : 0);
  }

  /** 游戏结束：整片晶堆塌落 */
  collapse(grid, cell) {
    if (!this.allowParticles) return;
    const b = this.boardRect();
    for (let y = 0; y < BOARD.rows; y++) {
      for (let x = 0; x < BOARD.cols; x++) {
        const t = grid[y][x];
        if (!t) continue;
        if (this.rnd() > 0.55) continue;
        const gem = gemOf(t);
        const imgs = chunkSprites(gem, Math.max(9, Math.round(cell * 0.45)));
        this._take().spawnChunk(
          b.x + x * cell + cell / 2,
          b.y + y * cell + cell / 2,
          range(this.rnd, -160, 160),
          range(this.rnd, -420, -60),
          cell * range(this.rnd, 0.3, 0.7),
          range(this.rnd, -9, 9),
          range(this.rnd, 700, 1500),
          imgs, Math.floor(this.rnd() * imgs.length), gem.colors.glow
        );
      }
    }
    this.addShake(FX.shake.max * 0.8);
  }

  addShake(amp) {
    if (!this.allowShake || amp <= 0) return;
    this.shake.amp = Math.min(FX.shake.max, Math.max(this.shake.amp, amp));
  }

  flashUp(alpha, color) {
    this.flash = Math.max(this.flash, alpha);
    this.flashColor = color;
  }

  boardRect() {
    const cell = BOARD.cell;
    const w = BOARD.cols * cell;
    const h = BOARD.rows * cell;
    return { x: (STAGE.w - w) / 2 + (BOARD.offsetX || 0), y: (STAGE.h - h) / 2 + 6, w, h, cell };
  }

  /* ---------------------------------------------------------------- */
  /* 推进与绘制                                                        */
  /* ---------------------------------------------------------------- */

  update(dtMs, theme) {
    const dt = dtMs / 1000;
    // 震屏
    if (this.shake.amp > 0.05) {
      this.shake.x = range(this.rnd, -1, 1) * this.shake.amp;
      this.shake.y = range(this.rnd, -1, 1) * this.shake.amp;
      this.shake.amp *= Math.pow(FX.shake.decay, dtMs / 16.67);
    } else {
      this.shake.amp = 0; this.shake.x = 0; this.shake.y = 0;
    }
    if (this.flash > 0.001) {
      this.flash *= Math.pow(0.90, dtMs / 16.67);
    } else this.flash = 0;

    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dtMs;
      if (p.life <= 0) { p.alive = false; continue; }
      if (p.kind === 'chunk') {
        p.vy += FX.shatter.chunkGravity * dt;
        p.vx *= Math.pow(0.985, dtMs / 16.67);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
      } else if (p.kind === 'dust') {
        p.vy += 220 * dt;
        p.vx *= Math.pow(0.96, dtMs / 16.67);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }

    // 常驻晶尘
    const tint = theme ? theme.tint : '#bfe9ff';
    for (const m of this.motes) {
      m.phase += dt * m.twinkle;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y < -20 || m.x < -30 || m.x > STAGE.w + 30) m.reset(this.rnd, STAGE.w, STAGE.h, tint);
    }
  }

  /** 背景层之上、游戏内容之下的氛围（晶尘） */
  drawAmbient(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const a = 0.20 + 0.28 * (0.5 + 0.5 * Math.sin(m.phase));
      glowBlob(ctx, m.x, m.y, m.r * 5, m.color, a * 0.5);
      ctx.fillStyle = rgba('#ffffff', a);
      // 钻石形晶屑，不用圆点：飘的也应该是这片矿洞里崩出来的碎晶
      const w = m.r * 0.78;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - m.r);
      ctx.lineTo(m.x + w, m.y);
      ctx.lineTo(m.x, m.y + m.r);
      ctx.lineTo(m.x - w, m.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** 游戏内容之上的特效层 */
  drawFx(ctx) {
    ctx.save();
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      if (p.kind === 'chunk') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, t * 1.6);
        const img = p.imgs[p.variant];
        ctx.drawImage(img, -p.size / 2, -p.size / 2, p.size, p.size);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.55, t * 0.9);
        glowBlob(ctx, 0, 0, p.size * 0.9, p.glow, 0.5);
        ctx.restore();
      } else if (p.kind === 'dust') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, t * 1.4);
        glowBlob(ctx, p.x, p.y, p.size * 2.2, p.color, 0.55);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      } else if (p.kind === 'ring') {
        const r = p.r0 + (p.r1 - p.r0) * (1 - Math.pow(t, 0.6));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.pow(t, 0.8);
        crystalRing(ctx, p.x, p.y, r, Math.max(3, p.width * (0.35 + t * 0.65)),
          p.color, 1, p.seed || 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } else if (p.kind === 'beam') {
        ctx.globalCompositeOperation = 'lighter';
        beam(ctx, p.x0, p.y, p.x1, p.y, Math.max(3, 46 * t), p.color, 0.55 * t);
        beam(ctx, p.x0, p.y, p.x1, p.y, Math.max(1, 8 * t), '#ffffff', 0.75 * t);
        ctx.globalCompositeOperation = 'source-over';
      } else if (p.kind === 'glint') {
        ctx.globalCompositeOperation = 'lighter';
        const s = p.size * (0.4 + (1 - t) * 1.5);
        sparkle(ctx, p.x, p.y, s, p.color, t, p.rot + (1 - t) * 1.2);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();

    if (this.flash > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(this.flashColor, Math.min(0.6, this.flash));
      ctx.fillRect(0, 0, STAGE.w, STAGE.h);
      ctx.restore();
    }
  }

  /** 结算/菜单用的装饰性高光扫过 */
  static sweepAlpha(timeMs, periodMs = 3200) {
    const t = (timeMs % periodMs) / periodMs;
    return Math.sin(t * Math.PI) * 0.5;
  }
}

export { lighten };
