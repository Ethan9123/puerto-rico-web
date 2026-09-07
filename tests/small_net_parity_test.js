// tests/small_net_parity_test.js — Phase 2.5：小合并网（policy+value 双头）parity
//   ① 结构：走现有 schema（trunk.* / policy_head / value_head.*），是 mcts_value_nn.json 的直接替换
//   ② JS vs WASM 前向一致
//   ③ numpy 训练端（train/exports/small_ref.json）vs 引擎前向一致
//   ④ 全链路：小网既当 policy 先验又当 value 叶评估，searchOptsForMode('alpha') 能跑出合法着法
// 可用 SMALL_NET / SMALL_REF 环境变量指向其它导出。
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('../tools/_sandbox.js');
const ROOT = path.resolve(__dirname, '..');
const NET = process.env.SMALL_NET || path.join(ROOT, 'mcts_value_nn_small.json');
const REF = process.env.SMALL_REF || path.join(ROOT, 'train/exports/small_ref.json');

if (!fs.existsSync(NET)) { console.log(`skipped: missing ${path.basename(NET)} (run train/distill_small_net.py)`); process.exit(2); }

const { sandbox, PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'nn_wasm.js', 'sim_nn.js'] });
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const maxAbs = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
function heurState(steps) {
  const st = S.newState(4, [5, 5, 5, 5]);
  for (let i = 0; i < steps; i++) { const ch = S.currentChooser(st); const l = S.legalRoleIdxs(st); if (ch < 0 || !l.length || S.isTerminal(st)) break; S.applyRole(st, S.heuristicPickRole(st, ch, l)); }
  return st;
}

(async () => {
  // ① 结构
  const net = JSON.parse(fs.readFileSync(NET, 'utf8'));
  const names = net.layers.map(l => l.name);
  ok(net.feature_dim === 446, `① feature_dim=${net.feature_dim}`);
  ok(names.some(n => n === 'trunk.5'), '① 最后一个 trunk relu 必须命名 trunk.5（sim_nn.js 靠它切 trunkOut）');
  ok(net.layers.some(l => l.head === 'policy'), '① 有 policy 头');
  ok(net.layers.some(l => l.head === 'value'), '① 有 value 头');
  ok(!net.value_only, '① 不是 value_only（是完整替换网）');
  const macs = net.layers.filter(l => l.type === 'linear').reduce((s, l) => s + l.W.length * l.W[0].length, 0);
  const big = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcts_value_nn.json'), 'utf8'));
  const bigMacs = big.layers.filter(l => l.type === 'linear').reduce((s, l) => s + l.W.length * l.W[0].length, 0);
  console.log(`① small MACs=${macs}  big MACs=${bigMacs}  (${(bigMacs / macs).toFixed(1)}x smaller)`);
  ok(macs < bigMacs / 5, '① 小网至少小 5 倍');

  // ② JS vs WASM
  await S.loadNetwork(JSON.parse(JSON.stringify(net)));
  const states = []; for (let i = 0; i < 20; i++) states.push(heurState(1 + i * 2));
  let worst = 0;
  for (const st of states) {
    sandbox._nnForceJS = false; const a = S.networkEval(st, 0);
    sandbox._nnForceJS = true; const b = S.networkEval(st, 0);
    sandbox._nnForceJS = false;
    worst = Math.max(worst, maxAbs(a.policyLogits, b.policyLogits), maxAbs(a.valueVec, b.valueVec));
  }
  console.log(`② JS-vs-WASM max |diff| = ${worst.toExponential(3)} (backend=${S.nnBackend()})`);
  ok(worst < 1e-3, '② JS/WASM parity');

  // ③ numpy 训练端 parity
  if (fs.existsSync(REF)) {
    const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
    const origExtract = S.extractRich;
    let wp = 0, wv = 0;
    for (const smp of ref.samples) {
      const f = new Float32Array(446); for (let j = 0; j < 446; j++) f[j] = smp.f_u8[j] / 255;
      S.extractRich = () => f;
      const o = S.networkEval({ numPlayers: 4 }, 0);
      wp = Math.max(wp, maxAbs(o.policyLogits, smp.policy_logits));
      wv = Math.max(wv, maxAbs(o.valueVec, smp.value_vec));
    }
    S.extractRich = origExtract;
    console.log(`③ numpy-vs-engine over ${ref.samples.length} samples: policy ${wp.toExponential(2)}, value ${wv.toExponential(2)}`);
    ok(wp < 2e-3 && wv < 2e-3, '③ trainer/export parity');
  } else {
    console.log(`③ skipped: missing ${path.basename(REF)}`);
  }

  // ④ 全链路：小网同时当先验与叶评估
  const st = heurState(7);
  const opts = S.searchOptsForMode('alpha', { maxIters: 80, budgetMs: 1e9, C: 1.5, truncate: 0, returnStats: true });
  opts.evalLeafVecFn = (s) => S.evalLeafVecNN(s);
  const r = S.ismctsPickRoleIdx(st, opts);
  ok(S.legalRoleIdxs(st).includes(r.idx) && r.iters === 80, `④ alpha 搜索出合法着法 idx=${r.idx} iters=${r.iters}`);
  const pol = S.networkEval(st, 0).policy;
  ok(pol.length === 7 && Math.abs(pol.reduce((a, b) => a + b, 0) - 1) < 1e-5, '④ policy 7 维且归一');

  console.log(fails ? `\nSMALL NET PARITY FAILED: ${fails}` : '\nSMALL NET PARITY OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
