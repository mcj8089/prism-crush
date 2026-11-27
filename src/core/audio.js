/**
 * PRISM CRUSH · 音频层（WebAudio 主路 / HTMLAudio 降级路）
 * =====================================================================
 * 两条后端，同一套对外 API，main.js 不需要知道自己跑在哪条上：
 *
 *   1) WebAudio（http/https 与 http://localhost）
 *      fetch + decodeAudioData → AudioBuffer 缓存，master/bgm/sfx 三级增益，
 *      StereoPanner 做简单声像，同一音效做声部池 + 重触发节流（连按 ← → 不机枪）。
 *
 *   2) 媒体元素（file:// 双击 dist/index.html 验收；或 fetch/decode 全线失败）
 *      Chrome 在 file:// 禁 fetch 本地文件，因此改用 <audio>：
 *      优先 window.__EMBEDDED_AUDIO__（单文件版由 tools/build_web.py 注入 data URI），
 *      其次 config ASSETS.audio.base 下的相对路径。
 *      没有 AudioParam，音量淡入淡出用 setInterval 手动推。
 *
 * 音量/名单全部来自 config：AUDIO（master/bgm/sfx/defaultEnabled）、
 * ASSETS.audio（base/sfx/bgm）。代码里不硬编码任何音量或文件名。
 *
 * 对外约定（main.js）：
 *   const audio = createAudio({ config: GAME_CONFIG, save });
 *   audio.unlock()            首次用户手势里调用（浏览器自动播放策略）
 *   audio.loadAll()           后台预载，不阻塞首屏
 *   audio.playSfx('move')     一次性音效 {gain,pan,rate,throttleMs}
 *   audio.setBgm('cavern_theme') / audio.stopBgm()
 *   audio.setEnabled(save.settings.sound)   总闸
 *   audio.muteForAd() / audio.unmuteAfterAd()   由 core/ads.js 调用
 * =====================================================================
 */

import { GAME_CONFIG } from "../../config/game.config.js";

/* -------------------------------------------------------------------------
 * 名单常量（与 config/game.config.js 的 ASSETS.audio 一一对应）
 * ⚠ 必须是双引号字面量数组：tools/build_web.py 用
 *   const (?:SFX|BGM)_NAMES\s*=\s*\[...\]  从本文件抽名字去打包 data URI。
 * ---------------------------------------------------------------------- */
const SFX_NAMES = [
  "ui_click", "ui_hover", "ui_open", "ui_close",
  "move", "rotate", "soft_drop", "lock", "land_heavy",
  "shatter_small", "shatter_big", "combo_roar",
  "level_up", "game_over", "start", "countdown",
  "gem_glint", "crystal_hum",
];

const BGM_NAMES = [
  "cavern_theme", "cavern_deep", "cavern_core", "cavern_menu",
];

/* ------------------------------ 表现层调参 ------------------------------ */

/* 同一音效最多同时存活的声部数（超出抢最旧的一个，防止叠成噪音墙） */
const MAX_VOICES_PER_SFX = 4;
/* 媒体元素模式下每种音效最多常驻几个 <audio> */
const MAX_ELEMENTS_PER_SFX = 3;
/* 未列进下面表的音效使用的默认重触发间隔（毫秒） */
const DEFAULT_RETRIGGER_MS = 45;

/* 重触发节流表：连按方向键 / 连续消行时不炸音（数值属于手感，不在 config 里） */
const RETRIGGER_MS = {
  move: 55,
  rotate: 60,
  soft_drop: 40,
  lock: 80,
  land_heavy: 140,
  shatter_small: 90,
  shatter_big: 220,
  combo_roar: 400,
  level_up: 600,
  game_over: 800,
  gem_glint: 120,
  crystal_hum: 900,
  ui_hover: 90,
  ui_click: 40,
  countdown: 260,
};

