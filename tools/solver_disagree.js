// 诊断: 终局求解器与启发式在哪种决策类型上分歧最多(→ 该优先集成哪个 do* 子决策)。
// 对每个 endTriggered 后的决策, 比较 solveEndgame().action 与 azHeuristicAction()。
// 用法: node tools/solver_disagree.js [games=300] [cap=1.5e5] [seed=777]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false, dataset:{},
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){}, getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
const sandbox = { document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0), performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')), ok:true }) };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js','sim_az.js','sim_solve.js']) load(f);
const P = sandbox.PRSim;
const GAMES = parseInt(process.argv[2] || '300'), CAP = parseFloat(process.argv[3] || '1.5e5'), SEED0 = parseInt(process.argv[4] || '777');

(async () => {
  await P.loadNetwork('mcts_value_nn.json').catch(() => {});
  const total = {}, disagree = {}; // by decision type
  let solved = 0, missed = 0;
  for (let g = 0; g < GAMES; g++) {
    let seed = (SEED0 + g * 7919) >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const st = P.newState(4, [5,5,5,5], rnd);
    let guard = 0;
    while (guard++ < 2000) {
      const dec = P.azDecision(st);
      if (!dec) break;
      if (st.endTriggered && dec.actions.length > 1) {
        const sol = P.solveEndgame(P.clone(st), CAP);
        const heur = P.azHeuristicAction(st, dec);
        total[dec.type] = (total[dec.type] || 0) + 1;
        if (sol) { solved++; if (sol.action !== heur) disagree[dec.type] = (disagree[dec.type] || 0) + 1; }
        else missed++;
      }
      P.azApply(st, P.azHeuristicAction(st, dec));
    }
  }
  console.log(`\n=== 终局 求解器 vs 启发式 分歧率 (${GAMES} 局; solved=${solved} budgetMiss=${missed}) ===`);
  const types = Object.keys(total).sort((a, b) => (disagree[b] || 0) - (disagree[a] || 0));
  for (const t of types) {
    const d = disagree[t] || 0, n = total[t];
    console.log(`  ${t.padEnd(11)}: 决策 ${String(n).padStart(4)}  分歧 ${String(d).padStart(4)}  (${(d / n * 100).toFixed(0)}%)`);
  }
  console.log(`\n[启示] 分歧最多的类型 = 终局启发式最该被精确求解替换的子决策。`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
