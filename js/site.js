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
  ['ORDER_UBEREATS',  '#000000', false],   // Uber母品牌黑; 绿色让位给"营业"状态语义
  ['ORDER_GRUBHUB',   '#F63440', false],
  ['ORDER_MENUFY',    '#2E7CF6', false],
  ['ORDER_EATSTREET', '#7A3DF0', false],
];

/* ── 营业时间解析："11:00 AM – 9:30 PM" → 分钟区间；Closed/不可解析 → null ── */
function parseTimeRange(str) {
  if (!str || /closed|休息/i.test(str)) return null;
  const m = []; {                                              // 不用matchAll: Safari 13前抛错
    const re = /(\d{1,2}):(\d{2})\s*(AM|PM)/gi; let mm;
    while ((mm = re.exec(String(str)))) m.push(mm);
  }
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
  if (closureInfo(cfg, now)) return null;                     // 歇业中: 倒计时横幅静默,
                                                              // 消息由独立的预告横幅承载
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
  if (open) {                                     // 营业中
    if (W > 0 && toClose <= W)                    // 临近打烊: 倒计时优先级最高
      return { mode: 'closing', minutes: Math.ceil(toClose) };
    /* 午市横幅(LUNCH_HOURS 留空=不启用): 快结束→倒计时(与打烊同机制);
       结束后温和提示"晚市" DINNER_NOTE_MINUTES 分钟(默认90, 0=不提示)后自动隐藏 */
    const L = parseTimeRange(cfg.LUNCH_HOURS);
    if (L && L.close > L.open) {
      const toLunchEnd = L.close - nowF;
      const LW = cfg.LUNCH_COUNTDOWN_MINUTES === undefined ? W
               : (parseFloat(cfg.LUNCH_COUNTDOWN_MINUTES) || 0);   // 午市倒计时窗口(独立于打烊窗口)
      if (LW > 0 && nowF >= L.open && toLunchEnd > 0 && toLunchEnd <= LW)
        return { mode: 'lunchend', minutes: Math.ceil(toLunchEnd) };
      const DN = cfg.DINNER_NOTE_MINUTES === undefined ? 90 : (parseFloat(cfg.DINNER_NOTE_MINUTES) || 0);
      if (toLunchEnd <= 0 && nowF < L.close + DN)
        return { mode: 'dinner' };
    }
    return null;
  }
  if (W > 0 && toOpen !== null && toOpen <= W)    // 打烊中但快开门：开门倒计时优先
    return { mode: 'opening', minutes: Math.ceil(toOpen) };
  return { mode: 'closed' };                      // 其余打烊时间：常驻打烊提示
}

/* ── 倒计时横幅渲染（两个页面共用 #countdownBanner）──────────────────────── */
function renderCountdown(cfg) {
  const el = document.getElementById('countdownBanner');
  if (!el) return;
  const cd = getCountdown(cfg);
  const closedTxt = cfg.COUNTDOWN_CLOSED !== undefined ? cfg.COUNTDOWN_CLOSED
    : 'Restaurant is currently closed — please come back tomorrow · 本店现已打烊，欢迎明天光临';
  const off = !cd || (cd.mode === 'closed' && !closedTxt.trim());   // 营业平段 / 打烊提示被留空关闭
  if (off) {
    el.style.display = 'none'; el.textContent = ''; el.className = 'countdown-banner';
    layoutBanners();                                  // 重排横幅堆叠, 内容位移归零
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
            : cd.mode === 'lunchend' ? (cfg.COUNTDOWN_LUNCH_END || '🍜 Lunch hours ending — {MIN} min · 午市即将结束，还有 {MIN} 分钟')
            : cd.mode === 'dinner'   ? (cfg.COUNTDOWN_DINNER    || '🍽 Dinner hours · 晚市供应中')
                                      : (cfg.COUNTDOWN_CLOSING || '⏰ Closing in {MIN} min');
    el.textContent = tpl.replace(/\{MIN\}/g, cd.minutes || '');
  }
  el.className = 'countdown-banner show cd-' + cd.mode;
  el.style.display = 'block';   // 必须显式block：置空会让CSS的display:none重新生效
  layoutBanners();              // 与预告横幅共同排位并让出高度
}

/* ── 歇业预告横幅(独立于倒计时横幅的第二条横幅) ─────────────────────────────
   CLOSURE_ENABLED=ON 且填了日期时: 歇业开始前 CLOSURE_NOTICE_DAYS 天(默认14)起
   显示"预告"(前缀可用 CLOSURE_NOTICE_PREFIX 定制); 歇业期间显示 CLOSURE 原文;
   结束自动消失。与倒计时横幅是两个独立元素, 预告期内两条可同时叠放、互不混杂。 */
