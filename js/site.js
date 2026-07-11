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
/* 分隔符容错：中文输入法的全角"：""｜""％"一律接受 */
function sepIdx(line) {
  const a = line.indexOf(':'), b = line.indexOf('：');
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseConfig(text) {
  const cfg = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;        // 跳过空行和注释
    const idx = sepIdx(line);
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
  const today = dayRows[restaurantNow(cfg).getDay()];
  const row = document.querySelector(`[data-day="${today}"]`);
  if (row) row.classList.add('today');
  // 带 data-hide-when-empty 的元素：配置留空时整块自动隐藏
  document.querySelectorAll('[data-hide-when-empty]').forEach(el => {
    if (!el.textContent.trim()) el.style.display = 'none';
  });
}

/* ── 解析公告：日期 | 标题 | 内容 ─────────────────────────────────────────── */
function parseAnnouncements(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[|｜]/).map(s => s.trim());
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
   在线订餐平台按钮（链接来自 site_config.txt 的 ORDER_* 配置）
   规则：链接为空/缺失/非http(s) → 该平台按钮不显示；全部为空 → 整个区块隐藏
   ══════════════════════════════════════════════════════════════════════════ */
const ORDER_PLATFORMS = [
  //  配置key            品牌识别色           是否自家主按钮
  ['ORDER_ONLINE',    '#C9A227', true ],
  ['ORDER_DOORDASH',  '#EB1700', false],
  ['ORDER_UBEREATS',  '#06C167', false],
  ['ORDER_GRUBHUB',   '#F63440', false],
  ['ORDER_MENUFY',    '#2E7CF6', false],
  ['ORDER_EATSTREET', '#7A3DF0', false],
];

/* ── 营业时间解析："11:00 AM – 9:30 PM" → 分钟区间；Closed/不可解析 → null ── */
function parseTimeRange(str) {
  if (!str || /closed|休息/i.test(str)) return null;
  const m = [...String(str).matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi)];
  if (m.length < 2) return null;
  const toMin = (h, mm, ap) => (parseInt(h) % 12 + (/pm/i.test(ap) ? 12 : 0)) * 60 + parseInt(mm);
  let apO = m[0][3], apC = m[1][3];
  let open  = toMin(m[0][1], m[0][2], apO);
  let close = toMin(m[1][1], m[1][2], apC);
  /* 防呆：开门>打烊 且 两边同为AM或同为PM —— 这不是通宵店（通宵是PM–AM），
     而是上下午打错（如 "10:00 PM – 9:00 PM" 实为 10:00 AM 开门）。
     按用户本意自动纠正：PM–PM颠倒→开门改AM；AM–AM颠倒→打烊改PM。
     真通宵（PM–AM）不受任何影响。*/
  if (open >= close && /pm/i.test(apO) === /pm/i.test(apC)) {
    if (/pm/i.test(apO)) open -= 720;   // PM–PM → 开门按AM算
    else                 close += 720;  // AM–AM → 打烊按PM算
    try { console.warn('[hours] 疑似上下午打错，已按 ' + str + ' 的合理日间时段解读'); } catch(e) {}
  }
  return { open, close };
}

/* ── 营业剩余分钟数：营业中返回距打烊的分钟数，未营业返回 null（支持跨夜）── */
/* ── 时区锁定 ────────────────────────────────────────────────────────────────
   配置 TIMEZONE(IANA名, 如 America/New_York)后, 全站所有时间——横幅倒计时、
   订餐状态灯、进度环、午餐显隐、"今日"高亮——按餐馆所在时区显示, 与访客在哪无关。
   未配置/留空/名称无效 → 回退访客本地时间(即旧行为, 老部署零影响)。
   实现: 把此刻换算成目标时区的墙上时间重新构造Date, 下游的 getDay/getHours
   等逻辑一行不用改。now 可注入便于测试。 */
function restaurantNow(cfg, now) {
  now = now || new Date();
  const tz = String((cfg && cfg.TIMEZONE) || '').trim();
  if (!tz) return now;
  try {
    const shifted = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    return isNaN(shifted.getTime()) ? now : shifted;   // 解析失败 → 回退
  } catch (e) { return now; }                          // 无效时区名 → 回退
}

