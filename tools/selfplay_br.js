// ============================================================
// tools/selfplay_br.js — 最佳响应(best-response)训练数据生成
// ============================================================
// 动机: league 实验的失败归因是"训练分布 ≠ 评测分布"。评测是固定已知对手
// (1×宗师 vs 3×L5@400iters), 那就直接在这个分布上生成数据:
//   - 学习者座位(g%4): NN-ISMCTS, 迭代数=部署宗师的 alphaIters(400)。
//   - 其余 3 座位: 纯 ISMCTS, 迭代数=评测的 expertIters(400) ≈ L5。
// L5 是确定的程序, 对它学 exploiter 不存在自对弈退化问题。
// 输出与 selfplay-vv.jsonl 同格式 {f,a,v,vv,n} → 直接喂 train/train.py。
//
// 用法: node tools/selfplay_br.js [GAMES] [ITERS] [OUT] [NN_PATH] [SEED_BASE]
//   并行多 worker 时务必给每个 worker 不同的 SEED_BASE, 否则牌序完全重复!
//   node tools/selfplay_br.js 150 400 data/sp-br-p0.jsonl mcts_value_nn.json 1000000
'use strict';
const fs = require('fs');
const path = require('path');
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');

const { sandbox, PRSim } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });
const { extractRich, roleNameToPolicyIdx } = PRSim;
const ROLE_LIST = sandbox.ROLE_LIST;

const GAMES = parseInt(process.argv[2] || '150');
const ITERS = parseInt(process.argv[3] || '400');   // 学习者与 L5 对手共用(对齐 alphaIters=expertIters=400)
const OUT_PATH = process.argv[4] || path.join(__dirname, '..', 'data', 'sp-br.jsonl');
const NN_PATH = process.argv[5] || 'mcts_value_nn.json';
const SEED_BASE = parseInt(process.argv[6] || '0');
const NUM_PLAYERS = 4;
const VVDIM = 4;

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
const fd = fs.openSync(OUT_PATH, 'w');

(async () => {
  let NN_LOADED = false;
  try { await PRSim.loadNetwork(NN_PATH); NN_LOADED = true; }
  catch (e) { console.error(`NN load failed (${NN_PATH}): ${e.message}`); process.exit(1); }

  function searchOpts(iters, useNN) {
    const opts = { maxIters: iters, budgetMs: 60000 };
    if (useNN && NN_LOADED) {
      opts.C = 1.5;
      // 向量叶评估: 一次前向共享整条回传路径(4人局), ~10x 提速; 非4人自动回退 evalLeafFn
      opts.evalLeafVecFn = (s) => PRSim.evalLeafVecNN(s);
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

  console.log(`SelfPlay BEST-RESPONSE: games=${GAMES} iters=${ITERS}(双方) out=${OUT_PATH}`);
  console.log(`  学习者=NN-ISMCTS(${NN_PATH})  对手=3×纯ISMCTS(≈L5)  seedBase=${SEED_BASE}  全座位记录`);
  let totalSamples = 0, startMs = Date.now(), tick = 0, learnerWins = 0, played = 0;

  for (let g = 0; g < GAMES; g++) {
    let seed = ((SEED_BASE + g) * 2654435761) >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const learner = g % NUM_PLAYERS;
    const st = PRSim.newState(NUM_PLAYERS, new Array(NUM_PLAYERS).fill(5), rnd);
    const gameSamples = [];
    let step = 0;
    while (!PRSim.isTerminal(st) && step < 500) {
      const ch = PRSim.currentChooser(st); if (ch < 0) break;
      const legal = PRSim.legalRoleIdxs(st); if (!legal.length) break;
      const features = extractRich(st, ch);
      const picked = PRSim.ismctsPickRoleIdx(st, searchOpts(ITERS, ch === learner));
      if (picked < 0) break;
      gameSamples.push({ features, role_idx: roleNameToPolicyIdx(st.roleCards[picked].name), seat: ch });
      PRSim.applyRole(st, picked);
      step++;
    }
    const scores = st.players.map(p => PRSim.finalScore(p));
    const N = scores.length;
    played++;
    if (scores[learner] === Math.max(...scores)) learnerWins++;
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
      console.log(`  game ${g + 1}/${GAMES} samples=${totalSamples} learnerWin=${(learnerWins / played * 100).toFixed(0)}% elapsed=${el.toFixed(0)}s eta=${(el / (g + 1) * (GAMES - g - 1)).toFixed(0)}s`);
      tick = Math.max(g + 1, Math.floor(g + GAMES / 10));
    }
  }
  fs.closeSync(fd);
  const total = (Date.now() - startMs) / 1000;
  console.log(`Done: ${GAMES} games, ${totalSamples} samples in ${total.toFixed(0)}s (${(totalSamples / total).toFixed(1)}/s)`);
  console.log(`  学习者(NN宗师)胜率 vs 3×ISMCTS: ${(learnerWins / played * 100).toFixed(1)}% (${played}局)`);
  console.log(`  size: ${(fs.statSync(OUT_PATH).size / 1e6).toFixed(2)} MB`);
})().catch(e => { console.error(e); process.exit(1); });
