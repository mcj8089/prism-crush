/**
 * PRISM CRUSH · 水晶方块 — 主装配层
 * =====================================================================
 * 唯一把「玩法引擎 / 美术 / 音频 / UI / SDK」接在一起的地方。
 * 玩法判定全部在 src/game/*，这里只做组装、事件分发与表现层驱动。
 *
 * 对外测试门面：window.__PRISMCRUSH__ = { api, version }
 * =====================================================================
 */

import GAME_CONFIG, { BOARD, STAGE, GEMS, ASSETS, FX } from '../config/game.config.js';
import LOCALES from '../config/locales.js';
import DOMAIN_CONFIG, { SHARE_BASE_URL } from '../config/domains.config.js';
import ADS_CONFIG from '../config/ads.config.js';

import { createI18n } from './core/i18n.js';
import { createSave } from './core/save.js';
import { createAudio } from './core/audio.js';
import { createDomainGuard } from './core/domain.js';
import { createAds } from './core/ads.js';

import { Game } from './game/game.js';
import { InputController } from './game/input.js';
import { AutoDriver } from './game/autoplay.js';

import { Renderer } from './art/renderer.js';
import { FxSystem } from './art/fx.js';
import { drawGem } from './art/gems.js';
import { paintCavern, paintHero, paintGemCanvas, decorateUiGems } from './art/menuart.js';

import { UI } from './ui/ui.js';
import { SharePanel } from './ui/share.js';
import { Tutorial } from './ui/tutorial.js';

/* ------------------------------------------------------------------ */
/* 启动参数                                                            */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const DEBUG = params.has('debug');
const AUTOPLAY = params.get('autoplay') === '1' || params.has('autoplay');
const SKIP_TUTORIAL = params.get('tutorial') === '0' || AUTOPLAY;
const FROM_REF = params.get('from') || '';

/** 资源清单挂到 window，供构建脚本 / SDK 读取 */
window.__PRISM_CRUSH_ASSETS__ = ASSETS;

/* 帧异常哨兵：先建好空数组，loop 的 catch 只往里塞。
   空数组 = 「真的一帧都没炸」，比「变量不存在」可信，验收脚本也才敢断言长度为 0。 */
window.__FRAME_ERRORS = [];

/* ------------------------------------------------------------------ */
/* SDK                                                                 */
/* ------------------------------------------------------------------ */

const SDK_BOOT = { ads: ADS_CONFIG, protect: DOMAIN_CONFIG, save: { key: GAME_CONFIG.meta.saveKey } };
/** 线上 pipysdk.min.js 与本地 src/sdk/gamesdk.js 是同一套接口的两种投递，谁先到用谁 */
const pickSdk = () => window.GameSDK || window.PipySDK || null;
function initSdk(s) {
  if (!s || typeof s.init !== 'function') return;
  try { s.init(SDK_BOOT); } catch (err) { if (DEBUG) console.warn('[sdk] init skipped', err); }
}

let sdk = pickSdk();
initSdk(sdk);
/* index.html 里的线上 SDK 标签带 async，可能在 ES Module 之后才落地 —— 再认一次。
   认不上也没关系：埋点走 track() 的静默分支，玩法与存档完全不依赖 SDK。 */
window.addEventListener('load', () => {
  if (sdk) return;
  sdk = pickSdk();
  initSdk(sdk);
}, { once: true });

/** 统一埋点：SDK 在则走 SDK，否则静默（永不影响玩法） */
function track(event, payload = {}) {
  try {
    if (sdk && typeof sdk.track === 'function') sdk.track(event, payload);
    else if (sdk && sdk.tracker && typeof sdk.tracker.push === 'function') sdk.tracker.push(event, payload);
  } catch (err) { /* 埋点永不影响玩法 */ }
  if (DEBUG) console.log('[track]', event, payload);
}

/* ------------------------------------------------------------------ */
/* 平台服务                                                            */
/* ------------------------------------------------------------------ */

const i18n = createI18n(LOCALES);
i18n.detect();                  // ?lang=zh → 'zh'，否则默认 en（游戏内无语言按钮）

const save = createSave({ config: GAME_CONFIG, sdk });
const audio = createAudio({ config: GAME_CONFIG, save, debug: DEBUG });
const domain = createDomainGuard(DOMAIN_CONFIG);
const ads = createAds({ config: ADS_CONFIG, audio, sdk });

