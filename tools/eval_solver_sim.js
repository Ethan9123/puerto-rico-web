// ============================================================
// tools/eval_solver_sim.js — 终局精确求解器的 sim 层价值验证(配对)
// ============================================================
// 在做昂贵的 game.js 集成前, 先在 sim 层回答: 精确终局 maxⁿ 是否胜过启发式自己的终局play?
// 若 sim 层都不赢 → 真实游戏更不会赢(第九条负结果, 无需集成)。
//
// 设计(同种子配对):
//   - TEST: 座位 s 用「启发式 + 终局(magnitude≤阈值)切精确求解」, 其余座位纯启发式。
//   - CTRL: 四座位全纯启发式; 测 座位 s 胜率。
//   同一局号 g → 同种子牌序; 座位轮转。座位 s 在两配置下唯一差异 = 终局是否精确求解。
//
// 用法: node tools/eval_solver_sim.js [games=400] [magThresh=6.5] [cap=4e6] [seed=777]
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
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js','sim_az.js','sim_solve.js']) load(f);
const PRSim = sandbox.PRSim;

const GAMES = parseInt(process.argv[2] || '400');
const MAG = parseFloat(process.argv[3] || '6.5');
const CAP = parseFloat(process.argv[4] || "1.5e5");
const SEED0 = parseInt(process.argv[5] || '777');

// 一局: solverSeat = 用求解器的座位(-1=全启发式 CTRL)。返回各玩家终局分。
function playGame(seed, solverSeat) {
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const st = PRSim.newState(4, [5,5,5,5], rnd);
  let guard = 0, solves = 0;
  while (guard++ < 2000) {
    const dec = PRSim.azDecision(st);
    if (!dec) break;
    let action;
    if (solverSeat >= 0 && dec.chooser === solverSeat && dec.actions.length > 1 && st.endTriggered) {
      const sol = PRSim.solveEndgame(st, CAP);
      if (sol) { action = sol.action; solves++; }
      else action = PRSim.azHeuristicAction(st, dec); // 超预算回退启发式
    } else {
      action = PRSim.azHeuristicAction(st, dec);
    }
    PRSim.azApply(st, action);
  }
  return { scores: st.players.map(p => PRSim.finalScore(p)), solves };
}

(async () => {
  await PRSim.loadNetwork('mcts_value_nn.json').catch(() => {});
  let winTest = 0, winCtrl = 0, n = 0, totSolves = 0;
  const diffs = [];
  const t0 = Date.now();
  for (let g = 0; g < GAMES; g++) {
    const seat = g % 4;
    const baseSeed = (SEED0 + g * 7919) >>> 0;
    // 同种子: TEST 与 CTRL 用同一 baseSeed → 牌序一致
    const rt = playGame(baseSeed, seat);
    const rc = playGame(baseSeed, -1);
    const wt = rt.scores[seat] === Math.max(...rt.scores) ? 1 / rt.scores.filter(s => s === Math.max(...rt.scores)).length : 0;
    const wc = rc.scores[seat] === Math.max(...rc.scores) ? 1 / rc.scores.filter(s => s === Math.max(...rc.scores)).length : 0;
    winTest += wt; winCtrl += wc; diffs.push(wt - wc); totSolves += rt.solves; n++;
    if ((g + 1) % 100 === 0) console.log(`  ${g + 1}/${GAMES}  test=${(winTest/n*100).toFixed(1)}% ctrl=${(winCtrl/n*100).toFixed(1)}% solves/局=${(totSolves/n).toFixed(1)}  ${((Date.now()-t0)/1000).toFixed(0)}s`);
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const se = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1) / n);
  const z = se > 0 ? mean / se : 0;
  console.log(`\n=== 终局求解器 sim 层配对 (${n} 局, magThresh=${MAG}, cap=${CAP}) ===`);
  console.log(`  座位胜率: TEST(终局精确) ${(winTest/n*100).toFixed(1)}%   CTRL(纯启发式) ${(winCtrl/n*100).toFixed(1)}%`);
  console.log(`  配对差: ${(mean*100).toFixed(1)}pp ± ${(se*100).toFixed(1)}pp   z=${z.toFixed(2)}   平均求解次数/局=${(totSolves/n).toFixed(1)}`);
  console.log(`  [判定] ${Math.abs(z) < 1.96 ? '差异不显著 → 终局精确无增益(第九条负结果倾向)' : (z > 0 ? '✅ 终局精确显著更强 → 值得集成 game.js' : '精确更差(异常, 需查 maxⁿ 假设)')}`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
