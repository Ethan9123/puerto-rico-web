// ============================================================
// tools/sub_census.js — 第三轮 Stage 5b：子决策搜索的 census（GO/NO-GO 门槛，无 α）
// ============================================================
// 这是 AI_STRENGTH §18.2「第 5 阶段 census」+「§18.2 补充 B」的**逐条**实现；补充 B 写定于本工具编写之前，
// 本文件只把它翻译成代码，不做任何取舍。任何与补充 B 的偏离都是 bug。
//
// 为什么需要 census：C_SUB（唯一确认性检验）要 960 局 × 2 臂。子决策搜索若在「模型」里都赚不到
// MDE（6pp 胜率份额/局），真实对局里就不可能测出来——先在模型里量它**实现的**收益，不够就不花那 2 小时。
// 又因为模型收益 ≠ 真实收益（§13.9 的建造 rollout 前瞻在模型里看着更好，真实对局 −11.8pp），
// 先拿同一把尺子去量 §13.9：尺子若说 §13.9 赚钱，这把尺子就是坏的 → NO-GO（校准）。
//
// 流水线（每个状态独立、确定；与分片方式无关）：
//   输入 = tools/eval_paired_worker.js 在 EVAL_HARVEST_SUB 下采到的行（每个 L6 子决策一行，见该文件头）。
//   ① 有效性：fid 重建为 null = 安全闸拒绝（逐类计数，合计 ≤2%）；game.js 实际一手必须 == fid 状态上的
//      azHeuristicAction（离线复算 + 采样时现算两路都比）；采样时的 PRSub 种子 == 离线种子（JSON 往返无损）；
//      过闸动作集 == 搜索的规范化动作集。另查（审查补的完整性条件，任一不满足 → INVALID）：每局 _end.cfg == 预注册
//      A2 采样配置（seedBase/CRN/DEPLOY/400/400/无覆盖/L6 零回退/fid 可用/带旧代码对照）；钩子内零随机数；
//      每个 build 状态都对照过真实 d4cbcd6 代码（及 endTriggered 的 §9）。
//   ② 决策：PRSub.subSearch(st, {fid:true, bSel:160, gateN:48, delta:0.02, z:2.0})，不给 maxMs（无墙钟上限，
//      只有默认 maxRollouts=2000 硬上限——预注册日程最多 160+96 次，碰不到）。
//   ③ 实现的收益：动作 == h → 0；否则 r = 3e6+k（k<64）上 mean[W(a,r) − W(h,r)]，W = 胜率份额叶
//      （终局本座位总分并列第一 k 家 → 1/k，否则 0），走 sim_sub 同一条管线（opts.leafValue，只换叶）。
//      r 区间与选择（r<1e6）、门（[1e6, 1e6+48)）都不相交 → 选择阶段的赢家诅咒不进收益。
//      收益按整数分子精确累加（n/768，见 DEN）→ 「Σ > 0」「≤ 0」「≥ 6.0 / 3.0」都是精确比较，与求和顺序无关。
//   ④ 每局 G_{g,kind} = Σ 收益；选种类（g100–129）：Σ_g G_{g,k} > 0 入选；估计（g130–159）：
//      Ĝ = 局均 Σ_{入选} G_{g,k}，按局自助 2000 次（固定种子），下界 = 第 5 百分位。以 pp/局 报告（×100）。
//   ⑤ 校准（§13.9）：60 局全部 L6 build 状态，逐行复刻 d4cbcd6 vnetPickBuilding 的 rollout 评估器
//      （旧口径状态 = 原样 buildSimState(G) + 旧游标；真实牌序；K=2；允许 PASS；seed0 公式；rolloutToEnd ε=0.05；
//      reward；严格 > 取首个）得 a₁₃.₉ → 用 ③ 的同一评估器量收益 → 局均 > 0 ⇒ 校准失败 ⇒ NO-GO。另报 90% 区间与接管率。
//      「全部」build 状态含 fid 闸拒的：a₁₃.₉ == 实际一手 → 收益恰 0；闸拒且接管 → 不可测 → INVALID（不静默丢弃）。
//   ⑥ §9（描述性）：endTriggered 的 build 状态上 solveEndgame(旧口径状态, 2e6)（d4cbcd6 solverPickBuilding 逐行）→ 同一评估器。
//   ⑦ GO ⇔ 有效 且 校准通过 且 Ĝ ≥ 6.0pp 且 下界 ≥ 3.0pp；GO 的种类 = 选择半入选的种类。
//   ⑧ 描述性（不在补充 B 里、不进判定）：selfAgreement——确定性 0→1 翻转数、模型内朴素 K=2 挑选器的 census 收益。
//      census 用 PRSub 所优化的同一个模型来量 PRSub；§13.9 校准是在**另一个**模型里选的动作，量不出这种自洽偏差。
//      读 GO 时把 Ĝ 与这条参照线并列：GO 只说明「模型内收益够大、尺子没把 §13.9 量成正」，不是真实效应量的预测。
//
// 确定性：每个状态的全部计算只依赖该行；自助用固定种子；报告 JSON 不含耗时/路径以外的环境信息
//   → 同一输入重跑逐字节相同（分片数不同也相同：合并时按 (g, k) 排序）。
//
// 用法：
//   node tools/sub_census.js eval   <harvest.jsonl>[,<more>...] --shard k/M --out part_k.jsonl   # 求值一片（每个状态一行）
//   node tools/sub_census.js report <harvest.jsonl>[,<more>...] --parts p0.jsonl,p1.jsonl,... --out report.json
//   node tools/sub_census.js run    <harvest.jsonl>[,<more>...] --out report.json                 # 单进程 eval + report
//   可选（**非预注册**，仅冒烟/调试；报告里 preregistered=false，判定行加 [NON-PREREG] 前缀）：
//     --games A-B   期望的局集合（默认 100-159）      --sel-end S   选择半 = g < S（默认 130）
//
// 预注册的完整 census（4 核；orchestrator 执行，见 AI_STRENGTH §18.2 补充 B）：
//   T=<dir>; mkdir -p $T/d4cbcd6 && git archive d4cbcd6 | tar -x -C $T/d4cbcd6     # 旧引擎拷贝（§13.9/§9 逐状态对照真实旧代码）
//   for r in "100 115" "115 130" "130 145" "145 160"; do set -- $r
//     EVAL_CRN=1 EVAL_HARVEST_SUB=$T/h$1.jsonl EVAL_HARVEST_OLD=$T/d4cbcd6 \
//       node tools/eval_paired_worker.js DEPLOY 5 $1 $2 $T/rows$1.jsonl 20261123 & done; wait
//   （EVAL_HARVEST_OLD 必需：liveCheck 须覆盖全部 build 状态（及 endTriggered 的 §9），「复刻 == 真实 d4cbcd6 代码」逐条成立，
//    缺任何一条或任何一条不等 → INVALID。seedBase 20261123 与 EVAL_CRN=1 也必需（_end.cfg 核对）。
//    对局行 rows*.jsonl 与不带钩子的同参数运行逐字节相同。）
//   H=$T/h100.jsonl,$T/h115.jsonl,$T/h130.jsonl,$T/h145.jsonl
//   for k in 0 1 2 3; do node tools/sub_census.js eval $H --shard $k/4 --out $T/part$k.jsonl & done; wait
//   node tools/sub_census.js report $H --parts $T/part0.jsonl,$T/part1.jsonl,$T/part2.jsonl,$T/part3.jsonl --out $T/census.json
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

