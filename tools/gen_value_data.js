#!/usr/bin/env node
// ============================================================
// tools/gen_value_data.js — 价值网训练数据生成（Phase 2）
// ============================================================
// 4 人局、种子化的混合阵容自对弈；在每个角色决策边界记录 extractRich(st, 0)（座位 0 视角，
// 与 sim_nn.evalLeafVecNN 一致）量化为 uint8，终局记录每座位 finalScore。训练时按 sim.js
// reward() 公式派生目标，使价值网与完整 rollout 同尺度（可用 rolloutFrac 混合）。
//
// 用法:
//   node tools/gen_value_data.js --games 5000 --out data/value/heur-0.bin [--seedBase 20260901]
//        [--shard i/n] [--mix heur:0.7,hard:0.2,expert:0.1] [--eps 0.1] [--rollouts 0]
//        [--hardIters 60] [--expertIters 100] [--progress 500]
//   --mix      每座位阵容概率（heur=sim 启发式；hard=ISMCTS@hardIters+econ 截断叶；expert=ISMCTS@expertIters 纯 rollout）
//   --eps      每次选角以 ε 概率改选随机合法角色（覆盖搜索会到达的非启发式局面）
//   --rollouts 每个局面额外做 k 次启发式 rollout，存第 1 次与均值的 reward 向量（低方差目标 / 估计器基线）
//   --shard    只跑 g % n === i 的局（多进程分片，局号/种子全局一致）
// 种子: 局种子 (seedBase + g*1000003)>>>0 驱动 Math.random（同 eval_paired_worker）；阵容与 ε 决策用
//       解耦 PRNG mulberry32(seed ^ 0x9E3779B9)（同 eval_pool），换阵容不扰动同局牌序。
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./_sandbox.js');
const { writeShard } = require('./value_shard.js');

// ---- CLI ----
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) ? process.argv[++i] : 'true'; args[k] = v; }
}
const GAMES = parseInt(args.games || '100');
const OUT = args.out || 'data/value/shard.bin';
const SEED_BASE = parseInt(args.seedBase || '20260901');
const [SHARD_I, SHARD_N] = (args.shard || '0/1').split('/').map(Number);
const EPS = parseFloat(args.eps || '0');
const ROLLOUTS = parseInt(args.rollouts || '0');
const HARD_ITERS = parseInt(args.hardIters || '60');
const EXPERT_ITERS = parseInt(args.expertIters || '100');
const PROGRESS = parseInt(args.progress || '500');
const MIX = {};
for (const kv of (args.mix || 'heur:1').split(',')) { const [k, v] = kv.split(':'); MIX[k] = parseFloat(v); }
const MIX_KINDS = ['heur', 'hard', 'expert'];
const mixTot = MIX_KINDS.reduce((s, k) => s + (MIX[k] || 0), 0);
if (!(mixTot > 0)) { console.error('bad --mix'); process.exit(2); }

// ---- 种子化 Math（在引擎加载前注入）----
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

const { PRSim: S } = loadEngine({
  files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js'],
  beforeLoad: sb => { sb.Math = MathSeeded; },
});
const FEAT_DIM = S.FEATURE_DIM_RICH || 446;
const SEATS = 4;
const hardOpts = S.searchOptsForMode('hard', { maxIters: HARD_ITERS, budgetMs: 1e9, truncate: 8 });
const expertOpts = S.searchOptsForMode('expert', { maxIters: EXPERT_ITERS, budgetMs: 1e9 });

// ---- 增长缓冲 ----
let cap = Math.max(1024, Math.ceil(GAMES / Math.max(1, SHARD_N)) * 70);
let feats = new Uint8Array(cap * FEAT_DIM), meta = new Uint8Array(cap * 4), gameId = new Uint32Array(cap);
let roll1 = ROLLOUTS > 0 ? new Float32Array(cap * SEATS) : null, rollM = ROLLOUTS > 0 ? new Float32Array(cap * SEATS) : null;
let n = 0;
function grow() {
  cap *= 2;
  const f2 = new Uint8Array(cap * FEAT_DIM); f2.set(feats); feats = f2;
  const m2 = new Uint8Array(cap * 4); m2.set(meta); meta = m2;
  const g2 = new Uint32Array(cap); g2.set(gameId); gameId = g2;
  if (roll1) { const r1 = new Float32Array(cap * SEATS); r1.set(roll1); roll1 = r1; const r2 = new Float32Array(cap * SEATS); r2.set(rollM); rollM = r2; }
}
const scoresArr = [], seedArr = [];

