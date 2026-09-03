/* 核心回归 · node tests/test_core.js  (横幅/相位/满赠/分组/歇业/联动便签/充电闪电/菜单) */
const path = require('path'), fs = require('fs');
const R = p => path.join(__dirname, '..', p);
const s = require(R('js/site.js')), m = require(R('js/menu.js'));
let p = 0, f = 0;
const t = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? p++ : f++; console.log(` ${ok?'✓':'✗'} ${n}${ok?'':' got='+JSON.stringify(got)+' want='+JSON.stringify(want)}`); };
const cfg = s.resolveConfig(s.parseConfig(fs.readFileSync(R('data/site_config.txt'), 'utf8')));
const at = (d,h,mi,sec) => new Date(2026,6,d,h,mi,sec||0);

console.log('[横幅]');
t('周五12:00 隐藏', s.getCountdown(cfg, at(10,12,0)), null);
t('14:31 午市倒计时开窗', s.getCountdown(cfg, at(10,14,31)).mode, 'lunchend');
t('15:05 剩25分钟', s.getCountdown(cfg, at(10,15,5)), {mode:'lunchend',minutes:25});
t('15:31 晚市提示', s.getCountdown(cfg, at(10,15,31)).mode, 'dinner');
t('17:01 提示期满隐藏', s.getCountdown(cfg, at(10,17,1)), null);
t('21:45 打烊倒计时15', s.getCountdown(cfg, at(10,21,45)), {mode:'closing',minutes:15});
t('周一 closed', s.getCountdown(cfg, at(13,12,0)).mode, 'closed');

console.log('[相位与渐变]');
const bc = {HOURS_FRI:'10:00 AM – 10:00 PM',HOURS_SAT:'10:00 AM – 10:00 PM',ORDER_UBEREATS_CUTOFF:'30',ORDER_ONLINE_CUTOFF:'0'};
t('开门瞬间 {1,0,future}', s.orderPhaseProgress('ORDER_UBEREATS',bc,at(10,10,0)), {frac:1,prog:0,to:'future'});
t('持平段 {0,1,future}', s.orderPhaseProgress('ORDER_UBEREATS',bc,at(10,21,45)), {frac:0,prog:1,to:'future'});
t('回充 to=open', s.orderPhaseProgress('ORDER_UBEREATS',bc,at(10,22,30)).to, 'open');
t('自家渠道 to=closed', s.orderPhaseProgress('ORDER_ONLINE',bc,at(10,16,0)).to, 'closed');
t('渐变端点纯色', [s.statusMix('open','future',0), s.statusMix('open','future',1)], ['hsl(142, 71%, 45%)','hsl(42, 100%, 50%)']);
t('绿→红中点走黄区', s.statusMix('open','closed',0.5), 'hsl(71, 78%, 53%)');

console.log('[满赠]');
const D = (x,d) => s.buildDealsHtml(Object.assign({},cfg,x||{}), d||at(10,14,0));
t('实配两票+划线新旧价', (h=>(h.match(/deal-ticket/g)||[]).length===2 && h.includes('<s class="dt-old">$35</s>') && h.includes('<b class="dt-new">$30</b>'))(D()), true);
t('徽章: 仅官网直订×2+结账时请选择×2', (h=>(h.match(/仅官网直订/g)||[]).length===2 && (h.match(/结账时请选择/g)||[]).length===2)(D()), true);
t('今日截止红标', D({DEAL_3:'a | b | all | till 7/10'}).includes('⏳ Ends today · 今日截止'), true);
const DCx = w => (s.buildDealsHtml({DEALS_ENABLED:'ON',HOURS_FRI:'10:00 AM – 10:00 PM',HOURS_SAT:'10:00 AM – 10:00 PM',DEAL_1:'a | b | all | till 7/10'}, w).match(/deal-ticket/g)||[]).length;
t('打烊即下架边界', [DCx(at(10,21,59,59)), DCx(at(10,22,0,1))], [1,0]);
t('总开关OFF→空', D({DEALS_ENABLED:'OFF'}), '');
t('过期票自动消失', (D({DEAL_3:'a | b | all | Valid through 7/09'}).match(/deal-ticket/g)||[]).length, 2);

