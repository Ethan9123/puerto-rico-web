// tests/tp_test.js — L6 树并行（TP，第三轮 Stage 3；固定设计见 AI_STRENGTH §18.2 补充 C）
//
// FakeWorker（tools/_sandbox.js）在各自 vm 上下文里跑真实的 ai_worker.js，主线程跑真实的 PRAIPool.pickRoleTreeParallel。
//   ① K=1、B=1、无虚拟损失：根统计 {nm,N,Q}（精确 double）与选角 == 直接 ismctsPickRoleIdx(clone, rnd=mulberry32(seed),
//      searchOptsForMode('alpha', 同一 opts))，≥20 个局面：4 人中盘、终局前夕（路径撞终局 → 截断）、5 人局两张 Prospector
//      且钱数不同（首个同名下标的映射必须对）、2/3 人局、截断叶（NN 标量叶，逐座位）、rolloutFrac>0（叶内取随机数）、
//      价值网向量叶（_l6ValueNet）。同时核对每个局面都出现了无先验请求（worker 算先验）且终局局面确实发生了截断。
//   ② K=4、B=2（默认虚拟损失）：总迭代 == 4·maxIters 恰好、每个 worker 都有贡献、Σ根子节点 N == 迭代数、无残留虚拟损失、
//      FakeWorker（FIFO 微任务）下两次重跑逐位相同。
//   ③ 过期回复被丢弃：把上一次决策的一条真实 tpresult 在下一次决策的在途窗口里重新投递 → 结果与干净重跑逐位相同。
//   ④ 超时：让 worker 3 吞掉一条批次（永不回复）→ 返回部分统计 ok:true、timedOut、iters == Σ perWorker == Σ根 N ==
//      目标 − 被吞的路径数；随后该 worker 仍可用于下一次决策。
//      其中 3p-midtrunc（maxIters=400、C=0.5、截断叶 2）让树长得够深，某些确定化在路径**中途**（末端节点之前）撞终局
//      → 只回传前缀；断言该局面 midTrunc>0（与「无先验末端节点本身即终局」分开计，后者不涉及前缀）。
//   ⑤ 真实入口：window._l6TreePar=true 时 aiPickRoleAsync 的 L6 走 TP，决策日志 path='pool'、mode='alpha-tp'、fallback=false。
//   ⑥ 虚拟损失语义（§18.2 补充 C）：K=4、B=2 时记下 FakeWorker 的真实收发序列（tppaths 发出 / tpresult 到达），用本文件里
//      按补充 C 文字**独立重写**的参照树（选择 + 虚拟损失 + 首个先验为准 + 回传）逐事件回放：每条请求的 {path, pless, N}
//      与最终根统计都必须逐位相同。钉住：父侧 N 含 vl、q 的分母含 vl、「N==0 且无在途访问」才算扩展。
//   ⑦ 中途 worker 出错：worker 2 对本次决策的第 3 条批次回 error → 其份额由其余 worker 补跑（iters == 目标），
//      lastStats.errors 记 1 条，决策日志（logAiDecision）记 errors=1、iters/target —— 与干净决策可区分。
// 反向验证（TP_TEST_REVERSE=…，用 _sandbox 的 transform 钩子在内存里把一行改坏；仓库文件不动）：
//   firstidx → worker 的 sim.js 把角色名映射到**最后一个**同名合法下标              → ① 红（5 人局）
//   chooser  → 主线程回传时 Q 统一加根选择者的叶值（而非各步选择者）                 → ① 红
//   stale    → 主线程去掉 TP 回复的 id 核对（过期回复被当成在途批次的回复）         → ③ 红
//   vlrelease→ 主线程回复到达时不撤销虚拟损失                                       → ② 红（残留 vl）
//   prefix   → 主线程回传时忽略 worker 报告的到达深度（整条路径都回传）              → ① 红（3p-midtrunc）
//   noparentvl → PUCT 的父侧 N 不含在途虚拟损失                                     → ⑥ 红
//   noqvl    → q 的分母不含在途虚拟损失（Q/N 而非 Q/(N+vl)）                        → ⑥ 红
//   expandvl → 扩展判据去掉「无在途访问」（在途但未回的子节点也当成新扩展）          → ⑥ 红
//   errlog   → 决策日志不记 worker 错误数                                           → ⑦ 红
// （回传「顺序」在一条路径内对每个节点是可交换的——每个节点每次迭代只加一次——所以 ① 钉的是跨迭代的顺序与选择者，
//   单条路径内的节点顺序无法、也无需反向验证。）
'use strict';
const { createSandbox, createFakeWorkerClass } = require('../tools/_sandbox.js');
const { performance: hostPerf } = require('perf_hooks');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const REV = process.env.TP_TEST_REVERSE || '';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('  ok', m); };

