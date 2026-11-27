/**
 * PRISM CRUSH · 域名锁配置
 * =====================================================================
 * 只有 localhost / 127.0.0.1 / pipygames.com 允许正常运行。
 * 其它域名：页面照常加载完成 → 停留 redirectDelayMs（3 秒）→ 跳回主站。
 * file:// 与本地 IP 放行，方便双击 dist/index.html 验收。
 * =====================================================================
 */

export const DOMAIN_CONFIG = {
  /** 总开关：关掉即完全不做域名校验（本地排查用） */
  enabled: true,

  /** 允许运行的主机名（精确匹配 + 子域匹配见 core/domain.js） */
  allowedHosts: [
    'localhost',
    '127.0.0.1',
    '::1',
    'pipygames.com',
    'www.pipygames.com',
  ],

  /** 非白名单域名的跳转目标 */
  redirectUrl: 'https://pipygames.com',

  /** 加载完成后停留多久再跳转（需求：3 秒） */
  redirectDelayMs: 3000,

  /** 双击 file:// 打开时是否放行（交付验收方式，保持 true） */
  allowFileProtocol: true,

  /** 是否允许被 iframe 嵌入（门户站抓取时用于判断是否顶层跳转） */
  allowIframe: true,

  /** 命中域名锁时是否在游戏画面上显示倒计时提示 */
  showNotice: true,

  /** 调试：只打印不跳转 */
  debug: false,
};

/** 分享链接基址（分享面板与 OG 标签共用） */
export const SHARE_BASE_URL = 'https://pipygames.com/games/prism-crush/';

export default DOMAIN_CONFIG;
