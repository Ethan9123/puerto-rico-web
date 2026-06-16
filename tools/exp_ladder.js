// 扩展模式下的 AI 天梯快测: 1 高 vs 3 低, 座位轮转, iter-bounded 可复现。
// 用法: node tools/exp_ladder.js [expansion=nobles] [games=40] [matchups=6,5;5,4;6,4]
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false, dataset:{},
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){}, getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
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

const EXP = process.argv[2] || 'nobles';
const GAMES = parseInt(process.argv[3] || '40');
const MATCHUPS = (process.argv[4] || '6,5;5,4;6,4').split(';').map(s => s.split(',').map(Number));
const NM = {1:'入门',2:'进化',3:'普通',4:'困难',5:'专家',6:'宗师'};

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:400, expertMs:1e9, alphaIters:400, alphaMs:1e9 };
  await loadAIDNA();
  const nnOk = await loadAlphaZeroNN();
  const N = 4;
  const out = [];
  for (const [hi, lo] of ${JSON.stringify(MATCHUPS)}) {
    let wins = 0, played = 0;
    for (let g = 0; g < ${GAMES}; g++) {
      const seat = g % N;
      const levels = [lo,lo,lo,lo]; levels[seat] = hi;
      G = new Game(N, 'AI', ${JSON.stringify(EXP)});
      G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel=levels[i]; });
      await runMainLoop();
      if (!G.gameOver) continue;
      played++;
      const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
      const best = Math.max(...totals);
      const wc = totals.filter(t => t === best).length;
      if (totals[seat] === best) wins += 1 / wc;
    }
    out.push({ hi, lo, played, wr: wins/played });
    console.log('  '+'${EXP}'+' 1×lvl'+hi+' vs 3×lvl'+lo+': '+(wins/played*100).toFixed(0)+'% ('+played+'局)');
  }
  return out;
})()`;
console.log('扩展='+EXP+'  每组 '+GAMES+' 局  (公平份额 25%)');
vm.runInContext(src, sandbox).then(rows => {
  console.log('\\n=== '+EXP+' 天梯 ===');
  for (const r of rows) console.log('  1×'+NM[r.hi]+' vs 3×'+NM[r.lo]+' : '+(r.wr*100).toFixed(1)+'%  '+(r.wr>0.40?'✅强势':r.wr>0.28?'△略优':'✗未拉开'));
}).catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
