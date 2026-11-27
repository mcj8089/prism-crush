/**
 * 晶窟场景 —— 背景、岩壁、矿脉、水晶簇、游戏机凹槽
 * =====================================================================
 * 需求红线：禁止纯色/纯黑背景，禁止直线/矩形拼出来的画面。
 * 背景叠了 12 层：
 *   天光渐变 → 远近两层 fbm 岩板 → 岩层节理 → 洞窟巨口（纵深） → 两侧洞壁剪影
 *   → 发光矿脉 + 脉节点晶 → 洞顶钟乳晶带 → 体积光柱 → 洞底晶丛 → 前景压边晶丛
 *   → 晶洞凹槽 → 暗角 + 颗粒
 * 游戏区是「凿进岩壁的一口晶矿井」：外圈是碎裂岩石台座，内壁有厚度（顶亮底暗），
 * 坑底是一格格凹下去的钻石形承晶窝，而不是网格线。
 */

import { STAGE, BOARD, THEMES, FX, RENDER } from '../../config/game.config.js';
import { GEMS } from '../../config/game.config.js';
import {
  rng, hash, range, rgba, lighten, darken, mix,
  roundRect, glowBlob, sparkle, valueNoise, fbm, fillPoly,
  makeCanvas, ctx2d,
} from './utils.js';
import { drawGem, gemOutline } from './gems.js';

/** 棋盘像素尺寸 */
export function boardPixelSize(cell = BOARD.cell) {
  return { w: BOARD.cols * cell, h: BOARD.rows * cell };
}

/** 棋盘在舞台中的位置（居中偏左，右侧留给信息面板） */
export function boardRect(cell = BOARD.cell) {
  const { w, h } = boardPixelSize(cell);
  return { x: (STAGE.w - w) / 2 + (BOARD.offsetX || 0), y: (STAGE.h - h) / 2 + 6, w, h };
}

/* ------------------------------------------------------------------ */
/* 岩壁噪声                                                            */
/* ------------------------------------------------------------------ */

/** 生成一张低分辨率岩壁噪声图（灰度），再放大铺满，得到大块岩石明暗 */
function rockPlate(w, h, seed, tint, contrast = 0.95, floor = 0.35) {
  const sw = Math.max(8, Math.floor(w / 4));
  const sh = Math.max(8, Math.floor(h / 4));
  const small = makeCanvas(sw, sh);
  const sctx = ctx2d(small);
  const img = sctx.createImageData(sw, sh);
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 991);
  const n3 = valueNoise(seed + 4231);
  const [r0, g0, b0] = hexToLocal(tint);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const broad = fbm(n1, x * 0.075, y * 0.075, 5);
      const fine = fbm(n2, x * 0.34, y * 0.34, 3);
      const streak = fbm(n3, x * 0.02, y * 0.42, 4);   // 纵向拉长的层理
      let k = broad * 0.55 + fine * 0.20 + streak * 0.25;
      k = Math.max(0, Math.min(1, (k - 0.5) * contrast + 0.5));
      const gain = floor + k * (1 - floor) * 1.25;
      const i = (y * sw + x) * 4;
      img.data[i] = Math.min(255, Math.round(r0 * gain));
      img.data[i + 1] = Math.min(255, Math.round(g0 * gain));
      img.data[i + 2] = Math.min(255, Math.round(b0 * gain));
      img.data[i + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  const big = makeCanvas(w, h);
  const bctx = ctx2d(big);
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(small, 0, 0, w, h);
  return big;
}

function hexToLocal(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ------------------------------------------------------------------ */
/* 通用不规则体                                                        */
/* ------------------------------------------------------------------ */

/** 不规则椭圆路径（岩石、晶洞口都用它，避免正圆/矩形） */
function blobPath(ctx, cx, cy, rx, ry, rnd, verts = 12, wob = 0.22) {
  const pts = [];
  const phase = rnd() * Math.PI * 2;
  const h1 = 2 + Math.floor(rnd() * 3);
  const p1 = rnd() * Math.PI * 2;
  for (let i = 0; i < verts; i++) {
    const a = phase + (i / verts) * Math.PI * 2 + range(rnd, -0.5, 0.5) * (Math.PI / verts);
    const w = 1 + Math.sin(a * h1 + p1) * wob + range(rnd, -wob * 0.6, wob * 0.6);
    pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
  }
  ctx.closePath();
  return pts;
}

/**
 * 凿口矩形：沿矩形四边采样并按外法线随机凸凹，再二次平滑闭合。
 * 用来画"凿进岩壁的坑口"——既有石头的毛边，又保证完整罩住棋盘
 * （直接用椭圆会在四角露出棋盘，看起来像贴了个矩形）。
 */
function hewnRect(ctx, x, y, w, h, rnd, bump = 9, steps = { x: 9, y: 13 }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pts = [];
  const push = (px, py) => {
    let nx = px - cx;
    let ny = py - cy;
    const L = Math.hypot(nx, ny) || 1;
    nx /= L; ny /= L;
    pts.push([px + nx * range(rnd, -bump * 0.45, bump), py + ny * range(rnd, -bump * 0.45, bump)]);
  };
  for (let i = 0; i < steps.x; i++) push(x + w * (i / steps.x), y);
  for (let i = 0; i < steps.y; i++) push(x + w, y + h * (i / steps.y));
  for (let i = 0; i < steps.x; i++) push(x + w * (1 - i / steps.x), y + h);
  for (let i = 0; i < steps.y; i++) push(x, y + h * (1 - i / steps.y));
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const nx2 = pts[(i + 1) % n];
    ctx.quadraticCurveTo(c[0], c[1], (c[0] + nx2[0]) / 2, (c[1] + nx2[1]) / 2);
  }
  ctx.closePath();
  return pts;
}

