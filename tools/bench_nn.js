// tools/bench_nn.js — 部署网(mcts_value_nn.json)的单次前向耗时：纯 JS vs wasm 后端
// 用法：node tools/bench_nn.js [calls=2000]
const { loadEngine } = require('./_sandbox.js');

const CALLS = parseInt(process.argv[2] || '2000', 10);
const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'nn_wasm.js', 'sim_nn.js'] });
const PRSim = sandbox.PRSim;
const nn = sandbox.module.exports;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function bench(label, net, inputs, calls) {
  let sink = 0;
  for (let i = 0; i < 200; i++) sink += nn._forward(net, inputs[i % inputs.length]).value; // 预热
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < calls; i++) sink += nn._forward(net, inputs[i % inputs.length]).value;
  const us = Number(process.hrtime.bigint() - t0) / 1000 / calls;
  console.log(`${label.padEnd(10)} ${us.toFixed(1).padStart(8)} µs/forward  (${calls} calls, sink=${sink.toFixed(3)})`);
  return us;
}

(async () => {
  const net = await PRSim.loadNetwork('mcts_value_nn.json');
  const rnd = mulberry32(99);
  const inputs = [];
  for (let i = 0; i < 64; i++) { const f = new Float32Array(net.feature_dim); for (let j = 0; j < f.length; j++) f[j] = rnd() * 2 - 1; inputs.push(f); }
  const wasmBackend = PRSim.nnBackend();

  sandbox._nnForceJS = true;
  const js = bench('js', net, inputs, CALLS);
  sandbox._nnForceJS = false;
  if (wasmBackend === 'js') { console.log(`wasm backend unavailable (${sandbox.PRNNWasm && sandbox.PRNNWasm._error})`); process.exit(2); }
  const ws = bench(wasmBackend, net, inputs, CALLS);
  console.log(`speedup: ${(js / ws).toFixed(2)}×`);
})().catch(e => { console.error(e); process.exit(99); });
