// 诊断: AI 是否会买蔗糖厂(小2/大4)却不产蔗糖(死建筑/只为卡位)。
// 统计每局结束时: 拥有蔗糖厂的 AI 里, 有多少"蔗糖产能=0"(没有有人蔗糖田喂厂)。
// 用法: node tools/sugar_diag.js [games=30] [level=4]
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false, dataset:{},
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){}, getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console:{log:console.log,warn:()=>{},error:()=>{}}, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')), ok:true }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js']) load(f);

const GAMES = parseInt(process.argv[2] || '30');
const LVL = parseInt(process.argv[3] || '4');

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = { L4:40, L5:50, hardIters:20, hardMs:1e9, expertIters:50, expertMs:1e9, alphaIters:50, alphaMs:1e9 };
  await loadAIDNA(); await loadAlphaZeroNN();
  let ownMill = 0, ownMillProd0 = 0, games = 0;
  // 死厂(产能0)细分:
  let dead_noField = 0;     // (a) 一块蔗糖田都没有 → 纯投机买厂, 田没来
  let dead_unmannedField = 0; // (b) 有蔗糖田但田没上人 → 工人没分到糖链
  let dead_unmannedMill = 0;  // (c) 有【有人】蔗糖田但厂没上人 → 厂没分到工人
  let sumColonistsOnDead = 0, sumIdleColonistsOnDead = 0;
  for (let g = 0; g < ${GAMES}; g++) {
    G = new Game(4, 'AI');
    G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel = ${LVL}; });
    await runMainLoop(); if (!G.gameOver) continue; games++;
    for (const p of G.players) {
      const mills = p.buildings.filter(b => b.bid === 2 || b.bid === 4); // 小/大蔗糖厂
      if (!mills.length) continue;
      ownMill++;
      const sugarFields = p.plantations.filter(pl => pl.good === 'sugar');
      const mannedSugarFields = sugarFields.filter(pl => pl.manned).length;
      const sugarProd = G.productionCapacity(p, 'sugar');
      if (sugarProd !== 0) continue; // 只看死厂
      ownMillProd0++;
      // 在场总工人 & 闲置工人(没在田/厂上的)
      const totalMen = p.plantations.reduce((a,pl)=>a+(pl.manned?1:0),0) + p.buildings.reduce((a,b)=>a+(b.men||0),0);
      sumColonistsOnDead += (p.colonists || 0) + totalMen;
      sumIdleColonistsOnDead += (p.colonists || 0); // 圣胡安空地上的散工
      if (sugarFields.length === 0) dead_noField++;
      else if (mannedSugarFields === 0) dead_unmannedField++; // 有田但都没上人
      else dead_unmannedMill++; // 有有人田但厂空着
    }
  }
  return { games, ownMill, ownMillProd0, dead_noField, dead_unmannedField, dead_unmannedMill,
           avgColOnDead: ownMillProd0? (sumColonistsOnDead/ownMillProd0).toFixed(1):0,
           avgIdleColOnDead: ownMillProd0? (sumIdleColonistsOnDead/ownMillProd0).toFixed(1):0 };
})()`;

vm.runInContext(src, sandbox).then(r => {
  console.log('\\n=== 蔗糖厂诊断 (' + r.games + ' 局, L' + LVL + ', 4×同档) ===');
  console.log('  拥有蔗糖厂的 AI 人次: ' + r.ownMill);
  console.log('  其中【蔗糖产能=0】死厂: ' + r.ownMillProd0 + '  (' + (r.ownMill ? (r.ownMillProd0/r.ownMill*100).toFixed(0) : 0) + '%)');
  console.log('  死厂细分:');
  console.log('    (a) 一块蔗糖田都没有 (纯投机/田没来): ' + r.dead_noField);
  console.log('    (b) 有蔗糖田但田没上人 (工人没进糖链): ' + r.dead_unmannedField);
  console.log('    (c) 有有人蔗糖田但厂空着 (厂没分到工人): ' + r.dead_unmannedMill);
  console.log('  死厂局面平均: 总工人 ' + r.avgColOnDead + ', 其中圣胡安散工(闲置) ' + r.avgIdleColOnDead);
}).catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
