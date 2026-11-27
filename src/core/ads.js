/**
 * PRISM CRUSH · 广告桥（游戏侧唯一入口）
 * =====================================================================
 * 铁律：业务代码只认这一层，永远不直接摸 window.GameSDK.ads ——
 *   · SDK 没接 / ads.config.js 里 enabled:false → 全部「静默通过」：
 *     激励视频在 global.simulateMs 后 resolve 成功（玩家照常拿奖励），
 *     插屏/横幅立即 resolve，绝不卡住游戏；
 *   · 接了账号（provider 改成 poki/crazygames 且对应全局 SDK 对象存在）
 *     才走真渠道，渠道适配是本文件里的瘦桩，改 config 即可，业务零改动。
 *
 * 计数口径（全部来自 config/ads.config.js）：
 *   · placement.maxPerRun  —— 每局该广告位最多几次（复活 2 次这类）；
 *   · placement.everyNPlays —— 插屏每 N 局才出现一次；
 *   · placement.cooldownMs  —— 同一广告位两次之间隔；
 *   · global.maxInterstitialPerSession / interstitialCooldownMs —— 会话级插屏防打扰；
 *   · global.fillTimeoutMs  —— 拉取超时按失败处理并放行游戏；
 *   · global.pauseGameDuringAd / muteAudioDuringAd —— 通过 hooks + audio 完成。
 *
 * 用法（main.js）：
 *   const ads = createAds({ config: ADS_CONFIG, audio, sdk: window.GameSDK });
 *   ads.bindHooks({ onPause, onResume, onOverlayShow, onOverlayHide });
 *   const res = await ads.show('reviveRun');   // {ok, reward, reason, mocked}
 *   if (res.ok) grantReward(res.reward);
 *   ads.resetRun();                             // 每开一局调用
 * =====================================================================
 */

export class AdsBridge {
  /**
   * @param {object} opts
   * @param {object} opts.config  ADS_CONFIG（config/ads.config.js）
   * @param {object} [opts.audio] core/audio.js 实例（muteForAd / unmuteAfterAd）
   * @param {object} [opts.sdk]   window.GameSDK；只用来埋点 track，不碰 sdk.ads
   */
  constructor(opts) {
    const o = opts || {};
    this.cfg = o.config || {};
    this.audio = o.audio || null;
    this.sdk = o.sdk || null;

    const g = this.cfg.global || {};
    this.global = {
      pauseGameDuringAd: g.pauseGameDuringAd !== false,
      muteAudioDuringAd: g.muteAudioDuringAd !== false,
      fillTimeoutMs: Number(g.fillTimeoutMs) || 9000,
      simulateMs: Number(g.simulateMs) || 1200,
      maxInterstitialPerSession: Number(g.maxInterstitialPerSession) || 0,
      interstitialCooldownMs: Number(g.interstitialCooldownMs) || 0,
    };

    /** main.js 注入的钩子：暂停/恢复主循环、广告遮罩 */
    this.hooks = {};

    /* ------------------------- 计数器（本会话） ------------------------- */
    this.usagePerRun = new Map(); // placementKey → 本局已用次数
    this.lastShownAt = new Map(); // placementKey → 上次时间戳
    this.plays = 0; // 已进行局数（everyNPlays 用）
    this.interstitialsShown = 0; // 会话级插屏计数
    this.lastInterstitialAt = 0;
    /** 正在播放的广告位（防止并发调用叠广告） */
    this.active = null;
    this._provider = null;
    this._providerError = "";
  }

  /* ------------------------------ 配置读 ------------------------------ */

  /** 单个广告位配置（不存在返回 null） */
  placement(key) {
    const p = (this.cfg.placements || {})[key];
    return p && typeof p === "object" ? p : null;
  }

  /** 总开关：关掉或 provider='none' 时所有调用都走静默降级 */
  get live() {
    return this.cfg.enabled === true && this.cfg.provider !== "none";
  }

  /**
   * 真渠道是否就绪（live + provider 初始化成功）。
   * false 时 show() 仍然 resolve，只是 mocked:true —— UI 可以用它决定要不要
   * 显示「广告」遮罩文案。
   */
  get ready() {
    return !!(this.live && this._provider);
  }

  /** 绑定游戏钩子：onPause/onResume/onOverlayShow/onOverlayHide */
  bindHooks(hooks) {
    this.hooks = hooks || {};
    return this;
  }

  /** 兼容 main.js 的 init() 习惯写法 */
  init(hooks) {
    this.bindHooks(hooks);
    if (this.live && !this._provider && !this._providerError) this._initProvider();
    return this;
  }

  /* ------------------------------ 判定 ------------------------------ */

  /**
   * 现在能不能播这个广告位（只读判定，不改计数）。
   * 计数口径在「静默降级」下同样生效，所以 UI 的按钮该灰还是得灰。
   * @param {string} key
   * @returns {boolean}
   */
  canShow(key) {
    const p = this.placement(key);
    if (!p) return false;
    if (!this._countersOk(key, p)) return false;
    if (this._degraded(p)) return p.format === "rewarded";
    return !this.active;
  }

