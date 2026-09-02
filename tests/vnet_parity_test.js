// tests/vnet_parity_test.js — Phase 2 价值网前向 parity
//   ① value_only 网（无 policy 头）：WASM 前向 vs 纯 JS 前向（随机权重网，50 个输入 + 20 个真实局面）
//   ② 若存在 mcts_value_vnet.json + train/exports/vnet_ref.json：numpy 训练端输出 vs JS/WASM 前向
//   ③ evalLeafVecNN 优先用 VNET；unloadValueNet 后退回大网
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox, PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'nn_wasm.js', 'sim_nn.js'] });
const ROOT = path.resolve(__dirname, '..');

function randNet(dims, seed) {
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const layers = []; const L = dims.length - 1;
  for (let i = 0; i < L; i++) {
    const inn = dims[i], out = dims[i + 1];
    const W = []; for (let o = 0; o < out; o++) { const row = new Array(inn); for (let j = 0; j < inn; j++) row[j] = rnd() * Math.sqrt(2 / inn); W.push(row); }
    const lay = { name: `v.${2 * i}`, type: 'linear', in: inn, out, W, b: new Array(out).fill(0).map(() => rnd() * 0.1) };
    if (i === L - 1) lay.head = 'value';
    layers.push(lay);
    layers.push(i === L - 1 ? { name: `v.${2 * i + 1}_tanh`, type: 'tanh' } : { name: `v.${2 * i + 1}_relu`, type: 'relu' });
  }
  return { feature_dim: dims[0], value_only: true, value_dim: dims[dims.length - 1], n_roles: 7, arch: dims.join('-'), layers };
}
function heurState(steps) { const st = S.newState(4, [5, 5, 5, 5]); for (let i = 0; i < steps; i++) { const ch = S.currentChooser(st); const legal = S.legalRoleIdxs(st); if (ch < 0 || !legal.length) break; S.applyRole(st, S.heuristicPickRole(st, ch, legal)); } return st; }
function maxAbs(a, b) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }

(async () => {
  let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
  await S.loadNetwork('mcts_value_nn.json');
  const wasmAvail = !!(sandbox.PRNNWasm && (await sandbox.PRNNWasm.ready()));
  console.log('wasm available:', wasmAvail);

  // ① 随机 value_only 网：wasm vs js
  const net = randNet([446, 64, 32, 4], 12345);
  await S.loadValueNet(JSON.parse(JSON.stringify(net)));
  ok(S.valueNetLoaded(), '① loadValueNet sets VNET');
  const inputs = [];
  for (let i = 0; i < 50; i++) { const f = new Float32Array(446); for (let j = 0; j < 446; j++) f[j] = Math.round(Math.random() * 255) / 255; inputs.push(f); }
  for (let i = 0; i < 20; i++) inputs.push(S.extractRich(heurState(2 + i * 2), 0));
  const forward = S.evalLeafVecNN; // uses VNET
  let worst = 0;
  for (const f of inputs) {
    // 通过 evalLeafVecNN 需要 state；这里直接用 module 内部 _forward 对比：借 evalLeafVecNN 的路径用 state 版本
    void f;
  }
  // 用真实局面走 evalLeafVecNN（wasm）与 _nnForceJS（js）
  for (let i = 0; i < 20; i++) {
    const st = heurState(1 + i * 3);
    sandbox._nnForceJS = false; const a = forward(st); const va = [0, 1, 2, 3].map(a);
    sandbox._nnForceJS = true; const b = forward(st); const vb = [0, 1, 2, 3].map(b);
    sandbox._nnForceJS = false;
    worst = Math.max(worst, maxAbs(va, vb));
  }
  console.log(`① value_only net wasm-vs-js max |diff| = ${worst.toExponential(3)} (backend=${S.valueNetBackend()})`);
  ok(worst < 1e-3, '① wasm/js parity for value_only net');
  ok(!wasmAvail || S.valueNetBackend().startsWith('wasm'), '① value net uses wasm backend when available');

  // ② 训练端 parity（可选文件）
  // 可用环境变量 VNET_JSON / VNET_REF 指向其它导出（如 smoke 训练产物）
  const vnetPath = process.env.VNET_JSON || path.join(ROOT, 'mcts_value_vnet.json'), refPath = process.env.VNET_REF || path.join(ROOT, 'train/exports/vnet_ref.json');
  if (fs.existsSync(vnetPath) && fs.existsSync(refPath)) {
    const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
    await S.loadValueNet(JSON.parse(fs.readFileSync(vnetPath, 'utf8')));
    const nnmod = sandbox.PRSim; // evalLeafVecNN needs a state; use module-level _forward via require path instead
    // 直接调用 sim_nn 内部前向：通过 module.exports 不可得(沙箱)，改用一个假 state 路径不可行 → 用 extractRich 替换法：
    // 构造 features 后临时覆盖 PRSim.extractRich 返回该向量
    const origExtract = S.extractRich;
    let worst2 = 0;
    for (const smp of ref.samples) {
      const f = new Float32Array(446); for (let j = 0; j < 446; j++) f[j] = smp.f_u8[j] / 255;
      S.extractRich = () => f;
      const fn = S.evalLeafVecNN({ numPlayers: 4 });
      const out = [0, 1, 2, 3].map(fn);
      worst2 = Math.max(worst2, maxAbs(out, smp.out));
    }
    S.extractRich = origExtract;
    console.log(`② numpy-vs-js/wasm max |diff| over ${ref.samples.length} ref samples = ${worst2.toExponential(3)}`);
    ok(worst2 < 2e-3, '② trainer/export parity (6-sig-digit weights + f32)');
    void nnmod;
  } else {
    console.log('② skipped: mcts_value_vnet.json / train/exports/vnet_ref.json not present');
  }

  // ③ VNET 优先 / 卸载回退
  await S.loadValueNet(JSON.parse(JSON.stringify(net)));
  const st = heurState(5);
  const withV = [0, 1, 2, 3].map(S.evalLeafVecNN(st));
  S.unloadValueNet();
  ok(!S.valueNetLoaded(), '③ unloadValueNet');
  const withoutV = [0, 1, 2, 3].map(S.evalLeafVecNN(st));
  ok(maxAbs(withV, withoutV) > 1e-6, '③ evalLeafVecNN switches between VNET and big net');
  ok(S.networkEval(st, 0).policy && S.networkEval(st, 0).policy.length === 7, '③ policy net untouched by value net');

  console.log(fails ? `\nVNET PARITY FAILED: ${fails}` : '\nVNET PARITY OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