console.log('[分组订餐区]');
const ALL = {}; ['SUN','MON','TUE','WED','THU','FRI','SAT'].forEach(d=>ALL['HOURS_'+d]='12:00 AM – 11:59 PM');
const gh = s.buildGroupedOrderHtml(Object.assign({},cfg,ALL));
t('7按钮+电话tel', (gh.match(/class="order-btn/g)||[]).length===7 && gh.includes('href="tel:'), true);
t('十格隔断×2共20枚', (gh.match(/og-rectrow-/g)||[]).length===2 && (gh.match(/og-rect\b/g)||[]).length===20, true);
t('满赠在首/卡提醒就位', gh.indexOf('deal-strip') < gh.indexOf('order-group-label') && gh.indexOf('card-note') < gh.indexOf('og-n1'), true);
t('环svg×7+整钮填色在场', (gh.match(/btn-ring /g)||[]).length===7 && gh.includes('linear-gradient(0deg, hsla('), true);
t('环总开关OFF→无环无格', (h=>!/btn-ring /.test(h) && !/og-rectrow/.test(h))(s.buildGroupedOrderHtml(Object.assign({},cfg,ALL,{ORDER_PROGRESS_RING:'OFF'}))), true);

console.log('[歇业解析加固]');
const SL = Object.assign({}, cfg, { CLOSURE_ENABLED:'ON', CLOSURE:'2026/8/10 to 2026/8/20 休假' });
t('斜杠年份范围正确', [!!s.closureInfo(SL,new Date(2026,7,5)), !!s.closureInfo(SL,new Date(2026,7,15)), !!s.closureInfo(SL,new Date(2026,7,25))], [false,true,false]);
t('满赠有效期斜杠年份', [(s.buildDealsHtml(Object.assign({},cfg,{DEAL_9:'a | b | all | till 2026/8/31'}),new Date(2026,7,31,12,0)).match(/deal-ticket/g)||[]).length,(s.buildDealsHtml(Object.assign({},cfg,{DEAL_9:'a | b | all | till 2026/8/31'}),new Date(2026,8,1,0,0,1)).match(/deal-ticket/g)||[]).length], [3,2]);
const HJ = Object.assign({}, cfg, { CLOSURE_ENABLED:'ON', CLOSURE:'Reopen 8/21! Closed 8/10 to 8/20' });
t('前置日期不劫持(range-first)', [!!s.closureInfo(HJ,new Date(2026,7,5)), !!s.closureInfo(HJ,new Date(2026,7,15)), !!s.closureInfo(HJ,new Date(2026,7,25))], [false,true,false]);

console.log('[休假便签联动]');
const VC = { CLOSURE_ENABLED:'ON', CLOSURE:'Our hard working team are taking a well deserved break on 2026-08-10 to 2026-08-20 休假 · back 8/21' };
const CA = (extra,w) => s.closureAnnouncement(Object.assign({},cfg,VC,extra||{}), w);
t('配置当天即生效', !!CA(null,new Date(2026,7,1)), true);
t('休假中在/恢复时刻消失', [!!CA(null,new Date(2026,7,15)), !!CA(null,new Date(2026,7,21,0,0,1))], [true,false]);
t('日期签=区间', CA(null,new Date(2026,7,1)).date, '8/10 – 8/20');
t('内容=原文+默认标题', (a=>a.text===VC.CLOSURE && a.title.includes('休假通知'))(CA(null,new Date(2026,7,1))), true);
t('总开关OFF→无', s.closureAnnouncement(Object.assign({},cfg,{CLOSURE_ENABLED:'OFF',CLOSURE:VC.CLOSURE}),new Date(2026,7,15)), null);
t('联动开关OFF→无', CA({CLOSURE_ANN:'OFF'},new Date(2026,7,15)), null);
t('无限期歇业便签常驻', !!s.closureAnnouncement(Object.assign({},cfg,{CLOSURE_ENABLED:'ON',CLOSURE:'装修中 · Closed until further notice'}),new Date(2026,7,15)), true);

console.log('[充电闪电]');
const BCC = Object.assign({}, cfg, bc);
t('23:00回充→两枚SVG闪电含充能层', (h=>(h.match(/og-bolt/g)||[]).length===2 && h.includes('bolt-fill'))(s.buildGroupedOrderHtml(BCC, new Date(2026,6,10,23,0))), true);
t('营业中14:00→无闪电', (s.buildGroupedOrderHtml(BCC, new Date(2026,6,10,14,0)).match(/og-bolt/g)||[]).length, 0);
t('ORDER_BOLT OFF→无闪电', (s.buildGroupedOrderHtml(Object.assign({},BCC,{ORDER_BOLT:'OFF'}), new Date(2026,6,10,23,0)).match(/og-bolt/g)||[]).length, 0);

console.log('[菜单]');
const menu = m.parseMenuData(fs.readFileSync(R('data/menu_data.txt'),'utf8')).menu;
t('18个分类', menu.length, 18);
const lunch = menu[menu.length-1];
t('午市 15:29在/15:31下', [m.isAvailableNow(lunch.available, at(10,15,29)), m.isAvailableNow(lunch.available, at(10,15,31))], [true,false]);
console.log(`结果: ${p} 通过, ${f} 失败`); process.exit(f?1:0);
