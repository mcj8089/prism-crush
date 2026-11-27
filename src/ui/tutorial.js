/**
 * 教学引导 —— 5 步动画，全部用真实晶体精灵绘制
 * =====================================================================
 * 需求红线：引导不得使用几何占位图形。这里每一步都在 420×300 的小画布上
 * 渲染一段真实晶窟动画（下落 / 旋转 / 加速 / 爆裂 / 深度），
 * 用的就是游戏内同一套 gemSprite 与 FxSystem 碎片。
 */

import { GEMS, BOARD, SHAPES } from '../../config/game.config.js';
import { rng, hash, rgba, range, roundRect, glowBlob, sparkle, makeCanvas, ctx2d } from '../art/utils.js';
import { gemSprite, gemOf, chunkSprites } from '../art/gems.js';
import { drawText, FONT_BODY, FONT_DISPLAY } from '../art/ui-art.js';
import { $ } from './ui.js';

const TUT_W = 420;
const TUT_H = 300;
const STEPS = 5;

/** 每一步用到的造型（取自原作 10 种造型，保证与真实游戏一致） */
const STEP_SHAPES = [SHAPES[0], SHAPES[5], SHAPES[3], SHAPES[1], SHAPES[2]];

export class Tutorial {
  /**
   * @param {object} opt
   * @param {import('./ui.js').UI} opt.ui
   * @param {import('../core/i18n.js').I18n} opt.i18n
   * @param {(key:string)=>void} [opt.onSound]
   * @param {()=>void} [opt.onDone]
   */
  constructor(opt) {
    this.ui = opt.ui;
    this.i18n = opt.i18n;
    this.onSound = opt.onSound || (() => {});
    this.onDone = opt.onDone || (() => {});
    this.index = 0;
    this.t = 0;
    this.canvas = $('#tut-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.el = {
      title: $('#tut-title'),
      body: $('#tut-body'),
      badge: $('#tut-badge'),
      dots: $('#tut-dots'),
      next: $('#tut-next'),
      prev: $('#tut-prev'),
      skip: $('#tut-skip'),
    };
    this.chunks = [];
    this._bind();
    this._buildDots();
  }

  _bind() {
    if (this.el.next) this.el.next.addEventListener('click', () => this._step(1));
    if (this.el.prev) this.el.prev.addEventListener('click', () => this._step(-1));
    if (this.el.skip) this.el.skip.addEventListener('click', () => this.finish());
  }

  _buildDots() {
    const d = this.el.dots;
    if (!d) return;
    d.innerHTML = '';
    for (let i = 0; i < STEPS; i++) d.appendChild(document.createElement('i'));
  }

  get active() { return this.ui.isOpen('tutorial'); }

  open(startAt = 0) {
    this.index = Math.max(0, Math.min(STEPS - 1, startAt));
    this.t = 0;
    this.chunks = [];
    this._sync();
    this.ui.open('tutorial');
  }

  close() { this.ui.close('tutorial'); }

  finish() {
    this.onSound('ui_click');
    this.close();
    this.onDone();
  }

  _step(dir) {
    this.onSound('ui_click');
    const next = this.index + dir;
    if (next >= STEPS) { this.finish(); return; }
    this.index = Math.max(0, next);
    this.t = 0;
    this.chunks = [];
    this._sync();
  }