function minutesToClose(cfg, now) {
  now = now || restaurantNow(cfg);
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const r = parseTimeRange(cfg['HOURS_' + days[now.getDay()]]);
  if (!r) return null;
  const cur = now.getHours()*60 + now.getMinutes() + now.getSeconds()/60;
  if (r.close <= r.open) {                               // 跨夜（如营业到凌晨）
    if (cur < r.close) return r.close - cur;
    if (cur >= r.open) return r.close + 1440 - cur;
    return null;
  }
  return (cur >= r.open && cur < r.close) ? r.close - cur : null;
}

/* ── 现在餐厅是否营业中 ─────────────────────────────────────────────────── */
function isRestaurantOpen(cfg, now) {
  return minutesToClose(cfg, now) !== null;
}

/* ── 开门/打烊倒计时 ────────────────────────────────────────────────────────
   距开门 ≤N 分钟 → {mode:'opening', minutes}
   距打烊 ≤N 分钟 → {mode:'closing', minutes}
   其余时间 / 当天休息 / COUNTDOWN_MINUTES=0 → null（横幅隐藏）
   支持跨夜营业（如 5PM–1AM 的凌晨0:40 = 距打烊20分钟）*/
function getCountdown(cfg, now) {
  const W = cfg.COUNTDOWN_MINUTES === undefined ? 30 : (parseFloat(cfg.COUNTDOWN_MINUTES) || 0);
  /* 演示钩子：window.__DEMO_NOW__ 存在时用它当"现在"（仅演示页用，正式站无影响）*/
  now = now || ((typeof window !== 'undefined' && window.__DEMO_NOW__)
                ? new Date(window.__DEMO_NOW__) : restaurantNow(cfg));
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const r = parseTimeRange(cfg['HOURS_' + days[now.getDay()]]);
  const nowF = now.getHours()*60 + now.getMinutes() + now.getSeconds()/60;
  /* 先算出：现在营业吗？距开门/打烊各多少分钟 */
  let open = false, toOpen = null, toClose = null;
  if (r) {
    if (r.close <= r.open) {                      // 跨夜时段
      if      (nowF < r.close) { open = true;  toClose = r.close - nowF; }
      else if (nowF < r.open)  { open = false; toOpen  = r.open  - nowF; }
      else                     { open = true;  toClose = r.close + 1440 - nowF; }
    } else {
      if      (nowF < r.open)  { open = false; toOpen  = r.open  - nowF; }
      else if (nowF < r.close) { open = true;  toClose = r.close - nowF; }
      else                       open = false;    // 今日已打烊
    }
  }
  if (open)                                       // 营业中：仅临近打烊时倒计时
    return (W > 0 && toClose <= W) ? { mode: 'closing', minutes: Math.ceil(toClose) } : null;
  if (W > 0 && toOpen !== null && toOpen <= W)    // 打烊中但快开门：开门倒计时优先
    return { mode: 'opening', minutes: Math.ceil(toOpen) };
  return { mode: 'closed' };                      // 其余打烊时间：常驻打烊提示
}

