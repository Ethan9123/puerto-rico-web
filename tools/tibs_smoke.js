// 冒烟测试: 跑一局 4 人 Tibs 扩展全 AI 局, 确认不崩 + Tibs 建筑进市场可建。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:30, hardMs:1e9, expertIters:60, expertMs:1e9, alphaIters:60, alphaMs:1e9 };
  await loadAIDNA();
  let crashes = [];
  const N = 4;
  for (let g = 0; g < 3; g++) {
    try {
      G = new Game(N, 'AI', 'tibs'); // Tibs 扩展
      // 确认 Tibs 建筑(46-53)在 BUILDINGS 里
      const tibsInMarket = [46,47,48,49,50,51,52,53].filter(id => BUILDINGS.some(b => b.id === id));
      G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel = (i===0?6:4); });
      await runMainLoop();
      if (!G.gameOver) { crashes.push('game '+g+' 未结束'); continue; }
      const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
      // 统计本局建过的 Tibs 建筑
      const builtTibs = new Set();
      for (const p of G.players) for (const b of p.buildings) if (b.bid >= 46) builtTibs.add(b.bid);
      console.log('game '+g+': OK 结束, 分数='+totals.map(t=>Math.round(t)).join('/')+'  Tibs在市场='+tibsInMarket.length+'/8  本局建过Tibs='+[...builtTibs].sort((a,b)=>a-b).join(','));
    } catch (e) { crashes.push('game '+g+': '+(e && e.stack || e)); }
  }
  return crashes;
})()`;

vm.runInContext(src, sandbox).then(crashes => {
  if (crashes.length) { console.error('\n❌ 崩溃/异常:\n' + crashes.join('\n')); process.exit(1); }
  console.log('\n✅ 3 局 Tibs 扩展全 AI 局全部正常完成, 无崩溃。');
}).catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