  /** 是否走静默降级（未开通账号 / mock 渠道 / 没填广告位 id / 渠道没就绪） */
  _degraded(p) {
    return !this.live || this.cfg.provider === "mock" || !p.id || !this._provider;
  }

  /** maxPerRun / cooldownMs / everyNPlays / 会话插屏配额 —— 两种模式都判 */
  _countersOk(key, p) {
    const max = Number(p.maxPerRun);
    if (Number.isFinite(max) && max > 0 && (this.usagePerRun.get(key) || 0) >= max) return false;
    const cd = Number(p.cooldownMs) || 0;
    if (cd > 0 && Date.now() - (this.lastShownAt.get(key) || 0) < cd) return false;

    if (p.format === "interstitial") {
      const every = Number(p.everyNPlays) || 0;
      if (every > 0 && (this.plays === 0 || this.plays % every !== 0)) return false;
      const cap = this.global.maxInterstitialPerSession;
      if (cap > 0 && this.interstitialsShown >= cap) return false;
      const gcd = this.global.interstitialCooldownMs;
      if (gcd > 0 && Date.now() - this.lastInterstitialAt < gcd) return false;
    }
    return true;
  }

  /* ------------------------------ 播放 ------------------------------ */

  /**
   * 播一个广告位。永不 reject。
   * @param {string} key ADS_CONFIG.placements 的键
   * @param {object} [ctx] 埋点上下文（{score, level} 之类）
   * @returns {Promise<{ok:boolean, reward:string|null, reason:string, mocked:boolean}>}
   */
  async show(key, ctx) {
    const p = this.placement(key);
    const result = (ok, reason, extra) =>
      Object.assign({ ok: !!ok, reward: p ? p.reward || null : null, reason, mocked: false }, extra || {});

    if (!p) return result(false, "unknown-placement");
    if (this.active) return result(false, "busy");
    if (!this._countersOk(key, p)) return result(false, "limit");

    /* ---------- 静默降级：没开 SDK / mock 渠道 / 没填 id ---------- */
    if (this._degraded(p)) return this._mockedShow(key, p);

    /* ---------- 真渠道 ---------- */
    this._beginAd(key);
    this._track("ad", { placement: key, format: p.format, step: "start", ctx: ctx || null });
    try {
      const call =
        p.format === "rewarded"
          ? this._provider.rewarded(key, p)
          : p.format === "banner"
            ? this._provider.banner(key, p)
            : this._provider.interstitial(key, p, ctx || {});
      const res = await this._withTimeout(call, this.global.fillTimeoutMs);
      const ok = p.format === "rewarded" ? res === true || res === "granted" : res !== false;
      this._track("ad", { placement: key, format: p.format, step: "end", ok });
      return result(ok, ok ? "shown" : "no-fill");
    } catch (e) {
      this._track("ad", { placement: key, format: p.format, step: "error", msg: String((e && e.message) || e) });
      /* 超时/报错：激励按失败处理（不发奖），插屏按已消化处理（不重试轰炸） */
      return result(false, e && e.message === "ad-timeout" ? "timeout" : "error");
    } finally {
      this._endAd(key, p);
    }
  }

  /** 便捷封装：激励视频 → 是否发奖 */
  async showRewarded(key, ctx) {
    const p = this.placement(key);
    if (!p || p.format !== "rewarded") return { ok: false, reward: null, reason: "wrong-format", mocked: false };
    return this.show(key, ctx);
  }

  /** 便捷封装：插屏（永不阻塞游戏，失败也返回） */
  async showInterstitial(key, ctx) {
    const p = this.placement(key);
    if (!p || p.format !== "interstitial") return { ok: false, reward: null, reason: "wrong-format", mocked: false };
    return this.show(key, ctx);
  }

  /** 横幅：未启用/没填 id 立即返回，不做任何 DOM 操作（容器由 UI 自己管） */
  async showBanner(key) {
    const p = this.placement(key);
    if (!p || p.format !== "banner") return { ok: false, reward: null, reason: "wrong-format", mocked: false };
    return this.show(key);
  }

  /**
   * 静默降级播放：激励视频按 global.simulateMs 模拟「看完」，插屏/横幅立即返回。
   * 依然走一遍暂停/静音/遮罩流程，保证接真 SDK 时表现一致。
   */
  async _mockedShow(key, p) {
    const isRewarded = p.format === "rewarded";
    const ms = isRewarded ? this.global.simulateMs : 0;

    this._beginAd(key);
    this._track("ad", { placement: key, format: p.format, step: "mock" });
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    this._endAd(key, p);

    return {
      ok: isRewarded || p.format === "interstitial",
      reward: p.reward || null,
      reason: "mocked",
      mocked: true,
    };
  }

  /* --------------------------- 生命周期 --------------------------- */

