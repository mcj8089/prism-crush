/**
 * UI 皮肤（Canvas 侧） —— 水晶凿刻面板、按钮、进度、播报字
 * =====================================================================
 * 需求：禁止极简线条占位 UI。这里每个面板都是「凿进岩壁的石框 + 内壁辉光
 * + 铆钉宝石 + 顶部扫光」，文字带描边与投影，按钮有材质与按压反馈。
 */

import {
  rng, hash, range, rgba, lighten, darken, mix,
  roundRect, glowBlob, sparkle, makeCanvas, ctx2d,
} from './utils.js';
import { drawGem, gemOf } from './gems.js';

/** 字体栈：全部系统字体，离线可用 */
export const FONT_DISPLAY = '"Bahnschrift Condensed","DIN Condensed","Impact","PingFang SC","Microsoft YaHei",sans-serif';
export const FONT_BODY = '"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

/** 带描边 + 投影 + 渐变的数字/标题字 */
export function drawText(ctx, text, x, y, opt = {}) {
  const size = opt.size || 24;
  ctx.save();
  ctx.font = `${opt.weight || 700} ${size}px ${opt.font || FONT_DISPLAY}`;
  ctx.textAlign = opt.align || 'center';
  ctx.textBaseline = opt.baseline || 'middle';
  if (opt.letterSpacing) {
    try { ctx.letterSpacing = `${opt.letterSpacing}px`; } catch (e) { /* 老浏览器忽略 */ }
  }
  if (opt.shadow !== false) {
    ctx.shadowColor = opt.shadowColor || 'rgba(2,4,16,0.85)';
    ctx.shadowBlur = opt.shadowBlur ?? size * 0.45;
    ctx.shadowOffsetY = opt.shadowOffsetY ?? size * 0.10;
  }
  if (opt.stroke) {
    ctx.lineWidth = opt.strokeWidth || Math.max(2, size * 0.14);
    ctx.strokeStyle = opt.stroke;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }
  if (opt.gradient) {
    const g = ctx.createLinearGradient(x, y - size * 0.6, x, y + size * 0.6);
    opt.gradient.forEach(([t, c], i) => {
      g.addColorStop(i === 0 ? t : t, c);
      void i;
    });
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = opt.color || '#ffffff';
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * 石框面板。
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {object} [opt] {accent, active, radius, studs, glow}
 */
export function drawPanel(ctx, rect, opt = {}) {
  const { x, y, w, h } = rect;
  const radius = opt.radius ?? 16;
  const accent = opt.accent || '#3ff0d0';
  const r = rng(hash(`panel${Math.round(x)}${Math.round(y)}${Math.round(w)}`));

  ctx.save();

  /* 外投影 */
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, w, h, radius);
  const stone = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  stone.addColorStop(0, '#3a3064');
  stone.addColorStop(0.45, '#241C4A');
  stone.addColorStop(1, '#150f30');
  ctx.fillStyle = stone;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  /* 石面凿痕（斜向短槽，做出加工过的岩板） */
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.globalAlpha = 0.16;
  for (let i = -h; i < w + h; i += 9) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.strokeStyle = i % 18 === 0 ? '#ffffff' : '#000000';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 顶部扫光
  const sheen = ctx.createLinearGradient(x, y, x, y + h * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h * 0.5);
  ctx.restore();

  /* 内壁：凹进去的暗坑 */
  const inset = Math.min(12, w * 0.06);
  roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, radius * 0.7);
  const inner = ctx.createLinearGradient(x, y + inset, x, y + h);
  inner.addColorStop(0, 'rgba(4,3,16,0.85)');
  inner.addColorStop(1, 'rgba(10,6,28,0.55)');
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.strokeStyle = rgba(accent, opt.active ? 0.55 : 0.28);
  ctx.lineWidth = 1.6;
  ctx.stroke();

  /* 内壁辉光 */
  ctx.save();
  roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, radius * 0.7);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, x + w / 2, y + h - inset, w * 0.7, accent, opt.active ? 0.24 : 0.12);
  ctx.restore();

  /* 外框描边 + 倒角高光 */
  roundRect(ctx, x, y, w, h, radius);
  ctx.strokeStyle = rgba(lighten(accent, 0.2), opt.active ? 0.85 : 0.45);
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  /* 铆钉宝石 */
  if (opt.studs !== false) {
    const s = Math.min(16, h * 0.24);
    const corners = [
      [x + radius * 0.9, y + radius * 0.9],
      [x + w - radius * 0.9, y + radius * 0.9],
    ];
    corners.forEach(([cx, cy], i) => {
      const gem = gemOf(i === 0 ? 7 : 4);
      drawGem(ctx, gem, cx - s / 2, cy - s / 2, s, { glow: 0.35 });
    });
    void r;
  }
  ctx.restore();
}

/**
 * 水晶按钮（DOM 按钮的 Canvas 版，用于画布内按钮/触控板）。
 * @param {object} [opt] {accent, pressed, size, icon}
 */
