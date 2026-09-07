// Expansion I 建筑效果定向场景测试（对照周年版规则书数值）
// 用法: node tests/exp_scenarios.js
const vm = require('vm');

// 共享 Node 沙盒（tools/_sandbox.js）替代原先每个测试各自复制的 makeEl()/vm 样板
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js'] });

const testSrc = `(async () => {
  render = function () {}; flyToDest = function () {}; showToast = function () {};
  window._allAIMode = true; window._fastSpectator = true;
  const fails = [];
  const ok = (name, cond, detail) => { if (!cond) fails.push(name + (detail !== undefined ? ' [' + detail + ']' : '')); };

  function fresh() {
    G = new Game(4, 'T', true);
    G.expansionType = "newbuildings";
    G.players.forEach(p => { p.isHuman = false; p._aiLevel = 1; p.plantations = []; p.buildings = []; p.money = 0; p.vp = 0; p.shippingVP = 0; for (const g of GOODS) p.goods[g] = 0; });
    return G;
  }

  // 1) 专业工厂：4玉米+3糖+2咖啡 → 3-1 = 2金（规则书原例）
  {
    fresh();
    const p = G.players[0];
    p.buildings.push({ bid: 34, men: 1 });
    p.buildings.push({ bid: 4, men: 3 });  // 大糖厂 3 槽
    p.buildings.push({ bid: 6, men: 2 });  // 咖啡 2 槽
    for (let i = 0; i < 4; i++) p.plantations.push({ good: "corn", manned: true });
    for (let i = 0; i < 3; i++) p.plantations.push({ good: "sugar", manned: true });
    for (let i = 0; i < 2; i++) p.plantations.push({ good: "coffee", manned: true });
    await doCraftsman(1, [1, 2, 3, 0]); // chooser=别人，p 不拿特权
    ok("专业工厂=最多单货-1", p.money === 2, "money=" + p.money);
    ok("专业工厂产量", p.goods.corn === 4 && p.goods.sugar === 3 && p.goods.coffee === 2, JSON.stringify(p.goods));
  }

  // 2) 引水渠：大靛蓝厂只上 1 人 + 1 块靛蓝田 → 产 1 + 引水渠 +1 = 2
  {
    fresh();
    const p = G.players[0];
    p.buildings.push({ bid: 24, men: 1 }); // 引水渠
    p.buildings.push({ bid: 3, men: 1 });  // 大靛蓝厂只 1 人（修复点：不要求满员）
    p.plantations.push({ good: "indigo", manned: true });
    await doCraftsman(1, [1, 2, 3, 0]);
    ok("引水渠大厂1人即触发", p.goods.indigo === 2, "indigo=" + p.goods.indigo);
  }

  // 3) 雕像：总分中只计 8（不双重计分）
  {
    fresh();
    const p = G.players[0];
    p.buildings.push({ bid: 37, men: 0 });
    const buildingVP = p.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].vp, 0);
    const special = G.getSpecialVPs(p);
    ok("雕像建筑分=8", buildingVP === 8, buildingVP);
    ok("雕像无额外特殊分", special === 0, special);
  }

  // 4) 修道院：6森林+3采石场+2玉米+1咖啡 = 3套 → 6 VP（规则书原例）
  {
    fresh();
    const p = G.players[0];
    p.buildings.push({ bid: 36, men: 1 });
    for (let i = 0; i < 6; i++) p.plantations.push({ good: "forest", manned: false });
    for (let i = 0; i < 3; i++) p.plantations.push({ good: "quarry", manned: false });
    for (let i = 0; i < 2; i++) p.plantations.push({ good: "corn", manned: false });
    p.plantations.push({ good: "coffee", manned: false });
    ok("修道院3套=6VP", G.getSpecialVPs(p) === 6, G.getSpecialVPs(p));
  }

  // 5) 灯塔：用码头装运也 +1 金；船长本人阶段开始 +1 金
  {
    fresh();
    const p = G.players[0];
    p.buildings.push({ bid: 32, men: 1 }); // 灯塔
    p.buildings.push({ bid: 18, men: 1 }); // 码头
    p.goods.coffee = 8; // 大于任何货船容量 → 必然能用码头/船
    // 堵死三艘货船（其他货物满载不可卸）
    G.ships[0] = { capacity: 5, good: "corn", count: 4 };
    G.ships[1] = { capacity: 6, good: "indigo", count: 5 };
    G.ships[2] = { capacity: 7, good: "sugar", count: 6 };
    await doCaptain([0, 1, 2, 3], 0);
    // p 是船长：阶段开始 +1 金；用码头装 8 咖啡 +1 金 → 共 2 金
    ok("灯塔=船长+1金 且 码头装运+1金", p.money === 2, "money=" + p.money);
    ok("码头装运得VP(8+1特权)", p.shippingVP === 9, "shipVP=" + p.shippingVP);
  }

  // 6) 工会大厅：3玉米+2靛蓝+1咖啡 → 2 VP（规则书原例）
  {
    fresh();
    const p = G.players[1];
    p.buildings.push({ bid: 35, men: 1 });
    p.goods.corn = 3; p.goods.indigo = 2; p.goods.coffee = 1;
    G.ships[0] = { capacity: 5, good: null, count: 0 };
    G.ships[1] = { capacity: 6, good: null, count: 0 };
    G.ships[2] = { capacity: 7, good: null, count: 0 };
    const vpBefore = p.vp;
    await doCaptain([0, 1, 2, 3], 0);
    // 工会大厅 2 VP + 装运 VP；只验证至少多了工会的 2
    ok("工会大厅成对+2VP", p.vp - vpBefore >= 2 + 6, "vpGain=" + (p.vp - vpBefore)); // 6货全装出去 ≥6VP
  }

  // 7) 黑市：AI 还货+岸边工人抵差额，且建完钱归零
  {
    fresh();
    const p = G.players[0];
    p.buildings.push({ bid: 25, men: 1 });
    p.money = 1; p.goods.coffee = 1; p._unplacedMen = 1;
    const cap = G.blackMarketCapacity(p);
    ok("黑市容量=2(AI不舍VP)", cap === 2, cap);
    const paid = G.payWithBlackMarket(p, 2);
    ok("黑市抵扣2金", paid === 2, paid);
    ok("黑市还货", p.goods.coffee === 0);
    ok("黑市还工人", (p._unplacedMen || 0) === 0);
  }

  // 8) 船长强制装最多：6糖必须装7格船(不能选5格)
  {
    fresh();
    const p = G.players[0];
    p.goods.sugar = 6;
    G.ships[0] = { capacity: 5, good: null, count: 0 };
    G.ships[1] = { capacity: 6, good: "corn", count: 3 };
    G.ships[2] = { capacity: 7, good: null, count: 0 };
    await doCaptain([0, 1, 2, 3], 1);
    ok("6糖必须装7格船", G.ships[2].good === "sugar" && G.ships[2].count === 6,
       JSON.stringify(G.ships.map(s => s.good + ":" + s.count)));
  }

  // ===== 扩展II 贵族场景 =====
  function freshNobles() {
    G = new Game(4, 'T', 'nobles');
    G.expansionType = "nobles";
    G.players.forEach(p => { p.isHuman = false; p._aiLevel = 1; p.plantations = []; p.buildings = []; p.money = 0; p.vp = 0; p.shippingVP = 0; p._unplacedMen = 0; p._unplacedNobles = 0; for (const g of GOODS) p.goods[g] = 0; });
    return G;
  }

  // 9) 礼拜堂：殖民者驻守 +1金；贵族驻守 +1VP（工匠阶段）
  {
    freshNobles();
    const a = G.players[0], b = G.players[1];
    a.buildings.push({ bid: 39, men: 1, nobles: 0 });
    b.buildings.push({ bid: 39, men: 1, nobles: 1 });
    await doCraftsman(2, [2, 3, 0, 1]);
    ok("礼拜堂(殖民者)+1金", a.money === 1, a.money);
    ok("礼拜堂(贵族)+1VP", b.vp === 1, b.vp);
  }

  // 10) 珠宝匠：每名贵族 +1 金
  {
    freshNobles();
    const p = G.players[0];
    p.buildings.push({ bid: 44, men: 1, nobles: 0 });
    p.buildings.push({ bid: 39, men: 1, nobles: 1 });
    p.plantations.push({ good: "corn", manned: true, noble: true });
    p._unplacedNobles = 1; // 岸边贵族也算
    await doCraftsman(1, [1, 2, 3, 0]);
    ok("珠宝匠 3贵族=3金", p.money === 3, p.money);
  }

  // 11) 规划办公室：殖民者驻守小建筑-1；贵族驻守大建筑-2
  {
    freshNobles();
    const a = G.players[0], b = G.players[1];
    a.buildings.push({ bid: 41, men: 1, nobles: 0 });
    b.buildings.push({ bid: 41, men: 1, nobles: 1 });
    const smallMarket = BLD_BY_ID[7], guildHall = BLD_BY_ID[19];
    ok("规划办(殖民者)小建筑-1", G.effectiveCost(a, smallMarket) === 0, G.effectiveCost(a, smallMarket));
    ok("规划办(殖民者)大建筑无折扣", G.effectiveCost(a, guildHall) === 10, G.effectiveCost(a, guildHall));
    ok("规划办(贵族)大建筑-2", G.effectiveCost(b, guildHall) === 8, G.effectiveCost(b, guildHall));
    ok("规划办(贵族)小建筑无折扣", G.effectiveCost(b, smallMarket) === 1, G.effectiveCost(b, smallMarket));
  }

  // 12) 贵族终局 VP：每名贵族 1 VP；皇家花园翻倍；公会大厅给珠宝匠 2 VP
  {
    freshNobles();
    const p = G.players[0];
    p.buildings.push({ bid: 45, men: 1, nobles: 1 }); // 皇家花园(贵族驻守，1贵族)
    p.buildings.push({ bid: 19, men: 1, nobles: 0 }); // 公会大厅
    p.buildings.push({ bid: 44, men: 1, nobles: 0 }); // 珠宝匠
    p._unplacedNobles = 2; // 岸边 2 贵族 → 共 3 贵族
    const sp = G.getSpecialVPs(p);
    // 贵族3 + 皇家花园3 + 公会大厅(珠宝匠2) = 8
    ok("贵族VP+皇家花园+公会珠宝匠=8", sp === 8, sp);
  }

  // 13) 别墅：市长阶段从供应区 +1 贵族
  {
    freshNobles();
    const p = G.players[0];
    p.buildings.push({ bid: 43, men: 1, nobles: 0 });
    const nb0 = G.noblesLeft;
    await doMayor(1, [1, 2, 3, 0]);
    ok("别墅拿到贵族", G.noblesLeft <= nb0 - 1, "noblesLeft " + nb0 + "->" + G.noblesLeft);
    ok("别墅贵族归玩家", G.nobleCount(p) >= 1, G.nobleCount(p));
  }

  // 14) 海关大楼按全部 VP 筹码计（含非船运筹码）
  {
    freshNobles();
    const p = G.players[0];
    p.buildings.push({ bid: 22, men: 1, nobles: 0 });
    p.vp = 23; p.shippingVP = 10; // 规则书原例：23 筹码 → +5
    ok("海关=floor(23/4)=5", G.getSpecialVPs(p) === 5, G.getSpecialVPs(p));
  }

  if (fails.length) { console.log("FAIL:", fails); return 1; }
  console.log("ALL SCENARIOS PASS (14/14)");
  return 0;
})()`;

vm.runInContext(testSrc, sandbox).then((code) => process.exit(code)).catch(e => { console.error('ERROR:', e); process.exit(1); });
