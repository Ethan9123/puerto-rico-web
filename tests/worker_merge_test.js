// ============================================================
// tests/worker_merge_test.js — root-parallel ISMCTS 的拆分/合并正确性
// ============================================================
// ① 固定种子下 ismctsPickRoleIdx(st,opts) === selectRootRole(ismctsPickRoleIdx(st,{...opts,returnStats:true}).stats, st, opts)
//    （20 个中盘状态；含 tempSample 版本的 argmax 一致性）
// ② 两个不同种子的根统计按角色名合并后 selectRootRole 给出合法索引
// ③ PRSim.searchOptsForMode 重建的选项形状与 game.js 内联写法一致（hard/expert/alpha）
// ④ ai_worker.js 端到端：在沙盒里模拟 importScripts/postMessage，跑 init + pick 协议
// 用法：node tests/worker_merge_test.js
'use strict';
const path = require('path');
const { loadEngine, createSandbox } = require('../tools/_sandbox.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let fails = 0;
function check(cond, msg) { if (!cond) { fails++; console.log('  FAIL:', msg); } }

(async () => {
  const { sandbox, PRSim: S, run } = loadEngine({ files: ['game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });
  check(typeof S.selectRootRole === 'function', 'PRSim.selectRootRole exported');
  check(typeof S.searchOptsForMode === 'function', 'PRSim.searchOptsForMode exported');

  // 生成中盘状态：启发式自对弈走 k 步（k 随种子变化），要求根处 ≥2 个合法角色
  function midState(seed) {
    const rnd = mulberry32(seed);
    const n = 3 + (seed % 3); // 3/4/5 人
    let st = S.newState(n, new Array(n).fill(5), rnd);
    const steps = 8 + Math.floor(rnd() * 30);
    for (let k = 0; k < steps && !S.isTerminal(st); k++) {
      const ch = S.currentChooser(st); if (ch < 0) break;
      const legal = S.legalRoleIdxs(st); if (!legal.length) break;
      S.applyRole(st, S.heuristicPickRole(st, ch, legal));
    }
    if (S.isTerminal(st) || S.currentChooser(st) < 0 || S.legalRoleIdxs(st).length < 2) return midState(seed + 7919);
    return st;
  }

  // ---- ① 拆分等价 ----
  console.log('① ismctsPickRoleIdx vs returnStats+selectRootRole (20 states)');
  let same = 0;
  for (let i = 0; i < 20; i++) {
    const st = midState(1000 + i * 31);
    const opts = { maxIters: 120, budgetMs: 1e9 };
    st.rnd = mulberry32(42 + i); const a = S.ismctsPickRoleIdx(st, opts);
    st.rnd = mulberry32(42 + i); const r = S.ismctsPickRoleIdx(st, Object.assign({}, opts, { returnStats: true }));
    check(r && typeof r === 'object' && Array.isArray(r.stats) && typeof r.idx === 'number', `state ${i}: returnStats shape`);
    check(r.iters === 120, `state ${i}: iters=${r.iters}`);
    const totalN = r.stats.reduce((s, k) => s + k.N, 0);
    check(totalN === 120, `state ${i}: sum N=${totalN} (root N per iter)`);
    const sel = S.selectRootRole(r.stats, st, opts);
    if (a === r.idx && r.idx === sel) same++;
    else check(false, `state ${i}: a=${a} r.idx=${r.idx} sel=${sel}`);
    // tempSample 版本：同种子下数值路径与旧实现一致（同一个函数体），且 selectRootRole 选到的角色在近平局集合内
    const optsT = Object.assign({}, opts, { tempSample: { tau: 0.4, ratio: 0.75, eps: 0.03 } });
    st.rnd = mulberry32(7 + i); const t1 = S.ismctsPickRoleIdx(st, optsT);
    st.rnd = mulberry32(7 + i); const t2 = S.ismctsPickRoleIdx(st, Object.assign({}, optsT, { returnStats: true }));
    check(t1 === t2.idx, `state ${i}: tempSample same-seed parity ${t1} vs ${t2.idx}`);
    const maxN = Math.max(...t2.stats.map(k => k.N));
    for (let rep = 0; rep < 5; rep++) {
      const selT = S.selectRootRole(t2.stats, st, optsT);
      const nm = st.roleCards[selT].name;
      const k = t2.stats.find(x => x.nm === nm);
      check(k && k.N >= maxN * 0.75, `state ${i}: tempSample pick ${nm} N=${k && k.N} outside near-tie set (max ${maxN})`);
    }
  }
  console.log(`   identical on ${same}/20`);

  // ---- ② 合并 ----
  console.log('② merge two seeds → legal idx');
  for (let i = 0; i < 10; i++) {
    const st = midState(5000 + i * 17);
    const opts = { maxIters: 150, budgetMs: 1e9 };
    st.rnd = mulberry32(100 + i); const r1 = S.ismctsPickRoleIdx(st, Object.assign({}, opts, { returnStats: true }));
    st.rnd = mulberry32(900 + i); const r2 = S.ismctsPickRoleIdx(st, Object.assign({}, opts, { returnStats: true }));
    const merged = new Map();
    for (const r of [r1, r2]) for (const s of r.stats) { const m = merged.get(s.nm); if (m) { m.N += s.N; m.Q += s.Q; } else merged.set(s.nm, { nm: s.nm, N: s.N, Q: s.Q }); }
    const arr = Array.from(merged.values());
    check(arr.reduce((s, k) => s + k.N, 0) === 300, `merge ${i}: total N`);
    const idx = S.selectRootRole(arr, st, opts);
    const legal = S.legalRoleIdxs(st);
    check(legal.includes(idx), `merge ${i}: idx ${idx} legal ${legal}`);
    // argmax 语义：所选角色 N 为合并后最大
    const nm = st.roleCards[idx].name;
    check(arr.find(k => k.nm === nm).N === Math.max(...arr.map(k => k.N)), `merge ${i}: argmax N`);
    // 退化：空统计 → 首个合法
    check(S.selectRootRole([], st, opts) === legal[0], `merge ${i}: empty stats → legal[0]`);
  }

  // ---- ③ 选项重建 ----
  console.log('③ searchOptsForMode shape');
  const base = { maxIters: 10, budgetMs: 1e9, C: 1.5, truncate: 999, tempSample: null, returnStats: true };
  const oh = S.searchOptsForMode('hard', base), oe = S.searchOptsForMode('expert', base), oa = S.searchOptsForMode('alpha', base);
  for (const [nm, o] of [['hard', oh], ['expert', oe], ['alpha', oa]]) for (const k of Object.keys(base)) check(o[k] === base[k], `${nm}: base key ${k} copied`);
  check(oh !== base && oe !== base, 'returns fresh objects');
  check(typeof oh.evalLeafFn === 'function' && !oh.priorPolicyFn, 'hard: evalLeafFn only');
  check(!oe.evalLeafFn && !oe.priorPolicyFn, 'expert: no function opts');
  check(typeof oa.evalLeafFn === 'function' && typeof oa.priorPolicyFn === 'function', 'alpha: evalLeafFn + priorPolicyFn');
  const st3 = midState(777);
  check(oh.evalLeafFn(st3, 0) === S.econReward(st3, 0), 'hard.evalLeafFn === econReward');
  // alpha 需要 NN：沙盒 fetch 读取 repo 内 mcts_value_nn.json
  const nnOk = await sandbox.PRSim.loadNetwork('mcts_value_nn.json').then(() => true).catch(e => { console.log('  (NN load failed:', e.message, ')'); return false; });
  if (nnOk) {
    check(oa.evalLeafFn(st3, 1) === S.evalLeafNN(st3, 1), 'alpha.evalLeafFn === evalLeafNN');
    const dist = oa.priorPolicyFn(st3, S.currentChooser(st3));
    const legalNames = S.legalRoleIdxs(st3).map(i => st3.roleCards[i].name);
    check(dist && Object.keys(dist).length === legalNames.length && legalNames.every(n => typeof dist[n] === 'number'), 'alpha prior covers exactly legal roles');
    const sum = Object.values(dist).reduce((s, v) => s + v, 0);
    check(Math.abs(sum - 1) < 1e-6, `alpha prior sums to 1 (${sum})`);
    // 与 game.js 内联映射逐字一致：直接复算
    const out = S.networkEval(st3, S.currentChooser(st3));
    const ROLE_NAMES = ["Settler", "Mayor", "Builder", "Craftsman", "Trader", "Captain", "Prospector"];
    let s = 0; const ref = {};
    for (let k = 0; k < 7; k++) if (legalNames.includes(ROLE_NAMES[k])) { ref[ROLE_NAMES[k]] = out.policy[k]; s += out.policy[k]; }
    for (const k of Object.keys(ref)) ref[k] /= s;
    check(Object.keys(ref).every(k => ref[k] === dist[k]), 'alpha prior bit-equal to game.js mapping');
    // alpha 档端到端搜索（小预算）返回合法索引
    st3.rnd = mulberry32(3);
    const ra = S.ismctsPickRoleIdx(st3, S.searchOptsForMode('alpha', { maxIters: 20, budgetMs: 1e9, C: 1.5, truncate: 999, returnStats: true }));
    check(S.legalRoleIdxs(st3).includes(ra.idx) && ra.iters === 20, 'alpha search via rebuilt opts');
  }

  // ---- ④ ai_worker.js 协议（沙盒模拟 Worker 全局） ----
  console.log('④ ai_worker.js protocol in sandbox');
  {
    const out = [];
    const { sandbox: wsb, load, run: wrun } = createSandbox({
      extraGlobals: { postMessage: (m) => out.push(m) },
    });
    wsb.self = wsb; // classic worker 全局
    wsb.importScripts = (...files) => { for (const f of files) load(f); };
    delete wsb.window; // worker 无 window；ai_worker.js 自行 window=self
    load('ai_worker.js');
    check(typeof wsb.onmessage === 'function', 'worker installs onmessage');
    // game.js 的静态表是顶层 const（词法绑定，不是 window 属性）→ 与浏览器一致，用标识符取
    const staticData = run('({ BUILDINGS, BLD_BY_ID, GOODS, GOOD_PRICE, ROLE_LIST })');
    check(Array.isArray(staticData.BUILDINGS) && staticData.BUILDINGS.length === 23, 'static data from game.js lexical scope');
    // init（nn_wasm.js 缺失时应静默跳过；有则 wasm 字段反映其 available）
    wsb.onmessage({ data: { type: 'init', staticData, nnUrl: 'mcts_value_nn.json', knobs: { _captainDeny: 40 } } });
    await new Promise(r => setTimeout(r, 50));
    for (let w = 0; w < 200 && !out.length; w++) await new Promise(r => setTimeout(r, 25));
    const ready = out.shift();
    check(ready && ready.type === 'ready', 'ready reply: ' + JSON.stringify(ready));
    check(ready && ready.nn === true, 'worker loaded NN');
    check(wrun('window === self && typeof window === "object"'), 'worker aliases window=self (sim.js _captainDeny knob)'); // 在上下文内判定（vm 外层对象视图不同）
    check(wsb.PRSim && typeof wsb.PRSim.ismctsPickRoleIdx === 'function' && wsb.PRSim.isLoaded(), 'worker PRSim ready');
    const st4 = midState(4242);
    const plain = JSON.parse(JSON.stringify(Object.assign({}, st4, { rnd: undefined }))); // 模拟 structured clone
    for (const mode of ['hard', 'expert', 'alpha']) {
      wsb.onmessage({ data: { type: 'pick', id: 'req-' + mode, state: JSON.parse(JSON.stringify(plain)), mode, opts: { maxIters: 30, budgetMs: 1e9, C: 1.5, truncate: mode === 'alpha' ? 999 : 8 }, seed: 12345, knobs: { _mctsEps: 0.05 } } });
      const res = out.shift();
      check(res && res.type === 'result' && res.id === 'req-' + mode, `${mode}: result reply ` + JSON.stringify(res && { type: res.type, id: res.id, message: res.message }));
      if (res && res.type === 'result') {
        check(S.legalRoleIdxs(st4).includes(res.idx), `${mode}: idx legal`);
        check(res.iters === 30 && res.stats.reduce((s, k) => s + k.N, 0) === 30, `${mode}: iters/stats`);
        // 同种子 → 确定性（两次 pick 结果一致）
        wsb.onmessage({ data: { type: 'pick', id: 'again', state: JSON.parse(JSON.stringify(plain)), mode, opts: { maxIters: 30, budgetMs: 1e9, C: 1.5, truncate: mode === 'alpha' ? 999 : 8 }, seed: 12345, knobs: {} } });
        const res2 = out.shift();
        check(res2 && res2.idx === res.idx && JSON.stringify(res2.stats) === JSON.stringify(res.stats), `${mode}: deterministic under seed`);
      }
    }
    // 错误路径：未知模式在 currentChooser 正常时仍搜索（expert 语义）；坏状态 → error 回复且带 id
    wsb.onmessage({ data: { type: 'pick', id: 'bad', state: { roleCards: null }, mode: 'expert', opts: {}, seed: 1 } });
    const bad = out.shift();
    check(bad && bad.type === 'error' && bad.id === 'bad' && typeof bad.message === 'string', 'bad state → error reply with id');
    check(wsb._mctsEps === 0.05 && wsb._captainDeny === 40, 'knobs applied to worker global');
  }

  console.log(fails === 0 ? '\nWORKER MERGE OK' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
