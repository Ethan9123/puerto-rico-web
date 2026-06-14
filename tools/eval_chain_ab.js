// 同种子配对 A/B: 测"产业链完成奖励"(aiReallocate CHAIN_DONE)是否提升/损害棋力。
// 每个种子玩两遍同环境: 测试席 chainDone=5(NEW) vs =0(OLD), 其余 3 席固定 chainDone=0。
// 仅测试席策略不同 → 配对差分消掉牌运方差。输出 NEW/OLD 胜率差 + 配对符号检验。
// 用法: node tools/eval_chain_ab.js [games=120] [level=4] [seedBase=20260611]
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
let _rng = Math.random;
const MathSeeded = {}; for (const k of Object.getOwnPropertyNames(Math)) MathSeeded[k] = Math[k]; MathSeeded.random = () => _rng();
const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false, dataset:{},
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){}, getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console:{log:console.log,warn:()=>{},error:()=>{}}, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math:MathSeeded, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')), ok:true }),
  __setSeed: s => { _rng = mulberry32(s >>> 0); },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js']) load(f);

const GAMES = parseInt(process.argv[2] || '120');
const LVL = parseInt(process.argv[3] || '4');
const SEED_BASE = parseInt(process.argv[4] || '20260611');
const CD = process.argv[5] != null ? parseInt(process.argv[5]) : 5; // 测试席的 CHAIN_DONE 值(扫参)

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:400, expertMs:1e9, alphaIters:400, alphaMs:1e9 };
  await loadAIDNA(); await loadAlphaZeroNN();
  const N = 4;
  const scoreOf = p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p);
  // 一遍: 测试席 chainDone=testVal, 其余=0; 返回测试席 win(平分按 1/并列)
  const playOnce = (seed, seat, testOn) => {
    __setSeed(seed >>> 0);
    G = new Game(N, 'AI');
    // 测试席: testOn → 两处新行为(完成奖励5 + 投机买厂罚); 其余席与对照席全 OLD(0/关)
    G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel=${LVL};
      const on = (i===seat && testOn);
      p._chainDone = on ? ${CD} : 0;
      p._specBuyPen = on ? 1 : 0;
    });
    return runMainLoop().then(()=>{
      if (!G.gameOver) return null;
      const tot = G.players.map(scoreOf); const best = Math.max(...tot);
      const wc = tot.filter(t=>t===best).length;
      return { win: tot[seat]===best ? 1/wc : 0, hi: tot[seat], best };
    });
  };
  let newWin=0, oldWin=0, played=0, newBetter=0, oldBetter=0, newHiSum=0, oldHiSum=0;
  for (let g=0; g<${GAMES}; g++) {
    const seed = (${SEED_BASE} + g*1000003) >>> 0;
    const seat = g % N;
    const rNew = await playOnce(seed, seat, true);  // NEW: 完成奖励 + 投机买厂罚
    const rOld = await playOnce(seed, seat, false); // OLD: 两者皆关
    if (!rNew || !rOld) continue;
    played++; newWin += rNew.win; oldWin += rOld.win; newHiSum += rNew.hi; oldHiSum += rOld.hi;
    if (rNew.win > rOld.win) newBetter++; else if (rOld.win > rNew.win) oldBetter++;
    if (played % 20 === 0) console.log('[progress] '+played+'/'+${GAMES}+' NEW='+(newWin/played*100).toFixed(1)+'% OLD='+(oldWin/played*100).toFixed(1)+'%');
  }
  return { played, newWin, oldWin, newBetter, oldBetter, newHiSum, oldHiSum };
})()`;

vm.runInContext(src, sandbox).then(r => {
  const nW = r.newWin/r.played*100, oW = r.oldWin/r.played*100;
  // 配对差分 SE: 用胜率差的二项近似(粗略)
  const diff = nW - oW;
  console.log('\\n=== 蔗糖厂修复 A/B (' + r.played + ' 配对局, L' + LVL + ', 测试席 vs 3×OLD) ===');
  console.log('  NEW(完成奖励' + CD + '+投机买厂罚) 胜率: ' + nW.toFixed(1) + '%   平均分 ' + (r.newHiSum/r.played).toFixed(2));
  console.log('  OLD(两者皆关)            胜率: ' + oW.toFixed(1) + '%   平均分 ' + (r.oldHiSum/r.played).toFixed(2));
  console.log('  胜率差(NEW-OLD): ' + (diff>=0?'+':'') + diff.toFixed(1) + 'pp');
  console.log('  配对局: NEW更优 ' + r.newBetter + ' 局 / OLD更优 ' + r.oldBetter + ' 局 (其余持平)');
  const n = r.newBetter + r.oldBetter;
  if (n > 0) { const z = (r.newBetter - n/2)/Math.sqrt(n/4); console.log('  符号检验 z = ' + z.toFixed(2) + (Math.abs(z)>1.96?'  (显著)':'  (不显著)')); }
}).catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