function noticeInfo(cfg, now) {
  const c = parseClosure(cfg, now);
  if (!c) return null;
  now = now || restaurantNow(cfg);
  if (!c.start) return { phase: 'during', text: c.msg };            // 无限期: 立即进行中
  if (now >= c.start && now < c.end) return { phase: 'during', text: c.msg };
  const days = cfg.CLOSURE_NOTICE_DAYS === undefined ? 14 : (parseFloat(cfg.CLOSURE_NOTICE_DAYS) || 0);
  if (days > 0 && now < c.start && now >= new Date(c.start.getTime() - days * 86400000)) {
    const pre = cfg.CLOSURE_NOTICE_PREFIX !== undefined ? cfg.CLOSURE_NOTICE_PREFIX
              : '📢 Advance Notice 提前通知 —';
    return { phase: 'before', text: (String(pre).trim() ? String(pre).trim() + ' ' : '') + c.msg };
  }
  return null;                                                      // 太早/已结束
}

function renderNotice(cfg) {
  const el = document.getElementById('closureNotice');
  if (!el) return;
  const n = noticeInfo(cfg);
  if (!n) {
    el.style.display = 'none'; el.textContent = ''; el.className = 'closure-notice';
  } else {
    el.textContent = n.text;                                        // textContent 注入, 天然防注入
    el.className = 'closure-notice show nt-' + n.phase;
    el.style.display = 'block';
  }
  layoutBanners();
}

/* 两条横幅共同排位: 倒计时在上、预告在下, 依次钉在导航下沿; 内容让位=两者高度和 */
function layoutBanners() {
  try {
    const hdr = (document.querySelector && document.querySelector('.site-header')) || null;
    let y = (hdr && hdr.offsetHeight) ? hdr.offsetHeight : 68, total = 0;
    ['countdownBanner', 'closureNotice'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.style.display !== 'block') return;
      el.style.top = y + 'px';
      const h = el.offsetHeight || 44;
      y += h; total += h;
    });
    try { document.documentElement.style.setProperty('--cd-h', total + 'px'); } catch (e) {}
    try { document.body.classList.toggle('cd-on', total > 0); } catch (e) {}
  } catch (e) {}
}

/* ── 单个平台的指示灯状态 ──────────────────────────────────────────────────
   open   绿灯：营业中且未到截单时间，正常下单
   cutoff 黄灯：距打烊 ≤ 该平台CUTOFF分钟，当日单停收、预订单可下
   future 黄灯：打烊时段，平台可下预订单（仅第三方平台）
   closed 红灯：店家手动OFF，或打烊时段的官网直订
   参数 mins = 距打烊分钟数（未营业为 null）                              */
/* ── 临时歇业/放假总闸(CLOSURE:) ─────────────────────────────────────────────
   用法(site_config.txt) —— 双钥匙:
   · CLOSURE_ENABLED: ON                         总开关。只有明确为 ON 时, 下面
     CLOSURE 的日期/文字才会奏效; OFF/留空/删掉 = 一切照常(日期可常年留着当模板)
   · CLOSURE:                                    留空 = 正常营业(开关开着也没内容可执行)
   · CLOSURE: 2026-07-13 to 2026-07-19 春节休假   日期区间(含首尾两天): 到点自动
     歇业、过期自动恢复。也认美式 7/13 - 7/19(不写年=按餐馆时区取今年, 跨年如
     12/28 - 1/3 自动进位); 只写一个日期=只关那一天
   · CLOSURE: ON 或任意不含日期的文字              立即无限期歇业(删空才恢复)
   整行文字原样显示在顶部横幅(ON 用默认提示)。歇业期间: 官网直订红色不可点;
   第三方平台保持蓝色"打烊中·可预订"仍可点(顾客可预订之后的单); 进度环从歇业前
   最后一次打烊的0%起、用整段歇业时长匀速回充, 到歇业后第一次真实开门瞬间恰好
   100%(与绿环无缝衔接)——关多久就充多久, 官网直订红环同样(无限期歇业无终点,
   环保持0%)。"最后接单"提示隐藏; 菜单/公告/营业时间表照常可浏览。 */
function parseClosure(cfg, now) {                    // 纯解析: null | {msg[, start, end]}
  if (!/^(ON|YES|TRUE|开|1)$/i.test(String((cfg && cfg.CLOSURE_ENABLED) || '').trim()))
    return null;                                     // 总开关未开 → 一切照常, 日期不奏效
  const v = String((cfg && cfg.CLOSURE) || '').trim();
  if (!v || /^(OFF|NO|FALSE|关|0)$/i.test(v)) return null;
  const msg = /^(ON|YES|TRUE|开|1)$/i.test(v) ? 'Temporarily closed 暂停营业中' : v;
  const ds = [];
  const re = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g;
  let m; while ((m = re.exec(v)) && ds.length < 2) {
    if (m[1]) ds.push([+m[1], +m[2], +m[3]]);
    else ds.push([m[6] ? (+m[6] < 100 ? 2000 + +m[6] : +m[6]) : null, +m[4], +m[5]]);
  }
  if (!ds.length) return { msg };                    // 不含日期 = 无限期歇业
  now = now || restaurantNow(cfg);
  ds.forEach(d => { if (d[0] === null) d[0] = now.getFullYear(); });   // 缺年份=今年
  if (ds.length === 1) ds.push(ds[0].slice());       // 单日 = 首尾同一天
  let start = new Date(ds[0][0], ds[0][1] - 1, ds[0][2]);
  let end   = new Date(ds[1][0], ds[1][1] - 1, ds[1][2] + 1);          // 含末日 → 次日0点
  if (end <= start) end = new Date(ds[1][0] + 1, ds[1][1] - 1, ds[1][2] + 1);  // 跨年进位
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return { msg };  // 日期非法→无限期(防呆)
  return { msg, start, end };
}
function closureInfo(cfg, now) {                     // 此刻是否歇业中(供横幅/状态灯/备注)
  const c = parseClosure(cfg, now);
  if (!c) return null;
  if (!c.start) return c;                            // 无限期
  now = now || restaurantNow(cfg);
  return (now >= c.start && now < c.end) ? c : null; // 未到/已过 → 正常(到点自动启停)
}
/* 展开锚点日前后若干天的营业时间为绝对时间区间(跨夜=收盘算到次日; 休息日自然跳过) */
function hoursIntervals(cfg, base, dFrom, dTo) {
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const iv = [];
  for (let d = dFrom; d <= dTo; d++) {
    const b = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
    const r = parseTimeRange(cfg['HOURS_' + days[b.getDay()]]);
    if (!r) continue;
    iv.push([ new Date(b.getFullYear(), b.getMonth(), b.getDate(), 0, r.open),
              new Date(b.getFullYear(), b.getMonth(), b.getDate(), 0, r.close <= r.open ? r.close + 1440 : r.close) ]);
  }
  return iv;
}

