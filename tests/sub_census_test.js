// tests/sub_census_test.js — 第三轮 Stage 5b：census 工具（tools/sub_census.js）
//
// 钉住的性质（每条都做过反向验证，见文末「反向验证记录」）：
//   ① 统计与判定（合成数据，每个数手算）：
//      ①a 选种类 = 选择半 Σ > 0（=0 与 <0 都不入选）；估计 = 估计半局均 Σ_{入选}（未入选种类的收益不进 Ĝ）
//      ①b 自助：固定种子确定；与独立写的「有放回抽 n 局 × 2000、最近秩 5%/95%」逐位相同
//      ①c 判定：GO 需 校准 ≤ 0 且 Ĝ ≥ 6.0pp 且 下界 ≥ 3.0pp（边界恰好相等 → 通过）；校准 > 0 → NO-GO（哪怕 Ĝ 很大）；
//          下界 < 3 → NO-GO；闸拒 > 2% / 实际一手 ≠ 启发式 / 缺局 / 坏局 / 结果重复或缺失 → INVALID
//      ①d 确定性：结果乱序输入 → 报告逐字节相同
//      ①e 完整性（审查补的 INVALID 条件）：_end.cfg ≠ 预注册 A2 采样配置（seedBase / CRN / L6 回退 / 未带旧代码对照 / 缺 cfg）；
//          build 状态缺真实旧代码对照（§13.9 或 §9）；过闸动作集 ≠ 搜索动作集；fid 不被允许；钩子内取随机数；
//          fid 闸拒的 build 状态照算进校准（a₁₃.₉ == 实际一手 → 0），闸拒且接管（收益不可测）→ INVALID
//      ①f 精确算术：gainOf 以整数分子（n/768）累加——审查给的反例（ΔW = [1,1,1,1/3] 与其相反数倒序，浮点和 = +6.9e-18）
//          两个决策之和恰为 0；12·ΔW 非整数（如 1/5 份额）→ 抛错
//   ② §13.9 / §9 复刻 == **真实的** d4cbcd6 代码：从 git 取出 d4cbcd6 的 game.js + sim*.js 放进另一个 vm 上下文，
//      用旧引擎跑纯启发式对局，在每个建造点（所有座位，临时置 _aiLevel=6）调旧 vnetPickBuilding
//      （_l6VnetBuild, rollout, K=2）与旧 solverPickBuilding（终局触发后，前若干个），与本工具在同一份旧口径快照
//      （旧 buildSimState(G)）上的 pick139 / pickSolver 逐个比较。git 里没有 d4cbcd6（浅克隆）→ **FAIL**：② 是复刻等价性唯一的
//      离线证明，静默跳过 = 假绿（第一次反向验证就是这样全绿的）。确实拿不到该提交时显式设 SUB_CENSUS_ALLOW_SKIP=1
//      → 退出码 2 + "skipped"（run_tests.sh 记为 SKIP，不算 PASS）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const C = require('../tools/sub_census.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const J = (x) => JSON.stringify(x);
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------- ① 合成数据 ----------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-census-test-'));
// 60 局，每局每类一条记录；收益由 fn(g, kind)（胜率份额）给，按工具的口径化成整数分子 gainN = round(fn·DEN)；
// build 另带 b139 / sol（都带「对照过真实旧代码且相同」的 live/eqLive）；_end 带预注册 cfg。
const DEN = C.DEN, N = (x) => Math.round(x * DEN);
const goodCfg = (g) => Object.assign({ seed: (20261123 + g * 1000003) >>> 0 }, JSON.parse(J(C.PREREG.harvest)));
function synth(fn, o = {}) {
  const recs = [], res = [], ends = [];
  for (let g = 100; g <= 159; g++) {
    if (o.dropGame === g) continue;
    let k = 0;
    for (const kind of C.KINDS) {
      const rec = { g, seat: g % 4, kind, k, game: 1 };
      const r = { g, seat: g % 4, kind, k, game: 1 };
      if (o.gateNull && o.gateNull(g, kind)) { rec.fid = null; r.gateNull = true; }
      else {
        const gainN = N(fn(g, kind));
        Object.assign(r, { nCand: 3, h: 1, mismatch: (o.mismatch && o.mismatch(g, kind)) ? 1 : 0, liveMismatch: 0, decSet: (o.decSet && o.decSet(g, kind)) ? 1 : 0,
          sub: { action: gainN ? 2 : 1, best: 2, switched: !!gainN, gate: { mean: null, se: null, n: 0 }, nRollouts: 100, capped: false, timedOut: false }, gainN, gain: gainN / DEN });
      }
      if (o.fidNA && o.fidNA(g, kind)) r.fidNotAllowed = 1;
      if (o.hookRand && o.hookRand(g, kind)) r.hookRand = 1;
      if (kind === 'build') {
        const c = o.cal ? o.cal(g) : -0.01, cN = (o.unmeas && o.unmeas(g)) ? null : N(c);
        r.b139 = { a: c ? 2 : 1, why: 'ok', take: c ? 1 : 0, gainN: cN, gain: cN === null ? null : cN / DEN, rnd: 0 };
        if (!(o.noLive139 && o.noLive139(g))) Object.assign(r.b139, { live: r.b139.a, eqLive: 1 });
        if (g % 10 === 0) {
          r.sol = { a: 1, why: 'ok', take: 0, gainN: 0, gain: 0, rnd: 0, nodes: 5 };
          if (!(o.noLiveSol && o.noLiveSol(g))) Object.assign(r.sol, { live: 1, eqLive: 1 });
        }
      }
      recs.push(rec); res.push(r); k++;
    }
    const e = { g, kind: '_end', row: (o.badGame === g) ? 'error' : 'ok', n: k, cfg: goodCfg(g) };
    if (o.cfg) o.cfg(g, e);
    ends.push(e);
  }
  const f = path.join(tmp, 'h' + (synth.n = (synth.n || 0) + 1) + '.jsonl');
  fs.writeFileSync(f, recs.concat(ends).map(x => J(x) + '\n').join(''));
  if (o.dupResult) res.push(res[0]);
  if (o.dropResult) res.pop();
  return { files: [f], res };
}
const OPTS = { games: [100, 159], selEnd: 130 };
const rep = (s) => C.report(s.files, s.res, OPTS);

