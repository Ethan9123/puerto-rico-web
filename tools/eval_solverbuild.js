// ============================================================
// tools/eval_solverbuild.js — L6 终局精确求解器(build 子决策) 真实对局配对 A/B
// ============================================================
// 验证 window._l6SolverBuild(game.js solverPickBuilding)在 *真实 game.js 对局* 里是否提升 L6。
// AI_STRENGTH §9 的教训: 求解器在 sim 层 +2.2pp, 但 role-only 真实接入是 null —— 故必须真实评测。
//
// 设计(同种子配对): 1×L6 vs 3×L5, 座位轮转。每个种子跑两遍:
//   ON  = window._l6SolverBuild=true   OFF = false。
//   同一 seed → 牌序/MCTS 随机数一致 → 仅 L6 终局 build 选择不同 → 配对差消掉牌运方差。
// 输出 L6 座位胜率的配对差 + z。
//
// 用法: node tools/eval_solverbuild.js [pairs=350] [iters=40] [cap=2e6]
//   iters 越大越接近部署强度(部署 alphaIters≈800)但越慢; 配对设计下 iters=40 已能给出趋势。
'use strict';
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
let _seed = 1;
const rng = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const M = Object.create(Math); M.random = rng;                    // 仅 sandbox 内覆盖 random，保证配对同种子
const { run } = loadEngine({
  files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js', 'sim_solve.js'],
  beforeLoad: sb => { sb.Math = M; sb.__setSeed = s => { _seed = (s >>> 0) || 1; }; }, // 引擎加载前注入
});
const PAIRS = parseInt(process.argv[2] || '350'), ITERS = parseInt(process.argv[3] || '40'), CAP = parseFloat(process.argv[4] || '2e6');
const src = `(async()=>{
  render=function(){};flyToDest=function(){};showToast=function(){};
  window._allAIMode=true;window._fastSpectator=true;window._l6Solver=false;window._l6SolverCap=${CAP};
  window._aiThinkBudget={L4:1,L5:1,hardIters:30,hardMs:1e9,expertIters:${ITERS},expertMs:1e9,alphaIters:${ITERS},alphaMs:1e9};
  await loadAIDNA(); await PRSim.loadNetwork('mcts_value_nn.json').catch(()=>{});
  let solves=0; const _se=PRSim.solveEndgame.bind(PRSim); PRSim.solveEndgame=(s,c)=>{const r=_se(s,c); if(r) solves++; return r;};
  const N=4;
  async function play(seed,l6seat,sb){window._l6SolverBuild=sb;__setSeed(seed);
    G=new Game(N,'AI');G.players.forEach((p,i)=>{p.isHuman=false;p._aiLevel=(i===l6seat)?6:5;});
    await runMainLoop();
    const t=G.players.map(p=>p.vp+p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0)+G.getSpecialVPs(p));
    const mx=Math.max(...t),tie=t.filter(x=>x===mx).length; return {win:t[l6seat]===mx?1/tie:0,vp:t[l6seat]};}
  let onW=0,offW=0,onV=0,offV=0,n=0,err=0,dsum=0,dsq=0;
  const Z=()=>{const m=dsum/n,v=(dsq-dsum*dsum/n)/Math.max(1,n-1),se=Math.sqrt(v/n);return{m,se,z:se>0?m/se:0};};
  for(let g=0;g<${PAIRS};g++){const seat=g%4,seed=(1234567+g*7919)>>>0;
    try{const a=await play(seed,seat,true),b=await play(seed,seat,false);
      const d=a.win-b.win;dsum+=d;dsq+=d*d;onW+=a.win;offW+=b.win;onV+=a.vp;offV+=b.vp;n++;}catch(e){err++;}
    if((g+1)%50===0){const z=Z();console.log('  '+(g+1)+'/'+${PAIRS}+'  diff '+(100*z.m).toFixed(1)+'±'+(100*z.se).toFixed(1)+'pp z='+z.z.toFixed(2)+' solves='+solves);}}
  const z=Z(); return {n,err,onW,offW,onV,offV,solves,diff:100*z.m,se:100*z.se,z:z.z};
})()`;
run(src).then(r => {
  console.log(`\n=== L6 build-solver real-game paired A/B (${r.n} pairs, iters=${ITERS}, cap=${CAP}, err=${r.err}) ===`);
  console.log(`  L6 seat win: ON ${(100*r.onW/r.n).toFixed(1)}%  OFF ${(100*r.offW/r.n).toFixed(1)}%`);
  console.log(`  paired diff: ${r.diff>=0?'+':''}${r.diff.toFixed(1)}pp ± ${r.se.toFixed(1)}pp  z=${r.z.toFixed(2)}  ${Math.abs(r.z)>=1.96?(r.z>0?'✅ significant':'negative!'):'not significant'}`);
  console.log(`  L6 mean VP : ON ${(r.onV/r.n).toFixed(2)}  OFF ${(r.offV/r.n).toFixed(2)}   build-solves ${r.solves} (${(r.solves/r.n).toFixed(2)}/game)`);
}).catch(e => { console.error(e && e.stack || e); process.exit(1); });