function platformStatus(key, cfg, mins) {
  const raw = (cfg[key + '_STATUS'] || 'ON').trim();
  const on  = /^(ON|YES|TRUE|开|1)$/i.test(raw);
  if (!on) return 'closed';                                   // 店家手动关闭 → 红
  if (closureInfo(cfg))                                       // 歇业: 直订红不可点, 第三方保持"可预订"
    return key === 'ORDER_ONLINE' ? 'closed' : 'future';
  if (mins === null)                                          // 打烊时段
    return key === 'ORDER_ONLINE' ? 'closed' : 'future';
  const cutoff = parseFloat(cfg[key + '_CUTOFF']) || 0;       // 打烊前N分钟截单
  if (cutoff > 0 && mins <= cutoff)
    return key === 'ORDER_ONLINE' ? 'closed' : 'cutoff';      // 截单窗口
  return 'open';                                              // 正常营业 → 绿
}

/* ── 订餐按钮进度环 ──────────────────────────────────────────────────────────
   语义：一条全程连续、无跳变的曲线——
   · 开门瞬间 = 100%(满格)；随后递减，各平台在自己的截单时刻(打烊-CUTOFF分钟)
     恰好走到 0%，窗口长短不同所以递减速率不同(官网直订无截单→打烊整点才走空)
   · 截单后到打烊：保持 0%(黄灯"临近打烊·可预订")；打烊时刻全部平台恒为 0%
   · 打烊后(蓝灯可预订/红灯官网直订)：从 0% 匀速回充，下一次开门瞬间恰好 100%，
     与绿灯首尾相接；跨周一休息日同样连续回充
   · 手动关闭(OFF)不带环；ORDER_PROGRESS_RING: OFF 可整体关闭
   与订餐区其余逻辑一致走真实时钟；now 可注入便于测试。
   返回 null=不画环；{frac: 0..1} */
function orderPhaseProgress(key, cfg, now) {
  if (/^(OFF|NO|FALSE|关|0)$/i.test(String(cfg.ORDER_PROGRESS_RING || '').trim())) return null;
  if (!/^(ON|YES|TRUE|开|1)$/i.test(String(cfg[key + '_STATUS'] || 'ON').trim())) return null;
  now = now || restaurantNow(cfg);
  const clamp01 = x => (isFinite(x) && x > 0) ? (x > 1 ? 1 : x) : 0;
  /* 歇业环: 从歇业前最后一次打烊(0%)起, 用整段歇业时长匀速回充,
     到歇业后第一次真实开门瞬间恰好100%(关多久充多久; 官网直订红环同样) */
  const clP = parseClosure(cfg, now);
  if (clP) {
    if (!clP.start) return closureInfo(cfg, now) ? { frac: 0, prog: 0, to: null } : null;  // 无限期: 归零且不渐变
    const before = hoursIntervals(cfg, clP.start, -4, 0).filter(p => p[1] <= clP.start);
    const after  = hoursIntervals(cfg, clP.end, 0, 10).filter(p => p[0] >= clP.end);
    const ws = before.length ? before[before.length - 1][1] : clP.start;
    const we = after.length  ? after[0][0] : clP.end;
    if (now >= ws && now < we)                                          // 歇业回充 → 开门变绿
      return { frac: clamp01((now - ws) / (we - ws)), prog: clamp01((now - ws) / (we - ws)), to: 'open' };
    /* 窗口之外(未开始/已彻底恢复) → 按正常逻辑继续 */
  }
  const cutoff = parseFloat(cfg[key + '_CUTOFF']) || 0;
  const iv = hoursIntervals(cfg, now, -2, 8);                   // 前2天~后8天的营业区间
  if (!iv.length) return null;                                  // 整周无营业时间→不画
  const stopOf = pair => new Date(Math.max(pair[0].getTime(), pair[1].getTime() - cutoff * 60000));
  const cur = iv.find(p => now >= p[0] && now < p[1]);
  if (cur) {
    const stop = stopOf(cur);
    if (now < stop) {                                           // 开门100% → 截单0%(各平台速率不同)
      const f = clamp01((stop - now) / (stop - cur[0]));        // 渐变: 绿 → 黄(第三方)/红(自家)
      return { frac: f, prog: 1 - f, to: cutoff > 0 ? 'future' : 'closed' };
    }
    return { frac: 0, prog: 1, to: 'future' };                  // 截单后到打烊: 持平, 已是纯黄
  }
  const prev = iv.slice().reverse().find(p => p[1] <= now);     // 打烊后: 从打烊时刻0%起回充,
  const next = iv.find(p => p[0] > now);                        // 下次开门瞬间恰好100%(无缝衔接绿灯)
  if (!prev || !next) return null;
  const f = clamp01((now - prev[1]) / (next[0] - prev[1]));   // 打烊回充: 黄/红 → 开门瞬间纯绿
  return { frac: f, prog: f, to: 'open' };
}