/* ------------------------------------------------------------------ */
/* 引擎与表现实例                                                      */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById('game-canvas');
const renderer = new Renderer(canvas, {
  cell: BOARD.cell,
  options: { ghost: save.settings.ghost !== false },
});
const fx = new FxSystem({ shake: save.settings.shake !== false, particles: save.settings.particles !== false });

const game = new Game({
  onEvent: (type, payload) => onGameEvent(type, payload),
  readStorage: (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  writeStorage: (k, v) => { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* 隐私模式忽略 */ } },
});

const ui = new UI({ i18n, onAction: (a) => handleAction(a), save, onSound: (n) => playSfx(n) });
// SharePanel 的构造过程会回调 getState()，此时 const share 还在 TDZ 里，
// 所以用这个稍后赋值的引用读昵称。
let shareRef = null;
const share = new SharePanel({
  i18n,
  ui,
  baseUrl: SHARE_BASE_URL,
  gameCanvas: () => canvas,
  getState: () => ({
    score: game.score, level: game.level, lines: game.lines,
    best: game.highScore, name: shareRef ? shareRef.name : '',
  }),
  track: (event, payload) => track(event, payload),
});
shareRef = share;
const tutorial = new Tutorial({
  i18n,
  ui,
  onSound: (n) => playSfx(n),
  onDone: () => { save.markSeenHowto(); startRun(); },
});

/* ------------------------------------------------------------------ */
/* 视觉状态（纯表现，不参与判定）                                       */
/* ------------------------------------------------------------------ */

const vis = {
  timeMs: 0,
  tierIndex: 0,
  squash: 0,
  banners: [],
  ghostOffset: 0,
  smoothFall: true,
  labels: {},
  keys: [],
  tierNames: [],
  title: GAME_CONFIG.meta.title,
  subtitle: '',
  pausedLabel: '',
  pausedHint: '',
  levelRatio: 0,
  gaugeLabel: '',
};

let running = false;
let lastFrame = 0;
let gridRevCounter = 0;
let reviveUsed = 0;
let doubled = false;
let recordToasted = false;
let lastRun = null;
let driver = null;

/* ------------------------------------------------------------------ */
/* 音频封装                                                            */
/* ------------------------------------------------------------------ */

function st() { return save.settings; }
function sfxEnabled() { return !!st().sound; }

function playSfx(name, opt) {
  if (!sfxEnabled()) return;
  try { audio.playSfx(name, opt); } catch (e) { /* 音频失败不影响玩法 */ }
}

function applyAudioSettings() {
  const s = st();
  audio.setEnabled(!!s.sound);
  audio.setSubGates({ music: s.music !== false, effects: s.effects !== false });
  if (!s.sound || s.music === false) audio.stopBgm();
  else audio.setBgm(bgmForTier());
}

function bgmForTier() {
  const list = ASSETS.audio.bgm;
  return list[Math.min(list.length - 1, vis.tierIndex)] || list[0];
}

/** 首次用户手势解锁 AudioContext，之后预载全部音频 */
let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  Promise.resolve(audio.unlock()).then(() => audio.loadAll()).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* 事件 → 表现层                                                       */
/* ------------------------------------------------------------------ */

const CRUSH_KEYS = { 1: 'crush_crack', 2: 'crush_split', 3: 'crush_fracture', 4: 'crush_prism' };

