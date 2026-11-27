/**
 * 社媒分享 —— 移动端原生分享 / 桌面端平台 URL / 图片卡片
 * =====================================================================
 * 平台：Facebook、X、Reddit、WhatsApp、Telegram、LinkedIn、YouTube、
 *       TikTok、Instagram。
 * TikTok / Instagram / YouTube 无法直接带图分享 → 生成分享卡片 + 复制链接。
 * 分享前可填昵称，产生裂变文案「@{昵称} 邀请你来玩 …」。
 * 所有分享都打埋点：sdk.track('share', {platform, name, score})。
 */

import { PLATFORMS, $, $$ } from './ui.js';
import { STAGE } from '../../config/game.config.js';
import { rng, hash, rgba, lighten, roundRect, glowBlob, sparkle } from '../art/utils.js';
import { drawGem, gemOf } from '../art/gems.js';
import { GEMS } from '../../config/game.config.js';
import { drawText, FONT_DISPLAY, FONT_BODY } from '../art/ui-art.js';

export class SharePanel {
  /**
   * @param {object} opt
   * @param {import('./ui.js').UI} opt.ui
   * @param {import('../core/i18n.js').I18n} opt.i18n
   * @param {string} opt.baseUrl
   * @param {()=>object} opt.getState 返回 {score, level, lines}
   * @param {(event:string,payload:object)=>void} [opt.track]
   * @param {()=>HTMLCanvasElement|null} [opt.gameCanvas]
   */
  constructor(opt) {
    this.ui = opt.ui;
    this.i18n = opt.i18n;
    this.baseUrl = opt.baseUrl;
    this.getState = opt.getState || (() => ({ score: 0, level: 0, lines: 0 }));
    this.track = opt.track || (() => {});
    this.gameCanvas = opt.gameCanvas || (() => null);
    this.el = {
      grid: $('#share-grid'),
      name: $('#share-name'),
      preview: $('#share-preview'),
      native: $('#btn-share-native'),
      copy: $('#btn-share-copy'),
      card: $('#btn-share-card'),
      cardbox: $('#share-cardbox'),
      canvas: $('#share-canvas'),
      download: $('#share-card-download'),
    };
    this._buildTiles();
    this._bind();
  }

  /* ---------------------------------------------------------------- */
  /* 构建                                                              */
  /* ---------------------------------------------------------------- */

  _buildTiles() {
    const grid = this.el.grid;
    if (!grid) return;
    grid.innerHTML = '';
    this.tiles = PLATFORMS.map((p, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'share-tile';
      btn.dataset.platform = p.id;
      btn.style.animationDelay = `${i * 45}ms`;
      // 注意：data-i18n 只能挂在内部的 span 上。挂在按钮本身会让 i18n.apply
      // 用 textContent 覆写整个按钮，把 SVG 图标抹掉。
      btn.title = p.id;
      btn.innerHTML =
        `<svg viewBox="0 0 24 24" fill="${p.color}" aria-hidden="true">${p.icon}</svg>` +
        `<span data-i18n="${p.labelKey}"></span>`;
      btn.querySelector('span').textContent = this.i18n.t(p.labelKey);
      grid.appendChild(btn);
      return btn;
    });
    this._refreshPreview();
  }

  _bind() {
    if (this.el.grid) {
      this.el.grid.addEventListener('click', (ev) => {
        const tile = ev.target.closest('.share-tile');
        if (!tile) return;
        this.share(tile.dataset.platform);
      });
    }
    if (this.el.name) {
      this.el.name.addEventListener('input', () => this._refreshPreview());
    }
    if (this.el.native) this.el.native.addEventListener('click', () => this.shareNative());
    if (this.el.copy) this.el.copy.addEventListener('click', () => this.copyLink());
    if (this.el.card) this.el.card.addEventListener('click', () => this.showCard());
  }

  /** 语言切换后重绘平台名 */
  refreshLabels() {
    if (!this.el.grid) return;
    $$('.share-tile', this.el.grid).forEach((tile) => {
      const p = PLATFORMS.find((x) => x.id === tile.dataset.platform);
      if (!p) return;
      const span = tile.querySelector('span');
      if (span) span.textContent = this.i18n.t(p.labelKey);
    });
    this._refreshPreview();
  }

  /* ---------------------------------------------------------------- */
  /* 文案与链接                                                        */
  /* ---------------------------------------------------------------- */

  get name() {
    return (this.el.name && this.el.name.value.trim().slice(0, 18)) || '';
  }

  get shareUrl() {
    const s = this.getState();
    const params = new URLSearchParams();
    params.set('ref', 'share');
    if (this.name) params.set('from', this.name);
    const shown = (s.score | 0) || (s.best | 0);
    if (shown) params.set('score', String(shown));
    if (this.i18n.locale === 'zh') params.set('lang', 'zh');
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : this.baseUrl + '/';
    return `${base}?${params.toString()}`;
  }

