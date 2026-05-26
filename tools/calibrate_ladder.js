// 校准 5 级阶梯：混合局(入门/进化/普通/困难/专家)轮转座位，报告每档平均分与单调性。
// 困难/专家走真实引擎里的 ISMCTS（需 sim.js + 预算）。
// 用法: node tools/calibrate_ladder.js [games] [hardIters] [expertIters]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() {
  const el = { _c:[], innerHTML:'', textContent:'', style:{}, className:'', dataset:{},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false,
    appendChild(c){el._c.push(c);return c;}, removeChild(){}, remove(){}, addEventListener(){}, removeEventListener(){},
    setAttribute(){}, getAttribute(){return null;}, insertAdjacentHTML(){}, querySelector(){return null;},
    querySelectorAll(){return [];}, getBoundingClientRect(){return{left:0,top:0,width:0,height:0};}, cloneNode(){return makeEl();}, closest(){return null;}, focus(){}, click(){}, onclick:null };
  return el;
}
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
const HARD = parseInt(process.argv[3] || '60');
const EXPERT = parseInt(process.argv[4] || '200');

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:${HARD}, hardMs:1e9, expertIters:${EXPERT}, expertMs:1e9 };
  await loadAIDNA();
  const sums = {1:0,2:0,3:0,4:0,5:0}, cnts = {1:0,2:0,3:0,4:0,5:0};
  let bad = 0;
  for (let g = 0; g < ${GAMES}; g++) {
    const base = [1,2,3,4,5];
    const levels = base.map((_, i) => base[(i + g) % 5]); // 轮转座位
    G = new Game(5, 'AI');
    G.players.forEach((p,i)=>{ p.isHuman=false; p._aiLevel=levels[i]; });
    await runMainLoop();
    if (!G.gameOver) { bad++; continue; }
    const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
    for (let i=0;i<5;i++){ sums[levels[i]]+=totals[i]; cnts[levels[i]]++; }
  }
  const avg = {}; for (const l of [1,2,3,4,5]) avg[l] = sums[l]/cnts[l];
  return { avg, bad,
    mono: avg[1]<avg[2] && avg[2]<avg[3] && avg[3]<avg[4] && avg[4]<avg[5],
    gaps: [avg[2]-avg[1], avg[3]-avg[2], avg[4]-avg[3], avg[5]-avg[4]] };
})()`;

vm.runInContext(src, sandbox).then(r => {
  const nm = {1:'入门',2:'进化',3:'普通',4:'困难',5:'专家'};
  console.log(`阶梯校准 (5人混合 ${GAMES}局, 困难=${HARD}迭代, 专家=${EXPERT}迭代)`);
  console.log('  ' + [1,2,3,4,5].map(l=>`${nm[l]}=${r.avg[l].toFixed(1)}`).join('  <  '));
  console.log('  档间分差: ' + r.gaps.map(x=>x.toFixed(1)).join(', '));
  console.log('  单调递增: ' + r.mono + (r.bad?`  (未正常结束 ${r.bad} 局)`:''));
}).catch(e => { console.error('ERROR', e); process.exit(1); });