function onGameEvent(type, payload) {
  switch (type) {
    case 'start':
      vis.banners.length = 0;
      vis.tierIndex = 0;
      gridRevCounter++;
      renderer.invalidateStack();
      break;
    case 'move':
      playSfx('move', { gain: 0.35 });
      break;
    case 'rotate':
      playSfx('rotate', { gain: 0.5 });
      break;
    case 'softDrop':
      playSfx('soft_drop', { gain: 0.4 });
      break;
    case 'lock': {
      gridRevCounter++;
      vis.squash = FX.land.squash;
      const b = fx.boardRect();
      const cells = payload.shape.cells();
      let maxY = -1; let cx = 0;
      for (const c of cells) { if (c.y > maxY) { maxY = c.y; cx = c.x; } }
      fx.land(b.x + (cx + 0.5) * b.cell, b.y + (maxY + 1) * b.cell, b.cell,
        payload.shape.blockType, game.board.stackTop() < BOARD.rows * 0.4);
      playSfx('lock', { gain: 0.6 });
      break;
    }
    case 'clear': {
      gridRevCounter++;
      fx.shatter(payload.rows, payload.lines);
      playSfx(payload.lines >= 3 ? 'shatter_big' : 'shatter_small');
      if (payload.lines >= 3) playSfx('combo_roar', { throttleMs: 0 });
      addBanner(i18n.t(CRUSH_KEYS[Math.min(4, payload.lines)] || 'crush_prism'), {
        size: 54 + payload.lines * 6,
        mid: payload.lines >= 4 ? '#ffe9a8' : '#9ff3ff',
        deep: payload.lines >= 4 ? '#ff7a45' : '#2b6cff',
        glow: payload.lines >= 4 ? '#ffd88a' : '#3ff0d0',
      });
      addBanner(i18n.t('crush_points', { score: payload.gained }), {
        at: 0.62, size: 30, ttl: 1100, mid: '#ffffff', deep: '#8f6bff',
      });
      break;
    }
    case 'levelup': {
      const tier = tierOf(payload.level);
      if (tier !== vis.tierIndex) {
        vis.tierIndex = tier;
        renderer.invalidateBg();       // 换深度：背景重烘（下一帧按新层色调重画）
      }
      fx.levelUp();
      playSfx('level_up');
      if (sfxEnabled() && st().music !== false) audio.setBgm(bgmForTier());
      addBanner(`${i18n.t('hud_level')} ${payload.level}`, {
        size: 74, mid: '#ffe9a8', deep: '#ff7a45', glow: '#ffd88a', ttl: FX.levelUp.bannerMs,
      });
      ui.toast('toast_levelup', { level: payload.level }, 'warn');
      track('level_up', { level: payload.level });
      break;
    }
    case 'highscore':
      // 每消一行都会再次越过纪录，只播报第一次
      if (!recordToasted) { recordToasted = true; ui.toast('toast_new_record'); }
      break;
    case 'over':
      gridRevCounter++;
      fx.collapse(game.board.grid, fx.boardRect().cell);
      playSfx('game_over');
      break;
    case 'pause':
      audio.suspend();
      break;
    case 'resume':
      audio.resume();
      break;
    case 'end':
      endRun();
      break;
    default:
      break;
  }
}

function tierOf(level) {
  const tiers = GAME_CONFIG.themes.tiers;
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) if (level >= tiers[i].from) idx = i;
  return idx;
}

function addBanner(text, opt = {}) {
  vis.banners.push({
    text,
    at: opt.at ?? 0.34,
    size: opt.size || 62,
    mid: opt.mid, deep: opt.deep, glow: opt.glow,
    t: 0, ttl: opt.ttl || 1500,
  });
  if (vis.banners.length > 4) vis.banners.shift();
}

/* ------------------------------------------------------------------ */
/* 输入                                                                */
/* ------------------------------------------------------------------ */

const input = new InputController({
  onAction: (a) => handleAction(a),
  target: canvas,
  shouldIgnore: () => ui.screen !== 'game' || ui.modalOpen,
});

