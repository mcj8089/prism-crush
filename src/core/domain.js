/**
 * PRISM CRUSH · 域名锁（防搬运）
 * =====================================================================
 * 需求口径：
 *   · 白名单：localhost / 127.0.0.1 / ::1 / pipygames.com（含 www 与子域）
 *     + 任意 192.168.*.* 与 10.*.*.* 局域网地址（团队手机验收用）
 *     + file://（allowFileProtocol=true，双击 dist/index.html 即可玩）；
 *   · 非白名单：页面照常加载完（搬运工能看到画面）→ 停留 redirectDelayMs
 *     （3000ms）→ 跳回 redirectUrl；
 *   · 验收环境永不拦截：verify 跑在 localhost / file://，命中放行分支，
 *     同时本模块把判定结果完整暴露（state / locked），UI 可以自己渲染。
 *
 * 配置权威：config/domains.config.js 的 DOMAIN_CONFIG（main.js 传进来）。
 * =====================================================================
 */

/** host 归一：小写、去尾点、去端口，兼容 [::1]:8080 这类带括号的 IPv6 写法 */
function normalizeHost(host) {
  const h = String(host == null ? "" : host).toLowerCase().replace(/\.$/, "");
  const bracketed = h.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1]; // "[::1]:8080" → "::1"
  if (h.includes(".") || /^[a-z]/.test(h)) return h.replace(/:\d+$/, ""); // host:port → host
  return h; // 裸写 ::1 保持原样（浏览器 hostname 不会出现这种形态）
}

/** 白名单匹配：精确相等或子域（pattern 可写 *.example.com / example.com） */
function matchPattern(host, pattern) {
  const h = normalizeHost(host);
  let p = normalizeHost(pattern);
  if (!h || !p) return false;
  if (p.startsWith("*.")) p = p.slice(2);
  return h === p || h.endsWith("." + p);
}

/** 本地/局域网一律放行（开发机、手机真机、自动化验收都靠这条） */
function isLocalHost(host) {
  const h = normalizeHost(host);
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    /^192\.168\./.test(h) ||
    /^10\./.test(h)
  );
}

export class DomainGuard {
  /**
   * @param {object} cfg config/domains.config.js 的 DOMAIN_CONFIG
   */
  constructor(cfg) {
    this.cfg = cfg || {};
    /** 最近一次 check() 的结果（UI / verify 直接读它，不必再算） */
    this.state = null;
    /** 是否已经进入锁定倒计时 */
    this.locked = false;
    /** 倒计时订阅者（剩余秒数） */
    this.onTick = null;
    this._tickTimer = null;
    this._redirectTimer = null;
    this._redirected = false;
  }

  /** 本实例白名单判定一个 host（不含本地/局域网放行） */
  matchHost(host) {
    const list = this.cfg.allowedHosts || [];
    return list.some((p) => matchPattern(host, p));
  }

  /**
   * 纯同步判定，不产生任何副作用（UI 可以在启动前就调它渲染提示）。
   * @returns {{ok:boolean, host:string, protocol:string, reason:string,
   *            redirectUrl:string, delayMs:number}}
   */
  check() {
    let host = "";
    let protocol = "";
    try {
      host = normalizeHost(location.hostname);
      protocol = location.protocol;
    } catch (e) {
      /* node / 无 location：视为离线，按 file 处理 */
      protocol = "none:";
    }

    const cfg = this.cfg;
    let ok = false;
    let reason = "host-not-allowed";

    if (cfg.enabled === false) {
      ok = true;
      reason = "disabled";
    } else if (protocol === "file:") {
      ok = cfg.allowFileProtocol !== false;
      reason = ok ? "file-protocol" : "file-protocol-blocked";
    } else if (isLocalHost(host)) {
      ok = true;
      reason = "local-dev";
    } else if (this.matchHost(host)) {
      ok = true;
      reason = "ok";
    }

    this.state = {
      ok,
      host,
      protocol,
      reason,
      redirectUrl: cfg.redirectUrl || "",
      delayMs: Math.max(0, Number(cfg.redirectDelayMs) || 0),
    };
    if (cfg.debug) {
      console.log(
        "%c[DOMAIN] " + (ok ? "✔ 放行" : "✘ 未授权") + " " + (host || protocol) + " · " + reason,
        "color:" + (ok ? "#3dffa0" : "#ff4567")
      );
    }
    return this.state;
  }

