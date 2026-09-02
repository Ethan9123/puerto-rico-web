// ============================================================
// tools/eval_pool.js — 参考池评级 worker(候选 vs 多样化对手池)
// ============================================================
// 动机: eval_paired_worker 只测 1×候选 vs 3×同质 L5, 4 人对称局里胜率天花板贴近 25% 公平份额,
// 无法把候选放到"多样化参照系"里排名。本工具每局 4 个座位由 5 个智能体
//   L3 / L4 / L5 / L6(现役 NN, 默认钩子) / CAND(候选 = L6 + --nn 权重 + --knob 钩子)
// 组成: CAND 每局必上, 其余 3 席从 {L3,L4,L5,L6} 中(按种子)不放回抽取 → 每局 4 个互不相同的
// 智能体; CAND 座位 = g % 4 轮转, 其余 3 席位置按种子随机排列。
// 不传 --nn / --knob 时 CAND 与 L6 完全相同 → 报告里两者评级应相等(自检)。
//
// 同一局里 L6 与 CAND 要用不同的 NN: sim_nn 只有一个全局网络, 这里在 PRSim.networkEval /
// evalLeafNN / evalLeafVecNN 上包一层, 依据 G._actingSeat(game.js 每个决策前都会设置)
// 在两套已 _prep 的权重对象之间切换(PRSim.loadNetwork(对象) 同步赋值 NET, 零拷贝)。
// --knob 钩子(window._alphaC 等)同理做成 getter: 仅 CAND 行动时可见, L6 永远走默认值;
// _l6Heur 则按 p.idx 直接包 l6h()。
//
// 每局一行 JSON {g, seed, candSeat, seats:[agent×4], levels, scores, winners, win, ranks,
//   marginBest, marginAvg, comp} → tools/eval_pool_report.js 汇总(Plackett-Luce 评级等)。
//
// 用法: node tools/eval_pool.js --games N [--out file] [--seedBase S] [--shard i/n]
//         [--nn path] [--knob k=v ...] [--fast] [--progress 10]
//   --shard i/n : 本进程只跑 g % n === i 的局(交错分片, 各分片种子/座位/阵容分布均衡)
//   --knob k=v  : v 按 JSON 解析(失败则按字符串); v 以 @ 开头表示读 JSON 文件(如 --knob _l6Heur=@h.json)
//   --fast      : 冒烟测试用极小迭代数(结果无强度意义)
// 种子: 每局 seed = (seedBase + g*1000003)>>>0, 与 eval_paired_worker.js 一致; 阵容抽样用
//       独立 PRNG(seed ^ 0x9E3779B9), 与对局随机流解耦。预算: iter-bounded, 与 paired 一致。
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./_sandbox.js');

// ---- 参数解析 ----
function parseArgs(argv) {
  const o = { games: 200, out: null, seedBase: 20260611, shard: [0, 1], nn: null, knobs: {}, fast: false, progress: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error('missing value for ' + a); return argv[++i]; };
    if (a === '--games') o.games = parseInt(next());
    else if (a === '--out') o.out = next();
    else if (a === '--seedBase') o.seedBase = parseInt(next());
    else if (a === '--shard') { const m = /^(\d+)\/(\d+)$/.exec(next()); if (!m) throw new Error('--shard i/n'); o.shard = [parseInt(m[1]), parseInt(m[2])]; }
    else if (a === '--nn') o.nn = next();
    else if (a === '--knob') {
      const kv = next(); const eq = kv.indexOf('=');
      if (eq < 0) throw new Error('--knob k=v');
      const k = kv.slice(0, eq); let v = kv.slice(eq + 1);
      if (v.startsWith('@')) v = JSON.parse(fs.readFileSync(v.slice(1), 'utf8'));
      else { try { v = JSON.parse(v); } catch (e) { /* 保留字符串 */ } }
      o.knobs[k] = v;
    }
    else if (a === '--fast') o.fast = true;
    else if (a === '--progress') o.progress = parseInt(next());
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n')); process.exit(0); }
    else throw new Error('unknown arg: ' + a);
  }
  if (!(o.games > 0)) throw new Error('--games must be > 0');
  if (!(o.shard[1] > 0) || o.shard[0] >= o.shard[1]) throw new Error('--shard i/n needs 0<=i<n');
  if (!o.out) o.out = `data/pool/pool-${o.shard[0]}of${o.shard[1]}.jsonl`;
  return o;
}
const ARGS = parseArgs(process.argv.slice(2));
const NN_ABS = ARGS.nn ? path.resolve(ARGS.nn) : null;
if (NN_ABS && !fs.existsSync(NN_ABS)) { console.error('--nn not found: ' + NN_ABS); process.exit(1); }