// ---- 反向验证用的源码变异（只作用于本进程的沙盒）----
function mutate(file, src) {
  const rep = (a, b) => { if (!src.includes(a)) throw new Error(`reverse patch anchor missing in ${file}: ${a}`); return src.replace(a, b); };
  if (REV === 'firstidx' && file === 'sim.js')
    src = rep('for (const i of legal) if (st.roleCards[i].name === nm) { ri = i; break; }', 'for (const i of legal) if (st.roleCards[i].name === nm) { ri = i; }');
  if (REV === 'chooser' && file === 'game.js')
    src = rep('c.N++; c.Q += r.vals[r.chs[j]]; }', 'c.N++; c.Q += r.vals[r.chs[0]]; }');
  if (REV === 'vlrelease' && file === 'game.js')
    src = rep('const release = (batch) => { if (useVL) for (const p of batch) for (const nd of p.nodes) nd.vl--; };', 'const release = (batch) => {};');
  if (REV === 'prefix' && file === 'game.js')
    src = rep('const reached = Math.max(0, Math.min(r.reached | 0, p.names.length));', 'const reached = p.names.length;');
  if (REV === 'noparentvl' && file === 'game.js')
    src = rep('const Np = node.N + node.vl;', 'const Np = node.N;');
  if (REV === 'noqvl' && file === 'game.js')
    src = rep('const q = cN === 0 ? 0 : c.Q / cN;', 'const q = c.N === 0 ? 0 : c.Q / c.N;');
  if (REV === 'expandvl' && file === 'game.js')
    src = rep('if (child.N === 0 && child.vl === 0) return', 'if (child.N === 0) return');
  if (REV === 'errlog' && file === 'game.js')
    src = rep('errors: usedPool && s.errors ? s.errors.length : 0,', 'errors: 0,');
  if (REV === 'stale' && file === 'game.js')
    src = rep('m.id != null && m.id === slot.tpId && slot.tpOn) { slot.tpOn(m, _tpIn); return; }', 'slot.tpOn) { slot.tpOn(m, _tpIn); return; }');
  return src;
}