  /**
   * 分裂文案。从菜单点进来时本局分数是 0，直接套模板会变成「Beat my 0 points」，
   * 所以优先用本局分数，其次用历史最高，两个都没有就用不带数字的版本。
   */
  get text() {
    const s = this.getState();
    const shown = (s.score | 0) || (s.best | 0);
    const key = this.name
      ? (shown ? 'share_fission' : 'share_fission_zero')
      : (shown ? 'share_fission_anon' : 'share_fission_anon_zero');
    return this.i18n.t(key, { name: this.name, score: shown });
  }

  _refreshPreview() {
    if (this.el.preview) this.el.preview.textContent = this.text;
  }

  open() {
    this._refreshPreview();
    if (this.el.cardbox) this.el.cardbox.hidden = true;
    this.ui.open('share', { focus: false });
    this.track('share_open', { score: this.getState().score | 0 });
  }

  /* ---------------------------------------------------------------- */
  /* 分享动作                                                          */
  /* ---------------------------------------------------------------- */

  /** 移动端优先原生分享 */
  async shareNative() {
    const payload = {
      title: 'PRISM CRUSH',
      text: this.text,
      url: this.shareUrl,
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(payload);
        this.track('share', { platform: 'native', name: this.name, ok: true });
        this.ui.toast('share_copied');
        return true;
      } catch (err) {
        // 用户取消不算失败
        this.track('share', { platform: 'native', name: this.name, ok: false, reason: String(err && err.name) });
        return false;
      }
    }
    return this.copyLink();
  }

  /** 桌面端：打开官方分享 URL；TikTok/Instagram/YouTube 走卡片方案 */
  share(platform) {
    const url = encodeURIComponent(this.shareUrl);
    const text = encodeURIComponent(this.text);
    const media = encodeURIComponent(this.shareUrl);
    const links = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`,
      twitter: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      reddit: `https://www.reddit.com/submit?url=${url}&title=${text}`,
      whatsapp: `https://api.whatsapp.com/send?text=${text}%20${url}`,
      telegram: `https://t.me/share/url?url=${url}&text=${text}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      // 这三个平台没有可用的「带图分享」Web 端点 → 卡片 + 复制链接
      youtube: `https://www.youtube.com/upload`,
      tiktok: `https://www.tiktok.com/upload?lang=en`,
      instagram: `https://www.instagram.com/`,
    };
    this.track('share', { platform, name: this.name, score: this.getState().score | 0 });
    const target = links[platform];
    if (!target) return false;
    if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram') {
      this.showCard();
      window.open(target, '_blank', 'noopener,noreferrer');
      return true;
    }
    window.open(target, '_blank', 'noopener,noreferrer,width=760,height=640');
    return true;
  }

  async copyLink() {
    const link = this.shareUrl;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
      } else {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      this.ui.toast('share_copied');
      this.track('share', { platform: 'copy', name: this.name, ok: true });
      return true;
    } catch (e) {
      this.ui.toast('share_copied');
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 分享卡片（1080×1080，Canvas 截取游戏画面 + 昵称 + 品牌）           */
  /* ---------------------------------------------------------------- */

  showCard() {
    const cv = this.el.canvas;
    if (!cv) return null;
    try {
      this.renderCard(cv);
      if (this.el.cardbox) {
        this.el.cardbox.hidden = false;
        if (this.el.download) {
          this.el.download.href = cv.toDataURL('image/png');
          this.el.download.download = 'prism-crush-card.png';
        }
      }
      this.track('share', { platform: 'card', name: this.name, score: this.getState().score | 0 });
      return cv;
    } catch (err) {
      // 画布被跨源图片污染时（理论上不会发生，全部为程序化绘制）
      this.ui.toast('share_card_hint', null, 'warn');
      return null;
    }
  }

  /** 把卡片画进任意 canvas（verify 也用它做像素断言） */
  renderCard(canvas, size = 1080) {
    const W = size;
    const H = size;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    const s = this.getState();
    const r = rng(hash('card' + (s.score | 0)));

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    /* 背景：晶窟渐变 + 岩层 */
    const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, '#0b0726');
    bg.addColorStop(0.5, '#1d1246');
    bg.addColorStop(1, '#33122c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      glowBlob(ctx, r() * W, r() * H, 180 + r() * 260, ['#3ff0d0', '#8f6bff', '#ffd88a'][i % 3], 0.16);
    }
    ctx.restore();

    /* 游戏画面截取（能拿到就贴，拿不到就画晶体阵列） */
    const game = this.gameCanvas();
    if (game && game.width) {
      try {
        const clip = { x: 0, y: 0, w: game.width, h: game.height };
        const target = { w: W * 0.74, h: W * 0.74 * (clip.h / clip.w) };
        const tx = (W - target.w) / 2;
        const ty = H * 0.16;
        ctx.save();
        roundRect(ctx, tx, ty, target.w, target.h, 34);
        ctx.fillStyle = '#07051a';
        ctx.fill();
        ctx.clip();
        ctx.drawImage(game, clip.x, clip.y, clip.w, clip.h, tx, ty, target.w, target.h);
        ctx.restore();
        roundRect(ctx, tx, ty, target.w, target.h, 34);
        ctx.strokeStyle = rgba('#3ff0d0', 0.55);
        ctx.lineWidth = 6;
        ctx.stroke();
      } catch (e) {
        this._crystalGrid(ctx, W, H, r);
      }
    } else {
      this._crystalGrid(ctx, W, H, r);
    }

    /* 顶部品牌 */
    drawText(ctx, 'PRISM CRUSH', W / 2, H * 0.085, {
      size: 86, letterSpacing: 10,
      gradient: [[0, '#ffffff'], [0.5, '#9ffcf0'], [1, '#35c7ff']],
      stroke: 'rgba(6,4,20,0.9)', strokeWidth: 14,
      shadowColor: rgba('#3ff0d0', 0.8), shadowBlur: 40,
      font: FONT_DISPLAY,
    });
    drawText(ctx, this.i18n.t('menu_subtitle'), W / 2, H * 0.135, {
      size: 30, color: '#c6d6f2', font: FONT_BODY, letterSpacing: 4,
    });

    /* 分数带 */
    const bandY = H * 0.72;
    ctx.save();
    roundRect(ctx, W * 0.08, bandY, W * 0.84, H * 0.135, 28);
    const band = ctx.createLinearGradient(0, bandY, 0, bandY + H * 0.135);
    band.addColorStop(0, 'rgba(20,12,48,0.92)');
    band.addColorStop(1, 'rgba(6,4,20,0.92)');
    ctx.fillStyle = band;
    ctx.fill();
    ctx.strokeStyle = rgba('#ffd88a', 0.6);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
    const shown = (s.score | 0) || (s.best | 0);
    drawText(ctx, this.i18n.t(shown ? 'share_card_sub' : 'share_card_sub_zero', { score: shown }), W / 2, bandY + H * 0.068, {
      size: 46, color: '#ffffff', stroke: 'rgba(6,4,20,0.8)', strokeWidth: 8, font: FONT_BODY, weight: 800,
    });

    /* 昵称 + 网址 */
    const who = this.name ? `@${this.name}` : 'pipygames.com';
    drawText(ctx, who, W / 2, H * 0.885, {
      size: 44, color: '#9ffcf0', stroke: 'rgba(6,4,20,0.85)', strokeWidth: 8, font: FONT_BODY, weight: 800,
    });
    drawText(ctx, this.i18n.t('share_card_cta'), W / 2, H * 0.935, {
      size: 34, color: '#e8d9a8', letterSpacing: 3, font: FONT_BODY, weight: 700,
    });

    /* 角落晶体装饰 */
    const deco = [GEMS[0], GEMS[3], GEMS[5], GEMS[1]];
    deco.forEach((g, i) => {
      const x = i % 2 === 0 ? W * 0.045 : W * 0.86;
      const y = i < 2 ? H * 0.03 : H * 0.9;
      drawGem(ctx, g, x, y, W * 0.1, { glow: 0.7, seed: i });
    });
    sparkle(ctx, W * 0.2, H * 0.2, 60, '#ffffff', 0.6, 0.5);
    sparkle(ctx, W * 0.82, H * 0.62, 46, '#ffffff', 0.5, 1.2);
    ctx.restore();
    void lighten;
    return canvas;
  }

  /** 没有游戏画面时的兜底：一面晶体矿壁（依然是程序化晶体，不是色块） */
  _crystalGrid(ctx, W, H, r) {
    const cell = W * 0.115;
    const cols = Math.ceil(W / cell);
    const rows = Math.ceil((H * 0.6) / cell);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (r() < 0.24) continue;
        const g = gemOf(1 + Math.floor(r() * 7));
        drawGem(ctx, g, x * cell, H * 0.17 + y * cell, cell * 0.96, { glow: 0.35, seed: Math.floor(r() * 4) });
      }
    }
  }

  /** 供 OG/预览：把卡片导出为 dataURL */
  cardDataUrl() {
    const cv = this.el.canvas;
    if (!cv) return '';
    try {
      this.renderCard(cv);
      return cv.toDataURL('image/png');
    } catch (e) { return ''; }
  }
}

export default SharePanel;
export { STAGE };
