// 验证 sim.js：① 自对弈守恒 + 终局（规则移植忠实）② ISMCTS 强于启发式
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){}}, value:'', checked:false,
  appendChild(){}, addEventListener(){}, querySelector(){return null;}, querySelectorAll(){return [];},
  insertAdjacentHTML(){}, getBoundingClientRect(){return{left:0,top:0,width:0,height:0};}, cloneNode(){return makeEl();} });
const _els = {};
const sandbox = {
  document: { getElementById: id => (_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), addEventListener(){} },
  console, setTimeout, performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','game.js'),'utf8'), sandbox, {filename:'game.js'});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sim.js'),'utf8'), sandbox, {filename:'sim.js'});

const S = sandbox.PRSim;
const GOODS = ["corn", "indigo", "sugar", "tobacco", "coffee"];
const expectedGoods = { corn:10, indigo:12, sugar:11, tobacco:9, coffee:8 };
const expectedCol = { 3:55, 4:75, 5:95 };

function selfPlay(n) {
  let st = S.newState(n, [5,5,5,5,5]);
  let guard = 0;
  while (!S.isTerminal(st) && guard++ < 400) {
    const ch = S.currentChooser(st);
    if (ch < 0) break;
    const legal = S.legalRoleIdxs(st);
    if (!legal.length) break;
    S.applyRole(st, S.heuristicPickRole(st, ch, legal));
  }
  return st;
}

// ---- ① 守恒 + 终局 ----
let probs = [];
for (const n of [3,4,5]) {
  for (let g = 0; g < 30; g++) {
    const st = selfPlay(n);
    const col = st.colonistsLeft + st.colonistsOnShip + st.players.reduce((s,p)=>s+S.totalColonists(p),0);
    if (col !== expectedCol[n]) probs.push(`col ${n}p=${col}`);
    for (const k of GOODS) {
      const gp = st.players.reduce((s,p)=>s+p.goods[k],0);
      const gs = st.ships.reduce((s,sh)=>s+(sh.good===k?sh.count:0),0);
      const gt = st.tradingHouse.filter(x=>x===k).length;
      if (st.supply[k]+gp+gs+gt !== expectedGoods[k]) probs.push(`goods ${n}p ${k}=${st.supply[k]+gp+gs+gt}`);
    }
    if (!st.gameOver) probs.push(`no-end ${n}p turn${st.turnNumber}`);
    st.players.forEach((p,i)=>{ if (S.finalScore(p) <= 0) probs.push(`vp<=0 p${i}`); });
  }
}
console.log('① 守恒/终局问题:', probs.length, probs.slice(0,10));

// ---- ② ISMCTS vs 启发式 ----
function game_with_ismcts(n, seat, budgetIters) {
  let st = S.newState(n, new Array(n).fill(5));
  let guard = 0;
  while (!S.isTerminal(st) && guard++ < 400) {
    const ch = S.currentChooser(st);
    if (ch < 0) break;
    const legal = S.legalRoleIdxs(st);
    if (!legal.length) break;
    let ri;
    if (ch === seat) ri = S.ismctsPickRoleIdx(st, { maxIters: budgetIters, budgetMs: 99999 });
    else ri = S.heuristicPickRole(st, ch, legal);
    S.applyRole(st, ri);
  }
  return st;
}

const N = 4, GAMES = parseInt(process.argv[2]||'24'), ITERS = parseInt(process.argv[3]||'300');
let mctsWins = 0, mctsScore = 0, heurScore = 0, played = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const seat = g % N;
  const st = game_with_ismcts(N, seat, ITERS);
  if (!st.gameOver) continue;
  played++;
  const scores = st.players.map(S.finalScore);
  const best = Math.max(...scores);
  if (scores[seat] === best) mctsWins++;
  for (let i = 0; i < N; i++) { if (i === seat) mctsScore += scores[i]; else heurScore += scores[i] / (N - 1); }
}
const secs = ((Date.now()-t0)/1000).toFixed(1);
console.log(`② ISMCTS(${ITERS} iters) vs 3×启发式L5 — ${played}局 / ${secs}s`);
console.log(`   胜率 ${(mctsWins/played*100).toFixed(0)}% (公平=${(100/N).toFixed(0)}%) | 均分 MCTS=${(mctsScore/played).toFixed(1)} 启发式=${(heurScore/played).toFixed(1)}`);
console.log((probs.length===0 && mctsWins/played > 1/N) ? '\nSIM OK: 守恒通过 且 ISMCTS 胜率高于公平线' : '\n需检查');
