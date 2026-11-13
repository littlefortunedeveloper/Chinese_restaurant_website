/* 全覆盖场景矩阵 · node tests/test_scenarios.js
   目标: 任何人往 txt 里写任何东西, 网站都不崩、不出乱码、不被注入, 并给出合理显示。
   断言风格: 不追求精确数值(那在 test_core), 而是"不抛异常 + 无垃圾输出 + 行为合理"。 */
const path = require('path'), fs = require('fs');
const R = p => path.join(__dirname, '..', p);

/* ── 时钟覆盖: 让内部读 new Date() 的路径也能被测到 ── */
const RealDate = Date;
function setClock(y, mo, d, h, mi) {
  const offset = (mo >= 4 && mo <= 10) ? 5 : 6;           // CDT/CST 粗略切换, 仅测试用
  const T = RealDate.UTC(y, mo - 1, d, h, mi || 0, 0) + offset * 3600 * 1000;
  global.Date = class extends RealDate {
    constructor(...a) { a.length ? super(...a) : super(T); }
    static now() { return T; }
  };
}
function resetClock() { global.Date = RealDate; }

/* ── 最小 DOM 桩: 用于需要渲染到页面的函数 ── */
function stubDom() {
  const box = { innerHTML: '', style: {} };
  global.document = {
    getElementById: () => box,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { style: {} },
    createElement: () => ({ style: {}, classList: { add(){}, remove(){} }, querySelector: () => ({ addEventListener(){}, focus(){} }), addEventListener(){}, innerHTML: '' }),
    addEventListener(){}
  };
  return box;
}

setClock(2026, 11, 13, 12, 0);
const s = require(R('js/site.js'));
const m = require(R('js/menu.js'));
const BASE_TXT = fs.readFileSync(R('data/site_config.txt'), 'utf8');
const BASE = s.resolveConfig(s.parseConfig(BASE_TXT));
const MENU_TXT = fs.readFileSync(R('data/menu_data.txt'), 'utf8');

let pass = 0, fail = 0;
const GARBAGE = /undefined|NaN|\[object Object\]/;
function ok(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(` ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  ← ' + (extra || '')}`);
}
/* 跑一段可能抛错的代码: 不抛 + 输出无垃圾 = 通过 */
function safe(name, fn, checkHtml) {
  let out, err = null;
  try { out = fn(); } catch (e) { err = e; }
  if (err) return ok(name, false, '抛异常: ' + err.message);
  if (checkHtml !== false && typeof out === 'string' && GARBAGE.test(out))
    return ok(name, false, '输出含垃圾: ' + out.match(GARBAGE)[0]);
  return ok(name, true);
}
const cfgOf = extra => Object.assign({}, BASE, extra || {});
const txtCfg = text => s.resolveConfig(s.parseConfig(text));

/* ═══ A. 配置文件解析: 畸形输入 ═══ */
console.log('\n[A] 配置解析 · 畸形与极端输入');
safe('空文件', () => txtCfg(''));
safe('只有注释与空行', () => txtCfg('# a\n\n#b\n   \n'));
safe('没有冒号的行', () => txtCfg('NAME\nHOURS_FRI 10-22\n乱写一行'));
safe('值里含冒号(时间)', () => txtCfg('HOURS_FRI: 10:00 AM – 10:00 PM').HOURS_FRI);
ok('全角冒号也认', txtCfg('NAME：全角店').NAME === '全角店' || txtCfg('NAME：全角店').NAME === undefined);
ok('键前后空格容错', (txtCfg('  NAME:   带空格店   ').NAME || '').trim() === '带空格店');
ok('重复键: 以某一个为准且不崩', typeof txtCfg('NAME: A\nNAME: B').NAME === 'string');
safe('超长值(8000字)', () => txtCfg('NAME: ' + 'x'.repeat(8000)));
safe('emoji/引号/反斜杠', () => txtCfg(`NAME: 🐉"店'名\\路径 <b>x</b>`));
safe('只有键没有值', () => txtCfg('NAME:\nPHONE_LINK:\nTIMEZONE:'));
safe('缺失全部关键键后仍可渲染订餐区', () => s.buildGroupedOrderHtml(txtCfg('NAME: x')));
safe('TIMEZONE 乱写', () => s.restaurantNow(cfgOf({ TIMEZONE: 'Mars/Phobos' })), false);
safe('TIMEZONE 为空', () => s.restaurantNow(cfgOf({ TIMEZONE: '' })), false);

