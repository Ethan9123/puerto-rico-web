// tests/sim_expansion_effects_test.js — sim.js 的扩展建筑效果（§15）
//   ① clone 完整性：新增状态字段必须被 clone 复制（漏加 = MCTS 分叉静默丢状态，§14 同类 bug）
//   ② 模块门：基础局下所有扩展效果必须零触发
//   ③ 逐效果：金矿(46) / 水井(47) / 寄宿屋(48) / 塔楼(49)
'use strict';
const { loadEngine } = require('../tools/_sandbox.js');
const { PRSim: S0 } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js'] });
const S = Object.assign({}, S0, S0._internal);   // doCraftsman/doSettler 走 _internal 导出
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const give = (p, bid, men) => p.buildings.push({ bid, men });

// ---- ① clone 完整性（对状态与玩家两层做逐字段比对）----
{
  const st = S.newState(4, [5, 5, 5, 5]);
  st.expansionTibs = true; st.expansion = true; st.expansionNobles = true;
  st.noblesLeft = 7; st.noblesOnShip = 2;
  st.players[0]._invest = 5; st.players[0].nobleCount = 2;
  const c = S.clone(st);
  for (const k of ['expansion', 'expansionTibs', 'expansionNobles', 'noblesLeft', 'noblesOnShip']) {
    ok(c[k] === st[k], `① clone 丢了 st.${k}（${c[k]} ≠ ${st[k]}）—— 漏加 clone 是 §14 同类 bug`);
  }
  for (const k of ['_invest', 'nobleCount']) {
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

console.log(fails ? `\nSIM EXPANSION EFFECTS TEST FAILED: ${fails}` : '\nSIM EXPANSION EFFECTS TEST OK');
process.exit(fails ? 1 : 0);