/* BGM 默认淡入淡出（毫秒） */
const BGM_FADE_MS = 900;
/* 媒体元素模式手动淡入的步进间隔（毫秒） */
const FADE_STEP_MS = 60;

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** 单文件版把 WAV 内联成 data URI 挂在这里；没有它就走 assets/audio/ 相对路径 */
function assetUrl(base, name) {
  const host = typeof window !== "undefined" ? window.__EMBEDDED_AUDIO__ : null;
  const v = host ? host[name] : null;
  if (typeof v === "string" && v) return v;
  return String(base || "") + name + ".wav";
}

/** file://（或没有 location 的 node 环境）只能用媒体元素 */
function isFileProtocol() {
  try {
    return typeof location !== "undefined" && location.protocol === "file:";
  } catch (e) {
    return false;
  }
}

export class AudioManager {
  /**
   * @param {object} [opts]
   * @param {object} [opts.config] GAME_CONFIG（读 audio / assets.audio）
   * @param {object} [opts.save]   core/save.js 实例（读 settings.sound/music/effects）
   * @param {boolean} [opts.debug] 打开资源缺失的 console 提示
   */
  constructor(opts) {
    const o = opts || {};
    this.config = o.config || GAME_CONFIG;
    this.save = o.save || null;
    this.debug = !!o.debug;

    const audioCfg = (this.config && this.config.audio) || {};
    /* 总线初值全部来自 config AUDIO */
    this.volumes = {
      master: clamp(audioCfg.master == null ? 1 : audioCfg.master, 0, 1),
      bgm: clamp(audioCfg.bgm == null ? 1 : audioCfg.bgm, 0, 1),
      sfx: clamp(audioCfg.sfx == null ? 1 : audioCfg.sfx, 0, 1),
    };

    const assets = (this.config && this.config.assets && this.config.assets.audio) || {};
    this.base = assets.base || "assets/audio/";
    /* 运行期以 config 为准，字面量常量只在 config 缺失时兜底 */
    this.sfxNames = Array.isArray(assets.sfx) && assets.sfx.length ? assets.sfx.slice() : SFX_NAMES.slice();
    this.bgmNames = Array.isArray(assets.bgm) && assets.bgm.length ? assets.bgm.slice() : BGM_NAMES.slice();

    /** 总闸（settings.sound） */
    this.enabled = audioCfg.defaultEnabled === true;
    /** 子闸：音乐 / 音效，来自设置面板 */
    this.musicOn = true;
    this.effectsOn = true;

    /* ---------------- WebAudio ---------------- */
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
    /** name → AudioBuffer */
    this.buffers = new Map();
    /** name → [{src,gain}] 声部池 */
    this.voices = new Map();
    /** name → 上次播放时刻（WebAudio 用 ctx.currentTime，媒体元素用 performance.now） */
    this.lastAt = new Map();
    /** 当前 BGM：{ name, src, gain } */
    this.bgm = null;

    /* ---------------- 媒体元素 ---------------- */
    /** true = 跑在 <audio> 模式 */
    this.elMode = isFileProtocol();
    /** name → HTMLAudioElement[] */
    this.elPool = new Map();
    /** name → HTMLAudioElement（BGM 常驻复用，切换不重新下载） */
    this.elBgmCache = new Map();
    this.elBgm = null;
    this.elBgmBase = 1;

    /* ---------------- 广告静音 ---------------- */
    this.adMuted = false;
    /** 进入广告前 BGM 是否在放（用于精确还原） */
    this._bgmWasPlaying = false;

    /** 解码前就请求切歌时记住的 BGM */
    this._pendingBgm = "";
    this.loaded = false;
    this._loadPromise = null;

    this._initGraph();
    this._syncFromSave();
  }

  /* ------------------------------ 状态读 ------------------------------ */

  /** 是否已经具备出声能力 */
  get ready() {
    return this.elMode ? typeof Audio !== "undefined" : !!this.ctx;
  }

  /** 'element' | 'webaudio' */
  get mode() {
    return this.elMode ? "element" : "webaudio";
  }

  /** 当前在放的 BGM 名（无则空串） */
  get bgmName() {
    return this.bgm ? this.bgm.name : this.elBgm ? this.elBgm._pcName || "" : "";
  }

