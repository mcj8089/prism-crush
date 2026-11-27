/**
 * 晶体块精灵 —— 7 种宝石，7 种完全不同的切工轮廓
 * =====================================================================
 * 这是「美术重构」的核心文件：原作是 7 个纯色方形色块，这里全部推倒重做，
 * 每颗晶体都有独立剪影（晶簇 / 原石 / 台地晶 / 风筝尖晶 / 玫瑰切 / 长柱晶 /
 * 蛋面），并用「底色渐变 + 扇形刻面受光 + 内散射 + 裂生纹 + 轮缘光 + 高光星芒」
 * 六层材质叠出体积感。禁止任何方形/圆形贴图拼贴。
 *
 * 所有绘制都是纯函数 + 离屏缓存，同一 seed 结果恒定（便于截图回归）。
 */

import { GEMS } from '../../config/game.config.js';
import {
  rng, hash, range, rgba, lighten, darken, mix,
  crystalPath, facetSegments, roundRect, glowBlob, sparkle,
  makeCanvas, ctx2d,
} from './utils.js';

/** 光源方向（左上 45°），所有刻面受光都以此计算 */
const LIGHT = (() => {
  const a = (-2.35);
  return [Math.cos(a), Math.sin(a)];
})();

/* ------------------------------------------------------------------ */
/* 轮廓生成：返回归一化顶点（-0.5..0.5），再按尺寸放大                  */
/* ------------------------------------------------------------------ */

/** 顶点抖动（让规则多边形变成天然晶体） */
function jitterPts(pts, r, amount) {
  const [jx, jy] = r;
  return pts.map(([x, y]) => [x + (jx - 0.5) * amount, y + (jy - 0.5) * amount]);
}

/** 归一化轮廓 → 像素顶点（含抖动与可选二次平滑） */
function buildOutline(base, style, size, seedSalt) {
  const r = rng(hash(base === CUTS.cluster ? 'cluster' : 'cut') + seedSalt);
  const half = size / 2;
  const pts = base.map(([x, y]) => {
    const [j] = jitterPts([[x, y]], [r(), r()], style.jitter * 2);
    return [half + j[0] * half, half + j[1] * half];
  });
  const s = style.smooth;
  if (s <= 0) return pts;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    return [
      p[0] * (1 - s) + ((prev[0] + next[0]) / 2) * s,
      p[1] * (1 - s) + ((prev[1] + next[1]) / 2) * s,
    ];
  });
}

/** 各切工的归一化轮廓（单位方块 -0.5..0.5，y 向下） */
const CUTS = {
  /** 晶簇：平底 + 三座尖峰 */
  cluster: [
    [-0.46, 0.48], [-0.50, 0.10], [-0.38, -0.14], [-0.30, -0.46],
    [-0.20, -0.10], [-0.06, -0.52], [0.06, -0.12], [0.20, -0.44],
    [0.32, -0.08], [0.46, -0.20], [0.50, 0.16], [0.42, 0.48],
  ],
  /** 原石：不规则块状，保留粗糙断面 */
  brute: [
    [-0.44, -0.28], [-0.16, -0.50], [0.22, -0.44], [0.46, -0.18],
    [0.50, 0.16], [0.30, 0.48], [-0.10, 0.50], [-0.42, 0.32], [-0.50, 0.02],
  ],
  /** 台地晶：宽平顶 + 阶梯侧壁 */
  table: [
    [-0.30, -0.50], [0.30, -0.50], [0.44, -0.24], [0.50, 0.10],
    [0.36, 0.48], [-0.34, 0.48], [-0.50, 0.12], [-0.44, -0.22],
  ],
  /** 风筝尖晶：上下双尖 */
  kite: [
    [0.00, -0.52], [0.28, -0.30], [0.46, 0.02], [0.26, 0.36],
    [0.00, 0.52], [-0.28, 0.34], [-0.46, 0.00], [-0.26, -0.32],
  ],
  /** 玫瑰切：圆拱顶 + 多面底 */
  rose: [
    [-0.48, 0.14], [-0.40, -0.18], [-0.20, -0.40], [0.04, -0.48],
    [0.28, -0.38], [0.44, -0.14], [0.48, 0.16], [0.30, 0.44],
    [-0.02, 0.50], [-0.32, 0.42],
  ],
  /** 长柱晶：六棱柱，纵向拉伸 */
  shard: [
    [-0.16, -0.52], [0.14, -0.48], [0.30, -0.22], [0.28, 0.20],
    [0.38, 0.44], [0.00, 0.52], [-0.34, 0.42], [-0.26, 0.14],
    [-0.32, -0.24],
  ],
  /** 蛋面：光滑穹顶 + 底缘刻面 */
  cabochon: [
    [-0.46, 0.26], [-0.34, -0.12], [-0.10, -0.36], [0.16, -0.36],
    [0.38, -0.10], [0.46, 0.26], [0.30, 0.48], [-0.04, 0.52], [-0.30, 0.46],
  ],
};

