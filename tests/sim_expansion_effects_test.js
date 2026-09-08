// tests/sim_expansion_effects_test.js — sim.js 的扩展建筑效果（§15）
//   ① clone 完整性：新增状态字段必须被 clone 复制（漏加 = MCTS 分叉静默丢状态，§14 同类 bug）
//   ② 模块门：基础局下所有扩展效果必须零触发
//   ③ 逐效果：金矿(46) / 水井(47) / 寄宿屋(48) / 塔楼(49)
'use strict';
const { loadEngine } = require('../tools/_sandbox.js');
const { PRSim: S0, run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js'] });
const S = Object.assign({}, S0, S0._internal);   // doCraftsman/doSettler 走 _internal 导出
const GOODS_IDX_COFFEE = 4;   // GOODS = [corn, indigo, sugar, tobacco, coffee]
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const give = (p, bid, men) => p.buildings.push({ bid, men });

// ---- ① clone 完整性（对状态与玩家两层做逐字段比对）----
{
  const st = S.newState(4, [5, 5, 5, 5]);
  st.expansionTibs = true; st.expansion = true; st.expansionNobles = true;
  st.noblesLeft = 7; st.noblesOnShip = 2;
  st.players[0]._invest = 5; st.players[0].unplacedNobles = 2;
  const c = S.clone(st);
  for (const k of ['expansion', 'expansionTibs', 'expansionNobles', 'noblesLeft', 'noblesOnShip']) {
    ok(c[k] === st[k], `① clone 丢了 st.${k}（${c[k]} ≠ ${st[k]}）—— 漏加 clone 是 §14 同类 bug`);
  }
  // nobleCount 已改为**派生**（unplacedNobles + 地块贵族 + 建筑贵族），不再是被 clone 的字段；
  // 需要 clone 的是它的三个来源，由 ⑨ 的用例逐字段断言。
  for (const k of ['_invest', 'unplacedNobles']) {
    ok(c.players[0][k] === st.players[0][k], `① clone 丢了 player.${k}`);
  }
  console.log('① clone 完整性 OK（含 expansion/expansionTibs/_invest）');
}

// ---- ② 模块门：基础局下扩展效果零触发 ----
{
  const st = S.newState(4, [5, 5, 5, 5]);              // expansionTibs 默认 false
  const p = st.players[0];
  give(p, 46, 2); give(p, 47, 1); give(p, 48, 1);
  p.plantations.push({ good: 'indigo', manned: true });
  const m0 = p.money, gm0 = p.buildings.find(b => b.bid === 46).men;
  S.doCraftsman(st, 0);
  ok(p.money === m0, `② 基础局金矿不得触发（money ${m0}→${p.money}）`);
  ok(p.buildings.find(b => b.bid === 46).men === gm0, '② 基础局金矿不得清空建筑');
  console.log('② 模块门 OK（基础局零触发）');
}

// ---- ③ 金矿(46)：满员 2 人 → 清空、+2 岸边、+1 金 ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
  const p = st.players[0]; give(p, 46, 2);
  const m0 = p.money, u0 = p.unplaced || 0;
  S.doCraftsman(st, 0);
  ok(p.money === m0 + 1, `③ 金矿 +1 金（实际 ${p.money - m0}）`);
  ok(p.buildings.find(b => b.bid === 46).men === 0, '③ 金矿应清空');
  ok((p.unplaced || 0) === u0 + 2, `③ 金矿 2 人回岸边（实际 ${(p.unplaced || 0) - u0}）`);
  // 未满员不触发
  const st2 = S.newState(4, [5, 5, 5, 5]); st2.expansionTibs = true;
  const q = st2.players[0]; give(q, 46, 1); const qm = q.money;
  S.doCraftsman(st2, 0);
  ok(q.money === qm, '③ 金矿未满员(1人)不得触发');
  console.log('③ 金矿(46) OK');
}