// ---------------- 预注册常数（§18.2 补充 B；不得改）----------------
const PREREG = Object.freeze({
  seedBase: 20261123, games: [100, 159], selEnd: 130,        // 选择半 g100–129，估计半 g130–159
  search: Object.freeze({ fid: true, bSel: 160, gateN: 48, delta: 0.02, z: 2.0 }),
  gainR0: 3000000, gainN: 64,                                   // 收益 perm：r = 3e6 + k
  boot: 2000, bootSeed: 20261123,                               // 按局自助
  goMean: 6.0, goLower: 3.0,                                    // pp/局
  gateMaxRate: 0.02,                                            // 安全闸拒绝合计 ≤ 2%
  k139: 2, solverCap: 2e6,
  // 采样配置（补充 B「采样」= A2 配置）：每局 _end 行的 cfg 逐项核对，不符 → INVALID。budget 是 eval_paired_worker 写死的
  // 迭代上限档（ms=1e9 → 纯迭代数决定、给定种子完全确定）；l6fb = L6 选角回退次数（§18.2：任何 L6 回退 → 该臂无效）；
  // oldCheck = 采样时逐状态调用了真实 d4cbcd6 代码（EVAL_HARVEST_OLD；§13.9/§9 复刻的逐条等价证据，预注册运行必需）。
  harvest: Object.freeze({ seedBase: 20261123, crn: true, lo: 5, nn: 'DEPLOY',
    budget: { L4: 50, L5: 100, hardIters: 60, hardMs: 1e9, expertIters: 400, expertMs: 1e9, alphaIters: 400, alphaMs: 1e9 },
    heur: null, knobs: null, alphaC: null, endBoost: null, l6Solver: false, l6SolverCap: null, rpK: 0, mods: {},
    l6Fid: false, fidAllowed: true, l6fb: 0, oldCheck: true }),
  // 描述性（**不在**补充 B 里、不进判定）：模型内朴素 K=2 挑选器的 perm，与选择 / 门 / 收益 perm 都不相交
  naiveR0: 5000000, naiveK: 2,
});
// 收益精确累加：W ∈ {0, 1/4, 1/3, 1/2, 1}（4 人局 k 家并列 → 1/k）→ 12·(W(a) − W(h)) 恒为整数；
// 一个决策的收益 = n / DEN，n = Σ_r 12·(W(a,r) − W(h,r)) 为整数，DEN = 12 × 64 = 768。
// 为什么不用浮点：「Σ > 0 入选」「局均 ≤ 0 校准通过」「Ĝ ≥ 6.0 / 下界 ≥ 3.0」都是**恰在 0 / 恰在门槛**上有定义的规则，
// 1/3 这种不可精确表示的份额按不同顺序相加会在有理数恰为 0 时给出 ±7e-18（审查复现过），把预注册排除的种类选进来。
// 整数（|n| ≤ 768/决策，全部求和 < 2^53）→ 所有比较都是精确的有理数比较，与求和顺序无关。
const DEN = 12 * PREREG.gainN;
const KINDS = ['build', 'settle', 'trade', 'craftbonus', 'captain'];

