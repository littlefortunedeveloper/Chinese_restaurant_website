/* ==============================================================================
   menu.js — 菜单页脚本
   读取 data/menu_data.txt（与 PDF 生成器完全相同的格式！）并渲染成网页菜单
   支持：分类 === ··· === · SUBTITLE · [SPICY] 辣标识 · SM:/LG: 大小份 · PRICE_ADJUST 价格调整
   改 txt → push 到 GitHub → 菜单自动更新
   ============================================================================== */

/* ── 解析 menu_data.txt（逻辑与 Python 版 parse_menu_file 一一对应）────────── */
function parseMenuData(text) {
  const menu = [];
  let cur = null;
  let priceAdjust = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;                     // 注释/空行

    if (line.startsWith('===') && line.endsWith('===')) {            // 分类行
      if (cur && cur.items.length) menu.push(cur);
      cur = { name: line.replace(/^=+|=+$/g, '').trim(), subtitle: null, items: [] };
      continue;
    }
    const upper = line.toUpperCase();
    if (upper.startsWith('SUBTITLE:')) {                             // 副标题
      const sub = line.slice(9).trim();
      if (cur) cur.subtitle = sub.toUpperCase() === 'NONE' ? null : sub;
      continue;
    }
    if (upper.startsWith('PRICE_ADJUST:')) {                         // 价格调整设置
      const v = line.slice(13).trim();
      priceAdjust = (v && v !== '0') ? v : null;
      continue;
    }
    if (line.includes('|') && cur) {                                 // 菜品行
      const parts = line.split('|').map(s => s.trim());
      if (parts.length < 4) continue;
      const [en, zh, es, priceStr] = parts;
      let price;
      if (priceStr.startsWith('SM:') && priceStr.includes('/LG:')) { // 大小份
        const seg = priceStr.split('/');
        price = { sm: seg[0].replace('SM:', '').trim(),
                  lg: seg[1].replace('LG:', '').trim() };
      } else {
        price = priceStr;                                            // 单一价
      }
      cur.items.push({ en, zh, es, price });
    }
  }
  if (cur && cur.items.length) menu.push(cur);
  return { menu, priceAdjust };
}

/* ── 价格调整（与 Python 版一致：标准四舍五入到 $0.01）─────────────────────── */
function adjustPrice(priceStr, adj) {
  if (!adj) return priceStr;
  const orig = parseFloat(priceStr);
  if (isNaN(orig)) return priceStr;
  let v;
  if (adj.endsWith('%')) v = orig * (1 + parseFloat(adj) / 100);     // 百分比
  else                   v = orig + parseFloat(adj);                 // 固定金额
  v = Math.max(0.01, v);
  // 两级取整消除浮点误差，实现严格的 ROUND_HALF_UP（与 Python Decimal 一致）
  return (Math.round(Math.round(v * 10000) / 100) / 100).toFixed(2);
}

function applyAdjustToMenu(menu, adj) {
  if (!adj) return menu;
  return menu.map(cat => ({
    ...cat,
    items: cat.items.map(it => ({
      ...it,
      price: (typeof it.price === 'object')
        ? { sm: adjustPrice(it.price.sm, adj), lg: adjustPrice(it.price.lg, adj) }
        : adjustPrice(it.price, adj)
    }))
  }));
}

