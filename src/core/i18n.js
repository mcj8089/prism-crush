/**
 * PRISM CRUSH · 语言层（EN 默认 / ZH 由 URL 决定）
 * =====================================================================
 * 规则（需求锁定）：
 *   1. 语言只来自 URL：?lang=zh | cn | zh-CN → 中文；其余（含 ?lang=en）→ 英文；
 *   2. 游戏内不提供任何语言切换按钮，`set()` 只给启动流程 / 自动化验收用；
 *   3. 单页单语：缺 key 时返回 key 本身，绝不回退另一种语言的文案，
 *      避免出现「英文标签 + 中文正文」的混排（config/locales.js 的键集
 *      由 verify 做全等比对，正常情况永远命中不到这条兜底）；
 *   4. 插值语法 {var}，只替换调用方真实传入的键，未知占位符原样保留。
 *
 * 用法（main.js）：
 *   const i18n = createI18n();      // 默认吃 config/locales.js
 *   i18n.detect();                  // 读 URL 定语言 + 写 <html lang>
 *   i18n.apply(document);           // 刷掉所有 data-i18n* 节点
 *   i18n.t("toast_levelup", { level: 3 });
 * =====================================================================
 */

import { LOCALES, DEFAULT_LOCALE } from "../../config/locales.js";

/* 语言码 → <html lang> 属性值（SEO 需要完整区域码） */
const HTML_LANG = { en: "en", zh: "zh-CN" };

/* URL 参数里视为中文的写法（需求：?lang=zh|cn|zh-CN） */
const ZH_ALIASES = ["zh", "cn", "zh-cn", "zh-hans"];

/** 归一任意语言码到本包支持的 'en' / 'zh'；无法识别返回 null（交给默认值） */
function normalizeCode(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s) return null;
  if (ZH_ALIASES.includes(s) || s.startsWith("zh-")) return "zh";
  if (s === "en" || s.startsWith("en-")) return "en";
  return null;
}

/** {var} 插值：vars 里没有的占位符原样留着，方便肉眼发现漏传 */
function interpolate(str, vars) {
  if (!vars || typeof vars !== "object") return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) =>
    vars[k] != null ? String(vars[k]) : m
  );
}

export class I18n {
  /**
   * @param {object} [packs] 语言包，形如 config/locales.js 的 LOCALES
   * @param {object} [opts]  { fallback: 'en' }
   */
  constructor(packs, opts) {
    const o = opts || {};
    this.packs = packs && typeof packs === "object" ? packs : LOCALES;
    this.fallback = normalizeCode(o.fallback) || normalizeCode(DEFAULT_LOCALE) || "en";
    /** 当前语言码（'en' | 'zh'） */
    this.lang = this.packs[this.fallback] ? this.fallback : "en";
    /** onChange 订阅者 */
    this.listeners = [];
  }

  /* ----------------------------- 语言判定 ----------------------------- */

  /**
   * 只读 URL：?lang=zh / cn / zh-CN → 'zh'，否则 'en'。
   * 不读 navigator.language、不读存档、不读 cookie —— 需求如此。
   * @returns {'en'|'zh'}
   */
  detect() {
    let code = null;
    try {
      const raw = new URLSearchParams(location.search).get("lang");
      code = normalizeCode(raw);
    } catch (e) {
      /* node / 无 URL 环境：保持默认语言 */
    }
    this.lang = code || this.fallback;
    this._syncHtmlLang();
    return this.lang;
  }

  /** 当前语言码 */
  get locale() {
    return this.lang;
  }

  /** 中文便捷判定 */
  get isZh() {
    return this.lang === "zh";
  }

  /** 语言包实际提供的语言（供 UI / verify 展示） */
  get languages() {
    return Object.keys(this.packs);
  }

  /**
   * 设定语言（仅启动流程与自动化验收使用；界面里没有开关）。
   * 未知语言码一律退回默认语言，绝不留下半吊子状态。
   * @param {string} code
   * @returns {'en'|'zh'} 实际生效的语言
   */
  set(code) {
    const next = normalizeCode(code);
    this.lang = next && this.packs[next] ? next : this.fallback;
    this._syncHtmlLang();
    for (const fn of this.listeners) {
      try {
        fn(this.lang);
      } catch (e) {
        /* 订阅者异常不影响语言切换 */
      }
    }
    return this.lang;
  }

  /** 语言变化订阅（UI 重绘用） */
  onChange(fn) {
    if (typeof fn === "function") this.listeners.push(fn);
    return fn;
  }

  /* ------------------------------ 取文案 ------------------------------ */

  /** 该 key 在当前语言包里是否存在 */
  has(key) {
    const pack = this.packs[this.lang] || {};
    return pack[key] != null;
  }

  /**
   * 翻译一条文案。
   * @param {string} key      locales 里的扁平 snake_case 键
   * @param {object} [vars]   {var} 插值字典
   * @returns {string} 命中当前语言 → 文案；缺 key → 原样返回 key（不混语言）
   */
  t(key, vars) {
    const pack = this.packs[this.lang] || {};
    const hit = pack[key];
    if (hit == null) return String(key == null ? "" : key);
    return interpolate(hit, vars);
  }

  /** 批量取当前语言整包（渲染表格 / 调试面板用，返回拷贝） */
  pack() {
    return Object.assign({}, this.packs[this.lang] || {});
  }

  /* ------------------------------ 刷 DOM ------------------------------ */

  /**
   * 把作用域内所有 i18n 标记节点重写成当前语言。
   *   [data-i18n]        → textContent（纯文本，防注入）
   *   [data-i18n-html]   → innerHTML（只用于包内可信文案，属性值是 key）
   *   [data-i18n-ph]     → placeholder
   *   [data-i18n-title]  → title
   * 注意：属性值就是 locales 的 key；插值需要在 JS 里调 t() 手工完成。
   * @param {ParentNode} [root]
   */
  apply(root) {
    const scope = root || (typeof document !== "undefined" ? document : null);
    if (!scope || typeof scope.querySelectorAll !== "function") return 0;
    let touched = 0;

    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = this.t(el.getAttribute("data-i18n"));
      touched++;
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = this.t(el.getAttribute("data-i18n-html"));
      touched++;
    });
    scope.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", this.t(el.getAttribute("data-i18n-ph")));
      touched++;
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", this.t(el.getAttribute("data-i18n-title")));
      touched++;
    });

    this._syncHtmlLang();
    return touched;
  }

  /** <html lang> 与文案同步（SEO / 读屏器要求完整区域码） */
  _syncHtmlLang() {
    try {
      document.documentElement.lang = HTML_LANG[this.lang] || this.lang;
    } catch (e) {
      /* 非浏览器环境（verify 的 node 侧）静默跳过 */
    }
  }
}

/**
 * 工厂：main.js 用 `createI18n()` 即拿到读好 config/locales.js 的实例。
 * @param {object} [locales] 自定义语言包
 */
export function createI18n(locales) {
  return new I18n(locales);
}

export default I18n;
