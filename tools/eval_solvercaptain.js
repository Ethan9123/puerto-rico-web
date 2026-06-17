// ============================================================
// tools/eval_solvercaptain.js — L6 终局精确求解器(captain 子决策) 真实对局配对 A/B
// ============================================================
// 测 window._l6SolverCaptain(game.js solverPickCaptain)在 build-solver 已默认开启之上的*边际*增益。
// 设计: build-solver 两边都开(部署现状); ON 额外开 captain-solver, OFF 不开。1×L6 vs 3×L5, 同种子配对。
// captain 是终局第二高分歧子决策(55%, 仅次于 build 74%), 专家共识(BGA/BGG)也视装船为最关键。
//
// 用法: node tools/eval_solvercaptain.js [pairs=350] [iters=40] [cap=2e6]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const makeEl = () => ({ _c: [], innerHTML: '', textContent: '', style: {}, className: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, value: '', checked: false,
  appendChild(c) { return c; }, removeChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; }, insertAdjacentHTML() {},
  querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }), cloneNode() { return makeEl(); }, closest() { return null; }, focus() {}, click() {}, onclick: null });
const _els = {};
let _seed = 1; const rng = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const M = Object.create(Math); M.random = rng;
const sandbox = { document: { getElementById: id => (_els[id] || (_els[id] = makeEl())), querySelector: () => null, querySelectorAll: () => [], createElement: () => makeEl(), body: makeEl(), documentElement: makeEl(), addEventListener() {} },
  console, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: () => {},
  performance: { now: () => Date.now() }, Math: M, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, Float32Array,
  fetch: async f => ({ json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')), ok: true }) };
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.__setSeed = s => { _seed = (s >>> 0) || 1; };
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
for (const f of ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js', 'sim_solve.js']) load(f);
const PAIRS = parseInt(process.argv[2] || '350'), ITERS = parseInt(process.argv[3] || '40'), CAP = parseFloat(process.argv[4] || '2e6');
const src = `(async()=>{
  render=function(){};flyToDest=function(){};showToast=function(){};
  window._allAIMode=true;window._fastSpectator=true;window._l6Solver=false;window._l6SolverBuild=true;window._l6SolverBuildCap=${CAP};
  window._aiThinkBudget={L4:1,L5:1,hardIters:30,hardMs:1e9,expertIters:${ITERS},expertMs:1e9,alphaIters:${ITERS},alphaMs:1e9};
  await loadAIDNA();await PRSim.loadNetwork('mcts_value_nn.json').catch(()=>{});
  let capSolves=0; const _se=PRSim.solveEndgame.bind(PRSim);
  PRSim.solveEndgame=(s,c)=>{const ph=s&&s.az&&s.az.phase;const r=_se(s,c);if(r&&ph==='captain')capSolves++;return r;};
  const N=4;
  async function play(seed,l6seat,capOn){window._l6SolverCaptain=capOn;__setSeed(seed);
    G=new Game(N,'AI');G.players.forEach((p,i)=>{p.isHuman=false;p._aiLevel=(i===l6seat)?6:5;});
    await runMainLoop();
    const t=G.players.map(p=>p.vp+p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0)+G.getSpecialVPs(p));
    const mx=Math.max(...t),tie=t.filter(x=>x===mx).length; return {win:t[l6seat]===mx?1/tie:0,vp:t[l6seat]};}
  let onW=0,offW=0,onV=0,offV=0,n=0,err=0,dsum=0,dsq=0;
  const Z=()=>{const m=dsum/n,v=(dsq-dsum*dsum/n)/Math.max(1,n-1),se=Math.sqrt(v/n);return{m,se,z:se>0?m/se:0};};
  for(let g=0;g<${PAIRS};g++){const seat=g%4,seed=(1234567+g*7919)>>>0;
    try{const a=await play(seed,seat,true),b=await play(seed,seat,false);
      const d=a.win-b.win;dsum+=d;dsq+=d*d;onW+=a.win;offW+=b.win;onV+=a.vp;offV+=b.vp;n++;}catch(e){err++;}
    if((g+1)%50===0){const z=Z();console.log('  '+(g+1)+'/'+${PAIRS}+'  diff '+(100*z.m).toFixed(1)+'±'+(100*z.se).toFixed(1)+'pp z='+z.z.toFixed(2)+' capSolves='+capSolves);}}
  const z=Z(); return {n,err,onW,offW,onV,offV,capSolves,diff:100*z.m,se:100*z.se,z:z.z};
})()`;
vm.runInContext(src, sandbox).then(r => {
  console.log(`\n=== L6 captain-solver MARGINAL A/B (build on both; ${r.n} pairs, iters=${ITERS}, cap=${CAP}, err=${r.err}) ===`);
  console.log(`  L6 seat win: ON(build+captain) ${(100*r.onW/r.n).toFixed(1)}%  OFF(build only) ${(100*r.offW/r.n).toFixed(1)}%`);
  console.log(`  paired diff: ${r.diff>=0?'+':''}${r.diff.toFixed(1)}pp ± ${r.se.toFixed(1)}pp  z=${r.z.toFixed(2)}  ${Math.abs(r.z)>=1.96?(r.z>0?'✅ significant':'negative!'):'not significant'}`);
  console.log(`  L6 mean VP : ON ${(r.onV/r.n).toFixed(2)}  OFF ${(r.offV/r.n).toFixed(2)}   captain-solves ${r.capSolves} (${(r.capSolves/r.n).toFixed(2)}/game-ON)`);
}).catch(e => { console.error(e && e.stack || e); process.exit(1); });
