/* ==============================================================================
   menu.js — 菜单页脚本
   读取 data/menu_data.txt（与 PDF 生成器完全相同的格式！）并渲染成网页菜单
   支持：分类 === ··· === · SUBTITLE · [SPICY] 辣标识 · SM:/LG: 大小份 · PRICE_ADJUST 价格调整
        · AVAILABLE 分类限时供应（如午餐特价只显示到下午3:30，到点自动隐藏）
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
      cur = { name: line.replace(/^=+|=+$/g, '').trim(), subtitle: null, available: null, items: [] };
      continue;
    }
    const upper = line.toUpperCase();
    const upperN = upper.replace('：', ':');   // 关键字容全角冒号
    if (upperN.startsWith('SUBTITLE:')) {                             // 副标题
      const sub = line.slice(9).trim();
      if (cur) cur.subtitle = sub.toUpperCase() === 'NONE' ? null : sub;
      continue;
    }
    if (upperN.startsWith('AVAILABLE:')) {                            // 分类供应时段（仅网页限时显示）
      const v = line.slice(10).trim();
      if (cur) cur.available = parseAvailability(v);
      continue;
    }
    if (upperN.startsWith('PRICE_ADJUST:')) {                         // 价格调整设置
      const v = line.slice(13).trim().replace('％','%').replace('：',':');
      priceAdjust = (v && v !== '0') ? v : null;
      continue;
    }
    if ((line.includes('|') || line.includes('｜')) && cur) {                                 // 菜品行
      const parts = line.split(/[|｜]/).map(s => s.trim());
      if (parts.length < 4) continue;
      const [en, zh, es, priceStr] = parts;
      let price;
      const priceN = priceStr.replace(/：/g, ':');
      if (priceN.startsWith('SM:') && priceN.includes('/LG:')) { // 大小份
        const seg = priceN.split('/');
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

/* ── 解析分类供应时段 AVAILABLE: ─────────────────────────────────────────────
   写法A（截止式）：AVAILABLE: Until 3:30 PM        → 当天下午3:30之前显示，过点隐藏
   写法B（时段式）：AVAILABLE: 11:00 AM - 3:30 PM   → 只在该时段内显示（支持跨夜，
                                                      如深夜档 9:00 PM - 1:00 AM）
   容错规则：
   · 从整行文字里提取时间，其余中英文说明一律忽略（可写成双语句子）
   · 时间需带 AM/PM（与营业时间配置同格式）；全角冒号"："也接受
   · 重复出现的相同时间自动去重（双语写两遍同一时间也能正确识别为截止式）
   · 一个时间=截止式；两个不同时间=时段式（取前两个）
   · "Until 12:00 AM" 视为到半夜=全天显示
   · 解析不出任何时间 → 按全天显示并在控制台提示（宁可多显示，绝不误藏菜单）*/
function parseAvailability(str) {
  const toMin = (h, m, ap) => (parseInt(h) % 12 + (/pm/i.test(ap) ? 12 : 0)) * 60 + parseInt(m);
  const seen = new Set(), times = [];
  for (const m of String(str).matchAll(/(\d{1,2})[:：](\d{2})\s*(AM|PM)/gi)) {
    const v = toMin(m[1], m[2], m[3]);
    if (!seen.has(v)) { seen.add(v); times.push(v); }
  }
  if (times.length === 0) {
    try { console.warn('[menu] AVAILABLE 未能解析出时间（需含 AM/PM），该分类按全天显示：' + str); } catch (e) {}
    return null;                                        // 防呆：解析失败=全天显示
  }
  if (times.length === 1) {
    return { start: null, end: times[0] === 0 ? 1440 : times[0] };  // 截止式
  }
  return { start: times[0], end: times[1] };            // 时段式
}

/* ── 分类此刻是否在供应时段内（avail=null 表示全天供应）──────────────────────
   now 参数可注入，便于测试；浏览器里同 site.js 一样支持 window.__DEMO_NOW__ 演示钩子。
   边界规则：含开始时刻、不含结束时刻 —— "Until 3:30 PM" 在 3:29:59 显示、3:30:00 隐藏 */