function handleAction(action) {
  if (ui.modalOpen) return;
  if (action === 'pause') {
    if (game.state === 'pause') { game.resume(); ui.close(); }
    else if (game.state === 'playing') game.pause();
    ui.syncPad();
    return;
  }
  game.input(action);
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

function loop(now) {
  if (!running) return;
  try {
    const dt = Math.min(120, now - (lastFrame || now));
    lastFrame = now;
    simulate(dt);
    paint();
  } catch (err) {
    // 一帧的绘制异常不该让整个循环熄火（RAF 不再续帧 = 画面永久冻结）
    if (DEBUG) console.error('[loop] frame error', err);
    if (window.__FRAME_ERRORS && window.__FRAME_ERRORS.length < 12) {
      window.__FRAME_ERRORS.push(String(err && (err.stack || err.message) || err));
    }
  }
  requestAnimationFrame(loop);
}

/** 推进模拟（api.step 直接调用，保证无头环境确定性） */
function simulate(dt) {
  vis.timeMs += dt;
  if (ui.screen === 'game') {
    if (driver && game.state === 'playing') {
      const act = driver.next();
      if (act) game.input(act);
    }
    game.step(dt);
    vis.ghostOffset = game.state === 'playing' ? game.board.ghostOffset() : 0;
  }
  fx.update(dt, GAME_CONFIG.themes.tiers[vis.tierIndex]);
  if (vis.squash > 0) vis.squash = Math.max(0, vis.squash - (dt / FX.land.timeMs) * FX.land.squash);
  for (const b of vis.banners) b.t += dt / b.ttl;
  vis.banners = vis.banners.filter((b) => b.t < 1);
  if (tutorial.active) tutorial.update(dt);
  syncHud();
}

function paint() {
  renderer.render(game.snapshot(), { ...vis, fx, gridRev: gridRevCounter });
}

/** HUD 文案（i18n 结果缓存，避免每帧查表） */
let labelLocale = null;
function syncHud() {
  if (labelLocale !== i18n.locale) {
    labelLocale = i18n.locale;
    const up = (k) => { const s = i18n.t(k); return i18n.isZh ? s : s.toUpperCase(); };
    vis.labels = {
      score: up('hud_score'),
      best: up('hud_highscore'),
      level: up('hud_level'),
      time: up('hud_timer'),
      next: up('hud_next'),
      lines: up('hud_lines'),
      controls: up('hud_controls'),
      depth: up('hud_depth'),
    };
    vis.tierNames = GAME_CONFIG.themes.tiers.map((t) => up(t.labelKey));
    vis.subtitle = i18n.t('menu_subtitle');
    vis.pausedLabel = i18n.t('state_paused');
    vis.pausedHint = i18n.t('state_paused_hint');
    vis.keys = [
      ['↑', i18n.t('hud_key_rotate').replace(/^[↑←→↓]\s*/, '')],
      ['←', i18n.t('hud_key_left').replace(/^[↑←→↓]\s*/, '')],
      ['→', i18n.t('hud_key_right').replace(/^[↑←→↓]\s*/, '')],
      ['↓', i18n.t('hud_key_down').replace(/^[↑←→↓]\s*/, '')],
    ];
  }
  const nextThreshold = Math.pow(2, game.level) * 100;
  const prevThreshold = game.level > 0 ? Math.pow(2, game.level - 1) * 100 : 0;
  vis.levelRatio = Math.max(0, Math.min(1, (game.score - prevThreshold) / Math.max(1, nextThreshold - prevThreshold)));
  vis.gaugeLabel = `${game.score} / ${nextThreshold}`;
}

/* ------------------------------------------------------------------ */
/* 流程                                                                */
/* ------------------------------------------------------------------ */

function startRun() {
  ui.showScreen('game');
  doubled = false;
  recordToasted = false;
  reviveUsed = 0;
  ads.resetRun();
  game.start();
  driver = AUTOPLAY ? new AutoDriver(game) : null;
  applyAudioSettings();
  ui.syncPad();
  track('game_start', {});
  resize();
  paint();
}

function endRun() {
  const cfg = ADS_CONFIG.placements;
  const data = {
    score: game.score,
    lines: game.lines,
    level: game.level,
    highScore: game.highScore,
    time: game.formatTime(),
    newRecord: game.score > 0 && game.score >= game.highScore,
    revivesLeft: Math.max(0, (cfg.reviveRun.maxPerRun || 0) - reviveUsed),
    reviveAvailable: !!cfg.reviveRun.enabled,
    doubleAvailable: !!cfg.doubleScore.enabled && !doubled,
  };
  lastRun = data;
  save.recordRun({ score: data.score, lines: data.lines, level: data.level });
  ads.onRunFinished();
  if (!cfg.reviveRun.enabled) data.reviveAvailable = false;
  audio.resume();
  audio.stopBgm();
  ui.showResult(data);
  ui.refreshMenu();
  track('game_over', { score: data.score, lines: data.lines, level: data.level });
}

function goMenu() {
  paintMenuArt();
  ui.showScreen('menu');
  ui.refreshMenu();
  ui.close();
  audio.stopBgm();
  track('menu', {});
}

/** 结算后的「复活」：清掉最顶两行晶堆，保留分数继续（广告奖励位） */
function reviveRun() {
  const grid = game.board.grid;
  for (let i = 0; i < 2; i++) grid[i] = grid[i].map(() => 0);
  game.board.shape = game.board._newShape();
  game.board.shape.setPosition(game.board.cols, game.board.rows, true);
  game.state = 'playing';
  gridRevCounter++;
  renderer.invalidateStack();
}

/* ------------------------------------------------------------------ */
/* 尺寸                                                                */
/* ------------------------------------------------------------------ */

function resize() {
  const size = ui.stageSize();
  renderer.resize(size.w, size.h);
  ui.syncPad();
}

window.addEventListener('resize', () => { resize(); paint(); });
window.addEventListener('orientationchange', () => setTimeout(resize, 220));

/* ------------------------------------------------------------------ */
/* UI 绑定                                                             */
/* ------------------------------------------------------------------ */

function maybeTutorialStart() {
  if (SKIP_TUTORIAL || save.data.seenHowto) startRun();
  else tutorial.open(0);
}

ui.bind({
  play: maybeTutorialStart,
  howto: () => track('howto_open', {}),
  share: () => share.open(),
  reset: () => {
    if (!window.confirm(i18n.t('menu_reset_confirm'))) return;
    save.reset();
    try { window.localStorage.removeItem('high-score'); } catch (e) { /* ignore */ }
    game.highScore = 0;
    ui.refreshMenu();
    ui.toast('toast_reset_done');
    track('save_reset', {});
  },
  pause: () => handleAction('pause'),
  home: () => goMenu(),
  again: () => startRun(),
  domainGo: () => domain.goNow(),
  revive: async () => {
    const res = await ads.show('reviveRun');
    if (!res || !res.ok) return;
    reviveUsed++;
    reviveRun();
    ui.close('result');
    applyAudioSettings();
    playSfx('start');
    ui.toast('ad_reward_revive');
    track('revive', { used: reviveUsed });
  },
  double: async () => {
    const res = await ads.show('doubleScore');
    if (!res || !res.ok || doubled) return;
    doubled = true;
    game.score *= 2;
    lastRun = { ...lastRun, score: game.score, doubleAvailable: false };
    ui.showResult(lastRun);
    ui.toast('ad_reward_double');
    track('double_score', { score: game.score });
  },
  onSetting: () => {
    const next = {
      sound: checked('ck-sound'),
      music: checked('ck-music'),
      shake: checked('ck-shake'),
      ghost: checked('ck-ghost'),
      particles: checked('ck-particles'),
    };
    save.setSettings(next);
    applyAudioSettings();
    fx.setOptions({ shake: next.shake, particles: next.particles });
    renderer.options.ghost = next.ghost;
    track('setting', { ...next });
    paint();
  },
  padAction: (action, down) => {
    if (down) handleAction(action);
  },
});

function checked(id) {
  const el = document.getElementById(id);
  return el ? !!el.checked : false;
}

/* ------------------------------------------------------------------ */
/* 键盘快捷键（弹窗 / 菜单）                                            */
/* ------------------------------------------------------------------ */

window.addEventListener('keydown', (ev) => {
  unlockAudioOnce();
  if (ev.key === 'Escape' && ui.modalOpen) { ui.close(); ev.preventDefault(); return; }
  if (ui.screen === 'menu' && (ev.code === 'Enter' || ev.code === 'Space')) {
    ev.preventDefault();
    maybeTutorialStart();
  }
});

window.addEventListener('pointerdown', unlockAudioOnce, { once: true });

/* ------------------------------------------------------------------ */
/* 开屏加载动画                                                        */
/* ------------------------------------------------------------------ */

const BOOT_STAGES = ['boot_stage_gems', 'boot_stage_cavern', 'boot_stage_audio', 'boot_stage_ready'];
const BOOT_TIPS = ['boot_tip_1', 'boot_tip_2', 'boot_tip_3', 'boot_tip_4'];

function brandGem() {
  const cv = document.getElementById('brand-gem');
  const ctx = cv && cv.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  drawGem(ctx, GEMS[(vis.banners.length + 5) % GEMS.length], 8, 8, cv.width - 16, { glow: 1, seed: 0 });
}

async function bootSequence() {
  brandGem();
  ui.translate();
  ui.setBootTip(BOOT_TIPS[Math.floor(Math.random() * BOOT_TIPS.length)]);
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    ui.setProgress(ratio);
    ui.setBootStage(BOOT_STAGES[Math.min(BOOT_STAGES.length - 1, Math.floor(ratio * BOOT_STAGES.length))]);
    await nextFrame();
    if (i % 5 === 0) await sleep(40);
  }
  ui.setProgress(1);
  paintMenuArt();
  await sleep(240);
  ui.showScreen('menu');
  ui.refreshMenu();
  track('load_complete', { locale: i18n.locale });
  if (AUTOPLAY) startRun();
}

