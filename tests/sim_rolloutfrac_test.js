// tests/sim_rolloutfrac_test.js — Phase 2：ismctsPickRoleIdx 的 rolloutFrac / 价值网叶评估钩子
//   ① rolloutFrac=0（默认）与不传该选项逐位一致（同种子 idx/stats 相同）
//   ② rolloutFrac=1 → 从不调用 NN 叶评估；rolloutFrac=0 + truncate 0 → 每次迭代都调用；0.5 介于其间
//   ③ 同种子两次运行确定性
//   ④ searchOptsForMode('alpha') 在 root._l6ValueNet 时挂 evalLeafVecFn，否则不挂
'use strict';
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox, PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'nn_wasm.js', 'sim_nn.js'] });

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function midState(seed, steps) {
  const st = S.newState(4, [5, 5, 5, 5]); st.rnd = mulberry32(seed);
  for (let i = 0; i < steps; i++) { const ch = S.currentChooser(st); const legal = S.legalRoleIdxs(st); if (ch < 0 || !legal.length) break; S.applyRole(st, S.heuristicPickRole(st, ch, legal)); }
  return st;
}
function withSeed(st, seed) { const c = S.clone(st); c.rnd = mulberry32(seed); return c; }
const statsKey = (r) => JSON.stringify(r.stats.map(s => [s.nm, s.N, Math.round(s.Q * 1e9) / 1e9]));

(async () => {
  await S.loadNetwork('mcts_value_nn.json');
  let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
  const base = { maxIters: 150, budgetMs: 1e9, C: 1.5, returnStats: true };

  // ① 默认路径逐位一致
  for (let k = 0; k < 6; k++) {
    const st = midState(100 + k, 6 + k);
    const a = S.ismctsPickRoleIdx(withSeed(st, 7), S.searchOptsForMode('alpha', Object.assign({}, base, { truncate: 999 })));
    const b = S.ismctsPickRoleIdx(withSeed(st, 7), S.searchOptsForMode('alpha', Object.assign({}, base, { truncate: 999, rolloutFrac: 0 })));
    ok(a.idx === b.idx && statsKey(a) === statsKey(b), `① state ${k}: rolloutFrac:0 must be bit-identical to absent`);
  }
  // ② 调用计数
  const st = midState(3, 8);
  function countCalls(frac, truncate) {
    let calls = 0;
    const opts = S.searchOptsForMode('alpha', Object.assign({}, base, { truncate, rolloutFrac: frac }));
    opts.evalLeafVecFn = (s) => { calls++; return S.evalLeafVecNN(s); };
    const r = S.ismctsPickRoleIdx(withSeed(st, 11), opts);
    return { calls, iters: r.iters };
  }
  const c0 = countCalls(0, 0), c1 = countCalls(1, 0), ch = countCalls(0.5, 0);
  ok(c1.calls === 0, `② rolloutFrac=1 must never call the NN leaf (calls=${c1.calls})`);
  ok(c0.calls > 0.9 * c0.iters, `② rolloutFrac=0 truncate 0 must call NN leaf ~every iteration (calls=${c0.calls}/${c0.iters})`);
  ok(ch.calls > 0.25 * ch.iters && ch.calls < 0.75 * ch.iters, `② rolloutFrac=0.5 must call NN leaf ~half (calls=${ch.calls}/${ch.iters})`);
  console.log(`② NN-leaf calls: frac0=${c0.calls}/${c0.iters} frac0.5=${ch.calls}/${ch.iters} frac1=${c1.calls}/${c1.iters}`);
  // ③ 确定性
  for (const frac of [0.3, 1]) {
    const o = () => S.searchOptsForMode('alpha', Object.assign({}, base, { truncate: 0, rolloutFrac: frac }));
    const a = S.ismctsPickRoleIdx(withSeed(st, 5), o()), b = S.ismctsPickRoleIdx(withSeed(st, 5), o());
    ok(a.idx === b.idx && statsKey(a) === statsKey(b), `③ rolloutFrac=${frac} deterministic under same seed`);
  }
  // ④ 旋钮挂钩
  sandbox._l6ValueNet = true;
  ok(typeof S.searchOptsForMode('alpha', {}).evalLeafVecFn === 'function', '④ _l6ValueNet → evalLeafVecFn attached');
  sandbox._l6ValueNet = false;
  ok(S.searchOptsForMode('alpha', {}).evalLeafVecFn === undefined, '④ !_l6ValueNet → no evalLeafVecFn');
  ok(S.searchOptsForMode('alpha', { rolloutFrac: 0.25 }).rolloutFrac === 0.25, '④ rolloutFrac passes through base');
  ok(!S.valueNetLoaded(), '④ no value net loaded by default');

  console.log(fails ? `\nROLLOUTFRAC TEST FAILED: ${fails}` : '\nROLLOUTFRAC TEST OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