// ---------------- 胜率份额叶 W ----------------
// 终局本座位总分（sim finalScore = vp 筹码 + 建筑分 + 特殊分，与 eval_paired_worker 的 totals 同口径）并列第一 k 家 → 1/k，否则 0。
// （rollout 守卫截断的非终局也按当时总分算，与 reward 的处理一致。）
function winShare(S, st, seat) {
  let best = -Infinity, k = 0;
  const sc = new Array(st.players.length);
  for (let i = 0; i < st.players.length; i++) { sc[i] = S.finalScore(st.players[i], st); if (sc[i] > best) best = sc[i]; }
  for (let i = 0; i < sc.length; i++) if (sc[i] === best) k++;
  return sc[seat] === best ? 1 / k : 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function range(a, b) { const o = []; for (let i = a; i < b; i++) o.push(i); return o; }

// ---------------- 引擎 ----------------
let _eng = null;
function engine() {
  if (_eng) return _eng;
  const { loadEngine } = require('./_sandbox.js');
  const { sandbox, PRSim } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_solve.js', 'sim_sub.js'] });
  if (!PRSim || typeof PRSim.solveEndgame !== 'function' || !sandbox.PRSub) throw new Error('sub_census: engine not loaded');
  // 旧 vnetPickBuilding 的 rolloutToEnd 用默认 ε=0.05（root._mctsEps 未设）；本沙盒也不得设它
  if (sandbox._mctsEps != null) throw new Error('sub_census: _mctsEps must be unset (default 0.05)');
  _eng = { S: PRSim, X: sandbox.PRSub, sb: sandbox };
  return _eng;
}

// 旧口径状态上的哑随机流：旧代码里 st.rnd = 真实对局的 Math.random，但 §13.9 每个 rollout 都换成 mkRnd，
// 起点的 azDecision 不取随机数。这里给一条计数流：调用次数进报告（应恒为 0；非 0 说明起点就要抽隐藏牌）。
function guardRnd(ctr) { const r = mulberry32(0x5eed139); return () => { ctr.n++; return r(); }; }

// ---------------- §13.9：d4cbcd6 vnetPickBuilding（_l6VnetBuild=true, _l6BuildEval='rollout', _l6VnetBuildSamples=2）逐行复刻 ----------------
// 返回 {a, why}：a = az 动作（建筑 id 或 AZ_PASS）；a = null ⇔ 旧函数返回 null（→ 真实对局回退启发式 aiPickBuilding）。
// 与旧源码的对应（git show d4cbcd6:game.js，vnetPickBuilding ~3891）逐行标注；门前检查（_l6VnetBuild / _aiLevel / PRSim 函数 /
// useRollout / aiUnmodeledMods / numPlayers）在 A2 基础局的 L6 座位上全部放行，不重复。
function pick139(S, old, ctr) {
  try {
    const st = JSON.parse(JSON.stringify(old.st));                       // const st = buildSimState(G);
    st.rnd = guardRnd(ctr);                                              //   （rnd: Math.random → 计数哑流）
    const bcard = st.roleCards.find(r => r.name === 'Builder');          // const bcard = …
    const chooser = bcard ? bcard.takenBy : null;
    if (chooser == null) return { a: null, why: 'no-builder' };
    const N = st.numPlayers;
    const ord = []; for (let k = 0; k < N; k++) ord.push((chooser + k) % N);
    const oi = ord.indexOf(old.pidx);
    if (oi < 0) return { a: null, why: 'oi' };
    st.az = { phase: 'builder', chooser, ord, oi };                      // 旧游标：picksThisTurn 不减一
    const dec = S.azDecision(st);
    if (!dec || dec.type !== 'build' || dec.chooser !== old.pidx) return { a: null, why: 'dec' };
    const azIds = dec.actions.filter(a => a >= 0).sort((a, b) => a - b);
    const gameIds = old.opts.slice().sort((a, b) => a - b);              // options.map(o => o.b.id).sort
    if (azIds.length !== gameIds.length || azIds.some((id, i) => id !== gameIds[i])) return { a: null, why: 'gate' };
    const allowPass = true;                                              // window._l6VnetBuildPass !== false（未设）
    const seed0 = (((old.turn | 0) * 73856093) ^ ((old.pidx | 0) * 19349663) ^ ((st.plantationDeck.length | 0) * 83492791)) >>> 0;
    const mkRnd = (s) => { let a = s >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const K = Math.max(1, PREREG.k139);                                  // _l6VnetBuildSamples = 2
    let bestAct = null, bestV = -Infinity;
    for (const act of dec.actions) {
      if (act < 0 && !allowPass) continue;
      let acc = 0;
      for (let k = 0; k < K; k++) {
        const st2 = S.clone(st);
        st2.rnd = mkRnd(seed0 + k * 0x9E3779B9);                         // 注意：浮点加法后才 >>>0（与旧代码同）
        S.azApply(st2, act);
        let d2 = S.azDecision(st2), guard = 0;
        while (d2 && d2.type !== 'role' && guard++ < 400) {
          S.azApply(st2, S.azHeuristicAction(st2, d2));
          d2 = S.azDecision(st2);
        }
        let v;
        if (S.isTerminal(st2)) v = S.reward(st2, old.pidx);
        else { S.rolloutToEnd(st2, st2.rnd); v = S.reward(st2, old.pidx); }   // _l6BuildEval === 'rollout'
        acc += v;
      }
      const vAvg = acc / K;
      if (vAvg > bestV) { bestV = vAvg; bestAct = act; }                  // 严格 > → 平手取首个
    }
    if (bestAct == null) return { a: null, why: 'none' };
    if (bestAct < 0) return { a: S.AZ_PASS, why: 'ok' };                  // return -1 → doBuilder 跳过建造
    const idx = old.opts.findIndex(id => id === bestAct);
    return idx >= 0 ? { a: bestAct, why: 'ok' } : { a: null, why: 'idx' };
  } catch (e) { return { a: null, why: 'throw:' + String((e && e.message) || e).slice(0, 80) }; }
}

// ---------------- §9：d4cbcd6 solverPickBuilding 逐行复刻（_l6SolverBuild=true, cap 2e6）----------------
function pickSolver(S, old, ctr) {
  try {
    const st = JSON.parse(JSON.stringify(old.st));
    st.rnd = guardRnd(ctr);
    if (!st.endTriggered) return { a: null, why: 'notEnd' };             // 仅终局触发后
    const bcard = st.roleCards.find(r => r.name === 'Builder');
    const chooser = bcard ? bcard.takenBy : null;
    if (chooser == null) return { a: null, why: 'no-builder' };
    const N = st.numPlayers;
    const ord = []; for (let k = 0; k < N; k++) ord.push((chooser + k) % N);
    const oi = ord.indexOf(old.pidx);
    if (oi < 0) return { a: null, why: 'oi' };
    st.az = { phase: 'builder', chooser, ord, oi };
    const dec = S.azDecision(st);
    if (!dec || dec.type !== 'build' || dec.chooser !== old.pidx) return { a: null, why: 'dec' };
    const azIds = dec.actions.filter(a => a >= 0).sort((a, b) => a - b);
    const gameIds = old.opts.slice().sort((a, b) => a - b);
    if (azIds.length !== gameIds.length || azIds.some((id, i) => id !== gameIds[i])) return { a: null, why: 'gate' };
    const sol = S.solveEndgame(st, PREREG.solverCap);                    // 超预算 → null → 回退
    if (!sol || sol.action == null) return { a: null, why: 'budget' };
    if (sol.action < 0) return { a: S.AZ_PASS, why: 'ok', nodes: sol.nodesUsed };
    const idx = old.opts.findIndex(id => id === sol.action);
    return idx >= 0 ? { a: sol.action, why: 'ok', nodes: sol.nodesUsed } : { a: null, why: 'idx' };
  } catch (e) { return { a: null, why: 'throw:' + String((e && e.message) || e).slice(0, 80) }; }
}

// ---------------- 单状态求值 ----------------
// census 评估器：a 相对 h 的实现收益（fid 状态、64 个 perm、胜率份额叶、sim_sub 同一管线）。
// 返回整数 n（收益 = n / DEN，见 DEN 的注释）；每个 perm 的 12·ΔW 不是整数（如 5 人局 1/5 份额）→ 抛错，不静默舍入。
function gainOf(E, stF, dec, a, h) {
  if (a === h) return 0;
  if (dec.actions.indexOf(a) < 0) throw new Error('gainOf: action ' + a + ' not in fid action set');
  const rs = range(PREREG.gainR0, PREREG.gainR0 + PREREG.gainN);
  const v = E.X.subEvalBatch(stF, dec, [a, h], rs, { fid: true, leafValue: (st, seat) => winShare(E.S, st, seat) });
  let n = 0;
  for (let k = 0; k < rs.length; k++) {
    const x = 12 * (v[0][k] - v[1][k]), xi = Math.round(x);
    if (!(Math.abs(x - xi) < 1e-9)) throw new Error('gainOf: 12·ΔW = ' + x + ' is not an integer (win share outside {0,1/4,1/3,1/2,1})');
    n += xi;
  }
  return n;
}

// 描述性（非预注册，不进判定；审查意见 7）：**模型内**的朴素 K=2 挑选器——在 census 自己的 fid 模型、自己的管线
// （sim_sub，reward 叶）上对每个候选取 2 个 perm r = 5e6+{0,1} 的均值，严格 > 取 dec.actions 序首个（与 §13.9 同式，
// 但不带 §13.9 的「另一个模型」：非 fid 启发式、旧游标、ε=0.05、真实牌序）。它和 PRSub 一样在「度量用的模型」里优化，
// 所以它的 census 收益 ≈「任何模型内优化器白拿的自洽分」——读 Ĝ 时的参照线：Ĝ 若与它同量级，Ĝ 主要是自洽而非真实收益。
function pickNaive(E, stF, dec) {
  const rs = range(PREREG.naiveR0, PREREG.naiveR0 + PREREG.naiveK);
  const v = E.X.subEvalBatch(stF, dec, dec.actions, rs, { fid: true });
  let best = null, bv = -Infinity;
  for (let i = 0; i < dec.actions.length; i++) {
    let s = 0; for (let k = 0; k < rs.length; k++) s += v[i][k];
    const m = s / rs.length;
    if (m > bv) { bv = m; best = dec.actions[i]; }
  }
  return best;
}

const sortedJ = (a) => JSON.stringify(a.slice().sort((x, y) => x - y));

// 收益字段：gainN = 整数分子（判定只用它），gain = gainN / DEN（仅供阅读）。
function evalRecord(E, rec) {
  const S = E.S, X = E.X;
  const out = { g: rec.g, seat: rec.seat, kind: rec.kind, k: rec.k, game: rec.game };
  if (rec.hookErr) { out.hookErr = rec.hookErr; return out; }
  if (rec.hookRand) out.hookRand = rec.hookRand;
  if (rec.fidAllowed === false) out.fidNotAllowed = 1;
  let stF = null, dec = null, h = null;
  if (!rec.fid) { out.gateNull = true; }
  else {
    stF = rec.fid;
    const pr = X.subSearchSteps(S.clone(stF), { fid: true });            // 规范化后的 dec / h / 种子（离线）
    if (!pr) { out.err = 'not-a-sub-decision'; return out; }
    dec = pr.dec; h = pr.h;
    out.nCand = dec.actions.length;
    // ① 有效性：实际一手 ≡ fid 启发式（离线）；采样时现算的 h 与种子 == 离线（JSON 往返无损）
    out.h = h;
    out.mismatch = (rec.game !== h) ? 1 : 0;
    out.liveMismatch = (rec.hLive !== h || rec.seedLive !== pr.seed || JSON.stringify(rec.decLive) !== JSON.stringify(dec.actions)) ? 1 : 0;
    // 过闸的动作集（采样时 simStateAtSubDecision 在 fid 状态上判的，rec.dec）== census 实际搜索的规范化动作集（集合比较，
    // 与闸同一规则）。不等 = 搜索/量收益的候选不是 game.js 在该点真有的选项 → INVALID（审查意见 4）。
    out.decSet = (!rec.dec || sortedJ(rec.dec.actions) !== sortedJ(dec.actions)) ? 1 : 0;
    // ② 决策（预注册参数，无墙钟上限）
    const r = X.subSearch(stF, Object.assign({}, PREREG.search));
    out.sub = { action: r.action, best: r.best, switched: r.switched, gate: r.gate, nRollouts: r.nRollouts, capped: r.capped, timedOut: r.timedOut };
    if (r.h !== h) out.mismatch = 1;
    // ③ 实现的收益
    out.gainN = gainOf(E, stF, dec, r.action, h); out.gain = out.gainN / DEN;
    // 描述性：模型内朴素 K=2 挑选器（见 pickNaive）
    const aN = pickNaive(E, stF, dec), nN = gainOf(E, stF, dec, aN, h);
    out.naive = { a: aN, take: aN !== h ? 1 : 0, gainN: nN };
  }
  // ⑤ ⑥ 建造：§13.9 与 §9（旧口径状态）——补充 B 说「60 局**全部** L6 build 状态」，所以 fid 闸拒的 build 状态也要算：
  //   基准 hB：有 fid 状态 → fid 启发式 h（== 实际一手，mismatch 已查）；闸拒 → 实际一手 rec.game（真实对局里旧函数返回
  //   null 时回退的正是这同一个 aiPickBuilding）。a == hB → 收益恰为 0（定义如此，不需要模型）；
  //   闸拒且旧规则接管（a ≠ hB）→ 没有 fid 状态可量 → gainN = null，report 判 INVALID（不静默丢掉，审查意见 1）。
  if (rec.kind === 'build' && rec.old) {
    const hB = dec ? h : rec.game;
    const meas = (a) => a === hB ? 0 : (dec ? gainOf(E, stF, dec, a, h) : null);
    const c1 = { n: 0 }, a = pick139(S, rec.old, c1);
    const a139 = a.a === null ? hB : a.a;                                // null → 真实对局回退启发式
    const g139 = meas(a139);
    out.b139 = { a: a139, why: a.why, take: a139 !== hB ? 1 : 0, gainN: g139, gain: g139 === null ? null : g139 / DEN, rnd: c1.n };
    if (rec.old139Live !== undefined) out.b139.live = rec.old139Live === null ? hB : rec.old139Live, out.b139.eqLive = (out.b139.live === a139) ? 1 : 0;
    if (rec.old.endT) {
      const c2 = { n: 0 }, sv = pickSolver(S, rec.old, c2);
      const aS = sv.a === null ? hB : sv.a;
      const gS = meas(aS);
      out.sol = { a: aS, why: sv.why, take: aS !== hB ? 1 : 0, gainN: gS, gain: gS === null ? null : gS / DEN, rnd: c2.n, nodes: sv.nodes || null };
      if (rec.oldSolLive !== undefined) out.sol.live = rec.oldSolLive === null ? hB : rec.oldSolLive, out.sol.eqLive = (out.sol.live === aS) ? 1 : 0;
    }
    if (rec.oldRnd) out.oldRnd = rec.oldRnd;
  }
  return out;
}

// ---------------- 读采样 ----------------
function readHarvest(files) {
  const recs = [], ends = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const line of txt.split('\n')) {
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.kind === '_end') ends.push(o); else recs.push(o);
    }
  }
  const key = (o) => o.g * 1e6 + o.k;
  recs.sort((a, b) => key(a) - key(b));
  ends.sort((a, b) => a.g - b.g);
  return { recs, ends };
}

