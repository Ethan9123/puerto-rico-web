// tests/sim_sub_test.js — 第三轮 Stage 5a：子决策 rollout 搜索核心 sim_sub.js
//
// 钉住的性质（每条都做过反向验证，见文末「反向验证记录」）：
//   ①b 牌堆见底：重洗走 rnd_r 的**连续**流（值 == 独立重写，后者在确定化后把同一条流交给 st.rnd）
//   ⑤s 连续减半的 perm 日程逐批钉死（每轮 m=max(1,⌊B/(L·|S|)⌋)、新 perm 连续不重用、幸存 ⌈|S|/2⌉、
//      按累计和排名、门 = [GATE_R0, GATE_R0+gateN) 与选择阶段不相交）
//   ⑦x 门统计量精确：SE 用 n−1、mean/SE ≥ z 的边界两侧与恰好相等
//   ⑩b v(c≠h) == 独立重写（首位建造者 + 大学 + colonistsLeft 卡在阶段阈值：_bphase 须在 apply 之前定）
//   ⑭ 隐藏抽牌守卫：到达决策点要先抽隐藏牌（Stage 4 庄园前置抽牌，az.hac≠az.oi）→ 抛错；抽过之后的局面正常且无泄漏
//      （当前 sim.js 无 fid：用桩模拟 azDecision 前置抽牌；sim.js 带 fidOn 时另跑真实 Stage 4 分支）
//   ① 确定性：同一输入两次 → subSearch 结果、subEvalBatch 值逐位相同；st0 不被改、st0.rnd 不被调用
//   ② 切分不变：subEvalBatch 在 r∈[0,a) 与 [a,b) 上的拼接 == [0,b)；r 倒序 / 候选换序 / 单候选 也逐位相同
//      （5c 要把 perm 切给 K 个 worker，这条不成立则多 worker 结果依赖切法）
//   ③ CRN：同一 r 下各候选看到的确定化牌堆顺序完全相同；不同 r 的顺序不全相同（非空洞）
//   ④ 无隐藏顺序泄漏：只差 plantationDeck 顺序的两个状态 → decisionSeed、值、决策全同；
//      公开字段变了则种子变（非空洞）；clone 与原状态、键序不同的同一局面 → 同种子
//   ⑤ 平手归启发式；非 h 候选间平手取启发式序在前者
//   ⑥ c* == h 时不跑门：gate.n = 0，nRollouts = 选择阶段 rollout 数
//   ⑦ 门的判定式：mean ≥ δ 且 (SE = 0 或 mean/SE ≥ z)
//   ⑧ δ = ∞ → 恒为 h，其余输出（best、gate、nRollouts）与默认 δ 完全相同
//   ⑨ 真实局面上确实会切换（报告门的数值）
//   ⑩ v(h, r) == 独立重写的「确定化 + 纯启发式续局 + ε=0 rollout（走 sim.js rolloutToEnd）」
//   ⑪ 单候选 0 rollout；截止/上限 → 返回 h 并打标；dec 不符 → 抛错；fid 只在基础局置位
//   ⑫ 生成器 subSearchSteps + 「假池」K=2 切分求值 == 同步 subSearch
//   ⑬ Worker 形态：无 window、self=globalThis、静态表经 _PR_STATIC、状态经 structuredClone（rnd 去掉）
//      → importScripts(sim.js, sim_sub.js) 后 subEvalBatch/subSearch 与主线程逐位相同
'use strict';
const { loadEngine, createSandbox } = require('../tools/_sandbox.js');
const { sandbox, PRSim: S, run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_sub.js'] });
const X = sandbox.PRSub;

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const J = (x) => JSON.stringify(x);
const strip = (r) => { const o = Object.assign({}, r); delete o.ms; return o; };
function range(a, b) { const o = []; for (let i = a; i < b; i++) o.push(i); return o; }

// ---- 取样：纯启发式 sim 自对弈，记录多候选子决策 ----
function harvest(seed) {
  const st = S.newState(4, [5, 5, 5, 5], mulberry32(seed));
  const out = [];
  for (let guard = 0; guard < 5000; guard++) {
    const d = S.azDecision(st); if (!d) break;
    if (d.type !== 'role') out.push({ st: S.clone(st), type: d.type, n: d.actions.length });
    S.azApply(st, S.azHeuristicAction(st, d));
  }
  return out;
}
const all = harvest(20260923).concat(harvest(20260924));
const multi = all.filter(s => s.n > 1);
const byKind = {};
for (const s of multi) (byKind[s.type] = byKind[s.type] || []).push(s);
for (const k of ['build', 'settle', 'trade', 'craftbonus', 'captain']) ok(byKind[k] && byKind[k].length > 0, `harvest: no multi-candidate ${k} state`);
// 每类取中段一个（中局：牌堆非空、多候选）
const pick = {}; for (const k of Object.keys(byKind)) pick[k] = byKind[k][Math.floor(byKind[k].length / 2)].st;
const decOf = (st) => { const c = S.clone(st); return S.azDecision(c); };
const hOf = (st) => { const c = S.clone(st); return S.azHeuristicAction(c, S.azDecision(c)); };

// ① 确定性 + 不改 st0
{
  for (const k of Object.keys(pick)) {
    const st0 = S.clone(pick[k]);
    let rndCalls = 0; const rr = mulberry32(1); st0.rnd = () => { rndCalls++; return rr(); };
    const before = J(st0);   // 快照不经被测模块（JSON 跳过 rnd 函数）
    const a = X.subSearch(st0), b = X.subSearch(st0);
    ok(J(strip(a)) === J(strip(b)), `① ${k}: subSearch not deterministic`);
    const dec = decOf(st0), rs = [0, 1, 2, 3];
    const v1 = X.subEvalBatch(st0, dec, dec.actions, rs), v2 = X.subEvalBatch(st0, dec, dec.actions, rs);
    ok(J(v1) === J(v2), `① ${k}: subEvalBatch not deterministic`);
    X.decisionSeed(st0, dec);
    const after = J(st0);
    ok(before === after, `① ${k}: st0 mutated`);
    ok(rndCalls === 0, `① ${k}: st0.rnd was called ${rndCalls} times`);
  }
}

// ---- 独立重写（⑩/⑩b/①b/⑭ 共用）：自己的 perm 种子混合 + 自己的 Fisher-Yates + 启发式续局
//      + sim.js rolloutToEnd（ε=0，另给一条哑 rnd，不动 st.rnd）。只借用 decisionSeed（被测接口的输入定义）。
function mix(seed, r) {
  let h = seed >>> 0;
  for (let b = 0; b < 4; b++) { h ^= (r >>> (8 * b)) & 0xff; h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
const COLT = { 2: 40, 3: 55, 4: 75, 5: 95 }, VPT = { 2: 65, 3: 75, 4: 100, 5: 122 };
function phaseT(st) {   // doBuilder 的 phase 口径（独立抄写，不借 sim.js 内部）
  const pr = Math.max(1 - st.colonistsLeft / COLT[st.numPlayers], 1 - st.vpLeft / VPT[st.numPlayers]);
  return pr < 0.33 ? 'early' : pr < 0.66 ? 'mid' : 'late';
}
function detStart(st0, r, fid) {
  const st = S.clone(st0);
  if (fid) st._fid = true;
  const dec = S.azDecision(st);
  const seed = X.decisionSeed(st, dec);
  const rnd = mulberry32(mix(seed, r));
  const d = st.plantationDeck.sort();   // 规格：先按多重集规范化，再均匀洗
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  st.rnd = rnd;                          // 同一条流继续给之后的重洗
  return { st, dec };
}
function finish(st, chooser) {
  for (;;) { const dd = S.azDecision(st); if (!dd || dd.type === 'role') break; S.azApply(st, S.azHeuristicAction(st, dd)); }
  const saved = sandbox._mctsEps; sandbox._mctsEps = 0;
  S.rolloutToEnd(st, () => 0.5);
  sandbox._mctsEps = saved;
  return S.reward(st, chooser);
}
// v(h)：纯启发式（含本手，无「先想一遍」特判）
function indep(st0, r, fid) { const { st, dec } = detStart(st0, r, fid); return finish(st, dec.chooser); }
// v(c)：本手换成 c、其余照启发式。启发式的 phase 缓存按 doBuilder 语义直接写：建造阶段 phase 在第一位建造者
// 出手**前**定死（noPre=true 则故意不写，用于证明 ⑩b 的局面对此敏感 = 非空洞）
function indepC(st0, c, r, noPre, fid) {
  const { st, dec } = detStart(st0, r, fid);
  if (!noPre) { if (dec.type === 'build') { if (!st.az._bphase) st.az._bphase = phaseT(st); } else st.az._bphase = null; }
  S.azApply(st, c);
  return finish(st, dec.chooser);
}

// ①b 牌堆见底的局面：4 人启发式对局里牌堆几乎从不耗尽（实测 5 局 0 次重洗），上面的 rnd 断言对「重洗」是空洞的。
//    这里把牌堆挪进弃牌堆只剩 1 张 → rollout 里必然重洗：重洗必须走 perm 自己的流（st0.rnd 调用 0 次），
//    且值随 r 变化（牌堆只剩 1 张时确定化本身是平凡置换，变化只能来自继续使用的 rnd_r）。
{
  const early = multi.find(s => s.type === 'build' && s.st.turnNumber >= 4 && s.st.turnNumber <= 8);
  const st0 = S.clone(early.st);
  st0.plantationDiscard = st0.plantationDiscard.concat(st0.plantationDeck.splice(0, st0.plantationDeck.length - 1));
  let rndCalls = 0; const rr = mulberry32(2); st0.rnd = () => { rndCalls++; return rr(); };
  const dec = decOf(st0);
  const v = X.subEvalBatch(st0, dec, [dec.actions[0]], range(0, 12))[0];
  ok(rndCalls === 0, `①b starved deck: st0.rnd was called ${rndCalls} times (reshuffle must use rnd_r)`);
  ok(new Set(v).size > 1, `①b starved deck: values do not vary with r (${J(v)})`);
  ok(J(v) === J(X.subEvalBatch(st0, dec, [dec.actions[0]], range(0, 12))[0]), '①b starved deck: not deterministic');
  // 重洗用的必须是**确定化那条流的延续**（规格：st.rnd = rnd_r），不是另起一条 per-r 流：与独立重写逐位对照
  const hb = hOf(st0);
  const vh = X.subEvalBatch(st0, dec, [hb, dec.actions[0]], range(0, 12));
  for (let r = 0; r < 12; r++) {
    ok(vh[0][r] === indep(st0, r), `①b starved deck r=${r}: value(h)=${vh[0][r]} != independent continuing-stream ${indep(st0, r)}`);
    ok(vh[1][r] === indepC(st0, dec.actions[0], r), `①b starved deck r=${r}: value(a0)=${vh[1][r]} != independent ${indepC(st0, dec.actions[0], r)}`);
  }
}

// ② 切分不变 + 顺序不变
{
  for (const k of Object.keys(pick)) {
    const st0 = pick[k], dec = decOf(st0), acts = dec.actions;
    const full = X.subEvalBatch(st0, dec, acts, range(0, 10));
    const p1 = X.subEvalBatch(st0, dec, acts, range(0, 3)), p2 = X.subEvalBatch(st0, dec, acts, range(3, 10));
    const cat = p1.map((row, a) => row.concat(p2[a]));
    ok(J(cat) === J(full), `② ${k}: split [0,3)+[3,10) != [0,10)`);
    const rev = X.subEvalBatch(st0, dec, acts, range(0, 10).reverse());
    ok(J(rev.map(r => r.slice().reverse())) === J(full), `② ${k}: reversed r order changes values`);
    const ra = X.subEvalBatch(st0, dec, acts.slice().reverse(), range(0, 10));
    ok(J(ra.slice().reverse()) === J(full), `② ${k}: reversed candidate order changes values`);
    const one = X.subEvalBatch(st0, dec, [acts[acts.length - 1]], [7]);
    ok(one[0][0] === full[acts.length - 1][7], `② ${k}: single (c,r) != batch entry`);
    ok(X.value(st0, dec, acts[0], 5) === full[0][5], `② ${k}: value() != subEvalBatch entry`);
  }
}

// ③ CRN：同 r 同牌堆顺序
{
  for (const k of Object.keys(pick)) {
    const st0 = pick[k], dec = decOf(st0);
    if (st0.plantationDeck.length < 3) continue;
    const seen = {};
    X.subEvalBatch(st0, dec, dec.actions, range(0, 6), { _trace: (t) => { (seen[t.r] = seen[t.r] || []).push(t.deck); } });
    let same = true; for (const r of Object.keys(seen)) if (new Set(seen[r]).size !== 1 || seen[r].length !== dec.actions.length) same = false;
    ok(same, `③ ${k}: candidates saw different deck orders under the same r (CRN broken)`);
    const distinct = new Set(Object.keys(seen).map(r => seen[r][0])).size;
    ok(distinct >= 4, `③ ${k}: only ${distinct}/6 distinct deck orders across r (determinization vacuous?)`);
  }
}

// ④ 无隐藏顺序泄漏
{
  for (const k of Object.keys(pick)) {
    const A = S.clone(pick[k]);
    if (A.plantationDeck.length < 3) continue;
    const B = S.clone(A); B.plantationDeck = A.plantationDeck.slice().reverse();
    // 确保顺序真的不同（反转回文时再挪一位）
    if (J(B.plantationDeck) === J(A.plantationDeck)) B.plantationDeck.push(B.plantationDeck.shift());
    ok(J(B.plantationDeck) !== J(A.plantationDeck), `④ ${k}: test setup: deck orders identical`);
    const dA = decOf(A), dB = decOf(B);
    ok(X.decisionSeed(A, dA) === X.decisionSeed(B, dB), `④ ${k}: decisionSeed depends on hidden deck order`);
    const vA = X.subEvalBatch(A, dA, dA.actions, range(0, 6)), vB = X.subEvalBatch(B, dB, dB.actions, range(0, 6));
    ok(J(vA) === J(vB), `④ ${k}: values depend on hidden deck order`);
    ok(J(strip(X.subSearch(A))) === J(strip(X.subSearch(B))), `④ ${k}: decision depends on hidden deck order`);
    // 非空洞：公开字段变化必须改种子
    const C = S.clone(A); C.players[0].money += 1;
    ok(X.decisionSeed(C, decOf(C)) !== X.decisionSeed(A, dA), `④ ${k}: public field change did not change seed`);
    const D = S.clone(A); D.plantationDeck.pop();   // 多重集变了（公开可推）→ 种子应变
    ok(X.decisionSeed(D, decOf(D)) !== X.decisionSeed(A, dA), `④ ${k}: deck multiset change did not change seed`);
  }
  // 键序无关 + clone 等价（game.js buildSimState 与 sim clone 的键序不同）
  const st = pick.build, d = decOf(st);
  const re = {}; for (const key of Object.keys(st).reverse()) re[key] = st[key];
  ok(X.decisionSeed(re, d) === X.decisionSeed(st, d), '④ key order changes seed');
  ok(X.decisionSeed(S.clone(st), d) === X.decisionSeed(st, d), '④ clone changes seed');
}

// ⑤⑥⑦ 决策规则（注入求值器，精确控制值）
{
  // 取一个候选多的建造局面
  const st0 = byKind.build.slice().sort((a, b) => b.n - a.n)[0].st;
  const dec = decOf(st0), h = hOf(st0);
  const order = [h].concat(dec.actions.filter(a => a !== h));
  ok(order.length >= 4, `⑤ need >=4 candidates, got ${order.length}`);
  const mk = (fn) => ({ evalBatch: (acts, rs) => acts.map(a => rs.map(r => fn(a, r))) });
  // ⑤ 全平手 → h，且不跑门
  let r = X.subSearch(st0, mk(() => 0.3));
  ok(r.action === h && r.best === h && !r.switched, `⑤ all-tie must return h (got best=${r.best})`);
  ok(r.gate.n === 0, '⑤/⑥ all-tie must skip the gate');
  // ⑤ 非 h 候选间平手 → 启发式序在前者（order[1]）
  r = X.subSearch(st0, mk((a) => a === h ? 0 : 0.5));
  ok(r.best === order[1], `⑤ tie among non-h candidates must pick earliest in heuristic-first order (want ${order[1]}, got ${r.best})`);
  // ⑤ opts.h（5c：game.js 的启发式选择映射到 az 动作）→ 它排第一、平手归它；不在动作集里 → 忽略，用 sim 启发式
  r = X.subSearch(st0, Object.assign(mk(() => 0.3), { h: order[3] }));
  ok(r.h === order[3] && r.action === order[3], `⑤ opts.h must become the heuristic candidate (got h=${r.h})`);
  r = X.subSearch(st0, Object.assign(mk(() => 0.3), { h: 999 }));
  ok(r.h === h && r.action === h, `⑤ opts.h outside the action set must be ignored (got h=${r.h})`);
  // ⑥ h 严格最好 → 不跑门，nRollouts == 选择阶段 rollout 数
  let selRoll = 0;
  r = X.subSearch(st0, { evalBatch: (acts, rs) => { selRoll += acts.length * rs.length; return acts.map(a => rs.map(() => a === h ? 1 : 0)); } });
  ok(r.best === h && r.gate.n === 0 && r.nRollouts === selRoll, `⑥ c*==h: gate.n=${r.gate.n} nRollouts=${r.nRollouts} sel=${selRoll}`);
  ok(selRoll <= X.DEFAULTS.bSel, `⑥ selection used ${selRoll} > B_sel`);
  // ⑦ 门判定式
  const c2 = order[2];
  const gateCase = (dfn) => X.subSearch(st0, mk((a, rr) => a === c2 ? (rr >= X.GATE_R0 ? dfn(rr - X.GATE_R0) : 1) : 0));
  // 二进制精确值（2^-5）：mean 与 SE 都无舍入 → 恰好 mean=δ、SE=0 的边界
  const gateCaseD = (dfn, delta) => X.subSearch(st0, Object.assign(mk((a, rr) => a === c2 ? (rr >= X.GATE_R0 ? dfn(rr - X.GATE_R0) : 1) : 0), { delta }));
  r = gateCaseD(() => 0.03125, 0.03125);          // SE=0, mean=δ → 切
  ok(r.switched && r.action === c2 && r.gate.se === 0 && r.gate.mean === 0.03125 && r.gate.n === X.DEFAULTS.gateN, `⑦ SE=0 mean=δ must switch (${J(r.gate)})`);
  r = gateCaseD(() => 0.03125, 0.0625);           // SE=0, mean<δ → 不切
  ok(!r.switched && r.action === h && r.gate.se === 0, `⑦ SE=0 mean<δ must not switch (${J(r.gate)})`);
  r = gateCase(() => 0.019);                     // 默认 δ=0.02，mean<δ → 不切
  ok(!r.switched && r.action === h, `⑦ mean<δ must not switch (${J(r.gate)})`);
  r = gateCase((k) => (k % 2 ? 0.5 : -0.4));     // mean=0.05≥δ 但 z≈0.2 → 不切
  ok(!r.switched && r.gate.mean >= 0.02 && r.gate.mean / r.gate.se < 2, `⑦ low z must not switch (${J(r.gate)})`);
  r = gateCase((k) => (k % 2 ? 0.2 : 0.1));      // mean=0.15, z 大 → 切
  ok(r.switched && r.gate.mean / r.gate.se >= 2, `⑦ high z must switch (${J(r.gate)})`);
  r = X.subSearch(st0, Object.assign(mk((a, rr) => a === c2 ? (rr >= X.GATE_R0 ? 0.3 : 1) : 0), { delta: Infinity }));
  ok(!r.switched && r.action === h && r.best === c2, '⑦ δ=∞ must never switch (injected)');
}

// ⑤s 连续减半的 perm 日程（注入求值器记录每一批 {actions, rs}，与独立写的参考日程逐批比对）
{
  // 参考：预注册规则的直写（逐轮新 perm、m=max(1,⌊B/(L·|S|)⌋)、按累计和、平手取启发式序在前、保留 ⌈|S|/2⌉）
  function refSchedule(cands, B, gateN, fn) {
    const n = cands.length, L = Math.ceil(Math.log2(n)), sums = new Array(n).fill(0), batches = [];
    let alive = range(0, n), r0 = 0;
    while (alive.length > 1) {
      const m = Math.max(1, Math.floor(B / (L * alive.length)));
      const rs = range(r0, r0 + m); r0 += m;
      batches.push({ actions: alive.map(i => cands[i]), rs });
      for (const i of alive) for (const r of rs) sums[i] += fn(cands[i], r);
      alive = alive.slice().sort((x, y) => (sums[y] - sums[x]) || (x - y)).slice(0, Math.ceil(alive.length / 2));
    }
    const best = cands[alive[0]];
    if (best !== cands[0]) batches.push({ actions: [best, cands[0]], rs: range(1000000, 1000000 + gateN) });
    return { batches, best, sel: r0 };
  }
  // 二进制精确的伪随机值（和无舍入）；最后一个候选在选择阶段 +0.5 → 通常 c*≠h，门会跑
  const noise = (a, r) => ((Math.imul(a + 7, 0x9E3779B1) ^ Math.imul(r + 3, 0x85EBCA6B)) >>> 0) % 64 / 64;
  const states = Object.keys(pick).map(k => [k, pick[k]]).concat([['build-max', byKind.build.slice().sort((a, b) => b.n - a.n)[0].st]]);
  const ns = new Set();
  for (const [k, st0] of states) {
    const dec = decOf(st0), h = hOf(st0), cands = [h].concat(dec.actions.filter(a => a !== h)), last = cands[cands.length - 1];
    const fn = (a, r) => r >= X.GATE_R0 ? (a === last ? 0.5 : 0) : noise(a, r) + (a === last ? 0.5 : 0);
    for (const B of [X.DEFAULTS.bSel, 7]) {   // B=7：m 被 max(1,·) 托底
      if (cands.length < 2) continue;
      ns.add(cands.length);
      const got = [];
      const r = X.subSearch(st0, { bSel: B, evalBatch: (acts, rs) => { got.push({ actions: acts.slice(), rs: rs.slice() }); return acts.map(a => rs.map(rr => fn(a, rr))); } });
      const ref = refSchedule(cands, B, X.DEFAULTS.gateN, fn);
      ok(J(got) === J(ref.batches), `⑤s ${k} B=${B} n=${cands.length}: batch schedule differs from the pre-registered rule\n   got ${J(got.map(b => [b.actions.length, b.rs[0], b.rs.length]))}\n   ref ${J(ref.batches.map(b => [b.actions.length, b.rs[0], b.rs.length]))}`);
      ok(r.best === ref.best && r.selPerms === ref.sel, `⑤s ${k} B=${B}: best/selPerms ${r.best}/${r.selPerms} vs ref ${ref.best}/${ref.sel}`);
      // 显式性质（与参考无关）：选择阶段 rs 逐轮连续、并集 = [0, selPerms)；门 rs 全部新鲜且与选择阶段不相交
      const selB = got.filter(b => b.rs[0] < X.GATE_R0), gateB = got.filter(b => b.rs[0] >= X.GATE_R0);
      const selRs = [].concat(...selB.map(b => b.rs));
      ok(J(selRs) === J(range(0, r.selPerms)), `⑤s ${k} B=${B}: selection perms not fresh+consecutive across rounds: ${J(selB.map(b => [b.rs[0], b.rs.length]))}`);
      if (gateB.length) {
        const g = gateB[0].rs, maxSel = Math.max(...selRs);
        ok(g.length === X.DEFAULTS.gateN && new Set(g).size === g.length && g.every(x => x > maxSel), `⑤s ${k} B=${B}: gate perms overlap selection or repeat (gate ${g[0]}.., maxSel ${maxSel})`);
      }
    }
  }
  // 门区间起点必须高于硬上限内选择阶段可能用到的任何 r（选择 rollout 数 ≤ maxRollouts ⇒ r < maxRollouts）
  ok(X.GATE_R0 >= X.DEFAULTS.maxRollouts, `⑤s GATE_R0=${X.GATE_R0} < maxRollouts=${X.DEFAULTS.maxRollouts}: gate can overlap selection`);
  ok([...ns].some(n => n % 2 === 1 && n > 2) && [...ns].some(n => n >= 8), `⑤s schedule cases not diverse enough (n: ${J([...ns])})`);
}

// ⑤c 累计和排名：末轮领先者 ≠ 累计领先者时必须取累计领先者（按批次形状给值，与日程细节无关）
{
  const st0 = byKind.build.slice().sort((a, b) => b.n - a.n)[0].st;
  const dec = decOf(st0), h = hOf(st0), order = [h].concat(dec.actions.filter(a => a !== h));
  const A = order[1], Bc = order[2];
  // 末轮之前的每一批：A=1、Bc=0.75、其余 0（它俩一路是前二）；末轮（2 个幸存者）：A=0.5 < Bc=0.5625；门：A−h=0.5 → 切。
  // n=12 时各轮 m = 3,6,13,20：累计 A−Bc = 0.25·22 − 0.0625·20 = 4.25 > 0，末轮单轮 Bc 领先 1.25。
  let lastRound = 0;
  const r = X.subSearch(st0, { evalBatch: (acts, rs) => {
    const gate = rs[0] >= X.GATE_R0, last = !gate && acts.length === 2;
    if (last) lastRound = rs.length;
    return acts.map(a => rs.map(() => gate ? (a === A ? 0.5 : 0) : last ? (a === A ? 0.5 : a === Bc ? 0.5625 : 0) : (a === A ? 1 : a === Bc ? 0.75 : 0)));
  } });
  ok(order.length >= 5 && lastRound > 0, `⑤c setup: n=${order.length} lastRound=${lastRound}`);
  ok(r.best === A, `⑤c cumulative ranking: want A=${A} (cumulative leader), got ${r.best} (Bc=${Bc} leads the last round only)`);
}

// ⑦x 门统计量精确（预注册：SE = sqrt(Σ(d−mean)²/(n−1)/n)，切换 ⇔ mean ≥ δ 且 (SE=0 或 mean/SE ≥ z)）
{
  const st0 = byKind.build.slice().sort((a, b) => b.n - a.n)[0].st;
  const dec = decOf(st0), h = hOf(st0), order = [h].concat(dec.actions.filter(a => a !== h)), c2 = order[2];
  const N = X.DEFAULTS.gateN;
  // d_k 交替 (m+1, m−1)：半幅 1，SE_{n−1} = 1/sqrt(N−1)，SE_n = 1/sqrt(N)
  const run = (m, extra) => X.subSearch(st0, Object.assign({ evalBatch: (acts, rs) => acts.map(a => rs.map(rr => a !== c2 ? 0 : rr >= X.GATE_R0 ? ((rr - X.GATE_R0) % 2 ? m - 1 : m + 1) : 1)) }, extra || {}));
  const extSE = (m) => { const d = range(0, N).map(k => (k % 2 ? m - 1 : m + 1)); const mu = d.reduce((x, y) => x + y, 0) / N; return Math.sqrt(d.reduce((x, y) => x + (y - mu) * (y - mu), 0) / (N - 1) / N); };
  // m=0.29：z_{n−1} = 0.29·√47 ≈ 1.988 < 2 ≤ z_n = 0.29·√48 ≈ 2.009 → 用 n−1 不切（用 n 会切）
  let r = run(0.29);
  ok(Math.abs(r.gate.se - extSE(0.29)) < 1e-12 && r.gate.n === N, `⑦x SE must use n−1: got ${r.gate.se}, want ${extSE(0.29)}`);
  ok(0.29 * Math.sqrt(N - 1) < 2 && 0.29 * Math.sqrt(N) >= 2, '⑦x test setup: m=0.29 must straddle z=2 between n−1 and n');
  ok(!r.switched && r.action === h, `⑦x z just below 2 (n−1 SE) must not switch: ${J(r.gate)} z=${r.gate.mean / r.gate.se}`);
  // m=0.2935：z ≈ 2.012 → 刚过 2，必须切
  r = run(0.2935);
  ok(r.switched && r.action === c2 && r.gate.mean / r.gate.se > 2 && r.gate.mean / r.gate.se < 2.05, `⑦x z just above 2 must switch: ${J(r.gate)} z=${r.gate.mean / r.gate.se}`);
  // 恰好相等：把 z 设成返回的 mean/SE（同一浮点数）→ ≥ 必须切
  const zEq = r.gate.mean / r.gate.se;
  r = run(0.2935, { z: zEq });
  ok(r.switched, `⑦x mean/SE == z exactly must switch (z=${zEq})`);
}

// ⑨ 真实局面上的切换 + ⑧ δ=∞
let switchCase = null;
{
  for (const s of multi) {
    if (s.st.plantationDeck.length < 3) continue;
    const r = X.subSearch(s.st);
    if (r.switched) { switchCase = { st: s.st, r }; break; }
  }
  ok(!!switchCase, '⑨ no switching state found in the harvest');
  if (switchCase) {
    const { st, r } = switchCase;
    console.log(`⑨ switch: kind=${r.kind} h=${r.h} -> ${r.best}  gate mean=${r.gate.mean.toFixed(4)} se=${r.gate.se.toFixed(4)} z=${(r.gate.mean / r.gate.se).toFixed(2)} n=${r.gate.n}  rollouts=${r.nRollouts}`);
    ok(r.action === r.best && r.best !== r.h && r.gate.mean >= 0.02 && (r.gate.se === 0 || r.gate.mean / r.gate.se >= 2), '⑨ switch must satisfy the gate');
    // 门的数值可由 subEvalBatch 独立复算
    const dec = decOf(st), rs = range(X.GATE_R0, X.GATE_R0 + X.DEFAULTS.gateN);
    const v = X.subEvalBatch(st, dec, [r.best, r.h], rs);
    let sum = 0; for (let k = 0; k < rs.length; k++) sum += v[0][k] - v[1][k];
    ok(Math.abs(sum / rs.length - r.gate.mean) < 1e-12, '⑨ gate mean not reproducible from subEvalBatch');
    // ⑧ δ=∞：只改决策
    const before = J(st);
    const ri = X.subSearch(st, { delta: Infinity });
    ok(ri.action === ri.h && !ri.switched, '⑧ δ=∞ must return h');
    const a = strip(r), b = strip(ri); delete a.action; delete a.switched; delete b.action; delete b.switched;
    ok(J(a) === J(b), `⑧ δ=∞ changed something other than the decision: ${J(a)} vs ${J(b)}`);
    ok(before === J(st), '⑧ st0 mutated');
  }
  // ⑥（真实值）：c* == h 的真实局面 → 0 门 rollout
  let hit = 0;
  for (const s of multi.slice(0, 30)) {
    const r = X.subSearch(s.st, { bSel: 40, gateN: 16 });
    if (r.best === r.h) { hit++; ok(r.gate.n === 0 && r.nRollouts <= 40, `⑥ real c*==h: gate.n=${r.gate.n} nRollouts=${r.nRollouts}`); }
  }
  ok(hit > 0, '⑥ no real c*==h state found (vacuous)');
}

// ⑩ v(h, r) == 独立重写（见文件前部 indep）
{
  let n = 0;
  for (const k of Object.keys(byKind)) {
    const list = byKind[k];
    for (const idx of [0, Math.floor(list.length / 2), list.length - 1]) {
      const st0 = list[idx].st, dec = decOf(st0), h = hOf(st0);
      for (const r of [0, 1, 17, X.GATE_R0 + 3]) {
        const a = X.value(st0, dec, h, r), b = indep(st0, r);
        n++; ok(a === b, `⑩ ${k}#${idx} r=${r}: value(h)=${a} != independent ${b}`);
      }
    }
  }
  ok(n >= 40, `⑩ only ${n} cases`);
}

// ⑩b v(c≠h) == 独立重写，且局面对「phase 在 apply 之前定」敏感（非空洞）：
//   首位建造者（_bphase 尚未定）+ 自己有上人的大学(16)（建房从供应池带走 1 殖民者）+ colonistsLeft 卡在
//   early/mid 阈值上方一格 → 任何非 pass 的建造都把 phaseOf 推进 mid；doBuilder 语义下后续建造者仍按 early 选房。
{
  let n = 0, sens = 0;
  const firsts = byKind.build.filter(s => s.st.az.oi === 0 && s.st.az.ord[0] === decOf(s.st).chooser);
  ok(firsts.length >= 3, `⑩b only ${firsts.length} first-builder states`);
  for (const s of firsts.slice(0, 8)) {
    const st0 = S.clone(s.st), me = decOf(st0).chooser, p = st0.players[me];
    if (!p.buildings.some(b => b.bid === 16)) p.buildings.push({ bid: 16, men: 1 });
    for (const b of p.buildings) if (b.bid === 16) b.men = 1;
    st0.colonistsLeft = 51; st0.vpLeft = VPT[st0.numPlayers];   // 1−51/75 = 0.32 → early；建房后 50 → 0.333 → mid
    const dec = decOf(st0);
    if (dec.type !== 'build' || dec.actions.length < 2) continue;
    const rs = [0, 1, 2];
    const v = X.subEvalBatch(st0, dec, dec.actions, rs);
    for (let a = 0; a < dec.actions.length; a++) for (let k = 0; k < rs.length; k++) {
      const c = dec.actions[a], want = indepC(st0, c, rs[k]);
      n++; ok(v[a][k] === want, `⑩b build c=${c} r=${rs[k]}: value=${v[a][k]} != independent ${want}`);
      if (indepC(st0, c, rs[k], true) !== want) sens++;
    }
  }
  ok(n >= 30, `⑩b only ${n} cases`);
  ok(sens > 0, `⑩b vacuous: no case where fixing phase before apply matters (${n} cases)`);
  console.log(`⑩b ${n} (c,r) cases, ${sens} sensitive to phase-before-apply`);
}

// ⑪ 边角
{
  const single = all.find(s => s.n === 1);
  ok(!!single, '⑪ no single-candidate state');
  if (single) {
    const r = X.subSearch(single.st);
    ok(r.nRollouts === 0 && r.action === decOf(single.st).actions[0] && !r.switched, `⑪ single-candidate: ${J(strip(r))}`);
  }
  const st0 = pick.build, r0h = hOf(st0);
  let r = X.subSearch(st0, { maxMs: 0 });
  ok(r.timedOut && r.action === r.h && r.nRollouts === 0, `⑪ maxMs=0: ${J(strip(r))}`);
  r = X.subSearch(st0, { maxRollouts: 10 });
  ok(r.capped && r.action === r.h && r.nRollouts <= 10, `⑪ maxRollouts=10: ${J(strip(r))}`);
  // 注入求值器路径同样检查截止/上限：maxMs=0 → 求值器一次都不调
  let calls = 0;
  r = X.subSearch(st0, { maxMs: 0, evalBatch: (acts, rs) => { calls++; return acts.map(() => rs.map(() => 0)); } });
  ok(r.timedOut && r.action === r.h && r.nRollouts === 0 && calls === 0, `⑪ maxMs=0 (injected evalBatch): calls=${calls} ${J(strip(r))}`);
  // 默认硬上限（未传 maxRollouts）必须生效：B_sel 远超 2000 → capped
  r = X.subSearch(st0, { bSel: 50000, evalBatch: (acts, rs) => acts.map(a => rs.map(() => (a === r0h ? 0 : 1))) });
  ok(r.capped && r.action === r.h && r.nRollouts <= X.DEFAULTS.maxRollouts && X.DEFAULTS.maxRollouts === 2000, `⑪ default hard cap: ${J(strip(r))}`);
  // 生产上的正常调用不会碰上限（默认 2000）
  r = X.subSearch(st0);
  ok(!r.capped && !r.timedOut && r.nRollouts <= X.DEFAULTS.bSel + 2 * X.DEFAULTS.gateN, `⑪ default run: ${J(strip(r))}`);
  // dec 不符 → 抛错
  const dec = decOf(st0);
  let threw = false; try { X.subEvalBatch(st0, Object.assign({}, dec, { chooser: (dec.chooser + 1) % 4 }), dec.actions, [0]); } catch (e) { threw = true; }
  ok(threw, '⑪ mismatched dec must throw');
  // 动作集长度相同、内容不同 → 也必须抛错（sameDec 逐个比对动作）
  threw = false; try { const acts = dec.actions.slice(); acts[acts.length - 1] = 999; X.subEvalBatch(st0, Object.assign({}, dec, { actions: acts }), [dec.actions[0]], [0]); } catch (e) { threw = true; }
  ok(threw, '⑪ dec with same-length but different actions must throw');
  // 角色决策 → null
  const roleSt = S.newState(4, [5, 5, 5, 5], mulberry32(3));
  ok(X.subSearch(roleSt) === null, '⑪ role decision must return null');
  // fid 置位只在基础局
  const fids = [];
  X.subEvalBatch(st0, dec, [dec.actions[0]], [0], { fid: true, _trace: t => fids.push(t.fid) });
  X.subEvalBatch(st0, dec, [dec.actions[0]], [0], { _trace: t => fids.push(t.fid) });
  const ex = S.clone(st0); ex.expansionTibs = true;
  X.subEvalBatch(ex, decOf(ex), [dec.actions[0]], [0], { fid: true, _trace: t => fids.push(t.fid) });
  ok(J(fids) === J([true, false, false]), `⑪ fid flag placement: ${J(fids)}`);
}

// ⑫ 生成器 + 假池（K=2，把每批 r 切成两半分别求值，再按 r 顺序拼回）== 同步 subSearch
{
  for (const k of Object.keys(pick)) {
    const st0 = pick[k];
    const sync = X.subSearch(st0);
    const p = X.subSearchSteps(st0);
    let it = p.steps.next(), n = 0;
    while (!it.done) {
      const { actions, rs } = it.value;
      const mid = Math.floor(rs.length / 2);
      const w1 = X.subEvalBatch(st0, p.dec, actions, rs.slice(0, mid)), w2 = X.subEvalBatch(st0, p.dec, actions, rs.slice(mid));
      n += actions.length * rs.length;
      it = p.steps.next(w1.map((row, a) => row.concat(w2[a])));
    }
    const out = it.value, act = out.switched ? out.best : out.h;
    ok(out.selPerms === sync.selPerms, `⑫ ${k}: selPerms ${out.selPerms} vs ${sync.selPerms}`);
    ok(act === sync.action && out.best === sync.best && J(out.gate) === J(sync.gate) && n === sync.nRollouts,
      `⑫ ${k}: fake-pool K=2 differs from sync (${act}/${out.best}/${n} vs ${sync.action}/${sync.best}/${sync.nRollouts})`);
  }
}

// ⑬ Worker 形态（与 tools/_sandbox.js createFakeWorkerClass 同构的上下文；ai_worker.js 暂不改，5c 再接）
{
  const { sandbox: wsb, load } = createSandbox({});
  wsb.self = wsb; delete wsb.window;
  wsb.importScripts = (...files) => { for (const f of files) load(f); };
  wsb._PR_STATIC = structuredClone(run('({ BUILDINGS: BASE_BUILDINGS.slice(), BLD_BY_ID, GOODS, GOOD_PRICE, ROLE_LIST })'));
  wsb.importScripts('sim.js', 'sim_sub.js');
  ok(!!wsb.PRSub && typeof wsb.PRSub.subSearch === 'function', '⑬ PRSub not attached in worker context');
  for (const k of Object.keys(pick)) {
    const st0 = pick[k];
    const msg = structuredClone(Object.assign({}, st0, { rnd: undefined }));   // 函数不能 structuredClone；搜索也不需要 st0.rnd
    const dec = decOf(st0);
    ok(wsb.PRSub.decisionSeed(msg, dec) === X.decisionSeed(st0, dec), `⑬ ${k}: decisionSeed differs across contexts`);
    const vw = wsb.PRSub.subEvalBatch(msg, dec, dec.actions, [0, 1, 2]), vm = X.subEvalBatch(st0, dec, dec.actions, [0, 1, 2]);
    ok(J(vw) === J(vm), `⑬ ${k}: worker-context values differ from main`);
    ok(J(strip(wsb.PRSub.subSearch(msg))) === J(strip(X.subSearch(st0))), `⑬ ${k}: worker-context subSearch differs`);
  }
}

// ⑭ 隐藏抽牌守卫（审查发现：Stage 4 的庄园在 azDecision 里「决策前」抽；opts.fid 若在规范化之后才置位会整张丢，
//    规范化若在真实牌堆上抽则隐藏顺序进 base/种子/每个 rollout）。
{
  const st = pick.settle, dec0 = decOf(st), me = dec0.chooser;
  ok(st.az.phase === 'settler' && st.az.ord[st.az.oi] === me, '⑭ setup: settle state cursor');
  // (A) 桩：模拟 Stage 4——_fid 下 azDecision 在拓殖决策前从牌堆顶抽 1 张给当前玩家，az.hac 游标幂等
  const origDec = S.azDecision;
  let stubRnd = false;
  S.azDecision = function (s) {
    if (s._fid && s.az && s.az.phase === 'settler' && s.az.hac !== s.az.oi && s.az.oi < s.az.ord.length) {
      s.az.hac = s.az.oi;
      if (stubRnd) s.rnd();
      else if (s.plantationDeck.length) s.players[s.az.ord[s.az.oi]].plantations.push({ good: s.plantationDeck.pop(), manned: false });
    }
    return origDec(s);
  };
  try {
    const throws = (f) => { try { f(); return false; } catch (e) { return /hidden/.test(e.message); } };
    const pre = S.clone(st); delete pre.az.hac;                       // 抽之前（az.hac≠oi），st0 本身不带 _fid
    ok(throws(() => X.subSearch(pre, { fid: true })), '⑭ stub: pre-draw state with opts.fid must throw (fid must be set before normalization)');
    ok(throws(() => X.subEvalBatch(pre, dec0, dec0.actions, [0], { fid: true })), '⑭ stub: subEvalBatch on pre-draw state must throw');
    const preF = S.clone(pre); preF._fid = true;                       // st0 自带 _fid、不传 opts.fid
    ok(throws(() => X.subSearch(preF)), '⑭ stub: pre-draw state with st0._fid must throw');
    stubRnd = true;
    ok(throws(() => X.subSearch(pre, { fid: true })), '⑭ stub: normalization consuming randomness must throw');
    stubRnd = false;
    ok(!throws(() => X.subSearch(pre)), '⑭ stub: fid off must not trigger the guard');
    // 抽之后（重建口径 az.hac = oi）：不抛、无隐藏顺序泄漏、v(h) == 独立重写（fid 置位）
    const post = S.clone(st); post.az.hac = post.az.oi;
    const postB = S.clone(post); postB.plantationDeck = post.plantationDeck.slice().reverse();
    const dp = decOf(post);
    const va = X.subEvalBatch(post, dp, dp.actions, range(0, 4), { fid: true }), vb = X.subEvalBatch(postB, dp, dp.actions, range(0, 4), { fid: true });
    ok(J(va) === J(vb), '⑭ stub: post-draw values depend on hidden deck order');
    const hp = S.azHeuristicAction(Object.assign(S.clone(post), { _fid: true }), dp), k = dp.actions.indexOf(hp);
    for (let r = 0; r < 4; r++) ok(va[k][r] === indep(post, r, true), `⑭ stub: post-draw v(h) r=${r} != independent (${va[k][r]} vs ${indep(post, r, true)})`);
  } finally { S.azDecision = origDec; }
  // (B) 真实 Stage 4（sim.js 带 fidOn 时才跑；当前 e303ac3 的 sim.js 无 fid → 跳过并打印）
  if (S._internal && typeof S._internal.fidOn === 'function') {
    const base = S.clone(st); base.players[me].buildings.push({ bid: 8, men: 1 });
    const pre = S.clone(base); pre._fid = true; pre.az.hac = -1;
    const preNoF = S.clone(base); delete preNoF._fid; preNoF.az.hac = -1;
    const throws = (f) => { try { f(); return false; } catch (e) { return /hidden/.test(e.message); } };
    ok(throws(() => X.subSearch(preNoF, { fid: true })), '⑭ stage4: pre-draw Hacienda with opts.fid must throw');
    ok(throws(() => X.subSearch(pre)), '⑭ stage4: pre-draw Hacienda with st0._fid must throw');
    // 抽之后：按 game.js 的顺序先抽（真实牌堆，模拟对局已发生），再作为搜索输入（去掉 _fid，走 opts.fid）
    const post = S.clone(pre); S.azDecision(post); delete post._fid;
    ok(post.az.hac === post.az.oi && post.players[me].plantations.length === base.players[me].plantations.length + 1, '⑭ stage4 setup: Hacienda pre-draw');
    const dp = decOf(Object.assign(S.clone(post), { _fid: true }));
    const n0 = post.players[me].plantations.length;
    const origApply = S.azApply; const gains = [];
    let first = false;
    S.azApply = function (s, a) { const out = origApply(s, a); if (first) { gains.push(s.players[me].plantations.length - n0); first = false; } return out; };
    try { for (let r = 0; r < 4; r++) { first = true; X.subEvalBatch(post, dp, [dp.actions[0]], [r], { fid: true }); } } finally { S.azApply = origApply; }
    ok(J(gains) === J([1, 1, 1, 1]), `⑭ stage4: own settle must add exactly the picked tile (Hacienda already drawn): ${J(gains)}`);
    const postB = S.clone(post); postB.plantationDeck.reverse();
    ok(J(X.subEvalBatch(post, dp, dp.actions, range(0, 4), { fid: true })) === J(X.subEvalBatch(postB, dp, dp.actions, range(0, 4), { fid: true })), '⑭ stage4: post-draw values depend on hidden deck order');
    const hp = X.subSearch(post, { fid: true, delta: Infinity }).h;
    for (let r = 0; r < 4; r++) ok(X.value(post, dp, hp, r, { fid: true }) === indep(post, r, true), `⑭ stage4: v(h) r=${r} != independent fid re-implementation`);
    console.log('⑭ stage4 fid branch: ran');
  } else console.log('⑭ stage4 fid branch: skipped (sim.js has no fidOn)');
}

console.log(`harvested ${all.length} sub-decisions (${multi.length} multi-candidate): ` + Object.keys(byKind).map(k => `${k}=${byKind[k].length}`).join(' '));
console.log(fails ? `\nSIM_SUB TEST FAILED: ${fails}` : '\nSIM_SUB TEST OK');
process.exit(fails ? 1 : 0);

// ---- 反向验证记录（手工，已做；每次改完 sim_sub.js 即恢复，md5 核对）----
//   ①  perm 种子掺 Math.random                         → 「① settle: subEvalBatch not deterministic」
//   ①  publicView 原地 sort st0 的牌堆（去掉 .slice()）  → 「① settle: st0 mutated」
//   ①b 去掉 normalize 的哑流与 evalOne 的 st.rnd = rnd  → 「①b starved deck: st0.rnd was called 384 times」
//      （只在 ① 的普通局面上断言是空洞的：4 人启发式局牌堆几乎不见底，实测 5 局 0 次重洗，所以加了 ①b）
//   ②  各 rollout 共用一条 rnd 流                       → 「② settle: split [0,3)+[3,10) != [0,10)」
//   ②  perm 按批内位置取（rList[0]+k）                  → 「② settle: reversed r order changes values」
//   ③  perm 种子掺 action                               → 「③ settle: candidates saw different deck orders under the same r (CRN broken)」
//   ④  decisionSeed 保留牌堆顺序                        → 「④ settle: decisionSeed depends on hidden deck order」
//   ④  洗牌前不先排序（直接洗真实顺序）                  → 「④ settle: values depend on hidden deck order」（初版实现就是这个 bug，被 ④ 抓到）
//   ⑤  平手规则改为下标大者优先                          → 「⑤ all-tie must return h (got best=-1)」
//   ⑤  忽略 opts.h                                      → 「⑤ opts.h must become the heuristic candidate」
//   ⑥  c*==h 时照跑门                                   → 「⑥ c*==h: gate.n=48 nRollouts=236 sel=236」
//   ⑦  mean ≥ δ 改成 mean > δ                            → 「⑦ SE=0 mean=δ must switch」；z 门改成 ≥0 → 「⑦ low z must not switch」
//   ⑧  δ 非有限时跳过门                                  → 「⑧ δ=∞ changed something other than the decision」
//   ⑨  门比较 [h,h]                                      → 「⑨ no switching state found in the harvest」
//   ⑩  续局子决策改走 actions[0]                          → 「⑩ settle#0 r=0: value(h)=… != independent …」
//   ⑪  单候选也跑一轮 / 忽略截止 / 忽略上限 / 不查 dec / 扩展局也置 fid → 各自的 ⑪ 行红
//   ⑬  模块绑定 window 而非 globalThis                     → worker 上下文 ReferenceError: window is not defined
//   ---- 审查修复轮（在工作树的临时副本上逐条变异 sim_sub.js，跑本测试；⑭ stage4 分支在「本副本 + Stage 4 sim.js/game.js」上跑）----
//   ⑭  fid 在 normalize 的 azDecision 之后才置位（原实现）   → 「⑭ stub: pre-draw state with opts.fid must throw …」
//                                                           （Stage 4 副本：「⑭ stage4: pre-draw Hacienda with opts.fid must throw」）
//   ⑭  去掉隐藏抽牌守卫                                   → 「⑭ stub: pre-draw state with st0._fid must throw」等 4 行
//                                                           （Stage 4 副本：「⑭ stage4: pre-draw Hacienda with st0._fid must throw」）
//   ⑭  守卫只看牌堆不看随机流                             → 「⑭ stub: normalization consuming randomness must throw」
//   ⑭  opts.fid 完全不置位（Stage 4 副本）                → 「⑭ stage4: own settle must add exactly the picked tile …: [2,2,2,2]」
//   ⑤s GATE_R0 = 30                                       → 「⑤s settle B=160: gate perms overlap selection or repeat (gate 30.., maxSel 59)」
//   ⑤s 各轮不前移 rNext（每轮从 r=0 重用）                → 「⑤s settle B=160: selection perms not fresh+consecutive across rounds: [[0,20],[0,40]]」
//   ⑤s 幸存数 ⌈|S|/2⌉ 改 max(1,⌊|S|/2⌋)                   → 「⑤s captain B=160: best/selPerms 10/26 vs ref 10/66」
//   ⑤c 每轮只按本轮和排名（不累计）                        → 「⑤c cumulative ranking: want A=1 (cumulative leader), got 2 …」
//   ⑦x SE 分母 n−1 改 n                                    → 「⑦x SE must use n−1: got 0.14433756729740643, want 0.14586499149789456」
//   ⑦x mean/SE ≥ z 改 >                                    → 「⑦x mean/SE == z exactly must switch (z=2.0121346252177057)」
//   ⑦x mean/SE ≥ z 改 > z+0.5                              → 「⑦x z just above 2 must switch …」
//   ⑩b 删掉 evalOne 里「先想一遍」的 azHeuristicAction      → 「⑩b build c=1 r=0: value=0.8733… != independent -0.0933…」
//   ①b st.rnd 改用另一条 per-r 流（非确定化流的延续）      → 「①b starved deck r=0: value(h)=-0.0533… != independent continuing-stream 0.8066…」
//   ⑪  默认硬上限改 Infinity                               → 「⑪ default hard cap: {… "nRollouts":50095 … "capped":false …}」
//   ⑪  注入求值器路径不查截止                               → 「⑪ maxMs=0 (injected evalBatch): calls=2 …」
//   ⑪  sameDec 不逐个比对动作                               → 「⑪ dec with same-length but different actions must throw」