  _sync() {
    const i = this.index + 1;
    const t = this.i18n;
    if (this.el.title) {
      this.el.title.setAttribute('data-i18n', `tutorial_step_${i}_title`);
      this.el.title.textContent = t.t(`tutorial_step_${i}_title`);
    }
    if (this.el.body) {
      this.el.body.setAttribute('data-i18n', `tutorial_step_${i}_body`);
      this.el.body.textContent = t.t(`tutorial_step_${i}_body`);
    }
    if (this.el.badge) this.el.badge.textContent = String(i);
    if (this.el.next) {
      this.el.next.setAttribute('data-i18n', this.index === STEPS - 1 ? 'tutorial_finish' : 'tutorial_next');
      this.el.next.textContent = t.t(this.index === STEPS - 1 ? 'tutorial_finish' : 'tutorial_next');
    }
    if (this.el.prev) this.el.prev.style.visibility = this.index === 0 ? 'hidden' : 'visible';
    if (this.el.dots) Array.from(this.el.dots.children).forEach((d, k) => d.classList.toggle('on', k === this.index));
    // 步骤指示也进 title，方便读屏
    if (this.canvas) this.canvas.setAttribute('aria-label', t.t('tutorial_indicator', { n: i }));
  }

  /** 语言切换后刷新文案 */
  refresh() { if (this.active) this._sync(); }

  /* ---------------------------------------------------------------- */
  /* 逐帧渲染                                                          */
  /* ---------------------------------------------------------------- */

  update(dtMs) {
    if (!this.active) return;
    this.t += dtMs;
    // 第 4 步的爆裂粒子
    if (this.index === 3) {
      const phase = (this.t % 2600) / 2600;
      if (phase > 0.55 && !this._burst) {
        this._burst = true;
        this._spawnBurst();
      }
      if (phase < 0.55) this._burst = false;
    }
    const dt = dtMs / 1000;
    for (const c of this.chunks) {
      c.life -= dtMs;
      c.vy += 900 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
    }
    this.chunks = this.chunks.filter((c) => c.life > 0);
    this.draw();
  }

  _spawnBurst() {
    const cell = 26;
    const ox = 46;
    const oy = 150;
    for (let i = 0; i < BOARD.cols; i++) {
      const gem = gemOf(1 + (i % 7));
      const imgs = chunkSprites(gem, 14);
      for (let k = 0; k < 4; k++) {
        this.chunks.push({
          x: ox + i * cell + cell / 2,
          y: oy + cell / 2,
          vx: (Math.random() - 0.5) * 420,
          vy: -Math.random() * 460 - 60,
          size: 8 + Math.random() * 12,
          rot: Math.random() * 6.28,
          spin: (Math.random() - 0.5) * 14,
          life: 700 + Math.random() * 500,
          imgs,
          variant: Math.floor(Math.random() * imgs.length),
          glow: gem.colors.glow,
        });
      }
    }
    this.onSound('shatter_small');
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = TUT_W;
    const H = TUT_H;
    const t = this.t;
    ctx.clearRect(0, 0, W, H);

    /* 小晶窟底 */
    const bg = ctx.createLinearGradient(0, 0, W * 0.3, H);
    bg.addColorStop(0, '#150d33');
    bg.addColorStop(0.6, '#1d1140');
    bg.addColorStop(1, '#2a1038');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = rng(7);
    for (let i = 0; i < 5; i++) glowBlob(ctx, r() * W, r() * H, 90 + r() * 60, ['#3ff0d0', '#8f6bff'][i % 2], 0.14);
    ctx.restore();

    switch (this.index) {
      case 0: this._drawFalling(ctx, t); break;
      case 1: this._drawRotate(ctx, t); break;
      case 2: this._drawSoftDrop(ctx, t); break;
      case 3: this._drawShatter(ctx, t); break;
      default: this._drawDepths(ctx, t); break;
    }
  }