/* ── 倒计时横幅渲染（两个页面共用 #countdownBanner）──────────────────────── */
function renderCountdown(cfg) {
  const el = document.getElementById('countdownBanner');
  if (!el) return;
  /* 环境安全的小工具（预览/测试环境缺某些API也不炸）*/
  const setVar  = (n, v) => { try { document.documentElement.style.setProperty(n, v); } catch(e) {} };
  const bodyCls = on => { try { document.body.classList.toggle('cd-on', on); } catch(e) {} };
  const cd = getCountdown(cfg);
  const closedTxt = cfg.COUNTDOWN_CLOSED !== undefined ? cfg.COUNTDOWN_CLOSED
    : 'Restaurant is currently closed — please come back tomorrow · 本店现已打烊，欢迎明天光临';
  const off = !cd || (cd.mode === 'closed' && !closedTxt.trim());   // 营业平段 / 打烊提示被留空关闭
  if (off) {
    el.style.display = 'none'; el.textContent = ''; el.className = 'countdown-banner';
    bodyCls(false); setVar('--cd-h', '0px');          // 内容位移归零
    return;
  }
  if (cd.mode === 'closed') {
    /* 打烊提示可带"查看营业时间"链接（LINK留空=纯文字）；全部转义防注入 */
    const link = (cfg.COUNTDOWN_CLOSED_LINK || '').trim();
    const linkTxt = cfg.COUNTDOWN_CLOSED_LINK_TEXT || 'Store Hours 营业时间';
    el.innerHTML = escapeHtml(closedTxt) + (link
      ? '&ensp;<a class="cd-link" href="' + escapeHtml(link) + '">' + escapeHtml(linkTxt) + '</a>'
      : '');
  } else {
    const tpl = cd.mode === 'opening' ? (cfg.COUNTDOWN_OPENING || '⏰ Opening in {MIN} min')
                                      : (cfg.COUNTDOWN_CLOSING || '⏰ Closing in {MIN} min');
    el.textContent = tpl.replace(/\{MIN\}/g, cd.minutes || '');
  }
  el.className = 'countdown-banner show cd-' + cd.mode;
  /* 与导航同级：钉在导航实际下沿（导航高度可能随屏幕变化，动态测量）*/
  const hdr = (document.querySelector && document.querySelector('.site-header')) || null;
  el.style.top = ((hdr && hdr.offsetHeight) ? hdr.offsetHeight : 68) + 'px';
  el.style.display = 'block';   // 必须显式block：置空会让CSS的display:none重新生效
  setVar('--cd-h', (el.offsetHeight || 44) + 'px');   // 页面内容整体让出横幅高度
  bodyCls(true);
}

/* ── 单个平台的指示灯状态 ──────────────────────────────────────────────────
   open   绿灯：营业中且未到截单时间，正常下单
   cutoff 黄灯：距打烊 ≤ 该平台CUTOFF分钟，当日单停收、预订单可下
   future 黄灯：打烊时段，平台可下预订单（仅第三方平台）
   closed 红灯：店家手动OFF，或打烊时段的官网直订
   参数 mins = 距打烊分钟数（未营业为 null）                              */
function platformStatus(key, cfg, mins) {
  const raw = (cfg[key + '_STATUS'] || 'ON').trim();
  const on  = /^(ON|YES|TRUE|开|1)$/i.test(raw);
  if (!on) return 'closed';                                   // 店家手动关闭 → 红
  if (mins === null)                                          // 打烊时段
    return key === 'ORDER_ONLINE' ? 'closed' : 'future';
  const cutoff = parseFloat(cfg[key + '_CUTOFF']) || 0;       // 打烊前N分钟截单
  if (cutoff > 0 && mins <= cutoff)
    return key === 'ORDER_ONLINE' ? 'closed' : 'cutoff';      // 截单窗口
  return 'open';                                              // 正常营业 → 绿
}

/* ── 订餐按钮进度环 ──────────────────────────────────────────────────────────
   语义：倒计时环，从100%满格走向0%空格。环走空 = 当前状态即将翻转。
   · 绿灯阶段：开门时满格 → 该平台停止接单(打烊-CUTOFF分钟)时走空，空=停止接单
   · "可预订"阶段(黄灯临近打烊/蓝灯打烊中本是同一段等待)：该平台截单时刻满格 →
     下一次开门走空，跨打烊、跨休息日连续倒数，空=即将开门
   · 红灯(不可用)与手动关闭(OFF)不带环；ORDER_PROGRESS_RING: OFF 可整体关闭
   与订餐区其余逻辑一致走真实时钟；now 可注入便于测试。
   返回 null=不画环；{frac: 剩余占比 1→0} */
