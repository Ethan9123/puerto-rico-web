#!/usr/bin/env node
// tools/bench_search.js — Phase 2：各叶评估模式的每迭代耗时 → 等墙钟迭代倍率
//   模式: rollout(truncate 999) | vnet t0 | vnet t2 | vnet t0 + rolloutFrac 0.25 | bignet-value t0(现役大网价值头)
//         | small-combined(小合并网同时当 policy 先验 + value 叶评估, Phase 2.5)
//   用法: node tools/bench_search.js [iters=300] [states=20] [vnetPath=mcts_value_vnet.json] [smallNet=mcts_value_nn_small.json]
'use strict';
const fs = require('fs');
const { loadEngine } = require('./_sandbox.js');
const ITERS = parseInt(process.argv[2] || '300');
const NSTATES = parseInt(process.argv[3] || '20');
const VNET = process.argv[4] || 'mcts_value_vnet.json';
const SMALL = process.argv[5] || 'mcts_value_nn_small.json';
const { sandbox, PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'nn_wasm.js', 'sim_nn.js'] });
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const now = () => Number(process.hrtime.bigint()) / 1e6;

(async () => {
  await S.loadNetwork('mcts_value_nn.json');
  const hasV = fs.existsSync(VNET);
  const hasSmall = fs.existsSync(SMALL);
  if (hasV) await S.loadValueNet(VNET); else console.log(`(no ${VNET}; "vnet" modes use the big net's value head)`);
  // 种子化中盘局面（不同深度）
  const states = [];
  for (let i = 0; i < NSTATES; i++) {
    const st = S.newState(4, [5, 5, 5, 5]); st.rnd = mulberry32(1000 + i);
    const steps = 4 + (i % 12) * 3;
    for (let k = 0; k < steps; k++) { const ch = S.currentChooser(st); const legal = S.legalRoleIdxs(st); if (ch < 0 || !legal.length || S.isTerminal(st)) break; S.applyRole(st, S.heuristicPickRole(st, ch, legal)); }
    if (!S.isTerminal(st) && S.currentChooser(st) >= 0) states.push(st);
  }
  const modes = [
    { name: 'rollout (truncate 999)', knobs: { vnet: false, truncate: 999, frac: 0 } },
    { name: 'bignet-value t0', knobs: { vnet: false, truncate: 0, frac: 0, bigVec: true } },
    { name: 'vnet t0', knobs: { vnet: true, truncate: 0, frac: 0 } },
    { name: 'vnet t2', knobs: { vnet: true, truncate: 2, frac: 0 } },
    { name: 'vnet t0 + rolloutFrac 0.25', knobs: { vnet: true, truncate: 0, frac: 0.25 } },
    { name: 'vnet t0 + rolloutFrac 0.5', knobs: { vnet: true, truncate: 0, frac: 0.5 } },   // AlphaGo λ 混合
    // Phase 2.5：小合并网同时提供 policy 先验与 value 叶评估（替换大网，非附加）
    { name: 'small-combined t0', knobs: { vnet: false, truncate: 0, frac: 0, bigVec: true, small: true } },
  ];
  const results = [];
  for (const m of modes) {
    if (m.knobs.small) {
      if (!hasSmall) { console.log(`${'small-combined t0'.padEnd(30)}  (skipped: no ${SMALL})`); continue; }
      await S.loadNetwork(SMALL);      // 小网进 NET → 先验与价值都来自它
      S.unloadValueNet();              // 确保 evalLeafVecNN 用 NET 而不是独立价值网
    }
    sandbox._l6ValueNet = !!m.knobs.vnet;
    let total = 0, iters = 0;
    for (let i = 0; i < states.length; i++) {
      const st = S.clone(states[i]); st.rnd = mulberry32(50 + i);
      const opts = S.searchOptsForMode('alpha', { maxIters: ITERS, budgetMs: 1e9, C: 1.5, truncate: m.knobs.truncate, rolloutFrac: m.knobs.frac, returnStats: true });
      if (m.knobs.bigVec) opts.evalLeafVecFn = (s) => S.evalLeafVecNN(s);
      const t0 = now(); const r = S.ismctsPickRoleIdx(st, opts); total += now() - t0; iters += r.iters || ITERS;
    }
    const us = total * 1000 / iters;
    results.push({ name: m.name, us });
    console.log(`${m.name.padEnd(30)} ${us.toFixed(0).padStart(6)} us/iter   (${states.length} states × ${ITERS} iters)`);
  }
  sandbox._l6ValueNet = false;
  const base = results[0].us;
  console.log('\n等墙钟迭代倍率（相对完整 rollout）:');
  for (const r of results.slice(1)) console.log(`  ${r.name.padEnd(30)} ×${(base / r.us).toFixed(2)}  → alphaIters 400 ≈ ${Math.round(400 * base / r.us)}`);
  console.log(`\nvalue net: ${hasV ? VNET + ' (' + S.valueNetBackend() + ')' : 'none'}; policy net backend: ${S.nnBackend()}`);
})().catch(e => { console.error(e); process.exit(1); });
