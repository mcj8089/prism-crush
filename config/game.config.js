/**
 * PRISM CRUSH · 水晶方块 · 全局游戏配置
 * =====================================================================
 * 所有可调参数集中在这里：画面尺寸、棋盘规格、原作节奏、宝石配色、
 * 特效强度、资源清单。改游戏手感/美术/音量都不需要动 src/ 里的代码。
 *
 * ⚠ 玩法红线：RULES / GEMS / SHAPES / LEVELS 里的数值 1:1 来自原作
 *   （13×20 棋盘、30px 逻辑格、1000ms 初速、lines²×10 计分、2^i×100 升级）。
 *   只允许改表现层，不允许改判定。
 * =====================================================================
 */

/* ------------------------------------------------------------------ */
/* 舞台与棋盘                                                          */
/* ------------------------------------------------------------------ */

/** 逻辑舞台（16:9 横屏，等比缩放适配任意窗口） */
export const STAGE = { w: 1280, h: 720 };

/**
 * 棋盘规格。
 * rows/cols/speed 直接继承原作 config.js（rows:20, cols:13, speed:1000）。
 * cell 是「逻辑像素」：原作 30px/格 → 390×600 的棋盘在 1280×720 里偏小，
 * 因此按 1.6 倍绘制（48px/格 → 624×960），判定坐标系完全不变。
 */
export const BOARD = {
  rows: 20,
  cols: 13,
  /** 1280×720 舞台：20 行留出上下岩台边框后单格上限 32px */
  cell: 32,
  /** 下一块预览格径（原作 20px，同比放大） */
  previewCell: 26,
  /** 棋盘中心相对舞台中心的水平偏移（左移，右侧留给信息面板一列） */
  offsetX: -70,
};

/* ------------------------------------------------------------------ */
/* 玩法节奏（锁定，勿改）                                               */
/* ------------------------------------------------------------------ */

export const RULES = {
  /** 原作 constSpeed：1 级时下落一格 1000ms */
  constSpeed: 1000,
  /** 原作随机数生成器（含它的边界写法，保证形状/配色分布与原作一致） */
  randomStyle: 'original',
  /** 消行得分：lines * 10 * lines（原作公式） */
  scorePerLine: 10,
  /** 最高分存档 key（localStorage） */
  highScoreKey: 'high-score',
  /** 是否允许第 0 行被消除（原作 `if (filled && y)` 的既有行为） */
  clearTopRow: false,
  /** 旋转时是否做踢墙（原作没有做，保持 false） */
  wallKick: false,
  /** 硬降（原作没有这个操作，保持 false，避免改变爽点） */
  hardDrop: false,
};

/* ------------------------------------------------------------------ */
/* 7 种宝石（功能等价于原作 blocks.png 的 7 个色块，造型全部原创）      */
/* ------------------------------------------------------------------ */

/**
 * 每个宝石是一套配色 + 一个刻面拓扑种子。
 * - hue：程序化着色主色相（0-360）
 * - facets：刻面数量（决定晶体轮廓的顶点数，全部为不规则多面体，
 *   禁止正方形/圆形等基础几何拼贴）
 * - cut：晶体切工风格，决定 src/art/gems.js 用哪套轮廓生成器
 *   'cluster' 晶簇 / 'brute' 原石 / 'table' 台地晶 / 'kite' 风筝尖晶
 *   'rose' 玫瑰切 / 'shard' 长柱晶 / 'cabochon' 蛋面
 */
