// NN 前向数值一致性基准: 确定性生成若干局面, 打印 networkEval 全精度输出。
// 优化 sim_nn.js 前后各跑一次, diff 输出必须为空(扁平化必须逐位一致)。
// 用法: node tools/nn_parity.js > data/.nn_parity_{before|after}.txt
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false, dataset:{},
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){},
  getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')), ok:true }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js']) load(f);
const PRSim = sandbox.PRSim;

(async () => {
  await PRSim.loadNetwork('mcts_value_nn.json');
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const st = PRSim.newState(4, [5,5,5,5], rnd);
  let step = 0, probes = 0;
  while (!PRSim.isTerminal(st) && step < 200) {
    const ch = PRSim.currentChooser(st); if (ch < 0) break;
    const legal = PRSim.legalRoleIdxs(st); if (!legal.length) break;
    if (step % 5 === 0) {
      for (let p = 0; p < 4; p++) {
        const o = PRSim.networkEval(st, p);
        console.log(`step=${step} persp=${p} value=${o.value.toPrecision(17)} policy=[${[...o.policy].map(x => x.toPrecision(17)).join(',')}]`);
        probes++;
      }
    }
    PRSim.applyRole(st, PRSim.heuristicPickRole(st, ch, legal));
    step++;
  }
  console.error(`probes=${probes} steps=${step}`);
})().catch(e => { console.error(e); process.exit(1); });
