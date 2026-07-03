/* ==============================================================================
   site.js — 网站共用脚本
   功能：
   1. 读取 data/site_config.txt  → 自动填充页面上所有 [data-config] 元素
   2. 读取 data/announcements.txt → 渲染公告
   3. 手机端导航开关 · 当天营业时间高亮
   全部数据来自 txt 文件：改 txt → push → 网站自动更新，无需碰代码
   ============================================================================== */

/* ── 通用：抓取 txt（带缓存穿透，保证 GitHub Pages 上改完立刻生效）────────── */
async function fetchText(path) {
  const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`无法读取 ${path}（HTTP ${res.status}）`);
  return res.text();
}

/* ── 解析 KEY: VALUE 配置格式 ─────────────────────────────────────────────── */
function parseConfig(text) {
  const cfg = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;        // 跳过空行和注释
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) cfg[key] = val;
  }
  return cfg;
}

/* ── 占位符解析：值里的 {KEY} 自动替换成对应配置值 ──────────────────────────
   例如 ABOUT_TEXT 里写 {NAME}，会自动变成 NAME 的值。
   这样店名等信息只需要在一个地方定义一次。*/
function resolveStr(s, cfg) {
  return String(s).replace(/\{([A-Z0-9_]+)\}/g,
    (m, key) => (cfg[key] !== undefined ? cfg[key] : m));
}
function resolveConfig(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) out[k] = resolveStr(v, cfg);
  return out;
}

/* ── 把配置写入页面 ───────────────────────────────────────────────────────── */
function applyConfig(cfg) {
  // 文本注入：所有带 data-config="KEY" 的元素
  document.querySelectorAll('[data-config]').forEach(el => {
    const key = el.dataset.config;
    if (cfg[key] !== undefined) el.textContent = cfg[key];
  });
  // 属性注入：data-config-attr="href:PHONE_LINK" 等
  document.querySelectorAll('[data-config-attr]').forEach(el => {
    const [attr, key] = el.dataset.configAttr.split(':');
    if (cfg[key] !== undefined) {
      let v = cfg[key];
      if (attr === 'href' && key === 'PHONE_LINK') v = 'tel:' + v;
      if (attr === 'href' && key === 'EMAIL')      v = 'mailto:' + v;
      el.setAttribute(attr, v);
    }
  });
  // 高亮今天的营业时间行
  const dayRows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const today = dayRows[new Date().getDay()];
  const row = document.querySelector(`[data-day="${today}"]`);
  if (row) row.classList.add('today');
}

/* ── 解析公告：日期 | 标题 | 内容 ─────────────────────────────────────────── */
function parseAnnouncements(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 3) continue;
    out.push({ date: parts[0], title: parts[1], text: parts.slice(2).join(' | ') });
  }
  return out;
}