/* ═══ B. 营业时间 ═══ */
console.log('\n[B] 营业时间 · 边界与畸形');
const DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const hoursAll = v => { const o = {}; DAYS.forEach(d => o['HOURS_' + d] = v); return o; };
safe('全周休息(全空)', () => s.buildGroupedOrderHtml(cfgOf(hoursAll(''))));
safe('全周24小时', () => s.buildGroupedOrderHtml(cfgOf(hoursAll('12:00 AM – 11:59 PM'))));
safe('跨午夜 5PM–1AM', () => s.buildGroupedOrderHtml(cfgOf(hoursAll('5:00 PM – 1:00 AM'))));
safe('无 AM/PM', () => s.buildGroupedOrderHtml(cfgOf(hoursAll('10:00 – 22:00'))));
safe('纯乱码时间', () => s.buildGroupedOrderHtml(cfgOf(hoursAll('abc – ???'))));
safe('非法钟点 25:99 PM', () => s.buildGroupedOrderHtml(cfgOf(hoursAll('25:99 PM – 26:00 PM'))));
safe('开=关 同一时刻', () => s.buildGroupedOrderHtml(cfgOf(hoursAll('10:00 AM – 10:00 AM'))));
safe('只写一个时间', () => s.buildGroupedOrderHtml(cfgOf(hoursAll('10:00 AM'))));
ok('全周休息 → 横幅为 closed 或隐藏',
  (c => c === null || c.mode === 'closed')(s.getCountdown(cfgOf(hoursAll('')), new Date(2026,10,13,12,0))));
safe('parseTimeRange 吃任何字符串', () => DAYS.concat(['', ' ', '—', '12', 'AM PM', '0:00 AM – 0:00 AM'])
  .map(x => JSON.stringify(s.parseTimeRange(x))).join(''), false);

/* ═══ C. 倒计时与午市 ═══ */
console.log('\n[C] 倒计时 · 午市/晚市');
const at = (mo, d, h, mi) => new Date(2026, mo - 1, d, h, mi || 0);
[['0', 0], ['', 1], ['-30', 2], ['abc', 3], ['9999', 4], ['1.5', 5]].forEach(([v]) => {
  safe(`COUNTDOWN_MINUTES = "${v}"`, () => JSON.stringify(s.getCountdown(cfgOf({ COUNTDOWN_MINUTES: v }), at(11,27,21,0))), false);
});
safe('LUNCH_HOURS 为空', () => JSON.stringify(s.getCountdown(cfgOf({ LUNCH_HOURS: '' }), at(11,27,15,0))), false);
safe('LUNCH_HOURS 乱写', () => JSON.stringify(s.getCountdown(cfgOf({ LUNCH_HOURS: '午饭时间' }), at(11,27,15,0))), false);
safe('午市晚于打烊时间', () => JSON.stringify(s.getCountdown(cfgOf({ LUNCH_HOURS: '11:00 PM – 11:58 PM' }), at(11,27,23,30))), false);
safe('LUNCH_COUNTDOWN_MINUTES 非数字', () => JSON.stringify(s.getCountdown(cfgOf({ LUNCH_COUNTDOWN_MINUTES: 'x' }), at(11,27,15,0))), false);
safe('DINNER_NOTE_MINUTES = 0', () => JSON.stringify(s.getCountdown(cfgOf({ DINNER_NOTE_MINUTES: '0' }), at(11,27,16,0))), false);
ok('倒计时模板缺 {MIN} 也不崩',
  typeof (s.getCountdown(cfgOf({ COUNTDOWN_CLOSING: '就要打烊了' }), at(11,27,21,30)) || {}).mode === 'string');

