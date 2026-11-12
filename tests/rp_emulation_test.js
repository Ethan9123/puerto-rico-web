// tests/rp_emulation_test.js — Node 里按浏览器同一路径跑 L6 根并行（第三轮 Stage 2）
//
// FakeWorker（tools/_sandbox.js）在各自 vm 上下文里跑真实的 ai_worker.js，主线程跑真实的 PRAIPool。
//   ① K=1：池的合并统计 == 直接调用 ismctsPickRoleIdx(searchOptsForMode('alpha'), rnd=mulberry32(seedBase))
//   ② K=4：池的合并统计 == 4 次直接搜索（种子 seedBase + k·0x9E3779B9）按 worker 顺序逐项相加，选角一致
//   ③ 确定性：同一决策跑两次，合并统计与选角完全相同
//   ④ 真实入口不回退：aiPickRoleAsync 对 L6 走池、mode='alpha'、决策日志 fallback=false
//   ⑤ 池大小与合并数：PRAIPool.K === K 且 lastStats.K（实际合并的回复数）=== K
// 反向验证（手工开关，均已跑过）：
//   RP_TEST_REVERSE=k1       → navigator.hardwareConcurrency=1 → 池只有 1 个 worker → ⑤ 红（② 也红）
//   RP_TEST_REVERSE=failpick → 所有 worker 对 pick 回 error → 池失败、L6 回退 → ④ 红
'use strict';
const { createSandbox, createFakeWorkerClass } = require('../tools/_sandbox.js');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const REV = process.env.RP_TEST_REVERSE || '';
const K = 4;
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('  ok', m); };