function isAvailableNow(avail, now) {
  if (!avail) return true;
  now = now || ((typeof window !== 'undefined' && window.__DEMO_NOW__)
                ? new Date(window.__DEMO_NOW__) : new Date());
  const cur = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const { start, end } = avail;
  if (start === null) return cur < end;                 // 截止式：当天 end 之前
  if (start < end)    return cur >= start && cur < end; // 常规时段
  if (start > end)    return cur >= start || cur < end; // 跨夜时段
  return true;                                          // start==end 理论上不出现，防呆全天显示
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
let refreshFilter = null;   // 搜索/筛选的刷新函数（initSearch 赋值；供应时段变化时调用以重算结果）
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
      const searchStr = `${num} ${name} ${it.zh} ${esClean}`.toLowerCase();
      return `
        <article class="menu-item" data-search="${esc(searchStr)}" data-spicy="${spicy ? 1 : 0}">
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
  // 关键：绝不在页面滚动过程中调用 scrollIntoView（它会打断/抢占页面滚动，造成卡顿）
  // 只对 chip 条自身做横向 scrollTo —— 页面纵向滚动完全不受影响，丝般顺滑
  const sections = [...wrap.querySelectorAll('.menu-category')];
  const chips = [...nav.querySelectorAll('.cat-chip')];
  const scroller = nav.closest('.cat-nav') || nav;   // 横向滚动容器

  function centerChip(chip) {
    if (!chip || !scroller.getBoundingClientRect) return;
    const s = scroller.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    // 目标：把当前chip滚到条的水平中央（只动chip条，不动页面）
    const left = scroller.scrollLeft + (r.left - s.left) - (s.width - r.width) / 2;
    scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }

  let activeIdx = -1;         // 记住当前分类，避免同一分类反复触发
  let raf = 0;                // 用 requestAnimationFrame 合并高频回调
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const idx = sections.indexOf(en.target);
      if (idx === activeIdx) continue;
      activeIdx = idx;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        chips.forEach((c, j) => c.classList.toggle('active', j === idx));
        centerChip(chips[idx]);
      });
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  sections.forEach(s => io.observe(s));

  initAvailability(menu, sections, chips);   // 分类限时供应（渲染后立即生效，无闪烁）
}

/* ── 分类限时供应：到点自动隐藏、次日自动恢复（如午餐特价只卖到下午3:30）─────
   实现要点（每一条都是为了避免联动 bug）：
   · 菜单始终只渲染一次，用 .cat-unavailable 类控制显隐
     —— 不重渲染，搜索关键词/辣度筛选/滚动位置全都不会丢
   · 分类区块和顶部分类 chip 同步显隐，不会出现"点了 chip 却滚到空处"
   · 显隐用 class 而非 inline style，与搜索逻辑（inline style）互不覆盖
   · 状态变化时若搜索/筛选生效中，自动重算——隐藏分类不计入"找到N道菜"
   · 每30秒复查一次；切回标签页/从往返缓存恢复时立即复查
     （手机浏览器会冻结后台定时器，只靠 setInterval 会出现回到页面还显示午餐的 bug）*/
function initAvailability(menu, sections, chips) {
  if (!menu.some(cat => cat.available)) return;         // 无任何限时分类 → 零开销直接退出

  function update() {
    let changed = false;
    menu.forEach((cat, i) => {
      const sec = sections[i];
      if (!sec) return;                                 // 防呆：数组错位时不炸
      const hide = !isAvailableNow(cat.available);
      if (sec.classList.contains('cat-unavailable') !== hide) {
        sec.classList.toggle('cat-unavailable', hide);
        if (chips[i]) chips[i].classList.toggle('cat-unavailable', hide);
        changed = true;
      }
    });
    if (changed && typeof refreshFilter === 'function') refreshFilter();
  }

  update();                                             // 首屏立即按当前时间显隐
  setInterval(update, 30000);                           // 常驻复查：过点后最多30秒内消失
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') update();
  });
  window.addEventListener('pageshow', update);          // bfcache 恢复时立即复查
}

/* ── 菜单搜索 + 辣度筛选（联合过滤）──────────────────────────────────────── */
function initSearch() {
  const input = document.getElementById('menuSearch');
  const wrap  = document.getElementById('menuWrap');
  if (!input || !wrap) return;
  const clearBtn  = document.getElementById('menuSearchClear');
  const countEl   = document.getElementById('menuSearchCount');
  const noRes     = document.getElementById('menuNoResults');
  const catNav    = document.querySelector('.cat-nav');
  const filterBox = document.getElementById('menuFilter');
  let spicyFilter = 'all';                            // all | spicy | mild

  function apply() {
    const q      = input.value.trim().toLowerCase();
    const active = q !== '' || spicyFilter !== 'all'; // 有任一条件生效
    const sections = wrap.querySelectorAll('.menu-category');

    if (!active) {                                    // 无条件 → 全部恢复
      sections.forEach(s => {
        s.style.display = '';
        s.querySelectorAll('.menu-item').forEach(it => it.style.display = '');
      });
      if (catNav)   catNav.style.display   = '';
      if (countEl)  countEl.style.display  = 'none';
      if (noRes)    noRes.style.display    = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }

    if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
    if (catNav)   catNav.style.display   = 'none';    // 筛选中隐藏分类导航
    let total = 0;
    sections.forEach(sec => {
      if (sec.classList.contains('cat-unavailable')) return;  // 不在供应时段的分类：不参与筛选与计数
      let n = 0;
      sec.querySelectorAll('.menu-item').forEach(item => {
        const okText  = !q || (item.dataset.search || '').includes(q);
        const isSpicy = item.dataset.spicy === '1';
        const okSpicy = spicyFilter === 'all' ||
                        (spicyFilter === 'spicy' &&  isSpicy) ||
                        (spicyFilter === 'mild'  && !isSpicy);
        const hit = okText && okSpicy;                // 搜索 与 辣度 同时满足
        item.style.display = hit ? '' : 'none';
        if (hit) n++;
      });
      sec.style.display = n ? '' : 'none';
      total += n;
    });
    if (countEl) {
      const tpl = CFG.MENU_SEARCH_COUNT || 'Found {COUNT} dishes · 找到 {COUNT} 道菜';
      countEl.textContent = tpl.replace(/\{COUNT\}/g, total);
      countEl.style.display = '';
    }
    if (noRes) noRes.style.display = total ? 'none' : '';
  }

  let t = 0;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 100); });
  if (clearBtn) clearBtn.addEventListener('click', () => {
    input.value = ''; apply(); input.focus();
  });
  if (filterBox) {                                    // 辣度按钮点击
    filterBox.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        spicyFilter = btn.dataset.filter;
        filterBox.querySelectorAll('.filter-chip')
          .forEach(b => b.classList.toggle('active', b === btn));
        apply();
      });
    });
  }
  refreshFilter = apply;   // 暴露给供应时段逻辑：分类显隐变化时重算筛选结果/计数
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
    initSearch();                                     // 菜单渲染后启动搜索
  } catch (e) {
    if (wrap) wrap.innerHTML =
      `<div class="menu-error">⚠ 菜单加载失败：${esc(e.message)}<br>
       Menu failed to load. Please check data/menu_data.txt</div>`;
  }
}

if (typeof document !== 'undefined') {
  // 兼容脚本延迟注入的环境：readyState已过loading直接启动
  if (document.readyState !== 'loading') initMenu();
  else document.addEventListener('DOMContentLoaded', initMenu);
}

/* 供 Node 测试使用 */
if (typeof module !== 'undefined') {
  module.exports = { parseMenuData, adjustPrice, applyAdjustToMenu, splitNum, parseAvailability, isAvailableNow };
}