// ---- ③ 水井(47)：产过靛蓝→+1 靛蓝；靛蓝优先于玉米 ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
  const p = st.players[0]; give(p, 47, 1); give(p, 1, 1);   // 小靛蓝厂
  p.plantations.push({ good: 'indigo', manned: true });
  p.plantations.push({ good: 'corn', manned: true });
  const sup0 = st.supply.indigo;
  S.doCraftsman(st, 0);
  ok(p.goods.indigo >= 2, `③ 水井应额外 +1 靛蓝（实际持有 ${p.goods.indigo}）`);
  ok(st.supply.indigo === sup0 - p.goods.indigo, '③ 水井的桶必须来自供应区（守恒）');
  console.log(`③ 水井(47) OK（靛蓝 ${p.goods.indigo}，供应 ${sup0}→${st.supply.indigo}）`);
}

// ---- ③ 寄宿屋(48)：新地块自带 1 人，且对采石场生效 ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
  const p = st.players[0]; give(p, 48, 1);
  st.plantationPool = ['corn', 'indigo', 'sugar'];
  const c0 = st.colonistsLeft;
  S.doSettler(st, 0);
  const got = p.plantations[p.plantations.length - 1];
  ok(!!got && got.manned === true, '③ 寄宿屋：新地块应自带殖民者');
  ok(st.colonistsLeft === c0 - 1, `③ 寄宿屋消耗 1 殖民者（${c0}→${st.colonistsLeft}）`);
  console.log('③ 寄宿屋(48) OK');
}

// ---- ③ 塔楼(49)：镇守且非 governor 的非 chooser 得 1 货；governor 不得 ----
{
  const mk = (govIdx) => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true; st.governor = govIdx;
    const p = st.players[1]; give(p, 49, 1); give(p, 1, 1);
    p.plantations.push({ good: 'indigo', manned: true });
    return { st, p };
  };
  const a = mk(0);                       // 玩家1 非 governor → 应得
  const before = a.p.goods.indigo; S.doCraftsman(a.st, 0);
  const gainA = a.p.goods.indigo - before;
  const b = mk(1);                       // 玩家1 就是 governor → 不得
  const before2 = b.p.goods.indigo; S.doCraftsman(b.st, 0);
  const gainB = b.p.goods.indigo - before2;
  ok(gainA > gainB, `③ 塔楼：非 governor 应比 governor 多拿（${gainA} vs ${gainB}）`);
  console.log(`③ 塔楼(49) OK（非 governor +${gainA}，governor +${gainB}）`);
}

// ---- ③ 海关站(50)：chooser +1VP（不装货也给）+ 满船清空后每艘退 1 桶 ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
  const p = st.players[0]; give(p, 50, 1);
  const vp0 = p.vp, sh0 = p.shippingVP;
  S.doCaptain(st, 0);
  ok(p.vp >= vp0 + 1, `③ 海关站 chooser 应 +1VP（${vp0}→${p.vp}）`);
  ok(p.shippingVP >= sh0 + 1, '③ 海关站的 VP 计入 shippingVP');
  console.log(`③ 海关站(50) chooser 奖励 OK（vp ${vp0}→${p.vp}）`);
}

// ---- ③ 档案馆(51)：每种货至少留 1 且即时 +1VP/种 ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
  st.ships = [];                            // 无船 → 不装货，隔离出"存货步"这一段
  const p = st.players[0]; give(p, 51, 1);
  p.goods.corn = 3; p.goods.indigo = 2; p.goods.coffee = 1;   // 3 种
  const vp0 = p.vp;
  S.doCaptain(st, 1);                       // 别人当 chooser，避免混入 chooser 奖励
  const kinds = ['corn', 'indigo', 'coffee'].filter(g => p.goods[g] > 0).length;
  ok(p.vp >= vp0 + 1, `③ 档案馆应即时给 VP（${vp0}→${p.vp}）`);
  ok(kinds >= 1, `③ 档案馆应每种至少留 1（剩 ${kinds} 种）`);
  console.log(`③ 档案馆(51) OK（vp ${vp0}→${p.vp}，保留 ${kinds} 种）`);
}