function orderPhaseProgress(key, cfg, now) {
  if (/^(OFF|NO|FALSE|关|0)$/i.test(String(cfg.ORDER_PROGRESS_RING || '').trim())) return null;
  if (!/^(ON|YES|TRUE|开|1)$/i.test(String(cfg[key + '_STATUS'] || 'ON').trim())) return null;
  now = now || restaurantNow(cfg);
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const cutoff = parseFloat(cfg[key + '_CUTOFF']) || 0;
  /* 把前2天~后8天的营业时间展开成绝对时间区间（跨夜=收盘算到次日；休息日自然跳过）*/
  const iv = [];
  for (let d = -2; d <= 8; d++) {
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const r = parseTimeRange(cfg['HOURS_' + days[b.getDay()]]);
    if (!r) continue;
    iv.push([ new Date(b.getFullYear(), b.getMonth(), b.getDate(), 0, r.open),
              new Date(b.getFullYear(), b.getMonth(), b.getDate(), 0, r.close <= r.open ? r.close + 1440 : r.close) ]);
  }
  if (!iv.length) return null;                                  // 整周无营业时间→不画
  const clamp01 = x => (isFinite(x) && x > 0) ? (x > 1 ? 1 : x) : 0;
  const stopOf = pair => new Date(Math.max(pair[0].getTime(), pair[1].getTime() - cutoff * 60000));
  const cur = iv.find(p => now >= p[0] && now < p[1]);
  if (cur) {
    const stop = stopOf(cur);
    if (now < stop)                                             // 绿灯：剩余=距截单
      return { frac: clamp01((stop - now) / (stop - cur[0])) };
    const next = iv.find(p => p[0] > now);                      // 黄灯：剩余=距下次开门
    return next ? { frac: clamp01((next[0] - now) / (next[0] - stop)) } : null;
  }
  const prev = iv.slice().reverse().find(p => p[1] <= now);     // 蓝灯：上次截单→下次开门
  const next = iv.find(p => p[0] > now);
  if (!prev || !next) return null;
  const stop = stopOf(prev);
  return { frac: clamp01((next[0] - now) / (next[0] - stop)) }; // 蓝灯：剩余=距下次开门
}

/* 环形SVG：沿整个按钮外轮廓走一圈。故意不用 pathLength 归一——老Safari(≈16之前)
   对 rect 不支持该属性会把环画错；改由 fitOrderRings 用真实周长算 dash，
   dasharray/dashoffset 是 SVG 1.1 古老特性, 全浏览器兼容。进度值经按钮的
   data-ring 属性传给贴合函数。 */
function buildBtnRing(frac, badge) {
  return '<svg class="btn-ring ring-' + badge + '" aria-hidden="true">' +
         '<rect class="btn-ring-track"></rect>' +
         '<rect class="btn-ring-fill"></rect></svg>';
}

/* 按钮宽度随文字/换行变化 → 渲染后实测每个按钮的像素尺寸，把环的几何贴上去。
   贴合要点(像素级)：
   · getBoundingClientRect 取小数像素(offsetWidth取整会差出亚像素错位)
   · 绝对定位的参照是按钮的padding box(边框以内)，故SVG向外偏移边框宽度、
     并显式设为边框盒尺寸 —— 环的坐标系与按钮外框严格重合
   · 描边宽2.5、内缩1.25 → 描边外缘与按钮外缘齐平，圆角半径取平行曲线值
   · dashoffset 负移使环从按钮顶部正中开始；倒计时走空时可见弧向顶部收拢
   不可见(宽=0)时跳过，下轮渲染再试 */
