/**
 * PRISM CRUSH · 广告预设（已埋点，暂未开通账号）
 * =====================================================================
 * 现在 enabled:false —— 所有广告位走「静默降级」：
 *   · 激励视频：直接 resolve(true)，玩家照常拿到奖励；
 *   · 插屏/横幅：立即 resolve，不阻塞游戏。
 * 之后接账号只需改 provider + 填 id + 打开 enabled，业务代码零改动。
 * =====================================================================
 */

export const ADS_CONFIG = {
  /** 总开关（开通广告账号后改 true） */
  enabled: false,

  /** 渠道：'mock' | 'poki' | 'crazygames' | 'gamemonetize' | 'custom' */
  provider: 'mock',

  global: {
    /** 广告播放期间暂停游戏主循环 */
    pauseGameDuringAd: true,
    /** 广告播放期间静音 BGM/SFX */
    muteAudioDuringAd: true,
    /** 广告拉取超时（毫秒），超时按失败处理并放行游戏 */
    fillTimeoutMs: 9000,
    /** mock 渠道模拟时长 */
    simulateMs: 1200,
    /** 每次会话最多插屏次数（防打扰） */
    maxInterstitialPerSession: 6,
    /** 两次插屏最小间隔 */
    interstitialCooldownMs: 90000,
  },

  /**
   * 广告位清单。
   * format: 'rewarded' 激励 / 'interstitial' 插屏 / 'banner' 横幅
   */
  placements: {
    /** 失败后「用钻石复活一次」 */
    reviveRun: {
      format: 'rewarded',
      enabled: false,
      id: '',
      maxPerRun: 2,
      cooldownMs: 0,
      reward: 'revive',
    },
    /** 结算页：看广告让本局得分翻倍 */
    doubleScore: {
      format: 'rewarded',
      enabled: false,
      id: '',
      maxPerRun: 1,
      reward: 'double_score',
    },
    /** 每局结束后插屏 */
    afterRun: {
      format: 'interstitial',
      enabled: false,
      id: '',
      everyNPlays: 2,
      cooldownMs: 90000,
    },
    /** 主菜单横幅 */
    menuBanner: {
      format: 'banner',
      enabled: false,
      id: '',
      slot: 'menu',
    },
  },

  /** 各渠道参数（开通时填） */
  providerConfig: {
    poki: { appId: '', sdkUrl: 'https://game.api.poki.com/poki-sdk.js' },
    crazygames: { appId: '', sdkUrl: 'https://ads.crazygames.com/containercreative2.js' },
    gamemonetize: { appId: '', sdkUrl: '' },
    custom: { sdkUrl: '', init: null },
  },

  /** mock 渠道在画面上显示的文案 key（走 locales，不硬编码中文） */
  mockTextKey: 'ad_playing',
};

export default ADS_CONFIG;