export const GEMS = [
  {
    id: 1, key: 'verdant', nameEn: 'Verdant Prism', nameZh: '翠晶',
    hue: 142, sat: 0.72, facets: 11, cut: 'cluster',
    colors: { deep: '#07361f', body: '#18a45e', bright: '#7df3a8', glow: '#3dffa0', rim: '#d8fff0' },
  },
  {
    id: 2, key: 'solar', nameEn: 'Solar Citrine', nameZh: '阳辉晶',
    hue: 48, sat: 0.80, facets: 9, cut: 'table',
    colors: { deep: '#4a2c00', body: '#e0a416', bright: '#ffe081', glow: '#ffc93c', rim: '#fff6d2' },
  },
  {
    id: 3, key: 'ember', nameEn: 'Ember Spinel', nameZh: '焰晶',
    hue: 352, sat: 0.78, facets: 12, cut: 'kite',
    colors: { deep: '#4b0417', body: '#d42a4e', bright: '#ff8fa3', glow: '#ff4567', rim: '#ffe3ea' },
  },
  {
    id: 4, key: 'amethyst', nameEn: 'Void Amethyst', nameZh: '幽紫晶',
    hue: 278, sat: 0.74, facets: 10, cut: 'rose',
    colors: { deep: '#25063f', body: '#8a34cc', bright: '#dc9dff', glow: '#b45cff', rim: '#f4e2ff' },
  },
  {
    id: 5, key: 'cinder', nameEn: 'Cinder Topaz', nameZh: '熔金晶',
    hue: 24, sat: 0.85, facets: 8, cut: 'brute',
    colors: { deep: '#4a1c02', body: '#e07417', bright: '#ffb871', glow: '#ff8a1e', rim: '#ffe9d0' },
  },
  {
    id: 6, key: 'azure', nameEn: 'Deep Azure', nameZh: '沧澜晶',
    hue: 217, sat: 0.76, facets: 13, cut: 'shard',
    colors: { deep: '#041f4d', body: '#1f66d0', bright: '#7fbcff', glow: '#3b8dff', rim: '#e0efff' },
  },
  {
    id: 7, key: 'frost', nameEn: 'Aqua Frost', nameZh: '霜蓝晶',
    hue: 181, sat: 0.70, facets: 10, cut: 'cabochon',
    colors: { deep: '#03383f', body: '#17b0bd', bright: '#8ff6ff', glow: '#2ff0ff', rim: '#e2ffff' },
  },
];

/**
 * 10 种下落造型 —— 与原作 Shape.js 的 shapebLayouts 数组逐格一致。
 * （原作就是 10 种非标准四/五格形，属于核心判定，禁止增删。）
 */
export const SHAPES = [
  [[0, 1, 0], [1, 1, 1]],
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1], [1, 1], [1, 0]],
  [[1, 0], [1, 1], [0, 1]],
  [[1, 0, 1], [1, 1, 1]],
  [[0, 1], [1, 1]],
  [[1, 1]],
  [[1, 1], [1, 0], [1, 0]],
  [[1, 1], [0, 1], [0, 1]],
];

/* ------------------------------------------------------------------ */
/* 等级与速度曲线（见 config/levels.js，这里只做引用）                  */
/* ------------------------------------------------------------------ */

export { LEVELS, LEVEL_COUNT, levelForScore, speedForLevel } from './levels.js';

/* ------------------------------------------------------------------ */
/* 表现层：特效、震屏、光效（优先级 5：炫酷爆炸 + 砸砖反馈）             */
/* ------------------------------------------------------------------ */

export const FX = {
  /** 消行爆炸 */
  shatter: {
    chunksPerCell: 14,      // 每格炸出的晶体碎片数
    chunkLifeMs: 900,
    chunkGravity: 1500,
    spinMax: 12,
    glowLifeMs: 520,
    beamLifeMs: 460,        // 横扫光带
    dustPerCell: 6,         // 晶尘
  },
  /** 屏幕震动 */
  shake: {
    perLine: 4.2,           // 每消 1 行的振幅（px）
    max: 22,
    decay: 0.86,
    rumbleMs: 260,
  },
  /** 落地反馈 */
  land: {
    squash: 0.14,           // 挤压幅度
    timeMs: 150,
    dust: 5,
    rippleMs: 380,
    minSpeed: 0.35,         // 下落速度达到多少才播落地音
  },
  /** 升级演出 */
  levelUp: {
    flashMs: 420,
    bannerMs: 1900,         // 原作是 alert 暂停，这里改为非阻塞横幅（引导优化）
    burstRings: 3,
  },
  /** 常驻氛围 */
  ambient: {
    motes: 46,              // 漂浮晶尘
    shafts: 4,              // 顶部光柱
    veins: 9,               // 背景矿脉辉光
    geodePulseMs: 3200,
  },
  /** 消行时的行高亮扫描 */
  rowFlashMs: 260,
  /** 幽灵落点（新增表现层辅助，不改变任何判定） */
  ghost: { enabled: true, alpha: 0.3 },
};