// ---------------- 统计 ----------------
// 按局自助：固定种子；每次有放回抽 n 局求**和**（vals 是整数分子 → 和是精确整数；均值 = 和 / n，排序与比较都用和）；
// 分位用最近秩法：q_p = 排序后第 ⌈p·B⌉ 个（1 起）。返回 5%/95% 分位处的**和**（整数，单位 1/DEN）。
function bootstrap(vals, B, seed) {
  const n = vals.length, rnd = mulberry32(seed >>> 0), ms = new Float64Array(B);
  if (!n) return { lo5Sum: null, hi95Sum: null, n };
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += vals[Math.floor(rnd() * n)]; ms[b] = s; }
  const so = Array.from(ms).sort((x, y) => x - y);
  return { lo5Sum: so[Math.ceil(0.05 * B) - 1], hi95Sum: so[Math.ceil(0.95 * B) - 1], n };
}
// 整数分子的和 / 局数 → pp/局，保留 6 位（仅显示；判定用整数比较）
const ppN = (sum, n) => sum == null || !n ? null : Math.round(sum / n / DEN * 100 * 1e6) / 1e6;
const isum = (a) => { let s = 0; for (const x of a) s += x; return s; };
// 采样配置核对：返回与预注册不同的键（按 PREREG.harvest 的键序；seed 另按 seedBase 公式核对）
function cfgDiff(e) {
  if (!e.cfg) return ['cfg-missing'];
  const d = [];
  for (const k of Object.keys(PREREG.harvest)) if (JSON.stringify(e.cfg[k]) !== JSON.stringify(PREREG.harvest[k])) d.push(k + '=' + JSON.stringify(e.cfg[k]));
  if (e.cfg.seed !== ((PREREG.harvest.seedBase + e.g * 1000003) >>> 0)) d.push('seed=' + e.cfg.seed);
  return d;
}

