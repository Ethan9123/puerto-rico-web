// ============================================================
// tools/eval_az.js — 全决策 AlphaZero (azGumbelSearch) vs 对手 NPC 组合
// ============================================================
// 在因子化引擎里打 4 人局：AZ 玩家(座位轮换)所有决策用 azGumbelSearch(NN+搜索);
// 对手按 opp 模式做决策:
//   heuristic : 全部用 azHeuristicAction (≈ L4/L5 子决策 + 启发式选角色)
//   l5        : 选角色用 ismctsPickRoleIdx(role-ISMCTS), 子决策用 azHeuristicAction
//
// 用法: node tools/eval_az.js [games] [opp] [nn_path] [numsims]
//   node tools/eval_az.js 24 l5 mcts_value_az.json 64
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() {
  const el = { _c:[], innerHTML:'', style:{}, classList:{add(){},remove(){}}, value:'', checked:false,
    appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){},
    getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();}, dataset:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}} };
  return el;
}
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), addEventListener(){} },
  console, setTimeout, performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ ok:true, status:200, json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')) }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js','sim_az.js']) load(f);
const S = sandbox.PRSim;

const GAMES = parseInt(process.argv[2] || '24');
const OPP = process.argv[3] || 'l5';
const NN_PATH = process.argv[4] || 'mcts_value_az.json';
const NUMSIMS = parseInt(process.argv[5] || '64');
const L5_ITERS = 300, L5_MS = 1500;

(async () => {
  await S.azLoadNetwork(NN_PATH);
  console.log(`AZ(Gumbel sims=${NUMSIMS}) vs 3×${OPP} — ${GAMES} 局`);
  let azWins = 0, azScore = 0, oppScore = 0, played = 0;
  const t0 = Date.now();
  for (let g = 0; g < GAMES; g++) {
    const seat = g % 4;
    let s = (g * 2654435761) >>> 0;
    const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const st = S.newState(4, [5, 5, 5, 5], rng);
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 600) {
      const dec = S.azDecision(st);
      if (!dec) break;
      let action;
      if (dec.chooser === seat) {
        action = S.azGumbelSearch(st, { numSims: NUMSIMS, numConsidered: Math.min(16, dec.actions.length), rng }).action;
      } else if (OPP === 'l5' && dec.type === 'role') {
        const ri = S.ismctsPickRoleIdx(st, { maxIters: L5_ITERS, budgetMs: L5_MS });
        action = (ri != null && dec.actions.includes(ri)) ? ri : S.azHeuristicAction(st, dec);
      } else {
        action = S.azHeuristicAction(st, dec);
      }
      S.azApply(st, action);
    }
    if (!st.gameOver) continue;
    played++;
    const sc = st.players.map(p => S.finalScore(p));
    const best = Math.max(...sc);
    if (sc[seat] === best) azWins++;
    for (let i = 0; i < 4; i++) { if (i === seat) azScore += sc[i]; else oppScore += sc[i] / 3; }
    process.stdout.write(`\r  ${g+1}/${GAMES} az=${sc[seat]} avgOpp=${((sc.reduce((a,b)=>a+b,0)-sc[seat])/3).toFixed(1)} winrate=${(azWins/played*100).toFixed(0)}%`);
  }
  process.stdout.write('\n');
  console.log(`Played ${played}/${GAMES} in ${((Date.now()-t0)/1000).toFixed(0)}s`);
  console.log(`AZ winrate: ${(azWins/played*100).toFixed(1)}% (fair=25%)`);
  console.log(`Avg score: AZ=${(azScore/played).toFixed(1)} ${OPP}=${(oppScore/played).toFixed(1)}`);
  console.log(azWins/played >= 0.60 ? '\n[TARGET] AZ ≥ 60% 达成!' : azWins/played > 0.30 ? '\n[OK] AZ 强于对手, 继续迭代逼近 60%' : '\n[!] 需更多训练/搜索');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