export function drawButton(ctx, rect, label, opt = {}) {
  const { x, y, w, h } = rect;
  const pressed = !!opt.pressed;
  const accent = opt.accent || '#3ff0d0';
  ctx.save();
  const radius = h * 0.34;
  // 底座
  roundRect(ctx, x, y + (pressed ? 4 : 0), w, h, radius);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  if (opt.danger) {
    g.addColorStop(0, lighten('#ff5d7a', 0.18));
    g.addColorStop(0.5, '#e0294c');
    g.addColorStop(1, '#710f24');
  } else if (opt.primary) {
    g.addColorStop(0, lighten(accent, 0.35));
    g.addColorStop(0.5, mix(accent, '#1b7f8f', 0.35));
    g.addColorStop(1, '#0c3b47');
  } else {
    g.addColorStop(0, '#5a4d8f');
    g.addColorStop(0.5, '#332a5c');
    g.addColorStop(1, '#191338');
  }
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = pressed ? 4 : 14;
  ctx.shadowOffsetY = pressed ? 1 : 6;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 内部光泽
  ctx.save();
  roundRect(ctx, x, y + (pressed ? 4 : 0), w, h, radius);
  ctx.clip();
  const sheen = ctx.createLinearGradient(x, y, x, y + h * 0.55);
  sheen.addColorStop(0, 'rgba(255,255,255,0.34)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h * 0.55);
  if (!pressed) {
    ctx.globalCompositeOperation = 'lighter';
    const t = (Date.now() % 2600) / 2600;
    const sx = x + (t * 1.6 - 0.3) * w;
    const sweep = ctx.createLinearGradient(sx - w * 0.18, y, sx + w * 0.18, y + h);
    sweep.addColorStop(0, 'rgba(255,255,255,0)');
    sweep.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    sweep.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();

  // 描边
  roundRect(ctx, x, y + (pressed ? 4 : 0), w, h, radius);
  ctx.strokeStyle = rgba(lighten(accent, 0.4), pressed ? 0.5 : 0.9);
  ctx.lineWidth = 2;
  ctx.stroke();

  if (label) {
    drawText(ctx, label, x + w / 2, y + h / 2 + (pressed ? 4 : 0), {
      size: opt.size || h * 0.40,
      color: '#ffffff',
      stroke: 'rgba(6,4,20,0.75)',
      strokeWidth: Math.max(2, h * 0.06),
      font: FONT_BODY,
      weight: 800,
      letterSpacing: opt.tracking ?? 1,
    });
  }
  ctx.restore();
}

/** 分数条：晶体充能进度（当前分 / 下一级门槛） */
export function drawGauge(ctx, rect, ratio, accent) {
  const { x, y, w, h } = rect;
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(4,3,14,0.8)';
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.35);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  const r = Math.max(0, Math.min(1, ratio));
  if (r > 0.001) {
    ctx.save();
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.clip();
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, darken(accent, 0.35));
    g.addColorStop(0.6, accent);
    g.addColorStop(1, lighten(accent, 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w * r, h);
    // 充能纹理：斜向晶格
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < w * r; i += 12) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + h, y);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
    // 头部亮点
    ctx.globalCompositeOperation = 'lighter';
    glowBlob(ctx, x + w * r, y + h / 2, h * 1.6, lighten(accent, 0.4), 0.7);
  }
  ctx.restore();
}

/** 播报字（CRACK / PRISM BREAK 那种弹出大字） */
export function drawBanner(ctx, text, cx, cy, t, opt = {}) {
  // t: 0..1 生命进度
  const grow = t < 0.18 ? t / 0.18 : 1;
  const fade = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
  const size = (opt.size || 64) * (0.6 + grow * 0.4);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.translate(cx, cy - (1 - grow) * 26 - t * 18);
  ctx.rotate(Math.sin(t * 9) * 0.012);
  drawText(ctx, text, 0, 0, {
    size,
    color: opt.color || '#ffffff',
    stroke: opt.stroke || 'rgba(8,4,24,0.9)',
    strokeWidth: size * 0.16,
    gradient: opt.gradient || [
      [0, '#ffffff'],
      [0.45, opt.mid || '#9ff3ff'],
      [1, opt.deep || '#2b6cff'],
    ],
    shadow: true,
    shadowColor: rgba(opt.glow || '#3ff0d0', 0.9),
    shadowBlur: size * 0.8,
    letterSpacing: opt.tracking ?? 3,
  });
  ctx.globalCompositeOperation = 'lighter';
  sparkle(ctx, -size * 1.2, -size * 0.35, size * 0.4, '#ffffff', 0.7 * fade, t * 2);
  sparkle(ctx, size * 1.15, size * 0.2, size * 0.32, '#ffffff', 0.6 * fade, -t * 2.4);
  ctx.restore();
}

/** 生成一张面板精灵（供 DOM 背景使用，如分享卡片底纹） */
export function panelSprite(w, h, accent = '#3ff0d0') {
  const cv = makeCanvas(w, h);
  const ctx = ctx2d(cv);
  drawPanel(ctx, { x: 4, y: 4, w: w - 8, h: h - 8 }, { accent });
  return cv;
}

export { roundRect, glowBlob, sparkle, rng, range, darken, mix, makeCanvas, ctx2d };
