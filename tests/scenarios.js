// 针对性场景验证：复现 Neil 报告的三个"呆"行为，确认已修复。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() {
  const el = { _c: [], innerHTML: '', textContent: '', style: {}, className: '', dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, value: '', checked: false,
    appendChild(c) { this._c.push(c); return c; }, removeChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; }, insertAdjacentHTML() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    cloneNode() { return makeEl(); }, closest() { return null; }, focus() {}, click() {}, onclick: null };
  return el;
}
const _els = {};
const sandbox = {
  document: { getElementById: (id) => (_els[id] || (_els[id] = makeEl())), querySelector: () => null,
    querySelectorAll: () => [], createElement: () => makeEl(), body: makeEl(), documentElement: makeEl(), addEventListener() {} },
  console, setTimeout, clearTimeout, requestAnimationFrame: (fn) => setTimeout(fn, 0),
  performance: { now: () => Date.now() }, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean,
  Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN,
  fetch: async (f) => ({ json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), ok: true }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
load('ai_dna.js');
load('game.js');

const src = `(async () => {
  await loadAIDNA();
  window._allAIMode = true;
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass, detail });

  // ---- 场景1：2玉米地，不该买"喂不起"的大靛蓝厂 ----
  {
    G = new Game(4, 'P');
    const p = G.players[1]; p.isHuman = false; p._aiLevel = 4; delete p._dna;
    p.plantations = [{good:'corn',manned:false},{good:'corn',manned:false}];
    p.money = 10; p.buildings = [];
    G.plantationPool = ['corn','corn','tobacco']; // 池里没有靛蓝/糖
    // 候选：大靛蓝厂(3) / 小制糖厂(2) / 小市场(7) / 建筑工地(9)
    const cand = [3,2,7,9].map(id => ({ b: BLD_BY_ID[id], cost: BLD_BY_ID[id].cost }));
    const idx = aiPickBuilding(p, cand, false);
    const picked = cand[idx].b;
    check('2玉米不买大靛蓝厂', picked.id !== 3, '实际选了 ' + picked.cn + '(id' + picked.id + ')');

    // 直接看大靛蓝厂的估值是否被压到很低
    const vIndigo = evalBuildingValue(p, BLD_BY_ID[3], 'early');
    const vMarket = evalBuildingValue(p, BLD_BY_ID[7], 'early');
    check('大靛蓝厂估值<小市场(无靛蓝田)', vIndigo < vMarket, 'vIndigo=' + vIndigo + ' vMarket=' + vMarket);
  }

  // ---- 场景2：有玉米地 + 一个没有靛蓝田的大靛蓝厂，工人应上玉米地而非靛蓝厂 ----
  {
    G = new Game(4, 'P');
    const p = G.players[1];
    p.plantations = [{good:'corn',manned:false},{good:'corn',manned:false}];
    p.buildings = [{bid:3, men:0}]; // 大靛蓝厂 3 槽，但无靛蓝田
    p._unplacedMen = 2;
    aiReallocate(p);
    const cornManned = p.plantations.filter(pl => pl.good==='corn' && pl.manned).length;
    const indigoFactoryMen = p.buildings.find(b=>b.bid===3).men;
    check('优先上玉米地', cornManned === 2, '玉米上岗=' + cornManned);
    check('不浪费工人到喂不起的靛蓝厂', indigoFactoryMen === 0, '靛蓝厂上岗=' + indigoFactoryMen);
  }

  // ---- 场景2b：有靛蓝田时，靛蓝厂应该被喂起来 ----
  {
    G = new Game(4, 'P');
    const p = G.players[1];
    p.plantations = [{good:'indigo',manned:false},{good:'indigo',manned:false}];
    p.buildings = [{bid:1, men:0}]; // 小靛蓝厂 1 槽
    p._unplacedMen = 2;
    aiReallocate(p);
    const indigoFieldManned = p.plantations.filter(pl=>pl.good==='indigo'&&pl.manned).length;
    const indigoFactoryMen = p.buildings.find(b=>b.bid===1).men;
    const produces = Math.min(indigoFieldManned, indigoFactoryMen) >= 1;
    check('有靛蓝田则启动靛蓝产线', produces, '田='+indigoFieldManned+' 厂='+indigoFactoryMen);
  }

  // ---- 场景3：我无货、对手(human)一堆咖啡，L4/L5 不该选船长资敌 ----
  {
    for (const lvl of [4,5]) {
      G = new Game(4, 'P');
      G.players.forEach(p => { p.isHuman = false; delete p._dna; });
      const me = G.players[1]; me._aiLevel = lvl;
      const human = G.players[0]; human.isHuman = true;
      human.goods.coffee = 5; // 对手满手咖啡
      me.goods = {corn:0,indigo:0,sugar:0,tobacco:0,coffee:0}; // 我无货
      const available = G.roleCards.filter(r => !r.taken);
      const idx = aiPickRole(me, available);
      const picked = available[idx].name;
      check('L'+lvl+' 无货不选船长(对手满货)', picked !== 'Captain', '实际选了 ' + picked);
    }
  }

  // ---- 场景3b：首轮(全员无货)，L5 不该选船长/商人刷空分 ----
  {
    let captainOrTrader = 0;
    for (let t = 0; t < 12; t++) {
      G = new Game(4, 'P');
      G.players.forEach(p => { p.isHuman = false; delete p._dna; p._aiLevel = 5; });
      const me = G.players[1];
      const available = G.roleCards.filter(r => !r.taken);
      const idx = aiPickRole(me, available);
      const picked = available[idx].name;
      if (picked === 'Captain' || picked === 'Trader') captainOrTrader++;
    }
    check('首轮L5基本不选船长/商人', captainOrTrader === 0, captainOrTrader + '/12 次选了船长或商人');
  }

  // ---- 场景4：建筑流 AI 作开拓者 chooser 应拿采石场 ----
  {
    G = new Game(4, 'P');
    const p = G.players[1]; p.isHuman = false; p._aiLevel = 4; delete p._dna;
    p.buildings = [{bid:7, men:1},{bid:13, men:0}]; // 已有两个紫色建筑 = 建筑流
    p.money = 8;
    p.plantations = [{good:'corn',manned:true}];
    G.plantationPool = ['corn','indigo','sugar'];
    G.quarriesLeft = 8;
    const options = [];
    for (let i = 0; i < G.plantationPool.length; i++) options.push({ kind:'plant', good:G.plantationPool[i], idx:i });
    options.push({ kind:'quarry' });
    const idx = aiPickPlantation(p, options, true);
    check('建筑流开拓者拿采石场', options[idx].kind === 'quarry', '实际拿了 ' + (options[idx].good || options[idx].kind));
  }

  // ---- 场景5：有采石场就该上人（建筑流） ----
  {
    G = new Game(4, 'P');
    const p = G.players[1];
    p.buildings = [{bid:13, men:1}]; // 一个已上岗紫色建筑(大市场)→建筑流，但不占空槽
    // 1 玉米 + 2 采石场：建筑流应优先把人放采石场(gain>玉米)而非全去玉米
    p.plantations = [{good:'corn',manned:false},{good:'quarry',manned:false},{good:'quarry',manned:false}];
    p._unplacedMen = 2;
    aiReallocate(p);
    const quarryManned = p.plantations.filter(pl => pl.good==='quarry' && pl.manned).length;
    check('采石场优先上人(建筑流)', quarryManned === 2, '采石场上岗=' + quarryManned);
  }

  // ---- 规则①：玉米地多 → 倾向运船 ----
  {
    G = new Game(4, 'P');
    const me = G.players[1]; me.isHuman = false; delete me._dna; me._aiLevel = 4;
    me.plantations = [{good:'corn',manned:true},{good:'corn',manned:true}];
    me.goods.corn = 3;
    const avail = G.roleCards.filter(r => !r.taken);
    const idx = level4Reactive(me, avail);
    check('规则①玉米多→运船', avail[idx].name === 'Captain', '选了 ' + avail[idx].name);
  }

  // ---- 规则②：高价作物且下家也有 → 抢商人卖掉卡位 ----
  {
    G = new Game(4, 'P');
    const me = G.players[1]; me.isHuman = false; delete me._dna; me._aiLevel = 4;
    me.goods.coffee = 1; G.players[2].goods.coffee = 1; // 下家也有咖啡
    const avail = G.roleCards.filter(r => !r.taken);
    const idx = level4Reactive(me, avail);
    check('规则②卡下家咖啡→商人', avail[idx].name === 'Trader', '选了 ' + avail[idx].name);
  }

  // ---- 规则③：落后于领先者 → 抢建造大紫/塞满格子加速结束 ----
  {
    G = new Game(4, 'P');
    const me = G.players[1]; me.isHuman = false; delete me._dna; me._aiLevel = 4;
    me.money = 10; G.players[0].vp = 20; // 领先者
    G.vpLeft = 30;                       // 逼近后期
    const avail = G.roleCards.filter(r => !r.taken);
    const idx = level4Reactive(me, avail);
    check('规则③落后→抢建造大紫', avail[idx].name === 'Builder', '选了 ' + avail[idx].name);
  }

  return results;
})()`;

vm.runInContext(src, sandbox).then((results) => {
  let allPass = true;
  for (const r of results) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   <- ' + r.detail));
    if (!r.pass) allPass = false;
  }
  console.log(allPass ? '\nALL SCENARIOS PASS' : '\nSOME SCENARIOS FAILED');
  process.exit(allPass ? 0 : 1);
}).catch(e => { console.error('ERROR', e); process.exit(1); });