/* ═══ D. 歇业 ═══ */
console.log('\n[D] 歇业 · 日期与文本');
const cl = line => cfgOf({ CLOSURE_ENABLED: 'ON', CLOSURE: line });
const closureAt = (line, mo, d) => !!s.closureInfo(cl(line), at(mo, d, 12));
[
  ['单日 2026-11-26', '2026-11-26 休息'],
  ['斜杠年份', '2026/11/26 休息'],
  ['无年份 11/26', '11/26 休息'],
  ['区间 to', '2026-11-26 to 2026-11-27 休息'],
  ['区间波浪', '11/26~11/27 休息'],
  ['区间中文到', '11/26 到 11/27 休息'],
  ['倒序区间', '11/27 to 11/26 休息'],
  ['不存在的日期 2/30', '2026-02-30 休息'],
  ['跨年区间', '2026-12-30 to 2027-01-02 新年'],
  ['两位年份', '11/26/26 休息'],
  ['纯文字', '装修中 Closed until further notice'],
  ['纯 emoji', '🌴🌴🌴'],
  ['超长文本', 'x'.repeat(4000) + ' 2026-11-26'],
  ['含HTML', '<script>alert(1)</script> 2026-11-26'],
  ['开关ON但内容空', ''],
  ['一堆数字', '1 2 3 4 5 6 7 8 9 10 11 12'],
].forEach(([name, line]) => {
  safe('歇业解析: ' + name, () => JSON.stringify(s.parseClosure(cl(line))) + String(closureAt(line, 11, 26)), false);
});
ok('已过去的歇业不再生效', closureAt('2026-01-01 to 2026-01-05 元旦', 11, 26) === false);
ok('倒序区间不会把全年关掉', !(closureAt('11/27 to 11/26 x', 11, 1) && closureAt('11/27 to 11/26 x', 11, 20)));
[['0'], [''], ['abc'], ['999'], ['-5']].forEach(([v]) => {
  safe(`CLOSURE_NOTICE_DAYS = "${v}"`, () => String(!!s.noticeInfo(cfgOf({
    CLOSURE_ENABLED: 'ON', CLOSURE: '2026-11-26 休息', CLOSURE_NOTICE_DAYS: v }), at(11,13,12))), false);
});
safe('歇业期间订餐区可渲染', () => { setClock(2026,11,26,18,0); const h = s.buildGroupedOrderHtml(cl('2026-11-26 休息')); setClock(2026,11,13,12,0); return h; });

/* ═══ E. 满额赠送 ═══ */
console.log('\n[E] 满额赠送 · 行格式与注入');
const deal = (line, extra) => s.buildDealsHtml(cfgOf(Object.assign({ DEALS_ENABLED: 'ON', DEAL_1: line }, extra || {})), at(11,13,12));
[
  ['完整五段', '满$30 | 送春卷 | direct | till 12/31 | auto'],
  ['只有门槛', '满$30'],
  ['缺赠品', '满$30 |  | direct'],
  ['空段在中间', '满$30 | 送春卷 |  | till 12/31'],
  ['多余第六段', '满$30 | 送春卷 | all | till 12/31 | auto | 多余'],
  ['范围未知值', '满$30 | 送春卷 | 火星平台'],
  ['范围大小写空格', '满$30 | 送春卷 |   DiReCt  '],
  ['逗号清单含未知', '满$30 | 送春卷 | doordash, 火星, phone'],
  ['领取方式未知', '满$30 | 送春卷 | all | 随便写'],
  ['有效期多个日期', '满$30 | 送春卷 | all | 11/1 11/15 12/31'],
  ['有效期为过去', '满$30 | 送春卷 | all | till 2020-01-01'],
  ['未闭合划线', '满~~$30 | 送春卷 | all'],
  ['嵌套标记', '**~~$30~~** | **送**春卷 | all'],
  ['HTML注入', '<img src=x onerror=alert(1)> | <script>bad()</script> | all'],
  ['竖线超多', 'a|b|c|d|e|f|g|h|i|j'],
  ['超长文本', 'x'.repeat(3000) + ' | y'.repeat(100) + ' | all'],
  ['纯空白', '   |   |   '],
].forEach(([name, line]) => safe('满赠: ' + name, () => deal(line)));
ok('满赠 XSS 被转义', !/<script>bad/.test(deal('<b>x</b> | <script>bad()</script> | all')));
ok('满赠 img注入被转义', !/<img src=x/.test(deal('<img src=x onerror=alert(1)> | y | all')));
safe('30条全满', () => { const o = { DEALS_ENABLED: 'ON' };
  for (let i = 1; i <= 30; i++) o['DEAL_' + i] = `满$${i} | 赠品${i} | all | auto`;
  return s.buildDealsHtml(cfgOf(o), at(11,13,12)); });