function report(harvestFiles, results, o) {
  const { recs, ends } = readHarvest(harvestFiles);
  const games = range(o.games[0], o.games[1] + 1);
  const selEnd = o.selEnd;
  const prereg = o.games[0] === PREREG.games[0] && o.games[1] === PREREG.games[1] && selEnd === PREREG.selEnd;
  const byKey = new Map();
  for (const r of results) {
    const kk = r.g + ':' + r.k;
    if (byKey.has(kk)) throw new Error('duplicate result ' + kk + ' (overlapping shards?)');
    byKey.set(kk, r);
  }
  const V = { reasons: [] };
  // 覆盖：每个采样行恰好一个结果
  let missingRes = 0; for (const rec of recs) if (!byKey.has(rec.g + ':' + rec.k)) missingRes++;
  if (missingRes || byKey.size !== recs.length) V.reasons.push(`results cover ${byKey.size}/${recs.length} harvested records (missing ${missingRes})`);
  // 局集合与对局有效性
  const endBy = new Map(ends.map(e => [e.g, e]));
  const missingGames = games.filter(g => !endBy.has(g));
  const badGames = ends.filter(e => e.row !== 'ok').map(e => e.g + ':' + e.row);
  const extraGames = ends.filter(e => e.g < o.games[0] || e.g > o.games[1]).map(e => e.g);
  if (missingGames.length) V.reasons.push('missing games ' + missingGames.join(','));
  if (badGames.length) V.reasons.push('error/incomplete games ' + badGames.join(','));
  if (extraGames.length) V.reasons.push('games outside the expected range ' + extraGames.join(','));
  for (const e of ends) { const n = recs.filter(r => r.g === e.g).length; if (n !== e.n) V.reasons.push(`game ${e.g}: ${n} records vs ${e.n} hooked`); }
  // 采样配置 == 预注册 A2 配置（含 L6 零回退、fid 可用、带真实旧代码对照）——不看 --games/--sel-end（冒烟也照查）
  const cfgBad = ends.map(e => ({ g: e.g, d: cfgDiff(e) })).filter(x => x.d.length);
  if (cfgBad.length) V.reasons.push(`harvest config differs from the pre-registered A2 sampling on ${cfgBad.length} games (` +
    cfgBad.slice(0, 3).map(x => 'g' + x.g + ': ' + x.d.join(' ')).join('; ') + (cfgBad.length > 3 ? '; …' : '') + ')');

  const res = recs.map(rec => byKey.get(rec.g + ':' + rec.k)).filter(Boolean);
  const perKind = {};
  for (const k of KINDS) perKind[k] = { n: 0, gateNull: 0, evaluated: 0, multi: 0, switched: 0, gainSum: 0, mismatch: 0, liveMismatch: 0, decSet: 0, capped: 0, timedOut: 0, rollouts: 0,
    naiveTake: 0, naiveSum: 0 };
  let hookErr = 0, hookRand = 0, errs = 0, other = 0, fidNA = 0;
  for (const r of res) {
    const c = perKind[r.kind]; if (!c) { other++; continue; }
    c.n++;
    if (r.hookErr) { hookErr++; continue; }
    if (r.hookRand) hookRand += r.hookRand;
    if (r.fidNotAllowed) fidNA++;
    if (r.err) { errs++; continue; }
    if (r.gateNull) { c.gateNull++; continue; }
    c.evaluated++; if (r.nCand > 1) c.multi++;
    c.mismatch += r.mismatch; c.liveMismatch += r.liveMismatch; c.decSet += r.decSet;
    c.switched += r.sub.action !== r.h ? 1 : 0; c.gainSum += r.gainN; c.rollouts += r.sub.nRollouts;
    if (r.sub.capped) c.capped++; if (r.sub.timedOut) c.timedOut++;
    if (r.naive) { c.naiveTake += r.naive.take; c.naiveSum += r.naive.gainN; }
  }
  const tot = (f) => KINDS.reduce((s, k) => s + perKind[k][f], 0);
  const nAll = tot('n'), gateAll = tot('gateNull'), mism = tot('mismatch'), liveMism = tot('liveMismatch'), decSetBad = tot('decSet');
  if (other) V.reasons.push(`${other} records of unknown kind`);
  if (hookErr) V.reasons.push(`${hookErr} hook errors during harvest`);
  if (hookRand) V.reasons.push(`${hookRand} Math.random calls inside the harvest hook (the rebuild must not draw hidden cards)`);
  if (fidNA) V.reasons.push(`${fidNA} records where l6FidAllowed() was false (fid model not applicable)`);
  if (errs) V.reasons.push(`${errs} records not at a sub-decision`);
  if (!nAll) V.reasons.push('no L6 sub-decisions');
  if (nAll && gateAll / nAll > PREREG.gateMaxRate) V.reasons.push(`gate rejections ${gateAll}/${nAll} = ${(100 * gateAll / nAll).toFixed(2)}% > 2%`);
  if (mism) V.reasons.push(`${mism} mismatches between the recorded game choice and azHeuristicAction on the fid state`);
  if (liveMism) V.reasons.push(`${liveMism} records whose live (harvest-time) h/seed/actions differ from the offline recomputation (JSON round-trip)`);
  if (decSetBad) V.reasons.push(`${decSetBad} records whose gate-checked action set differs from the searched (normalized fid) action set`);

  // 每局 × 种类（整数分子，单位 1/DEN）
  const Gk = new Map(games.map(g => [g, Object.fromEntries(KINDS.map(k => [k, 0]))]));
  const G139 = new Map(games.map(g => [g, 0])), GSol = new Map(games.map(g => [g, 0])), GNaive = new Map(games.map(g => [g, 0]));
  let nBuild = 0, n139 = 0, take139 = 0, rnd139 = 0, eq139 = 0, live139 = 0, gn139 = 0, gnTake139 = 0, unmeas139 = 0;
  let nSol = 0, takeSol = 0, eqSol = 0, liveSol = 0, rndSol = 0, unmeasSol = 0, oldRnd = 0;
  let nSw = 0, fullUp = 0, fullDown = 0, fullUpSum = 0, posSum = 0;
  const why139 = {}, whySol = {};
  for (const r of res) {
    if (!Gk.has(r.g) || r.hookErr || r.err || !perKind[r.kind]) continue;
    if (!r.gateNull) {
      Gk.get(r.g)[r.kind] += r.gainN;
      if (r.naive) GNaive.set(r.g, GNaive.get(r.g) + r.naive.gainN);
      if (r.sub.action !== r.h) {
        nSw++; if (r.gainN > 0) posSum += r.gainN;
        if (r.gainN === DEN) { fullUp++; fullUpSum += r.gainN; } else if (r.gainN === -DEN) fullDown++;
      }
    }
    // §13.9 / §9：闸拒的 build 状态也在内（「全部 L6 build 状态」；见 evalRecord）
    if (r.kind === 'build') nBuild++;
    if (r.b139) {
      n139++; take139 += r.b139.take; rnd139 += r.b139.rnd;
      if (r.gateNull) { gn139++; gnTake139 += r.b139.take; }
      if (r.b139.gainN === null) unmeas139++; else G139.set(r.g, G139.get(r.g) + r.b139.gainN);
      why139[r.b139.why] = (why139[r.b139.why] || 0) + 1;
      if (r.b139.eqLive !== undefined) { live139++; eq139 += r.b139.eqLive; }
    }
    if (r.sol) {
      nSol++; takeSol += r.sol.take; rndSol += r.sol.rnd;
      if (r.sol.gainN === null) unmeasSol++; else GSol.set(r.g, GSol.get(r.g) + r.sol.gainN);
      whySol[r.sol.why] = (whySol[r.sol.why] || 0) + 1;
      if (r.sol.eqLive !== undefined) { liveSol++; eqSol += r.sol.eqLive; }
    }
    if (r.oldRnd) oldRnd += r.oldRnd;
  }
  // 校准覆盖：每个 build 状态（含闸拒）都有 a₁₃.₉；每个都对照过真实 d4cbcd6 代码；闸拒且接管的状态收益不可测 → INVALID
  if (n139 !== nBuild) V.reasons.push(`§13.9 evaluated on ${n139}/${nBuild} build states (old-cursor state missing)`);
  if (unmeas139) V.reasons.push(`§13.9 takes over on ${unmeas139} build states the fid gate rejected (gain not measurable by the census evaluator)`);
  if (live139 !== n139) V.reasons.push(`real d4cbcd6 vnetPickBuilding check covers ${live139}/${n139} build states (harvest must run with EVAL_HARVEST_OLD)`);
  if (liveSol !== nSol) V.reasons.push(`real d4cbcd6 solverPickBuilding check covers ${liveSol}/${nSol} endTriggered build states (harvest must run with EVAL_HARVEST_OLD)`);
  if (eq139 !== live139) V.reasons.push(`§13.9 re-implementation disagrees with the real d4cbcd6 vnetPickBuilding on ${live139 - eq139}/${live139} build states`);
  if (eqSol !== liveSol) V.reasons.push(`§9 re-implementation disagrees with the real d4cbcd6 solverPickBuilding on ${liveSol - eqSol}/${liveSol} states`);

  const selG = games.filter(g => g < selEnd), estG = games.filter(g => g >= selEnd);
  const sumK = (gs, k) => gs.reduce((s, g) => s + Gk.get(g)[k], 0);
  const selSums = Object.fromEntries(KINDS.map(k => [k, sumK(selG, k)]));
  const selected = KINDS.filter(k => selSums[k] > 0);                       // 整数 > 0：精确
  const estVals = estG.map(g => selected.reduce((s, k) => s + Gk.get(g)[k], 0));
  const estSum = isum(estVals), bs = bootstrap(estVals, PREREG.boot, PREREG.bootSeed);
  const cal = games.map(g => G139.get(g)), calSum = isum(cal), calBs = bootstrap(cal, PREREG.boot, PREREG.bootSeed);
  const sol = games.map(g => GSol.get(g)), solSum = isum(sol), solBs = bootstrap(sol, PREREG.boot, PREREG.bootSeed);
  const nv = games.map(g => GNaive.get(g)), nvBs = bootstrap(nv, PREREG.boot, PREREG.bootSeed);
  const gameTot = games.map(g => KINDS.reduce((s, k) => s + Gk.get(g)[k], 0));

  const valid = V.reasons.length === 0;
  const calPass = calSum <= 0;
  const verdict = decide({ reasons: V.reasons, calSum, calN: games.length, selected, estSum, estN: estG.length, lo5Sum: bs.lo5Sum });

  const perKindOut = {};
  for (const k of KINDS) {
    const c = perKind[k];
    perKindOut[k] = { n: c.n, gateNull: c.gateNull, gateRate: c.n ? Math.round(1e6 * c.gateNull / c.n) / 1e6 : null, evaluated: c.evaluated, multiCandidate: c.multi,
      switched: c.switched, switchRate: c.evaluated ? Math.round(1e6 * c.switched / c.evaluated) / 1e6 : null, mismatch: c.mismatch, liveMismatch: c.liveMismatch, decSetMismatch: c.decSet,
      capped: c.capped, timedOut: c.timedOut, rollouts: c.rollouts,
      gainPpPerGameAll: ppN(c.gainSum, games.length), selSumPp: ppN(selSums[k], 1), estMeanPp: ppN(sumK(estG, k), estG.length) };
  }
  return {
    census: 'AI_STRENGTH §18.2 补充 B (Stage 5b)', preregistered: prereg,
    config: { games: o.games, selectionGames: [selG[0], selG[selG.length - 1]], estimationGames: [estG[0], estG[estG.length - 1]], search: PREREG.search,
      gainPerms: [PREREG.gainR0, PREREG.gainR0 + PREREG.gainN - 1], leaf: 'win share (1/k for a k-way tie for best final total, else 0)',
      arithmetic: `exact: per-decision gain = n/${DEN}, n integer; all rules compared on integer sums`, harvest: PREREG.harvest,
      bootstrap: { B: PREREG.boot, seed: PREREG.bootSeed, lower: 'nearest-rank 5th percentile', upper: 'nearest-rank 95th percentile' } },
    validity: { valid, reasons: V.reasons, records: recs.length, l6SubDecisions: nAll, gateNull: gateAll, gateRate: nAll ? Math.round(1e6 * gateAll / nAll) / 1e6 : null,
      mismatches: mism, liveMismatches: liveMism, decSetMismatches: decSetBad, hookErrors: hookErr, hookRandCalls: hookRand, fidNotAllowed: fidNA,
      games: ends.length, badGames, missingGames, configMismatchGames: cfgBad.map(x => x.g) },
    perKind: perKindOut,
    selection: { sumsPp: Object.fromEntries(KINDS.map(k => [k, ppN(selSums[k], 1)])), sumsN: selSums, selected },
    estimate: { kinds: selected, n: estG.length, meanPp: ppN(estSum, estG.length), lo5Pp: ppN(bs.lo5Sum, estG.length), hi95Pp: ppN(bs.hi95Sum, estG.length),
      sumN: estSum, lo5SumN: bs.lo5Sum, threshold: { meanPp: PREREG.goMean, lo5Pp: PREREG.goLower } },
    calibration139: { states: n139, gateRejectedStates: gn139, gateRejectedTakeovers: gnTake139, unmeasurable: unmeas139,
      takeover: take139, takeoverRate: n139 ? Math.round(1e6 * take139 / n139) / 1e6 : null, meanPp: ppN(calSum, games.length), lo5Pp: ppN(calBs.lo5Sum, games.length), hi95Pp: ppN(calBs.hi95Sum, games.length),
      sumN: calSum, pass: calPass, rule: 'fail iff mean per-game gain > 0 (real result −11.8pp)', why: why139, startRndCalls: rnd139,
      liveCheck: { compared: live139, identical: eq139, oldRndCalls: oldRnd } },
    solver9: { descriptive: true, states: nSol, takeover: takeSol, unmeasurable: unmeasSol, meanPp: ppN(solSum, games.length), lo5Pp: ppN(solBs.lo5Sum, games.length), hi95Pp: ppN(solBs.hi95Sum, games.length),
      why: whySol, startRndCalls: rndSol, real: '+3.3pp @40 iters, +0.9pp @150 iters (AI_STRENGTH §9)', liveCheck: { compared: liveSol, identical: eqSol } },
    // 描述性（非预注册、不进判定；审查意见 7）：census 在自己的模型里量自己的模型优化器，这一节给读 Ĝ 的人两条参照：
    //   fullFlip = 切换后 64 个 perm 上全部 W 0→1（收益恰 1）的决策数——确定性翻转，模型里「必胜」；
    //   naive = 模型内朴素 K=2 挑选器（pickNaive）的 census 收益（全部种类、全部局）——任何模型内优化器白拿的量级。
    selfAgreement: { descriptive: true, switched: nSw, fullFlipUp: fullUp, fullFlipDown: fullDown,
      fullFlipShareOfPositiveGain: posSum ? Math.round(1e6 * fullUpSum / posSum) / 1e6 : null,
      gamesOver100pp: gameTot.filter(x => x > DEN).length, maxGamePp: gameTot.length ? ppN(Math.max(...gameTot), 1) : null,
      naive: { rule: `argmax mean reward over r=${PREREG.naiveR0}+[0,${PREREG.naiveK}) on the fid state, strict > first`,
        takeover: tot('naiveTake'), meanPp: ppN(isum(nv), games.length), lo5Pp: ppN(nvBs.lo5Sum, games.length), hi95Pp: ppN(nvBs.hi95Sum, games.length),
        perKindPp: Object.fromEntries(KINDS.map(k => [k, ppN(perKind[k].naiveSum, games.length)])) } },
    perGame: games.map(g => Object.assign({ g }, Object.fromEntries(KINDS.map(k => [k, ppN(Gk.get(g)[k], 1)])), { b139: ppN(G139.get(g), 1), sol: ppN(GSol.get(g), 1), naive: ppN(GNaive.get(g), 1) })),
    verdict,
  };
}