/* ------------------------------------------------------------------ */
/* 水晶簇                                                              */
/* ------------------------------------------------------------------ */

/**
 * 画一根晶柱（背景装饰用，比游戏内的块更细长、更透）。
 * 三段渐变 + 中棱 + 侧棱暗线 + 尖端辉光，做出真正的水晶柱。
 */
function crystalSpike(ctx, x, y, len, wide, color, glow, angle, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  const pts = [
    [-wide * 0.5, 0],
    [-wide * 0.42, -len * 0.35],
    [-wide * 0.22, -len * 0.82],
    [0, -len],
    [wide * 0.26, -len * 0.78],
    [wide * 0.46, -len * 0.32],
    [wide * 0.55, 0],
  ];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  const g = ctx.createLinearGradient(-wide, 0, wide, -len);
  g.addColorStop(0, rgba(darken(color, 0.55), 0.95));
  g.addColorStop(0.42, rgba(color, 0.9));
  g.addColorStop(0.72, rgba(lighten(color, 0.45), 0.95));
  g.addColorStop(1, rgba(color, 0.85));
  ctx.fillStyle = g;
  ctx.fill();
  // 背光侧压暗，晶柱才有圆柱感
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.lineTo(0, -len);
  ctx.closePath();
  ctx.fillStyle = rgba(darken(color, 0.5), 0.42);
  ctx.fill();
  // 中棱高光
  ctx.beginPath();
  ctx.moveTo(0, -len);
  ctx.lineTo(wide * 0.06, -len * 0.1);
  ctx.strokeStyle = rgba(glow, 0.75);
  ctx.lineWidth = Math.max(1, wide * 0.10);
  ctx.stroke();
  // 侧棱暗线
  ctx.beginPath();
  ctx.moveTo(pts[2][0], pts[2][1]);
  ctx.lineTo(pts[6][0], pts[6][1]);
  ctx.strokeStyle = rgba(darken(color, 0.6), 0.55);
  ctx.lineWidth = Math.max(0.8, wide * 0.07);
  ctx.stroke();
  // 根部暗环
  const root = ctx.createLinearGradient(0, -len * 0.22, 0, 0);
  root.addColorStop(0, 'rgba(0,0,0,0)');
  root.addColorStop(1, 'rgba(3,2,12,0.65)');
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[6][0], pts[6][1]);
  ctx.lineTo(pts[6][0], pts[6][1] - len * 0.22);
  ctx.lineTo(pts[0][0], pts[0][1] - len * 0.22);
  ctx.closePath();
  ctx.fillStyle = root;
  ctx.fill();
  // 尖端辉光
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, 0, -len * 0.94, wide * 1.5, glow, 0.5);
  ctx.restore();
}

/**
 * 一丛水晶。
 * @param {number} [tone] 0..1 空气透视系数：越大越暗、越靠后（背景用 0.3~0.6，前景剪影用 0.9）
 */
function crystalCluster(ctx, x, y, scale, gem, seed, dir = -1, tone = 0) {
  const r = rng(hash(seed) + 17);
  const count = 4 + Math.floor(r() * 4);
  const body = darken(gem.colors.body, tone * 0.72);
  const glow = darken(gem.colors.glow, tone * 0.55);
  const alpha = 1 - tone * 0.55;
  // 根部一坨岩瘤：晶簇得「长在石头上」，否则像一把竖起来的玻璃刀
  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  blobPath(ctx, x, y + scale * 0.10, scale * 0.95, scale * 0.42, r, 8, 0.35);
  const nub = ctx.createLinearGradient(x - scale, y, x + scale, y + scale * 0.5);
  nub.addColorStop(0, darken(gem.colors.deep, 0.35 + tone * 0.3));
  nub.addColorStop(1, '#0d0a20');
  ctx.fillStyle = nub;
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < count; i++) {
    const off = range(r, -0.55, 0.55) * scale * 1.3;
    // 真正的扇形展开：中间那根最长，两侧依次矮下去并向外倒，
    // 否则一丛只有两三根露头，看着像一排兔耳而不像一窝晶体。
    const k = count === 1 ? 0.5 : i / (count - 1);
    const lean = (k - 0.5) * 1.5 + range(r, -0.16, 0.16);
    const tall = 1 - Math.abs(k - 0.5) * 1.15;
    const len = scale * range(r, 0.62, 1.5) * tall;
    const wide = scale * range(r, 0.30, 0.54);
    const angle = lean + dir * 0.12;
    crystalSpike(ctx, x + off, y, len, wide, body, glow, angle, alpha * range(r, 0.6, 1));
  }
}