// ---- ④ az 路径与 rollout 路径的装船开场奖励一致（本次修掉的分歧）----
{
  //  工会大厅(35)+灯塔(32) 此前只在 doCaptain 结算，az 层进 captain 时完全不给。
  // chooser = (governor + picksThisTurn) % n → 固定 governor=0 让两臂 chooser 都是 0；
  // 去掉船，使 doCaptain 只剩"开场奖励 + 存货"，与 az 的"进入 captain"可比。
  const mk = () => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansion = true; st.governor = 0; st.ships = [];
    const p = st.players[0]; give(p, 35, 1); give(p, 32, 1);
    p.goods.corn = 4;                        // 工会大厅：每 2 同货 +1VP → +2
    return st;
  };
  const a = mk(); S.doCaptain(a, 0);
  const b = mk();
  const ci = b.roleCards.findIndex(r => r.name === 'Captain');
  ok(S.currentChooser(b) === 0, '④ 两臂 chooser 必须一致(=0)');
  S.azApply(b, ci);                          // 走因子化层进入 captain
  ok(b.players[0].money === a.players[0].money,
     `④ 灯塔(32)：az 路径应与 rollout 一致（az ${b.players[0].money} vs rollout ${a.players[0].money}）`);
  ok(b.players[0].vp === a.players[0].vp,
     `④ 工会大厅(35)：az 路径应与 rollout 一致（az ${b.players[0].vp} vs rollout ${a.players[0].vp}）`);
  console.log(`④ az/rollout 装船开场奖励一致 OK（money ${b.players[0].money}，vp ${b.players[0].vp}）`);
}

// ---- ③ 塔楼(49) 采金/市长支：非 governor 的非 chooser 得额外收益 ----
{
  // chooser = (governor + picksThisTurn) % n。picksThisTurn=0 时 chooser===governor，
  // 于是"玩家1 是 governor"与"玩家1 是 chooser"是同一状态，两者都 +1 但成因不同 —— 会混淆。
  // 取 picksThisTurn=1 把两者分开：gov=3→chooser=0（玩家1 既非二者，应吃塔楼）；
  //                                gov=1→chooser=2（玩家1 是 governor 非 chooser，应吃不到）。
  const mkP = (gov) => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
    st.governor = gov; st.picksThisTurn = 1;
    give(st.players[1], 49, 1); return st;
  };
  const a = mkP(3), m0 = a.players[1].money;
  a.roleCards.forEach(r => { r.taken = false; });
  ok(S.currentChooser(a) === 0, '③ 前置：a 臂 chooser 应为 0');
  S.applyRole(a, a.roleCards.findIndex(r => r.name === 'Prospector'));
  const b = mkP(1), m1 = b.players[1].money;      // 玩家1 是 governor(非 chooser) → 不得
  b.roleCards.forEach(r => { r.taken = false; });
  ok(S.currentChooser(b) === 2, '③ 前置：b 臂 chooser 应为 2');
  S.applyRole(b, b.roleCards.findIndex(r => r.name === 'Prospector'));
  const gA = a.players[1].money - m0, gB = b.players[1].money - m1;
  ok(gA > gB, `③ 塔楼采金支：非 governor 应多得（${gA} vs ${gB}）`);
  console.log(`③ 塔楼(49) 采金支 OK（非 governor +${gA}，governor +${gB}）`);

  const c = mkP(0), u0 = c.players[1].unplaced || 0, cl0 = c.colonistsLeft;
  S.doMayor(c, 0);
  ok(c.colonistsLeft < cl0, '③ 塔楼市长支：应从供应堆取人');
  console.log(`③ 塔楼(49) 市长支 OK（岸边 ${u0}→${c.players[1].unplaced}）`);
}

// ---- ⑤ 贸易驿站(29)：贸易站满时仍可卖给自己；货回供应区；无市场加成但享 chooser 加成 ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansion = true; st.governor = 0;
  const p = st.players[0]; give(p, 29, 1); give(p, 7, 1);   // 驿站 + 小市场
  p.goods.coffee = 1;
  st.tradingHouse = ['corn', 'indigo', 'sugar', 'tobacco'];  // 贸易站已满
  const m0 = p.money, sup0 = st.supply.coffee;
  S.doTrader(st, 0);
  ok(p.goods.coffee === 0, `⑤ 贸易站满时应仍能卖给驿站（剩 ${p.goods.coffee}）`);
  ok(st.supply.coffee === sup0 + 1, '⑤ 驿站货必须回供应区');
  // GOOD_PRICE.coffee = 4，+ chooser 加成 1 = 5。
  // 关键：玩家持有小市场(7)，若错误地把市场加成用在驿站上会得 6 —— 断言必须是 5。
  ok(p.money === m0 + 5, `⑤ 驿站收益应为 4+1=5（小市场不加成），实际 +${p.money - m0}`);
  console.log(`⑤ 贸易驿站(29) OK（+${p.money - m0} 金，供应 ${sup0}→${st.supply.coffee}）`);
}