// 独立自助（不借被测函数）
function bootRef(vals, B, seed) {
  const rnd = mulberry32(seed >>> 0), ms = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < vals.length; i++) s += vals[Math.floor(rnd() * vals.length)]; ms.push(s / vals.length); }
  ms.sort((a, b) => a - b);
  return { lo5: ms[Math.ceil(0.05 * B) - 1], hi95: ms[Math.ceil(0.95 * B) - 1] };
}

{
  // ①a 选择：build 选择半 Σ>0，settle 选择半 Σ=0（估计半很大——不得入选），trade 选择半 Σ<0，captain 选择半 >0 但估计半为 0
  const gainFn = (g, kind) => {
    const sel = g < 130;
    if (kind === 'build') return sel ? 0.01 : 0.07 + 0.05 * Math.sin(g * 1.7);   // 估计半：连续取值（自助分位相邻秩不相等）
    if (kind === 'settle') return sel ? 0 : 0.5;
    if (kind === 'trade') return sel ? -0.02 : 0.5;
    if (kind === 'captain') return sel ? (g === 100 ? 0.001 : 0) : 0;
    return 0;
  };
  const s = synth(gainFn);
  const R = rep(s);
  ok(J(R.selection.selected) === J(['build', 'captain']), `①a selected ${J(R.selection.selected)} (want build,captain: Σ>0 only)`);
  const est = []; for (let g = 130; g <= 159; g++) est.push((N(gainFn(g, 'build')) + N(gainFn(g, 'captain'))) / DEN);
  const m = est.reduce((a, b) => a + b, 0) / est.length;
  ok(Math.abs(R.estimate.meanPp - 100 * m) < 1e-6, `①a estimate ${R.estimate.meanPp} vs ${100 * m} (non-selected kinds must not enter Ĝ)`);
  const bref = bootRef(est, 2000, 20261123);
  ok(Math.abs(R.estimate.lo5Pp - 100 * bref.lo5) < 1e-6 && Math.abs(R.estimate.hi95Pp - 100 * bref.hi95) < 1e-6, `①b bootstrap ${R.estimate.lo5Pp}/${R.estimate.hi95Pp} vs ref ${100 * bref.lo5}/${100 * bref.hi95}`);
  ok(R.estimate.lo5Pp < R.estimate.meanPp && R.estimate.meanPp < R.estimate.hi95Pp, '①b interval must straddle the mean (non-degenerate data)');
  ok(R.verdict.code === 'GO' && J(R.verdict.kinds) === J(['build', 'captain']), `①c GO case: ${J(R.verdict)}`);
  ok(R.preregistered === true, '①c default ranges must be flagged preregistered');
  // ①d 乱序 → 同一报告
  const sh = s.res.slice(); const rnd = mulberry32(7); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
  ok(J(C.report(s.files, sh, OPTS)) === J(R), '①d shuffled results change the report');
  ok(J(rep(s)) === J(R), '①d report not deterministic');
}
{
  // ①c 边界：判定吃整数分子的和（单位 1/DEN）。n=25 局时 6.0pp ⇔ Σ = 0.06·768·25 = 1152、3.0pp ⇔ Σ_lo5 = 576，都是整数 → 恰好压线可测
  const D = (o) => C.decide(Object.assign({ reasons: [], calSum: -1, calN: 60, selected: ['build'], estSum: 1152, estN: 25, lo5Sum: 576 }, o));
  ok(DEN === 768 && 0.06 * DEN * 25 === 1152 && 0.03 * DEN * 25 === 576, '①c setup: boundary constants not exact');
  ok(D({}).code === 'GO', `①c Ĝ = 6.0pp and lower = 3.0pp exactly must pass: ${J(D({}))}`);
  ok(D({ estSum: 1151 }).code === 'NO-GO' && D({ lo5Sum: 575 }).code === 'NO-GO', '①c one unit (1/768 per 25 games) below a threshold must fail');
  ok(D({ calSum: 0 }).code === 'GO' && D({ calSum: 1 }).code === 'NO-GO', '①c calibration boundary (Σ ≤ 0 passes, Σ = +1/768 fails)');
  ok(D({ reasons: ['x'], Ghat: 1, lo5: 1 }).code === 'INVALID', '①c invalid overrides everything');
  const s1 = synth((g, k) => k === 'build' ? (g < 130 ? 0.01 : 0.0625) : 0);
  ok(rep(s1).verdict.code === 'GO' && rep(s1).estimate.meanPp === 6.25 && rep(s1).estimate.lo5Pp === 6.25, `①c constant 6.25pp must pass: ${J(rep(s1).verdict)} ${rep(s1).estimate.meanPp}`);
  const s2 = synth((g, k) => k === 'build' ? (g < 130 ? 0.01 : 0.0599) : 0);
  ok(rep(s2).verdict.code === 'NO-GO' && /held-out gain/.test(rep(s2).verdict.reason), `①c Ĝ 5.99pp must fail: ${J(rep(s2).verdict)}`);
  // 下界 < 3：均值够但方差大（估计半 2 局 2.4、其余 0 → 均值 16pp，自助 5% 分位 = 0）
  const s3 = synth((g, k) => k === 'build' ? (g < 130 ? 0.01 : (g === 131 || g === 140 ? 2.4 : 0)) : 0);
  const R3 = rep(s3);
  ok(R3.verdict.code === 'NO-GO' && /lower bound/.test(R3.verdict.reason) && R3.estimate.meanPp >= 6, `①c low lower bound must fail: ${J(R3.verdict)} mean=${R3.estimate.meanPp} lo=${R3.estimate.lo5Pp}`);
  // 校准：§13.9 局均 > 0 → NO-GO（即使 Ĝ 巨大）；恰 0 → 通过
  const big = (g, k) => k === 'build' ? (g < 130 ? 0.01 : 0.5) : 0;
  const s4 = synth(big, { cal: (g) => (g === 100 ? 1 / DEN : 0) });   // 最小正单位：60 局里一个 +1/768
  ok(rep(s4).verdict.code === 'NO-GO' && /calibration/.test(rep(s4).verdict.reason) && rep(s4).calibration139.pass === false, `①c calibration > 0 must be NO-GO: ${J(rep(s4).verdict)}`);
  const s5 = synth(big, { cal: () => 0 });
  ok(rep(s5).verdict.code === 'GO' && rep(s5).calibration139.pass === true, `①c calibration exactly 0 must pass: ${J(rep(s5).verdict)}`);
  ok(rep(s4).calibration139.takeover === 1 && rep(s4).calibration139.states === 60, `①c takeover/states ${rep(s4).calibration139.takeover}/${rep(s4).calibration139.states}`);
  // 无入选种类 → NO-GO
  const s6 = synth((g, k) => (g < 130 ? -0.01 : 0.5));
  ok(rep(s6).verdict.code === 'NO-GO' && rep(s6).selection.selected.length === 0, `①c no selected kind: ${J(rep(s6).verdict)}`);
}
{
  // ①c 有效性 → INVALID
  const base = (g, k) => k === 'build' ? (g < 130 ? 0.01 : 0.5) : 0;
  // 闸拒：300 条里 6 条 = 2% → 有效；7 条 = 2.33% → INVALID
  const gn = (n) => (g, k) => k === 'settle' && g < 100 + n;
  ok(rep(synth(base, { gateNull: gn(6) })).verdict.code === 'GO', `①c gate 6/300 = 2% must be valid: ${J(rep(synth(base, { gateNull: gn(6) })).verdict)}`);
  const R7 = rep(synth(base, { gateNull: gn(7) }));
  ok(R7.verdict.code === 'INVALID' && /gate rejections/.test(R7.verdict.reason) && R7.perKind.settle.gateNull === 7, `①c gate 7/300 must be INVALID: ${J(R7.verdict)}`);
  const Rm = rep(synth(base, { mismatch: (g, k) => g === 150 && k === 'trade' }));
  ok(Rm.verdict.code === 'INVALID' && /mismatches/.test(Rm.verdict.reason), `①c one mismatch must be INVALID: ${J(Rm.verdict)}`);
  const Rd = rep(synth(base, { dropGame: 144 }));
  ok(Rd.verdict.code === 'INVALID' && /missing games 144/.test(Rd.verdict.reason), `①c missing game must be INVALID: ${J(Rd.verdict)}`);
  const Rb = rep(synth(base, { badGame: 120 }));
  ok(Rb.verdict.code === 'INVALID' && /error\/incomplete/.test(Rb.verdict.reason), `①c error game must be INVALID: ${J(Rb.verdict)}`);
  let threw = false; try { rep(synth(base, { dupResult: true })); } catch (e) { threw = /duplicate/.test(e.message); }
  ok(threw, '①c duplicate result (overlapping shards) must throw');
  const Rr = rep(synth(base, { dropResult: true }));
  ok(Rr.verdict.code === 'INVALID' && /results cover/.test(Rr.verdict.reason), `①c missing result must be INVALID: ${J(Rr.verdict)}`);
  // 非预注册范围 → 标记
  const s = synth(base);
  const Rn = C.report(s.files, s.res, { games: [100, 159], selEnd: 131 });
  ok(Rn.preregistered === false && /^\[NON-PREREG\]/.test(C.verdictLine(Rn)), '①c overridden split must be flagged NON-PREREG');
  ok(rep(synth(base)).verdict.code === 'GO', `①e baseline must be GO: ${J(rep(synth(base)).verdict)}`);
  // ①e 采样配置：逐项（含 seed 公式）；缺 cfg 也 INVALID
  for (const [what, mut, re] of [
    ['seedBase', (e) => { e.cfg.seedBase = 20260611; e.cfg.seed = (20260611 + e.g * 1000003) >>> 0; }, /seedBase=20260611/],
    ['crn', (e) => { e.cfg.crn = false; }, /crn=false/],
    ['l6 fallback', (e) => { e.cfg.l6fb = 1; }, /l6fb=1/],
    ['alphaIters', (e) => { e.cfg.budget = Object.assign({}, e.cfg.budget, { alphaIters: 1600 }); }, /budget=/],
    ['heur', (e) => { e.cfg.heur = { moneyLean: 8 }; }, /heur=/],
    ['oldCheck', (e) => { e.cfg.oldCheck = false; }, /oldCheck=false/],
    ['seed', (e) => { e.cfg.seed++; }, /seed=/],
    ['missing cfg', (e) => { delete e.cfg; }, /cfg-missing/],
  ]) {
    const R = rep(synth(base, { cfg: (g, e) => { if (g === 137) mut(e); } }));
    ok(R.verdict.code === 'INVALID' && /harvest config differs/.test(R.verdict.reason) && re.test(R.verdict.reason) && J(R.validity.configMismatchGames) === '[137]',
      `①e config ${what} on one game must be INVALID: ${J(R.verdict)}`);
  }
  // ①e 真实旧代码对照必须覆盖全部 build 状态 / 全部 endTriggered 状态
  const Rl = rep(synth(base, { noLive139: (g) => g === 111 }));
  ok(Rl.verdict.code === 'INVALID' && /vnetPickBuilding check covers 59\/60/.test(Rl.verdict.reason), `①e missing §13.9 live check must be INVALID: ${J(Rl.verdict)}`);
  const Rs = rep(synth(base, { noLiveSol: (g) => g === 120 }));
  ok(Rs.verdict.code === 'INVALID' && /solverPickBuilding check covers 5\/6/.test(Rs.verdict.reason), `①e missing §9 live check must be INVALID: ${J(Rs.verdict)}`);
  const Rds = rep(synth(base, { decSet: (g, k) => g === 101 && k === 'settle' }));
  ok(Rds.verdict.code === 'INVALID' && /gate-checked action set/.test(Rds.verdict.reason), `①e action-set mismatch must be INVALID: ${J(Rds.verdict)}`);
  const Rf = rep(synth(base, { fidNA: (g, k) => g === 102 && k === 'trade' }));
  ok(Rf.verdict.code === 'INVALID' && /l6FidAllowed/.test(Rf.verdict.reason), `①e fid not allowed must be INVALID: ${J(Rf.verdict)}`);
  const Rh = rep(synth(base, { hookRand: (g, k) => g === 103 && k === 'captain' }));
  ok(Rh.verdict.code === 'INVALID' && /Math.random calls inside the harvest hook/.test(Rh.verdict.reason), `①e hook randomness must be INVALID: ${J(Rh.verdict)}`);
  // ①e fid 闸拒的 build 状态：照算进校准（states 仍 60；该状态 b139 收益 0 时有效），闸拒且接管（gainN=null）→ INVALID
  const Rg = rep(synth(base, { gateNull: (g, k) => k === 'build' && g === 104, cal: (g) => g === 104 ? 0 : -0.01 }));
  ok(Rg.verdict.code === 'GO' && Rg.calibration139.states === 60 && Rg.calibration139.gateRejectedStates === 1 && Rg.perKind.build.gateNull === 1,
    `①e gate-rejected build state must stay in the calibration: ${J(Rg.verdict)} ${J(Rg.calibration139)}`);
  const Ru = rep(synth(base, { gateNull: (g, k) => k === 'build' && g === 104, unmeas: (g) => g === 104 }));
  ok(Ru.verdict.code === 'INVALID' && /fid gate rejected/.test(Ru.verdict.reason) && Ru.calibration139.unmeasurable === 1, `①e unmeasurable §13.9 takeover must be INVALID: ${J(Ru.verdict)}`);
}
{
  // ①f 精确算术（审查反例）：两个决策的 ΔW 分别是 [1,1,1,1/3] 与其相反数倒序（其余 60 个 perm 为 0）
  const fakeE = (d) => ({ X: { subEvalBatch: (st, dec, acts, rs) => [rs.map((r, k) => k < d.length ? Math.max(d[k], 0) : 0), rs.map((r, k) => k < d.length ? Math.max(-d[k], 0) : 0)] } });
  const dec = { actions: [1, 2] };
  const dA = [1, 1, 1, 1 / 3], dB = [-1 / 3, -1, -1, -1];
  const fl = (d) => d.reduce((s, x) => s + x, 0) / 64;
  ok(fl(dA) + fl(dB) !== 0, '①f setup: the float counterexample no longer reproduces');
  const nA = C.gainOf(fakeE(dA), {}, dec, 2, 1), nB = C.gainOf(fakeE(dB), {}, dec, 2, 1);
  ok(nA === 40 && nB === -40 && nA + nB === 0 && Number.isInteger(nA), `①f gainOf must accumulate exactly: ${nA} + ${nB}`);
  let thr = false; try { C.gainOf(fakeE([0.2]), {}, dec, 2, 1); } catch (e) { thr = /not an integer/.test(e.message); }
  ok(thr, '①f a 1/5 win share (12·ΔW not an integer) must throw');
  ok(C.gainOf(fakeE(dA), {}, dec, 1, 1) === 0, '①f a == h must be exactly 0');
}
fs.rmSync(tmp, { recursive: true, force: true });

