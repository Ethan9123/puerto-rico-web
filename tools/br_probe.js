// 诊断: BR 自对弈单局, 按座位类型统计每步决策耗时
// 用法: node tools/br_probe.js [ITERS=400] [SEED=7]
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
const ROLE_LIST = sandbox.ROLE_LIST;

const ITERS = parseInt(process.argv[2] || '400');
const SEED0 = parseInt(process.argv[3] || '7');

(async () => {
  await PRSim.loadNetwork('mcts_value_nn.json');
  // 统计 NN 前向次数(networkEval 每次恰好调一次 PRSim.extractRich)
  let nFwd = 0;
  const _er = PRSim.extractRich;
  PRSim.extractRich = (s, p) => { nFwd++; return _er(s, p); };
  const USE_VEC = process.argv[4] !== 'novec';
  function searchOpts(iters, useNN) {
    const opts = { maxIters: iters, budgetMs: 600000 };
    if (useNN) {
      opts.C = 1.5;
      if (USE_VEC) opts.evalLeafVecFn = (s) => PRSim.evalLeafVecNN(s);
      opts.evalLeafFn = (s, p) => PRSim.evalLeafNN(s, p);
      opts.priorPolicyFn = (s, p) => {
        const o = PRSim.networkEval(s, p); if (!o) return null;
        const legal = PRSim.legalRoleIdxs(s);
        const legalNames = new Set(legal.map(i => s.roleCards[i].name));
        const dist = {}; let sum = 0;
        for (let k = 0; k < ROLE_LIST.length; k++) if (legalNames.has(ROLE_LIST[k])) { dist[ROLE_LIST[k]] = o.policy[k]; sum += o.policy[k]; }
        if (sum > 0) for (const k of Object.keys(dist)) dist[k] /= sum;
        return dist;
      };
    }
    return opts;
  }
  let seed = SEED0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const st = PRSim.newState(4, [5,5,5,5], rnd);
  const learner = 0;
  const tStat = { nn: [], pure: [] };
  let step = 0;
  const t0 = Date.now();
  while (!PRSim.isTerminal(st) && step < 500) {
    const ch = PRSim.currentChooser(st); if (ch < 0) break;
    const legal = PRSim.legalRoleIdxs(st); if (!legal.length) break;
    const td = Date.now();
    const picked = PRSim.ismctsPickRoleIdx(st, searchOpts(ITERS, ch === learner));
    const dt = Date.now() - td;
    tStat[ch === learner ? 'nn' : 'pure'].push(dt);
    if (picked < 0) break;
    PRSim.applyRole(st, picked);
    step++;
  }
  const sum = a => a.reduce((s, x) => s + x, 0);
  const fmt = a => a.length ? `n=${a.length} avg=${(sum(a)/a.length).toFixed(0)}ms max=${Math.max(...a)}ms total=${(sum(a)/1000).toFixed(1)}s` : 'n=0';
  console.log(`game done in ${((Date.now()-t0)/1000).toFixed(1)}s, ${step} decisions, iters=${ITERS}, vec=${USE_VEC}`);
  console.log(`  NN(learner) : ${fmt(tStat.nn)}`);
  console.log(`  pure ISMCTS : ${fmt(tStat.pure)}`);
  console.log(`  NN forwards : ${nFwd} (${(nFwd / Math.max(1, tStat.nn.length)).toFixed(0)}/learner-decision)`);
})().catch(e => { console.error(e); process.exit(1); });