let menuArtPainted = false;

/**
 * 主菜单的两幅程序化画面。岩板噪声较慢，只在第一次进菜单时画一次，
 * 之后复用同一张 canvas；失败也不能影响进入游戏，所以整体 try/catch。
 */
function paintMenuArt() {
  if (menuArtPainted) return;
  menuArtPainted = true;
  try {
    const bg = document.getElementById('menu-bg');
    const hero = document.getElementById('menu-hero');
    const gl = document.getElementById('hero-gem-l');
    const gr = document.getElementById('hero-gem-r');
    if (bg) paintCavern(bg, 0);
    if (hero) paintHero(hero);
    if (gl) paintGemCanvas(gl, 4, 1);
    if (gr) paintGemCanvas(gr, 2, 2);
    decorateUiGems(document);
  } catch (err) {
    if (DEBUG) console.error('[menu-art] paint failed', err);
  }
}

/**
 * 「等下一帧」要和 60ms 定时器赛跑。
 * 后台标签页 / 无头环境会把 requestAnimationFrame 节流到 1fps 甚至完全停摆，
 * 开屏动画若纯逐帧推进，玩家可能盯两三秒没变化的量条 —— 前台逐帧观感不变，
 * 被节流时自动退化成按时间推进，加载流程因此永远能在几秒内走完。
 */
