// ============================================================
// tools/selfplay_league.js — 迷你联赛(多样化对手池)价值向量数据生成
// ============================================================
// 动机(研究背书: PSRO / league training / population-based self-play):
//   既有 selfplay_dump.js 让 4 个座位全是同一套 NN-ISMCTS(同质自对弈) → 策略风格单一、
//   陷入局部最优(正是 55% 模型停滞的原因之一)。本脚本让"学习者"对阵一个多样化对手池,
//   逼网络学会对各种风格鲁棒。
//
// 设计:
//   - 学习者座位(g%N): NN-ISMCTS 满迭代, 始终记录。
//   - 其余座位: 每局从对手池抽样 {ismcts(≈L5), lowsim(≈L4), heur(≈L3), rand(弱)}, 偏向强档。
//   - 只记录"强策略"座位(nn / ismcts)的决策 → 干净的 policy 目标; value 用真实终局(已对阵多样化池)。
//   - 输出与 selfplay-vv.jsonl 完全同格式 {f,a,v,vv,n} → 直接喂 train/train.py(复用 55% 管线)。
//
// 用法: node tools/selfplay_league.js [GAMES] [MCTS_ITERS] [OUT] [NN_PATH] [POOL_WEIGHTS]
//   node tools/selfplay_league.js 3000 80 data/selfplay-league.jsonl mcts_value_nn.json
//   POOL_WEIGHTS 形如 "ismcts:40,lowsim:30,heur:20,rand:10"(默认即此)
'use strict';
const fs = require('fs');
const path = require('path');
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');

const { sandbox, PRSim } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });
const { extractRich, roleNameToPolicyIdx, FEATURE_DIM_RICH, N_ROLES } = PRSim;
const ROLE_LIST = sandbox.ROLE_LIST;

const GAMES = parseInt(process.argv[2] || '3000');
const MCTS_ITERS = parseInt(process.argv[3] || '80');
const OUT_PATH = process.argv[4] || path.join(__dirname, '..', 'data', 'selfplay-league.jsonl');
const NN_PATH = process.argv[5] || 'mcts_value_nn.json';
const POOL_STR = process.argv[6] || 'ismcts:40,lowsim:30,heur:20,rand:10';
const LOWSIM_ITERS = 15;
const NUM_PLAYERS = 4;
const VVDIM = 4;
const RECORD = new Set(['nn', 'ismcts']); // 仅强策略座位记录(干净 policy 目标)