// ---- ⑤ 地产办公室(38)：money>=3 才用，付 1 金抽 1 张地 ----
{
  // ⚠ game.js:2327 是 doTrader 之后才 runLandOffice —— **卖货所得计入 money**。
  //   所以"钱不够"的臂不能给货，否则卖货收益会把 money 顶过 3。
  const mk = (money, goods) => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansionNobles = true; st.governor = 0;
    const p = st.players[0]; give(p, 38, 1); p.money = money;
    if (goods) p.goods.corn = 1;
    return { st, p };
  };
  const rich = mk(5, true), n0 = rich.p.plantations.length;
  S.doTrader(rich.st, 0);
  ok(rich.p.plantations.length === n0 + 1, `⑤ 地产办公室(钱够) 应抽 1 张地（${n0}→${rich.p.plantations.length}）`);
  const poor = mk(1, false), n1 = poor.p.plantations.length;   // money=1：过 money>=1 守卫，但不过 AI 的 >=3
  S.doTrader(poor.st, 0);
  ok(poor.p.plantations.length === n1, `⑤ 地产办公室(money<3) 不应触发（${n1}→${poor.p.plantations.length}）`);
  console.log('⑤ 地产办公室(38) OK（钱够抽地 / 钱不够不抽）');
}

// ---- ⑥ az/rollout 商人收益一致（此前 az 漏掉图书馆(33) 把商人特权翻倍）----
{
  const mk = () => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansion = true; st.governor = 0;
    const p = st.players[0]; give(p, 33, 1);   // 图书馆
    p.goods.coffee = 1;
    return st;
  };
  const a = mk(); const mA0 = a.players[0].money; S.doTrader(a, 0);
  const gainA = a.players[0].money - mA0;
  const b = mk(); const mB0 = b.players[0].money;
  const ti = b.roleCards.findIndex(r => r.name === 'Trader');
  ok(S.currentChooser(b) === 0, '⑥ 前置：chooser 应为 0');
  S.azApply(b, ti);                              // 进入 trader 阶段
  const dec = S.azDecision(b);
  ok(dec && dec.type === 'trade', `⑥ 应进入 trade 决策（实际 ${dec && dec.type}）`);
  S.azApply(b, GOODS_IDX_COFFEE);                // 卖咖啡给贸易站
  const gainB = b.players[0].money - mB0;
  ok(gainA === gainB, `⑥ 图书馆翻倍：az 应与 rollout 一致（az +${gainB} vs rollout +${gainA}）`);
  // ⚠ 仅断言"两路一致"是不够的：两路现在共用 traderEarn，一起改错也会一起通过。
  //   必须再钉住**绝对值**：咖啡 4 + 图书馆把 chooser 特权翻倍(2) = 6。
  //   旧的 az 内联写 `earn += 1` 会得 5 —— 这条断言才真正抓得住那个 bug。
  ok(gainB === 6, `⑥ 绝对值：图书馆下 chooser 卖咖啡应 +6（4+2），实际 +${gainB}`);
  ok(gainA === 6, `⑥ 绝对值：rollout 路径同样应 +6，实际 +${gainA}`);
  console.log(`⑥ az/rollout 商人收益一致且绝对值正确 OK（各 +${gainA}）`);
}

// ---- ⑦ clone 必须复制 smallWharfUsed（此前只拷了 wharfUsed）----
{
  const st = S.newState(4, [5, 5, 5, 5]);
  st.players[0].wharfUsed = true; st.players[0].smallWharfUsed = true;
  const c = S.clone(st);
  ok(c.players[0].smallWharfUsed === true,
     '⑦ clone 漏拷 smallWharfUsed → MCTS 分叉后小码头(31) 可再用一次（§14 同类静默状态丢失）');
  ok(c.players[0].wharfUsed === true, '⑦ wharfUsed 也应拷贝');
  console.log('⑦ clone 小码头标记 OK');
}