  /** 主时钟秒（排程用；媒体元素模式退回 performance.now） */
  now() {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  /* ------------------------------ 初始化 ------------------------------ */

  _initGraph() {
    if (this.elMode) return;
    const Ctor = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
    if (!Ctor) {
      /* 没有 WebAudio 的浏览器：降级媒体元素，功能不丢 */
      this.elMode = true;
      return;
    }
    try {
      this.ctx = new Ctor();
    } catch (e) {
      this.elMode = true;
      return;
    }
    const ctx = this.ctx;
    this.masterGain = ctx.createGain();
    this.bgmGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.bgmGain.gain.value = this.volumes.bgm;
    this.sfxGain.gain.value = this.volumes.sfx;
    this.masterGain.gain.value = this._masterTarget();
    this.bgmGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
  }

  /** 从存档设置同步总闸与子闸（main.js 打开设置面板后也可调 setEnabled） */
  _syncFromSave() {
    if (!this.save || !this.save.settings) return;
    const s = this.save.settings;
    this.enabled = !!s.sound;
    this.musicOn = s.music !== false;
    this.effectsOn = s.effects !== false;
  }

  /* ------------------------------ 开关 ------------------------------ */

  /**
   * 总闸。关闭后所有 play 调用都是静默 no-op（不打 console、不建节点）。
   * @param {boolean} on
   */
  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      this.stopBgm();
      this._applyMaster(0.02);
    } else {
      this._applyMaster(0.05);
      if (this._pendingBgm) {
        const n = this._pendingBgm;
        this._pendingBgm = "";
        this.setBgm(n);
      }
    }
    return this.enabled;
  }

  /** 子闸：音乐（BGM）与音效（SFX）分开控制 */
  setSubGates({ music, effects } = {}) {
    if (music != null) this.musicOn = !!music;
    if (effects != null) this.effectsOn = !!effects;
    if (!this.musicOn) this.stopBgm();
    return { music: this.musicOn, effects: this.effectsOn };
  }

  /**
   * 改总线音量。
   * @param {{master?:number, bgm?:number, sfx?:number}} v 0~1，缺省字段保持原值
   */
  setVolumes(v) {
    const p = v || {};
    if (p.master != null) this.volumes.master = clamp(p.master, 0, 1);
    if (p.bgm != null) this.volumes.bgm = clamp(p.bgm, 0, 1);
    if (p.sfx != null) this.volumes.sfx = clamp(p.sfx, 0, 1);
    if (this.elMode) {
      this._applyElVolumes();
      return this.volumes;
    }
    if (!this.ctx) return this.volumes;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.setTargetAtTime(this.volumes.bgm, t, 0.04);
    this.sfxGain.gain.setTargetAtTime(this.volumes.sfx, t, 0.04);
    this._applyMaster();
    return this.volumes;
  }

  /** 主增益目标值（静音/关闸时为接近 0，避免 AudioParam 收到 0 后无法 ramp） */
  _masterTarget() {
    if (!this.enabled || this.adMuted) return 0.0001;
    return Math.max(0.0001, this.volumes.master);
  }

  _applyMaster(ramp) {
    if (this.elMode) {
      this._applyElVolumes();
      return;
    }
    if (!this.ctx) return;
    try {
      this.masterGain.gain.setTargetAtTime(this._masterTarget(), this.ctx.currentTime, ramp == null ? 0.05 : ramp);
    } catch (e) {
      /* ignore */
    }
  }

  /** 首次用户手势里调用：.resume() AudioContext */
  async unlock() {
    if (this.elMode) {
      if (this._pendingBgm) {
        const n = this._pendingBgm;
        this._pendingBgm = "";
        this.setBgm(n);
      } else if (this.elBgm) {
        const p = this.elBgm.play();
        if (p && p.catch) p.catch(() => {});
      }
      return true;
    }
    if (!this.ctx) return false;
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch (e) {
        return false;
      }
    }
    return this.ctx.state === "running";
  }

  /** 页面隐藏时省电（媒体元素模式退化为暂停 BGM） */
  async suspend() {
    if (this.elMode) {
      if (this.elBgm) this.elBgm.pause();
      return;
    }
    if (!this.ctx || this.ctx.state !== "running") return;
    try {
      await this.ctx.suspend();
    } catch (e) {
      /* ignore */
    }
  }

  async resume() {
    if (this.elMode) {
      if (this.enabled && this.musicOn && !this.adMuted && this.elBgm && this.elBgm.paused) {
        const p = this.elBgm.play();
        if (p && p.catch) p.catch(() => {});
      }
      return;
    }
    if (!this.ctx || this.ctx.state !== "suspended") return;
    try {
      await this.ctx.resume();
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------ 预加载 ------------------------------ */

  /** 批量预载；重复调用返回同一个 Promise。永不 reject。 */
  loadAll() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._doLoad();
    return this._loadPromise;
  }

  async _doLoad() {
    if (this.elMode) {
      /* 媒体元素模式交给 <audio> 自己下载，这里只预热 BGM 元素 */
      for (const name of this.bgmNames) this._elBgmFor(name, true);
      this.loaded = true;
      this._flushPendingBgm();
      return;
    }
    if (!this.ctx) {
      this._switchToElement("no-webaudio");
      return this._doLoadElementFallback();
    }
    /* 菜单曲与常触发音效优先，其余排队（3 路并发，不抢首屏） */
    const first = this.bgmNames[0] ? [this.bgmNames[0]] : [];
    const queue = [];
    for (const n of first) queue.push({ name: n, bgm: true });
    for (const n of ["ui_click", "move", "rotate", "lock", "shatter_small", "game_over"]) {
      if (this.sfxNames.includes(n)) queue.push({ name: n, bgm: false });
    }
    for (const n of this.sfxNames) if (!queue.some((i) => i.name === n)) queue.push({ name: n, bgm: false });
    for (const n of this.bgmNames) if (!first.includes(n)) queue.push({ name: n, bgm: true });

    let ok = 0;
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++];
        const done = await this._decodeInto(item.name, item.bgm);
        if (done) ok++;
        else failed++;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.loaded = true;

    /* 一条都没解出来但确实尝试过 → 判定为 file:// 式封锁，整体切媒体元素模式 */
    if (ok === 0 && failed > 0) {
      this._switchToElement("decode-failed");
      await this._doLoadElementFallback();
      return;
    }
    this._flushPendingBgm();
  }

  /** fetch + decodeAudioData；成功 true，失败 false（只记一条聚合 warn） */
  async _decodeInto(name, isBgm) {
    try {
      const res = await fetch(assetUrl(this.base, name), { cache: "force-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(buf);
      this.buffers.set(name, decoded);
      if (isBgm && this._pendingBgm === name) this._pendingBgm = "";
      return true;
    } catch (e) {
      if (this.debug) console.warn("[audio] 资源缺失", name, e && e.message);
      return false;
    }
  }

  _switchToElement(reason) {
    this.elMode = true;
    if (this.debug) console.warn("[audio] 切换到媒体元素模式", reason);
  }

  async _doLoadElementFallback() {
    for (const name of this.bgmNames) this._elBgmFor(name, true);
    this.loaded = true;
    this._flushPendingBgm();
  }

  _flushPendingBgm() {
    if (!this._pendingBgm) return;
    const n = this._pendingBgm;
    this._pendingBgm = "";
    this.setBgm(n);
  }

  /* ------------------------------ SFX ------------------------------ */

  /**
   * 播一个音效。
   * @param {string} name  ASSETS.audio.sfx 里的名字
   * @param {object} [opts] {gain=0.8, pan=0, rate=1, throttleMs, when}
   *        when = WebAudio 绝对排程秒（媒体元素模式忽略）
   * @returns {object|null} 声部句柄（AudioBufferSourceNode / HTMLAudioElement），静音时 null
   */
  playSfx(name, opts) {
    if (!this.enabled || !this.effectsOn || this.adMuted) return null;
    const o = opts || {};
    return this.elMode
      ? this._playSfxEl(name, o)
      : this._playSfxWebAudio(name, o);
  }

  /** 节流判定：true = 允许发声 */
  _throttleOk(name, o, clock) {
    const ms = o.throttleMs == null ? (RETRIGGER_MS[name] == null ? DEFAULT_RETRIGGER_MS : RETRIGGER_MS[name]) : o.throttleMs;
    if (!ms || o.when) return true;
    /* 用 has 而不是 ||：ctx.currentTime 的 0 是合法时刻，不能被当「没播过」 */
    const last = this.lastAt.has(name) ? this.lastAt.get(name) : -1e9;
    if (clock - last < ms / 1000) return false;
    this.lastAt.set(name, clock);
    return true;
  }

  _playSfxWebAudio(name, o) {
    if (!this.ctx) return null;
    const buf = this.buffers.get(name);
    if (!buf) {
      /* 资源缺失或还在解码：静默跳过，不刷 console */
      if (this.debug && !this.buffers.size) console.warn("[audio] 尚未解码完成", name);
      return null;
    }
    const now = this.ctx.currentTime;
    if (!this._throttleOk(name, o, now)) return null;

    const when = Math.max(now, Number(o.when) || now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = clamp(o.rate == null ? 1 : o.rate, 0.25, 4);
    const gain = this.ctx.createGain();
    gain.gain.value = clamp(o.gain == null ? 0.8 : o.gain, 0, 1);

    let tail = gain;
    if (o.pan != null && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(o.pan, -1, 1);
      gain.connect(panner);
      tail = panner;
    }
    src.connect(gain);
    tail.connect(this.sfxGain);
    src.start(when);

    const voice = { src, gain, when };
    this._poolVoice(name, voice);
    return src;
  }

  /** 声部池：同名同时最多 MAX_VOICES_PER_SFX 个，超了抢最旧的 */
  _poolVoice(name, voice) {
    let arr = this.voices.get(name);
    if (!arr) {
      arr = [];
      this.voices.set(name, arr);
    }
    arr.push(voice);
    while (arr.length > MAX_VOICES_PER_SFX) {
      const old = arr.shift();
      try {
        old.src.stop();
      } catch (e) {
        /* 已结束 */
      }
      try {
        old.src.disconnect();
        old.gain.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    voice.src.onended = () => {
      const i = arr.indexOf(voice);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  /* -------------------- 媒体元素模式（file:// / 降级） -------------------- */

  _elLevel(bus, base) {
    const master = this.enabled && !this.adMuted ? clamp(this.volumes.master, 0, 1) : 0;
    return clamp(master * clamp(this.volumes[bus], 0, 1) * clamp(base == null ? 1 : base, 0, 1), 0, 1);
  }

  _applyElVolumes() {
    if (this.elBgm) this.elBgm.volume = this._elLevel("bgm", this.elBgmBase || 1);
    for (const pool of this.elPool.values()) {
      for (const el of pool) el.volume = this._elLevel("sfx", el._pcBase == null ? 0.8 : el._pcBase);
    }
  }

  /** 取一个空闲的 <audio>（池未满则新建；池内复用避免重复下载） */
  _freeEl(name) {
    if (typeof Audio === "undefined") return null; // 非浏览器环境（node 验收）：静默
    let pool = this.elPool.get(name);
    if (!pool) {
      pool = [];
      this.elPool.set(name, pool);
    }
    let el = pool.find((e) => e.paused || e.ended);
    if (!el && pool.length < MAX_ELEMENTS_PER_SFX) {
      el = new Audio(assetUrl(this.base, name));
      el.preload = "auto";
      pool.push(el);
    }
    return el || null;
  }

  _playSfxEl(name, o) {
    const clock = performance.now() / 1000;
    if (!this._throttleOk(name, o, clock)) return null;
    const el = this._freeEl(name);
    if (!el) return null;
    el._pcBase = o.gain == null ? 0.8 : clamp(o.gain, 0, 1);
    try {
      el.playbackRate = clamp(o.rate == null ? 1 : o.rate, 0.25, 4);
      el.volume = this._elLevel("sfx", el._pcBase);
      el.currentTime = 0;
    } catch (e) {
      /* 元数据未就绪时仍可 play() */
    }
    const p = el.play();
    if (p && p.catch) {
      p.catch(() => {
        const pool = this.elPool.get(name);
        if (pool) {
          const i = pool.indexOf(el);
          if (i >= 0) pool.splice(i, 1);
        }
      });
    }
    return el;
  }

  /** BGM 元素常驻缓存（preload=true 时只预热不播） */
  _elBgmFor(name, preloadOnly) {
    if (typeof Audio === "undefined") return null; // 非浏览器环境：不建元素
    let el = this.elBgmCache.get(name);
    if (!el) {
      el = new Audio(assetUrl(this.base, name));
      el.loop = true;
      el.preload = "auto";
      el._pcName = name;
      el.volume = 0;
      this.elBgmCache.set(name, el);
    }
    return el;
  }

  /* ------------------------------ BGM ------------------------------ */

  /**
   * 切 BGM（同名不重启，只调音量）。解码未完成时记为 pending，就绪后自动接上。
   * @param {string} name ASSETS.audio.bgm 里的名字
   * @param {object} [opts] {fadeMs, volume}
   */
  setBgm(name, opts) {
    if (!name) return null;
    const o = opts || {};
    const volume = clamp(o.volume == null ? 1 : o.volume, 0, 1);
    const fade = o.fadeMs == null ? BGM_FADE_MS : o.fadeMs;
    if (!this.enabled || !this.musicOn) {
      this._pendingBgm = name;
      return null;
    }
    if (this.elMode) return this._setBgmEl(name, volume, fade);
    if (!this.ctx) return null;
    if (!this.buffers.has(name)) {
      this._pendingBgm = name;
      return null;
    }
    if (this.bgm && this.bgm.name === name) {
      try {
        this.bgm.gain.gain.setTargetAtTime(Math.max(0.0001, volume), this.ctx.currentTime, 0.08);
      } catch (e) {
        /* ignore */
      }
      return this.bgm.src;
    }
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(name);
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume), now + fade / 1000);
    src.connect(gain);
    gain.connect(this.bgmGain);
    src.start(now + 0.03);

    const old = this.bgm;
    this.bgm = { src, gain, name, volume };
    if (old) this._fadeOutBgm(old, Math.min(700, fade));
    return src;
  }

  /** 停掉 BGM（带淡出） */
  stopBgm(fadeMs) {
    this._pendingBgm = "";
    if (this.elMode) {
      this._stopBgmEl(fadeMs == null ? BGM_FADE_MS : fadeMs);
      return;
    }
    if (!this.bgm) return;
    const old = this.bgm;
    this.bgm = null;
    this._fadeOutBgm(old, fadeMs == null ? 600 : fadeMs);
  }

  _fadeOutBgm(old, fadeMs) {
    if (!old || !old.gain || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0.0001, t, Math.max(0.03, fadeMs / 3500));
      setTimeout(() => {
        try {
          old.src.stop();
          old.src.disconnect();
          old.gain.disconnect();
        } catch (e) {
          /* ignore */
        }
      }, fadeMs + 260);
    } catch (e) {
      /* ignore */
    }
  }

  _setBgmEl(name, volume, fadeMs) {
    if (this.elBgm && this.elBgm._pcName === name) {
      this.elBgmBase = volume;
      this.elBgm.volume = this._elLevel("bgm", volume);
      return this.elBgm;
    }
    this._stopBgmEl(fadeMs);
    const el = this._elBgmFor(name);
    if (!el) return null; // 非浏览器环境：没有 <audio> 可播
    el._seq = (el._seq || 0) + 1; // 作废这只元素上仍在跑的旧淡变
    el.volume = 0;
    this.elBgm = el;
    this.elBgmBase = volume;
    const p = el.play();
    if (p && p.catch) {
      p.catch(() => {
        /* 手势未到 / 缺文件：保持静默，unlock() 会重试 */
        if (this.elBgm === el) this.elBgm = null;
      });
    }
    /* 没有 AudioParam → setInterval 手动淡入 */
    const seq = el._seq;
    this._elFade(el, "bgm", volume, fadeMs, () => this.elBgm === el && el._seq === seq);
    return el;
  }

  /** 淡出并暂停当前 BGM 元素；不清 src，否则会给浏览器记一条中止下载 */
  _stopBgmEl(fadeMs) {
    const el = this.elBgm;
    this.elBgm = null;
    if (!el) return;
    const from = el.volume;
    const ms = fadeMs == null ? BGM_FADE_MS : fadeMs;
    const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
    const seq = el._seq || 0;
    let i = 0;
    const timer = setInterval(() => {
      if (el._seq !== seq) {
        /* 已被重新起播：淡变作废，别把新曲的音量压成 0 */
        clearInterval(timer);
        return;
      }
      i++;
      el.volume = Math.max(0, from * (1 - i / steps));
      if (i >= steps) {
        clearInterval(timer);
        try {
          el.pause();
          el.currentTime = 0;
        } catch (e) {
          /* ignore */
        }
      }
    }, FADE_STEP_MS);
  }

  /**
   * 媒体元素模式的手动淡变：线性插值「绝对音量」，因为 <audio>.volume 只有 0~1。
   * @param {HTMLAudioElement} el
   * @param {'bgm'|'sfx'} bus
   * @param {number} target 目标相对音量 0~1（还会乘 master × bus 增益）
   * @param {number} fadeMs
   * @param {()=>boolean} alive 元素是否仍是当前播放者
   */
  _elFade(el, bus, target, fadeMs, alive) {
    const steps = Math.max(1, Math.round((fadeMs || 0) / FADE_STEP_MS));
    const from = el.volume;
    const to = this._elLevel(bus, target);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      if (!alive()) {
        clearInterval(timer);
        return;
      }
      el.volume = clamp(from + (to - from) * (i / steps), 0, 1);
      if (i >= steps) clearInterval(timer);
    }, FADE_STEP_MS);
    return timer;
  }

  /* ------------------------------ 广告静音 ------------------------------ */

  /**
   * 广告前静音：记住「广告前 BGM 是否在放」，把主增益压到 0。
   * 幂等：ads.js 里 mute/unmute 成对调用，嵌套第二次 mute 不会污染还原状态。
   */
  muteForAd() {
    if (this.adMuted) return false;
    this._bgmWasPlaying = !!this.bgmName;
    this.adMuted = true;
    if (this.elMode) {
      if (this.elBgm) {
        const el = this.elBgm;
        /* 目标值经 _elLevel 计算：adMuted 已置真 → 终点就是 0，这里只是把它推得平滑。
           alive 条件里带上 adMuted：unmuteAfterAd() 一执行，这条淡出表自动作废。 */
        this._elFade(el, "bgm", 0, 180, () => this.elBgm === el && this.adMuted);
      } else {
        this._applyElVolumes();
      }
    } else {
      this._applyMaster(0.02);
    }
    return true;
  }

  /** 广告后还原：恢复到 muteForAd() 之前的确切状态 */
  unmuteAfterAd() {
    if (!this.adMuted) return false;
    this.adMuted = false;
    if (this.elMode) {
      this._applyElVolumes();
      if (this._bgmWasPlaying && this.bgmName) this._setBgmEl(this.bgmName, this.elBgmBase || 1, BGM_FADE_MS);
    } else {
      this._applyMaster(0.05);
      if (this._bgmWasPlaying && this.bgm && this.bgm.src) {
        try {
          this.bgm.gain.gain.setTargetAtTime(Math.max(0.0001, this.bgm.volume || 1), this.ctx.currentTime, 0.08);
        } catch (e) {
          /* ignore */
        }
      }
    }
    this._bgmWasPlaying = false;
    return true;
  }
}

/**
 * 工厂：`createAudio({ config: GAME_CONFIG, save })`
 * save 用于读取 settings.sound/music/effects 作为开关初值；不传则用 config 默认。
 */
export function createAudio(opts) {
  return new AudioManager(opts || {});
}

export { SFX_NAMES, BGM_NAMES, RETRIGGER_MS, MAX_VOICES_PER_SFX };
export default AudioManager;