function pickKind(r) { let acc = 0; for (const k of MIX_KINDS) { acc += (MIX[k] || 0) / mixTot; if (r < acc) return k; } return 'heur'; }
function kindCode(k) { return k === 'hard' ? 1 : k === 'expert' ? 2 : 0; }

function rolloutReward(st, k) {
  // 返回 [first(4), mean(4)]，reward 尺度（sim.js reward）。rollout 消耗种子流（与 --rollouts 0 的轨迹不同，属预期）
  const first = new Float32Array(SEATS), mean = new Float32Array(SEATS);
  for (let i = 0; i < k; i++) {
    const c = S.clone(st);
    S.rolloutToEnd(c, c.rnd);
    for (let p = 0; p < SEATS; p++) { const v = S.reward(c, p); mean[p] += v / k; if (i === 0) first[p] = v; }
  }
  return [first, mean];
}

const t0 = Date.now();
let played = 0, decisions = 0;
for (let g = 0; g < GAMES; g++) {
  if (g % SHARD_N !== SHARD_I) continue;
  const seed = (SEED_BASE + g * 1000003) >>> 0;
  _rng = mulberry32(seed);
  const arng = mulberry32((seed ^ 0x9E3779B9) >>> 0);
  const kinds = []; for (let s = 0; s < SEATS; s++) kinds.push(pickKind(arng()));
  const st = S.newState(SEATS, [5, 5, 5, 5]);
  const gi = scoresArr.length;
  let guard = 0;
  while (!S.isTerminal(st) && guard++ < 400) {
    const ch = S.currentChooser(st); if (ch < 0) break;
    const legal = S.legalRoleIdxs(st); if (!legal.length) break;
    // 记录局面（座位 0 视角特征）
    if (n >= cap) grow();
    const f = S.extractRich(st, 0);
    const base = n * FEAT_DIM;
    for (let i = 0; i < FEAT_DIM; i++) { let q = Math.round(f[i] * 255); feats[base + i] = q < 0 ? 0 : q > 255 ? 255 : q; }
    let kind = kinds[ch], code = kindCode(kind);
    const epsPick = EPS > 0 && arng() < EPS;
    if (epsPick) code = 3;
    meta[n * 4] = ch; meta[n * 4 + 1] = Math.min(255, st.turnNumber | 0); meta[n * 4 + 2] = st.endTriggered ? 1 : 0; meta[n * 4 + 3] = code;
    gameId[n] = gi;
    if (ROLLOUTS > 0) { const [r1, rm] = rolloutReward(st, ROLLOUTS); roll1.set(r1, n * SEATS); rollM.set(rm, n * SEATS); }
    n++; decisions++;
    // 选角
    let ri;
    if (epsPick) ri = legal[Math.floor(arng() * legal.length)];
    else if (kind === 'hard') ri = S.ismctsPickRoleIdx(st, hardOpts);
    else if (kind === 'expert') ri = S.ismctsPickRoleIdx(st, expertOpts);
    else ri = S.heuristicPickRole(st, ch, legal);
    if (ri == null || ri < 0 || !legal.includes(ri)) ri = legal[0];
    S.applyRole(st, ri);
  }
  const sc = st.players.map(S.finalScore).map(v => Math.max(0, Math.min(255, Math.round(v))));
  scoresArr.push(sc); seedArr.push(seed);
  played++;
  if (played % PROGRESS === 0) {
    const dt = (Date.now() - t0) / 1000;
    console.log(`[gen] ${played} games, ${n} positions, ${(played / dt).toFixed(1)} games/s, ${(n / dt).toFixed(0)} pos/s`);
  }
}

// ---- 写分片 ----
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const nG = scoresArr.length;
const scores = new Uint8Array(nG * SEATS); for (let i = 0; i < nG; i++) scores.set(scoresArr[i], i * SEATS);
const gameSeed = new Uint32Array(seedArr);
writeShard(OUT, {
  n, featDim: FEAT_DIM, seats: SEATS, nGames: nG,
  feats: feats.subarray(0, n * FEAT_DIM), meta: meta.subarray(0, n * 4), gameId: gameId.subarray(0, n),
  scores, gameSeed,
  rollout1: roll1 ? roll1.subarray(0, n * SEATS) : null, rolloutMean: rollM ? rollM.subarray(0, n * SEATS) : null,
});
const dt = (Date.now() - t0) / 1000;
console.log(`[gen] done: ${played} games, ${n} positions (${(n / Math.max(1, played)).toFixed(1)}/game) in ${dt.toFixed(0)}s → ${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB) mix=${JSON.stringify(MIX)} eps=${EPS} rollouts=${ROLLOUTS}`);
