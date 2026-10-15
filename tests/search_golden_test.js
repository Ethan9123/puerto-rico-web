// ============================================================
// tests/search_golden_test.js — 角色搜索(ISMCTS)的"金标准"回归
// ============================================================
// 目的：把 sim.js 角色搜索的**当前**数值行为逐位钉死，供之后"声称逐位一致"的提速改写
// （sim.js 热路径重写、缓存、循环外提……）自证：同种子下每个根动作的访问数 N 与累计回报 Q
// （精确 double）必须与 tests/golden/search_stats_v1.json 完全相同。任何一位漂移 = 行为变了。
//
// 覆盖：68 个确定性生成的中盘根局面（全部由 mulberry32 种子驱动，不碰 Math.random）
//   4 人基础局 ×40 · 2 人 ×6（每轮 6 次选角）· 3 人 ×6 · 5 人 ×6（双淘金者）
//   · 贵族+Tibs 建筑扩展 ×10（2~5 人混合；expansionNobles+expansionTibs，不含新建筑 24-37）
// 每个局面跑三档搜索（各自在全新 clone 上 st.rnd = mulberry32(派生种子)，maxIters=200、budgetMs=1e9
// 使迭代数与墙钟无关）：
//   alpha  : searchOptsForMode('alpha', {C:1.5, truncate:999, rolloutFrac:0})，NN=mcts_value_nn.json，
//            强制纯 JS 前向（root._nnForceJS=true；本测试不加载 nn_wasm.js）
//   expert : searchOptsForMode('expert', {truncate:8, valueW:null})  —— 与 game.js ismctsPickRole 的
//            expert 档逐字一致（不传 C → 默认 1.0；无 valueW → 完整 rollout）
//   hard   : searchOptsForMode('hard', 同上)  —— evalLeafFn = econReward，截断 8 步
// 记录 {idx, iters, stats:[{nm,N,Q}]}；另对 20 个局面做一次带种子的 rolloutToEnd，记录每名玩家
// reward() 与 finalScore()，专抓计分漂移。每个局面还带一个规范化状态摘要（digest），
// 用来区分"局面生成就漂了（applyRole/启发式变了）"与"只有搜索变了"。
// 沙盒里的 Math.random 被计数：生成/搜索期间只要被调用一次（=某处没走 st.rnd）就直接判失败。
// alpha 的 NN 先验调用(PRSim.networkEval)也被计数：失败一次（sim.js 会静默退回均匀先验）即判失败。
//
// 用法：
//   node tests/search_golden_test.js            对照 golden，逐位相等；打印首个不一致；不一致 exit 1
//   node tests/search_golden_test.js --write    重新生成 golden（会打印警告——只在**有意**改变搜索
//                                               行为并已评估强度后才应重写）
// 退出码：0=一致；1=不一致/出错；2 且输出 "skipped"=缺 NN 权重（tools/run_tests.sh 视为 SKIP）
//
// ---- 仅供测试的钩子：GOLDEN_SIM_SRC_PATCH ----
//   GOLDEN_SIM_SRC_PATCH='from=>to' 时，在把 sim.js 源码送进沙盒**之前**，对源码字符串做纯文本替换
//   （全部出现处；按第一个 "=>" 切分；from 找不到则报错退出，防止"补丁没生效却显示绿"）。
//   用途：反向验证本测试确实能抓到微小的数值改动，而无需修改磁盘上的 sim.js，例如
//     GOLDEN_SIM_SRC_PATCH='/ 30; // 归一化分差=>/ 31; // 归一化分差' node tests/search_golden_test.js   # 应 RED
//   与 --write 同用会被拒绝（绝不能把打过补丁的行为写进 golden）。
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { createSandbox } = require('../tools/_sandbox.js');

const REPO = path.resolve(__dirname, '..');
const GOLDEN_PATH = path.join(__dirname, 'golden', 'search_stats_v1.json');
const NN_FILE = 'mcts_value_nn.json';
const WRITE = process.argv.includes('--write');
const PATCH = process.env.GOLDEN_SIM_SRC_PATCH || '';