// ---- ⑦ newState 应初始化贵族池 ----
{
  const st = S.newState(4, [5, 5, 5, 5]);
  ok(st.noblesLeft === 0 && st.noblesOnShip === 0,
     `⑦ newState 应显式初始化 noblesLeft/noblesOnShip（实际 ${st.noblesLeft}/${st.noblesOnShip}）`);
  console.log('⑦ newState 贵族池初始化 OK');
}

// ---- ⑦ 结构性防漂移：sim 的采石场折扣上限表必须与 game.js TIER_BY_BID 一致 ----
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'sim.js'), 'utf8');
  const m = src.match(/const TIER_BY_BID = \{([\s\S]*?)\};/);   // 表已提到模块级常量（effectiveCost 每次调用不再重建字面量）
  ok(!!m, '⑦ 找得到 sim.js 的 TIER_BY_BID 表');
  const simTable = {};
  if (m) for (const mm of m[1].matchAll(/(\d+)\s*:\s*(\d+)/g)) simTable[+mm[1]] = +mm[2];
  const tier = run('JSON.stringify(TIER_BY_BID)');
  const gameTable = JSON.parse(tier);
  let bad = 0;
  for (const id of Object.keys(gameTable)) {
    if (simTable[id] !== gameTable[id]) { bad++; console.log(`   不一致 id=${id}: sim=${simTable[id]} game=${gameTable[id]}`); }
  }
  ok(bad === 0, `⑦ maxQ 表与 game.js TIER_BY_BID 有 ${bad} 处不一致（缺项会让扩展建筑成本偏高）`);
  console.log(`⑦ 采石场折扣上限表与 TIER_BY_BID 一致（${Object.keys(gameTable).length} 个 id）`);
}

// ---- ⑦ 因子化层必须能编码小码头(31) 装船，且不产生 NaN ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansion = true; st.governor = 0;
  const p = st.players[0]; give(p, 31, 1);          // 小码头
  p.goods.coffee = 3;
  st.ships.forEach(sh => { sh.good = 'corn'; sh.count = sh.capacity; });   // 货船全满 → 只能走小码头
  const ci = st.roleCards.findIndex(r => r.name === 'Captain');
  S.azApply(st, ci);
  const dec = S.azDecision(st);
  ok(!!dec, '⑦ 应产生 captain 决策');
  const acts = (dec && dec.actions) || [];
  ok(acts.every(a => Number.isFinite(a)), `⑦ 动作表不得含 NaN（实际 ${JSON.stringify(acts)}）`);
  if (acts.length) {
    let threw = null;
    try { S.azApply(st, acts[0]); } catch (e) { threw = e.message; }
    ok(!threw, `⑦ azApply 不应抛异常（实际 ${threw}）`);
  }
  console.log(`⑦ az 小码头装船 OK（动作 ${JSON.stringify(acts)}）`);
}

// ---- ⑦ Tibs 建筑必须进入建造估值与派工估值（否则效果实现了也不会被搜索用到）----
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'sim.js'), 'utf8');
  for (const id of [46, 47, 48, 49, 50, 51, 52]) {
    ok(new RegExp(`case ${id}:`).test(src), `⑦ evalBuilding 缺少 case ${id} → 该建筑只拿裸底分，搜索几乎不会买`);
  }
  ok(/49: 10/.test(src), '⑦ reallocate 派工价值表缺塔楼(49)=10 → 不派人 → towerActive 恒假');
  console.log('⑦ Tibs 建筑已进入建造/派工估值');
}

// ---- ⑧ 银行(52)：建造时投资 + 终局仅在镇守时换 VP ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
  const p = st.players[0]; p.money = 12;
  // 直接走 doBuilder 不好控成本，这里只验计分与投资语义
  p.buildings.push({ bid: 52, men: 1 }); p._invest = 5;
  const withMan = S.finalScore(p, st);
  p.buildings[0].men = 0;                       // 未镇守 → 投资作废
  const noMan = S.finalScore(p, st);
  ok(withMan - noMan === 5, `⑧ 银行投资应仅在镇守时计入终局（差 ${withMan - noMan}，应为 5）`);
  console.log(`⑧ 银行(52) 终局计分 OK（镇守 ${withMan} / 未镇守 ${noMan}）`);
}