function fitOrderRings() {
  try {
    const r2 = x => Math.round(x * 100) / 100;
    document.querySelectorAll('.order-btn[data-ring]').forEach(btn => {
      const svg = btn.querySelector('.btn-ring');
      if (!svg) return;
      const box = btn.getBoundingClientRect();
      const w = r2(box.width), h = r2(box.height);
      if (!w || !h) return;
      let bl = 1.5, bt = 1.5;                                  // 边框宽度(与CSS一致的后备值)
      try {
        const cs = (typeof getComputedStyle === 'function') ? getComputedStyle(btn) : null;
        if (cs) { bl = parseFloat(cs.borderLeftWidth) || 0; bt = parseFloat(cs.borderTopWidth) || 0; }
      } catch (e) {}
      svg.style.left = -bl + 'px'; svg.style.top = -bt + 'px';
      svg.style.width = w + 'px';  svg.style.height = h + 'px';
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      const inset = 1.25;                                      // = 描边宽/2 → 外缘齐平
      const rw = r2(w - inset * 2), rh = r2(h - inset * 2), r = r2(rh / 2);
      const straight = Math.max(0, rw - 2 * r);
      const P = r2(2 * straight + 2 * Math.PI * r);            // 真实周长
      let frac = parseFloat(btn.getAttribute && btn.getAttribute('data-ring'));
      if (!isFinite(frac) || frac < 0) frac = 0; if (frac > 1) frac = 1;
      svg.querySelectorAll('rect').forEach(rc => {
        rc.setAttribute('x', inset);  rc.setAttribute('y', inset);
        rc.setAttribute('width', rw); rc.setAttribute('height', rh);
        rc.setAttribute('rx', r);     rc.setAttribute('ry', r);
      });
      const fill = svg.querySelector('.btn-ring-fill');
      if (fill) {
        fill.setAttribute('stroke-dasharray', r2(frac * P) + ' ' + P);   // 剩余弧长(真实单位)
        fill.setAttribute('stroke-dashoffset', (-r2(straight / 2)));     // 起点=顶部正中(=半条直边)
      }
    });
  } catch (e) {}
}

