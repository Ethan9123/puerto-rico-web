// 测量 1 专家(L5/ISMCTS) vs 3 困难(L4/level5Reactive) 的胜率，座位轮转。
// 用法: node tools/expert_vs_hard.js [games] [expertIters] [C] [eps]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){}}, value:'', checked:false,
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){},
  getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}},
  fetch: async f => ({ json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')), ok:true }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
load('ai_dna.js'); load('game.js'); load('sim.js');

const GAMES = parseInt(process.argv[2] || '40');
const ITERS = parseInt(process.argv[3] || '1500');
const C = parseFloat(process.argv[4] || '1.4');
const EPS = process.argv[5] !== undefined ? parseFloat(process.argv[5]) : null;

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true;
  window._fastSpectator = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:${ITERS}, expertMs:1e9 };
  ${C !== 1.4 ? `window._mctsC = ${C};` : ''}
  ${EPS !== null ? `window._mctsEps = ${EPS};` : ''}
  await loadAIDNA();
  const N = 4;
  let wins = 0, played = 0, expScore = 0, hardScore = 0;
  for (let g = 0; g < ${GAMES}; g++) {
    const seat = g % N;
    const levels = [4,4,4,4]; levels[seat] = 5; // 5=专家(MCTS), 4=困难
    G = new Game(N, 'AI');
    G.players.forEach((p,i)=>{ p.isHuman=false; p._aiLevel=levels[i]; });
    await runMainLoop();
    if (!G.gameOver) continue;
    played++;
    const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
    const best = Math.max(...totals);
    if (totals[seat] === best) wins++;
    for (let i=0;i<N;i++){ if(i===seat) expScore+=totals[i]; else hardScore+=totals[i]/(N-1); }
  }
  return { played, wins, winrate: wins/played, expAvg: expScore/played, hardAvg: hardScore/played };
})()`;

const t0 = Date.now();
vm.runInContext(src, sandbox).then(r => {
  console.log(`专家(ISMCTS ${ITERS}迭代, C=${C}${EPS!==null?`, eps=${EPS}`:''}) vs 3×困难 — ${r.played}局 / ${((Date.now()-t0)/1000).toFixed(0)}s`);
  console.log(`  专家胜率 ${(r.winrate*100).toFixed(0)}%   均分 专家=${r.expAvg.toFixed(1)} 困难=${r.hardAvg.toFixed(1)}`);
  console.log(r.winrate >= 0.90 ? '  ✅ 达到 90% 目标' : '  ⛔ 未达 90%');
}).catch(e => { console.error('ERROR', e); process.exit(1); });