let FW = createFakeWorkerClass({ forceJS: true, mathSeed: 7 });
if (REV === 'failpick') {
  const Base = FW;
  FW = class extends Base {
    postMessage(m) { if (m && m.type === 'pick') { queueMicrotask(() => this.onmessage && this.onmessage({ data: { type: 'error', id: m.id, message: 'injected failure' } })); return; } super.postMessage(m); }
  };
}
const M = {}; for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
let mr = mulberry32(99); M.random = () => mr();
const { sandbox: sb, load, run } = createSandbox({
  beforeLoad: s => {
    s.Math = M;
    s.Worker = FW;
    s.navigator.hardwareConcurrency = REV === 'k1' ? 1 : K + 1;
    s.location = Object.assign({}, s.location, { href: 'http://localhost/', origin: 'http://localhost', host: 'localhost', hostname: 'localhost', protocol: 'http:' });
    s._nnForceJS = true;
  },
});
for (const f of ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js']) load(f);
const S = sb.PRSim;
const Pool = run('PRAIPool');   // game.js 顶层 const → 词法绑定，不是沙盒属性

function midState(seed) {
  const rnd = mulberry32(seed);
  let st = S.newState(4, [5, 5, 5, 5], rnd);
  const steps = 8 + Math.floor(rnd() * 30);
  for (let k = 0; k < steps && !S.isTerminal(st); k++) {
    const ch = S.currentChooser(st); if (ch < 0) break;
    const legal = S.legalRoleIdxs(st); if (!legal.length) break;
    S.applyRole(st, S.heuristicPickRole(st, ch, legal));
  }
  if (S.isTerminal(st) || S.currentChooser(st) < 0 || S.legalRoleIdxs(st).length < 2) return midState(seed + 7919);
  return st;
}
const OPTS = { maxIters: 40, budgetMs: 1e9, C: 1.5, truncate: 999, rolloutFrac: 0 };
function direct(st, seed) {
  const c = S.clone(st); c.rnd = mulberry32(seed >>> 0);
  return S.ismctsPickRoleIdx(c, S.searchOptsForMode('alpha', Object.assign({}, OPTS, { returnStats: true })));
}
// 让 pickRoleParallel 的 seedBase 可知：整个 pick 期间把主线程 Math.random 固定为 v
// （seedBase 在 `await this.ensure()` 之后才取数；worker 各有自己的 Math，不受影响）
async function poolPick(st, v) {
  const save = mr; mr = () => v;
  try { const idx = await Pool.pickRoleParallel(st, 'alpha', OPTS); return { idx, stats: Pool.lastStats, seedBase: (v * 0x100000000) >>> 0 }; }
  catch (e) { return { idx: null, stats: Pool.lastStats, seedBase: (v * 0x100000000) >>> 0, error: String(e && e.message || e) }; }
  finally { mr = save; }
}

(async () => {
  await S.loadNetwork('mcts_value_nn.json');
  run(`window._aiWorkersK = ${K};`);
  const up = await Pool.ensure();
  const nn = up && await Pool.ensureNN();
  ok(up && nn, `池启动且各 worker 载入 NN（ok=${up} nn=${nn}）`);
  ok(Pool.K === K, `⑤ 池大小 K=${Pool.K}（要求 ${K}）`);

  // ① ② ⑤：10 个局面
  let eq1 = 0, eq2 = 0, kOk = 0;
  for (let i = 0; i < 10; i++) {
    const st = midState(500 + i * 37);
    const v = (i + 1) / 13;
    const r = await poolPick(st, v);
    if (r.stats && r.stats.ok && r.stats.K === K) kOk++;
    const sums = new Map();
    for (let k = 0; k < K; k++) {
      const d = direct(st, (r.seedBase + k * 0x9E3779B9) >>> 0);
      for (const s of d.stats) { const m = sums.get(s.nm); if (m) { m.N += s.N; m.Q += s.Q; } else sums.set(s.nm, { nm: s.nm, N: s.N, Q: s.Q }); }
      if (i < 5 && r.stats && r.stats.replies && JSON.stringify(r.stats.replies[k]) === JSON.stringify(d.stats)) eq1++;
      // ①：池里第 k 个 worker 的根统计 == 用同一种子的直接搜索
    }
    const want = Array.from(sums.values());
    const idxWant = S.selectRootRole(want, st, OPTS);
    if (r.stats && JSON.stringify(r.stats.merged) === JSON.stringify(want) && r.idx === idxWant) eq2++;
  }
  ok(eq1 === 5 * K, `① 每个 worker 的根统计 == 同种子直接搜索（${eq1}/${5 * K}）`);
  ok(eq2 === 10, `② K=${K} 合并统计 == 4 次直接搜索逐项相加，且选角一致（${eq2}/10）`);
  ok(kOk === 10, `⑤ 每次都合并了 K=${K} 个回复（${kOk}/10）`);

  // ③ 确定性
  {
    const st = midState(4242);
    const a = await poolPick(st, 0.3141), b = await poolPick(st, 0.3141);
    ok(a.idx === b.idx && JSON.stringify(a.stats.merged) === JSON.stringify(b.stats.merged), '③ 同一决策两次：合并统计与选角完全相同');
  }

  // ④ 真实入口：构造一局，让 L6 座位走 aiPickRoleAsync
  {
    const r = await run(`(async () => {
      render=function(){}; flyToDest=function(){}; showToast=function(){};
      window._allAIMode = true; window._fastSpectator = true;
      window._aiThinkBudget = { L4:50, L5:100, hardIters:30, hardMs:1e9, expertIters:30, expertMs:1e9, alphaIters:30, alphaMs:1e9 };
      window._aiPoolTimeoutMs = 120000;
      await loadAIDNA();
      G = new Game(4, 'AI', {});
      G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = 6; });
      window._aiDecisionLog = [];
      window._l6TreePar = false;   // ④ 测的是根并行路径；TP 默认开之后须显式关（TP 另有 tests/tp_test.js）
      const ch = G.governor, p = G.players[ch];
      const avail = G.roleCards.filter(rc => !rc.taken);
      const idx = await aiPickRoleAsync(p, avail);
      const e = window._aiDecisionLog[window._aiDecisionLog.length - 1];
      return JSON.stringify({ idx, n: avail.length, e });
    })()`);
    const { idx, n, e } = JSON.parse(r);
    ok(Number.isInteger(idx) && idx >= 0 && idx < n, `④ 选角合法（${idx}/${n}）`);
    ok(e && e.path === 'pool' && e.mode === 'alpha' && e.fallback === false && e.K === K, `④ L6 走池、alpha 模式、未回退（${JSON.stringify(e && { path: e.path, mode: e.mode, fallback: e.fallback, K: e.K })}）`);
  }

  for (const s of Pool._slots) { try { s.w.terminate(); } catch (e) {} }
  console.log(fails ? `\nRP EMULATION TEST FAILED: ${fails}` : '\nRP EMULATION TEST OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
