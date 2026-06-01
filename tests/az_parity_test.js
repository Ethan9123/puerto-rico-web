// az ResNet parity: JS azForward vs PyTorch forward 在同输入上输出一致。
// 先跑: python tests/_make_az_ref.py  (生成 az_smoke.json + _az_ref.json)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() { return { innerHTML:'', style:{}, classList:{add(){},remove(){}}, appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} }; }
const _e = {};
const sb = { document:{ getElementById:id=>(_e[id]||(_e[id]=makeEl())), createElement:()=>makeEl(), body:makeEl(), addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[] }, console, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array, setTimeout, performance:{now:()=>Date.now()} };
sb.window = sb; sb.globalThis = sb; vm.createContext(sb);
for (const f of ['game.js','sim.js','sim_features.js','sim_az.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sb, { filename: f });
const azmod = sb.module.exports; // sim_az.js 的 module.exports (azForward 等)

const refPath = path.join(__dirname, '_az_ref.json');
const netPath = path.join(__dirname, '..', 'train', 'exports', 'az_smoke.json');
if (!fs.existsSync(refPath) || !fs.existsSync(netPath)) { console.error('missing ref/net; run: python tests/_make_az_ref.py'); process.exit(2); }
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