  /**
   * 判定 + （必要时）倒计时跳转。
   * @param {object} [hooks]
   *        @param {(info:{redirectUrl:string,delayMs:number,host:string,reason:string})=>void} [hooks.onLock]
   *        锁定瞬间回调一次：UI 在这里显示「{seconds}s 后跳转」文案。
   *        @param {(secondsLeft:number)=>void} [hooks.onTick] 每 250ms 一次，供倒计时动画。
   *        @param {boolean} [hooks.enforce] 传 false 只判定不跳转（验收 / 排查用，
   *        等价于 DOMAIN_CONFIG.enforce=false；白名单环境本来就不会走到这里）。
   * @returns {boolean} true = 已被锁（正在倒计时/已跳转），false = 放行
   */
  guard(hooks) {
    const cb = hooks || {};
    const res = this.check();
    if (res.ok) return false;
    if (cb.enforce === false || this.cfg.enforce === false) return false;

    this.locked = true;
    this.onTick = typeof cb.onTick === "function" ? cb.onTick : null;
    const delayMs = res.delayMs;
    const info = { redirectUrl: res.redirectUrl, delayMs, host: res.host, reason: res.reason };

    if (typeof cb.onLock === "function") cb.onLock(info);

    const started = Date.now();
    this._tickTimer = setInterval(() => {
      const left = Math.max(0, delayMs - (Date.now() - started));
      if (this.onTick) this.onTick(Math.ceil(left / 1000));
      if (left <= 0) {
        this._clearTimers();
        this.redirect();
      }
    }, 250);

    /* 双保险：后台标签页会把 setInterval 节流到 1s 以上，这条保证准点跳转 */
    this._redirectTimer = setTimeout(() => this.redirect(), delayMs + 500);
    return true;
  }

  /** 立即跳转（遮罩上的「立即前往」按钮用） */
  goNow() {
    this._clearTimers();
    this.redirect();
  }

  /**
   * 顶层窗口优先（!allowIframe 时要把宿主 iframe 一起带出去），
   * 跨域访问 window.top 抛错则退回当前窗口。
   */
  redirect() {
    const url = this.cfg.redirectUrl;
    if (!url || this._redirected) return;
    this._redirected = true;
    this._clearTimers();
    try {
      if (!this.cfg.allowIframe && typeof window !== "undefined" && window.top && window.top !== window.self) {
        window.top.location.href = url;
        return;
      }
    } catch (e) {
      /* 跨域 iframe 摸不到 top.location，落到下一句 */
    }
    try {
      location.replace(url);
    } catch (e) {
      try {
        location.href = url;
      } catch (e2) {
        /* 无法跳转（沙箱 iframe）：保持锁定态，UI 自己提示 */
      }
    }
  }

  /** 停表（卸载 / 单测用） */
  cancel() {
    this._clearTimers();
    this.locked = false;
  }

  _clearTimers() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    if (this._redirectTimer) {
      clearTimeout(this._redirectTimer);
      this._redirectTimer = null;
    }
  }
}

/**
 * 工厂：`const domain = createDomainGuard(DOMAIN_CONFIG)`
 * main.js 用法：`domain.guard({ onLock, onTick })` → 返回 false 就正常启动游戏。
 */
export function createDomainGuard(cfg) {
  return new DomainGuard(cfg);
}

export { normalizeHost, matchPattern, isLocalHost };
export default DomainGuard;
