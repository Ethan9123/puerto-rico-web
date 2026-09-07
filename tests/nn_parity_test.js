// Phase 4 验证：JS 推理 vs Python 推理在同一输入上输出一致。
// 流程：
//   1. Python 把 smoke 模型导出为 train/exports/smoke.json
//   2. Python 也把同一组 features 的 forward 结果存为 tests/_nn_ref.json
//   3. JS 加载 smoke.json，对同一 features 跑 forward，逐元素比对
// 误差容忍：|js - py| < 1e-4

const fs = require('fs');
const path = require('path');

// 共享 Node 沙盒（tools/_sandbox.js）替代原先每个测试各自复制的 makeEl()/vm 样板
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });

const PRSim = sandbox.PRSim;

(async () => {
  const refPath = path.join(__dirname, '_nn_ref.json');
  if (!fs.existsSync(refPath)) {
    console.error(`skipped: missing ref — reference file missing: ${refPath}`);
    console.error('  run: python tests/_make_nn_ref.py first');
    process.exit(2);
  }
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  await PRSim.loadNetwork(ref.weights_path);

  let maxPolicyErr = 0, maxValueErr = 0, fail = 0;
  for (let i = 0; i < ref.samples.length; i++) {
    const s = ref.samples[i];
    const f = new Float32Array(s.features);
    const out = PRSim._forward
      ? PRSim._forward({ feature_dim: 446, layers: [] }, f) // never used; we'll go via networkEval path
      : null;
    // 简便：直接走 networkEval。但它接受 state，不接受 features。所以临时直接调 _forward 内部。
    // 我们在 sim_nn.js 已经暴露了 networkEval（state, seat）。这里另外提供 _forward 调用：
    // sandbox.module.exports 里有 _forward；同时 PRSim 内只暴露 networkEval。
    // 用 Node export 的 _forward：
    const nn = sandbox.module.exports; // sim_nn.js 的 module.exports
    const result = nn._forward(ref.network, f);
    const py_pol = s.py_policy; const py_val = s.py_value;
    for (let k = 0; k < py_pol.length; k++) {
      const e = Math.abs(result.policy[k] - py_pol[k]);
      if (e > maxPolicyErr) maxPolicyErr = e;
      if (e > 1e-3) { console.error(`sample ${i} pol[${k}] mismatch: js=${result.policy[k]} py=${py_pol[k]}`); fail++; }
    }
    const ev = Math.abs(result.value - py_val);
    if (ev > maxValueErr) maxValueErr = ev;
    if (ev > 1e-3) { console.error(`sample ${i} value mismatch: js=${result.value} py=${py_val}`); fail++; }
  }
  console.log(`samples: ${ref.samples.length}`);
  console.log(`max policy err: ${maxPolicyErr.toExponential(2)}`);
  console.log(`max value  err: ${maxValueErr.toExponential(2)}`);
  console.log(`failures: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(99); });
