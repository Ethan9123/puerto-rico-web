// ============================================================
// tools/rp_diag.js — L6 根并行效率诊断（第三轮 Stage 2，预注册见 AI_STRENGTH §18.2）
// ============================================================
// 问题：浏览器里 L6 用 K 个 worker 各跑一棵树（根并行 RP），按角色名合并 N/Q。叶 rollout 是确定性启发式，
// 各树只在确定化（牌堆洗牌）上不同 → 很可能高度相关、白白浪费 K−1 个核。这里在决策层直接量：
//   S_N      单树 N 次迭代
//   RP4×N    4 棵树各 N 次（worker k 的种子 = seedBase + k·0x9E3779B9，与 PRAIPool.pickRoleParallel 同式），合并后 selectRootRole
//   RPdiv4×N 同 RP4×N，但 worker k≥1 的叶推进带 leafEps=0.05（sim.js ismctsPickRoleIdx 的 leafEps 选项）
//   S_4N     单树 4N 次（"4 倍算力用在一棵树上"的上限参照）
//   oracle   S_16N，2 个独立种子
// 每个配置 × 2 个种子（replicate r=0/1）。RP 的 worker 0 与同 r 的 S_N 同种子（公共随机数 → 差值方差更小）。
// tests/rp_emulation_test.js 已证：真实 PRAIPool 的合并统计 == 这里的"逐 worker 直接搜索再按序相加"。
//
// 指标（每个局面，对 2 个种子取平均）：
//   agree  = 所选角色 == oracle argmax（只在两个 oracle 种子 argmax 一致的局面上计）
//   regret = oracle 值(最优角色) − oracle 值(所选角色)；oracle 值 = 两个 oracle 种子合并的 ΣQ/ΣN（该角色 oracle 未访问 → 取已访问角色的最小值）
// η = (m_cfg − m_SN) / (m_S4N − m_SN)；按局（每局 2 个局面）聚类自助 2000 次，90% 双侧百分位区间。
// 自助样本里分母 ≤ 0（S_4N 不比 S_N 好）→ η 无定义：下界按 −∞、上界按 +∞ 计（两个分支都更难触发 = 保守）。
//
// 用法：
//   1) 采局面（与评测种子不相交；CRN 模式 → 与分片无关）：
//        EVAL_CRN=1 EVAL_HARVEST=h-0.jsonl node tools/eval_paired_worker.js DEPLOY 5 0 19 x-0.jsonl 20261123   （…分片跑满 g0–74）
//   2) 选局面：node tools/rp_diag.js select h-*.jsonl --games 75 --per 2 --out states.jsonl
//   3) 跑搜索：ENGINE_ROOT=/home/user/pr-wt/<sha> node tools/rp_diag.js run states.jsonl --shard k/M --out part-k.jsonl [--N 400,1600]
//   4) 报告：node tools/rp_diag.js report part-*.jsonl [--boot 2000]
'use strict';
const fs = require('fs');
const path = require('path');

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
function argOpt(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const K = 4, DIV_EPS = 0.05, SEED_TAG = 20261123;

// ---------------------------------------------------------------- select
function cmdSelect(files) {
  const games = parseInt(argOpt('--games', '75')), per = parseInt(argOpt('--per', '2'));
  const out = argOpt('--out', 'states.jsonl');
  const byG = new Map();
  for (const f of files) for (const r of readJsonl(f)) { if (!byG.has(r.g)) byG.set(r.g, []); byG.get(r.g).push(r); }
  const gs = [...byG.keys()].sort((a, b) => a - b);
  if (gs.length !== games || gs[0] !== 0 || gs[gs.length - 1] !== games - 1) throw new Error(`采样局号不完整：得到 ${gs.length} 局 [${gs[0]}..${gs[gs.length - 1]}]，要求 g0–${games - 1}`);
  const lines = [];
  for (const g of gs) {
    const rows = byG.get(g).sort((a, b) => a.k - b.k);
    if (rows.length < per) throw new Error(`g${g} 只有 ${rows.length} 个 L6 决策`);
    // 局内按固定种子无放回抽 per 个（与结果无关的纯函数）
    const rnd = mulberry32((SEED_TAG ^ Math.imul(g + 1, 0x9E3779B1)) >>> 0);
    const idx = rows.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const pick = idx.slice(0, per).sort((a, b) => a - b);
    pick.forEach((i, j) => lines.push(JSON.stringify({ id: `${g}:${j}`, g, j, k: rows[i].k, seat: rows[i].seat, st: rows[i].st })));
  }
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`[select] ${lines.length} states from ${gs.length} games -> ${out}`);
}

