// nn_wasm.js(WebAssembly 前向) 与 sim_nn.js 纯 JS 前向的对拍。
// 用法：node tests/nn_wasm_parity_test.js
//   - 50 个随机 446 维输入 + 20 个启发式自对弈真实局面(PRSim.extractRich)
//   - 比较 policyLogits / valueVec：max |wasm - js| 必须 < 1e-3（wasm 为 f32 累加，JS 为 f64）
//   - 后端不是 wasm（缺 WebAssembly / 实例化失败 / createForward 抛错）→ 非零退出并说明原因
const { loadEngine } = require('../tools/_sandbox.js');

const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'nn_wasm.js', 'sim_nn.js'] });
const PRSim = sandbox.PRSim;
const nn = sandbox.module.exports; // sim_nn.js 的 module.exports（含 _forward）
const TOL = 1e-3;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

(async () => {
  if (!sandbox.PRNNWasm) fail('nn_wasm.js did not define PRNNWasm');
  const net = await PRSim.loadNetwork('mcts_value_nn.json');
  const backend = PRSim.nnBackend();
  if (backend !== 'wasm-simd' && backend !== 'wasm') {
    fail(`backend is '${backend}', expected wasm — PRNNWasm.available=${sandbox.PRNNWasm.available}, last error: ${sandbox.PRNNWasm._error}`);
  }
  console.log(`backend: ${backend} (simd=${sandbox.PRNNWasm.simd}), program ops=${net._wasmForward.program.length}, wasm bytes=${net._wasmForward.bytes}`);

  const rnd = mulberry32(12345);
  const inputs = [];
  for (let i = 0; i < 50; i++) {
    const f = new Float32Array(net.feature_dim);
    for (let j = 0; j < f.length; j++) f[j] = (rnd() * 2 - 1) * (rnd() < 0.5 ? 1 : 0.1);
    inputs.push({ tag: `rand#${i}`, f });
  }
  // 真实局面：启发式自对弈，沿途每隔几步采样，直到 20 个
  let seed = 7;
  while (inputs.length < 70) {
    const st = PRSim.newState(4, [5, 5, 5, 5]);
    st.rnd = mulberry32(seed++);
    let guard = 0, step = 0;
    while (!PRSim.isTerminal(st) && guard++ < 400 && inputs.length < 70) {
      const ch = PRSim.currentChooser(st);
      if (ch < 0) break;
      const legal = PRSim.legalRoleIdxs(st);
      if (!legal.length) break;
      if (step++ % 7 === 3) inputs.push({ tag: `state seed=${seed - 1} step=${step}`, f: PRSim.extractRich(st, ch) });
      PRSim.applyRole(st, PRSim.heuristicPickRole(st, ch, legal));
    }
  }

  let maxP = 0, maxV = 0, worst = '';
  for (const { tag, f } of inputs) {
    sandbox._nnForceJS = true;  const js = nn._forward(net, f);
    sandbox._nnForceJS = false; const ws = nn._forward(net, f);
    if (js.policyLogits.length !== ws.policyLogits.length) fail(`${tag}: policy length ${ws.policyLogits.length} vs ${js.policyLogits.length}`);
    if (js.valueVec.length !== ws.valueVec.length) fail(`${tag}: valueVec length ${ws.valueVec.length} vs ${js.valueVec.length}`);
    for (let k = 0; k < js.policyLogits.length; k++) {
      const d = Math.abs(js.policyLogits[k] - ws.policyLogits[k]);
      if (!(d <= TOL)) fail(`${tag}: policyLogits[${k}] wasm=${ws.policyLogits[k]} js=${js.policyLogits[k]} diff=${d}`);
      if (d > maxP) { maxP = d; worst = tag; }
    }
    for (let k = 0; k < js.valueVec.length; k++) {
      const d = Math.abs(js.valueVec[k] - ws.valueVec[k]);
      if (!(d <= TOL)) fail(`${tag}: valueVec[${k}] wasm=${ws.valueVec[k]} js=${js.valueVec[k]} diff=${d}`);
      if (d > maxV) maxV = d;
    }
    if (ws.value !== ws.valueVec[0]) fail(`${tag}: value !== valueVec[0]`);
    // policy(softmax) 也顺带核对
    for (let k = 0; k < js.policy.length; k++) if (!(Math.abs(js.policy[k] - ws.policy[k]) <= TOL)) fail(`${tag}: policy[${k}] mismatch`);
  }
  // 维度错误必须与 JS 同样抛错
  let threw = false;
  try { nn._forward(net, new Float32Array(3)); } catch (e) { threw = /feature dim mismatch/.test(e.message); }
  if (!threw) fail('wasm forward did not throw on feature dim mismatch');

  console.log(`inputs: ${inputs.length} (50 random + ${inputs.length - 50} real states)`);
  console.log(`max |policyLogits diff|: ${maxP.toExponential(3)} (${worst})`);
  console.log(`max |valueVec diff|:     ${maxV.toExponential(3)}`);
  console.log(`PASS (tolerance ${TOL})`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(99); });