  /**
   * 一个迷你晶坑：岩台边框 + 坑底晶面 + 一格一个承晶窝。
   * 与主场景同一套语言，禁止用直线网格当占位。
   */
  _well(ctx, x, y, w, h, cell) {
    const pad = 12;
    const rr = rng(hash('tutwell'));

    /* 岩台：从坑沿向外的一圈凿开的石头 */
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, 16);
    const rock = ctx.createLinearGradient(x - pad, y - pad, x + w, y + h + pad);
    rock.addColorStop(0, '#6b6390');
    rock.addColorStop(0.45, '#3d3760');
    rock.addColorStop(1, '#1a1634');
    ctx.fillStyle = rock;
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let i = 0; i < 90; i++) {
      const px = range(rr, x - pad, x + w + pad);
      const py = range(rr, y - pad, y + h + pad);
      if (px > x - 3 && px < x + w + 3 && py > y - 3 && py < y + h + 3) continue;
      ctx.globalAlpha = range(rr, 0.08, 0.26);
      ctx.fillStyle = rr() > 0.5 ? '#dcd8f2' : '#0b0920';
      ctx.beginPath();
      const r = range(rr, 1.6, 5);
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r * 0.8, py);
      ctx.lineTo(px, py + r);
      ctx.lineTo(px - r * 0.8, py);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, 16);
    ctx.strokeStyle = 'rgba(4,3,14,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 坑口内壁：顶亮底暗，做出深度 */
    roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 8);
    const lip = ctx.createLinearGradient(0, y - 4, 0, y + h + 4);
    lip.addColorStop(0, 'rgba(226,236,255,0.34)');
    lip.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.strokeStyle = lip;
    ctx.lineWidth = 4;
    ctx.stroke();

    /* 坑底 */
    roundRect(ctx, x, y, w, h, 6);
    const floor = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
    floor.addColorStop(0, '#141132');
    floor.addColorStop(0.7, '#0d0a24');
    floor.addColorStop(1, '#241041');
    ctx.fillStyle = floor;
    ctx.fill();

    ctx.save();
    roundRect(ctx, x, y, w, h, 6);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    glowBlob(ctx, x + w * 0.5, y + h * 1.05, w * 0.9, '#3ff0d0', 0.2);
    ctx.restore();

    /* 承晶窝：一格一个钻石凹面 */
    ctx.save();
    roundRect(ctx, x, y, w, h, 6);
    ctx.clip();
    const sr = rng(hash('tutsockets'));
    for (let gy = 0; gy * cell < h; gy++) {
      for (let gx = 0; gx * cell < w; gx++) {
        const cx = x + gx * cell + cell / 2;
        const cy = y + gy * cell + cell / 2;
        const half = (cell / 2 - cell * 0.13) * (0.9 + sr() * 0.16);
        ctx.beginPath();
        ctx.moveTo(cx, cy - half);
        ctx.lineTo(cx + half, cy - half * 0.34);
        ctx.lineTo(cx + half * 0.62, cy + half);
        ctx.lineTo(cx - half * 0.62, cy + half);
        ctx.lineTo(cx - half, cy - half * 0.34);
        ctx.closePath();
        const sg = ctx.createLinearGradient(cx, cy - half, cx, cy + half);
        sg.addColorStop(0, 'rgba(0,0,0,0.22)');
        sg.addColorStop(1, 'rgba(190,210,255,0.05)');
        ctx.fillStyle = sg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(180,205,255,0.05)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawShape(ctx, layout, cell, ox, oy, gem, alpha = 1) {
    for (let y = 0; y < layout.length; y++) {
      for (let x = 0; x < layout[y].length; x++) {
        if (!layout[y][x]) continue;
        const sp = gemSprite(gem, cell - 3, { seed: (x + y) % 3 });
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(sp.canvas, ox + x * cell - sp.pad + 1.5, oy + y * cell - sp.pad + 1.5);
        ctx.restore();
      }
    }
  }

  /** 第 1 步：晶体落下 */
  _drawFalling(ctx, t) {
    const cell = 26;
    const cols = 8;
    const rows = 7;
    const ox = (TUT_W - cols * cell) / 2;
    const oy = 42;
    this._well(ctx, ox, oy, cols * cell, rows * cell, cell);
    // 已堆的几行
    const stack = [6, 7, 8, 9, 10, 11, 12, 13];
    stack.forEach((c, i) => {
      const gem = gemOf(1 + (i % 7));
      this._drawShape(ctx, [[1]], cell, ox + c * cell, oy + (rows - 1) * cell, gem);
    });
    const phase = (t % 2200) / 2200;
    const y = oy - 40 + phase * (rows - 2) * cell;
    const gem = gemOf(3);
    this._drawShape(ctx, STEP_SHAPES[0], cell, ox + 2 * cell, y, gem);
    // 下落指示：一条渐隐的晶光轨迹（不是箭头线段）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, y, 0, y + 90);
    g.addColorStop(0, rgba(gem.colors.glow, 0.45));
    g.addColorStop(1, rgba(gem.colors.glow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(ox + 2.2 * cell, y, cell * 1.6, 90);
    ctx.restore();
    sparkle(ctx, ox + 2.6 * cell, y + 6, 16, '#ffffff', 0.7, t / 900);
    this._caption(ctx, '↓', TUT_W / 2, TUT_H - 22);
  }

  /** 第 2 步：旋转 */
  _drawRotate(ctx, t) {
    const cell = 26;
    const gem = gemOf(6);
    const seq = [STEP_SHAPES[2], STEP_SHAPES[4], STEP_SHAPES[2], STEP_SHAPES[6]];
    const i = Math.floor((t % 2400) / 600);
    const f = ((t % 2400) % 600) / 600;
    const cx = TUT_W / 2;
    const cy = 128;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(f * Math.PI / 2 * (i % 2 ? -1 : 1));
    const layout = seq[i % seq.length].length % 2 ? seq[i % seq.length] : seq[i % seq.length];
    const w = layout[0].length * cell;
    const h = layout.length * cell;
    this._drawShape(ctx, layout, cell, -w / 2, -h / 2, gem);
    ctx.restore();
    // 环形晶轨（真实晶体点连成的旋转轨迹，不是线框圆）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + t / 700;
      const x = cx + Math.cos(a) * 96;
      const y = cy + Math.sin(a) * 62;
      const s = 10 + 4 * Math.sin(a * 3);
      const sp = gemSprite(gemOf(1 + (k % 7)), s, { glow: 0.4 });
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(a);
      ctx.drawImage(sp.canvas, x - sp.canvas.width / 2, y - sp.canvas.height / 2);
    }
    ctx.restore();
    this._caption(ctx, '↑', cx, TUT_H - 22);
  }

  /** 第 3 步：左右移动 + 加速下落 */
  _drawSoftDrop(ctx, t) {
    const cell = 26;
    const cols = 9;
    const rows = 6;
    const ox = (TUT_W - cols * cell) / 2;
    const oy = 44;
    this._well(ctx, ox, oy, cols * cell, rows * cell, cell);
    const gem = gemOf(2);
    const phase = (t % 2600) / 2600;
    const bx = Math.round((0.5 + 0.5 * Math.sin(phase * Math.PI * 2)) * (cols - 3));
    const by = oy + (phase > 0.6 ? (phase - 0.6) / 0.4 * (rows - 2) * cell : 0);
    this._drawShape(ctx, STEP_SHAPES[3], cell, ox + bx * cell, by, gem);
    // 幽灵落点
    ctx.save();
    ctx.globalAlpha = 0.35;
    this._drawShape(ctx, STEP_SHAPES[3], cell, ox + bx * cell, oy + (rows - 2) * cell, gem, 0.3);
    ctx.restore();
    // 左右方向用两枚晶体箭头（真实晶体，不是三角形线框）
    const arrow = (x, dir) => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const a = 0.85 - k * 0.25;
        const sp = gemSprite(gemOf(7), 16 - k * 3, { glow: 0.5 });
        ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(t / 260 + k));
        ctx.drawImage(sp.canvas, x + dir * k * 16 - sp.canvas.width / 2, TUT_H - 40);
      }
      ctx.restore();
    };
    arrow(40, 1);
    arrow(TUT_W - 40, -1);
    this._caption(ctx, '← →', TUT_W / 2, TUT_H - 22);
  }

  /** 第 4 步：满行爆裂 */
  _drawShatter(ctx, t) {
    const cell = 26;
    const cols = 12;
    const ox = (TUT_W - cols * cell) / 2;
    const oy = 60;
    this._well(ctx, ox, oy, cols * cell, cell * 5, cell);
    const phase = (t % 2600) / 2600;
    // 底部四行
    for (let row = 1; row < 5; row++) {
      for (let c = 0; c < cols; c++) {
        if (row === 1 && phase > 0.55) continue;   // 正在被消除的那行
        const gem = gemOf(1 + ((c + row * 3) % 7));
        this._drawShape(ctx, [[1]], cell, ox + c * cell, oy + row * cell, gem);
      }
    }
    // 第 1 行：先逐格点亮，再炸开
    if (phase <= 0.55) {
      const lit = Math.floor(phase / 0.55 * cols);
      for (let c = 0; c < cols; c++) {
        const gem = gemOf(1 + (c % 7));
        if (c <= lit) this._drawShape(ctx, [[1]], cell, ox + c * cell, oy + cell, gem);
        else ctx.save(), ctx.globalAlpha = 0.25, this._drawShape(ctx, [[1]], cell, ox + c * cell, oy + cell, gem, 0.25), ctx.restore();
      }
      if (lit >= cols - 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        glowBlob(ctx, ox + cols * cell / 2, oy + cell * 1.5, cols * cell * 0.6, '#ffffff', 0.35 * ((phase - 0.45) / 0.1));
        ctx.restore();
      }
    }
    // 碎片
    for (const c of this.chunks) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, c.life / 600));
      const img = c.imgs[c.variant];
      ctx.drawImage(img, -c.size / 2, -c.size / 2, c.size, c.size);
      ctx.globalCompositeOperation = 'lighter';
      glowBlob(ctx, 0, 0, c.size * 1.4, c.glow, 0.4);
      ctx.restore();
    }
    this._caption(ctx, phase > 0.55 ? '✦' : '', TUT_W / 2, TUT_H - 22);
  }

  /** 第 5 步：深度与速度 */
  _drawDepths(ctx, t) {
    const rows = 4;
    const cell = 22;
    for (let i = 0; i < rows; i++) {
      const y = 46 + i * 56;
      const speed = 1 + i * 0.8;
      const gem = gemOf([1, 4, 5, 2][i]);
      ctx.save();
      roundRect(ctx, 60, y, TUT_W - 120, 44, 12);
      ctx.fillStyle = 'rgba(6,4,20,0.6)';
      ctx.fill();
      ctx.strokeStyle = rgba(gem.colors.glow, 0.4);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      const phase = ((t * 0.00035 * speed) % 1 + 1) % 1;
      const x = 66 + phase * (TUT_W - 140);
      const sp = gemSprite(gem, cell, { glow: 0.6 });
      ctx.drawImage(sp.canvas, x - sp.canvas.width / 2, y + 22 - sp.canvas.height / 2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(66, 0, x, 0);
      g.addColorStop(0, rgba(gem.colors.glow, 0));
      g.addColorStop(1, rgba(gem.colors.glow, 0.4));
      ctx.fillStyle = g;
      ctx.fillRect(66, y + 18, Math.max(0, x - 66), 8);
      ctx.restore();
      drawText(ctx, `Lv ${i + 1}`, TUT_W - 84, y + 22, {
        size: 16, color: '#cfe6ff', font: FONT_DISPLAY, letterSpacing: 2,
      });
    }
    this._caption(ctx, '', TUT_W / 2, TUT_H - 18);
  }

  _caption(ctx, glyph, x, y) {
    if (!glyph) return;
    drawText(ctx, glyph, x, y, {
      size: 22, color: '#9ffcf0', font: FONT_BODY, weight: 800,
      stroke: 'rgba(6,4,20,0.9)', strokeWidth: 5,
    });
  }
}

export { makeCanvas, ctx2d, hash, GEMS };