function renderAnnouncements(list) {
  const box = document.getElementById('announcements');
  if (!box) return;
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = list.map(a => `
    <div class="ann-item">
      <div class="ann-icon">📢</div>
      <div class="ann-body">
        <div><span class="ann-title">${escapeHtml(a.title)}</span><span class="ann-date">${escapeHtml(a.date)}</span></div>
        <div class="ann-text">${escapeHtml(a.text)}</div>
      </div>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════════════════════════════
   弹窗公告（data/popup.txt）
   格式：ENABLED: ON/OFF · TITLE: 标题 · BUTTON: 按钮文字 · 其余行=正文段落
   ══════════════════════════════════════════════════════════════════════════ */
function parsePopup(text) {
  const d = { enabled: false, showOnce: true, title: '', button: 'OK', body: [] };  // 默认只弹一次
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;          // 跳过注释和空行
    const m = line.match(/^(ENABLED|TITLE|BUTTON|SHOW_ONCE)\s*:\s*(.*)$/i);
    if (m) {
      const key = m[1].toUpperCase(), val = m[2].trim();
      const on  = /^(ON|YES|TRUE|开|1)$/i.test(val);      // 接受 ON/YES/TRUE/开/1
      if (key === 'ENABLED')   d.enabled  = on;
      if (key === 'SHOW_ONCE') d.showOnce = on;
      if (key === 'TITLE')     d.title    = val;
      if (key === 'BUTTON')    d.button   = val;
    } else {
      d.body.push(line);                                   // 正文段落
    }
  }
  return d;
}

/* 生成弹窗HTML（纯函数，便于测试；所有文字经过转义防注入）*/
function buildPopupHtml(d) {
  const paras = d.body.map(l => `<p>${escapeHtml(l)}</p>`).join('');
  return `
    <div class="popup-card" role="dialog" aria-modal="true">
      <button class="popup-close" aria-label="Close">×</button>
      ${d.title ? `<h3 class="popup-title">${escapeHtml(d.title)}</h3>` : ''}
      <div class="popup-body">${paras}</div>
      <button class="popup-btn">${escapeHtml(d.button || 'OK')}</button>
    </div>`;
}

/* 挂载弹窗到页面（仅浏览器环境调用）*/
function showPopup(d) {
  const overlay = document.createElement('div');
  overlay.className = 'popup-overlay';
  overlay.innerHTML = buildPopupHtml(d);
  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.popup-close').addEventListener('click', close);
  overlay.querySelector('.popup-btn').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';                 // 弹窗打开时锁定背景滚动
  overlay.querySelector('.popup-btn').focus();
}

/* 内容指纹：标题+正文生成短哈希。同一内容一次浏览只弹一次；
   店家改了弹窗内容 → 指纹变化 → 访客会重新看到一次新弹窗 */
function popupKey(d) {
  const s = d.title + '|' + d.body.join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'popupShown:' + h.toString(36);
}

/* 加载弹窗：读取txt → 解析 → 按开关和频率显示 */
async function initPopup(cfg) {
  let d;
  try {
    d = parsePopup(await fetchText('data/popup.txt'));
  } catch (e) { return; }                                  // 没有popup.txt就静默跳过
  if (!d.enabled) return;                                  // 开关OFF → 不显示
  if (d.showOnce) {                                        // 默认：一次浏览只弹一次
    try {
      const key = popupKey(d);                             // 按内容记忆
      if (sessionStorage.getItem(key)) return;             // 这次浏览已经弹过 → 跳过
      sessionStorage.setItem(key, '1');
    } catch (e) { /* 预览等沙盒环境存储不可用 → 退化为每页弹 */ }
  }
  d.title  = resolveStr(d.title,  cfg);                    // 支持 {NAME} {PHONE} 等
  d.button = resolveStr(d.button, cfg);
  d.body   = d.body.map(l => resolveStr(l, cfg));
  setTimeout(() => showPopup(d), 450);                     // 页面稳定后再弹，体验更好
}

/* ── 安全：转义 HTML，防止 txt 内容破坏页面 ───────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ── 手机导航开关 ─────────────────────────────────────────────────────────── */
function initNav() {
  const btn = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.main-nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => nav.classList.toggle('open'));
  nav.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => nav.classList.remove('open')));
}

/* ── 启动（仅在浏览器环境执行）───────────────────────────────────────────── */
if (typeof document !== 'undefined' && typeof fetch !== 'undefined') {
  /* 配置提前开始加载，并暴露给 menu.js 复用（避免重复请求）*/
  window.CONFIG_READY = fetchText('data/site_config.txt')
    .then(parseConfig)
    .then(resolveConfig)
    .catch(e => { console.warn('配置加载失败：', e.message); return {}; });

  document.addEventListener('DOMContentLoaded', async () => {
    initNav();
    const cfg = await window.CONFIG_READY;
    applyConfig(cfg);
    /* 浏览器标签页标题：根据 body 的 data-page 取对应配置 */
    const page = document.body?.dataset?.page;
    const key  = page === 'menu' ? 'PAGE_TITLE_MENU' : 'PAGE_TITLE_HOME';
    const base = cfg[key] || document.title.split('·')[0].trim();
    document.title = `${base}${cfg.NAME ? ' · ' + cfg.NAME : ''}${cfg.NAME_ZH ? ' ' + cfg.NAME_ZH : ''}`;
    try {
      const annText = await fetchText('data/announcements.txt');
      renderAnnouncements(parseAnnouncements(annText));
    } catch (e) { console.warn('公告加载失败：', e.message); }
    initPopup(cfg);                                        // 弹窗（由popup.txt控制开关）
  });
}

/* 供 Node 测试使用（浏览器中此段无副作用）*/
if (typeof module !== 'undefined') {
  module.exports = { parseConfig, resolveConfig, resolveStr, parsePopup, buildPopupHtml, popupKey, parseAnnouncements, escapeHtml };
}