/** 每颗宝石的顶点抖动量与平滑度（越大越圆润） */
const CUT_STYLE = {
  cluster: { jitter: 0.075, smooth: 0.0, facetSplit: 1, core: 0.30 },
  brute: { jitter: 0.10, smooth: 0.18, facetSplit: 1, core: 0.34 },
  table: { jitter: 0.06, smooth: 0.10, facetSplit: 2, core: 0.26 },
  kite: { jitter: 0.055, smooth: 0.0, facetSplit: 1, core: 0.22 },
  rose: { jitter: 0.05, smooth: 0.62, facetSplit: 1, core: 0.36 },
  shard: { jitter: 0.07, smooth: 0.12, facetSplit: 1, core: 0.28 },
  cabochon: { jitter: 0.045, smooth: 0.80, facetSplit: 1, core: 0.40 },
};

/**
 * 生成某颗宝石的轮廓顶点（像素坐标，原点左上，范围 0..size）。
 * @param {object} gem GEMS 条目
 * @param {number} size 边长
 * @param {number} [seedSalt] 变体种子（同一颗宝石派生略微不同的晶体）
 */
export function gemOutline(gem, size, seedSalt = 0) {
  const style = CUT_STYLE[gem.cut] || CUT_STYLE.brute;
  const base = CUTS[gem.cut] || CUTS.brute;
  return buildOutline(base, style, size, hash(gem.key) + seedSalt * 31);
}