function buildOrderButtons(cfg, minsOverride) {
  const mins = (minsOverride !== undefined) ? minsOverride : minutesToClose(cfg);
  return ORDER_PLATFORMS
    .filter(([key]) => /^https?:\/\//i.test((cfg[key] || '').trim()))
    .map(([key, color, primary]) => {
      const url    = cfg[key].trim();
      const label  = cfg[key + '_LABEL'] || key.replace('ORDER_', '');
      const status = platformStatus(key, cfg, mins);
      /* 进度环：仅生产路径(未传minsOverride)叠加；红灯(打烊中的官网直订)同样带环
         倒数到开门；手动OFF的平台没有时间相位，orderPhaseProgress自会返回null */
      const ring   = (minsOverride === undefined) ? orderPhaseProgress(key, cfg) : null;
      const sTitle = status === 'open'   ? (cfg.ORDER_STATUS_OPEN   || 'Open')
                   : status === 'cutoff' ? (cfg.ORDER_STATUS_CUTOFF || cfg.ORDER_STATUS_FUTURE || 'Order for later')
                   : status === 'future' ? (cfg.ORDER_STATUS_FUTURE || 'Order for later')
                   :                       (cfg.ORDER_STATUS_CLOSED || 'Unavailable');
      const badge  = status === 'cutoff' ? 'future' : status;   // 截单=黄灯视觉
      const icon   = badge === 'open' ? '✓' : badge === 'future' ? '◷' : '✕';
      const inner  = `<span class="order-dot" style="background:${color}"></span>` +
                     `${escapeHtml(label)}` +
                     `<span class="status-badge status-${badge}">${icon}</span>`;
      const cls    = `order-btn${primary ? ' order-btn-primary' : ''}`;
      if (status === 'closed') {                              // 红灯：不可点击(环照样倒数)
        return `<span class="${cls} order-btn-disabled"${ring ? ` data-ring="${Math.round(ring.frac * 1000) / 1000}"` : ''}` +
               ` title="${escapeHtml(sTitle)}">${inner}${ring ? buildBtnRing(ring.frac, badge) : ''}</span>`;
      }
      /* 进度环沿按钮外轮廓：仅加 data-ring 属性 + 一个SVG子元素，其余标记与原版一致 */
      return `<a class="${cls}"${ring ? ` data-ring="${Math.round(ring.frac * 1000) / 1000}"` : ''} href="${escapeHtml(url)}" target="_blank" rel="noopener"` +
             ` title="${escapeHtml(sTitle)}">${inner}${ring ? buildBtnRing(ring.frac, badge) : ''}</a>`;
    }).join('');
}

/* ── 三色图例（按钮下方的颜色说明）────────────────────────────────────────── */
function buildStatusLegend(cfg) {
  return `<span class="legend-item"><span class="status-badge status-open">✓</span>${escapeHtml(cfg.ORDER_STATUS_OPEN || 'Open')}</span>` +
         `<span class="legend-item"><span class="status-badge status-future">◷</span>${escapeHtml(cfg.ORDER_STATUS_FUTURE || 'Order for later')}</span>` +
         `<span class="legend-item"><span class="status-badge status-closed">✕</span>${escapeHtml(cfg.ORDER_STATUS_CLOSED || 'Unavailable')}</span>`;
}

function renderOrderPlatforms(cfg) {
  const html = buildOrderButtons(cfg);
  const legend = buildStatusLegend(cfg);
  document.querySelectorAll('.order-status-legend').forEach(el => {
    el.innerHTML = html ? legend : '';
    el.style.display = html ? '' : 'none';
  });
  document.querySelectorAll('.order-platforms').forEach(box => {
    box.innerHTML = html;
    const section = box.closest('[data-order-section]');
    if (section) section.style.display = html ? '' : 'none';  // 全空→隐藏整块
  });
  document.querySelectorAll('.order-cta').forEach(el => {     // 首页"在线订餐"按钮:
    el.style.display = html ? '' : 'none';                    // 订餐区整块隐藏时同步隐藏, 避免死锚点
  });
  /* 官网直订的配送提示：仅当自家链接有效且NOTE非空时显示 */
  const ownOk = /^https?:\/\//i.test((cfg.ORDER_ONLINE || '').trim());
  const note  = (cfg.ORDER_ONLINE_NOTE || '').trim();
  document.querySelectorAll('.order-note').forEach(el => {
    if (ownOk && note) { el.textContent = note; el.style.display = ''; }
    else               { el.textContent = '';   el.style.display = 'none'; }
  });
  /* 进度环贴合实际按钮尺寸；窗口尺寸变化/网页字体加载完成会改变按钮宽度→重贴合 */
  fitOrderRings();
  if (typeof window !== 'undefined' && !window.__ringFitWired) {
    window.__ringFitWired = true;
    window.addEventListener('resize', () => {
      clearTimeout(window.__ringFitT);
      window.__ringFitT = setTimeout(fitOrderRings, 150);
    });
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitOrderRings); } catch (e) {}
  }
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
    const m = line.match(/^(ENABLED|TITLE|BUTTON|SHOW_ONCE)\s*[:：]\s*(.*)$/i);
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
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof fetch !== 'undefined') {
function ready(fn) {
  // 脚本可能在页面加载完成后才被注入（某些预览器如此）——
  // readyState已过loading时直接执行，否则等DOMContentLoaded
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

  /* 配置提前开始加载，并暴露给 menu.js 复用（避免重复请求）*/
  window.CONFIG_READY = fetchText('data/site_config.txt')
    .then(parseConfig)
    .then(resolveConfig)
    .catch(e => { console.warn('配置加载失败：', e.message); return {}; });

  ready(async () => {
    initNav();
    const cfg = await window.CONFIG_READY;
    applyConfig(cfg);
    renderOrderPlatforms(cfg);   // 订餐平台按钮
    setInterval(() => renderOrderPlatforms(cfg), 60000);  // 每分钟刷新指示灯
    window.__SITE_CFG__ = cfg;   // 暴露给演示/调试用
    renderCountdown(cfg);        // 开门/打烊倒计时横幅
    setInterval(() => renderCountdown(cfg), 15000);       // 每15秒刷新倒计时
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
  module.exports = { parseConfig, resolveConfig, resolveStr, parsePopup, buildPopupHtml, popupKey, buildOrderButtons, buildStatusLegend, parseTimeRange, isRestaurantOpen, minutesToClose, platformStatus, getCountdown, ORDER_PLATFORMS, parseAnnouncements, escapeHtml, orderPhaseProgress, fitOrderRings, restaurantNow };
}