// ---------------------------------------------------------------- run
async function cmdRun(statesFile) {
  const ROOT = process.env.ENGINE_ROOT || path.resolve(__dirname, '..');
  const { loadEngine } = require(path.join(ROOT, 'tools/_sandbox.js'));
  const { PRSim: S } = loadEngine({ repoRoot: ROOT, files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', { file: 'nn_wasm.js', optional: true }, 'sim_nn.js'] });
  await S.loadNetwork(path.join(ROOT, 'mcts_value_nn.json'));
  const Ns = argOpt('--N', '400,1600').split(',').map(Number);
  const [shK, shM] = argOpt('--shard', '0/1').split('/').map(Number);
  const out = argOpt('--out', `rp_diag-part${shK}.jsonl`);
  const states = readJsonl(statesFile).filter((_, i) => i % shM === shK);
  // 续跑：已写完的局面跳过
  const done = new Set(fs.existsSync(out) ? readJsonl(out).map(r => r.id) : []);
  const fd = fs.openSync(out, 'a');
  const base = { budgetMs: 1e9, C: 1.5, truncate: 999, rolloutFrac: 0, returnStats: true };   // = 部署的 L6 选项（game.js aiPickRoleAsyncCore）
  const search = (st0, iters, seed, extra) => {
    const st = S.clone(st0); st.rnd = mulberry32(seed >>> 0);
    const t0 = process.hrtime.bigint();
    const r = S.ismctsPickRoleIdx(st, S.searchOptsForMode('alpha', Object.assign({}, base, { maxIters: iters }, extra || {})));
    return { idx: r.idx, iters: r.iters, stats: r.stats, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  };
  const merge = (list) => {           // 与 PRAIPool.pickRoleParallel 相同：按 worker 顺序、按角色名累加 N/Q（Map 插入序）
    const m = new Map();
    for (const r of list) for (const s of r.stats) { const e = m.get(s.nm); if (e) { e.N += s.N; e.Q += s.Q; } else m.set(s.nm, { nm: s.nm, N: s.N, Q: s.Q }); }
    return Array.from(m.values());
  };
  const nameOf = (st, i) => (i != null && i >= 0 && st.roleCards[i]) ? st.roleCards[i].name : null;
  // 引擎必须支持 leafEps（否则 RPdiv 会静默等于 RP）：同种子下 leafEps=0.5 必须改变统计
  if (states.length) {
    const st0 = states[0].st; st0.rnd = Math.random;
    const a = search(st0, 60, 12345), b = search(st0, 60, 12345, { leafEps: 0.5 });
    if (JSON.stringify(a.stats) === JSON.stringify(b.stats)) throw new Error(`ENGINE_ROOT=${ROOT} 的 sim.js 不支持 leafEps（RPdiv 会等于 RP）`);
  }
  let n = 0;
  for (const rec of states) {
    if (done.has(rec.id)) continue;
    const st0 = rec.st; st0.rnd = Math.random;   // 占位；每次搜索都在 clone 上换成带种子的流
    if (S.currentChooser(st0) < 0 || S.legalRoleIdxs(st0).length < 2) throw new Error(`${rec.id}: 不是 ≥2 合法角色的决策局面`);
    const row = { id: rec.id, g: rec.g, j: rec.j, legal: S.legalRoleIdxs(st0).map(i => st0.roleCards[i].name), byN: {} };
    for (const N of Ns) {
      const res = { oracle: [], S_N: [], RP: [], RPdiv: [], S_4N: [] };
      for (let r = 0; r < 2; r++) {
        const o = search(st0, 16 * N, fnv1a(`rpdiag-oracle|${rec.id}|${N}|${r}`));
        res.oracle.push({ nm: nameOf(st0, o.idx), stats: o.stats, iters: o.iters, ms: o.ms });
        const sb = fnv1a(`rpdiag|${rec.id}|${N}|${r}`);
        const w = [], wd = [];
        for (let k = 0; k < K; k++) {
          const seed = (sb + k * 0x9E3779B9) >>> 0;
          const a = search(st0, N, seed);
          w.push(a);
          wd.push(k === 0 ? a : search(st0, N, seed, { leafEps: DIV_EPS }));   // worker 0 不加噪声 → 与 RP 的 worker 0 相同
        }
        res.S_N.push({ nm: nameOf(st0, w[0].idx), iters: w[0].iters, ms: w[0].ms });
        for (const [key, list] of [['RP', w], ['RPdiv', wd]]) {
          const merged = merge(list);
          const idx = S.selectRootRole(merged, st0, {});
          res[key].push({ nm: nameOf(st0, idx), iters: list.map(x => x.iters), merged });
        }
        const b = search(st0, 4 * N, sb);
        res.S_4N.push({ nm: nameOf(st0, b.idx), iters: b.iters, ms: b.ms });
      }
      row.byN[N] = res;
    }
    fs.writeSync(fd, JSON.stringify(row) + '\n');
    n++;
    console.log(`[run] ${rec.id} done (${n} this run)`);
  }
  fs.closeSync(fd);
  console.log(`[run] shard ${shK}/${shM}: ${n} new states -> ${out}`);
}

// ---------------------------------------------------------------- report
const CFGS = ['S_N', 'RP', 'RPdiv', 'S_4N'];
function perState(row, N) {
  const res = row.byN[N]; if (!res) return null;
  const pool = new Map();
  for (const o of res.oracle) for (const s of o.stats) { const e = pool.get(s.nm) || { N: 0, Q: 0 }; e.N += s.N; e.Q += s.Q; pool.set(s.nm, e); }
  const val = new Map(); let minV = Infinity;
  for (const [nm, e] of pool) if (e.N > 0) { const v = e.Q / e.N; val.set(nm, v); if (v < minV) minV = v; }
  let bestV = -Infinity; for (const v of val.values()) if (v > bestV) bestV = v;
  const vOf = nm => val.has(nm) ? val.get(nm) : minV;
  const oracleAgree = res.oracle[0].nm === res.oracle[1].nm;
  const oArg = res.oracle[0].nm;
  const m = {};
  for (const c of CFGS) {
    const picks = res[c].map(x => x.nm);
    m[c] = {
      regret: picks.reduce((a, nm) => a + (bestV - vOf(nm)), 0) / picks.length,
      agree: oracleAgree ? picks.reduce((a, nm) => a + (nm === oArg ? 1 : 0), 0) / picks.length : null,
    };
  }
  return { g: row.g, oracleAgree, m };
}
function cmdReport(files) {
  const B = parseInt(argOpt('--boot', '2000'));
  const expect = parseInt(argOpt('--expect', '150'));
  const rows = []; const seen = new Set();
  for (const f of files) for (const r of readJsonl(f)) { if (seen.has(r.id)) throw new Error(`重复局面 ${r.id}`); seen.add(r.id); rows.push(r); }
  if (rows.length !== expect) console.log(`⚠ 局面数 ${rows.length} ≠ 预期 ${expect} —— 结果不可作门槛判定`);
  const Ns = Object.keys(rows[0].byN).map(Number).sort((a, b) => a - b);
  const out = { states: rows.length, byN: {} };
  for (const N of Ns) {
    const ps = rows.map(r => perState(r, N)).filter(Boolean);
    const games = [...new Set(ps.map(p => p.g))].sort((a, b) => a - b);
    const byG = new Map(games.map(g => [g, ps.filter(p => p.g === g)]));
    const metric = (sample, key, c) => {
      let s = 0, n = 0;
      for (const p of sample) { const v = p.m[c][key]; if (v === null) continue; s += v; n++; }
      return n ? s / n : NaN;
    };
    const eta = (sample, key, c) => {
      const a = metric(sample, key, c), s1 = metric(sample, key, 'S_N'), s4 = metric(sample, key, 'S_4N');
      const den = key === 'regret' ? (s1 - s4) : (s4 - s1);       // "S_4N 比 S_N 好" 的量（>0）
      const num = key === 'regret' ? (s1 - a) : (a - s1);
      return den > 0 ? num / den : NaN;
    };
    const rnd = mulberry32(0xB007 ^ N);
    const res = { N, states: ps.length, oracleAgreeStates: ps.filter(p => p.oracleAgree).length, metrics: {} };
    for (const key of ['regret', 'agree']) {
      const point = {}; for (const c of CFGS) point[c] = metric(ps, key, c);
      const etas = { RP: [], RPdiv: [] }; let undef = 0;
      for (let b = 0; b < B; b++) {
        const sample = [];
        for (let i = 0; i < games.length; i++) sample.push(...byG.get(games[Math.floor(rnd() * games.length)]));
        let bad = false;
        for (const c of ['RP', 'RPdiv']) { const e = eta(sample, key, c); if (isNaN(e)) bad = true; etas[c].push(e); }
        if (bad) undef++;
      }
      const ci = arr => {
        const lo = arr.map(e => isNaN(e) ? -Infinity : e).sort((a, b) => a - b);
        const hi = arr.map(e => isNaN(e) ? Infinity : e).sort((a, b) => a - b);
        return [lo[Math.floor(0.05 * arr.length)], hi[Math.ceil(0.95 * arr.length) - 1]];
      };
      res.metrics[key] = {
        point, etaPoint: { RP: eta(ps, key, 'RP'), RPdiv: eta(ps, key, 'RPdiv') },
        eta90: { RP: ci(etas.RP), RPdiv: ci(etas.RPdiv) }, undefinedBootFrac: undef / B,
      };
    }
    out.byN[N] = res;
  }
  // 门槛（N=1600；两个指标同时满足才触发对应分支——§18.2 补充）
  const g = out.byN[1600];
  if (g) {
    const both = f => ['regret', 'agree'].every(k => f(g.metrics[k]));
    const rpdivShip = both(m => m.eta90.RPdiv[0] >= 0.75);
    const buildTP = both(m => m.eta90.RP[1] < 0.75 && m.eta90.RPdiv[1] < 0.75);
    out.verdict = rpdivShip ? 'RPDIV (subject to Stage 3 harm check)' : buildTP ? 'BUILD TP (Stage 3)' : 'KEEP RP';
  }
  console.log(JSON.stringify(out, (k, v) => (v === Infinity ? '+inf' : v === -Infinity ? '-inf' : (typeof v === 'number' && isNaN(v)) ? 'undef' : v), 2));
}

const cmd = process.argv[2];
const pos = process.argv.slice(3).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--')));
if (cmd === 'select') cmdSelect(pos);
else if (cmd === 'run') cmdRun(pos[0]).catch(e => { console.error(e); process.exit(1); });
else if (cmd === 'report') cmdReport(pos);
else { console.error('usage: rp_diag.js select|run|report ...'); process.exit(1); }