/* ── 单个菜品的小工具 ─────────────────────────────────────────────────────── */
const SPICY_TAG = '[SPICY]';
let CFG = {};   // 网站文字配置（由 initMenu 从 site_config.txt 载入）
function splitNum(en) {
  // 提取编号："16. Hot & Sour Soup" → ["16.", "Hot & Sour Soup"]（与 Python 正则一致）
  const m = en.match(/^([A-Z]?\d+[a-z]?\.)\s+(.*)$/);
  return m ? [m[1], m[2]] : ['', en];
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ── 渲染 ─────────────────────────────────────────────────────────────────── */
function renderMenu(menu) {
  const nav = document.getElementById('catNav');
  const wrap = document.getElementById('menuWrap');
  if (!nav || !wrap) return;

  // 分类导航 chips
  nav.innerHTML = menu.map((cat, i) => {
    const enName = cat.name.split('/')[0].trim();
    return `<button class="cat-chip${i === 0 ? ' active' : ''}" data-target="cat-${i}">${esc(enName)}</button>`;
  }).join('');

  // 分类 + 菜品
  wrap.innerHTML = menu.map((cat, i) => {
    const segs = cat.name.split('/').map(s => s.trim());
    const [enN, zhN, esN] = [segs[0] || '', segs[1] || '', segs[2] || ''];
    const items = cat.items.map(it => {
      const spicy = it.en.includes(SPICY_TAG);
      const enClean = it.en.replaceAll(SPICY_TAG, '').trim();
      const esClean = it.es.replaceAll(SPICY_TAG, '').trim();
      const [num, name] = splitNum(enClean);
      const szS = esc(CFG.MENU_SIZE_SMALL || '小 sm');
      const szL = esc(CFG.MENU_SIZE_LARGE || '大 lg');
      const priceHtml = (typeof it.price === 'object')
        ? `<span class="sz">${szS} <b>$${esc(it.price.sm)}</b></span>
           <span class="sz">${szL} <b>$${esc(it.price.lg)}</b></span>`
        : `$${esc(it.price)}`;
      return `
        <article class="menu-item">
          <div class="mi-num">${esc(num)}</div>
          <div class="mi-body">
            <div class="mi-name">${esc(name)}${spicy ? `<span class="spicy-badge">${esc(CFG.MENU_SPICY_BADGE || '◆ 辣 Hot')}</span>` : ''}</div>
            <div class="mi-sub">${esc(it.zh)} · ${esc(esClean)}</div>
          </div>
          <div class="mi-price">${priceHtml}</div>
        </article>`;
    }).join('');

    return `
      <section class="menu-category" id="cat-${i}">
        <div class="mc-head">
          <div class="mc-rule"></div>
          <h2 class="mc-title">${esc(enN)}<span class="zh">${esc(zhN)}</span><span class="es">${esc(esN)}</span></h2>
          ${cat.subtitle ? `<p class="mc-sub">${esc(cat.subtitle)}</p>` : ''}
        </div>
        <div class="menu-grid">${items}</div>
      </section>`;
  }).join('');

  // chip 点击滚动
  nav.querySelectorAll('.cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById(chip.dataset.target)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // 滚动时高亮当前分类
  const sections = [...wrap.querySelectorAll('.menu-category')];
  const chips = [...nav.querySelectorAll('.cat-chip')];
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const idx = sections.indexOf(en.target);
      chips.forEach((c, j) => c.classList.toggle('active', j === idx));
      chips[idx]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  sections.forEach(s => io.observe(s));
}

/* ── 启动 ─────────────────────────────────────────────────────────────────── */
async function initMenu() {
  const wrap = document.getElementById('menuWrap');
  try {
    /* 先等网站文字配置（site.js 已发起请求），供辣徽章/大小份标签使用 */
    CFG = (typeof window !== 'undefined' && window.CONFIG_READY)
      ? await window.CONFIG_READY : {};
    const res = await fetch(`data/menu_data.txt?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let { menu, priceAdjust } = parseMenuData(text);
    if (!menu.length) throw new Error('菜单数据为空');
    menu = applyAdjustToMenu(menu, priceAdjust);
    renderMenu(menu);
  } catch (e) {
    if (wrap) wrap.innerHTML =
      `<div class="menu-error">⚠ 菜单加载失败：${esc(e.message)}<br>
       Menu failed to load. Please check data/menu_data.txt</div>`;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initMenu);
}

/* 供 Node 测试使用 */
if (typeof module !== 'undefined') {
  module.exports = { parseMenuData, adjustPrice, applyAdjustToMenu, splitNum };
}