// 解析对手池权重 → 累积分布
const poolEntries = POOL_STR.split(',').map(s => { const [k, w] = s.split(':'); return [k.trim(), parseFloat(w)]; });
const poolTotal = poolEntries.reduce((a, [, w]) => a + w, 0);
function samplePool(rnd) {
  let r = rnd() * poolTotal;
  for (const [k, w] of poolEntries) { if ((r -= w) <= 0) return k; }
  return poolEntries[0][0];
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
const fd = fs.openSync(OUT_PATH, 'w');

(async () => {
  let NN_LOADED = false;
  try { await PRSim.loadNetwork(NN_PATH); NN_LOADED = true; }
  catch (e) { console.error(`NN load failed (${NN_PATH}): ${e.message} — 'nn' 策略将退化为纯 ISMCTS`); }

  // 角色选择: 按座位分配的策略分派。useNN 仅对 'nn' 学习者为真(其余纯 ISMCTS, 真正多样)。
  function searchOpts(iters, useNN) {
    const opts = { maxIters: iters, budgetMs: 30000 };
    if (useNN && NN_LOADED) {
      opts.C = 1.5;
      opts.evalLeafFn = (s, p) => PRSim.evalLeafNN(s, p);
      opts.priorPolicyFn = (s, p) => {
        const o = PRSim.networkEval(s, p); if (!o) return null;
        const legal = PRSim.legalRoleIdxs(s);
        const legalNames = new Set(legal.map(i => s.roleCards[i].name));
        const dist = {}; let sum = 0;
        for (let k = 0; k < ROLE_LIST.length; k++) if (legalNames.has(ROLE_LIST[k])) { dist[ROLE_LIST[k]] = o.policy[k]; sum += o.policy[k]; }
        if (sum > 0) for (const k of Object.keys(dist)) dist[k] /= sum;
        return dist;
      };
    }
    return opts;
  }
  function pickRole(st, ch, policy, rnd) {
    const legal = PRSim.legalRoleIdxs(st);
    if (!legal.length) return -1;
    if (policy === 'rand') return legal[Math.floor(rnd() * legal.length)];
    if (policy === 'heur') return PRSim.heuristicPickRole(st, ch, legal);
    if (policy === 'lowsim') return PRSim.ismctsPickRoleIdx(st, searchOpts(LOWSIM_ITERS, false)); // 纯 ISMCTS 低迭代 ≈L4
    if (policy === 'ismcts') return PRSim.ismctsPickRoleIdx(st, searchOpts(MCTS_ITERS, false));    // 纯 ISMCTS 满迭代 ≈L5
    return PRSim.ismctsPickRoleIdx(st, searchOpts(MCTS_ITERS, true));                              // 'nn': NN 制导
  }

  console.log(`SelfPlay LEAGUE: games=${GAMES} iters=${MCTS_ITERS} out=${OUT_PATH}`);
  console.log(`  NN=${NN_LOADED ? NN_PATH : '(none)'} pool=${POOL_STR} record={nn,ismcts}`);
  const poolCount = {}; let totalSamples = 0, recordedSeatGames = 0, startMs = Date.now(), tick = 0;

  for (let g = 0; g < GAMES; g++) {
    // 可复现的每局 rng(池抽样/随机角色用)
    let seed = (g * 2654435761) >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const learner = g % NUM_PLAYERS;
    const seatPolicy = new Array(NUM_PLAYERS);
    for (let i = 0; i < NUM_PLAYERS; i++) {
      seatPolicy[i] = (i === learner) ? 'nn' : (NN_LOADED ? samplePool(rnd) : 'ismcts');
      poolCount[seatPolicy[i]] = (poolCount[seatPolicy[i]] || 0) + 1;
      if (RECORD.has(seatPolicy[i])) recordedSeatGames++;
    }
    const st = PRSim.newState(NUM_PLAYERS, new Array(NUM_PLAYERS).fill(5), rnd);
    const gameSamples = [];
    let step = 0;
    while (!PRSim.isTerminal(st) && step < 500) {
      const ch = PRSim.currentChooser(st); if (ch < 0) break;
      const legal = PRSim.legalRoleIdxs(st); if (!legal.length) break;
      const pol = seatPolicy[ch];
      const rec = RECORD.has(pol);
      const features = rec ? extractRich(st, ch) : null; // 只在记录座位提特征(省时)
      const picked = pickRole(st, ch, pol, rnd);
      if (picked < 0) break;
      if (rec) gameSamples.push({ features, role_idx: roleNameToPolicyIdx(st.roleCards[picked].name), seat: ch });
      PRSim.applyRole(st, picked);
      step++;
    }
    const scores = st.players.map(p => PRSim.finalScore(p));
    const N = scores.length;
    const relAdv = (pi) => { let opp = 0; for (let i = 0; i < N; i++) if (i !== pi) opp += scores[i]; return Math.max(-1, Math.min(1, (scores[pi] - opp / (N - 1)) / 50)); };
    for (const s of gameSamples) {
      const value = relAdv(s.seat);
      const vv = new Array(VVDIM).fill(0);
      for (let k = 0; k < VVDIM && k < N; k++) vv[k] = Math.round(relAdv((s.seat + k) % N) * 10000) / 10000;
      const fArr = new Array(s.features.length);
      for (let i = 0; i < s.features.length; i++) fArr[i] = Math.round(s.features[i] * 10000) / 10000;
      fs.writeSync(fd, JSON.stringify({ f: fArr, a: s.role_idx, v: Math.round(value * 10000) / 10000, vv, n: NUM_PLAYERS }) + '\n');
      totalSamples++;
    }
    if (g >= tick) {
      const el = (Date.now() - startMs) / 1000;
      console.log(`  game ${g + 1}/${GAMES} samples=${totalSamples} elapsed=${el.toFixed(0)}s eta=${(el / (g + 1) * (GAMES - g - 1)).toFixed(0)}s ${(totalSamples / Math.max(1, el)).toFixed(1)}/s`);
      tick = Math.max(g + 1, Math.floor(g + GAMES / 20));
    }
  }
  fs.closeSync(fd);
  const total = (Date.now() - startMs) / 1000;
  console.log(`Done: ${GAMES} games, ${totalSamples} samples in ${total.toFixed(0)}s (${(totalSamples / total).toFixed(1)}/s)`);
  console.log(`  pool seat draws: ${JSON.stringify(poolCount)}  recorded-seat-games=${recordedSeatGames}`);
  console.log(`  size: ${(fs.statSync(OUT_PATH).size / 1e6).toFixed(2)} MB`);
})().catch(e => { console.error(e); process.exit(1); });
