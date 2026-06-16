// 验证扩展解耦：5 个独立模块任意组合 + 旧字符串向后兼容。
// A 部分: 构造各组合, 断言 mod 标志 + 建筑池 + 角色/节庆。
// B 部分: 关键组合跑 1 局全AI到终局, 确认不崩、终局计分可算。
// 用法: node tools/exp_decouple_test.js
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false, dataset:{},
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){}, getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console:{log:console.log,warn:()=>{},error:console.error}, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
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
  window._aiThinkBudget = { L4:20, L5:30, hardIters:10, hardMs:1e9, expertIters:20, expertMs:1e9, alphaIters:20, alphaMs:1e9 };
  await loadAIDNA(); await loadAlphaZeroNN();
  const has = (id) => BUILDINGS.some(b => b.id === id);
  const results = []; let fails = 0;
  const chk = (name, cond, detail) => { if (!cond) fails++; results.push((cond?'  OK  ':'FAIL  ')+name+(detail?'  '+detail:'')); };

  // ===== A. 构造 + 标志/池 断言 =====
  const mk = (m) => new Game(4, 't', m, false);
  // 1 基础(全关)
  { const g = mk({}); chk('none: 无扩展建筑', !has(24)&&!has(38)&&!has(46), '24='+has(24)+' 38='+has(38)+' 46='+has(46));
    chk('none: 含济贫院11', has(11)); chk('none: 无节庆', !g.moduleFestival); }
  // 2 仅新建筑
  { const g = mk({newBuildings:true}); chk('newB: 有24-37', has(24)&&has(37)); chk('newB: 无贵族38', !has(38)); chk('newB: 无Tibs46', !has(46)); chk('newB: expansion别名=true', g.expansion===true); }
  // 3 仅贵族(不带新建筑) — 核心解耦点
  { const g = mk({nobles:true}); chk('nobles-only: 有贵族38-45', has(38)&&has(45)); chk('nobles-only: 无新建筑24', !has(24)); chk('nobles-only: 贵族棋子初始化', g.noblesLeft===19&&g.noblesOnShip===1); chk('nobles-only: expansion别名=false(不轮抽)', g.expansion===false); chk('nobles-only: 含济贫院11(非Tibs)', has(11)); }
  // 4 仅Tibs建筑(不带贵族/节庆/海盗) — 核心
  { const g = mk({tibsBuildings:true}); chk('tibs-only: 有46-53', has(46)&&has(53)); chk('tibs-only: 济贫院11被排除', !has(11)); chk('tibs-only: 寄宿屋48在池', has(48)); chk('tibs-only: 无贵族38', !has(38)); chk('tibs-only: 无节庆', !g.moduleFestival); chk('tibs-only: 无第8角色', !g.roleCards.some(r=>r.name==='Buccaneer')); chk('tibs-only: BLD_BY_ID[11]仍在', !!BLD_BY_ID[11]); }
  // 5 仅节庆 — 核心
  { const g = mk({festival:true}); chk('festival-only: moduleFestival=true', g.moduleFestival===true); chk('festival-only: festival目标已生成', !!g.festival); chk('festival-only: 无扩展建筑', !has(24)&&!has(38)&&!has(46)); chk('festival-only: 含济贫院11', has(11)); }
  // 6 仅海盗 — 核心
  { const g = mk({buccaneer:true}); chk('bucc-only: 第8角色Buccaneer入卡', g.roleCards.some(r=>r.name==='Buccaneer')); chk('bucc-only: moduleBuccaneer=true', g.moduleBuccaneer===true); chk('bucc-only: 无Tibs建筑46', !has(46)); }
  // 7 贵族+新建筑(官方)
  { const g = mk({newBuildings:true,nobles:true}); chk('off: 24-37与38-45共存', has(24)&&has(38)); chk('off: 无Tibs', !has(46)); }
  // 8 Tibs建筑+贵族
  { const g = mk({tibsBuildings:true,nobles:true}); chk('tibs+nob: 38-45与46-53共存', has(38)&&has(46)); chk('tibs+nob: 济贫院排除', !has(11)); }
  // 10 全5开
  { const g = mk({newBuildings:true,nobles:true,tibsBuildings:true,festival:true,buccaneer:true}); chk('all5: 全建筑', has(24)&&has(38)&&has(46)); chk('all5: 节庆', g.moduleFestival); chk('all5: 海盗', g.roleCards.some(r=>r.name==='Buccaneer')); chk('all5: 济贫院排除', !has(11)); }

  // ===== A2. 向后兼容旧字符串 =====
  const flags = g => [g.modNewBuildings,g.modNobles,g.modTibsBuildings,g.modFestival,g.modBuccaneer].map(x=>x?1:0).join('');
  chk('compat "none"        ->00000', flags(new Game(4,'t','none',false))==='00000');
  chk('compat "newbuildings"->10000', flags(new Game(4,'t','newbuildings',false))==='10000');
  chk('compat "nobles"      ->11000', flags(new Game(4,'t','nobles',false))==='11000');
  chk('compat "tibs"+bucc   ->11111', flags(new Game(4,'t','tibs',true))==='11111');
  chk('compat "tibs"无bucc  ->11110', flags(new Game(4,'t','tibs',false))==='11110');

  // ===== B. 关键组合跑全AI整局 =====
  const runCombo = async (label, m) => {
    try {
      G = new Game(3, 'AI', m, !!m.buccaneer);
      G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p,i); p._aiLevel = (i%4)+1; }); // L1-L4 混
      await runMainLoop();
      if (!G.gameOver) { chk('RUN '+label, false, '未结束'); return; }
      const tot = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
      chk('RUN '+label+' 终局', tot.every(t=>Number.isFinite(t)), '分='+tot.join('/'));
    } catch(e) { chk('RUN '+label, false, 'CRASH '+(e&&e.message||e)); }
  };
  await runCombo('nobles-only', {nobles:true});
  await runCombo('tibs-only', {tibsBuildings:true});
  await runCombo('festival-only', {festival:true});
  await runCombo('buccaneer-only', {buccaneer:true});
  await runCombo('all5', {newBuildings:true,nobles:true,tibsBuildings:true,festival:true,buccaneer:true});
  await runCombo('compat-tibs-string', 'tibs');

  return { fails, results };
})()`;

vm.runInContext(src, sandbox).then(r => {
  console.log('\\n=== 扩展解耦测试 ===');
  r.results.forEach(l => console.log(l));
  console.log('\\n' + (r.fails===0 ? '✅ 全部通过' : '❌ '+r.fails+' 项失败'));
  process.exit(r.fails ? 1 : 0);
}).catch(e => { console.error('ERR', e && e.stack || e); process.exit(2); });
