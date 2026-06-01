// ============================================================
// tests/factored_parity_test.js
// ============================================================
// 验证因子化启发式路径(azDecision/azApply/azHeuristicAction)与原始引擎
// (applyRole 自动解算 do*)逐局一致——同种子下终局分数必须完全相同。
// 这能抓住像 _bphase 缓存不清这类"因子化路径偏离原引擎"的回归。
// 另外断言 azGumbelSearch 对 5 人局(value 仅 4 维)显式拒绝。
'use strict';
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
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ ok:true, json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')) }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js','sim_az.js']) load(f);
const S = sandbox.PRSim;

const mkRng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };

// 原始引擎: applyRole 自动解算所有子决策(启发式选角色)
function playOriginal(np, seed) {
  const st = S.newState(np, new Array(np).fill(5), mkRng(seed));
  let guard = 0;
  while (!S.isTerminal(st) && guard++ < 600) {
    const ch = S.currentChooser(st); if (ch < 0) break;
    const legal = S.legalRoleIdxs(st); if (!legal.length) break;
    S.applyRole(st, S.heuristicPickRole(st, ch, legal));
  }
  return st.players.map(p => S.finalScore(p));
}
// 因子化路径: azPlayHeuristic(经 azDecision/azApply/azHeuristicAction)
function playFactored(np, seed) {
  const st = S.newState(np, new Array(np).fill(5), mkRng(seed));
  S.azPlayHeuristic(st);
  return st.players.map(p => S.finalScore(p));
}

const GAMES = parseInt(process.argv[2] || '40');
let pass = 0, fail = 0;
for (let g = 0; g < GAMES; g++) {
  const np = 3 + (g % 2); // 交替 3/4 人
  const seed = (g * 2654435761) >>> 0;
  const a = playOriginal(np, seed), b = playFactored(np, seed);
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  if (same) pass++; else { fail++; if (fail <= 5) console.log(`  MISMATCH g=${g} np=${np}: orig=[${a}] factored=[${b}]`); }
}
console.log(`factored==original: ${pass}/${GAMES} identical, ${fail} mismatch`);

// 5 人 guard
let guardOk = false;
try { S.azGumbelSearch(S.newState(5, [5,5,5,5,5], mkRng(1)), { numSims: 4 }); }
catch (e) { guardOk = /不支持|value/.test(e.message); }
console.log(`5-player azGumbelSearch guard: ${guardOk ? 'OK (rejected)' : 'FAIL (did not reject)'}`);

const ok = fail === 0 && guardOk;
console.log(ok ? '\n[OK] 因子化路径与原引擎逐局一致 + 5 人 guard 生效' : '\n[FAIL] 见上');
process.exit(ok ? 0 : 1);