// 一个主线程沙盒 + K 个 FakeWorker 的池。FW 可被包一层（注入 / 吞消息）。
function makePool(K, wrapFW) {
  let FW = createFakeWorkerClass({ forceJS: true, mathSeed: 7, transform: mutate });
  if (wrapFW) FW = wrapFW(FW);
  const M = {}; for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
  const mr = mulberry32(99); M.random = () => mr();
  const { sandbox: sb, load, run } = createSandbox({
    transform: mutate,
    beforeLoad: s => {
      s.Math = M;
      s.Worker = FW;
      s.navigator.hardwareConcurrency = K + 1;           // game.js: K = min(_aiWorkersK||8, cores−1)
      s.location = Object.assign({}, s.location, { href: 'http://localhost/', origin: 'http://localhost', host: 'localhost', hostname: 'localhost', protocol: 'http:' });
      s._nnForceJS = true;                               // 主线程直接搜索与 worker 用同一 JS 前向（数值一致）
      s.performance = { now: () => hostPerf.now() };     // 高精度计时：量主线程每迭代开销
    },
  });
  for (const f of ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js']) load(f);
  return { sb, run, S: sb.PRSim, Pool: run('PRAIPool') };
}

// ---- 局面生成（全部由 mulberry32 种子驱动）----
function playHeur(S, st, steps) {
  for (let k = 0; k < steps && !S.isTerminal(st); k++) {
    const ch = S.currentChooser(st); if (ch < 0) break;
    const legal = S.legalRoleIdxs(st); if (!legal.length) break;
    S.applyRole(st, S.heuristicPickRole(st, ch, legal));
  }
  return st;
}
const decidable = (S, st) => !S.isTerminal(st) && S.currentChooser(st) >= 0 && S.legalRoleIdxs(st).length >= 2;
function midState(S, seed, n) {
  for (let s = seed; ; s += 7919) {
    const rnd = mulberry32(s);
    const st = S.newState(n, [5, 5, 5, 5, 5].slice(0, n), rnd);
    playHeur(S, st, 8 + Math.floor(rnd() * 30));
    if (decidable(S, st)) return st;
  }
}
// 终局前夕：一直下到 endTriggered（本轮结束即终局）→ 搜索路径大多在几步内撞终局 → 截断
function lateState(S, seed) {
  for (let s = seed; ; s += 7919) {
    const rnd = mulberry32(s);
    const st = S.newState(4, [5, 5, 5, 5], rnd);
    let guard = 0;
    while (!st.endTriggered && !S.isTerminal(st) && guard++ < 600) playHeur(S, st, 1);
    playHeur(S, st, Math.floor(rnd() * 2));
    if (st.endTriggered && decidable(S, st)) return st;
  }
}
// 审查者复现脚本的中盘生成器（步长 104729、5+rnd·60 步）：3p-midtrunc 用它，保证与审查证据是同一个局面
function midState2(S, seed, n) {
  for (let s = seed; ; s += 104729) {
    const rnd = mulberry32(s);
    const st = S.newState(n, Array(n).fill(5), rnd);
    playHeur(S, st, 5 + Math.floor(rnd() * 60));
    if (decidable(S, st)) return st;
  }
}
// 5 人局：两张 Prospector 都没被拿、且卡上的钱不同（映射到错的同名下标就会分叉）
function fiveDupState(S, seed) {
  for (let s = seed; ; s += 7919) {
    const rnd = mulberry32(s);
    const st = S.newState(5, [5, 5, 5, 5, 5], rnd);
    playHeur(S, st, 10 + Math.floor(rnd() * 40));
    if (!decidable(S, st)) continue;
    const pros = st.roleCards.filter(r => r.name === 'Prospector' && !r.taken);
    if (pros.length === 2 && pros[0].money !== pros[1].money) return st;
  }
}

const BASE = { maxIters: 60, budgetMs: 1e9, C: 1.5, truncate: 999, rolloutFrac: 0 };   // = 部署 L6 选项（迭代数调小）
function direct(S, st, seed, opts) {
  const c = S.clone(st); c.rnd = mulberry32(seed >>> 0);
  return S.ismctsPickRoleIdx(c, S.searchOptsForMode('alpha', Object.assign({}, opts, { returnStats: true })));
}
async function tpPick(Pool, st, opts, tpOpts, timeoutMs) {
  try { const idx = await Pool.pickRoleTreeParallel(st, 'alpha', opts, timeoutMs, tpOpts); return { idx, s: Pool.lastStats }; }
  catch (e) { return { idx: null, s: Pool.lastStats, error: String(e && e.message || e) }; }
}
const J = x => JSON.stringify(x);

// ⑥ 的独立参照：只按 §18.2 补充 C 的文字写（不复用 game.js 的任何代码），用真实收发事件序列驱动。
//   节点 {N,Q,vl,P,names,count,kids}；选择：v = q + C·Pn·sqrt((N+vl)_父 + 1)/(1 + (N+vl)_子)，q = (N+vl)? Q/(N+vl) : 0，
//   Pn 缺省 1/合法数，严格 > 取首个；无 P → 无先验请求（带该节点 N+vl）；选中子 N==0 且 vl==0 → 扩展。
//   发出：逐条选路径、立即给路径上每个节点 vl+1。到达：撤销该批 vl；tpresult → 按批内顺序回传（首个先验为准、只回传到达的前缀）。
function refReplay(S, st, C, id, log) {
  const mk = () => ({ N: 0, Q: 0, vl: 0, P: null, names: null, count: 0, kids: new Map() });
  const root = mk();
  for (const i of S.legalRoleIdxs(st)) { const nm = st.roleCards[i].name; if (!root.kids.has(nm)) root.kids.set(nm, mk()); }
  let vlPaths = 0;
  const pick = () => {
    const nodes = [root], names = []; let nd = root, sawVL = false;
    for (;;) {
      if (nd !== root && nd.vl > 0) sawVL = true;   // 根上几乎总有别的在途路径 → 只看根以下
      if (!nd.P) return { nodes, names, pless: true, N: nd.N + nd.vl, sawVL };
      let best = -Infinity, bn = null;
      for (const nm of nd.names) {
        const c = nd.kids.get(nm), n = c.N + c.vl;
        const Pn = nd.P[nm] != null ? nd.P[nm] : 1 / nd.count;
        const v = (n ? c.Q / n : 0) + C * Pn * Math.sqrt(nd.N + nd.vl + 1) / (1 + n);
        if (v > best) { best = v; bn = nm; }
      }
      const c = nd.kids.get(bn); names.push(bn); nodes.push(c);
      if (c.N === 0 && c.vl === 0) return { nodes, names, pless: false, N: 0, sawVL };
      nd = c;
    }
  };
  const infl = {}; let mism = 0, first = '', iters = 0;
  for (const e of log) {
    if (e.ev === 'send') {
      if (e.id !== id) continue;
      const batch = [];
      for (let b = 0; b < e.reqs.length; b++) { const p = pick(); if (p.sawVL) vlPaths++; for (const nd of p.nodes) nd.vl++; batch.push(p); }
      batch.forEach((p, b) => { const r = e.reqs[b]; if (J([p.names, p.pless, p.N]) !== J([r.path, r.pless, r.N])) { if (!mism) first = J([p.names, p.pless, p.N]) + '≠' + J([r.path, r.pless, r.N]); mism++; } });
      if (mism) break;   // 一旦分叉，worker 的回复对应的是另一条路径 → 后续回放无意义（也避免在错位的树上取不到子节点）
      infl[e.k] = batch;
    } else {
      if (e.m.id !== id) continue;
      const batch = infl[e.k]; infl[e.k] = null;
      if (!batch) continue;
      for (const p of batch) for (const nd of p.nodes) nd.vl--;
      if (e.m.type !== 'tpresult') continue;
      batch.forEach((p, b) => {
        const r = e.m.results[b], reached = Math.min(r.reached, p.names.length);
        const vis = p.nodes.slice(1, 1 + reached);
        if (p.pless && r.pl && reached === p.names.length) {
          const nd = p.nodes[p.nodes.length - 1];
          if (!nd.P) { nd.P = r.pl.P || {}; nd.names = r.pl.names; nd.count = r.pl.names.length; for (const nm of r.pl.names) if (!nd.kids.has(nm)) nd.kids.set(nm, mk()); }
          vis.push(nd.kids.get(r.pl.chosen));
        }
        root.N++; iters++;
        vis.forEach((c, j) => { c.N++; c.Q += r.vals[r.chs[j]]; });
      });
    }
  }
  const stats = []; for (const [nm, c] of root.kids) stats.push({ nm, N: c.N, Q: c.Q });
  return { stats, mism, first, iters, vlPaths };
}

(async () => {
  const t0 = Date.now();
  // ================================================================ ① K=1 逐位相同
  {
    const { run, S, Pool } = makePool(1);
    await S.loadNetwork('mcts_value_nn.json');
    run('window._aiWorkersK = 1;');
    const up = await Pool.ensure(), nn = up && await Pool.ensureNN();
    ok(up && nn && Pool.K === 1, `① 池启动 K=${Pool.K}（要求 1）且 worker 载入 NN`);
    const cases = [];
    for (let i = 0; i < 6; i++) cases.push({ tag: `4p-mid${i}`, st: midState(S, 500 + i * 37, 4), opts: BASE });
    for (let i = 0; i < 4; i++) cases.push({ tag: `4p-late${i}`, st: lateState(S, 900 + i * 53), opts: BASE, late: true });
    for (let i = 0; i < 4; i++) cases.push({ tag: `5p-dupPros${i}`, st: fiveDupState(S, 1300 + i * 71), opts: BASE, five: true });
    cases.push({ tag: '2p-mid', st: midState(S, 1700, 2), opts: BASE });
    cases.push({ tag: '3p-mid', st: midState(S, 1800, 3), opts: BASE });
    cases.push({ tag: '4p-trunc3', st: midState(S, 1900, 4), opts: Object.assign({}, BASE, { truncate: 3 }) });          // NN 标量叶（逐座位）
    cases.push({ tag: '5p-trunc2', st: fiveDupState(S, 2000), opts: Object.assign({}, BASE, { truncate: 2 }), five: true });
    cases.push({ tag: '4p-rollFrac', st: midState(S, 2100, 4), opts: Object.assign({}, BASE, { truncate: 3, rolloutFrac: 0.3 }) }); // 叶内取随机数
    cases.push({ tag: '4p-late-trunc2', st: lateState(S, 2200), opts: Object.assign({}, BASE, { truncate: 2 }), late: true });
    // 路径中途撞终局（前缀回传）：3 人中盘、400 次迭代、C=0.5（树更深）、截断叶 2 —— 深处的节点是某些确定化下才存在的，
    // 另一些确定化在到达它之前就终局了。局面生成与审查者的独立复现脚本相同（种子 77001+3·313，步长 104729）。
    cases.push({ tag: '3p-midtrunc', st: midState2(S, 77001 + 3 * 313, 3), opts: Object.assign({}, BASE, { maxIters: 400, C: 0.5, truncate: 2 }), mid: true,
      seed: (0xABCD1234 + 3 * 0x2545F491) >>> 0 });
    let eq = 0, plessAll = true, lateTrunc = 0, lateN = 0, fiveEq = 0, fiveN = 0, mism = 0, midCase = -1, midSame = false;
    const bad = [];
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i], seed = c.seed != null ? c.seed : (0xC0FFEE + i * 0x9E3779B9) >>> 0;
      const d = direct(S, c.st, seed, c.opts);
      const r = await tpPick(Pool, c.st, c.opts, { B: 1, virtualLoss: false, seedBase: seed });
      const same = r.s && r.s.ok && J(r.s.merged) === J(d.stats) && r.idx === d.idx && r.s.iters === d.iters;
      if (same) eq++; else bad.push(`${c.tag}${r.error ? ' err=' + r.error : ''}`);
      if (!(r.s && r.s.plessReqs > 0)) plessAll = false;
      if (r.s) mism += r.s.mismatch || 0;
      if (c.late) { lateN++; if (r.s && r.s.truncated > 0) lateTrunc++; }
      if (c.five) { fiveN++; if (same) fiveEq++; }
      if (c.mid) { midCase = r.s ? (r.s.midTrunc | 0) : -1; midSame = same; }
    }
    // 价值网向量叶（_l6ValueNet：一次前向给 4 个座位）——主线程与 worker 都要载入同一个价值网
    run('window._l6ValueNet = true;');
    const vOk = await run('loadValueNetOnce()') && await Pool.ensureVNet();
    ok(vOk, '① 价值网在主线程与 worker 都已载入');
    for (let i = 0; i < 2; i++) {
      const st = midState(S, 2300 + i * 41, 4), opts = Object.assign({}, BASE, { truncate: 2 }), seed = (0xBEEF + i) >>> 0;
      const d = direct(S, st, seed, opts);
      const r = await tpPick(Pool, st, opts, { B: 1, virtualLoss: false, seedBase: seed });
      cases.push({ tag: `4p-vnet${i}` });
      if (r.s && r.s.ok && J(r.s.merged) === J(d.stats) && r.idx === d.idx) eq++; else bad.push(`4p-vnet${i}`);
    }
    run('window._l6ValueNet = false;');
    ok(eq === cases.length && cases.length >= 20, `① K=1 B=1 无虚拟损失：根统计与选角与单树逐位相同（${eq}/${cases.length}）${bad.length ? ' 不同：' + bad.join(',') : ''}`);
    ok(fiveEq === fiveN && fiveN >= 4, `① 其中 5 人局双 Prospector（钱数不同）局面全部相同（${fiveEq}/${fiveN}）`);
    ok(plessAll, '① 每个局面都发生了无先验请求（worker 在确定化状态上算先验并选子）');
    ok(lateTrunc === lateN && lateN >= 4, `① 终局前夕局面全部发生了撞终局截断（${lateTrunc}/${lateN}）`);
    ok(mism === 0, `① 无合法名不符（mismatch=${mism}）`);
    ok(midCase > 0 && midSame, `① 3p-midtrunc：路径中途撞终局、只回传前缀的迭代确实发生（midTrunc=${midCase}）且与单树逐位相同（${midSame}）`);
    for (const s of Pool._slots) { try { s.w.terminate(); } catch (e) {} }
  }

  // ================================================================ ②③④⑤ K=4
  // 包一层 FakeWorker：③ 在指定决策的第一条 tppaths 之后插一条过期回复；④ 吞掉指定决策里 worker 3 的第 2 条批次
  const ctl = { injectFor: null, stale: null, swallowFor: null, swallowed: 0, captureFor: null, captured: null, log: null, errFor: null, errSent: 0 };
  const wrap = Base => class extends Base {
    constructor(url) {
      super(url);
      this._k = Base._n = (Base._n == null ? 0 : Base._n + 1);
      this._batches = 0;
      const self = this;
      let h = null;
      Object.defineProperty(this, 'onmessage', {   // 截获主线程装的 onmessage：记下真实的 tpresult 供③回放
        configurable: true,
        get() { return h; },
        set(fn) { h = (ev) => {
          const m = ev && ev.data;
          if (m && m.type === 'tpresult' && ctl.captureFor === m.id && !ctl.captured) ctl.captured = m;
          if (ctl.log && m && (m.type === 'tpresult' || (m.type === 'error' && m.id != null))) ctl.log.push({ ev: 'recv', k: self._k, m: structuredClone(m) });   // ⑥
          return fn(ev);
        }; },
      });
    }
    postMessage(m) {
      if (ctl.log && m && m.type === 'tppaths') ctl.log.push({ ev: 'send', k: this._k, id: m.id, reqs: structuredClone(m.reqs) });   // ⑥
      if (m && m.type === 'tppaths' && ctl.errFor === m.id && this._k === 2) {   // ⑦：第 3 条批次回 error（worker 侧异常的同款回复）
        this._errB = (this._errB || 0) + 1;
        if (this._errB === 3) { ctl.errSent++; queueMicrotask(() => { if (typeof this.onmessage === 'function') this.onmessage({ data: { type: 'error', id: m.id, message: 'injected worker error' } }); }); return; }
      }
      if (m && m.type === 'tppaths' && ctl.swallowFor === m.id && this._k === 3) {
        this._batches++;
        if (this._batches === 2) { ctl.swallowed += m.reqs.length; return; }   // 永不回复
      }
      super.postMessage(m);
      if (m && m.type === 'tppaths' && ctl.injectFor === m.id && ctl.stale && this._k === 1) {
        const stale = ctl.stale; ctl.stale = null;
        queueMicrotask(() => { if (typeof this.onmessage === 'function') this.onmessage({ data: stale }); });   // 在途窗口内到达
      }
    }
  };
  const { sb, run, S, Pool } = makePool(4, wrap);
  await S.loadNetwork('mcts_value_nn.json');
  run('window._aiWorkersK = 4;');
  const up = await Pool.ensure(), nn = up && await Pool.ensureNN();
  ok(up && nn && Pool.K === 4, `② 池启动 K=${Pool.K}（要求 4）且 worker 载入 NN`);
  const OPT = Object.assign({}, BASE, { maxIters: 50 });

  // ② 记账 + 确定性
  {
    let acc = 0, allW = 0, sumN = 0, noVL = 0, det = 0;
    const n = 4;
    let mainMs = 0, its = 0, hMs = 0, pMs = 0, maxSl = 0, dup = 0;
    for (let i = 0; i < n; i++) {
      const st = i === 3 ? fiveDupState(S, 3100) : midState(S, 3000 + i * 13, 4);
      const a = await tpPick(Pool, st, OPT, { seedBase: 777 + i });
      const b = await tpPick(Pool, st, OPT, { seedBase: 777 + i });
      if (a.s && a.s.ok && a.s.iters === 4 * OPT.maxIters && a.s.target === 4 * OPT.maxIters) acc++;
      if (a.s && a.s.K === 4 && a.s.perWorker.length === 4 && a.s.perWorker.every(x => x > 0)) allW++;
      if (a.s && a.s.merged.reduce((t, x) => t + x.N, 0) === a.s.iters && a.s.rootN === a.s.iters) sumN++;
      if (a.s && a.s.vlLeft === 0 && !a.s.timedOut) noVL++;
      if (a.s && b.s && a.idx === b.idx && J(a.s.merged) === J(b.s.merged) && J(a.s.perWorker) === J(b.s.perWorker)) det++;
      if (a.s) { mainMs += a.s.mainMs; its += a.s.iters; hMs += a.s.handlerMs; pMs += a.s.postMs; maxSl = Math.max(maxSl, a.s.maxSliceMs); dup += a.s.plessDup; }
      if (i === 0) console.log(`    [②] perWorker=${J(a.s.perWorker)} batches=${a.s.batches} pless=${a.s.plessReqs} plessDup=${a.s.plessDup} trunc=${a.s.truncated}`);
    }
    ok(acc === n, `② 总迭代 == 4·maxIters 恰好（${acc}/${n}）`);
    ok(allW === n, `② 4 个 worker 都有贡献（${allW}/${n}）`);
    ok(sumN === n, `② Σ根子节点 N == 迭代数 == 根 N（${sumN}/${n}）`);
    ok(noVL === n, `② 完成后无残留虚拟损失（${noVL}/${n}）`);
    ok(det === n, `② FakeWorker 下两次重跑逐位相同（${det}/${n}）`);
    ok(its > 0 && hMs >= mainMs && hMs >= pMs && maxSl > 0 && maxSl <= hMs, `② 主线程耗时记账自洽：handlerMs ≥ mainMs、≥ postMs，0 < maxSliceMs ≤ handlerMs`);
    console.log(`    [②] 主线程开销（FakeWorker 路径，Node；只作量级参考，浏览器审计须用真 Chromium）：select+backup ${(1000 * mainMs / its).toFixed(1)} µs/迭代；` +
      `postMessage ${(1000 * pMs / its).toFixed(1)} µs/迭代；完整切片 ${(1000 * hMs / its).toFixed(1)} µs/迭代；最长单切片 ${maxSl.toFixed(2)} ms（${its} 次迭代）`);
    console.log(`    [②] 小预算（4×${OPT.maxIters}）下重复的无先验扩展 plessDup = ${dup}/${its}（${(100 * dup / its).toFixed(1)}%）`);
  }

  // ③ 过期回复
  {
    const st1 = midState(S, 4000, 4), st2 = midState(S, 4100, 4);
    const ref = await tpPick(Pool, st2, OPT, { seedBase: 4242 });                 // 干净参照
    ctl.captureFor = Pool._reqId + 1; ctl.captured = null;
    await tpPick(Pool, st1, OPT, { seedBase: 99 });                              // 决策 1：截一条真实 tpresult
    ok(!!ctl.captured, '③ 截到上一次决策的一条真实 tpresult');
    ctl.stale = ctl.captured; ctl.injectFor = Pool._reqId + 1;
    const got = await tpPick(Pool, st2, OPT, { seedBase: 4242 });                // 决策 2：在途时注入过期回复
    ok(ctl.stale === null, '③ 过期回复确实在决策 2 的在途窗口里投递了');
    ctl.injectFor = null;
    ok(got.s && got.s.ok && got.idx === ref.idx && J(got.s.merged) === J(ref.s.merged) && got.s.iters === 4 * OPT.maxIters,
      `③ 过期回复被丢弃：结果与干净重跑逐位相同（iters=${got.s && got.s.iters}）`);
  }

  // ④ 超时 → 部分统计
  {
    const st = midState(S, 5000, 4);
    ctl.swallowFor = Pool._reqId + 1; ctl.swallowed = 0;
    const r = await tpPick(Pool, st, OPT, { seedBase: 31337 }, 1500);
    ctl.swallowFor = null;
    const s = r.s || {};
    const sumW = (s.perWorker || []).reduce((a, b) => a + b, 0), sumN = (s.merged || []).reduce((a, b) => a + b.N, 0);
    ok(r.idx != null && s.ok === true && s.timedOut === true, `④ 超时返回部分统计：ok=${s.ok} timedOut=${s.timedOut} idx=${r.idx}`);
    ok(ctl.swallowed > 0 && s.iters === 4 * OPT.maxIters - ctl.swallowed && s.lostInFlight === ctl.swallowed,
      `④ 记账：iters=${s.iters} == 目标 ${4 * OPT.maxIters} − 被吞 ${ctl.swallowed}；lostInFlight=${s.lostInFlight}`);
    ok(sumW === s.iters && sumN === s.iters && s.rootN === s.iters, `④ Σ perWorker == Σ根 N == iters（${sumW}/${sumN}/${s.iters}）`);
    ok(s.vlLeft > 0, `④ 被吞批次的虚拟损失留在（已丢弃的）树上而非计入统计（vlLeft=${s.vlLeft}）`);
    const after = await tpPick(Pool, st, OPT, { seedBase: 31337 });
    ok(after.s && after.s.ok && after.s.iters === 4 * OPT.maxIters && after.s.K === 4, `④ 之后的决策照常：iters=${after.s && after.s.iters} K=${after.s && after.s.K}`);
  }

  // ⑤ 真实入口
  {
    const r = await run(`(async () => {
      render=function(){}; flyToDest=function(){}; showToast=function(){};
      window._allAIMode = true; window._fastSpectator = true; window._l6TreePar = true;
      window._aiThinkBudget = { L4:50, L5:100, hardIters:30, hardMs:1e9, expertIters:30, expertMs:1e9, alphaIters:30, alphaMs:1e9 };
      window._aiPoolTimeoutMs = 120000;
      await loadAIDNA();
      G = new Game(4, 'AI', {});
      G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = 6; });
      window._aiDecisionLog = [];
      const ch = G.governor, p = G.players[ch];
      const avail = G.roleCards.filter(rc => !rc.taken);
      const idx = await aiPickRoleAsync(p, avail);
      const e = window._aiDecisionLog[window._aiDecisionLog.length - 1];
      return JSON.stringify({ idx, n: avail.length, e, iters: PRAIPool.lastStats.iters });
    })()`);
    const { idx, n, e, iters } = JSON.parse(r);
    ok(Number.isInteger(idx) && idx >= 0 && idx < n, `⑤ 选角合法（${idx}/${n}）`);
    ok(e && e.path === 'pool' && e.mode === 'alpha-tp' && e.fallback === false && e.K === 4 && iters === 4 * 30,
      `⑤ L6 走 TP：${J(e && { path: e.path, mode: e.mode, fallback: e.fallback, K: e.K })} iters=${iters}`);
  }

  // ⑥ 虚拟损失语义：真实收发序列 → 独立参照树逐事件回放
  {
    let reqMis = 0, rootSame = 0, n = 0, deep = 0;
    const firstMis = [];
    for (let t = 0; t < 6; t++) {
      const np = [4, 5, 3, 4, 2, 4][t];
      const st = midState(S, 6000 + t * 29, np);
      const opts = Object.assign({}, BASE, { maxIters: 100 });
      ctl.log = [];
      const r = await tpPick(Pool, st, opts, { seedBase: 555 + t });
      const log = ctl.log; ctl.log = null;
      if (!r.s || !r.s.ok) { firstMis.push(`t${t} err=${r.error}`); n++; continue; }
      const ref = refReplay(S, st, opts.C, r.s.reqId, log);
      n++; reqMis += ref.mism; if (ref.mism && firstMis.length < 3) firstMis.push(`t${t}:${ref.first}`);
      if (J(ref.stats) === J(r.s.merged) && ref.iters === r.s.iters) rootSame++;
      if (ref.vlPaths > 0) deep++;
    }
    ok(n === 6 && reqMis === 0 && rootSame === n, `⑥ 独立参照回放（K=4、B=2、带虚拟损失）：请求 {path,pless,N} 全部一致（不符 ${reqMis}）、根统计逐位相同（${rootSame}/${n}）${firstMis.length ? ' ' + firstMis.join(' | ') : ''}`);
    ok(deep === n, `⑥ 每个局面都有「选择时路径上（根以下）已有在途虚拟损失」的请求（虚拟损失确实参与了选择，${deep}/${n}）`);
  }

  // ⑦ 中途 worker 出错：份额补跑、错误可见
  {
    const st = midState(S, 7000, 4);
    ctl.errFor = Pool._reqId + 1; ctl.errSent = 0;
    sb.__tp7st = st;   // 直接把沙盒里的状态对象交给沙盒内代码（不经 JSON）
    const lr = await run(`(async () => {
      window._aiDecisionLog = [];
      const r0 = PRAIPool._reqId, t0 = Date.now();
      let idx = null, err = null;
      try { idx = await PRAIPool.pickRoleTreeParallel(__tp7st, 'alpha', ${J(OPT)}, 120000, { seedBase: 4711 }); } catch (e) { err = String(e && e.message || e); }
      logAiDecision({ idx: 0, _aiLevel: 6 }, [1, 2, 3], r0, t0);
      return JSON.stringify({ idx, err, s: PRAIPool.lastStats, e: window._aiDecisionLog[0] });
    })()`);
    ctl.errFor = null;
    const { idx, err, s, e } = JSON.parse(lr);
    ok(ctl.errSent === 1 && !err && idx != null && s.ok && s.errors.length === 1 && s.iters === 4 * OPT.maxIters && s.target === 4 * OPT.maxIters && !s.timedOut,
      `⑦ worker 2 中途出错：ok=${s.ok} errors=${s.errors.length} iters=${s.iters}/${s.target}（其份额由其余 worker 补跑）perWorker=${J(s.perWorker)}`);
    ok(e && e.path === 'pool' && e.mode === 'alpha-tp' && e.errors === 1 && e.iters === s.iters && e.target === s.target && e.timedOut === false,
      `⑦ 决策日志可区分：${J(e && { errors: e.errors, iters: e.iters, target: e.target, timedOut: e.timedOut })}`);
  }

  for (const s of Pool._slots) { try { s.w.terminate(); } catch (e) {} }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log(fails ? `\nTP TEST FAILED: ${fails}` : '\nTP TEST OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
