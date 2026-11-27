/**
 * PRISM CRUSH · 本地存档（最高分 / 累计行数 / 局数 / 设置）
 * =====================================================================
 * 设计口径：
 *   · 存储形态 `{v:1, data:{...}, sum}`：sum 是对 data 序列化后的廉价校验和
 *     （djb2 + 盐），用来挡「手改 JSON」这种最朴素的作弊；
 *   · 任何异常（JSON 损坏 / sum 不符 / localStorage 被禁用）一律退回默认值，
 *     永不抛异常、永不白屏；
 *   · 隐私模式 / file:// 下 localStorage 会抛，自动降级为内存对象（本局有效）；
 *   · 所有数值双向夹取：读出来夹一次、写进去再夹一次，上限来自
 *     src/sdk/sdk.config.js 的 save.guard（score 1e8 / level 12 / lines 1e6），
 *     没有 SDK 时用同名兜底常量，两边数字必须一致。
 *
 * 设置项（全布尔）：sound / music / effects / shake / ghost / particles
 *   · sound 是总闸，默认取 config AUDIO.defaultEnabled（原作默认关音）；
 *   · ghost 默认取 config FX.ghost.enabled；其余默认开。
 * =====================================================================
 */

import { GAME_CONFIG, AUDIO, FX } from "../../config/game.config.js";

/* 信封版本与校验和盐（改盐会让老存档判定为被篡改 → 归零，属于预期行为） */
const SAVE_VERSION = 1;
const SALT = "prismcrush.save.v1";

/* 与 sdk.config.js save.guard 一致的兜底上限 */
const FALLBACK_GUARD = { score: 1e8, level: 12, lines: 1e6, count: 1e6 };

/* 字符串字段长度护栏（本存档目前只有数值/布尔，保留给以后加昵称用） */
const TEXT_MAX = 32;
const CONTROL_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/** 上限来源：优先 window.SDK_CONFIG.save.guard（src/sdk/sdk.config.js） */
function readGuard() {
  const sdkCfg = typeof globalThis !== "undefined" ? globalThis.SDK_CONFIG : null;
  const g = (sdkCfg && sdkCfg.save && sdkCfg.save.guard) || {};
  return {
    score: Number.isFinite(g.score) ? g.score : FALLBACK_GUARD.score,
    level: Number.isFinite(g.level) ? g.level : FALLBACK_GUARD.level,
    lines: Number.isFinite(g.lines) ? g.lines : FALLBACK_GUARD.lines,
    count: Number.isFinite(g.count) ? g.count : FALLBACK_GUARD.count,
  };
}

/** 存储键：config/GAME_CONFIG.meta.saveKey 权威，SDK 配置只作兜底 */
function readKey(config) {
  const fromCfg = config && config.meta && config.meta.saveKey;
  if (fromCfg) return String(fromCfg);
  const sdkCfg = typeof globalThis !== "undefined" ? globalThis.SDK_CONFIG : null;
  const fromSdk = sdkCfg && sdkCfg.save && sdkCfg.save.key;
  return fromSdk ? String(fromSdk) : "prismcrush.save.v1";
}