// ---------------- ③ 单状态求值 evalRecord（真实采样行：tests/golden/sub_census_fixture.jsonl）----------------
// 4 行取自 `EVAL_CRN=1 EVAL_HARVEST_SUB=… EVAL_HARVEST_OLD=<d4cbcd6> eval_paired_worker.js DEPLOY 5 100 102 … 20261123`：
//   （审查修复后 fid 闸改在 window._l6Fid 下判：重采的 g100–101 与这 4 行规范化 JSON 逐字段相同，只差 _fid 的键序，故未重录）
//   g101 k17 建造（搜索切换、收益 1）· g100 k1 拓殖（切换）· g101 k22 终局建造（含 §9 求解器）· g100 k25 装船（不切换）
//   ③a 原样：实际一手 == 离线 fid 启发式、采样时现算 h/种子/动作集 == 离线；§13.9/§9 复刻 == 采样时真实旧代码；确定性
//   ③b 篡改 game / seedLive / old139Live / oldSolLive / fid=null → 分别被计为 mismatch / liveMismatch / 不等 / 不等 / 闸拒
//   ③c 不切换 → 收益恰为 0（不跑收益 rollout）；切换 → 收益 = 64 个 perm 上胜率份额差的均值（独立用 subEvalBatch 重算）
{
  const E = C.engine();
  const fx = fs.readFileSync(path.join(__dirname, 'golden', 'sub_census_fixture.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  ok(fx.length === 4, '③ fixture must have 4 records');
  const clone = (o) => JSON.parse(J(o));
  const res = fx.map(r => C.evalRecord(E, clone(r)));
  ok(J(res) === J(fx.map(r => C.evalRecord(E, clone(r)))), '③a evalRecord not deterministic');
  for (const r of res) {
    ok(r.mismatch === 0 && r.liveMismatch === 0, `③a g${r.g} k${r.k} ${r.kind}: mismatch=${r.mismatch} liveMismatch=${r.liveMismatch}`);
    if (r.b139) ok(r.b139.eqLive === 1, `③a g${r.g} k${r.k}: §13.9 re-implementation != recorded real d4cbcd6 choice (${r.b139.a} vs ${r.b139.live})`);
    if (r.sol) ok(r.sol.eqLive === 1, `③a g${r.g} k${r.k}: §9 re-implementation != recorded real d4cbcd6 choice (${r.sol.a} vs ${r.sol.live})`);
  }
  const [bS, sS, bE, cN] = res;
  ok(bS.sub.switched && sS.sub.switched && !cN.sub.switched && !!bE.sol, `③ fixture roles changed: ${J(res.map(r => [r.kind, r.sub.switched, !!r.sol]))}`);
  // ③d 预注册搜索参数钉在真实局面上：rollout 数（bSel=160 日程 + gateN=48 门）、切换与否（δ=0.02：g101 k22/g100 k25 的门均值
  //     0.0067 < δ；z=2.0：g100 k1 的门 z = 0.1547/0.0740 = 2.09，z 取 2.2 就不切）、胜者
  ok(J(res.map(r => [r.sub.nRollouts, r.sub.switched, r.sub.best, r.sub.gate.n])) === J([[246, true, 14, 48], [256, true, 0, 48], [255, false, 16, 48], [254, false, 22, 48]]),
    `③d pre-registered search on fixture changed: ${J(res.map(r => [r.sub.nRollouts, r.sub.switched, r.sub.best, r.sub.gate.n]))}`);
  // ③b 篡改
  const t1 = clone(fx[0]); t1.game = t1.dec.actions.find(a => a !== t1.game);
  ok(C.evalRecord(E, t1).mismatch === 1, '③b tampered game action must count as a mismatch');
  const t2 = clone(fx[1]); t2.seedLive = (t2.seedLive + 1) >>> 0;
  ok(C.evalRecord(E, t2).liveMismatch === 1, '③b tampered live seed must count as a live mismatch');
  const t3 = clone(fx[0]); t3.old139Live = t3.dec.actions.find(a => a !== C.evalRecord(E, clone(fx[0])).b139.a);
  ok(C.evalRecord(E, t3).b139.eqLive === 0, '③b tampered old139Live must be detected');
  const t4 = clone(fx[2]); t4.oldSolLive = t4.dec.actions.find(a => a !== bE.sol.a);
  ok(C.evalRecord(E, t4).sol.eqLive === 0, '③b tampered oldSolLive must be detected');
  const t5 = clone(fx[3]); t5.fid = null;
  const r5 = C.evalRecord(E, t5);
  ok(r5.gateNull === true && r5.gain === undefined && r5.gainN === undefined, `③b fid=null must be a gate rejection: ${J(r5)}`);
  const t6 = clone(fx[1]); t6.dec.actions = t6.dec.actions.slice(1);
  ok(C.evalRecord(E, t6).decSet === 1 && res[1].decSet === 0, '③b gate-checked action set != searched action set must be flagged');
  const t7 = clone(fx[1]); t7.fidAllowed = false;
  ok(C.evalRecord(E, t7).fidNotAllowed === 1 && res[1].fidNotAllowed === undefined, '③b fidAllowed:false must be flagged');
  // ③e fid 闸拒的 build 状态仍走 §13.9：g101 k17 的 a₁₃.₉ = 21 ≠ 实际一手 20 → 不可测（gainN null）；
  //     若实际一手恰为 21（== a₁₃.₉）→ 收益定义为 0（接管 0）；两种情况都照样与真实旧代码对照
  ok(bS.b139.a === 21 && bS.b139.take === 1 && fx[0].game === 20, `③e setup: fixture g101 k17 §13.9 choice changed ${J(bS.b139)}`);
  const t8 = clone(fx[0]); t8.fid = null;
  const r8 = C.evalRecord(E, t8);
  ok(r8.gateNull && r8.b139 && r8.b139.a === 21 && r8.b139.take === 1 && r8.b139.gainN === null && r8.b139.eqLive === 1, `③e gate-rejected build + takeover must be unmeasurable: ${J(r8.b139)}`);
  const t9 = clone(fx[0]); t9.fid = null; t9.game = 21;
  const r9 = C.evalRecord(E, t9);
  ok(r9.gateNull && r9.b139 && r9.b139.take === 0 && r9.b139.gainN === 0 && r9.b139.eqLive === 1, `③e gate-rejected build without takeover must be exactly 0: ${J(r9.b139)}`);
  // ③c 收益
  ok(cN.gain === 0 && cN.gainN === 0, `③c non-switch gain must be exactly 0: ${cN.gain}`);
  for (const [i, r] of [[0, bS], [1, sS]]) {
    const st = fx[i].fid, dec = E.X.subSearchSteps(E.S.clone(st), { fid: true }).dec;
    const rs = []; for (let k = 0; k < 64; k++) rs.push(3000000 + k);
    const v = E.X.subEvalBatch(st, dec, [r.sub.action, r.h], rs, { fid: true, leafValue: (s2, seat) => C.winShare(E.S, s2, seat) });
    let sum = 0, n = 0; for (let k = 0; k < 64; k++) { sum += v[0][k] - v[1][k]; n += Math.round(12 * (v[0][k] - v[1][k])); }
    ok(r.gainN === n && Math.abs(r.gain - sum / 64) < 1e-12 && r.gain !== 0, `③c g${r.g} k${r.k}: gain ${r.gainN}/768 = ${r.gain} != mean win-share difference ${sum / 64} over r∈[3e6,3e6+64)`);
  }
}

// ---------------- ② 复刻 == 真实 d4cbcd6 代码 ----------------
(async () => {
  const root = path.resolve(__dirname, '..');
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-census-d4cbcd6-'));
  let have = true;
  try {
    execSync(`git -C "${root}" archive d4cbcd6 ai_dna.js ai_dna.json ai_dna_data.js game.js sim.js sim_features.js sim_nn.js sim_az.js sim_solve.js | tar -x -C "${oldDir}"`, { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (e) { have = false; }
  if (!have) {
    if (process.env.SUB_CENSUS_ALLOW_SKIP === '1') {
      console.log('② skipped: commit d4cbcd6 not in this clone (SUB_CENSUS_ALLOW_SKIP=1)');
      fs.rmSync(oldDir, { recursive: true, force: true });
      process.exit(fails ? 1 : 2);                       // run_tests.sh：rc=2 + "skipped" = SKIP（不算 PASS）
    }
    ok(false, '② commit d4cbcd6 not in this clone — the §13.9/§9 equivalence proof cannot run (git fetch origin d4cbcd6, or set SUB_CENSUS_ALLOW_SKIP=1 to skip explicitly)');
  } else {
    const { loadEngine } = require('../tools/_sandbox.js');
    const M = {}; for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
    let env = mulberry32(20261123); M.random = () => env();
    const old = loadEngine({ repoRoot: oldDir, files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js', 'sim_solve.js'], beforeLoad: sb => { sb.Math = M; } });
    ok(!/simStateAtSubDecision/.test(old.run('vnetPickBuilding.toString()')), '② setup: extracted game.js is not the pre-migration d4cbcd6 version');
    const E = C.engine();
    const cases = [];
    old.sandbox.__check = (G, p, options, isChooser) => {
      // 旧函数在真实（旧）G 上；快照 = 旧 buildSimState(G)（与 harvest 的 old.st 同一行代码），再交给复刻
      const lvl = p._aiLevel; p._aiLevel = 6;
      const saved = env; env = mulberry32(99);                       // 旧函数若取随机数，不扰动对局流
      try {
        const snap = JSON.parse(JSON.stringify(old.run('buildSimState(G)')));
        const o = { st: snap, turn: G.turnNumber, pidx: p.idx, opts: options.map(x => x.b.id), isChooser: !!isChooser, endT: !!G.endTriggered };
        const m = (x) => x === null ? null : x < 0 ? -1 : options[x].b.id;
        const live = m(old.run('vnetPickBuilding')(p, options, isChooser));
        const c1 = { n: 0 }, re = C.pick139(E.S, o, c1);
        const c = { kind: '139', live, re: re.a, why: re.why, rnd: c1.n, n: options.length };
        cases.push(c);
        if (G.endTriggered && cases.filter(x => x.kind === 'sol').length < 6) {
          const liveS = m(old.run('solverPickBuilding')(p, options, isChooser));
          const c2 = { n: 0 }, rs = C.pickSolver(E.S, o, c2);
          cases.push({ kind: 'sol', live: liveS, re: rs.a, why: rs.why, rnd: c2.n });
        }
      } finally { p._aiLevel = lvl; env = saved; }
    };
    await old.run(`(async () => {
      render = function () {}; flyToDest = function () {}; showToast = function () {};
      saveGame = function () {}; kvSync = function () {}; clearSave = function () {};
      window._allAIMode = true; window._fastSpectator = true;
      window._l6VnetBuild = true; window._l6BuildEval = 'rollout'; window._l6VnetBuildSamples = 2; window._l6SolverBuild = true;
      await loadAIDNA();
      const _a = aiPickBuilding;
      aiPickBuilding = function (p, options, isChooser) { const r = _a.apply(this, arguments); __check(G, p, options, isChooser); return r; };
      for (let g = 0; g < 2; g++) {
        G = new Game(4, 'AI', {});
        G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = 3; });
        await runMainLoop();
      }
    })()`);
    const c139 = cases.filter(c => c.kind === '139'), cs = cases.filter(c => c.kind === 'sol');
    const bad139 = c139.filter(c => c.live !== c.re), badS = cs.filter(c => c.live !== c.re);
    ok(c139.length >= 40, `② only ${c139.length} build states`);
    ok(bad139.length === 0, `② §13.9 re-implementation differs from real d4cbcd6 vnetPickBuilding on ${bad139.length}/${c139.length}: ${J(bad139.slice(0, 3))}`);
    ok(c139.filter(c => c.live !== null && c.n > 1).length >= 20, `② vacuous: real vnetPickBuilding decided only ${c139.filter(c => c.live !== null && c.n > 1).length} multi-option states`);
    ok(c139.every(c => c.rnd === 0), '② §13.9 start state consumed randomness');
    ok(cs.length >= 1, `② no endTriggered solver case (${cs.length})`);
    ok(badS.length === 0, `② §9 re-implementation differs from real d4cbcd6 solverPickBuilding on ${badS.length}/${cs.length}: ${J(badS)}`);
    // 非空洞：复刻的选择确实经常 ≠ 启发式（否则「相同」可能只是都回退了）
    console.log(`② §13.9: ${c139.length} build states identical to real d4cbcd6 code (${c139.filter(c => c.why !== 'ok').length} fell back: ${J([...new Set(c139.filter(c => c.why !== 'ok').map(c => c.why))])}); §9 solver: ${cs.length} states identical`);
  }
  fs.rmSync(oldDir, { recursive: true, force: true });
  console.log(fails ? `\nSUB_CENSUS TEST FAILED: ${fails}` : '\nSUB_CENSUS TEST OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });

// ---- 反向验证记录（手工，已做；在工作树临时副本里变异 tools/sub_census.js、跑本测试、恢复并 cmp）----
//   ①a 选种类 Σ>0 改 Σ≥0                    → 「①a selected ["build","settle","craftbonus","captain"] (want build,captain: Σ>0 only)」
//   ①a Ĝ 用全部种类                          → 「①a estimate 107 vs 7.0000000000000036 (non-selected kinds must not enter Ĝ)」
//   ①b 分位改 floor(p·B)（差一个秩）           → 「①b bootstrap 5.998477/8.079 vs ref 5.997033674622567/8.07651132639793」
//   ①b 自助种子 +1                            → 「①b bootstrap 6.00694/8.106987 vs ref …」
//   ①c Ĝ ≥ 改 >  / 下界 ≥ 改 >                → 「①c Ĝ = 6.0pp and lower = 3.0pp exactly must pass: {"code":"NO-GO",…}」
//   ①c 校准 ≤0 改 <0 / 校准不查               → 「①c calibration exactly 0 must pass」/「①c calibration > 0 must be NO-GO: {"code":"GO"…}」
//   ①c 下界不查                               → 「①c low lower bound must fail: {"code":"GO",…} mean=16 lo=0」
//   ①c 闸拒 > 改 ≥ / 不查                      → 「①c gate 6/300 = 2% must be valid」/「①c gate 7/300 must be INVALID」
//   ①c 不查 mismatch / 缺局 / 坏局 / 重复结果 / 结果覆盖 / 预注册标记恒真 → 各自的 ①c 行红
//   ①d 报告改按结果到达顺序求和               → （修审查意见 3 之前不红：浮点末位差被 6 位小数抹平。现在收益是整数分子、
//                                              精确求和，求和顺序在数学上就不影响任何数——这条变异已无可观测效果。）
//   ── 审查修复（第二轮）新增断言的反向验证 ──
//   evalRecord 跳过闸拒 build 的 §13.9          → 「③e gate-rejected build + takeover must be unmeasurable: undefined」
//   report 丢掉闸拒 build 的 b139               → 「①e gate-rejected build state must stay in the calibration: {"code":"INVALID","reason":"§13.9 evaluated on 59/60 …」
//   闸拒且接管（不可测）不判 INVALID            → 「①e unmeasurable §13.9 takeover must be INVALID: {"code":"GO",…}」
//   cfgDiff 恒空 / 不核 seed 公式               → 「①e config seedBase|crn|l6 fallback … must be INVALID: {"code":"GO",…}」/「①e config seed …」
//   gainOf 回到浮点累加（旧实现）              → 「①f gainOf must accumulate exactly: 0.052083333333333336 + -0.05208333333333333」
//   去掉 12·ΔW 整数性检查                      → 「①f a 1/5 win share (12·ΔW not an integer) must throw」
//   decSet 恒 0 / 不进 reasons                  → 「③b gate-checked action set != searched action set must be flagged」/「①e action-set mismatch must be INVALID」
//   不查 §13.9 / §9 真实旧代码对照覆盖          → 「①e missing §13.9 live check must be INVALID」/「①e missing §9 live check must be INVALID」
//   fidAllowed:false 不标 / 不进 reasons；钩子随机数不进 reasons → 「③b fidAllowed:false must be flagged」/「①e fid not allowed …」/「①e hook randomness …」
//   Ĝ ≥ 改 >（整数判定）                       → 「①c Ĝ = 6.0pp and lower = 3.0pp exactly must pass: {"code":"NO-GO",…}」
//   选种类 > 0 改 ≥ 0                          → 「①a selected ["build","settle","craftbonus","captain"] …」
//   校准 Σ ≤ 0 改 ≤ 1                           → 「①c calibration boundary (Σ ≤ 0 passes, Σ = +1/768 fails)」
//   git archive 改取不存在的提交               → 「② commit d4cbcd6 not in this clone — …」rc=1；加 SUB_CENSUS_ALLOW_SKIP=1 → "skipped" rc=2
//   ②  seed0 用 turn+1                        → 「② §13.9 re-implementation differs from real d4cbcd6 vnetPickBuilding on 30/51」
//   ②  K=1 / 严格 > 改 ≥ / 不允许 PASS         → 16/51、10/51、7/51 不同
//   ②  旧游标改成 picksThisTurn−1（新口径）    → 11/51 不同
//   ②  rolloutToEnd 用恒 0.99 的流（ε 从不触发）→ 19/51；k 种子改整数异或 → 28/51；旧口径状态误置 _fid → 31/51
//   ②  §9 求解预算 2e6 改 50                  → 「② §9 re-implementation differs from real d4cbcd6 solverPickBuilding on 1/3」
//   （② 在没有 d4cbcd6 的副本里以前会 skipped 并算 PASS——第一次反向验证就是这样「全绿」的；现在缺提交即 FAIL）
//   ③b mismatch 恒 0 / 不查种子 / eqLive 恒 1（§13.9、§9）→ 各自的 ③b 行红
//   ③c 收益 perm 起点 3e6 改 2e6               → 「③c g100 k1: gain 0.2265625 != mean win-share difference 0.1796875 …」
//   ③c 收益叶用 reward（不换叶）               → 「③c g101 k17: gain 0.8400000000000013 != mean win-share difference 1 …」
//   ③d bSel 80 / δ 0.005 / z 2.2 / gateN 32   → 「③d pre-registered search on fixture changed: …」
//   ③a census 全程 fid 关（状态去 _fid 且 opts.fid=false）→ 「③a g101 k17 build: mismatch=1 liveMismatch=1」等 8 行
//      （只把 opts.fid 改 false 不红：采样行本身已带 _fid=true，cloneF 保留——这是设计，不是漏洞）
