// ============================================================
// tools/eval_paired_worker.js — 同种子配对评测 worker
// ============================================================
// 动机: 200 局独立评测在 35% 胜率附近的 CI 约 ±6.6%, 而我们要测 3-5pp 的差异。
// 复式赛制(duplicate): 把 Math.random 换成按局重置种子的 PRNG → 波多黎各唯一的
// 环境随机性(种植园牌堆洗牌/governor)在 A/B 两个模型间完全一致, 配对差分
// 把方差里"牌运"那一大块直接消掉。
//
// 每局输出一行 JSON {g, seed, seat, lo, win, hi, loAvg} → 用 paired_report.js
// join 两个配置在相同 g 上的结果做配对统计。
//
// 用法: node tools/eval_paired_worker.js <nnPath|DEPLOY> <lo> <gStart> <gEnd> <out.jsonl> [seedBase=20260611]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NN_ARG = process.argv[2] || 'DEPLOY';
const LO = parseInt(process.argv[3] || '5');
const G_START = parseInt(process.argv[4] || '0');
const G_END = parseInt(process.argv[5] || '40');
const OUT = process.argv[6] || `data/paired/worker-${G_START}-${G_END}.jsonl`;
const SEED_BASE = parseInt(process.argv[7] || '20260611');
const ALPHA_C = process.argv[8] ? parseFloat(process.argv[8]) : null; // L6 PUCT 常数覆盖(调参)
const END_BOOST = process.argv[9] ? parseFloat(process.argv[9]) : null; // L6 终局增压倍率(调参)
const HEUR_JSON = process.argv[10] || null; // L6 私有启发式参数 JSON 文件路径(调参)
const HEUR_OBJ = HEUR_JSON ? JSON.parse(fs.readFileSync(HEUR_JSON, 'utf8')) : null;
const NN_OVERRIDE = NN_ARG === 'DEPLOY' ? null : NN_ARG;

// ---- 可设种子的 Math 包装(必须在 game.js 加载前注入, 让 `rnd: Math.random`
//      这类引用捕获拿到的是稳定的 wrapper) ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _rng = Math.random;
const MathSeeded = {};
for (const k of Object.getOwnPropertyNames(Math)) MathSeeded[k] = Math[k];
MathSeeded.random = () => _rng();

const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false, dataset:{},
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){},
  getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const _fd = fs.openSync(OUT, 'w'); // 逐局追加写(崩溃不丢已完成对局)
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math: MathSeeded, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')), ok:true }),
  __setSeed: s => { _rng = mulberry32(s >>> 0); },
  __writeRow: json => { fs.writeSync(_fd, json + '\n'); },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js','sim_az.js','sim_solve.js']) load(f);
const L6_SOLVER = process.env.L6_SOLVER ? true : false; // 终局精确求解器开关(真实评测 A/B)
const L6_SOLVER_CAP = process.env.L6_SOLVER_CAP ? parseFloat(process.env.L6_SOLVER_CAP) : null;

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  // 方法学对齐 tier_winrate_top.js: iter-bounded, ms=1e9 → 给定种子完全确定
  window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:400, expertMs:1e9, alphaIters:400, alphaMs:1e9 };
  ${NN_OVERRIDE ? `window.__MCTS_VALUE_NN__ = ${JSON.stringify(NN_OVERRIDE)};` : ''}
  ${ALPHA_C != null ? `window._alphaC = ${ALPHA_C};` : ''}
  ${END_BOOST != null ? `window._alphaEndBoost = ${END_BOOST};` : ''}
  ${HEUR_OBJ ? `window._l6Heur = ${JSON.stringify(HEUR_OBJ)};` : ''}
  ${L6_SOLVER ? `window._l6Solver = true;` : ''}
  ${L6_SOLVER_CAP != null ? `window._l6SolverCap = ${L6_SOLVER_CAP};` : ''}
  await loadAIDNA();
  const nnOk = await loadAlphaZeroNN();
  if (!nnOk || !(PRSim.isLoaded && PRSim.isLoaded())) throw new Error('NN 未加载 → L6 会回退 L5, 测量无意义');
  const N = 4;
  const rows = [];
  for (let g = ${G_START}; g < ${G_END}; g++) {
    const seed = (${SEED_BASE} + g * 1000003) >>> 0;
    __setSeed(seed);
    const seat = g % N;
    const levels = [${LO},${LO},${LO},${LO}]; levels[seat] = 6;
    G = new Game(N, 'AI');
    G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel=levels[i]; });
    await runMainLoop();
    if (!G.gameOver) continue;
    const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
    const best = Math.max(...totals);
    const winnerCount = totals.filter(t => t === best).length;
    const win = totals[seat] === best ? 1 / winnerCount : 0;
    let loSum = 0; for (let i=0;i<N;i++) if (i!==seat) loSum += totals[i];
    const row = { g, seed, seat, lo: ${LO}, win, hi: totals[seat], loAvg: Math.round(loSum/(N-1)*100)/100, totals };
    __writeRow(JSON.stringify(row));
    rows.push(win);
    if (rows.length % 10 === 0) console.log('[progress] ' + rows.length + '/' + (${G_END} - ${G_START}) + ' games, win=' + (rows.reduce((s,w)=>s+w,0) / rows.length * 100).toFixed(1) + '%');
  }
  return rows;
})()`;

const t0 = Date.now();
vm.runInContext(src, sandbox).then(rows => {
  fs.closeSync(_fd);
  const w = rows.reduce((s, r) => s + r, 0);
  console.log(`[worker] nn=${NN_ARG} lo=${LO} g=[${G_START},${G_END}) played=${rows.length} win=${(w / rows.length * 100).toFixed(1)}% ${(((Date.now()-t0))/1000).toFixed(0)}s -> ${OUT}`);
}).catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