function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(fin);
    setTimeout(fin, 60);
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ------------------------------------------------------------------ */
/* 域名锁                                                              */
/* ------------------------------------------------------------------ */

function initDomain() {
  const res = domain.check();
  if (res.ok) return res;
  const el = document.getElementById('overlay-domain');
  const body = document.getElementById('domain-body');
  const write = (seconds) => { if (body) body.textContent = i18n.t('domain_body', { seconds }); };
  domain.guard({
    onLock: (info) => {
      write(Math.max(0, Math.round((info.delayMs || 0) / 1000)));
      if (el) el.classList.add('is-active');
    },
    onTick: write,
  });
  track('domain_lock', { host: res.host });
  return res;
}

/* ------------------------------------------------------------------ */
/* 广告遮罩钩子                                                        */
/* ------------------------------------------------------------------ */

function initAds() {
  const screen = document.getElementById('sdk-ad-screen');
  const text = document.getElementById('sdk-ad-text');
  ads.init({
    onPause: () => { if (game.state === 'playing') game.pause(); },
    onResume: () => { if (game.state === 'pause') game.resume(); },
    onOverlayShow: (key, textKey) => {
      if (!screen) return;
      if (text) text.textContent = i18n.t(textKey || 'ad_playing');
      screen.hidden = false;
      screen.classList.add('is-active');
      void key;
    },
    onOverlayHide: () => {
      if (!screen) return;
      screen.classList.remove('is-active');
      screen.hidden = true;
    },
  });
}

/* ------------------------------------------------------------------ */
/* 分享回流提示                                                        */
/* ------------------------------------------------------------------ */

