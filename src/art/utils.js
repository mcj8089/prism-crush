/**
 * 程序化绘制工具 —— 晶窟美术的地基
 * =====================================================================
 * 全部视觉元素都由这套函数生成「不规则刻面晶体」，禁止出现
 * 直线/圆/方块拼接的占位画风。所有函数只吃 ctx，不依赖 DOM 之外的东西，
 * 因此同一套代码既能画游戏画面，也能画分享卡片与品牌图。
 */

/* ------------------------------------------------------------------ */
/* 随机源（确定性：同一 seed 永远画出同一颗晶体）                       */
/* ------------------------------------------------------------------ */

/** mulberry32：小巧、分布够用 */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 在 [a,b) 之间取值 */
export function range(rnd, a, b) { return a + rnd() * (b - a); }

/** 字符串 → 32 位整数种子 */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* 颜色                                                                */
/* ------------------------------------------------------------------ */

export function hexToRgb(hex) {
  const s = String(hex).trim();
  if (s.startsWith('rgb')) {
    const m = s.match(/[\d.]+/g);
    if (m && m.length >= 3) return [Math.round(+m[0]), Math.round(+m[1]), Math.round(+m[2])];
    return [255, 255, 255];
  }
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 与白色混合（提亮），amount 0..1 */
export function lighten(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const m = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/** 与黑色混合（压暗） */
export function darken(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const m = (c) => Math.round(c * (1 - amount));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/** 与另一色混合 */
export function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const m = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

/* ------------------------------------------------------------------ */
/* 路径                                                                */
/* ------------------------------------------------------------------ */

/**
 * 不规则凸出的「原石轮廓」：角度带抖动、半径带 2~3 个谐波起伏，
 * 相邻顶点之间用中点二次贝塞尔平滑 —— 得到的是自然结晶轮廓，
 * 而不是正多边形/圆角矩形。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} r
 * @param {Function} rnd
 * @param {object} [opt] {verts, jitter, wobble, squash}
 */
export function crystalPath(ctx, cx, cy, r, rnd, opt = {}) {
  const verts = opt.verts || 11;
  const jitter = opt.jitter ?? 0.20;      // 角度抖动比例
  const wobble = opt.wobble ?? 0.16;      // 半径谐波幅度
  const squash = opt.squash ?? 1;         // 纵向压扁
  const phase = rnd() * Math.PI * 2;
  const h1 = 2 + Math.floor(rnd() * 2);
  const h2 = 3 + Math.floor(rnd() * 2);
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const pts = [];
  for (let i = 0; i < verts; i++) {
    const base = (i / verts) * Math.PI * 2 + phase;
    const a = base + range(rnd, -jitter, jitter) * (Math.PI / verts);
    const w =
      1 +
      Math.sin(base * h1 + p1) * wobble +
      Math.sin(base * h2 + p2) * wobble * 0.55 +
      range(rnd, -wobble * 0.5, wobble * 0.5);
    const rad = r * Math.max(0.42, w);
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * squash]);
  }
  ctx.beginPath();
  const n = pts.length;
  let mx = (pts[n - 1][0] + pts[0][0]) / 2;
  let my = (pts[n - 1][1] + pts[0][1]) / 2;
  ctx.moveTo(mx, my);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2);
  }
  ctx.closePath();
  return pts;
}

/** 在轮廓内部生成一组扇形刻面（顶点 → 内部焦点） */
export function facetSegments(pts, focus, rnd, split = 1) {
  const segs = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const reps = Math.max(1, Math.round(split));
    for (let k = 0; k < reps; k++) {
      const t0 = k / reps;
      const t1 = (k + 1) / reps;
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const f = [
        focus[0] + range(rnd, -0.06, 0.06) * 8,
        focus[1] + range(rnd, -0.06, 0.06) * 8,
      ];
      segs.push({ tri: [p0, p1, f], edge: [p0, p1] });
    }
  }
  return segs;
}

/** 圆角矩形（只用于面板/按钮的外框，内部一定有材质细节） */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  return ctx;
}

/** 多边形填充 + 描边 */
export function fillPoly(ctx, pts, fill, stroke, lineWidth) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* 光效                                                                */
/* ------------------------------------------------------------------ */

/** 径向光斑（不加到 ctx.globalCompositeOperation 上，调用方自己控制） */
export function glowBlob(ctx, x, y, r, color, alpha = 1, inner = 0) {
  const g = ctx.createRadialGradient(x, y, r * inner, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** 四角星芒 */
export function sparkle(ctx, x, y, r, color, alpha = 1, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.5, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-r * 0.09, -r, r * 0.18, r * 2);
  const g2 = ctx.createLinearGradient(-r, 0, r, 0);
  g2.addColorStop(0, rgba(color, 0));
  g2.addColorStop(0.5, rgba(color, alpha));
  g2.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g2;
  ctx.fillRect(-r, -r * 0.09, r * 2, r * 0.18);
  ctx.restore();
}

/** 线性渐变带（光柱/扫光） */
export function beam(ctx, x0, y0, x1, y1, width, color, alpha) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.5, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/** 简单 1D 值噪声（背景岩壁用），返回 0..1 */
export function valueNoise(seed) {
  const r = rng(seed);
  const table = new Float32Array(512);
  for (let i = 0; i < 512; i++) table[i] = r();
  return function n(x) {
    const i = Math.floor(x) & 511;
    const f = x - Math.floor(x);
    const a = table[i];
    const b = table[(i + 1) & 511];
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  };
}

/** 2D fbm 噪声（岩壁纹理/矿脉） */
export function fbm(noise, x, y, octaves = 4, lacunarity = 2.1, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + y * freq * 0.37 + o * 91.7);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 创建离屏画布（优先 OffscreenCanvas，回退到 img/canvas） */
export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 取离屏画布的 2D 上下文 */
export function ctx2d(canvas) {
  const c = canvas.getContext('2d');
  if (c) {
    c.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in c) c.imageSmoothingQuality = 'high';
  }
  return c;
}