/* ------------------------------------------------------------------ */
/* 主背景                                                              */
/* ------------------------------------------------------------------ */

/**
 * 绘制完整背景到 ctx（不含游戏内容）。结果会被上层缓存，只在换层级时重画。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} [opt] {tier:0..3, cell:number}
 */
export function drawBackground(ctx, opt = {}) {
  const W = STAGE.w;
  const H = STAGE.h;
  const tierIdx = Math.min(THEMES.tiers.length - 1, Math.max(0, opt.tier || 0));
  const tier = THEMES.tiers[tierIdx];
  const theme = THEMES.default;
  const seedBase = hash(tier.name);
  const r = rng(seedBase);
  const b = boardRect(opt.cell || BOARD.cell);

  ctx.save();
  ctx.clearRect(0, 0, W, H);

  /* 1) 天光渐变：洞顶冷、洞底被晶体映亮 */
  const sky = ctx.createLinearGradient(0, 0, W * 0.25, H);
  sky.addColorStop(0, darken(tier.deep, 0.35));
  sky.addColorStop(0.34, theme.sky[1]);
  sky.addColorStop(0.66, mix(theme.sky[2], tier.tint, 0.14));
  sky.addColorStop(1, mix('#2a1240', tier.tint, 0.34));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  /* 2) 远景岩板（暗、对比低）+ 近景岩板（亮、对比高） */
  ctx.globalAlpha = 0.55;
  ctx.drawImage(rockPlate(W, H, seedBase + 5, mix(theme.rock, tier.tint, 0.10), 0.55, 0.30), 0, 0);
  ctx.globalAlpha = 0.62;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(rockPlate(W, H, seedBase + 77, mix(theme.rock, '#8c7ad6', 0.35), 1.25, 0.22), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  /* 3) 岩层节理：横向条带 + 断裂线 + 断口高光 */
  for (let i = 0; i < 22; i++) {
    const y = range(r, -0.1, 1.1) * H;
    const amp = range(r, 6, 30);
    const path = (dy) => {
      ctx.beginPath();
      ctx.moveTo(0, y + dy);
      for (let x = 0; x <= W; x += 32) {
        ctx.lineTo(x, y + dy + Math.sin(x * 0.006 + i) * amp + Math.cos(x * 0.013 + i * 2) * amp * 0.4);
      }
    };
    path(0);
    ctx.strokeStyle = rgba('#000000', range(r, 0.10, 0.26));
    ctx.lineWidth = range(r, 1.5, 6);
    ctx.stroke();
    path(-3.5);
    ctx.strokeStyle = rgba('#dceeff', range(r, 0.035, 0.085));
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  /* 4) 洞窟巨口：棋盘背后一坨更亮的腔体，制造"往深处看"的纵深 */
  drawGeodeChamber(ctx, b, tier, r);

  /* 5) 两侧洞壁剪影 */
  drawCaveWalls(ctx, W, H, tier, r);

  /* 6) 发光矿脉
     只描一条发光折线会让背景上半部看起来全是弯曲线稿，所以分三层：
     先在岩壁上凿出暗裂口 → 裂口里填矿脉辉光 → 沿脉结出一串串小晶丛。 */
  const veins = [];
  for (let i = 0; i < FX.ambient.veins; i++) {
    const x0 = range(r, -0.1, 1.1) * W;
    const y0 = range(r, -0.1, 1.1) * H;
    const pts = [[x0, y0]];
    let px = x0;
    let py = y0;
    for (let k = 0; k < 6; k++) {
      px += range(r, -130, 130);
      py += range(r, -80, 100);
      pts.push([px, py]);
    }
    veins.push({ pts, wide: range(r, 7, 17), core: range(r, 1.6, 3.4) });
  }
  const traceVein = (ctx, pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) {
      const prev = pts[k - 1];
      ctx.quadraticCurveTo(prev[0], prev[1], (prev[0] + pts[k][0]) / 2, (prev[1] + pts[k][1]) / 2);
    }
  };
  ctx.save();
  ctx.lineCap = 'round';
  for (const v of veins) {
    traceVein(ctx, v.pts);
    ctx.strokeStyle = 'rgba(5,3,16,0.62)';
    ctx.lineWidth = v.wide * 1.45;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const v of veins) {
    traceVein(ctx, v.pts);
    ctx.strokeStyle = rgba(tier.tint, 0.13);
    ctx.lineWidth = v.wide;
    ctx.stroke();
    ctx.strokeStyle = rgba(tier.tint, 0.26);
    ctx.lineWidth = v.core;
    ctx.stroke();
  }
  ctx.restore();
  for (let i = 0; i < veins.length; i++) {
    const pts = veins[i].pts;
    for (let k = 1; k < pts.length - 1; k++) {
      if (r() > 0.72) continue;
      const g = GEMS[(i * 3 + k) % GEMS.length];
      glowBlob(ctx, pts[k][0], pts[k][1], range(r, 9, 20), tier.tint, 0.30);
      crystalCluster(ctx, pts[k][0], pts[k][1] + 3, range(r, 11, 22), g,
        `vein${i}-${k}`, r() > 0.5 ? -1 : 1, range(r, 0.30, 0.52));
      diamondChip(ctx, pts[k][0], pts[k][1], range(r, 3, 6), '#ffffff', 0.45, r);
    }
  }

  /* 7) 嵌入岩壁的晶簇（散点，做出"石头里长出水晶"）
     尺寸下限要压过矿脉线的宽度，否则背景上半部只剩一堆细弯线，读不出石头。 */
  const gems = GEMS;
  for (let i = 0; i < 26; i++) {
    const x = range(r, 0, W);
    const y = range(r, 0, H);
    if (x > b.x - 60 && x < b.x + b.w + 60 && y > b.y - 40 && y < b.y + b.h + 40) continue;
    const g = gems[Math.floor(r() * gems.length)];
    crystalCluster(ctx, x, y, range(r, 15, 32), g, 'inrock' + i, r() > 0.5 ? -1 : 1, range(r, 0.22, 0.46));
  }

  /* 8) 洞顶钟乳晶带（横贯画面顶部，把"洞"字立起来） */
  drawCeilingBand(ctx, W, tier, r);

  /* 9) 体积光柱 */
  drawLightShafts(ctx, W, H, tier, r);

  /* 10) 洞底 + 前景晶丛 */
  for (let i = 0; i < 8; i++) {
    const x = i < 4 ? range(r, -40, 240) : range(r, W - 240, W + 40);
    crystalCluster(ctx, x, H + 4, 44 + range(r, 0, 34), gems[(i * 3) % gems.length], 'floor' + i, -1, 0.62);
  }

  /* 10.5) 空气透视：把背景整体压暗压灰，前景晶丛才是剪影 */
  const haze = ctx.createLinearGradient(0, 0, 0, H);
  haze.addColorStop(0, rgba(darken(tier.deep, 0.7), 0.52));
  haze.addColorStop(0.45, rgba('#07051a', 0.42));
  haze.addColorStop(1, rgba('#04030f', 0.55));
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, b.x + b.w * 0.5, b.y + b.h * 0.55, H * 0.85, tier.tint, 0.07);
  ctx.globalCompositeOperation = 'source-over';

  /* 10.6) 前景压边晶丛（近黑剪影，只留轮廓上的一点冷光） */
  for (let i = 0; i < 7; i++) {
    const x = range(r, 0, W);
    crystalCluster(ctx, x, H + 30, 64 + range(r, 0, 30), gems[(i * 5 + 2) % gems.length], 'fg' + i, -1, 0.9);
  }

  /* 11) 游戏区凹槽 */
  if (opt.alcove !== false) drawAlcove(ctx, opt.cell || BOARD.cell, tier);

  /* 12) 暗角 + 颗粒 */
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.30, W / 2, H / 2, H * 1.02);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.62, `rgba(2,1,10,${RENDER.vignette * 0.30})`);
  vig.addColorStop(1, `rgba(2,1,10,${RENDER.vignette})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = 0.055;
  ctx.fillStyle = '#ffffff';
  const gr = rng(7);
  for (let i = 0; i < 2600; i++) {
    ctx.fillRect(Math.floor(gr() * W), Math.floor(gr() * H), 1, 1);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 岩面里嵌的小晶片（菱形，不是圆点）；color 支持 #hex 或任意 css 颜色 */
function diamondChip(ctx, x, y, r, color, alpha, rnd) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + (rnd ? rnd() * 0.4 : 0.2);
    const rad = r * (i % 2 ? 0.62 : 1);
    pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = String(color).startsWith('#') ? rgba(color, alpha) : color;
  ctx.fill();
}

/** 棋盘背后的腔体：一圈亮边 + 内部更深的空洞感 */
function drawGeodeChamber(ctx, b, tier, r) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h * 0.52;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, cx, cy, b.h * 0.78, tier.tint, 0.13);
  glowBlob(ctx, cx, cy - b.h * 0.30, b.h * 0.45, '#9fc6ff', 0.08);
  ctx.restore();

  // 腔口岩石环（不规则，压在岩板上）
  ctx.save();
  blobPath(ctx, cx, cy, b.w * 0.92, b.h * 0.66, r, 18, 0.10);
  ctx.strokeStyle = rgba(lightenToHex(tier.tint, 0.25), 0.16);
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = rgba('#05030f', 0.45);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function lightenToHex(hex, amt) {
  const s = String(hex).trim();
  const isHex = s.startsWith('#');
  const out = isHex ? lighten(s, amt) : lighten('#ffffff', 0);
  return rgbToHex(out);
}

function rgbToHex(str) {
  const m = String(str).match(/\d+/g);
  if (!m || m.length < 3) return '#ffffff';
  const h = (n) => Number(n).toString(16).padStart(2, '0');
  return `#${h(m[0])}${h(m[1])}${h(m[2])}`;
}