function referralNotice() {
  if (!FROM_REF) return;
  ui.toast('share_intro');
  track('referral_open', { from: FROM_REF });
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

function init() {
  i18n.apply(document);
  ui.setSettings(save.settings);
  initAds();
  initDomain();
  input.attach();
  running = true;
  lastFrame = performance.now();
  requestAnimationFrame(loop);
  resize();
  paint();
  bootSequence().then(referralNotice);
  track('boot', { version: GAME_CONFIG.meta.version, locale: i18n.locale });
  document.dispatchEvent(new CustomEvent('prismcrush:ready'));
}

/* ------------------------------------------------------------------ */
/* 测试门面                                                            */
/* ------------------------------------------------------------------ */

const api = {
  /** 推进模拟并绘制一帧（无头环境不依赖 RAF） */
  step(ms = 16.7) {
    simulate(ms);
    paint();
    return api.state();
  },
  /** 连续推进（内部按 16.7ms 切片） */
  auto(ms = 1000) {
    let left = Math.min(600000, ms);
    while (left > 0) {
      const d = Math.min(16.7, left);
      api.step(d);
      left -= d;
    }
    return api.state();
  },
  /** 自动打到结束（GIF / verify 用） */
  playUntilOver(maxMs = 180000) {
    if (!driver) driver = new AutoDriver(game);
    let used = 0;
    while (game.state !== 'over' && used < maxMs) { api.step(16.7); used += 16.7; }
    return api.state();
  },
  start: () => { startRun(); return api.state(); },
  restart: () => { startRun(); return api.state(); },
  menu: () => { goMenu(); return api.state(); },
  endRun: () => { endRun(); return true; },
  input: (action) => { const ok = game.input(action); paint(); return ok; },
  key: (code) => {
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'rotate', Space: 'pause' };
    const a = map[code];
    if (!a) return false;
    const ok = game.input(a);
    paint();
    return ok;
  },
  /** 注入固定随机源，便于断言（传 null 恢复真随机） */
  seed(values) {
    if (Array.isArray(values) && values.length) {
      let i = 0;
      const fn = () => values[(i = (i + 1) % values.length)];
      game.rng = fn;
      game.board.rng = fn;
    } else {
      game.rng = null;
      game.board.rng = null;
    }
    game.board.shape = game.board._newShape();
    game.board.nextShape = game.board._newShape();
    return true;
  },
  showScreen: (name) => { ui.showScreen(name); return ui.screen; },
  openOverlay: (key) => { ui.open(key); return ui.overlay; },
  closeOverlay: (key) => { ui.close(key); return ui.overlay; },
  openShare: () => { share.open(); return true; },
  closeShare: () => { ui.close('share'); return true; },
  skipTutorial: () => { tutorial.finish(); return true; },
  tutorialStep: (i) => { tutorial.open(i); return tutorial.index; },
  shareCard: (targetId = 'share-canvas') => {
    const cv = document.getElementById(targetId);
    if (!cv) return '';
    try { share.renderCard(cv, cv.width || 1080); return cv.toDataURL('image/png'); } catch (e) { return ''; }
  },
  setSetting: (key, value) => {
    save.setSetting(key, value);
    const el = document.getElementById(
      { sound: 'ck-sound', music: 'ck-music', shake: 'ck-shake', ghost: 'ck-ghost', particles: 'ck-particles' }[key]
    );
    if (el) el.checked = !!value;
    ui.setSettings(save.settings);
    applyAudioSettings();
    fx.setOptions({ shake: save.settings.shake, particles: save.settings.particles });
    renderer.options.ghost = save.settings.ghost !== false;
    return true;
  },
  lang: (code) => {
    i18n.set(code); labelLocale = null; syncHud();
    ui.translate(); tutorial.refresh(); share.refreshLabels();
    return i18n.locale;
  },
  state: () => {
    const d = domain.state || domain.check();
    return {
      screen: ui.screen,
      overlay: ui.overlay,
      locale: i18n.locale,
      tutorial: { active: tutorial.active, index: tutorial.index },
      game: game.snapshot(),
      save: save.snapshot(),
      fx: {
        shake: fx.shake.amp,
        particles: fx.pool.filter((p) => p.alive).length,
        banners: vis.banners.length,
        tierIndex: vis.tierIndex,
      },
      ads: {
        enabled: !!ADS_CONFIG.enabled,
        live: ads.live,
        ready: ads.ready,
        provider: ADS_CONFIG.provider,
        plays: ads.plays,
      },
      domain: { ok: d.ok, host: d.host, reason: d.reason },
      audio: { mode: audio.mode, ready: audio.ready, enabled: audio.enabled, bgm: audio.bgmName },
      view: renderer.view,
      boardClip: renderer.boardClip(),
      autoplay: AUTOPLAY,
    };
  },
  /** 原始模块句柄，verify 直接断言内部实现 */
  modules: { game, board: game.board, renderer, fx, ui, share, tutorial, save, audio, i18n, ads, domain, config: GAME_CONFIG },
};

window.__PRISMCRUSH__ = { api, version: GAME_CONFIG.meta.version };

void STAGE;
syncHud();
init();

export { api, game, ui, renderer, fx, share, tutorial, save, audio, i18n, ads, domain };