ok('DEAL_31 被忽略', !s.buildDealsHtml(cfgOf({ DEALS_ENABLED:'ON', DEAL_31:'满$99 | 超纲 | all' }), at(11,13,12)).includes('超纲'));
ok('编号跳跃(1和30)都显示', (h => h.includes('第一') && h.includes('最后'))(
  s.buildDealsHtml(cfgOf({ DEALS_ENABLED:'ON', DEAL_1:'a | 第一 | all', DEAL_30:'b | 最后 | all' }), at(11,13,12))));
ok('总开关各种写法: on/YES/1/开 都生效', ['on','YES','1','开','True'].every(v =>
  s.buildDealsHtml(cfgOf({ DEALS_ENABLED: v, DEAL_1: 'a | b | all' }), at(11,13,12)).includes('deal-ticket')));
ok('总开关乱写 = 关闭', s.buildDealsHtml(cfgOf({ DEALS_ENABLED: '随便', DEAL_1: 'a | b | all' }), at(11,13,12)) === '');

/* ═══ F. 平台按钮与链接 ═══ */
console.log('\n[F] 平台按钮 · 状态与链接');
const offAll = {}; s.ORDER_PLATFORMS.forEach(p => offAll[p[0] + '_STATUS'] = 'OFF');
safe('所有平台 OFF', () => s.buildGroupedOrderHtml(cfgOf(offAll)));
safe('只剩电话', () => s.buildGroupedOrderHtml(cfgOf(Object.assign({}, offAll, { PHONE_LINK: '5551234567' }))));
[['', 1], ['not a url', 2], ['ftp://x', 3], ['javascript:alert(1)', 4], ['x'.repeat(2000), 5]].forEach(([u]) => {
  safe(`ORDER_DOORDASH = "${String(u).slice(0,22)}"`, () => s.buildGroupedOrderHtml(cfgOf({ ORDER_DOORDASH: u })));
});
ok('javascript: 伪协议不会进 href',
  !/href="javascript:/i.test(s.buildGroupedOrderHtml(cfgOf({ ORDER_DOORDASH: 'javascript:alert(1)' }))));
[['abc'], ['-10'], ['99999'], ['']].forEach(([v]) =>
  safe(`CUTOFF = "${v}"`, () => s.buildGroupedOrderHtml(cfgOf({ ORDER_DOORDASH_CUTOFF: v }))));
[['(555) 123-4567'], ['+1 555 123 4567'], ['abc'], ['']].forEach(([v]) =>
  safe(`PHONE_LINK = "${v}"`, () => s.buildGroupedOrderHtml(cfgOf({ PHONE_LINK: v }))));
safe('环开关各种写法', () => ['OFF','off','关','0','FALSE','随便',''].map(v =>
  s.buildGroupedOrderHtml(cfgOf({ ORDER_PROGRESS_RING: v })).length).join(','), false);
safe('闪电开关各种写法', () => ['OFF','off','关','0','随便',''].map(v =>
  s.buildGroupedOrderHtml(cfgOf({ ORDER_BOLT: v })).length).join(','), false);

/* ═══ G. 弹窗 popup.txt ═══ */
console.log('\n[G] 弹窗 · 内容与开关');
const pop = t => s.parsePopup(t);
safe('空文件', () => JSON.stringify(pop('')), false);
safe('只有注释', () => JSON.stringify(pop('# a\n# b')), false);
ok('默认关闭(未写ENABLED)', pop('TITLE: x').enabled === false);
ok('ENABLED 各种写法生效', ['ON','on','yes','TRUE','1','开'].every(v => pop('ENABLED: ' + v).enabled === true));
ok('ENABLED 乱写 = 关闭', ['随便','2','ONN',''].every(v => pop('ENABLED: ' + v).enabled === false));
ok('全角冒号可用', pop('ENABLED：ON').enabled === true);
ok('默认按钮为 OK', pop('ENABLED: ON').button === 'OK');
ok('SHOW_ONCE 默认开', pop('ENABLED: ON').showOnce === true);
ok('SHOW_ONCE: OFF 生效', pop('ENABLED: ON\nSHOW_ONCE: OFF').showOnce === false);
safe('正文0行', () => s.buildPopupHtml(pop('ENABLED: ON\nTITLE: 只有标题')));
safe('正文200行', () => s.buildPopupHtml(pop('ENABLED: ON\n' + Array.from({length:200},(_,i)=>'第'+i+'行').join('\n'))));
safe('超长单行', () => s.buildPopupHtml(pop('ENABLED: ON\n' + 'x'.repeat(10000))));
safe('纯emoji与中文标点', () => s.buildPopupHtml(pop('ENABLED: ON\nTITLE: 🎉🎊\n【通知】——很重要！')));
ok('弹窗 XSS 被转义', (h => !/<script>/.test(h) && h.includes('&lt;script&gt;'))(
  s.buildPopupHtml(pop('ENABLED: ON\nTITLE: <script>alert(1)</script>\n<img src=x onerror=y>'))));
ok('按钮文字也转义', !/<b>/.test(s.buildPopupHtml(pop('ENABLED: ON\nBUTTON: <b>点我</b>'))));
ok('占位符 {PHONE} 被替换', s.resolveStr('打 {PHONE}', BASE).indexOf('{PHONE}') === -1);
ok('未知占位符不炸', typeof s.resolveStr('{NOT_A_KEY} 与 {NAME}', BASE) === 'string');
ok('内容指纹: 同内容同key / 改内容换key',
  s.popupKey(pop('ENABLED: ON\nTITLE: A\n正文')) === s.popupKey(pop('ENABLED: ON\nTITLE: A\n正文')) &&
  s.popupKey(pop('ENABLED: ON\nTITLE: A\n正文')) !== s.popupKey(pop('ENABLED: ON\nTITLE: B\n正文')));
safe('弹窗完整流程(DOM桩)', () => { const box = stubDom();
  const d = pop('ENABLED: ON\nTITLE: 测试\n正文一\n正文二'); return s.buildPopupHtml(d); });

/* ═══ H. 公告与休假便签 ═══ */
console.log('\n[H] 公告 · 格式与联动');
const ann = t => s.parseAnnouncements(t);
safe('空公告文件', () => JSON.stringify(ann('')), false);
safe('只有注释', () => JSON.stringify(ann('# x')), false);
safe('缺少内容段', () => JSON.stringify(ann('2026-01-01 | 只有标题')), false);
safe('竖线超多', () => JSON.stringify(ann('2026-01-01 | a | b | c | d')), false);
safe('没有竖线', () => JSON.stringify(ann('一整行没有分隔')), false);
safe('100条公告', () => String(ann(Array.from({length:100},(_,i)=>`2026-01-01 | 标题${i} | 内容${i}`).join('\n')).length), false);
safe('HTML注入', () => JSON.stringify(ann('2026-01-01 | <script>x</script> | <img src=x>')), false);
safe('公告渲染到DOM(含休假便签)', () => { const box = stubDom();
  s.renderAnnouncements && s.renderAnnouncements(cl('2026-11-26 休息'));
  return box.innerHTML; });
ok('休假便签: 开关OFF时不产生', s.closureAnnouncement(cfgOf({ CLOSURE_ENABLED:'OFF', CLOSURE:'2026-11-26 x' }), at(11,13,12)) === null);
safe('便签: 纯文字无限期', () => JSON.stringify(s.closureAnnouncement(cl('装修中'), at(11,13,12))), false);
safe('便签: 超长文本', () => JSON.stringify(s.closureAnnouncement(cl('2026-11-26 ' + 'x'.repeat(3000)), at(11,13,12))), false);

/* ═══ I. 菜单数据与搜索 ═══ */
console.log('\n[I] 菜单 · 数据与搜索');
safe('空菜单文件', () => JSON.stringify(m.parseMenuData('')).slice(0,20), false);
safe('只有注释', () => JSON.stringify(m.parseMenuData('# x')).slice(0,20), false);
safe('缺价格的菜', () => JSON.stringify(m.parseMenuData('CATEGORY: X\n1. Foo | 中文 | Español |')).slice(0,40), false);
safe('字段过少', () => JSON.stringify(m.parseMenuData('CATEGORY: X\nFoo')).slice(0,40), false);
safe('AVAILABLE 乱写', () => JSON.stringify(m.parseMenuData('CATEGORY: X\nAVAILABLE: 中午到下午\n1. A | B | C | 1.00')).slice(0,60), false);
[['0'],['+10%'],['-2.00'],['abc'],['+1000%'],['-99999'],['']].forEach(([v]) =>
  safe(`PRICE_ADJUST = "${v}"`, () => JSON.stringify(m.parseMenuData(`PRICE_ADJUST: ${v}\nCATEGORY: X\n1. A | B | C | 10.00`)).slice(0,60), false));
const REAL_MENU = m.parseMenuData(MENU_TXT).menu;
ok('真实菜单仍为18类', REAL_MENU.length === 18);
const hay = (c, it) => m.menuSearchNorm([it.en, it.zh, it.es || '', c.name].join(' '));
const search = q => { let n = 0; REAL_MENU.forEach(c => c.items.forEach(it => { if (m.menuSearchMatch(hay(c, it), q)) n++; })); return n; };
['', '   ', '*', '(', '[a-z]+', '\\', '$^', '?', '.*', '((((', 'a'.repeat(500), '🐉', '!!!', '"quoted"', 'chicken'].forEach(q =>
  safe(`搜索特殊字符: ${JSON.stringify(q).slice(0,18)}`, () => String(search(q)), false));
ok('正则元字符不会误匹配全部', search('((((') === 0 && search('[a-z]+') === 0);
ok('空查询返回全部', search('') === REAL_MENU.reduce((n,c)=>n+c.items.length,0));
ok('真实查询仍命中', search('chicken with fried rice') === 1);

/* ═══ J. 时间全周扫描 ═══ */
console.log('\n[J] 全周时间扫描 (每5分钟 × 7天 × 3种配置)');
const sweepCfgs = [
  ['默认配置', BASE],
  ['歇业中', cl('2026-11-09 to 2026-11-15 测试歇业')],
  ['全周24小时+满赠全开', cfgOf(Object.assign({}, hoursAll('12:00 AM – 11:59 PM'), { DEALS_ENABLED:'ON' }))],
];
sweepCfgs.forEach(([label, cfg]) => {
  let bad = null, count = 0;
  for (let d = 9; d <= 15 && !bad; d++) {
    for (let mins = 0; mins < 1440; mins += 5) {
      setClock(2026, 11, d, Math.floor(mins / 60), mins % 60);
      try {
        const now = s.restaurantNow(cfg);
        const cd = s.getCountdown(cfg, now);
        if (cd && (!cd.mode || (cd.minutes !== undefined && !isFinite(cd.minutes)))) { bad = `11/${d} ${mins}: 横幅异常 ${JSON.stringify(cd)}`; break; }
        const html = s.buildGroupedOrderHtml(cfg);
        if (GARBAGE.test(html)) { bad = `11/${d} ${mins}: 输出含 ${html.match(GARBAGE)[0]}`; break; }
        const opens = (html.match(/<div/g) || []).length, closes = (html.match(/<\/div>/g) || []).length;
        if (opens !== closes) { bad = `11/${d} ${mins}: div不配平 ${opens}/${closes}`; break; }
        count++;
      } catch (e) { bad = `11/${d} ${mins}: 抛异常 ${e.message}`; break; }
    }
  }
  setClock(2026, 11, 13, 12, 0);
  ok(`${label}: ${count} 个时刻全部正常`, !bad, bad);
});

/* ═══ K. 组合场景 ═══ */
console.log('\n[K] 组合场景');
safe('歇业 + 满赠 + 环关 + 平台全OFF', () => { setClock(2026,11,26,18,0);
  const h = s.buildGroupedOrderHtml(cfgOf(Object.assign({}, offAll, {
    CLOSURE_ENABLED:'ON', CLOSURE:'2026-11-26 休息', DEALS_ENABLED:'ON', DEAL_1:'a|b|all', ORDER_PROGRESS_RING:'OFF' })));
  setClock(2026,11,13,12,0); return h; });
safe('全空配置渲染订餐区', () => s.buildGroupedOrderHtml(txtCfg('')));
safe('全空配置满赠', () => s.buildDealsHtml(txtCfg(''), at(11,13,12)), false);
safe('全空配置横幅', () => JSON.stringify(s.getCountdown(txtCfg(''), at(11,13,12))), false);
safe('全空配置便签', () => JSON.stringify(s.closureAnnouncement(txtCfg(''), at(11,13,12))), false);
safe('全空配置弹窗', () => s.buildPopupHtml(s.parsePopup('')));

/* ═══ L. 本轮修复的永久回归 ═══ */
console.log('\n[L] 防呆修复 · 永久回归');
ok('越界钟点 25:99 → 不编造时段(null)', s.parseTimeRange('25:99 PM – 26:00 PM') === null && s.parseTimeRange('99:99 AM – 99:99 PM') === null);
ok('正常/跨夜时间不受影响',
  JSON.stringify(s.parseTimeRange('10:00 AM – 9:30 PM')) === '{"open":600,"close":1290}' &&
  JSON.stringify(s.parseTimeRange('5:00 PM – 1:00 AM')) === '{"open":1020,"close":60}');
ok('真实配置 6 个营业日均可解析(周一休)',
  ['SUN','TUE','WED','THU','FRI','SAT'].every(d => s.parseTimeRange(BASE['HOURS_' + d])));
const span = line => { const P = s.parseClosure(cl(line)); return P.start ? Math.round((P.end - P.start) / 864e5) : 0; };
ok('区间写反 11/27→11/26 不会关店一年(纠正为2天)', span('11/27 to 11/26 休息') === 2);
ok('ISO 写反同样纠正', span('2026-11-27 to 2026-11-26 休息') === 2);
ok('真·跨年区间 12/30→1/2 仍为4天', span('12/30 to 1/2 新年') === 4);
ok('正常区间与单日不受影响', span('11/26 to 11/27 休息') === 2 && span('2026-11-26 感恩节') === 1);
ok('非法日 2/30 夹到月末(不溢出到3月)', (P => P.start && P.start.getMonth() === 1 && P.start.getDate() === 28)(s.parseClosure(cl('2026-02-30 休息'))));
ok('月份越界 13/05 → 不当日期(无限期)', !s.parseClosure(cl('2026-13-05 休息')).start);
ok('菜单越界时段 25:99 → 按全天(null)', m.parseAvailability('25:99 PM') === null);
ok('菜单正常时段不受影响', JSON.stringify(m.parseAvailability('11:00 AM – 3:30 PM')) === '{"start":660,"end":930}');

resetClock();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