// ---- 智能体定义 ----
const AGENT_LEVEL = { L3: 3, L4: 4, L5: 5, L6: 6, CAND: 6 };
const REF_AGENTS = ['L3', 'L4', 'L5', 'L6'];

// ---- 可设种子的 Math 包装(必须在 game.js 加载前注入; 与 eval_paired_worker.js 相同) ----
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

// 阵容抽样(宿主侧, 独立 PRNG): 返回 4 席智能体名
function sampleSeats(g, seed) {
  const r = mulberry32((seed ^ 0x9E3779B9) >>> 0);
  const leaveOut = Math.floor(r() * REF_AGENTS.length);
  const others = REF_AGENTS.filter((_, i) => i !== leaveOut);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  const candSeat = g % 4;
  const seats = new Array(4);
  seats[candSeat] = 'CAND';
  let k = 0;
  for (let s = 0; s < 4; s++) if (s !== candSeat) seats[s] = others[k++];
  return { seats, candSeat };
}

fs.mkdirSync(path.dirname(ARGS.out), { recursive: true });
const _fd = fs.openSync(ARGS.out, 'w'); // 逐局追加写(崩溃不丢已完成对局)

const { run } = loadEngine({
  files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js', 'sim_solve.js'],
  beforeLoad: sb => {
    sb.Math = MathSeeded;
    sb.__setSeed = s => { _rng = mulberry32(s >>> 0); };
    sb.__writeRow = json => { fs.writeSync(_fd, json + '\n'); };
    sb.__sampleSeats = sampleSeats;
  },
});

const BUDGET = ARGS.fast
  ? { L4: 5, L5: 10, hardIters: 6, hardMs: 1e9, expertIters: 20, expertMs: 1e9, alphaIters: 20, alphaMs: 1e9 }
  : { L4: 50, L5: 100, hardIters: 60, hardMs: 1e9, expertIters: 400, expertMs: 1e9, alphaIters: 400, alphaMs: 1e9 }; // 与 eval_paired_worker.js 一致