/* 环形SVG：沿整个按钮外轮廓走一圈。故意不用 pathLength 归一——老Safari(≈16之前)
   对 rect 不支持该属性会把环画错；改由 fitOrderRings 用真实周长算 dash，
   dasharray/dashoffset 是 SVG 1.1 古老特性, 全浏览器兼容。进度值经按钮的
   data-ring 属性传给贴合函数。 */
function buildBtnRing(frac, badge, mixColor) {
  return '<svg class="btn-ring ring-' + badge + '" aria-hidden="true">' +
         '<path class="btn-ring-track"></path>' +
         '<path class="btn-ring-fill"' + (mixColor ? ' style="stroke: ' + mixColor + '"' : '') + '></path></svg>';
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
      /* 手工构造药丸路径, 起笔=顶部正中、顺时针一圈:
         dash图案在闭合路径上不会绕圈衔接, 起点必须由路径本身决定
         (此前用负dashoffset挪起点会在末尾留缺口——100%也无法闭合的根因) */
      const y0 = inset, y1 = r2(inset + rh);
      const xa = r2(inset + r), xb = r2(inset + rw - r), cx = r2(w / 2);
      const d = 'M ' + cx + ' ' + y0 + ' L ' + xb + ' ' + y0 +
                ' A ' + r + ' ' + r + ' 0 0 1 ' + xb + ' ' + y1 +
                ' L ' + xa + ' ' + y1 +
                ' A ' + r + ' ' + r + ' 0 0 1 ' + xa + ' ' + y0 + ' Z';
      svg.querySelectorAll('path').forEach(p0 => p0.setAttribute('d', d));
      const fill = svg.querySelector('.btn-ring-fill');
      if (fill) {
        if (frac >= 0.9995) {                                  // 满格: 直接实线, 绝对闭合
          fill.removeAttribute('stroke-dasharray'); fill.style.display = '';
        } else if (frac <= 0.0005) {                           // 空格: 隐藏(避免圆头帽画出小圆点)
          fill.style.display = 'none';
        } else {
          fill.setAttribute('stroke-dasharray', r2(frac * P) + ' ' + P);
          fill.style.display = '';
        }
      }
    });
  } catch (e) {}
}

/* 单个订餐按钮的标记生成(平台/电话共用)。平台路径输出与历史版本逐字节一致,
   由剥环A/B回归守护; opt 仅供电话按钮定制: {url,label,status,tel,phaseKey} */
function buildOrderBtn(cfg, mins, minsOverride, key, color, primary, opt) {
  opt = opt || {};
  const url    = (opt.url !== undefined) ? opt.url : cfg[key].trim();
  const label  = (opt.label !== undefined) ? opt.label : (cfg[key + '_LABEL'] || key.replace('ORDER_', ''));
  const status = (opt.status !== undefined) ? opt.status : platformStatus(key, cfg, mins);
  /* 进度环：仅生产路径(未传minsOverride)叠加；红灯(打烊中的自家渠道)同样带环
     倒数到开门；手动OFF的平台没有时间相位，orderPhaseProgress自会返回null */
  const ring   = (minsOverride === undefined) ? orderPhaseProgress(opt.phaseKey || key, cfg) : null;
  const sTitle = status === 'open'   ? (cfg.ORDER_STATUS_OPEN   || 'Open')
               : status === 'cutoff' ? (cfg.ORDER_STATUS_CUTOFF || cfg.ORDER_STATUS_FUTURE || 'Order for later')
               : status === 'future' ? (cfg.ORDER_STATUS_FUTURE || 'Order for later')
               :                       (cfg.ORDER_STATUS_CLOSED || 'Unavailable');
  const badge  = status === 'cutoff' ? 'future' : status;   // 截单=黄灯视觉
  const icon   = badge === 'open' ? '✓' : badge === 'future' ? '◷' : '✕';
  /* 过渡色: 仅进度环在相位中从当前状态色渐变到下一状态色(翻转瞬间=纯色);
     状态点保持三色纯色 —— 点=当前状态的定论, 环=趋势 */
  const mixCol = (ring && ring.to && ring.to !== badge) ? statusMix(badge, ring.to, ring.prog) : null;
  /* 整钮填色: 背景铺满一层与环渐变同色的浅色(16%透明), 随相位实时变色;
     background-image 平铺, 不动底色/圆角; 无环(手动OFF/总开关关)则不上色 */
  const tintBase = ring ? (mixCol || statusMix(badge, badge, 0)) : null;
  const tint = tintBase ? tintBase.replace('hsl(', 'hsla(').replace(')', ', 0.16)') : null;
  const water = tint
    ? ` style="background-image: linear-gradient(0deg, ${tint}, ${tint})"`
    : '';
  const inner  = `<span class="order-dot" style="background:${color}"></span>` +
                 `${escapeHtml(label)}` +
                 `<span class="status-badge status-${badge}">${icon}</span>`;
  const cls    = `order-btn${primary ? ' order-btn-primary' : ''}`;
  if (status === 'closed') {                              // 红灯：不可点击(环照样倒数)
    return `<span class="${cls} order-btn-disabled"${ring ? ` data-ring="${Math.round(ring.frac * 1000) / 1000}"` : ''}${water}` +
           ` title="${escapeHtml(sTitle)}">${inner}${ring ? buildBtnRing(ring.frac, badge, mixCol) : ''}</span>`;
  }
  /* 进度环沿按钮外轮廓：仅加 data-ring 属性 + 一个SVG子元素，其余标记与原版一致 */
  return `<a class="${cls}"${ring ? ` data-ring="${Math.round(ring.frac * 1000) / 1000}"` : ''}${water} href="${escapeHtml(url)}"${opt.tel ? '' : ' target="_blank" rel="noopener"'}` +
         ` title="${escapeHtml(sTitle)}">${inner}${ring ? buildBtnRing(ring.frac, badge, mixCol) : ''}</a>`;
}