// ---- 配置（改动任何一项都会让 golden 失配 → 必须 --write 重生）----
const ITERS = 200;
const SUITES = [
  // name, count, 人数(函数: 局内序号→人数), 种子基, 建筑池, 做 rollout 计分记录的前 N 个
  { name: '4p', count: 40, np: () => 4, seedBase: 0x4000, pool: 'base', rollouts: 8 },
  { name: '2p', count: 6, np: () => 2, seedBase: 0x2000, pool: 'base', rollouts: 3 },
  { name: '3p', count: 6, np: () => 3, seedBase: 0x3000, pool: 'base', rollouts: 2 },
  { name: '5p', count: 6, np: () => 5, seedBase: 0x5000, pool: 'base', rollouts: 3 },
  { name: 'tibsNobles', count: 10, np: (i) => [4, 3, 4, 5, 2][i % 5], seedBase: 0x7000, pool: 'tibsNobles', rollouts: 4 },
];
const MODES = [
  { mode: 'alpha', base: { maxIters: ITERS, budgetMs: 1e9, C: 1.5, truncate: 999, rolloutFrac: 0, returnStats: true } },
  { mode: 'expert', base: { maxIters: ITERS, budgetMs: 1e9, valueW: null, truncate: 8, returnStats: true } },
  { mode: 'hard', base: { maxIters: ITERS, budgetMs: 1e9, valueW: null, truncate: 8, returnStats: true } },
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 派生子种子（整数哈希混合；避免相邻种子的 mulberry32 流相关）
function mix(a, b) {
  let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA77)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
  return h >>> 0;
}
function fnv1a(str) {
  let h = 0x811C9DC5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
// 非有限数在 JSON 里会变 null → 统一编码成字符串，保证比较是逐位的
const num = (x) => (typeof x === 'number' && !Number.isFinite(x)) ? String(x) : x;

// 状态的规范化投影（只含博弈语义字段；undefined/false/0 归一，避免"显式初始化某字段"这类无害重构误报）
function digestState(st) {
  const proj = [
    st.numPlayers, st.governor, st.turnNumber, !!st.gameOver, !!st.endTriggered, st.picksThisTurn,
    !!st.expansion, !!st.expansionNobles, !!st.expansionTibs, st.noblesLeft || 0, st.noblesOnShip || 0,
    st.colonistsLeft, st.colonistsOnShip, st.vpLeft, st.quarriesLeft,
    Object.keys(st.supply).sort().map(k => [k, st.supply[k]]),
    Object.keys(st.buildingStock).sort((a, b) => a - b).map(k => [+k, st.buildingStock[k]]),
    st.plantationDeck, st.plantationDiscard, st.plantationPool,
    st.ships.map(s => [s.capacity, s.good, s.count]), st.tradingHouse,
    st.roleCards.map(r => [r.name, r.money, !!r.taken, r.takenBy == null ? -1 : r.takenBy]),
    st.players.map(p => [
      p.idx, p.money, p.vp, p.shippingVP || 0, p.unplaced || 0, p.unplacedNobles || 0, p._invest || 0,
      !!p.wharfUsed, !!p.smallWharfUsed, !!p._towerShipped,
      p.plantations.map(pl => [pl.good, !!pl.manned, !!pl.noble]),
      p.buildings.map(b => [b.bid, b.men, b.nobles || 0]),
      Object.keys(p.goods).sort().map(k => [k, p.goods[k]]),
    ]),
  ];
  return fnv1a(JSON.stringify(proj));
}

// ---- golden 文件读写：每个局面一行，便于 diff ----
function serialize(doc) {
  const head = Object.assign({}, doc); delete head.states;
  const lines = JSON.stringify(head, null, 1).replace(/\n\}$/, '');
  return lines + ',\n "states": [\n' + doc.states.map(s => '  ' + JSON.stringify(s)).join(',\n') + '\n ]\n}\n';
}
// 首个差异路径（=== 逐位比较；数组先比长度）
function firstDiff(a, b, p) {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return { path: p, golden: a, got: b };
  if (Array.isArray(a) !== Array.isArray(b)) return { path: p, golden: a, got: b };
  if (Array.isArray(a)) {
    if (a.length !== b.length) return { path: p + '.length', golden: a.length, got: b.length };
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.slice().sort().join(',') !== kb.slice().sort().join(',')) return { path: p + ' (keys)', golden: ka, got: kb };
  // 按 golden 的写入顺序走（state → search(alpha,expert,hard) → rollout），"首个差异"即最上游的那个
  for (const k of ka) { const d = firstDiff(a[k], b[k], `${p}.${k}`); if (d) return d; }
  return null;
}

