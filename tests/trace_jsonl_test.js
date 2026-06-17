// 验证 trace.js 的 gameToTrainingLines() 产出与训练管线对齐：
//   - 每行解析为 {f,a,v,vv,n}
//   - f 长度 == FEATURE_DIM_RICH(446)，全部 finite
//   - a ∈ [0,7)，等于 roleNameToPolicyIdx(chosen)
//   - vv 长度 4，n == numPlayers
//   - value 口径与 selfplay_dump 一致（margin / rank / vsbest）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() {
  const el = { _c:[], innerHTML:'', textContent:'', style:{}, className:'', dataset:{},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false,
    appendChild(c){this._c.push(c);return c;}, removeChild(){}, remove(){}, addEventListener(){}, removeEventListener(){},
    setAttribute(){}, getAttribute(){return null;}, insertAdjacentHTML(){}, querySelector(){return null;},
    querySelectorAll(){return [];}, getBoundingClientRect(){return{left:0,top:0,width:0,height:0};}, cloneNode(){return makeEl();}, closest(){return null;}, focus(){}, click(){}, onclick:null };
  return el;
}
const _els = {};
let _ls = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  localStorage:{ getItem:k=>(k in _ls?_ls[k]:null), setItem:(k,v)=>{_ls[k]=String(v);}, removeItem:k=>{delete _ls[k];} },
  location:{ search:'' }, URLSearchParams,
  console, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')), ok:true }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
load('ai_dna.js');
load('game.js');
load('sim.js');
load('sim_features.js');
load('trace.js');

const PRSim = sandbox.PRSim;
const PRTrace = sandbox.PRTrace;
const { FEATURE_DIM_RICH } = PRSim;

let fail = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); fail++; } };

assert(typeof PRTrace.gameToTrainingLines === 'function', 'PRTrace.gameToTrainingLines exported');

// 构造一局：用真实 sim 状态当快照，4 名玩家，人类座位 = 当前选角色者
const st = PRSim.newState(4, [5, 5, 5, 5]);
const seat = PRSim.currentChooser(st);
assert(seat >= 0 && seat < 4, 'currentChooser in range');

const scoresBySeat = [40, 30, 25, 20];
const game = {
  numPlayers: 4, humanSeat: seat, ts: Date.now(),
  decisions: [
    { turn: 1, seat, chosen: 'Mayor', state: st },
    { turn: 1, seat, chosen: 'Captain', state: st },
  ],
  result: {
    turns: 15, humanWon: true, winnerSeat: seat,
    // 按名次排序的 [{seat,total}]（finish 实际就这么传）
    scores: [0,1,2,3].map(i => ({ seat: i, total: scoresBySeat[i] }))
                     .sort((a,b)=>b.total-a.total),
  },
};

const lines = PRTrace.gameToTrainingLines(game, { valueMode: 'margin' });
assert(lines.length === 2, `expected 2 lines, got ${lines.length}`);

// margin 口径：v = (我分 - 对手平均) / 50
function marginExpect(idx) {
  let opp = 0; for (let i = 0; i < 4; i++) if (i !== idx) opp += scoresBySeat[i];
  return Math.max(-1, Math.min(1, (scoresBySeat[idx] - opp / 3) / 50));
}
const r4 = x => Math.round(x * 10000) / 10000;

for (let li = 0; li < lines.length; li++) {
  let d; try { d = JSON.parse(lines[li]); } catch (e) { assert(false, `line ${li} JSON parse`); continue; }
  assert(Array.isArray(d.f) && d.f.length === FEATURE_DIM_RICH, `line ${li}: f len == ${FEATURE_DIM_RICH} (got ${d.f && d.f.length})`);
  assert(d.f.every(x => isFinite(x)), `line ${li}: all f finite`);
  assert(Number.isInteger(d.a) && d.a >= 0 && d.a < 7, `line ${li}: a in [0,7) (got ${d.a})`);
  assert(Array.isArray(d.vv) && d.vv.length === 4, `line ${li}: vv len 4`);
  assert(d.n === 4, `line ${li}: n == 4`);
  assert(r4(d.v) === r4(marginExpect(seat)), `line ${li}: v matches margin formula (got ${d.v}, want ${r4(marginExpect(seat))})`);
  assert(r4(d.vv[0]) === r4(d.v), `line ${li}: vv[0] == v`);
}

// 动作 = 所选角色的 policy idx
assert(JSON.parse(lines[0]).a === PRSim.roleNameToPolicyIdx('Mayor'), 'line0 a == idx(Mayor)');
assert(JSON.parse(lines[1]).a === PRSim.roleNameToPolicyIdx('Captain'), 'line1 a == idx(Captain)');

// rank 口径独立可用（不抛错且范围合法）
const rankLines = PRTrace.gameToTrainingLines(game, { valueMode: 'rank' });
assert(rankLines.length === 2, 'rank mode produces lines');
for (const l of rankLines) { const v = JSON.parse(l).v; assert(v >= -1 && v <= 1, `rank v in [-1,1] (got ${v})`); }

console.log(fail === 0 ? `OK: trace_jsonl_test passed (${lines.length} samples checked, dim=${FEATURE_DIM_RICH})` : `FAILURES: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