// 判定（§18.2 补充 B 最后一条）。输入全是整数分子的和（单位 1/DEN）→ 比较全部精确：
//   校准通过 ⇔ 局均 ≤ 0 ⇔ Σ ≤ 0；Ĝ ≥ 6.0pp ⇔ 100·Σ ≥ 6.0·DEN·n；下界 ≥ 3.0pp ⇔ 100·Σ_lo5 ≥ 3.0·DEN·n（6.0·768、3.0·768 都是整数）。
function decide({ reasons, calSum, calN, selected, estSum, estN, lo5Sum }) {
  if (reasons.length) return { code: 'INVALID', reason: reasons.join('; ') };
  if (!(calSum <= 0)) return { code: 'NO-GO', reason: `calibration failed: census predicts §13.9 gain ${ppN(calSum, calN)}pp/game > 0 (real −11.8pp) → census uninformative` };
  if (!selected.length) return { code: 'NO-GO', reason: 'no kind has positive summed gain on the selection half' };
  if (!(100 * estSum >= PREREG.goMean * DEN * estN)) return { code: 'NO-GO', reason: `held-out gain ${ppN(estSum, estN)}pp/game < ${PREREG.goMean}pp`, kinds: selected };
  if (!(100 * lo5Sum >= PREREG.goLower * DEN * estN)) return { code: 'NO-GO', reason: `held-out 90% lower bound ${ppN(lo5Sum, estN)}pp/game < ${PREREG.goLower}pp`, kinds: selected };
  return { code: 'GO', kinds: selected };
}

