// tests/subdecision_rebuild_test.js — 子决策处的 sim 状态重建（game.js simStateAtSubDecision）
//
// 钉住第三轮 Stage 0 修掉的 off-by-one：子决策发生在角色阶段中途，该角色卡已 taken，但 az 层只在
// azFinishRole 才 picksThisTurn++。重建若不减 1，阶段结束后「下一个选角者」错位、本轮少一次选角。
//
// 做法：跑一局带种子的真实 game.js 对局（4×L5，小预算），在每个 AI 建造 / 装船子决策点
// （借 solverPickBuilding / solverPickCaptain 的调用点——它们对所有 AI 都会被调用、默认直接返回 null）
// 重建 sim 状态，然后在 sim 里用启发式把**当前阶段**走完，断言：
//   ① picksThisTurn + 1 === 已选角色卡数（阶段中途的不变式）
//   ② 阶段结束后 sim 的下一个选角者 == 真实规则给出的下一个选角者
//      （非本轮最后一选：(governor + 已选数) % N；最后一选：总督轮换、picksThisTurn 归零）
//   ③ 非空洞：本局至少有若干次重建通过了安全闸并被检查
// 反向验证（手工，已做）：去掉 simStateAtSubDecision 里的 `- 1` → ② 变红。
'use strict';
const { loadEngine } = require('../tools/_sandbox.js');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const M = {}; for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
let rng = mulberry32(20260923); M.random = () => rng();
const { run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'], beforeLoad: sb => { sb.Math = M; } });

run(`(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:30, hardMs:1e9, expertIters:30, expertMs:1e9, alphaIters:30, alphaMs:1e9 };
  await loadAIDNA();
  const R = { build: 0, captain: 0, gated: 0, bad: [] };
  function check(kind, p, rb) {
    if (!rb) { R.gated++; return; }
    R[kind]++;
    const st = rb.st, N = G.numPlayers;
    const taken = G.roleCards.filter(r => r.name !== 'Buccaneer' && r.taken).length;
    if (st.picksThisTurn + 1 !== taken) R.bad.push(kind + ' ① picksThisTurn=' + st.picksThisTurn + ' taken=' + taken);
    const perRound = N === 2 ? 6 : N;
    const gov0 = G.governor;
    // 用启发式走完当前阶段（下一次 role 决策即阶段结束 + azFinishRole 已执行）
    let d = PRSim.azDecision(st), guard = 0;
    while (d && d.type !== 'role' && guard++ < 400) { PRSim.azApply(st, PRSim.azHeuristicAction(st, d)); d = PRSim.azDecision(st); }
    if (!d || PRSim.isTerminal(st)) return;           // 终局：无下一选角者可比
    if (taken < perRound) {
      const want = (gov0 + taken) % N, got = PRSim.currentChooser(st);
      if (got !== want) R.bad.push(kind + ' ② next chooser ' + got + ' != ' + want + ' (taken=' + taken + ')');
    } else {
      if (st.picksThisTurn !== 0 || st.governor !== (gov0 + 1) % N) R.bad.push(kind + ' ② round end: picks=' + st.picksThisTurn + ' gov=' + st.governor + ' want gov ' + (gov0 + 1) % N);
    }
  }
  const _sb = solverPickBuilding;
  solverPickBuilding = function (p, options, isChooser) { check('build', p, simStateAtSubDecision('build', p, { options })); return _sb.apply(this, arguments); };
  const _sc = solverPickCaptain;
  solverPickCaptain = function (p, candidates, chooserIdx, order, passProgressed, chooserBonusUsedSet) {
    check('captain', p, simStateAtSubDecision('captain', p, { candidates, chooserIdx, order, passProgressed, chooserBonusUsedSet }));
    return _sc.apply(this, arguments);
  };
  G = new Game(4, 'AI', {});
  G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = 5; });
  await runMainLoop();
  return JSON.stringify(Object.assign(R, { over: !!G.gameOver }));
})()`).then(raw => {
  const R = JSON.parse(raw);
  let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('  ok', m); };
  console.log(`rebuilds: build=${R.build} captain=${R.captain} gated=${R.gated} gameOver=${R.over}`);
  ok(R.over, '对局正常终局');
  ok(R.build >= 5 && R.captain >= 3, `③ 非空洞：建造 ${R.build} / 装船 ${R.captain} 次重建被检查`);
  ok(R.gated <= Math.max(2, 0.1 * (R.build + R.captain + R.gated)), `安全闸拒绝率低（${R.gated}）`);
  ok(R.bad.length === 0, `①② 重建不变式全部成立${R.bad.length ? '：' + R.bad.slice(0, 5).join(' ; ') : ''}`);
  console.log(fails ? `\nSUBDECISION REBUILD TEST FAILED: ${fails}` : '\nSUBDECISION REBUILD TEST OK');
  process.exit(fails ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
