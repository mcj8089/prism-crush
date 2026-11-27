/**
 * 菜单美术 —— 主菜单的两幅程序化画面
 * =====================================================================
 * 需求红线：主界面禁止纯色/纯黑背景，禁止几何占位图形。
 * 这里复用游戏内同一套晶窟绘制（噪声岩板 + 真实晶体精灵），
 * 一次画成静态图，之后每帧只是把同一张 canvas 摆在那里，零开销。
 */

import { rgba, rng, hash, range, makeCanvas, ctx2d, glowBlob, sparkle, roundRect } from './utils.js';
import { gemOf, drawGem } from './gems.js';
import { crystalCluster, crystalSpike, blobPath, drawBackground } from './scene.js';
import { THEMES } from '../../config/game.config.js';

/** 把整张晶窟背景铺到任意画布（主菜单底图） */
export function paintCavern(canvas, tierIndex = 0) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = ctx2d(canvas);
  const tier = THEMES.tiers[Math.min(THEMES.tiers.length - 1, Math.max(0, tierIndex))];
  // alcove:false —— 菜单底图不能带那块「棋盘岩台」剪影，
  // 否则主界面背后会出现一块和按钮无关的矩形亮斑。
  drawBackground(ctx, { tier: tierIndex, cell: 32, alcove: false });

  /* 菜单专属前景：底部一道晶簇地脊 + 两团矿灯辉光，
     让主界面自己是一个洞窟场景，而不是「游戏背景拉暗当壁纸」。 */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, w * 0.12, h * 0.86, w * 0.30, tier.tint, 0.20);
  glowBlob(ctx, w * 0.88, h * 0.78, w * 0.26, '#8f6bff', 0.16);
  ctx.restore();

  const r = rng(hash('menu-ledge'));
  // 两排：后排小而密、压暗当远景；前排大而疏、贴住画面底边
  const rows = [
    { y: h * 0.885, sMin: 12, sMax: 30, gap: [26, 58], tone: 0.62, alpha: 0.42 },
    { y: h * 0.985, sMin: 26, sMax: 62, gap: [40, 96], tone: 0.16, alpha: 0.72 },
  ];
  for (const row of rows) {
    let x = -30;
    while (x < w + 30) {
      const s = range(r, row.sMin, row.sMax);
      const g = gemOf(1 + Math.floor(r() * 7));
      ctx.save();
      ctx.globalAlpha = row.alpha;
      crystalCluster(ctx, x, row.y + range(r, -8, 10), s, g,
        hash('menubed' + (x | 0) + row.y), -1, row.tone);
      ctx.restore();
      x += range(r, row.gap[0], row.gap[1]);
    }
  }

  // 飘浮碎晶：中景有东西在动，画面才不会是静止的一张图
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const fr = rng(hash('menufrags'));
  for (let i = 0; i < 46; i++) {
    const fx = range(fr, 0, w);
    const fy = range(fr, 0, h * 0.9);
    const s = range(fr, 1.6, 6.5);
    const g = gemOf(1 + Math.floor(fr() * 7));
    ctx.globalAlpha = range(fr, 0.10, 0.42);
    ctx.fillStyle = g.colors.glow;
    ctx.beginPath();
    ctx.moveTo(fx, fy - s);
    ctx.lineTo(fx + s * 0.62, fy);
    ctx.lineTo(fx, fy + s);
    ctx.lineTo(fx - s * 0.62, fy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 四周压暗 + 颗粒，把视线收回中间的按钮区
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.46, h * 0.22, w * 0.5, h * 0.5, w * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(4,3,14,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  const gr = rng(hash('menugrain'));
  for (let i = 0; i < 1100; i++) {
    ctx.globalAlpha = range(gr, 0.012, 0.05);
    ctx.fillStyle = gr() > 0.5 ? '#ffffff' : '#000000';
    ctx.fillRect(range(gr, 0, w), range(gr, 0, h), 1.6, 1.6);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * 主视觉：一坑刚被砸开的晶矿，晶体从岩缝里炸出来。
 * 全部用游戏内同一批 gemSprite / crystalCluster，不画任何占位形。
 */
export function paintHero(canvas) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = ctx2d(canvas);
  const tier = THEMES.tiers[0];
  ctx.clearRect(0, 0, W, H);

  /* 1) 洞体背景：直接复用游戏内那张晶窟背景，裁掉四周只留中段 */
  const plate = makeCanvas(1280, 720);
  drawBackground(ctx2d(plate), { tier: 0, cell: 32, alcove: false });
  const crop = { w: 1280 * 0.62, h: 720 * 0.62 };
  crop.x = (1280 - crop.w) * 0.5;
  crop.y = (720 - crop.h) * 0.30;
  ctx.drawImage(plate, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);

  /* 2) 压暗上半，给标题留字位；底部留一条晶光 */
  const veil = ctx.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, 'rgba(7,5,26,0.30)');
  veil.addColorStop(0.46, 'rgba(7,5,26,0.62)');
  veil.addColorStop(1, 'rgba(7,5,26,0.10)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glowBlob(ctx, W * 0.72, H * 0.86, W * 0.42, tier.tint, 0.30);
  glowBlob(ctx, W * 0.18, H * 0.78, W * 0.30, '#8f6bff', 0.20);
  ctx.restore();

  /* 3) 底部岩脊：不规则的碎石剪影，晶体从它后面长出来。
        轮廓用「大起伏 + 小台阶 + 平滑」三层叠加，避免锯齿像尺子画的。 */
  const rr = rng(hash('hero-ledge'));
  const ridge = [];
  const baseY = H * 0.80;
  let x = -20;
  let step = 0;
  while (x < W + 20) {
    const swell = Math.sin((x / W) * Math.PI * 2.1 + 0.7) * H * 0.055
      + Math.sin((x / W) * Math.PI * 5.3) * H * 0.022;
    const y = baseY + swell + range(rr, -H * 0.022, H * 0.022);
    ridge.push([x, y]);
    step++;
    x += range(rr, 16, 40);
  }
  // 二次中点位移，把折线揉成岩石的钝角
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let i = 0; i < ridge.length; i++) {
      const a0 = ridge[i];
      const b0 = ridge[(i + 1) % ridge.length];
      out.push(a0);
      out.push([(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2 + range(rr, -3, 3)]);
    }
    ridge.length = 0;
    ridge.push(...out);
  }
  void step;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-20, H + 20);
  ctx.lineTo(ridge[0][0], ridge[0][1]);
  for (let i = 1; i < ridge.length - 1; i++) {
    const mid = [(ridge[i][0] + ridge[i + 1][0]) / 2, (ridge[i][1] + ridge[i + 1][1]) / 2];
    ctx.quadraticCurveTo(ridge[i][0], ridge[i][1], mid[0], mid[1]);
  }
  ctx.lineTo(W + 20, H + 20);
  ctx.closePath();
  const ledge = ctx.createLinearGradient(0, H * 0.6, 0, H);
  ledge.addColorStop(0, '#4a4270');
  ledge.addColorStop(0.4, '#2b2450');
  ledge.addColorStop(1, '#120e2a');
  ctx.fillStyle = ledge;
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,3,14,0.85)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // 脊线受光：沿轮廓再描一道偏冷的亮边
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ridge[0][0], ridge[0][1]);
  for (let i = 1; i < ridge.length - 1; i++) {
    const mid = [(ridge[i][0] + ridge[i + 1][0]) / 2, (ridge[i][1] + ridge[i + 1][1]) / 2];
    ctx.quadraticCurveTo(ridge[i][0], ridge[i][1], mid[0], mid[1]);
  }
  ctx.strokeStyle = 'rgba(198,214,255,0.30)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  ctx.clip();
  for (let i = 0; i < 160; i++) {
    const px = range(rr, 0, W);
    const py = range(rr, H * 0.6, H);
    ctx.globalAlpha = range(rr, 0.06, 0.24);
    ctx.fillStyle = rr() > 0.5 ? '#ded9f5' : '#0b0920';
    blobPath(ctx, px, py, range(rr, 2, 7), range(rr, 2, 6), rr, 5, 0.4);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  /* 4) 一丛丛真实晶体从岩脊上长出来（scale 是尖晶长度，按画面高度给） */
  const beds = [
    { x: 0.08, s: 1.00, g: 1, k: 3, back: 1 },
    { x: 0.24, s: 0.72, g: 6, k: 4, back: 1 },
    { x: 0.40, s: 1.10, g: 4, k: 5, back: 1 },
    { x: 0.58, s: 0.80, g: 2, k: 6, back: 1 },
    { x: 0.74, s: 1.05, g: 7, k: 7, back: 1 },
    { x: 0.90, s: 0.70, g: 3, k: 8, back: 1 },
    { x: 0.16, s: 0.62, g: 5, k: 9, back: 0 },
    { x: 0.50, s: 0.55, g: 3, k: 10, back: 0 },
    { x: 0.83, s: 0.60, g: 1, k: 11, back: 0 },
  ];
  for (const bed of beds) {
    if (!bed.back) continue;
    crystalCluster(ctx, W * bed.x, H * 0.845, bed.s * H * 0.13, gemOf(bed.g), hash('herocluster' + bed.k), -1, 0.34);
  }

  for (const bed of beds) {
    if (bed.back) continue;
    crystalCluster(ctx, W * bed.x, H * 0.90, bed.s * H * 0.13, gemOf(bed.g), hash('herocluster' + bed.k), -1, 0);
  }

  /* 5) 三颗主角晶体：刚被砸开、悬在半空，各自不同的切工 */
  const heroes = [
    { x: 0.66, y: 0.40, size: H * 0.30, gem: 5, rot: -0.22, seed: 1 },
    { x: 0.34, y: 0.52, size: H * 0.22, gem: 3, rot: 0.30, seed: 2 },
    { x: 0.50, y: 0.30, size: H * 0.16, gem: 7, rot: -0.05, seed: 3 },
  ];
  for (const hd of heroes) {
    const gem = gemOf(hd.gem);
    ctx.save();
    ctx.translate(W * hd.x, H * hd.y);
    ctx.rotate(hd.rot);
    ctx.globalCompositeOperation = 'lighter';
    glowBlob(ctx, 0, 0, hd.size * 1.25, gem.colors.glow, 0.34);
    ctx.globalCompositeOperation = 'source-over';
    drawGem(ctx, gem, -hd.size / 2, -hd.size / 2, hd.size, { glow: 0.8, seed: hd.seed });
    ctx.restore();
  }

  /* 6) 飞溅的碎晶 + 星芒：让画面停在「刚砸下去」的那一帧 */
  const fr = rng(hash('herofragments'));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const a = range(fr, -Math.PI, 0);
    const rad = range(fr, 40, H * 0.55);
    const px = W * 0.66 + Math.cos(a) * rad * 1.5;
    const py = H * 0.40 + Math.sin(a) * rad;
    const s = range(fr, 4, 13);
    if (px < 4 || px > W - 4 || py < 4) continue;
    drawGem(ctx, gemOf(1 + Math.floor(fr() * 7)), px - s / 2, py - s / 2, s, { glow: 0.5, seed: Math.floor(fr() * 4) });
  }
  ctx.restore();
  sparkle(ctx, W * 0.66, H * 0.34, 34, '#ffffff', 0.85, 0.3);
  sparkle(ctx, W * 0.35, H * 0.48, 22, '#ffffff', 0.7, 1.1);
  sparkle(ctx, W * 0.86, H * 0.24, 16, '#bfe9ff', 0.6, 2.0);

  /* 7) 四周压角 + 颗粒，和主场景同一套收尾 */
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(4,3,14,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  const gr = rng(hash('herograins'));
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = rgba(gr() > 0.5 ? '#ffffff' : '#000000', range(gr, 0.01, 0.05));
    ctx.fillRect(gr() * W, gr() * H, 1, 1);
  }
  void roundRect;
  return canvas;
}