  /** 暂停主循环 + 静音 + 显示遮罩 */
  _beginAd(key) {
    this.active = key;
    if (this.hooks.onOverlayShow) this.hooks.onOverlayShow(key, this.cfg.mockTextKey || "ad_playing");
    if (this.global.muteAudioDuringAd && this.audio && this.audio.muteForAd) this.audio.muteForAd();
    if (this.global.pauseGameDuringAd && this.hooks.onPause) this.hooks.onPause("ad");
  }

  /** 恢复主循环 + 解除静音 + 收遮罩 + 记计数 */
  _endAd(key, p) {
    if (this.global.pauseGameDuringAd && this.hooks.onResume) this.hooks.onResume("ad");
    if (this.global.muteAudioDuringAd && this.audio && this.audio.unmuteAfterAd) this.audio.unmuteAfterAd();
    if (this.hooks.onOverlayHide) this.hooks.onOverlayHide(key);

    this.usagePerRun.set(key, (this.usagePerRun.get(key) || 0) + 1);
    this.lastShownAt.set(key, Date.now());
    if (p && p.format === "interstitial") {
      this.interstitialsShown += 1;
      this.lastInterstitialAt = Date.now();
    }
    if (this.active === key) this.active = null;
  }

  /** 每开新的一局：清零 maxPerRun 计数 */
  resetRun() {
    this.usagePerRun.clear();
    return this;
  }

  /** 每结束一局：推进 everyNPlays 计数（main.js 在结算里调用） */
  onRunFinished() {
    this.plays = Math.min(1e9, this.plays + 1);
    return this.plays;
  }

  /** 兼容旧命名 */
  countPlay() {
    return this.onRunFinished();
  }

  /* ------------------------------ 渠道 ------------------------------ */

  /**
   * 真渠道初始化（瘦桩）。只有 config.provider 命中且对应全局 SDK 对象存在时
   * 才返回可用适配器，否则记录错误并让 show() 走静默降级。
   */
  _initProvider() {
    const name = this.cfg.provider;
    const pc = (this.cfg.providerConfig || {})[name] || {};
    try {
      if (name === "poki") this._provider = pokiAdapter(pc, this.cfg);
      else if (name === "crazygames") this._provider = crazyGamesAdapter(pc, this.cfg);
      else this._provider = null;
    } catch (e) {
      this._provider = null;
      this._providerError = String((e && e.message) || e);
      console.warn("[ads] provider unavailable:", name, this._providerError);
    }
    return this._provider;
  }

  /* ------------------------------ 小工具 ------------------------------ */

  _withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error("ad-timeout"));
      }, ms);
      Promise.resolve(promise).then(
        (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  _track(event, payload) {
    if (this.sdk && typeof this.sdk.track === "function") {
      try {
        this.sdk.track(event, payload);
      } catch (e) {
        /* 埋点失败不影响游戏 */
      }
    }
  }
}

/* -------------------------------------------------------------------------
 * 渠道瘦桩（thin stubs）：只负责把门户 SDK 的调用形参对齐成这里的
 * {rewarded, interstitial, banner} 三件套，不做任何游戏侧决策。
 * 现在没有账号 —— ADS_CONFIG.enabled=false，它们永远不会被激活。
 * ---------------------------------------------------------------------- */

/** Poki：window.PokiSDK 必须已由门户注入（或由 providerConfig.sdkUrl 动态加载） */
function pokiAdapter(providerConfig) {
  const P = typeof window !== "undefined" ? window.PokiSDK : null;
  if (!P) throw new Error("PokiSDK 未加载");
  if (P.init) P.init();
  return {
    rewarded: async () => (await P.rewardedBreak()) !== false,
    interstitial: async () => {
      if (P.commercialBreak) await P.commercialBreak();
      return true;
    },
    banner: async () => {
      if (P.gameplayStart) P.gameplayStart();
      return true;
    },
  };
}

/** CrazyGames：window.CrazyGames.SDK 由 https://sdk.crazygames.com/* 注入 */
function crazyGamesAdapter(providerConfig) {
  const cg = typeof window !== "undefined" && window.CrazyGames ? window.CrazyGames.SDK : null;
  if (!cg || !cg.ad) throw new Error("CrazyGames SDK 未加载");
  if (cg.game && cg.game.loadingStart) cg.game.loadingStart();
  return {
    rewarded: async () => {
      await cg.ad.requestAd("rewarded");
      return true;
    },
    interstitial: async () => {
      await cg.ad.requestAd("midgame");
      return true;
    },
    banner: async () => {
      await cg.ad.requestAd("banner");
      return true;
    },
  };
}

/**
 * 工厂：`createAds({ config: ADS_CONFIG, audio, sdk: window.GameSDK })`
 * @param {{config?:object, audio?:object, sdk?:object}} opts
 */
export function createAds(opts) {
  const ads = new AdsBridge(opts || {});
  /* 只有真渠道才初始化适配器；mock/未启用直接走降级路径 */
  if (ads.live && ads.cfg.provider !== "mock") ads._initProvider();
  return ads;
}

export default AdsBridge;
