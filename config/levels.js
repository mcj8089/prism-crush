/**
 * PRISM CRUSH · 关卡/等级曲线
 * =====================================================================
 * 原作用 Leval.js 的 2^i×100 分数门槛 + 1000×(1-(lv-1)/10) ms 速度公式，
 * 这里把它显式化成表，方便调参；数值与原作逐档一致（禁止改动判定节奏）。
 *
 * 原作 Leval.js：levalArr[i] = 2^i * 100  → 100,200,400,…,51200
 * 原作 Board.js ：speed = floor(1000 * (1 - (level-1)/10))
 * =====================================================================
 */

/** 等级总数（原作 10 档） */
export const LEVEL_COUNT = 10;

/**
 * @typedef {object} LevelDef
 * @property {number} level      等级序号（从 1 开始，原作 leval 计数到 1 才算 1 级）
 * @property {number} threshold  达到该总分进入本级（原作 2^(level-1)*100）
 * @property {number} speed      下落一格的毫秒数（原作公式）
 * @property {string} theme      背景氛围层（仅表现）
 * @property {string} bgm        该档使用的 BGM（仅表现）
 */

const CONST_SPEED = 1000;

/** 原作速度公式：等级越高，下落越快；10 级后恒为 100ms */
export function speedForLevel(level) {
  const lv = Math.max(1, level);
  return Math.floor(CONST_SPEED * (1 - (lv - 1) / 10));
}

/** 原作升级判定：score >= 2^level * 100 时升一级（一次只升一级） */
export function levelForScore(score, current = 0) {
  return score >= Math.pow(2, current) * 100 ? current + 1 : 0;
}

export const LEVELS = Array.from({ length: LEVEL_COUNT }, (_, i) => {
  const level = i + 1;
  const tier = level >= 10 ? 3 : level >= 7 ? 2 : level >= 4 ? 1 : 0;
  const themeName = ['shallow', 'glimmer', 'magma', 'core'][tier];
  return {
    level,
    threshold: Math.pow(2, i) * 100,
    speed: speedForLevel(level),
    theme: themeName,
    bgm: ['cavern_theme', 'cavern_deep', 'cavern_core', 'cavern_core'][tier],
  };
});

/** 每消 N 行的爆炸强度档位（表现层用） */
export const CRUSH_TIERS = [
  { lines: 1, label: 'CRACK', weight: 1 },
  { lines: 2, label: 'SPLIT', weight: 2 },
  { lines: 3, label: 'FRACTURE', weight: 3 },
  { lines: 4, label: 'PRISM BREAK', weight: 5 },
];

export default LEVELS;