/** 渲染细节开关 */
export const RENDER = {
  cellGap: 0.06,            // 晶体之间的留缝（相对格径），让每块像独立矿石
  gridAlpha: 0.16,          // 网格暗纹透明度（原作是绿色描边，这里改为晶脉暗纹）
  innerShadow: true,
  bloom: true,
  vignette: 0.55,
  dprMax: 2,
};

/* ------------------------------------------------------------------ */
/* 音量与音频                                                           */
/* ------------------------------------------------------------------ */

export const AUDIO = {
  master: 0.9,
  bgm: 0.42,
  sfx: 0.8,
  defaultEnabled: true,
};

/* ------------------------------------------------------------------ */
/* 资源清单                                                             */
/* ------------------------------------------------------------------ */

export const ASSETS = {
  images: {
    keyart: 'assets/images/keyart.jpg',
    ogCover: 'assets/images/og-cover.jpg',
    logo: 'assets/images/logo.png',
    thumbnail: 'assets/images/thumbnail.png',
    favicon: 'assets/images/favicon.png',
    appIcon: 'assets/images/app-icon.png',
    gameplay: 'assets/images/gameplay.gif',
    screenshots: [
      'assets/images/screenshot-1.png',
      'assets/images/screenshot-2.png',
      'assets/images/screenshot-3.png',
    ],
  },
  audio: {
    base: 'assets/audio/',
    sfx: [
      'ui_click', 'ui_hover', 'ui_open', 'ui_close',
      'move', 'rotate', 'soft_drop', 'lock', 'land_heavy',
      'shatter_small', 'shatter_big', 'combo_roar',
      'level_up', 'game_over', 'start', 'countdown',
      'gem_glint', 'crystal_hum',
    ],
    bgm: ['cavern_theme', 'cavern_deep', 'cavern_core', 'cavern_menu'],
  },
};

/* ------------------------------------------------------------------ */
/* 主题（背景氛围随等级推进，仅表现层）                                 */
/* ------------------------------------------------------------------ */

export const THEMES = {
  default: {
    sky: ['#0a1230', '#131a3f', '#1d1140'],
    rock: '#1a1436',
    vein: '#3ff0d0',
    glow: '#7a5cff',
    dust: '#bfe9ff',
  },
  /** 每 3 级换一层深度色调（不改玩法，只换氛围） */
  tiers: [
    { name: 'shallow', from: 0, tint: '#2fd6c8', deep: '#0a1230', labelKey: 'tier_shallow' },
    { name: 'glimmer', from: 3, tint: '#8f6bff', deep: '#140a2e', labelKey: 'tier_glimmer' },
    { name: 'magma', from: 6, tint: '#ff7a45', deep: '#260a1c', labelKey: 'tier_magma' },
    { name: 'core', from: 9, tint: '#ffe066', deep: '#2b1405', labelKey: 'tier_core' },
  ],
};

/* ------------------------------------------------------------------ */
/* 触控（移动端适配，桌面端仍是原作四向键）                             */
/* ------------------------------------------------------------------ */

export const TOUCH = {
  swipeThreshold: 26,
  tapRotate: true,
  longPressRepeatMs: 90,
  showPadAt: 900,           // 视口宽于此值时显示触控板
};

/* ------------------------------------------------------------------ */
/* 汇总导出                                                             */
/* ------------------------------------------------------------------ */

export const GAME_CONFIG = {
  meta: {
    id: 'prism-crush',
    saveKey: 'prismcrush.save.v1',
    title: 'PRISM CRUSH',
    titleZh: '水晶方块',
    subtitle: 'Shatter the Crystal Depths',
    subtitleZh: '深入晶窟，砸碎方块',
    studio: 'Pipy Games',
    site: 'https://pipygames.com',
    canonical: 'https://pipygames.com/games/prism-crush/',
    shareBase: 'https://pipygames.com/games/prism-crush/',
    version: '1.0.0',
    category: 'puzzle',
  },
  stage: STAGE,
  board: BOARD,
  rules: RULES,
  gems: GEMS,
  shapes: SHAPES,
  fx: FX,
  render: RENDER,
  audio: AUDIO,
  assets: ASSETS,
  themes: THEMES,
  touch: TOUCH,
};

export default GAME_CONFIG;