function buildOrderButtons(cfg, minsOverride) {
  const mins = (minsOverride !== undefined) ? minsOverride : minutesToClose(cfg);
  return ORDER_PLATFORMS
    .filter(([key]) => /^https?:\/\//i.test((cfg[key] || '').trim()))
    .map(([key, color, primary]) => buildOrderBtn(cfg, mins, minsOverride, key, color, primary))
    .join('');
}

/* ── 电话订餐按钮 ────────────────────────────────────────────────────────────
   与官网直订同一套自家渠道规则: 营业=绿可点(tel:拨号)、打烊=红不可点、歇业=红;
   进度环用虚拟键 ORDER_PHONE(默认STATUS=ON、CUTOFF=0 → 开门满格、打烊整点走空,
   打烊后回充), 与 ORDER_ONLINE 的手动开关互不牵连。
   ORDER_PHONE_STATUS: OFF 可整颗隐藏; 文字改 ORDER_PHONE_LABEL; 号码复用 PHONE_LINK */
function buildPhoneBtn(cfg, mins, minsOverride) {
  if (!/^(ON|YES|TRUE|开|1)$/i.test(String(cfg.ORDER_PHONE_STATUS || 'ON').trim())) return '';
  const status = closureInfo(cfg) ? 'closed' : (mins === null ? 'closed' : 'open');
  return buildOrderBtn(cfg, mins, minsOverride, 'ORDER_PHONE', '#4A0E0E', false, {
    url: 'tel:' + String(cfg.PHONE_LINK || '').trim(),
    label: (cfg.ORDER_PHONE_LABEL !== undefined) ? cfg.ORDER_PHONE_LABEL : '☎ 电话订餐 Call to Order',
    status: status, tel: true, phaseKey: 'ORDER_PHONE'
  });
}

/* ── 状态过渡色 ──────────────────────────────────────────────────────────────
   环与状态点在相位进行中沿两个状态色之间渐变: 相位开始=当前状态纯色, 相位结束
   (翻转瞬间)=下一状态纯色。用HSL色相最短路径插值——绿(140°)→黄(42°)→红(0°)
   正好是红绿灯色带, 避免RGB直混出现泥色; 四个相位衔接点全程连续。
   #22C55E=hsl(142,71%,45%) · #FFB300=hsl(42,100%,50%) · #EF4444=hsl(0,84%,60%) */
const STATUS_HSL = { open: [142, 71, 45], future: [42, 100, 50], closed: [0, 84, 60] };
function statusMix(fromBadge, toBadge, t) {
  const a = STATUS_HSL[fromBadge], b = STATUS_HSL[toBadge];
  if (!a || !b) return null;
  t = (isFinite(t) && t > 0) ? (t > 1 ? 1 : t) : 0;
  const dh = ((b[0] - a[0] + 540) % 360) - 180;              // 色相最短路径
  const h = Math.round(a[0] + dh * t), s = Math.round(a[1] + (b[1] - a[1]) * t),
        l = Math.round(a[2] + (b[2] - a[2]) * t);
  return 'hsl(' + ((h % 360) + 360) % 360 + ', ' + s + '%, ' + l + '%)';
}

/* 取餐方式小图标(线条风, 描边继承标签颜色) */
const OG_BAG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M6 8h12l-1.2 12H7.2L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
const OG_CAR = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="7" cy="17" r="2.2"/><circle cx="17" cy="17" r="2.2"/>' +
  '<path d="M4.8 17H3v-5.5L5.2 7h8.3l3.6 4.5H21V17h-1.8"/><path d="M9.2 17h5.6"/><path d="M4 11.5h12.5"/></svg>';

/* ── 组标签上方的十格进度隔断 ─────────────────────────────────────────────────
   每枚矩形=10%, 支持部分点亮(格内左亮右淡的同色渐变, 0.1%精度)。
   绿行=官网直订环的百分比, 蓝行=在线平台环(有环平台的均值)。
   与进度环共用 orderPhaseProgress: 环总开关OFF→两行隐藏; 官网手动OFF→绿行隐藏;
   手动OFF的平台不计入蓝行均值; 组隐藏时该行随组消失。 */
const RECTROW_COL = { pick: ['rgba(46,125,70,.95)', 'rgba(46,125,70,.16)'],
                      both: ['rgba(46,95,143,.95)', 'rgba(46,95,143,.16)'] };
function buildGroupRectRow(kind, frac) {
  if (frac === null || frac === undefined || !isFinite(frac)) return '';
  const c = RECTROW_COL[kind];
  if (!c) return '';
  const cl = Math.max(0, Math.min(1, frac));
  let s = `<div class="og-rectrow og-rectrow-${kind}" title="${Math.round(cl * 1000) / 10}%">`;
  for (let i = 0; i < 10; i++) {
    const fx = Math.round(Math.max(0, Math.min(1, cl * 10 - i)) * 1000) / 10;
    s += `<span class="og-rect" style="background:linear-gradient(90deg,${c[0]} ${fx}%,${c[1]} ${fx}%)"></span>`;
  }
  return s + '</div>';
}

/* ── 满额赠送(SPECIAL DEALS) ─────────────────────────────────────────────────
   全部由 site_config.txt 驱动, 改活动零代码:
   · DEALS_ENABLED: ON               总开关(仅明确 ON/YES/TRUE/开/1 生效; 其余=全部隐藏)
   · DEAL_1: 门槛 | 赠品 | 范围 | 有效期    每行一条, 竖线分段; 第3/4段可省
       范围: direct / phone / online(在线渠道,不含电话) / all / 逗号清单(如 doordash,phone)
       文字标记(任何段通用): ~~旧价~~ = 划线, **新价** = 红色醒目
   · DEAL_LABEL: 区标题文字 · ORDER_DIRECT_CARD_NOTE: 官网直订下的银行卡提醒(留空=隐藏,
     不随活动开关 —— 它是支付提示不是促销)
   编号可留空档(删掉 DEAL_2 保留 1、3 也行); 门槛或赠品为空的行自动跳过;
   总开关关闭或没有任何活动时整块(含标题)消失。 */
const escMd = t => escapeHtml(t)
  .replace(/~~([^~]+)~~/g, '<s class="dt-old">$1</s>')
  .replace(/\*\*([^*]+)\*\*/g, '<b class="dt-new">$1</b>');

const DEAL_SCOPE_TAG = {            // 关键词范围: [文字, 前景, 底色, 边色]
  direct: ['Order Direct only · 仅官网直订', '#8A6A12', '#FFF3D6', '#D9B75A'],
  phone:  ['Phone orders only · 仅电话订餐', '#7A1F1F', '#FBE9E4', '#E2A08F'],
  online: ['Online orders only · 仅在线下单', '#0C447C', '#E6F1FB', '#85B7EB'],
  all:    ['All platforms · 全渠道 · 含电话', '#27500A', '#EAF3DE', '#97C459']
};
const DEAL_SCOPE_NAMES = { direct: '官网直订', phone: '电话订餐', doordash: 'DoorDash',
  ubereats: 'Uber Eats', grubhub: 'Grubhub', menufy: 'Menufy', eatstreet: 'EatStreet' };

/* 有效期文字里最后一个可解析日期 = 最后有效日(含当天)。认 2026-08-31 / 8/31
   (不写年=今年, 跨年活动请写完整年份); 解析不出日期 = 纯展示、永不自动下架 */
function dealLastDate(validText, now) {
  const re = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g;
  let m, last = null;
  while ((m = re.exec(String(validText || '')))) {
    last = m[1] ? [+m[1], +m[2], +m[3]]
                : [m[6] ? (+m[6] < 100 ? 2000 + +m[6] : +m[6]) : now.getFullYear(), +m[4], +m[5]];
  }
  return last && !isNaN(new Date(last[0], last[1] - 1, last[2]).getTime()) ? last : null;
}
/* 消失时刻 = 最后有效日当天的打烊时刻(今天截止 → 关门即下架); 该日休息则回退到
   次日0点; 跨午夜营业(如营业到凌晨1点)撑到实际打烊 */
function dealCloseMoment(cfg, last) {
  const base = new Date(last[0], last[1] - 1, last[2], 12, 0);
  const iv = hoursIntervals(cfg, base, 0, 0);
  return iv.length ? iv[0][1] : new Date(last[0], last[1] - 1, last[2] + 1);
}

function parseDeals(cfg, now) {
  if (!/^(ON|YES|TRUE|开|1)$/i.test(String(cfg.DEALS_ENABLED || '').trim())) return [];
  now = now || restaurantNow(cfg);
  const out = [];
  for (let i = 1; i <= 30; i++) {                    // 编号宽容: 1..30 内允许留空档
    const raw = cfg['DEAL_' + i];
    if (raw === undefined) continue;
    const p = String(raw).split('|').map(s => s.trim());
    if (!p[0] || !p[1]) continue;                    // 门槛/赠品缺一即跳过
    let apply = '', valid = '';
    for (const s of p.slice(3)) {                    // 第3段之后顺序自由: auto/manual 或有效期文字
      if (/^(auto|manual|select)$/i.test(s)) apply = s.toLowerCase();
      else if (s) valid = s;
    }
    const last = dealLastDate(valid, now);
    if (last && now >= dealCloseMoment(cfg, last)) continue;   // 最后有效日打烊后 → 自动消失
    out.push({ th: p[0], gift: p[1], scope: (p[2] || 'direct').toLowerCase(), valid, apply,
               endsToday: !!(last && now.getFullYear() === last[0] &&
                             now.getMonth() === last[1] - 1 && now.getDate() === last[2]) });
  }
  return out;
}

const DEAL_APPLY_TAG = {
  auto:   ['Applied automatically · 自动生效', '#27500A', '#EAF3DE', '#97C459'],
  manual: ['Mention when ordering · 下单时请告知', '#9A6B00', '#FFF3D6', '#E0BC66'],
  select: ['Select at checkout · 结账时请选择', '#0C447C', '#E6F1FB', '#85B7EB']
};
function dealChips(scope, apply, endsToday) {
  let t = DEAL_SCOPE_TAG[scope];
  if (!t) {                                          // 自定义清单: 代号映射成可读标签
    const names = String(scope).split(',').map(k => DEAL_SCOPE_NAMES[k.trim()] || escapeHtml(k.trim()));
    t = ['Only 仅: ' + names.join(' + '), '#5F5E5A', '#F1EFE8', '#D3D1C7'];
  }
  const a = DEAL_APPLY_TAG[apply];
  return `<div class="dt-scope"><span style="color:${t[1]};background:${t[2]};border-color:${t[3]}">${t[0]}</span>` +
         (a ? `<span style="color:${a[1]};background:${a[2]};border-color:${a[3]}">${a[0]}</span>` : '') +
         (endsToday ? `<span style="color:#fff;background:#C0392B;border-color:#A93226">⏳ Ends today · 今日截止</span>` : '') +
         `</div>`;
}

function buildDealsHtml(cfg, now) {
  const deals = parseDeals(cfg, now);
  if (!deals.length) return '';
  const label = (cfg.DEAL_LABEL !== undefined) ? cfg.DEAL_LABEL
              : '🎁 SPECIAL DEALS · 满额赠送（各票适用范围见票面标签）';
  return `<div class="deal-label"><span class="deal-pill">${escapeHtml(label)}</span></div>` +
         `<div class="deal-strip">` + deals.map(d =>
           `<div class="deal-ticket"><span><div class="dt-th">${escMd(d.th)}</div>` +
           `<div class="dt-gift">${escMd(d.gift)}</div>` +
           dealChips(d.scope, d.apply, d.endsToday) +
           (d.valid ? `<div class="dt-valid">${escMd(d.valid)}</div>` : '') +
           `</span></div>`).join('') + `</div>`;
}

/* ── 分组订餐区(设计定稿) ─────────────────────────────────────────────────
   自取推荐组=官网直订; 自取&外送推荐组=电话订餐+全部第三方平台。
   · 归属可改: ORDER_<平台>_GROUP / ORDER_PHONE_GROUP = pickup 或 pickup_delivery
   · 组标签: ORDER_GROUP_PICKUP_LABEL / ORDER_GROUP_BOTH_LABEL
   · 组说明: ORDER_GROUP_PICKUP_NOTE / ORDER_GROUP_BOTH_NOTE(留空=不显示该行)
   · 某组一个按钮都没有时, 该组连标签带说明整体隐藏 */
function buildGroupedOrderHtml(cfg) {
  const mins = minutesToClose(cfg);
  const groupOf = key => {
    const v = String(cfg[key + '_GROUP'] || '').trim().toLowerCase();
    if (v === 'pickup' || v === 'pickup_delivery') return v;
    return key === 'ORDER_ONLINE' ? 'pickup' : 'pickup_delivery';
  };
  let g1 = '', g2 = '';
  const phone = buildPhoneBtn(cfg, mins);
  if (phone && groupOf('ORDER_PHONE') === 'pickup_delivery') g2 += phone;   // 电话默认领衔第二组
  ORDER_PLATFORMS.forEach(([key, color, primary]) => {
    if (!/^https?:\/\//i.test((cfg[key] || '').trim())) return;
    const b = buildOrderBtn(cfg, mins, undefined, key, color, primary);
    if (groupOf(key) === 'pickup') g1 += b; else g2 += b;
  });
  if (phone && groupOf('ORDER_PHONE') === 'pickup') g1 += phone;
  const seg = (btns, icons, labelKey, defLabel, pillCls, extra, noteKey, defNote, noteCls) => {
    if (!btns) return '';
    const labelTxt = (cfg[labelKey] !== undefined) ? cfg[labelKey] : defLabel;
    const noteTxt  = (cfg[noteKey]  !== undefined) ? cfg[noteKey]  : defNote;
    return `<div class="order-group-label"><span class="order-group-pill ${pillCls}">${icons}` +
           `<span>${escapeHtml(labelTxt)}</span></span></div>` +
           `<div class="order-group-row">${btns}</div>` + (extra || '') +
           (String(noteTxt).trim() ? `<p class="order-group-note ${noteCls}">${escapeHtml(noteTxt)}</p>` : '');
  };
  /* 官网直订下的银行卡提醒(支付提示, 独立于满赠总开关; 留空=隐藏) */
  const cardNote = String(cfg.ORDER_DIRECT_CARD_NOTE || '').trim()
    ? `<p class="card-note">${escMd(cfg.ORDER_DIRECT_CARD_NOTE.trim())}</p>` : '';
  /* 十格进度隔断的两个数据源 */
  const isOff = k => /^(OFF|NO|FALSE|关|0)$/i.test(String(cfg[k + '_STATUS'] || 'ON').trim());
  const nowR = restaurantNow(cfg);
  const rD = isOff('ORDER_ONLINE') ? null : orderPhaseProgress('ORDER_ONLINE', cfg, nowR);
  let tpSum = 0, tpN = 0;
  for (const p of ORDER_PLATFORMS) {
    if (p[0] === 'ORDER_ONLINE' || isOff(p[0])) continue;
    const r = orderPhaseProgress(p[0], cfg, nowR);
    if (r) { tpSum += r.frac; tpN++; }
  }
  const rowPick = g1 ? buildGroupRectRow('pick', rD ? rD.frac : null) : '';
  const rowBoth = g2 ? buildGroupRectRow('both', tpN ? tpSum / tpN : null) : '';
  return buildDealsHtml(cfg)
       + rowPick
       + seg(g1, OG_BAG, 'ORDER_GROUP_PICKUP_LABEL', 'RECOMMENDED FOR PICK-UP · 自取推荐',
             'og-pick', cardNote, 'ORDER_GROUP_PICKUP_NOTE',
             'Delivery on Order Direct depends on our own driver availability · 官网直订的外送视本店司机运力而定', 'og-n1')
       + rowBoth
       + seg(g2, OG_BAG + OG_CAR, 'ORDER_GROUP_BOTH_LABEL', 'RECOMMENDED FOR PICK-UP & DELIVERY · 自取 & 外送推荐',
             'og-both', '', 'ORDER_GROUP_BOTH_NOTE',
             'Delivery for these options — including phone orders — is fulfilled by online platform drivers: more drivers, more stable · 以上渠道的外送（含电话订餐）均由外送平台司机配送，司机更多、更稳定', 'og-n2');
}

/* ── 三色图例（按钮下方的颜色说明）────────────────────────────────────────── */
function buildStatusLegend(cfg) {
  return `<span class="legend-item"><span class="status-badge status-open">✓</span>${escapeHtml(cfg.ORDER_STATUS_OPEN || 'Open')}</span>` +
         `<span class="legend-item"><span class="status-badge status-future">◷</span>${escapeHtml(cfg.ORDER_STATUS_FUTURE || 'Order for later')}</span>` +
         `<span class="legend-item"><span class="status-badge status-closed">✕</span>${escapeHtml(cfg.ORDER_STATUS_CLOSED || 'Unavailable')}</span>`;
}

function renderOrderPlatforms(cfg) {
  const html = buildGroupedOrderHtml(cfg);
  const legend = buildStatusLegend(cfg);
  document.querySelectorAll('.order-status-legend').forEach(el => {
    el.innerHTML = html ? legend : '';
    el.style.display = html ? '' : 'none';
  });
  document.querySelectorAll('.order-platforms').forEach(box => {
    box.classList.add('order-platforms--grouped');   // 分组版式(纵向堆叠); 原flex规则保持不动
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
    if (ownOk && note && !closureInfo(cfg)) { el.textContent = note; el.style.display = ''; }
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
    renderNotice(cfg);           // 歇业预告横幅(独立的第二条)
    setInterval(() => { renderCountdown(cfg); renderNotice(cfg); }, 15000);   // 每15秒刷新两条横幅
    window.addEventListener('resize', layoutBanners);   // 视口变化立即重排堆叠, 双横幅永不互相遮挡
    /* 浏览器标签页标题：根据 body 的 data-page 取对应配置 */
    const page = (document.body && document.body.dataset) ? document.body.dataset.page : '';   // 不用?.: Safari 13.1前语法报错
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
  module.exports = { parseConfig, resolveConfig, resolveStr, parsePopup, buildPopupHtml, popupKey, buildOrderButtons, buildStatusLegend, parseTimeRange, isRestaurantOpen, minutesToClose, platformStatus, getCountdown, ORDER_PLATFORMS, parseAnnouncements, escapeHtml, orderPhaseProgress, fitOrderRings, restaurantNow, closureInfo, parseClosure, hoursIntervals, noticeInfo, buildOrderBtn, buildPhoneBtn, buildGroupedOrderHtml, statusMix, parseDeals, buildDealsHtml, buildGroupRectRow };
}