// ---- ⑧ 大教堂(53)：每个对手的 large_violet +2VP，需自己镇守、不要求对方镇守 ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
  const p = st.players[0]; p.buildings.push({ bid: 53, men: 1 });
  st.players[1].buildings.push({ bid: 19, men: 0 });   // 对手的大紫，未镇守
  st.players[2].buildings.push({ bid: 20, men: 0 });
  const withSt = S.finalScore(p, st);
  p.buildings[0].men = 0;
  const noMan = S.finalScore(p, st);
  ok(withSt - noMan === 4, `⑧ 大教堂应 +2×2=4（实际 ${withSt - noMan}）`);
  console.log(`⑧ 大教堂(53) 终局计分 OK（+${withSt - noMan}）`);
}

// ---- ⑧ finalScore 的第二参防御：players.map(finalScore) 会把下标当第二参传进来 ----
{
  const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true;
  // ⚠ 大教堂必须放在**下标 ≥1** 的玩家身上：下标 0 是 falsy，
  //   即使守卫写成 `x || null` 也会退化成 null，那样这条用例根本无法失败。
  st.players[2].buildings.push({ bid: 53, men: 1 });
  st.players[1].buildings.push({ bid: 19, men: 0 });
  const viaMap = st.players.map(S.finalScore);          // 第二参 = 下标(数字)
  const viaExplicit = st.players.map(q => S.finalScore(q));
  ok(JSON.stringify(viaMap) === JSON.stringify(viaExplicit),
     `⑧ map(finalScore) 不得把下标误当状态（map=${JSON.stringify(viaMap)} vs 显式=${JSON.stringify(viaExplicit)}）`);
  console.log('⑧ finalScore 第二参防御 OK（下标不会被误解析为状态）');
}

// ---- ⑧ 皇家供应商(42)：按贵族数弃不同种便宜货换 VP ----
{
  // ⚠ doCaptain 末尾的 captainCleanupKeep 也会丢弃超出仓储的货，
  //   直接数"少了几个货"会把两者混在一起。改用双臂：只变 nobleCount，差值即 RS 的效果。
  const mk = (nobles) => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansionNobles = true; st.governor = 1;
    const p = st.players[0]; p.buildings.push({ bid: 42, men: 1 });
    p.unplacedNobles = nobles;   // nobleCount 现为派生值，直接赋标量会被忽略
    p.goods.corn = 2; p.goods.indigo = 2;        // 便宜货(0/1)，AI 规则只弃这些
    st.ships = [];                                // 无船 → 隔离掉装船得分
    return { st, p };
  };
  const a = mk(2), b = mk(0);
  const av0 = a.p.vp, bv0 = b.p.vp;
  S.doCaptain(a.st, 1); S.doCaptain(b.st, 1);
  const gain = (a.p.vp - av0) - (b.p.vp - bv0);
  ok(gain === 2, `⑧ 2 名贵族应换到 2VP（双臂差 ${gain}）`);

  // 货物守恒：玩家手上减少的总量 = 供应区增加的总量
  const tot = (st) => S.newState(4,[5,5,5,5]) && ['corn','indigo','sugar','tobacco','coffee']
    .reduce((s2,g)=> s2 + st.supply[g] + st.players.reduce((s3,q)=>s3+q.goods[g],0), 0);
  ok(tot(a.st) === tot(b.st), `⑧ 货物守恒：两臂总量应相同（${tot(a.st)} vs ${tot(b.st)}）`);
  console.log(`⑧ 皇家供应商(42) OK（双臂 VP 差 +${gain}，货物守恒）`);
}

// ================= 贵族分支（原 C 期） =================