/** 把顶点列表描成路径 */
function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** 质心 */
function centroid(pts) {
  let x = 0; let y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/* ------------------------------------------------------------------ */
/* 主体绘制                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把一颗晶体画进 ctx（不缓存，供精灵表与粒子共用）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} gem
 * @param {number} x @param {number} y @param {number} size
 * @param {object} [opt] {glow:0..1, tint:string, alpha:number, seed:number}
 */
export function drawGem(ctx, gem, x, y, size, opt = {}) {
  const style = CUT_STYLE[gem.cut] || CUT_STYLE.brute;
  const alpha = opt.alpha ?? 1;
  const c = gem.colors;
  const seedBase = (opt.seed || 0) * 977 + hash(gem.key);

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;

  const pts = gemOutline(gem, size, opt.seed || 0);

  const cen = centroid(pts);
  const rr = rng(seedBase + 7);

  /* 1) 外发光（晶体自发光溢出） */
  if (opt.glow !== 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowBlob(ctx, cen[0], cen[1], size * 0.78, c.glow, 0.30 * (opt.glow ?? 1));
    ctx.restore();
  }

  /* 2) 贴底暗部：压在晶体自身轮廓内，避免堆叠时出现一排悬空椭圆 */
  ctx.save();
  tracePath(ctx, pts);
  ctx.clip();
  const ao = ctx.createLinearGradient(0, cen[1], 0, size);
  ao.addColorStop(0, 'rgba(2,4,14,0)');
  ao.addColorStop(1, 'rgba(2,4,14,0.30)');
  ctx.fillStyle = ao;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  /* 3) 底色：沿光向的三段渐变 */
  tracePath(ctx, pts);
  ctx.save();
  ctx.clip();
  const bodyGrad = ctx.createLinearGradient(
    cen[0] + LIGHT[0] * size * 0.6, cen[1] + LIGHT[1] * size * 0.6,
    cen[0] - LIGHT[0] * size * 0.6, cen[1] - LIGHT[1] * size * 0.6
  );
  bodyGrad.addColorStop(0, lighten(c.bright, 0.25));
  bodyGrad.addColorStop(0.35, c.body);
  bodyGrad.addColorStop(0.78, mix(c.body, c.deep, 0.55));
  bodyGrad.addColorStop(1, c.deep);
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(-size, -size, size * 3, size * 3);

  /* 4) 扇形刻面：按法线与光向的点积决定明暗 */
  const segs = facetSegments(pts, cen, rr, style.facetSplit);
  for (const seg of segs) {
    const [p0, p1, f] = seg.tri;
    const mx = (p0[0] + p1[0] + f[0]) / 3;
    const my = (p0[1] + p1[1] + f[1]) / 3;
    let nx = mx - cen[0];
    let ny = my - cen[1];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const d = nx * LIGHT[0] + ny * LIGHT[1];          // -1..1
    const t = (d + 1) / 2;
    const shade = darken(c.deep, 0.15);
    const lit = lighten(c.bright, 0.35);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(f[0], f[1]);
    ctx.closePath();
    const fg = ctx.createLinearGradient(p0[0], p0[1], f[0], f[1]);
    fg.addColorStop(0, t > 0.5 ? lit : mix(shade, c.body, t * 1.2));
    fg.addColorStop(1, t > 0.5 ? mix(c.body, lit, 0.25) : mix(shade, c.deep, 0.5));
    ctx.globalAlpha = alpha * (0.30 + 0.42 * t);
    ctx.fillStyle = fg;
    ctx.fill();
    // 刻面棱线
    ctx.globalAlpha = alpha * (0.10 + 0.30 * t);
    ctx.strokeStyle = t > 0.55 ? c.rim : c.deep;
    ctx.lineWidth = Math.max(0.6, size * 0.018);
    ctx.beginPath();
    ctx.moveTo(f[0], f[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  /* 5) 内散射核心：中心一团通透的光 */
  const core = ctx.createRadialGradient(
    cen[0] - size * 0.10, cen[1] - size * 0.14, size * 0.02,
    cen[0], cen[1], size * style.core * 1.6
  );
  core.addColorStop(0, rgba(c.rim, 0.75));
  core.addColorStop(0.4, rgba(c.glow, 0.34));
  core.addColorStop(1, rgba(c.glow, 0));
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = core;
  ctx.fillRect(-size, -size, size * 3, size * 3);
  ctx.globalCompositeOperation = 'source-over';

  /* 6) 裂生纹（内含裂隙，晶体特有的"不完美"） */
  const cracks = 2 + Math.floor(rr() * 3);
  for (let i = 0; i < cracks; i++) {
    const a0 = rr() * Math.PI * 2;
    const r0 = size * range(rr, 0.05, 0.20);
    const px = cen[0] + Math.cos(a0) * r0;
    const py = cen[1] + Math.sin(a0) * r0;
    ctx.beginPath();
    ctx.moveTo(px, py);
    let cxp = px;
    let cyp = py;
    for (let k = 0; k < 3; k++) {
      cxp += Math.cos(a0 + range(rr, -0.7, 0.7)) * size * 0.11;
      cyp += Math.sin(a0 + range(rr, -0.7, 0.7)) * size * 0.11;
      ctx.lineTo(cxp, cyp);
    }
    ctx.strokeStyle = rgba(c.rim, 0.20 + rr() * 0.18);
    ctx.lineWidth = Math.max(0.5, size * 0.014);
    ctx.stroke();
  }

  /* 7) 底部焦散：从晶体底部透出去的光斑 */
  const caustic = ctx.createLinearGradient(0, size * 0.4, 0, size);
  caustic.addColorStop(0, rgba(c.glow, 0));
  caustic.addColorStop(1, rgba(c.glow, 0.30));
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = caustic;
  ctx.fillRect(0, size * 0.4, size, size * 0.6);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore(); // 解除 clip

  /* 8) 外轮廓硬边（深色）+ 轮缘光：左上亮边 + 右下暗边 */
  tracePath(ctx, pts);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(4,3,16,0.6)';
  ctx.lineWidth = Math.max(1, size * 0.038);
  ctx.stroke();
  tracePath(ctx, pts);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(c.rim, 0.85);
  ctx.lineWidth = Math.max(1, size * 0.045);
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.strokeStyle = rgba(c.rim, 0.55);
  ctx.stroke();
  ctx.restore();

  /* 9) 台面：靠光一侧的一块平整大刻面，让晶体有"切过"的硬边 */
  const ta = pts.reduce((best, p, i) => {
    const d = (p[0] - cen[0]) * LIGHT[0] + (p[1] - cen[1]) * LIGHT[1];
    return d > best.d ? { d, i } : best;
  }, { d: -1e9, i: 0 });
  const pA = pts[ta.i];
  const pB = pts[(ta.i + 1) % pts.length];
  const pH = pts[(ta.i + pts.length - 1) % pts.length];
  const inner = (p, k) => [cen[0] + (p[0] - cen[0]) * k, cen[1] + (p[1] - cen[1]) * k];
  ctx.save();
  tracePath(ctx, pts);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(pA[0], pA[1]);
  ctx.lineTo(pB[0], pB[1]);
  ctx.lineTo(...inner(pB, 0.42));
  ctx.lineTo(...inner(pA, 0.36));
  ctx.closePath();
  const tg = ctx.createLinearGradient(pA[0], pA[1], cen[0], cen[1]);
  tg.addColorStop(0, rgba(c.rim, 0.55));
  tg.addColorStop(1, rgba(c.bright, 0.10));
  ctx.fillStyle = tg;
  ctx.fill();
  ctx.strokeStyle = rgba(c.rim, 0.5);
  ctx.lineWidth = Math.max(0.6, size * 0.02);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pH[0], pH[1]);
  ctx.lineTo(...inner(pH, 0.4));
  ctx.lineTo(...inner(pA, 0.36));
  ctx.closePath();
  ctx.fillStyle = rgba(c.deep, 0.35);
  ctx.fill();
  ctx.restore();

  /* 10) 高光：靠光源一侧的一枚小亮斑 + 细星芒（星芒必须小于晶体本身） */
  const hx = cen[0] + LIGHT[0] * size * 0.22;
  const hy = cen[1] + LIGHT[1] * size * 0.22;
  ctx.save();
  tracePath(ctx, pts);
  ctx.clip();
  glowBlob(ctx, hx, hy, size * 0.17, '#ffffff', 0.45, 0.1);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  sparkle(ctx, hx, hy, size * 0.13, '#ffffff', 0.55, 0.4);
  sparkle(ctx, cen[0] + size * 0.15, cen[1] + size * 0.17, size * 0.06, c.rim, 0.4, 1.1);
  ctx.restore();

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 精灵缓存                                                            */
/* ------------------------------------------------------------------ */

const CACHE = new Map();

/**
 * 取某颗宝石在指定尺寸下的精灵画布（带缓存）。
 * @param {object} gem
 * @param {number} size
 * @param {object} [opt]
 */
export function gemSprite(gem, size, opt = {}) {
  const key = `${gem.id}|${size}|${opt.seed || 0}|${opt.glow === 0 ? 0 : 1}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const pad = Math.ceil(size * 0.14);           // 给外发光留边
  const total = Math.ceil(size + pad * 2);
  const cv = makeCanvas(total, total);
  const ctx = ctx2d(cv);
  drawGem(ctx, gem, pad, pad, size, opt);
  const entry = { canvas: cv, ctx, pad, size };
  CACHE.set(key, entry);
  return entry;
}

/**
 * 幽灵落点：一格「空晶窝」。
 * 这里刻意不用 gemOutline —— 有些切工本身就是星形，缩成落点后会画成一朵花，
 * 反而读不出「这块要落在这格」。改用与堆体晶座同源的八边形窝 + 内刻面。
 */
export function ghostSprite(gem, size) {
  const key = `ghost|${gem.id}|${size}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const cv = makeCanvas(size, size);
  const ctx = ctx2d(cv);
  const c = size / 2;
  const k = size * 0.70;
  const a = size * 0.44;
  const b = size * 0.20;
  const oct = [
    [c - b, c - a], [c + b, c - a], [c + a, c - b], [c + a, c + b],
    [c + b, c + a], [c - b, c + a], [c - a, c + b], [c - a, c - b],
  ];
  const scale = (p, s) => [c + (p[0] - c) * s, c + (p[1] - c) * s];

  tracePath(ctx, oct);
  const fill = ctx.createLinearGradient(0, 0, 0, size);
  fill.addColorStop(0, rgba(gem.colors.glow, 0.30));
  fill.addColorStop(1, rgba(gem.colors.deep, 0.14));
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.strokeStyle = rgba(gem.colors.rim, 0.52);
  ctx.stroke();
  tracePath(ctx, oct.map((p) => scale(p, 0.62)));
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.strokeStyle = rgba(gem.colors.rim, 0.24);
  ctx.stroke();
  // 窝底一点反光，避免变成一块扁平色片
  ctx.save();
  tracePath(ctx, oct);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, c, k, size * 0.34, gem.colors.glow, 0.22);
  ctx.restore();

  const entry = { canvas: cv, ctx, pad: 0, size };
  CACHE.set(key, entry);
  return entry;
}

/** 碎片精灵：消行爆炸时飞出的小晶块（每种宝石 6 个变体） */
const CHUNK_VARIANTS = 6;
const CHUNK_CACHE = new Map();

export function chunkSprites(gem, size) {
  const key = `chunk|${gem.id}|${size}`;
  if (CHUNK_CACHE.has(key)) return CHUNK_CACHE.get(key);
  const list = [];
  for (let i = 0; i < CHUNK_VARIANTS; i++) {
    const cv = makeCanvas(size, size);
    const ctx = ctx2d(cv);
    const r = rng(hash(gem.key) + i * 131);
    const pts = [];
    const n = 5 + Math.floor(r() * 3);            // 5~7 边：有棱有面的碎晶块，不是三角旗
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + range(r, -0.35, 0.35);
      const rad = size * 0.5 * range(r, 0.52, 1.0);
      pts.push([size / 2 + Math.cos(a) * rad, size / 2 + Math.sin(a) * rad]);
    }
    ctx.save();
    tracePath(ctx, pts);
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, lighten(gem.colors.bright, 0.3));
    g.addColorStop(0.55, gem.colors.body);
    g.addColorStop(1, gem.colors.deep);
    ctx.fillStyle = g;
    ctx.fill();
    // 断口：一半面积压暗，碎片才有「刚崩下来」的体块
    const [cX, cY] = centroid(pts);
    ctx.save();
    tracePath(ctx, pts);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < n; k += 2) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.lineTo(cX + size, cY + size);
    ctx.lineTo(cX - size, cY + size);
    ctx.closePath();
    ctx.fillStyle = rgba(gem.colors.deep, 0.55);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = rgba(gem.colors.rim, 0.85);
    ctx.lineWidth = Math.max(0.8, size * 0.055);
    tracePath(ctx, pts);
    ctx.stroke();
    // 碎片上的两道亮棱
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.moveTo(pts[k][0], pts[k][1]);
      ctx.lineTo(cX + (cX - pts[k][0]) * 0.15, cY + (cY - pts[k][1]) * 0.15);
      ctx.strokeStyle = rgba(gem.colors.rim, 0.7 - k * 0.25);
      ctx.lineWidth = Math.max(0.6, size * (0.05 - k * 0.015));
      ctx.stroke();
    }
    ctx.restore();
    list.push(cv);
  }
  CHUNK_CACHE.set(key, list);
  return list;
}

/** 按 blockType（1..7）取宝石定义，越界时安全回退 */
export function gemOf(type) {
  return GEMS[((Math.max(1, type | 0) - 1) % GEMS.length)] || GEMS[0];
}

/** 供 UI 复用：把一颗宝石画进任意 ctx（面板装饰、分享卡片） */
export { roundRect, glowBlob, sparkle };