const [SHARD_I, SHARD_N] = ARGS.shard;
const KNOBS = ARGS.knobs;
const HEUR = KNOBS._l6Heur || null;
const ACCESSOR_KNOBS = Object.assign({}, KNOBS); delete ACCESSOR_KNOBS._l6Heur;

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = ${JSON.stringify(BUDGET)};
  window.__candSeat = -1;
  const isCandActing = () => (G && G._actingSeat === window.__candSeat);
  // --knob: 仅 CAND 行动时可见; L6(现役) 永远读到 undefined → 默认值
  const KN = ${JSON.stringify(ACCESSOR_KNOBS)};
  for (const k of Object.keys(KN)) Object.defineProperty(window, k, { configurable: true, get() { return isCandActing() ? KN[k] : undefined; } });
  ${HEUR ? `{ const HEUR = ${JSON.stringify(HEUR)}; const _l6h = l6h; l6h = function (p, key) { if (p && p.idx === window.__candSeat && p._aiLevel === 6 && HEUR[key] != null) return HEUR[key]; return _l6h(p, key); }; }` : ''}
  await loadAIDNA();
  // 两套网络: 现役(默认来源) + 候选(--nn); loadNetwork 返回已 _prep 的对象, 之后按行动座位切换
  const deployNet = await PRSim.loadNetwork(resolveNNSource().src);
  const candNet = ${NN_ABS ? `await PRSim.loadNetwork(${JSON.stringify(NN_ABS)})` : 'deployNet'};
  if (!(PRSim.isLoaded && PRSim.isLoaded())) throw new Error('NN 未加载 → L6 会回退 L5, 测量无意义');
  let curNet = candNet; // 最后一次 loadNetwork 装入的是 candNet
  let swaps = 0;
  const ensureNet = () => {
    const want = isCandActing() ? candNet : deployNet;
    if (want === curNet) return;
    const cl = console.log; console.log = function () {};
    try { PRSim.loadNetwork(want).catch(function () {}); } finally { console.log = cl; } // 对象入参 → NET 同步赋值
    curNet = want; swaps++;
  };
  for (const fn of ['networkEval', 'evalLeafNN', 'evalLeafVecNN']) {
    const orig = PRSim[fn];
    PRSim[fn] = function () { ensureNet(); return orig.apply(this, arguments); };
  }
  const N = 4, LEVEL = ${JSON.stringify(AGENT_LEVEL)};
  const rows = [];
  let mine = 0; for (let g = 0; g < ${ARGS.games}; g++) if (g % ${SHARD_N} === ${SHARD_I}) mine++;
  for (let g = 0; g < ${ARGS.games}; g++) {
    if (g % ${SHARD_N} !== ${SHARD_I}) continue;
    const seed = (${ARGS.seedBase} + g * 1000003) >>> 0;
    const { seats, candSeat } = __sampleSeats(g, seed);
    window.__candSeat = candSeat;
    __setSeed(seed);
    G = new Game(N, 'AI');
    G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = LEVEL[seats[i]]; });
    await runMainLoop();
    if (!G.gameOver) { console.log('[warn] g=' + g + ' 未正常结束, 跳过'); continue; }
    const scores = G.players.map(p => p.vp + p.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].vp, 0) + G.getSpecialVPs(p));
    const best = Math.max(...scores);
    const winners = []; scores.forEach((t, i) => { if (t === best) winners.push(i); });
    const win = scores[candSeat] === best ? 1 / winners.length : 0;
    // 名次: 1 + 高于我的人数 + 0.5×与我同分的其他人数(并列取平均名次)
    const ranks = scores.map((t, i) => 1 + scores.filter(u => u > t).length + 0.5 * scores.filter((u, j) => j !== i && u === t).length);
    let bestOther = -Infinity, sumOther = 0;
    for (let i = 0; i < N; i++) if (i !== candSeat) { sumOther += scores[i]; if (scores[i] > bestOther) bestOther = scores[i]; }
    const comp = seats.filter((_, i) => i !== candSeat).slice().sort().join('+');
    const row = { g, seed, candSeat, seats, levels: seats.map(a => LEVEL[a]), scores, winners, win, ranks,
      marginBest: scores[candSeat] - bestOther, marginAvg: Math.round((scores[candSeat] - sumOther / (N - 1)) * 100) / 100, comp };
    __writeRow(JSON.stringify(row));
    rows.push(row);
    if (rows.length % ${ARGS.progress} === 0) console.log('[progress] ' + rows.length + '/' + mine + ' games, CAND win=' + (rows.reduce((s, r) => s + r.win, 0) / rows.length * 100).toFixed(1) + '%');
  }
  return { rows, swaps };
})()`;

const t0 = Date.now();
run(src).then(({ rows, swaps }) => {
  fs.closeSync(_fd);
  const w = rows.reduce((s, r) => s + r.win, 0);
  const secs = (Date.now() - t0) / 1000;
  console.log(`[pool] shard=${SHARD_I}/${SHARD_N} nn=${ARGS.nn || 'DEPLOY'} knobs=${JSON.stringify(KNOBS)} games=${ARGS.games} played=${rows.length} CAND win=${rows.length ? (w / rows.length * 100).toFixed(1) : '-'}% nnSwaps=${swaps} ${secs.toFixed(0)}s (${rows.length ? (secs / rows.length).toFixed(1) : '-'}s/局) -> ${ARGS.out}`);
}).catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