/** 把一颗晶体导出成 dataURL，供 CSS 装饰位（原本用 clip-path 剪影）当背景图 */
export function gemDataUrl(typeId, size = 64, seed = 0, glow = 0) {
  // 必须是 DOM canvas：OffscreenCanvas 没有 toDataURL
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  drawGem(ctx2d(cv), gemOf(typeId), 0, 0, size, { glow, seed });
  try { return cv.toDataURL('image/png'); } catch (e) { return ''; }
}

/**
 * 全站装饰晶体：把 index.html / styles.css 里用 clip-path 多边形剪出来的
 * 假宝石（结算皇冠、进度头、能量籽、广告转符）换成真实晶体精灵。
 * 需求红线：UI 不允许出现基础几何拼凑。
 */
export function decorateUiGems(root = document) {
  const put = (el, typeId, seed, size = 72) => {
    if (!el) return;
    const url = gemDataUrl(typeId, size, seed);
    if (!url) return;
    el.classList.add('is-real-gem');
    el.style.backgroundImage = `url(${url})`;
  };
  const q = (sel) => root.querySelectorAll(sel);
  q('.result-crown i').forEach((el, i) => put(el, [4, 2, 3][i % 3], i + 1));
  q('.head-gem').forEach((el) => put(el, 7, 0, 96));
  q('.gauge-seeds .seed').forEach((el, i) => put(el, 1 + (i % 7), i, 48));
  q('.sdk-ad-inner').forEach((el) => el.classList.add('has-real-gem'));
  return true;
}

/**
 * 一枚真实晶体精灵画进小画布（替换掉 CSS 剪影占位的小装饰）。
 * glow 必须为 0：外发光的 alpha 会铺满整张画布，CSS drop-shadow
 * 就会把「发光轮廓」当成剪影投出一块方形暗影。
 */
export function paintGemCanvas(canvas, typeId, seed = 0) {
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const size = Math.min(canvas.width, canvas.height);
  drawGem(ctx, gemOf(typeId), size * 0.04, size * 0.04, size * 0.92, { glow: 0, seed });
  return canvas;
}
