// 复用已训练的 mcts_value.json，在【等墙钟时间】下对比 价值制导MCTS vs 原版MCTS。
// 价值制导每次迭代更快(截断rollout) → 同样时间搜更多次，这才是实际对局中的公平比较。
// 用法: node tools/eval_value.js [budgetMs] [games] [truncate]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){}}, value:'', checked:false,
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){},
  getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), addEventListener(){} },
  console, setTimeout, performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','game.js'),'utf8'), sandbox, {filename:'game.js'});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sim.js'),'utf8'), sandbox, {filename:'sim.js'});
const S = sandbox.PRSim;
const W = JSON.parse(fs.readFileSync(path.join(__dirname,'..','mcts_value.json'),'utf8')).weights;

const BUDGET = parseInt(process.argv[2] || '250');
const GAMES = parseInt(process.argv[3] || '24');
const TRUNC = parseInt(process.argv[4] || '6');

function h2h(n, games, budgetMs, trunc) {
  let vWins=0, vScore=0, oScore=0, played=0;
  for (let g = 0; g < games; g++) {
    const seat = g % n;
    let st = S.newState(n, new Array(n).fill(5));
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 400) {
      const ch = S.currentChooser(st); if (ch < 0) break;
      const legal = S.legalRoleIdxs(st); if (!legal.length) break;
      const opts = (ch === seat)
        ? { budgetMs, maxIters: 1e9, valueW: W, truncate: trunc }  // 价值制导(等时间)
        : { budgetMs, maxIters: 1e9 };                             // 原版(等时间)
      S.applyRole(st, S.ismctsPickRoleIdx(st, opts));
    }
    if (!st.gameOver) continue;
    played++;
    const sc = st.players.map(S.finalScore); const best = Math.max(...sc);
    if (sc[seat] === best) vWins++;
    for (let i=0;i<n;i++){ if(i===seat) vScore+=sc[i]; else oScore+=sc[i]/(n-1); }
  }
  return { played, winrate:vWins/played, vAvg:vScore/played, oAvg:oScore/played };
}

console.log(`等墙钟时间对打：价值制导MCTS vs 3×原版MCTS — 每步 ${BUDGET}ms, ${GAMES} 局, truncate=${TRUNC}`);
const t0 = Date.now();
const r = h2h(4, GAMES, BUDGET, TRUNC);
console.log(`  胜率 ${(r.winrate*100).toFixed(0)}% (公平=25%) | 均分 价值制导=${r.vAvg.toFixed(1)} 原版=${r.oAvg.toFixed(1)} | ${((Date.now()-t0)/1000).toFixed(0)}s`);
console.log(r.winrate > 0.30 && r.vAvg > r.oAvg ? '\n等时间下价值制导更强 → 可作为 L5 升级' : '\n等时间下未明显更强');
