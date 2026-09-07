// az ResNet parity: JS azForward vs PyTorch forward 在同输入上输出一致。
// 先跑: python tests/_make_az_ref.py  (生成 az_smoke.json + _az_ref.json)
const fs = require('fs');
const path = require('path');

// 共享 Node 沙盒（tools/_sandbox.js）替代原先每个测试各自复制的 makeEl()/vm 样板
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox: sb } = loadEngine({ files: ['game.js', 'sim.js', 'sim_features.js', 'sim_az.js'] });
const azmod = sb.module.exports; // sim_az.js 的 module.exports (azForward 等)

const refPath = path.join(__dirname, '_az_ref.json');
const netPath = path.join(__dirname, '..', 'train', 'exports', 'az_smoke.json');
if (!fs.existsSync(refPath) || !fs.existsSync(netPath)) { console.error('skipped: missing ref — missing ref/net; run: python tests/_make_az_ref.py'); process.exit(2); }
const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
const net = JSON.parse(fs.readFileSync(netPath, 'utf8'));

let maxLogitErr = 0, maxValueErr = 0, fail = 0;
for (let i = 0; i < ref.samples.length; i++) {
  const s = ref.samples[i];
  const f = new Float32Array(s.features);
  const out = azmod.azForward(net, f);
  for (let k = 0; k < s.py_logits.length; k++) {
    const e = Math.abs(out.policyLogits[k] - s.py_logits[k]);
    if (e > maxLogitErr) maxLogitErr = e;
    if (e > 1e-3) { fail++; }
  }
  for (let k = 0; k < s.py_value.length; k++) {
    const e = Math.abs(out.value[k] - s.py_value[k]);
    if (e > maxValueErr) maxValueErr = e;
    if (e > 1e-3) { fail++; }
  }
}
console.log(`samples: ${ref.samples.length}`);
console.log(`max policy-logit err: ${maxLogitErr.toExponential(2)}`);
console.log(`max value err       : ${maxValueErr.toExponential(2)}`);
console.log(`failures: ${fail}`);
console.log(fail === 0 ? '\n[OK] JS ResNet azForward == PyTorch forward' : '\n[FAIL]');
process.exit(fail > 0 ? 1 : 0);