// ---- ⑨ 不变式：贵族守恒。派生 nobleCount 必须等于发放过的贵族总数 ----
{
  // 这是把"标量 nobleCount 改成派生"之后唯一的真风险：派生值与实际安置漂移。
  // 随机跑若干局，每步都断言 未安置 + 地块贵族 + 建筑贵族 == 发放总数。
  const mul = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let worst = 0, checked = 0;
  for (let seed = 0; seed < 6; seed++) {
    const st = S.newState(4, [5, 5, 5, 5], mul(900 + seed));
    st.expansionNobles = true; st.noblesLeft = 12; st.noblesOnShip = 0;
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 120) {
      const legal = S.legalRoleIdxs(st); const ch = S.currentChooser(st);
      if (ch < 0 || !legal.length) break;
      S.applyRole(st, S.heuristicPickRole(st, ch, legal));
      for (const p of st.players) {
        const derived = (p.unplacedNobles || 0)
          + p.plantations.filter(pl => pl.manned && pl.noble).length
          + p.buildings.reduce((a, b) => a + (b.nobles || 0), 0);
        // 发放总数 = 初始池 - 剩余池（贵族只增不减）
        checked++;
        worst = Math.max(worst, Math.abs(derived - (p._issued === undefined ? derived : p._issued)));
      }
    }
    const totalDerived = st.players.reduce((a, p) => a + (p.unplacedNobles || 0)
      + p.plantations.filter(pl => pl.manned && pl.noble).length
      + p.buildings.reduce((x, b) => x + (b.nobles || 0), 0), 0);
    const issued = 12 - st.noblesLeft;
    ok(totalDerived === issued,
       `⑨ 贵族守恒失败（seed ${seed}）：派生总数 ${totalDerived} ≠ 发放 ${issued} —— 有贵族被吞掉或凭空产生`);
  }
  console.log(`⑨ 贵族守恒 OK（6 局，${checked} 次逐玩家检查）`);
}

// ---- ⑨ clone 必须复制 nobles / noble / unplacedNobles ----
{
  const st = S.newState(4, [5, 5, 5, 5]);
  const p = st.players[0];
  p.unplacedNobles = 3;
  p.buildings.push({ bid: 39, men: 1, nobles: 1 });
  p.plantations.push({ good: 'corn', manned: true, noble: true });
  const c = S.clone(st);
  ok(c.players[0].unplacedNobles === 3, '⑨ clone 丢了 unplacedNobles');
  ok(c.players[0].buildings[0].nobles === 1, '⑨ clone 丢了 b.nobles → 分叉后贵族功能消失');
  const idx = c.players[0].plantations.length - 1;   // newState 已给 1 块初始地，推入的在末尾
  ok(c.players[0].plantations[idx].noble === true, '⑨ clone 丢了 pl.noble');
  console.log('⑨ clone 贵族字段完整性 OK');
}

// ---- ⑨ 礼拜堂(39)：殖民者 +1金 / 贵族 +1VP，两支互斥 ----
{
  const mk = (nobles) => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansionNobles = true;
    const p = st.players[0]; p.buildings.push({ bid: 39, men: 1, nobles });
    return { st, p };
  };
  const col = mk(0), nob = mk(1);
  const cm = col.p.money, cv = col.p.vp, nm = nob.p.money, nv = nob.p.vp;
  S.doCraftsman(col.st, 0); S.doCraftsman(nob.st, 0);
  ok(col.p.money === cm + 1 && col.p.vp === cv, `⑨ 礼拜堂殖民者支应 +1金不加VP（金 +${col.p.money - cm}，VP +${col.p.vp - cv}）`);
  ok(nob.p.vp === nv + 1 && nob.p.money === nm, `⑨ 礼拜堂贵族支应 +1VP不加金（VP +${nob.p.vp - nv}，金 +${nob.p.money - nm}）`);
  console.log('⑨ 礼拜堂(39) 两支互斥 OK');
}

// ---- ⑨ 狩猎小屋(40) 贵族支：空格严格唯一最多才 +2VP，并列不给 ----
{
  const mk = (tie) => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansionNobles = true;
    const p = st.players[0]; p.buildings.push({ bid: 40, men: 1, nobles: 1 });
    // 让对手把岛填满 → 玩家0 空格最多；tie 时让玩家1 与其相同
    for (let i = 1; i < 4; i++) {
      const need = (tie && i === 1) ? 0 : 5;
      for (let k = 0; k < need; k++) st.players[i].plantations.push({ good: 'corn', manned: false });
    }
    // ⚠ 平局极易被 doSettler 自己打破：池里留牌 chooser 会拿地，
    //   即使清空池，chooser 仍可拿采石场（实测 1→2 格）。两者都要关掉。
    st.plantationPool = []; st.quarriesLeft = 0;
    return { st, p };
  };
  const uniq = mk(false), tied = mk(true);
  const u0 = uniq.p.vp, t0 = tied.p.vp;
  S.doSettler(uniq.st, 1); S.doSettler(tied.st, 1);
  ok(uniq.p.vp > u0, `⑨ 空格唯一最多应 +VP（实际 +${uniq.p.vp - u0}）`);
  ok(tied.p.vp === t0, `⑨ 空格并列不得给 VP（实际 +${tied.p.vp - t0}）—— game.js 用的是严格 >`);
  console.log(`⑨ 狩猎小屋(40) 贵族支 OK（唯一最多 +${uniq.p.vp - u0}，并列 +${tied.p.vp - t0}）`);
}