(async () => {
  if (!fs.existsSync(path.join(REPO, NN_FILE))) {
    console.log(`search_golden_test: skipped (${NN_FILE} missing; alpha mode needs the NN weights)`);
    process.exit(2);
  }
  if (WRITE && PATCH) { console.error('refusing --write while GOLDEN_SIM_SRC_PATCH is set (would bake a patched sim.js into golden)'); process.exit(1); }
  const t0 = Date.now();

  // ---- 沙盒：game.js(静态表) → sim.js(可选补丁) → sim_features.js → sim_nn.js；不加载 nn_wasm.js ----
  // 沙盒内 Math 换成计数版 Math.random（其余成员同宿主）：生成+搜索段内任何一次 Math.random 调用都意味着
  // 某处没走 st.rnd → 结果不可复现，直接判失败，而不是留下"偶发不一致"。
  let mathRandomCalls = 0;
  const { sandbox, load, run } = createSandbox({ beforeLoad: (sb) => {
    const M = {}; for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
    M.random = () => { mathRandomCalls++; return Math.random(); };
    sb.Math = M;
  } });
  load('game.js');
  let simSrc = fs.readFileSync(path.join(REPO, 'sim.js'), 'utf8');
  if (PATCH) {
    const cut = PATCH.indexOf('=>');
    if (cut <= 0) { console.error(`GOLDEN_SIM_SRC_PATCH must be 'from=>to' (got ${JSON.stringify(PATCH)})`); process.exit(1); }
    const from = PATCH.slice(0, cut), to = PATCH.slice(cut + 2);
    const hits = simSrc.split(from).length - 1;
    if (hits === 0) { console.error(`GOLDEN_SIM_SRC_PATCH: ${JSON.stringify(from)} not found in sim.js — patch not applied`); process.exit(1); }
    simSrc = simSrc.split(from).join(to);
    console.log(`[test-only hook] GOLDEN_SIM_SRC_PATCH applied to in-memory sim.js: ${JSON.stringify(from)} → ${JSON.stringify(to)} (${hits} occurrence${hits > 1 ? 's' : ''})`);
  }
  run(simSrc, 'sim.js');
  load('sim_features.js');
  load('sim_nn.js');
  const S = sandbox.PRSim;
  // 旋钮卫生：golden 只对应默认旋钮（sim.js 读 root._mctsC/_mctsEps/_l6ValueNet 与 window._captainDeny）
  for (const k of ['_mctsC', '_mctsEps', '_captainDeny', '_l6ValueNet', '_l6LeafTruncate', '_l6RolloutFrac']) delete sandbox[k];
  sandbox._nnForceJS = true;
  const log0 = console.log; console.log = () => {};                      // 静音 sim_nn 的加载日志
  try { await S.loadNetwork(NN_FILE); } finally { console.log = log0; }
  // nnBackend() 在没加载网络时也返回 'js'，单看它证明不了 NN 在位 → 另查 isLoaded()
  if (!S.isLoaded()) throw new Error(`${NN_FILE} did not load (PRSim.isLoaded() is false)`);
  if (S.nnBackend() !== 'js') throw new Error('expected JS NN backend, got ' + S.nnBackend());
  // alpha 的先验(priorPolicyFn)在 sim.js 里被 try/catch 包着：networkEval 抛错/返回 null 时会**静默**退回均匀先验。
  // 包一层只计数、不改数值：任何一次失败都判 FAIL；--write 时还要求确实调用过（防止把"没有 NN 先验的 alpha"写进 golden）。
  const nnStat = { calls: 0, failed: 0 };
  const nnEval = S.networkEval;
  S.networkEval = function (st, seat) {
    nnStat.calls++;
    let out;
    try { out = nnEval(st, seat); } catch (e) { nnStat.failed++; throw e; }
    if (!out) nnStat.failed++;
    return out;
  };

  // 建筑池：sim.js 的 BUILDINGS_ 与 game.js 的全局 BUILDINGS 是同一个数组（Game 构造函数原地改写它）。
  // tibsNobles = Game 构造函数在 {nobles, tibsBuildings} 模块组合下的写法：基础建筑去掉济贫院(11) + 贵族 + Tibs。
  const setPool = (pool) => run(`(function (pool) {
    BUILDINGS.length = 0;
    for (const b of BASE_BUILDINGS) { if (pool === 'tibsNobles' && b.id === 11) continue; BUILDINGS.push(b); }
    if (pool === 'tibsNobles') { for (const b of NOBLE_BUILDINGS) BUILDINGS.push(b); for (const b of TIBS_BUILDINGS) BUILDINGS.push(b); }
    BLD_BY_ID[15].cost = 7; BLD_BY_ID[16].cost = 8;   // 非平衡模式（Game 构造函数每局显式设）
    return BUILDINGS.length;
  })`)(pool);

  // ---- 确定性中盘局面：newState + 启发式为主（25% 带种子随机合法角色）推进若干选角步 ----
  function genState(np, seed, pool) {
    for (let attempt = 0; attempt < 50; attempt++, seed = (seed + 7919) >>> 0) {
      const rnd = mulberry32(seed), crnd = mulberry32(mix(seed, 0xC401CE));
      const st = S.newState(np, new Array(np).fill(5), rnd);
      if (pool === 'tibsNobles') {   // 与 Game 构造函数的贵族开局一致：20 贵族，1 名上殖民船替换 1 名殖民者
        st.expansionNobles = true; st.expansionTibs = true; st.expansion = false;
        st.noblesLeft = 19; st.noblesOnShip = 1; st.colonistsOnShip -= 1; st.colonistsLeft += 1;
      }
      const ppr = np === 2 ? 6 : np;
      const steps = 2 * ppr + Math.floor(crnd() * 9 * ppr);
      let k = 0;
      for (; k < steps + 3 * ppr && !S.isTerminal(st); k++) {
        const ch = S.currentChooser(st); if (ch < 0) break;
        const legal = S.legalRoleIdxs(st); if (!legal.length) break;
        if (k >= steps && legal.length >= 2) break;   // 到步数后停在第一个 ≥2 合法角色的决策点
        const ri = crnd() < 0.25 ? legal[Math.floor(crnd() * legal.length)] : S.heuristicPickRole(st, ch, legal);
        S.applyRole(st, ri);
      }
      if (!S.isTerminal(st) && S.currentChooser(st) >= 0 && S.legalRoleIdxs(st).length >= 2) return { st, seed, steps: k };
    }
    throw new Error(`genState: no valid mid-game state for np=${np}`);
  }

  const modeMs = { alpha: 0, expert: 0, hard: 0 };
  const states = [];
  mathRandomCalls = 0;   // 以下全部同步执行：计数只会来自局面生成/搜索/rollout 本身
  for (const suite of SUITES) {
    setPool(suite.pool);
    for (let i = 0; i < suite.count; i++) {
      const np = suite.np(i);
      const g = genState(np, mix(suite.seedBase, i), suite.pool);
      const st = g.st;
      const rec = {
        suite: suite.name, i, np, seed: g.seed, steps: g.steps,
        state: { turn: st.turnNumber, picks: st.picksThisTurn, chooser: S.currentChooser(st),
          legal: S.legalRoleIdxs(st).map(r => st.roleCards[r].name), digest: digestState(st) },
        search: {},
      };
      MODES.forEach((m, mi) => {
        const c = S.clone(st);
        c.rnd = mulberry32(mix(g.seed, 101 + mi));
        const t1 = Date.now();
        const r = S.ismctsPickRoleIdx(c, S.searchOptsForMode(m.mode, m.base));
        modeMs[m.mode] += Date.now() - t1;
        rec.search[m.mode] = { idx: r.idx, iters: r.iters, stats: r.stats.map(s => ({ nm: s.nm, N: s.N, Q: num(s.Q) })) };
      });
      if (i < suite.rollouts) {
        const c = S.clone(st);
        c.rnd = mulberry32(mix(g.seed, 201));
        S.rolloutToEnd(c, mulberry32(mix(g.seed, 202)));
        rec.rollout = { turn: c.turnNumber, reward: c.players.map((_, p) => num(S.reward(c, p))),
          finalScore: c.players.map(p => num(S.finalScore(p, c))) };
      }
      states.push(rec);
    }
  }
  setPool('base');   // 复原全局建筑池
  if (mathRandomCalls > 0) {
    console.log(`FAIL: Math.random was called ${mathRandomCalls} times during state generation/search — some path ignores st.rnd, results are not seed-reproducible`);
    process.exit(1);
  }
  if (nnStat.failed > 0 || (WRITE && nnStat.calls === 0)) {
    console.log(`FAIL: alpha NN prior degraded — networkEval calls=${nnStat.calls}, failed (threw/null)=${nnStat.failed}; ` +
      'priorPolicyFn silently falls back to a uniform prior in that case');
    process.exit(1);
  }
  const elapsed = (Date.now() - t0) / 1000;
  const timing = `${states.length} states × ${MODES.length} modes × ${ITERS} iters in ${elapsed.toFixed(1)} s ` +
    `(alpha ${(modeMs.alpha / 1000).toFixed(1)} s, expert ${(modeMs.expert / 1000).toFixed(1)} s, hard ${(modeMs.hard / 1000).toFixed(1)} s; ` +
    `${nnStat.calls} NN prior evals)`;

  const doc = {
    version: 1,
    about: 'Golden ISMCTS root stats for sim.js role search; regenerate ONLY for intended behaviour changes: node tests/search_golden_test.js --write',
    config: { iters: ITERS, modes: MODES.map(m => ({ mode: m.mode, base: m.base })), suites: SUITES.map(s => ({ name: s.name, count: s.count, pool: s.pool, rollouts: s.rollouts })), nn: NN_FILE, nnBackend: 'js' },
    states,
  };

  if (WRITE) {
    fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
    fs.writeFileSync(GOLDEN_PATH, serialize(doc));
    console.log('WARNING: --write regenerated ' + path.relative(REPO, GOLDEN_PATH) + ' from the CURRENT sim.js. ' +
      'Only commit this if the search-behaviour change is intended (byte-identical speedups must pass WITHOUT --write).');
    console.log(timing);
    process.exit(0);
  }

  if (!fs.existsSync(GOLDEN_PATH)) { console.log(`FAIL: ${path.relative(REPO, GOLDEN_PATH)} missing — run with --write on a known-good sim.js`); process.exit(1); }
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
  const cfgDiff = firstDiff(golden.config, JSON.parse(JSON.stringify(doc.config)), 'config');
  if (cfgDiff) {
    console.log(`FAIL: test config differs from golden at ${cfgDiff.path}: golden=${JSON.stringify(cfgDiff.golden)} got=${JSON.stringify(cfgDiff.got)} — regenerate with --write if intended`);
    process.exit(1);
  }
  const got = JSON.parse(JSON.stringify(states));   // 与 golden 同样经过一次 JSON 往返
  let first = null; const bad = [];
  const n = Math.max(golden.states.length, got.length);
  for (let k = 0; k < n; k++) {
    const gs = golden.states[k], ns = got[k];
    const d = firstDiff(gs, ns, `states[${k}]`);
    if (!d) continue;
    const where = gs ? `${gs.suite}#${gs.i}` : `#${k}`;
    const parts = [];
    if (gs && ns) {
      if (gs.state.digest !== ns.state.digest || gs.seed !== ns.seed) parts.push('state');
      for (const m of MODES) if (firstDiff(gs.search[m.mode], ns.search[m.mode], '')) parts.push(m.mode);
      if (firstDiff(gs.rollout, ns.rollout, '')) parts.push('rollout');
    }
    bad.push(`${where}[${parts.join(',') || '?'}]`);
    if (!first) first = { d, where, stateDrift: parts.includes('state') };
  }
  if (first) {
    console.log(`FAIL: search golden mismatch in ${bad.length}/${n} states`);
    console.log(`  first mismatch (${first.where}) at ${first.d.path}`);
    console.log(`    golden: ${JSON.stringify(first.d.golden)}`);
    console.log(`    got   : ${JSON.stringify(first.d.got)}`);
    if (first.stateDrift) console.log('  note: the ROOT STATE itself differs → newState/applyRole/heuristic play changed, not only the search');
    console.log('  mismatching: ' + bad.slice(0, 30).join(' ') + (bad.length > 30 ? ` … (+${bad.length - 30})` : ''));
    console.log('  ' + timing);
    process.exit(1);
  }
  console.log(`OK search golden: ${n} states × {${MODES.map(m => m.mode).join(',')}} bit-identical to ${path.relative(REPO, GOLDEN_PATH)}` +
    ` (+${got.filter(s => s.rollout).length} rollout score records)`);
  console.log('  ' + timing);
  process.exit(0);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