/** 两侧洞壁剪影：不规则岩口 + 岩口上的晶丛，把画面收成"洞穴" */
function drawCaveWalls(ctx, W, H, tier, r) {
  const wall = (side) => {
    const sgn = side === 'l' ? 1 : -1;
    const baseX = side === 'l' ? 0 : W;
    const pts = [[baseX, 0]];
    for (let y = 0; y <= H + 40; y += 34) {
      const wob = 0.5 + 0.5 * Math.sin(y * 0.010 + (side === 'l' ? 0 : 2.4));
      const x = baseX + sgn * (58 + wob * 108 + range(r, -16, 16));
      pts.push([x, y]);
    }
    pts.push([baseX, H]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(baseX, 0, baseX + sgn * 190, 0);
    g.addColorStop(0, rgba(darken(tier.deep, 0.72), 0.98));
    g.addColorStop(0.55, rgba(darken(tier.deep, 0.42), 0.90));
    g.addColorStop(1, rgba(tier.deep, 0));
    ctx.fillStyle = g;
    ctx.fill();
    // 岩口受光边
    ctx.strokeStyle = rgba(tier.tint, 0.26);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = rgba('#04030e', 0.6);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 岩口上长的晶丛
    for (let i = 0; i < 9; i++) {
      const p = pts[2 + Math.floor(r() * (pts.length - 4))];
      crystalCluster(ctx, p[0] + sgn * 6, p[1], 16 + r() * 16, GEMS[Math.floor(r() * GEMS.length)], 'wall' + side + i, sgn > 0 ? 1 : -1, 0.42);
    }
  };
  wall('l');
  wall('r');
}

/** 洞顶晶带：一整排向下生长的晶柱，长短交错 */
function drawCeilingBand(ctx, W, tier, r) {
  ctx.save();
  // 顶部岩檐（不规则下缘）
  ctx.beginPath();
  ctx.moveTo(0, -10);
  for (let x = 0; x <= W; x += 46) {
    ctx.lineTo(x, 20 + Math.sin(x * 0.011) * 14 + range(r, -8, 12));
  }
  ctx.lineTo(W, -10);
  ctx.closePath();
  const eave = ctx.createLinearGradient(0, -10, 0, 46);
  eave.addColorStop(0, rgba('#05030f', 0.95));
  eave.addColorStop(1, rgba(darken(tier.deep, 0.5), 0.55));
  ctx.fillStyle = eave;
  ctx.fill();
  ctx.strokeStyle = rgba(tier.tint, 0.20);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 檐下垂晶（远景，走空气透视：压暗、只留尖端冷光）
  let x = 24;
  let i = 0;
  while (x < W) {
    const g = GEMS[i % GEMS.length];
    const len = range(r, 42, 132);
    const wide = len * range(r, 0.16, 0.26);
    crystalSpike(
      ctx, x, range(r, 22, 40), len, wide,
      darken(g.colors.body, 0.62), darken(g.colors.glow, 0.30),
      range(r, -0.16, 0.16), 0.72
    );
    x += range(r, 34, 78);
    i++;
  }
}

/** 洞顶光柱 */
function drawLightShafts(ctx, W, H, tier, r) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < FX.ambient.shafts; i++) {
    const cx = range(r, 0.08, 0.92) * W;
    const spread = range(r, 70, 170);
    const tilt = range(r, -0.28, 0.28);
    const g = ctx.createLinearGradient(cx, -20, cx + tilt * H, H * 0.94);
    g.addColorStop(0, rgba(tier.tint, 0.24));
    g.addColorStop(0.35, rgba(tier.tint, 0.10));
    g.addColorStop(1, rgba(tier.tint, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - spread * 0.20, -20);
    ctx.lineTo(cx + spread * 0.20, -20);
    ctx.lineTo(cx + tilt * H + spread, H * 0.96);
    ctx.lineTo(cx + tilt * H - spread, H * 0.96);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 游戏区凹槽                                                          */
/* ------------------------------------------------------------------ */

/**
 * 把棋盘画成"凿进岩壁的一格一格晶矿凹槽"：
 * 外圈碎裂岩石台座 → 有厚度的坑口倒角（顶亮底暗） → 坑底晶面
 * → 一格一格的钻石承晶窝 → 坑内辉光与矿脉 → 台座上的铆晶。
 */
export function drawAlcove(ctx, cell, tier) {
  const b = boardRect(cell);
  const padX = cell * 1.15;
  const padY = cell * 0.95;
  const x = b.x - padX;
  const y = b.y - padY;
  const w = b.w + padX * 2;
  const h = b.h + padY * 2;
  const rr = rng(hash('alcove' + tier.name));

  ctx.save();

  /* 1) 台座投影：整个岩台在背景上落下的阴影 */
  ctx.save();
  ctx.globalAlpha = 0.6;
  hewnRect(ctx, x + 8, y + 12, w, h, rng(hash('shadow' + tier.name)), 10);
  ctx.fillStyle = 'rgba(2,1,10,0.8)';
  ctx.fill();
  ctx.restore();

  /* 2) 台座岩石：凿口不规则轮廓 + 岩板材质 */
  hewnRect(ctx, x, y, w, h, rr, 11);
  const rockG = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  rockG.addColorStop(0, '#524c74');
  rockG.addColorStop(0.28, '#38325a');
  rockG.addColorStop(0.62, '#241f3e');
  rockG.addColorStop(1, '#141128');
  ctx.fillStyle = rockG;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 岩层纹：横向条带，让台座是「层岩」而不是纯色边条
  for (let i = 0; i < 26; i++) {
    const sy = range(rr, y, y + h);
    ctx.beginPath();
    ctx.moveTo(x - 4, sy);
    ctx.lineTo(x + w + 4, sy + range(rr, -14, 14));
    ctx.strokeStyle = rr() > 0.5 ? 'rgba(255,250,235,0.055)' : 'rgba(6,4,20,0.30)';
    ctx.lineWidth = range(rr, 2, 9);
    ctx.stroke();
  }
  // 台座上的岩屑明暗
  for (let i = 0; i < 260; i++) {
    const px = range(rr, x, x + w);
    const py = range(rr, y, y + h);
    const s = range(rr, 2, 11);
    ctx.globalAlpha = range(rr, 0.06, 0.22);
    ctx.fillStyle = rr() > 0.5 ? 'rgba(224,222,245,1)' : 'rgba(9,8,26,1)';
    diamondChip(ctx, px, py, s, ctx.fillStyle, 1, rr);
  }
  ctx.globalAlpha = 1;
  // 凿痕：从坑口向外放射的短棱，说明「这是凿出来的」
  for (let i = 0; i < 64; i++) {
    const edge = Math.floor(rr() * 4);
    let px; let py; let dx; let dy;
    const len = range(rr, 10, 26);
    if (edge === 0) { px = range(rr, x, x + w); py = y + range(rr, 0, padY); dx = 0; dy = -len; }
    else if (edge === 1) { px = range(rr, x, x + w); py = y + h - range(rr, 0, padY); dx = 0; dy = len; }
    else if (edge === 2) { px = x + range(rr, 0, padX); py = range(rr, y, y + h); dx = -len; dy = 0; }
    else { px = x + w - range(rr, 0, padX); py = range(rr, y, y + h); dx = len; dy = 0; }
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx, py + dy + range(rr, -5, 5));
    ctx.strokeStyle = 'rgba(6,4,20,0.42)';
    ctx.lineWidth = range(rr, 1.4, 3.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 1.4, py + 1.4);
    ctx.lineTo(px + dx + 1.4, py + dy + 1.4);
    ctx.strokeStyle = 'rgba(255,250,235,0.10)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  // 台座受光顶缘
  const topLight = ctx.createLinearGradient(0, y, 0, y + h * 0.22);
  topLight.addColorStop(0, 'rgba(255,255,255,0.11)');
  topLight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = topLight;
  ctx.fillRect(x, y, w, h * 0.22);
  ctx.restore();

  // 台座外沿：亮晶边 + 暗描边
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(tier.tint, 0.42);
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(4,3,14,0.85)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  /* 3) 台座四周的碎石块（让"凿开"这件事有证据） */
  for (let i = 0; i < 26; i++) {
    const side = i % 4;
    const t = rr();
    let px; let py;
    if (side === 0) { px = x + t * w; py = y - range(rr, 2, 16); }
    else if (side === 1) { px = x + t * w; py = y + h + range(rr, 2, 16); }
    else if (side === 2) { px = x - range(rr, 2, 16); py = y + t * h; }
    else { px = x + w + range(rr, 2, 16); py = y + t * h; }
    const s = range(rr, 5, 15);
    ctx.save();
    blobPath(ctx, px, py, s, s * range(rr, 0.6, 1.1), rr, 7, 0.3);
    const gg = ctx.createLinearGradient(px - s, py - s, px + s, py + s);
    gg.addColorStop(0, '#463a70');
    gg.addColorStop(1, '#120d28');
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(4,3,14,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /* 4) 坑口：有厚度的内壁（顶/左受光，底/右背光） */
  const hole = { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 16 };
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.moveTo(hole.x, hole.y);
  ctx.lineTo(hole.x, hole.y + hole.h);
  ctx.lineTo(hole.x + hole.w, hole.y + hole.h);
  ctx.lineTo(hole.x + hole.w, hole.y);
  ctx.closePath();
  ctx.clip('evenodd');
  const thick = ctx.createLinearGradient(hole.x, hole.y, hole.x + hole.w, hole.y + hole.h);
  thick.addColorStop(0, 'rgba(214,226,255,0.30)');
  thick.addColorStop(0.45, 'rgba(120,110,190,0.10)');
  thick.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = thick;
  ctx.fillRect(x, y, w, h);
  // 内壁的凿痕（斜向短棱，不是网格线）
  for (let i = 0; i < 90; i++) {
    const px = range(rr, x, x + w);
    const py = range(rr, y, y + h);
    if (px > hole.x && px < hole.x + hole.w && py > hole.y && py < hole.y + hole.h) continue;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + range(rr, -9, 9), py + range(rr, -9, 9));
    ctx.strokeStyle = rr() > 0.5 ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.30)';
    ctx.lineWidth = range(rr, 1, 2.6);
    ctx.stroke();
  }
  ctx.restore();

  /* 5) 坑底：深色晶面 + 顶光入射 + 底部焦散 */
  roundRect(ctx, hole.x, hole.y, hole.w, hole.h, 12);
  const floor = ctx.createLinearGradient(hole.x, hole.y, hole.x + hole.w * 0.3, hole.y + hole.h);
  floor.addColorStop(0, '#141132');
  floor.addColorStop(0.42, '#0d0a24');
  floor.addColorStop(0.82, mix('#150c2c', tier.tint, 0.10));
  floor.addColorStop(1, mix('#1d0f34', tier.tint, 0.26));
  ctx.fillStyle = floor;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, b.x + b.w * 0.5, b.y + b.h * 1.02, b.w * 0.95, tier.tint, 0.26);
  glowBlob(ctx, b.x + b.w * 0.16, b.y - b.h * 0.04, b.w * 0.55, '#8fb8ff', 0.14);
  // 坑底矿脉：从底部往上放射的柔和辉光（不是硬线条）
  const vr = rng(hash('veins' + tier.name));
  for (let i = 0; i < 3; i++) {
    const sx = b.x + range(vr, 0.1, 0.9) * b.w;
    const pts = [[sx, b.y + b.h + 8]];
    let cx2 = sx;
    let cy2 = b.y + b.h + 8;
    for (let k = 0; k < 4; k++) {
      cx2 += range(vr, -26, 26);
      cy2 -= range(vr, 46, 96);
      pts.push([cx2, cy2]);
    }
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length - 1; k++) {
        const mid = [(pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2];
        ctx.quadraticCurveTo(pts[k][0], pts[k][1], mid[0], mid[1]);
      }
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(tier.tint, 0.032);
    ctx.lineWidth = range(vr, 12, 20);
    trace();
    ctx.strokeStyle = rgba(tier.tint, 0.042);
    ctx.lineWidth = range(vr, 1.8, 3);
    trace();
    ctx.strokeStyle = rgba('#ffffff', 0.016);
    ctx.lineWidth = 1;
    trace();
  }
  ctx.restore();

  /* 6) 承晶窝：一格一个钻石形凹面（不是网格线） */
  ctx.save();
  roundRect(ctx, hole.x, hole.y, hole.w, hole.h, 12);
  ctx.clip();
  const inset = cell * 0.13;
  const sh = cell * 0.30;
  const sr = rng(hash('sockets' + tier.name));
  for (let gy = 0; gy < BOARD.rows; gy++) {
    for (let gx = 0; gx < BOARD.cols; gx++) {
      const cx = b.x + gx * cell + cell / 2;
      const cy = b.y + gy * cell + cell / 2;
      const vary = 0.9 + sr() * 0.16;
      const half = (cell / 2 - inset) * vary;
      // 越靠洞顶越暗：空区不该出现满屏重复贴图，只有深处承晶面才可见
      const depthFade = 0.22 + 0.78 * (gy / (BOARD.rows - 1));
      ctx.globalAlpha = depthFade;
      ctx.beginPath();
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half, cy - half * 0.34);
      ctx.lineTo(cx + half * 0.62, cy + half);
      ctx.lineTo(cx - half * 0.62, cy + half);
      ctx.lineTo(cx - half, cy - half * 0.34);
      ctx.closePath();
      const sg = ctx.createLinearGradient(cx, cy - half, cx, cy + half);
      sg.addColorStop(0, 'rgba(0,0,0,0.20)');
      sg.addColorStop(0.6, 'rgba(150,170,255,0.014)');
      sg.addColorStop(1, 'rgba(190,210,255,0.034)');
      ctx.fillStyle = sg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,205,255,0.028)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // 少数窝底结一颗小晶瘤，避免整面像重复贴图
      if (sr() > 0.9) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        glowBlob(ctx, cx, cy + half * 0.4, cell * 0.3, tier.tint, 0.16);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }
  // 洞顶垂晶：从坑口顶缘向下长一排钟乳晶，只占最上面不到一格，
  // 既不压住落子区，又让「上面是凿开的洞口」这件事有交代。
  const hr = rng(hash('hang' + tier.name));
  let hx = b.x - 6;
  while (hx < b.x + b.w + 6) {
    const step = range(hr, 21, 54);
    const len = cell * range(hr, 0.20, 0.88);
    const wgt = cell * range(hr, 0.11, 0.30);
    const g = GEMS[Math.floor(hr() * GEMS.length)];
    ctx.save();
    ctx.globalAlpha = 0.40;
    crystalSpike(ctx, hx + step / 2, b.y - cell * 0.12, len, wgt,
      darken(g.colors.deep, 0.62), tier.tint, Math.PI, 0.72);
    ctx.restore();
    // 长针之间再补一枚短晶芽，疏密才有自然节奏
    if (step > 34) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      crystalSpike(ctx, hx + step * 0.78, b.y - cell * 0.10, cell * range(hr, 0.12, 0.30),
        wgt * 0.6, darken(g.colors.deep, 0.72), tier.tint, Math.PI, 0.72);
      ctx.restore();
    }
    hx += step;
  }
  // 洞口入光：一道从顶落下的体积光，空场时画面不至于是一块死黑
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const shaft = ctx.createLinearGradient(0, b.y, 0, b.y + b.h * 0.72);
  shaft.addColorStop(0, rgba('#cfe4ff', 0.075));
  shaft.addColorStop(0.45, rgba(tier.tint, 0.028));
  shaft.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(b.x + b.w * 0.30, b.y);
  ctx.lineTo(b.x + b.w * 0.62, b.y);
  ctx.lineTo(b.x + b.w * 0.80, b.y + b.h * 0.72);
  ctx.lineTo(b.x + b.w * 0.10, b.y + b.h * 0.72);
  ctx.closePath();
  ctx.fillStyle = shaft;
  ctx.fill();
  ctx.restore();

  // 每 4 行一道"深度刻度"亮带 + 小晶点
  for (let gy = 4; gy < BOARD.rows; gy += 4) {
    const yy = b.y + gy * cell;
    const tr = rng(hash('tick' + tier.name + gy));
    // 走一条起伏的矿脉线，而不是一把尺子的刻度
    ctx.beginPath();
    for (let px = b.x + 4; px <= b.x + b.w - 4; px += 22) {
      const py = yy + Math.sin((px - b.x) * 0.05 + gy) * 1.6 + range(tr, -1.2, 1.2);
      if (px === b.x + 4) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = rgba(tier.tint, 0.14);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    for (let gx = 0; gx <= BOARD.cols; gx += 4) {
      sparkle(ctx, b.x + gx * cell, yy, sh * 0.5, '#bfe9ff', 0.22, 0.4);
    }
  }
  ctx.restore();

  /* 7) 坑口描边 */
  roundRect(ctx, hole.x, hole.y, hole.w, hole.h, 12);
  ctx.strokeStyle = rgba(tier.tint, 0.34);
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(5,4,16,0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();

  /* 8) 台座上的铆晶 + 垂挂小晶 */
  const studs = 5;
  for (let i = 0; i < studs; i++) {
    const t = (i + 0.5) / studs;
    const g = GEMS[(i * 2 + 1) % GEMS.length];
    const s = cell * 0.5;
    drawGem(ctx, g, x + 10 + t * (w - 30), y - s * 0.24, s, { glow: 0.65 });
    drawGem(ctx, g, x + 10 + t * (w - 30), y + h - s * 0.58, s, { glow: 0.65, seed: 3 });
    const g2 = GEMS[(i * 3 + 2) % GEMS.length];
    drawGem(ctx, g2, x - s * 0.3, y + 26 + t * (h - 60), s, { glow: 0.5, seed: 5 });
    drawGem(ctx, g2, x + w - s * 0.7, y + 26 + t * (h - 60), s, { glow: 0.5, seed: 7 });
  }

  /* 9) 台座右缘长出、伸进坑口的晶簇（让凹槽和场景长在一起） */
  for (let i = 0; i < 5; i++) {
    const g = GEMS[(i * 4 + 3) % GEMS.length];
    const yy = b.y + b.h * (0.12 + i * 0.19);
    crystalSpike(ctx, b.x + 3, yy + 8, cell * 1.5, cell * 0.42, g.colors.body, g.colors.glow, -1.55, 0.7);
    crystalSpike(ctx, b.x + b.w - 3, yy + 20, cell * 1.3, cell * 0.38, g.colors.body, g.colors.glow, 1.6, 0.6);
  }

  ctx.restore();
}

/** 下一块预览窗（右侧面板里的独立小凹槽） */
export function drawPreviewWell(ctx, rect, tier) {
  ctx.save();
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
  const g = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  g.addColorStop(0, '#0d0b26');
  g.addColorStop(1, mix('#150c2c', tier.tint, 0.10));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(tier.tint, 0.35);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, rect.x + rect.w / 2, rect.y + rect.h * 0.9, rect.w * 0.8, tier.tint, 0.22);
  ctx.restore();
  // 一格一个承晶凹窝（与棋坑同一套语言，不用直线网格）
  const cell = BOARD.previewCell;
  const pr = rng(hash('previewwell' + tier.name));
  const cols = Math.ceil(rect.w / cell);
  const rows = Math.ceil(rect.h / cell);
  const ox = rect.x + (rect.w - cols * cell) / 2;
  const oy = rect.y + (rect.h - rows * cell) / 2;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = ox + gx * cell + cell / 2;
      const cy = oy + gy * cell + cell / 2;
      const half = (cell / 2 - cell * 0.14) * (0.9 + pr() * 0.16);
      ctx.beginPath();
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half, cy - half * 0.34);
      ctx.lineTo(cx + half * 0.62, cy + half);
      ctx.lineTo(cx - half * 0.62, cy + half);
      ctx.lineTo(cx - half, cy - half * 0.34);
      ctx.closePath();
      const sg = ctx.createLinearGradient(cx, cy - half, cx, cy + half);
      sg.addColorStop(0, 'rgba(0,0,0,0.24)');
      sg.addColorStop(1, rgba(tier.tint, 0.075));
      ctx.fillStyle = sg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,205,255,0.05)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  // 窝沿上零星结几颗晶瘤，打破重复贴图感
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const cx = range(pr, rect.x + 8, rect.x + rect.w - 8);
    const cy = range(pr, rect.y + 8, rect.y + rect.h - 8);
    glowBlob(ctx, cx, cy, cell * 0.7, tier.tint, 0.13);
  }
  ctx.restore();
  ctx.restore();
}

export { crystalSpike, crystalCluster, gemOutline, blobPath, fillPoly };