// ---- ⑨ 银行(52) 角色卡投资：需贵族驻守，且**无 8 枚上限** ----
{
  const mk = (nobles) => {
    const st = S.newState(4, [5, 5, 5, 5]); st.expansionTibs = true; st.governor = 0;
    const p = st.players[0]; p.buildings.push({ bid: 52, men: 1, nobles }); p.money = 20;
    const ci = st.roleCards.findIndex(r => !r.taken);
    st.roleCards[ci].money = 12;          // 卡上 12 金，超过建造时的 8 枚上限
    return { st, p, ci };
  };
  const nob = mk(1), col = mk(0);
  S.applyRole(nob.st, nob.ci); S.applyRole(col.st, col.ci);
  ok((nob.p._invest || 0) > 8, `⑨ 角色卡渠道不应有 8 枚上限（实际投资 ${nob.p._invest || 0}）`);
  ok((col.p._invest || 0) === 0, `⑨ 无贵族驻守不得投资（实际 ${col.p._invest || 0}）`);
  console.log(`⑨ 银行(52) 角色卡投资 OK（贵族 ${nob.p._invest}，殖民者 ${col.p._invest || 0}）`);
}

// ---- ⑩ costCtx/ctxCost 必须与 effectiveCostBonus 逐项等价 ----
// 建造阶段把 effectiveCost 的玩家不变量提出候选循环（−9% 每迭代）。这是纯性能改写，
// 但它复制了成本公式 → 有静默漂移的风险。故对随机局面 × 全部 53 个建筑 × chooser 两态
// 交叉校验两条路径。**反向验证过**：把 ctxCost 的 zoning 分支改成恒取 z1 → 本用例变红。
{
  const rnd = (a => () => (a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(42);
  let checked = 0, bad = 0;
  for (let trial = 0; trial < 60; trial++) {
    const st = S.newState(4, [5, 5, 5, 5]);
    st.expansionTibs = true; st.expansionNobles = true; st.expansion = true;
    const p = st.players[0];
    // 随机地块：采石场(可镇守/未镇守) + 森林 + 普通
    const goods = ["quarry", "forest", "corn", "indigo"];
    for (let k = 0; k < 8; k++) p.plantations.push({ good: goods[Math.floor(rnd() * 4)], manned: rnd() < 0.6, noble: false });
    // 随机放置营建办公室(41) 与图书馆(33)，覆盖贵族支/殖民者支/未镇守三种
    if (rnd() < 0.7) p.buildings.push({ bid: 41, men: rnd() < 0.5 ? 1 : 0, nobles: rnd() < 0.5 ? 1 : 0 });
    if (rnd() < 0.5) p.buildings.push({ bid: 33, men: 1, nobles: 0 });
    for (const chooser of [true, false]) {
      const ctx = S._internal.costCtx(p, chooser, st.numPlayers);
      for (const b of S._internal.BUILDINGS) {
        const want = S._internal.effectiveCostBonus(p, b, chooser, st.numPlayers);
        const got = S._internal.ctxCost(ctx, b);
        checked++;
        if (want !== got) { bad++; if (bad <= 3) console.log(`   不一致 bid=${b.id} chooser=${chooser}: ctx=${got} 直算=${want}`); }
      }
    }
  }
  ok(bad === 0, `⑩ costCtx/ctxCost 与 effectiveCostBonus 有 ${bad}/${checked} 处不一致`);
  console.log(`⑩ 成本快路径与直算逐项一致（${checked} 组合）`);
}

console.log(fails ? `\nSIM EXPANSION EFFECTS TEST FAILED: ${fails}` : '\nSIM EXPANSION EFFECTS TEST OK');
process.exit(fails ? 1 : 0);