function verdictLine(R) {
  const v = R.verdict, pre = R.preregistered ? '' : '[NON-PREREG] ';
  if (v.code === 'GO') return `${pre}CENSUS VERDICT: GO (kinds: ${v.kinds.join(',')}) — held-out ${R.estimate.meanPp}pp/game, 90% lower ${R.estimate.lo5Pp}pp; calibration §13.9 ${R.calibration139.meanPp}pp/game (pass)`;
  if (v.code === 'NO-GO') return `${pre}CENSUS VERDICT: NO-GO (${v.reason})`;
  return `${pre}CENSUS VERDICT: INVALID (${v.reason})`;
}

// ---------------- CLI ----------------
function parseArgs(argv) {
  const o = { cmd: argv[0], files: [], shard: [0, 1], out: null, parts: [], games: PREREG.games.slice(), selEnd: PREREG.selEnd, quiet: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shard') { const [k, M] = argv[++i].split('/').map(Number); o.shard = [k, M]; }
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--parts') o.parts = argv[++i].split(',').filter(Boolean);
    else if (a === '--games') o.games = argv[++i].split('-').map(Number);
    else if (a === '--sel-end') o.selEnd = Number(argv[++i]);
    else if (a === '--quiet') o.quiet = true;
    else o.files.push(...a.split(',').filter(Boolean));
  }
  if (!(o.shard[1] >= 1 && o.shard[0] >= 0 && o.shard[0] < o.shard[1])) throw new Error('bad --shard ' + o.shard.join('/'));
  return o;
}

