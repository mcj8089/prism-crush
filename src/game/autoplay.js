/**
 * 自动演示 AI —— 仅用于 ?autoplay=1 的 GIF/截图录制与验收
 * =====================================================================
 * 它只调用与玩家完全相同的 Game.input()，不触碰任何判定函数，
 * 因此录出来的画面与真人操作在规则上等价。
 */

/** 在离屏网格上模拟落子，返回 (最终占用表, 消行后行数) 的高度分布 */
function simulate(grid, layout, x, y) {
  const rows = grid.length;
  const cols = grid[0].length;
  const g = grid.map((r) => r.slice());
  // 下探
  let dy = 0;
  for (;;) {
    let blocked = false;
    for (let j = 0; j < layout.length; j++) {
      for (let i = 0; i < layout[j].length; i++) {
        if (!layout[j][i]) continue;
        const ny = y + dy + 1 + j;
        const nx = x + i;
        if (ny >= rows || nx < 0 || nx >= cols || (g[ny] && g[ny][nx])) blocked = true;
      }
    }
    if (blocked) break;
    dy++;
  }
  let over = false;
  for (let j = 0; j < layout.length; j++) {
    for (let i = 0; i < layout[j].length; i++) {
      if (!layout[j][i]) continue;
      const ny = y + dy + j;
      const nx = x + i;
      if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
      if (g[ny][nx]) over = true;
      g[ny][nx] = 1;
    }
  }
  // 消行
  let cleared = 0;
  for (let r = rows - 1; r >= 0; r--) {
    while (r > 0 && g[r].every((v) => v > 0)) {
      g.splice(r, 1);
      g.unshift(new Array(cols).fill(0));
      cleared++;
    }
  }
  return { grid: g, cleared, over };
}

/** 经典启发式：aggHeight / holes / bumpiness / rowsCleared */
function evaluate(grid, cleared, weights) {
  const cols = grid[0].length;
  const rows = grid.length;
  let aggHeight = 0;
  let holes = 0;
  let maxHeight = 0;
  const colH = [];
  for (let x = 0; x < cols; x++) {
    let h = 0;
    for (let y = 0; y < rows; y++) {
      if (grid[y][x]) { h = rows - y; break; }
    }
    colH.push(h);
    aggHeight += h;
    let seen = false;
    for (let y = 0; y < rows; y++) {
      if (grid[y][x]) seen = true;
      else if (seen) holes++;
    }
    maxHeight = Math.max(maxHeight, h);
  }
  let bump = 0;
  for (let x = 0; x < cols - 1; x++) bump += Math.abs(colH[x] - colH[x + 1]);
  return (
    weights.aggHeight * aggHeight +
    weights.holes * holes +
    weights.bumpiness * bump +
    weights.cleared * cleared * cleared -
    weights.maxHeight * maxHeight
  );
}

const DEFAULT_WEIGHTS = {
  aggHeight: -0.51,
  holes: -0.76,
  bumpiness: -0.18,
  cleared: 0.82,
  maxHeight: -0.30,
};

/**
 * 计算当前造型的最优 (rotations, x)。
 * @param {number[][]} grid
 * @param {Shape} shape
 * @returns {{rotations:number, x:number, score:number}}
 */
export function bestMove(grid, shape, weights = DEFAULT_WEIGHTS) {
  const cols = grid[0].length;
  // evaluate 是「越大越好」（坏项权重为负，消行为正），所以取最大值
  let best = { rotations: 0, x: shape.x, score: -Infinity };
  const probe = shape.clone();
  for (let rot = 0; rot < 4; rot++) {
    const layout = probe.layout;
    const width = layout[0].length;
    for (let x = 0; x <= cols - width; x++) {
      const r = simulate(grid, layout, x, probe.y);
      if (r.over) continue;
      const s = evaluate(r.grid, r.cleared, weights);
      if (s > best.score) best = { rotations: rot, x, score: s };
    }
    probe.rotate();
  }
  if (!isFinite(best.score)) best = { rotations: 0, x: shape.x, score: 0 };
  return best;
}

/**
 * 一个把 bestMove 变成按键序列的驱动器。
 * 每次 spawn/lock 后重新规划，输出 'left'|'right'|'rotate'|'down' 队列。
 */
export class AutoDriver {
  constructor(game, weights = DEFAULT_WEIGHTS) {
    this.game = game;
    this.weights = weights;
    this.queue = [];
    this.plannedFor = null;
  }

  /** 每帧调用；返回下一步动作或 null */
  next() {
    const board = this.game.board;
    const key = `${board.shape.x},${board.shape.y},${board.shape.blockType},${board.shape.layout.length},${board.shape.layout[0].length}`;
    if (key !== this.plannedFor) {
      this.plannedFor = key;
      this._plan();
    }
    return this.queue.length ? this.queue.shift() : null;
  }

  _plan() {
    const board = this.game.board;
    const target = bestMove(board.grid, board.shape, this.weights);
    const q = [];
    for (let i = 0; i < target.rotations; i++) q.push('rotate');
    // 旋转后 x 可能被钳制，按当前实际 x 逐步挪动
    let cur = board.shape.x;
    const layout = board.shape.layout;
    const width = layout[0].length;
    const want = Math.min(Math.max(target.x, 0), board.cols - width);
    while (cur < want) { q.push('right'); cur++; }
    while (cur > want) { q.push('left'); cur--; }
    q.push('down');
    this.queue = q;
  }
}

export default AutoDriver;