function clampNum(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function clampInt(v, min, max, def) {
  return Math.round(clampNum(v, min, max, def));
}

function toBool(v, def) {
  if (v === true || v === false) return v;
  if (v == null || v === "") return def;
  return !!v;
}

function cleanText(v) {
  return String(v == null ? "" : v)
    .replace(CONTROL_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEXT_MAX);
}

/** djb2：够用的非加密校验和，只用于发现「肉眼可见的手改」 */
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function checksum(serializedData) {
  return djb2(String(serializedData) + SALT);
}

/** 由 config 推出默认设置（不硬编码数字/开关状态） */
export function defaultSettings(config) {
  const audio = (config && config.audio) || AUDIO;
  const fx = (config && config.fx) || FX;
  return {
    sound: toBool(audio.defaultEnabled, false),
    music: true,
    effects: true,
    shake: true,
    ghost: fx && fx.ghost ? toBool(fx.ghost.enabled, true) : true,
    particles: true,
  };
}

/** 默认存档体（每次调用返回新对象，避免引用串味） */
export function defaultData(config) {
  return {
    best: 0,
    totalLines: 0,
    runs: 0,
    bestLevel: 0,
    lastScore: 0,
    lastLines: 0,
    lastRunAt: 0,
    seenHowto: false,
    settings: defaultSettings(config),
  };
}

export class SaveStore {
  /**
   * @param {object} [opts]
   * @param {object} [opts.config] GAME_CONFIG（读 meta.saveKey / audio / fx）
   * @param {object} [opts.guard]  覆盖上限（自动化验收用）
   * @param {object} [opts.sdk]    window.GameSDK，可选：只做埋点/校验镜像
   */
  constructor(opts) {
    const o = opts || {};
    this.config = o.config || GAME_CONFIG;
    this.key = readKey(this.config);
    this.guard = Object.assign(readGuard(), o.guard || {});
    this.sdk = o.sdk || null;
    /** localStorage 是否可用（隐私模式为 false → 走内存） */
    this.persistent = this._detectStorage();
    this._mem = new Map();
    /** 归一化后的当前存档数据 */
    this.data = defaultData(this.config);
    /** 上一次 load() 的判定结果，供 UI 提示「存档已重置」 */
    this.lastLoad = { ok: true, reason: "fresh", sum: 0 };
  }

  /* ------------------------------ 存储后端 ------------------------------ */

  _detectStorage() {
    try {
      const ls = this._ls();
      if (!ls) return false;
      const probe = this.key + ".probe";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  _ls() {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (e) {
      /* 某些隐私模式访问 localStorage 本身就会抛 */
      return null;
    }
  }

  _getItem(k) {
    if (this.persistent) {
      try {
        return this._ls().getItem(k);
      } catch (e) {
        this.persistent = false;
      }
    }
    const v = this._mem.get(k);
    return v == null ? null : v;
  }

  _setItem(k, v) {
    if (this.persistent) {
      try {
        this._ls().setItem(k, v);
        return true;
      } catch (e) {
        /* 配额满 / 隐私模式：下面转内存 */
        this.persistent = false;
      }
    }
    this._mem.set(k, v);
    return false;
  }

  _removeItem(k) {
    if (this.persistent) {
      try {
        this._ls().removeItem(k);
      } catch (e) {
        this.persistent = false;
      }
    }
    this._mem.delete(k);
  }

  /* ------------------------------ 归一化 ------------------------------ */

  /** 把任意来源的 data 夹成合法结构（读盘与写盘都走这里） */
  _normalize(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    const g = this.guard;
    const base = defaultData(this.config);
    const out = {
      best: clampInt(d.best, 0, g.score, 0),
      totalLines: clampInt(d.totalLines, 0, g.lines, 0),
      runs: clampInt(d.runs, 0, g.count, 0),
      bestLevel: clampInt(d.bestLevel, 0, g.level, 0),
      lastScore: clampInt(d.lastScore, 0, g.score, 0),
      lastLines: clampInt(d.lastLines, 0, g.lines, 0),
      lastRunAt: clampInt(d.lastRunAt, 0, 86400000 * 3650, 0),
      seenHowto: toBool(d.seenHowto, false),
      settings: Object.assign(base.settings, d.settings && typeof d.settings === "object" ? d.settings : {}),
    };
    /* 设置项逐条布尔化：脏值一律回到 config 推出的默认值 */
    const s = out.settings;
    for (const k of Object.keys(base.settings)) s[k] = toBool(s[k], base.settings[k]);
    /* 生涯一致性：最高分不该低于任何一局的分数 */
    out.best = Math.max(out.best, out.lastScore);
    return out;
  }

  /** 序列化 + 校验和 → 信封字符串 */
  _envelope(data) {
    const body = JSON.stringify(data);
    return JSON.stringify({ v: SAVE_VERSION, data, sum: checksum(body) });
  }

  /* ------------------------------ 读 / 写 ------------------------------ */

  /**
   * 读档：任何不合法（无数据 / JSON 坏 / sum 不符）都退回默认值，不抛异常。
   * @returns {object} 存档数据副本
   */
  load() {
    const rawText = this._getItem(this.key);
    if (!rawText) {
      this.data = defaultData(this.config);
      this.lastLoad = { ok: true, reason: "empty", sum: 0 };
      this.persist();
      return this.snapshot();
    }

    let env = null;
    try {
      env = JSON.parse(rawText);
    } catch (e) {
      env = null;
    }
    if (!env || typeof env !== "object") {
      this.data = defaultData(this.config);
      this.lastLoad = { ok: false, reason: "corrupt", sum: 0 };
      this.persist();
      return this.snapshot();
    }

    const data = env.data && typeof env.data === "object" ? env.data : {};
    const body = JSON.stringify(data);
    const expected = checksum(body);
    const stored = Number(env.sum);
    const sumOk = Number.isFinite(stored) && stored === expected;
    if (!sumOk) this._reportTamper("checksum");
    /* 校验和不符 = 有人手改过 JSON：整份作废退回默认值（宁可少留数据，
       也不让「1e12 分」进排行榜），写回一份干净存档 */
    if (!sumOk) {
      this.data = defaultData(this.config);
      this.lastLoad = { ok: false, reason: "checksum-mismatch", sum: expected };
      this.persist();
      return this.snapshot();
    }

    this.data = this._normalize(data);
    this.lastLoad = { ok: true, reason: "ok", sum: expected };
    /* 字段被夹取过 → 立刻回写一份干净的，避免下次再判一遍 */
    this.persist();
    return this.snapshot();
  }

  /**
   * 局部写档。
   * @param {object} [patch] 顶层字段（settings 请走 setSettings）
   * @returns {object} 落盘后的数据副本
   */
  save(patch) {
    if (patch && typeof patch === "object") {
      const next = Object.assign({}, this.data, patch);
      if (patch.settings && typeof patch.settings === "object") {
        next.settings = Object.assign({}, this.data.settings, patch.settings);
      }
      this.data = this._normalize(next);
    } else {
      this.data = this._normalize(this.data);
    }
    this.persist();
    return this.snapshot();
  }

  /** 把当前 data 写盘（内存降级时同样成功，只是不持久） */
  persist() {
    const ok = this._setItem(this.key, this._envelope(this.data));
    if (this.sdk && this.sdk.shield) {
      try {
        this.sdk.shield.save(this.data, this.key);
      } catch (e) {
        /* SDK 缺失/异常不影响存档 */
      }
    }
    return { written: ok !== false, persistent: this.persistent };
  }

  /** 清档并落盘 */
  reset() {
    this._removeItem(this.key);
    this.data = defaultData(this.config);
    this.lastLoad = { ok: true, reason: "reset", sum: 0 };
    this.persist();
    return this.snapshot();
  }

  /* ------------------------------ 一局结算 ------------------------------ */

  /**
   * 记录一局结果（引擎给只读摘要，全部数值夹取 + 只升不降）。
   * @param {{score?:number, lines?:number, level?:number}} run
   * @returns {{ok:boolean, isNewBest:boolean, best:number, prevBest:number,
   *            totalLines:number, runs:number, bestLevel:number}}
   */
  recordRun(run) {
    const r = run || {};
    const g = this.guard;
    const score = clampInt(r.score, 0, g.score, 0);
    const lines = clampInt(r.lines, 0, g.lines, 0);
    const level = clampInt(r.level, 0, g.level, 0);

    const prevBest = this.data.best;
    const isNewBest = score > prevBest;

    this.data.best = Math.max(prevBest, score);
    this.data.totalLines = Math.min(g.lines, this.data.totalLines + lines);
    this.data.runs = Math.min(g.count, this.data.runs + 1);
    this.data.bestLevel = Math.max(this.data.bestLevel, level);
    this.data.lastScore = score;
    this.data.lastLines = lines;
    this.data.lastRunAt = Date.now();

    this.persist();
    return {
      ok: true,
      isNewBest,
      best: this.data.best,
      prevBest,
      totalLines: this.data.totalLines,
      runs: this.data.runs,
      bestLevel: this.data.bestLevel,
    };
  }

  /** 该分数能否刷新纪录（0 分不算） */
  isRecord(score) {
    const s = clampInt(score, 0, this.guard.score, 0);
    return s > 0 && s > this.data.best;
  }

  /* ------------------------------ 设置项 ------------------------------ */

  /** 当前设置副本 */
  get settings() {
    return Object.assign({}, this.data.settings);
  }

  /** 批量改设置：只认已知布尔键，未知键忽略 */
  setSettings(patch) {
    const p = patch && typeof patch === "object" ? patch : {};
    const next = Object.assign({}, this.data.settings);
    for (const k of Object.keys(next)) if (k in p) next[k] = toBool(p[k], next[k]);
    this.data.settings = this._normalize(Object.assign({}, this.data, { settings: next })).settings;
    this.persist();
    return this.settings;
  }

  /** 单项改设置 */
  setSetting(name, value) {
    return this.setSettings({ [name]: value });
  }

  /** 首次进入教学后标记（菜单「玩法说明」用过就不再弹） */
  markSeenHowto() {
    if (!this.data.seenHowto) {
      this.data.seenHowto = true;
      this.persist();
    }
    return this.data.seenHowto;
  }

  /* ------------------------------ 便捷读 ------------------------------ */

  get best() {
    return this.data.best;
  }

  get totalLines() {
    return this.data.totalLines;
  }

  get runs() {
    return this.data.runs;
  }

  /** 抵达过的最深一层（菜单 / 结算页展示） */
  get bestLevel() {
    return this.data.bestLevel;
  }

  /** 只读快照（UI 用，改它不影响存档） */
  snapshot() {
    return {
      best: this.data.best,
      totalLines: this.data.totalLines,
      runs: this.data.runs,
      bestLevel: this.data.bestLevel,
      lastScore: this.data.lastScore,
      lastLines: this.data.lastLines,
      seenHowto: this.data.seenHowto,
      settings: this.settings,
      persistent: this.persistent,
    };
  }

  /* ------------------------------ 自检 ------------------------------ */

  /**
   * 校验盘上存档是否可信（设置面板 / 验收脚本用）。
   * @returns {{ok:boolean, reason:string, sum:number, persistent:boolean}}
   */
  verify() {
    const rawText = this._getItem(this.key);
    if (!rawText) return { ok: true, reason: "empty", sum: 0, persistent: this.persistent };
    let env = null;
    try {
      env = JSON.parse(rawText);
    } catch (e) {
      return { ok: false, reason: "corrupt", sum: 0, persistent: this.persistent };
    }
    if (!env || typeof env !== "object" || !env.data) return { ok: false, reason: "corrupt", sum: 0, persistent: this.persistent };
    const sum = checksum(JSON.stringify(env.data));
    const ok = Number(env.sum) === sum;
    return { ok, reason: ok ? "ok" : "checksum-mismatch", sum, persistent: this.persistent };
  }

  /** 疑似篡改：交给 SDK 的上报通道（没有就静默） */
  _reportTamper(type) {
    if (!this.sdk) return;
    try {
      if (this.sdk.protect && this.sdk.protect.fireTamper) this.sdk.protect.fireTamper({ type, key: this.key });
      else if (this.sdk.track) this.sdk.track("tamper", { type, key: this.key });
    } catch (e) {
      /* 上报失败不影响游戏 */
    }
  }
}

export { SAVE_VERSION, FALLBACK_GUARD as GUARD_CAPS, checksum };

/**
 * 工厂：`const save = createSave({ config: GAME_CONFIG, sdk: window.GameSDK })`
 * 构造完即已读盘（含校验），main.js 直接读 save.best 即可。
 */
export function createSave(opts) {
  const store = new SaveStore(opts);
  store.load();
  return store;
}

export default SaveStore;