function evalShard(files, shard, quiet) {
  const E = engine();
  const { recs } = readHarvest(files);
  const out = [];
  const t0 = Date.now();
  for (let i = 0; i < recs.length; i++) {
    if (i % shard[1] !== shard[0]) continue;
    out.push(evalRecord(E, recs[i]));
    if (!quiet && out.length % 25 === 0) console.error(`[sub_census] shard ${shard[0]}/${shard[1]}: ${out.length} states ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  return out;
}

module.exports = { winShare, gainOf, pick139, pickSolver, pickNaive, evalRecord, report, bootstrap, decide, readHarvest, cfgDiff, PREREG, KINDS, DEN, engine, verdictLine };

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  if (o.cmd === 'eval') {
    const rows = evalShard(o.files, o.shard, o.quiet);
    const txt = rows.map(r => JSON.stringify(r) + '\n').join('');
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out + '.tmp', txt); fs.renameSync(o.out + '.tmp', o.out);
    console.error(`[sub_census] eval shard ${o.shard.join('/')}: ${rows.length} states -> ${o.out} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } else if (o.cmd === 'report' || o.cmd === 'run') {
    let results;
    if (o.cmd === 'run') results = evalShard(o.files, [0, 1], o.quiet);
    else { results = []; for (const f of o.parts) for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l) results.push(JSON.parse(l)); }
    const R = report(o.files, results, o);
    const txt = JSON.stringify(R, null, 1) + '\n';
    if (o.out) { fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true }); fs.writeFileSync(o.out, txt); }
    const s = R.validity, c = R.calibration139;
    console.log(`L6 sub-decisions ${s.l6SubDecisions} (gate ${s.gateNull} = ${(100 * (s.gateRate || 0)).toFixed(2)}%), mismatches ${s.mismatches}/${s.liveMismatches}/${s.decSetMismatches}, games ${s.games}, config-mismatch games ${s.configMismatchGames.length}`);
    for (const k of KINDS) { const x = R.perKind[k]; console.log(`  ${k.padEnd(10)} n=${x.n} gate=${x.gateNull} switched=${x.switched} gain(all games)=${x.gainPpPerGameAll}pp/game sel-sum=${x.selSumPp}pp est-mean=${x.estMeanPp}pp`); }
    console.log(`selected kinds: [${R.selection.selected.join(',')}]  held-out Ĝ=${R.estimate.meanPp}pp/game  90% [${R.estimate.lo5Pp}, ${R.estimate.hi95Pp}]`);
    console.log(`calibration §13.9: ${c.states} states (${c.gateRejectedStates} fid-gate-rejected, ${c.gateRejectedTakeovers} taken over there, ${c.unmeasurable} unmeasurable), takeover ${c.takeover} (${c.takeoverRate}), gain ${c.meanPp}pp/game 90% [${c.lo5Pp}, ${c.hi95Pp}] -> ${c.pass ? 'pass' : 'FAIL'}; vs real d4cbcd6 code: ${c.liveCheck.identical}/${c.liveCheck.compared} identical`);
    console.log(`§9 solver build (descriptive): ${R.solver9.states} states, takeover ${R.solver9.takeover}, gain ${R.solver9.meanPp}pp/game 90% [${R.solver9.lo5Pp}, ${R.solver9.hi95Pp}]; vs real d4cbcd6 code: ${R.solver9.liveCheck.identical}/${R.solver9.liveCheck.compared} identical`);
    const a = R.selfAgreement;
    console.log(`self-agreement (descriptive, not in the verdict): ${a.switched} switches, ${a.fullFlipUp} deterministic 0→1 (+${a.fullFlipDown} 1→0), share of positive gain from 0→1 flips ${a.fullFlipShareOfPositiveGain}, games with Σ>100pp ${a.gamesOver100pp}; in-model naive K=2 picker ${a.naive.meanPp}pp/game 90% [${a.naive.lo5Pp}, ${a.naive.hi95Pp}] (takeover ${a.naive.takeover})`);
    console.log(verdictLine(R));
    console.error(`[sub_census] ${o.cmd} ${((Date.now() - t0) / 1000).toFixed(0)}s${o.out ? ' -> ' + o.out : ''}`);
  } else {
    console.error('usage: node tools/sub_census.js eval|report|run <harvest.jsonl>[,...] [--shard k/M] [--parts a,b,...] [--out file] [--games A-B] [--sel-end S]');
    process.exit(2);
  }
}
