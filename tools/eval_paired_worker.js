// ============================================================
// tools/eval_paired_worker.js — 同种子配对评测 worker
// ============================================================
// 每局输出一行 JSON {g, seed, seat, lo, win, hi, loAvg, totals} → 用 paired_report.js
// join 两个配置在相同 g 上的结果做配对统计。
//
// 用法: node tools/eval_paired_worker.js <nnPath|DEPLOY> <lo> <gStart> <gEnd> <out.jsonl> [seedBase=20260611]
//                                        [alphaC] [endBoost] [heurJson]
//
// ⚠ 关于「配对」的实测更正（AI_STRENGTH §18）：本工具只把**环境**的初始随机性（牌堆/总督）对齐。
//   旧模式下所有 AI 搜索与环境共用同一条带种子的 Math.random 流，任何一方的决策一变，
//   其后整局（含对手 L5 的搜索）全部分叉 —— 27 个历史臂与 vnet1-A 的胜负相关系数 ρ 只有 −0.11..+0.11，
//   配对 SE ≈ 独立 SE。历史 z 值作为独立样本检验仍然成立，但「480 局配对 ≈ 2000 局独立」不成立。
//
// EVAL_CRN=1（第三轮新增，run_arm.sh 默认开启）：真正的公共随机数。
//   环境继续用带种子的 Math.random；**每一个 AI 选角决策**改用自己的流
//   mulberry32(fnv1a(gameSeed | seat | level | 局面指纹 | 该局面出现次数))，决策结束后切回环境流。
//   → 两臂在第一次不同的决策之前逐位相同；干预很少改变决策时（如带置信门的子决策搜索），
//     不变的局整局相同、配对差恰为 0，方差真正下降。配对 SE 公式对任何 ρ 都有效。
//   审计（一局 1×L6+3×L5）：21.4 万次随机数调用全部发生在选角搜索内部，环境只有 63 次
//   （牌堆洗牌/弃牌重洗/DNA/总督/prDeviceId）→ 在 aiPickRoleAsync 一处切流即覆盖全部 AI 随机性。
//   CRN 模式改变了 L5/L6 的随机源 → 其结果与历史臂不可逐位比较（统计上等价），对照组必须重跑。
//
// 输出（新契约，两种模式都适用，已完成对局的行字节不变）：
//   <out>.tmp 逐局写 → fsync → rename 为 <out>；<out>.meta.jsonl 同理；最后写 <out>.done =
//   {"rows","gStart","gEnd","sha256"}。**每局恰好一行**：崩溃局写 {g,seed,seat,lo,error}，
//   未终局写 {g,seed,seat,lo,incomplete:true} —— 以前这两种情况都静默跳过，导致分片永远不满、
//   续跑器无限重跑。
//   侧车 <out>.meta.jsonl 每局一行：L6/L5 决策数、每次 L6 决策的迭代数、回退次数、耗时。
//   **盲化**：控制台只打印进度计数，不打印胜率（确认性评测期间不做中期窥视）。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine, createFakeWorkerClass } = require('./_sandbox.js');

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
const CRN = process.env.EVAL_CRN === '1';
// EVAL_RP_K=K（第三轮 Stage 2）：L6 走浏览器同一条 worker 池路径（PRAIPool → K 个 ai_worker.js，按角色名合并
// N/Q → selectRootRole），worker 用 tools/_sandbox.js 的 FakeWorker 在各自 vm 上下文里跑；3×L5 对手仍走同步路径
// （与 A 臂完全相同）。每个 ≥2 合法角色的 L6 决策都断言：本次池搜索成功、合并了 K 个回复、每个 worker 恰好
// alphaIters 次迭代——否则记入 meta.l6.rpBad（该臂无效）。
// 树并行（第三轮 Stage 3，AI_STRENGTH §18.2 补充 C）：再加 L6_KNOBS='{"_l6TreePar":true}' → L6 走同一个池的
// PRAIPool.pickRoleTreeParallel（主线程一棵树 + K 个 FakeWorker 做路径评估）。此时每个 ≥2 合法角色的 L6 决策断言：
// 本次池搜索成功、mode='alpha-tp'、K 个 worker 都有贡献、合计迭代 == K·alphaIters（每 worker 份额 alphaIters，与 RP4×N 同算力）、
// 未超时、无 worker 错误（出错 worker 的份额会被其余 worker 补跑，K/合计看起来仍满）——否则同样记入 meta.l6.rpBad（该臂无效）。
const RP_K = process.env.EVAL_RP_K ? parseInt(process.env.EVAL_RP_K) : 0;
// EVAL_HARVEST=<file.jsonl>（第三轮 Stage 2 诊断用）：每个 ≥2 合法角色的 L6 选角决策，把当时的
// buildSimState(G) 快照追加一行 {g, seat, k, st}。buildSimState 无副作用、不取随机数 → 对局逐字节不变。
const HARVEST = process.env.EVAL_HARVEST || null;

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
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
let _rng = Math.random;
let _envRng = null;           // CRN：环境流（决策期间暂存）
const MathSeeded = {};
for (const k of Object.getOwnPropertyNames(Math)) MathSeeded[k] = Math[k];
MathSeeded.random = () => _rng();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const TMP = OUT + '.tmp', META = OUT + '.meta.jsonl', META_TMP = META + '.tmp', DONE = OUT + '.done';
for (const f of [OUT, DONE, META]) { try { fs.unlinkSync(f); } catch (e) {} }
const _fd = fs.openSync(TMP, 'w');      // 逐局追加写；完成后原子 rename
const _mfd = fs.openSync(META_TMP, 'w');
const _hfd = HARVEST ? fs.openSync(HARVEST, 'w') : null;
let _rows = 0;
const { run } = loadEngine({
  files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js', 'sim_solve.js'],
  beforeLoad: sb => {
    sb.Math = MathSeeded;
    sb.__setSeed = s => { _rng = mulberry32(s >>> 0); };
    sb.__writeRow = json => { fs.writeSync(_fd, json + '\n'); _rows++; };
    sb.__writeMeta = json => { fs.writeSync(_mfd, json + '\n'); };
    sb.__harvest = json => { if (_hfd !== null) fs.writeSync(_hfd, json + '\n'); };
    // CRN：进入/离开一个 AI 决策时切换随机流（key 由沙盒内按局面指纹算好）
    sb.__aiStreamEnter = key => { _envRng = _rng; _rng = mulberry32((fnv1a(key) ^ 0x9E3779B9) >>> 0); };
    sb.__aiStreamExit = () => { if (_envRng) { _rng = _envRng; _envRng = null; } };
    sb.__fnv1a = fnv1a;
    sb.__progress = msg => console.log(msg);
    if (RP_K > 0) {
      sb.Worker = createFakeWorkerClass({ forceJS: true, mathSeed: SEED_BASE });
      sb.navigator.hardwareConcurrency = RP_K + 1;          // game.js: K = min(_aiWorkersK||8, cores−1)
      sb.location = Object.assign({}, sb.location, { href: 'http://localhost/', origin: 'http://localhost', host: 'localhost', hostname: 'localhost', protocol: 'http:' });
    }
  },
});
const L6_SOLVER = process.env.L6_SOLVER ? true : false; // 终局精确求解器开关(真实评测 A/B)
const L6_SOLVER_CAP = process.env.L6_SOLVER_CAP ? parseFloat(process.env.L6_SOLVER_CAP) : null;
// Phase 2：任意 window 旋钮以 JSON 注入(参数位置不变)，例如
//   L6_KNOBS='{"_l6ValueNet":true,"_l6LeafTruncate":0,"__MCTS_VALUE_VNET__":"mcts_value_vnet.json","_aiThinkBudget":{...,"alphaIters":2400}}'
// 注入在默认预算之后 → 可覆盖 _aiThinkBudget；_l6ValueNet 为真时断言价值网已加载(否则测量无意义)。
// ⚠ 覆盖 _aiThinkBudget 时必须给全 alphaMs/expertMs（浅合并；缺了会静默退回墙钟默认值 → 不确定）。
// 扩展模块（可选）：MODS='{"tibsBuildings":true,"nobles":true}' 开启后跑扩展局配对评测。
// 默认 {} = 基础局，与既有基线逐字节一致。
const MODS = process.env.MODS ? JSON.parse(process.env.MODS) : {};
const KNOBS = process.env.L6_KNOBS ? JSON.parse(process.env.L6_KNOBS) : null;
if (KNOBS && KNOBS._l6TreePar && !(RP_K > 0)) {
  // 没有 worker 池时 L6 走同步单树 → 「TP 臂」会静默等于 A 臂
  console.error('ERROR L6_KNOBS._l6TreePar 需要 EVAL_RP_K=K（树并行只存在于 worker 池路径）');
  process.exit(1);
}
if (KNOBS && KNOBS._aiThinkBudget) {
  const b = KNOBS._aiThinkBudget;
  if (!(b.alphaMs > 0 && b.expertMs > 0 && b.alphaIters > 0 && b.expertIters > 0)) {
    console.error('ERROR L6_KNOBS._aiThinkBudget 必须完整给出 alphaIters/alphaMs/expertIters/expertMs（否则静默退回墙钟默认、结果不确定）');
    process.exit(1);
  }
}

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
  ${KNOBS ? `Object.assign(window, ${JSON.stringify(KNOBS)});` : ''}
  ${CRN ? `
  // CRN 模式：存档/云同步与评测无关，且 prDeviceId 会从环境流取随机数 → 全部桩掉
  saveGame = function(){}; kvSync = function(){}; clearSave = function(){}; prDeviceId = function(){ return 'eval'; };` : ''}
  ${RP_K > 0 ? `
  window._aiWorkersK = ${RP_K}; window._aiPoolTimeoutMs = 900000;
  // 对手 L5 保持与 A 臂相同的同步路径；只有 L6 走池
  ismctsPickRoleAsync = async function (p, a, t) { return ismctsPickRole(p, a, t); };` : ''}
  await loadAIDNA();
  const nnOk = await loadAlphaZeroNN();
  if (!nnOk || !(PRSim.isLoaded && PRSim.isLoaded())) throw new Error('NN 未加载 → L6 会回退 L5, 测量无意义');
  ${KNOBS && (KNOBS._l6ValueNet || KNOBS._l6VnetBuild) ? `{ const vOk = await loadValueNetOnce(); if (!vOk || !(PRSim.valueNetLoaded && PRSim.valueNetLoaded())) throw new Error('价值网未加载(_l6ValueNet/_l6VnetBuild) → 会静默退回大网价值头, 测量无意义'); }` : ''}

  ${RP_K > 0 ? `
  { const ok = await PRAIPool.ensure(); const nn = ok && await PRAIPool.ensureNN();
    if (!nn || PRAIPool.K !== ${RP_K}) throw new Error('worker 池未就绪: ok=' + ok + ' nn=' + nn + ' K=' + PRAIPool.K + ' (要求 ${RP_K})'); }` : ''}
  // ---- 决策级记账（字节中性：只多一层函数调用 / 以 returnStats 取同一次搜索的统计）----
  let ctx = null;                 // 当前 AI 选角决策 {seat, lvl, iters, fb, warns}
  let gm = null;                  // 当前局的记账
  const _origIdx = PRSim.ismctsPickRoleIdx;
  PRSim.ismctsPickRoleIdx = function (st, opts) {
    // 同一次搜索：returnStats 只改变返回形状，不改变任何计算或随机数消耗（见 sim.js 末尾 selectRootRole）
    const r = _origIdx(st, Object.assign({}, opts, { returnStats: true }));
    if (ctx && r && typeof r === 'object') ctx.iters += (r.iters || 0);
    return (opts && opts.returnStats) ? r : (r && typeof r === 'object' ? r.idx : r);
  };
  // L6 决策期间进入这些函数 = 回退（L6 实际按 L5/启发式下了这一手）
  for (const fname of ['ismctsPickRole', 'level5Reactive', 'ismctsPickRoleAsync']) {
    const orig = globalThis[fname];
    globalThis[fname] = function () { if (ctx && ctx.lvl === 6) ctx.fb++; return orig.apply(this, arguments); };
  }
  const _origWarn = console.warn;
  console.warn = function () { if (ctx) ctx.warns++; return _origWarn.apply(this, arguments); };
  const _origPick = aiPickRoleAsync;
  let occ = null;                 // CRN：局面指纹出现次数（每局重置）
  let gameSeed = 0;
  aiPickRoleAsync = async function (p, available) {
    const lvl = p._aiLevel || 3;
    const my = { seat: p.idx, lvl, iters: 0, fb: 0, warns: 0 };
    const r0 = PRAIPool._reqId;
    const prev = ctx; ctx = my;
    const t0 = Date.now();
    ${HARVEST ? `
    if (lvl === 6 && gm && available.length >= 2) { gm.hk = (gm.hk || 0) + 1; __harvest(JSON.stringify({ g: gm.g, seat: p.idx, k: gm.hk - 1, st: buildSimState(G) })); }` : ''}
    ${CRN ? `
    const fp = JSON.stringify(buildSimState(G));           // rnd 是函数 → JSON 自动丢弃；纯快照、零副作用
    const base = gameSeed + '|' + p.idx + '|' + lvl + '|' + __fnv1a(fp);
    const n = (occ.get(base) || 0); occ.set(base, n + 1);
    __aiStreamEnter(base + '|' + n);` : ''}
    try { return await _origPick(p, available); }
    finally {
      ${CRN ? `__aiStreamExit();` : ''}
      ctx = prev;
      ${RP_K > 0 ? `
      if (lvl === 6 && gm) {
        const s = PRAIPool.lastStats, want = (window._aiThinkBudget || {}).alphaIters;
        if (s && s.reqId > r0) my.iters = (s.perWorker || []).reduce((a, b) => a + b, 0);
        if (available.length >= 2) {
          let bad = null;
          const tp = !!window._l6TreePar;
          if (!s || !(s.reqId > r0)) bad = 'no-pool-call';
          else if (!s.ok) bad = 'pool-failed';
          else if (s.mode !== (tp ? 'alpha-tp' : 'alpha')) bad = 'mode-' + s.mode;
          else if (s.K !== ${RP_K}) bad = 'K=' + s.K;
          // RP：每个 worker 恰好 alphaIters；TP：份额动态分配（谁先回谁先补），只要求合计 == K·alphaIters 且未超时
          else if (!tp && !s.perWorker.every(x => x === want)) bad = 'iters=' + s.perWorker.join('/');
          else if (tp && (s.iters !== ${RP_K} * want || s.perWorker.reduce((a, b) => a + b, 0) !== s.iters)) bad = 'tp-iters=' + s.iters + '[' + s.perWorker.join('/') + ']';
          else if (tp && (s.timedOut || s.mismatch)) bad = 'tp-' + (s.timedOut ? 'timeout' : 'mismatch=' + s.mismatch);
          // 中途有 worker 出错：其份额被别的 worker 补跑，K 与合计迭代都仍「满」→ 必须单独判（审查意见 4）
          else if (tp && s.errors && s.errors.length) bad = 'tp-errors=' + s.errors.length;
          if (bad) { gm.l6.rpBad = (gm.l6.rpBad || 0) + 1; (gm.l6.rpWhy = gm.l6.rpWhy || []).push(bad); }
        }
      }` : ''}
      if (gm) {
        const k = lvl === 6 ? 'l6' : 'lo';
        gm[k].n++; gm[k].iters.push(my.iters); gm[k].fb += my.fb; gm[k].warns += my.warns; gm[k].ms += Date.now() - t0;
      }
    }
  };

  const N = 4;
  let done = 0;
  for (let g = ${G_START}; g < ${G_END}; g++) {
    const seed = (${SEED_BASE} + g * 1000003) >>> 0;
    const seat = g % N;
    gameSeed = seed; occ = new Map();
    gm = { g, l6: { n: 0, iters: [], fb: 0, warns: 0, ms: 0 }, lo: { n: 0, iters: [], fb: 0, warns: 0, ms: 0 }, extra: {} };
    window.__evalGameMeta = gm.extra;          // 其他代码（如子决策搜索）可往这里记账
    const tg = Date.now();
    let row;
    try {
      __setSeed(seed);
      const levels = [${LO},${LO},${LO},${LO}]; levels[seat] = 6;
      G = new Game(N, 'AI', ${JSON.stringify(MODS)});
      G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel=levels[i]; });
      await runMainLoop();
      if (!G.gameOver) row = { g, seed, seat, lo: ${LO}, incomplete: true };
      else {
        const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
        const best = Math.max(...totals);
        const winnerCount = totals.filter(t => t === best).length;
        const win = totals[seat] === best ? 1 / winnerCount : 0;
        let loSum = 0; for (let i=0;i<N;i++) if (i!==seat) loSum += totals[i];
        row = { g, seed, seat, lo: ${LO}, win, hi: totals[seat], loAvg: Math.round(loSum/(N-1)*100)/100, totals };
      }
    } catch (e) {
      row = { g, seed, seat, lo: ${LO}, error: String((e && e.message) || e).slice(0, 300) };
    }
    __writeRow(JSON.stringify(row));
    gm.ms = Date.now() - tg; gm.crn = ${CRN ? 'true' : 'false'}; gm.rpK = ${RP_K};
    if (window._l6TreePar && ${RP_K} > 0) gm.tp = true;     // 仅 TP 臂才写 → 其它臂的 meta 行形状不变
    __writeMeta(JSON.stringify(gm));
    done++;
    if (done % 5 === 0) __progress('[progress] ' + done + '/' + (${G_END} - ${G_START}) + ' games');
  }
  return done;
})()`;

const t0 = Date.now();
run(src).then(played => {
  fs.fsyncSync(_fd); fs.closeSync(_fd);
  fs.fsyncSync(_mfd); fs.closeSync(_mfd);
  if (_hfd !== null) { fs.fsyncSync(_hfd); fs.closeSync(_hfd); }
  fs.renameSync(META_TMP, META);
  fs.renameSync(TMP, OUT);
  const buf = fs.readFileSync(OUT);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(DONE, JSON.stringify({ rows: _rows, gStart: G_START, gEnd: G_END, sha256 }) + '\n');
  console.log(`[worker] nn=${NN_ARG} lo=${LO} crn=${CRN ? 1 : 0} rpK=${RP_K} g=[${G_START},${G_END}) rows=${_rows} ${(((Date.now()-t0))/1000).toFixed(0)}s -> ${OUT}`);
}).catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
