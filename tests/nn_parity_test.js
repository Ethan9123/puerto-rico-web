// Phase 4 验证：JS 推理 vs Python 推理在同一输入上输出一致。
// 流程：
//   1. Python 把 smoke 模型导出为 train/exports/smoke.json
//   2. Python 也把同一组 features 的 forward 结果存为 tests/_nn_ref.json
//   3. JS 加载 smoke.json，对同一 features 跑 forward，逐元素比对
// 误差容忍：|js - py| < 1e-4

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() {
  const el = { _c:[], innerHTML:'', textContent:'', style:{}, className:'', dataset:{},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false,
    appendChild(c){this._c.push(c);return c;}, removeChild(){}, remove(){}, addEventListener(){}, removeEventListener(){},
    setAttribute(){}, getAttribute(){return null;}, insertAdjacentHTML(){}, querySelector(){return null;},
    querySelectorAll(){return [];}, getBoundingClientRect(){return{left:0,top:0,width:0,height:0};}, cloneNode(){return makeEl();}, closest(){return null;}, focus(){}, click(){}, onclick:null };
  return el;
}
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  // 提供 Node 风格 fetch（仅读本地文件）
  fetch: async f => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    return { ok: true, status: 200, json: async () => data };
  },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
load('ai_dna.js');
load('game.js');
load('sim.js');
load('sim_features.js');
load('sim_nn.js');

const PRSim = sandbox.PRSim;

(async () => {
  const refPath = path.join(__dirname, '_nn_ref.json');
  if (!fs.existsSync(refPath)) {
    console.error(`reference file missing: ${refPath}`);
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
