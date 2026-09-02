// ============================================================
// tools/selfplay_dump.js — AlphaZero 训练数据生成
// ============================================================
// 用 sim.js ISMCTS 自对弈，每个"选角色"决策点记录 (features, role_idx, final_score)
// 输出 JSONL（每行一个样本），便于 Python 后续读取训练。
//
// 使用：
//   node tools/selfplay_dump.js [GAMES] [MCTS_ITERS] [OUT_PATH] [NUM_PLAYERS] [NN_PATH]
// 示例：
//   node tools/selfplay_dump.js 100 80 data/selfplay-test.jsonl 4
//   node tools/selfplay_dump.js 10000 150 data/selfplay-v1.jsonl 4
//   node tools/selfplay_dump.js 2000 80 data/selfplay-v2.jsonl 4 mcts_value_nn.json
//
// 性能：~80 iters/decision，4 玩家 ~15 回合 → 每局约 1-3 秒 CPU。
// 有 NN 时每次决策跑 NN priorPolicy + NN evalLeaf，开销不到 1ms/决策。

const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./_sandbox.js');

// ---- 加载 sim.js + sim_features.js（共享 Node 沙盒 tools/_sandbox.js）----
const { sandbox, PRSim } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });
const { extractRich, roleNameToPolicyIdx, FEATURE_DIM_RICH, N_ROLES } = PRSim;
const ROLE_LIST = sandbox.ROLE_LIST;

// ---- 参数 ----
const GAMES = parseInt(process.argv[2] || '100');
const MCTS_ITERS = parseInt(process.argv[3] || '80');
const OUT_PATH = process.argv[4] || path.join(__dirname, '..', 'data', `selfplay-${Date.now()}.jsonl`);
const NUM_PLAYERS = parseInt(process.argv[5] || '4');
const NN_PATH = process.argv[6] || null; // 可选 NN：有则用 PUCT+NN 制导 self-play
// value 目标口径（环境变量）：
//   margin (默认/原行为) = (我分 - 对手平均) / 50      → 刷分差
//   rank                 = 名次→[-1,1]，独占第1=+1，末名=-1 → 抢第一（AlphaZero 式胜负信号）
//   vsbest               = (我分 - 最强对手) / 30        → 聚焦压制领先者，且仍稠密
const VALUE_MODE = process.env.VALUE_MODE || 'margin';

// 确保 data/ 目录存在
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
const fd = fs.openSync(OUT_PATH, 'w');

(async () => {
let NN_LOADED = false;
if (NN_PATH) {
  try {
    await PRSim.loadNetwork(NN_PATH);
    NN_LOADED = true;
  } catch (e) {
    console.error(`Failed to load NN ${NN_PATH}:`, e.message);
    console.error('Continuing with pure ISMCTS (no NN guidance)');
  }
}

console.log(`SelfPlay dump:`);
console.log(`  games        : ${GAMES}`);
console.log(`  mcts iters   : ${MCTS_ITERS} per decision`);
console.log(`  num players  : ${NUM_PLAYERS}`);
console.log(`  output       : ${OUT_PATH}`);
console.log(`  NN guide     : ${NN_LOADED ? NN_PATH : '(none, pure ISMCTS)'}`);
console.log(`  feature dim  : ${FEATURE_DIM_RICH}`);
console.log(`  policy dim   : ${N_ROLES}`);
console.log('---');

// 选角色：有 NN 时跑 PUCT+NN，否则纯 ISMCTS
function ismcts(state, chooserIdx, iters) {
  if (typeof PRSim.ismctsPickRoleIdx !== 'function') {
    const legal = PRSim.legalRoleIdxs(state);
    return legal[0];
  }
  const opts = { maxIters: iters, budgetMs: 30000 };
  if (NN_LOADED) {
    opts.C = 1.5;
    opts.evalLeafFn = (s, p) => PRSim.evalLeafNN(s, p);
    opts.priorPolicyFn = (s, p) => {
      const o = PRSim.networkEval(s, p);
      if (!o) return null;
      const legal = PRSim.legalRoleIdxs(s);
      const legalNames = new Set(legal.map(i => s.roleCards[i].name));
      const dist = {};
      let sum = 0;
      for (let k = 0; k < ROLE_LIST.length; k++) {
        if (legalNames.has(ROLE_LIST[k])) { dist[ROLE_LIST[k]] = o.policy[k]; sum += o.policy[k]; }
      }
      if (sum > 0) for (const k of Object.keys(dist)) dist[k] /= sum;
      return dist;
    };
  }
  return PRSim.ismctsPickRoleIdx(state, opts);
}

function finalScores(state) {
  // sim.js: finalScore(player) — pure function on player object
  return state.players.map(p => PRSim.finalScore(p));
}

let totalSamples = 0;
let totalGames = 0;
let startMs = Date.now();
let bufferSamples = []; // 当前 game 的样本，最后回填 final_score
let progressTick = 0;

for (let g = 0; g < GAMES; g++) {
  const levels = [];
  for (let i = 0; i < NUM_PLAYERS; i++) levels.push(5); // 全部 ISMCTS 自对弈
  const st = PRSim.newState(NUM_PLAYERS, levels);
  const gameSamples = []; // [{features, role_idx, seat}]
  let step = 0;
  while (!PRSim.isTerminal(st) && step < 500) {
    const ch = PRSim.currentChooser(st);
    if (ch < 0) break;
    const legal = PRSim.legalRoleIdxs(st);
    if (!legal.length) break;
    // 记录决策前的特征
    const features = extractRich(st, ch);
    // ISMCTS 选角色
    const pickedCardIdx = ismcts(st, ch, MCTS_ITERS);
    const roleName = st.roleCards[pickedCardIdx].name;
    const policyIdx = roleNameToPolicyIdx(roleName);
    gameSamples.push({ features, role_idx: policyIdx, seat: ch });
    PRSim.applyRole(st, pickedCardIdx);
    step++;
  }
  // 终局分数（vp + 建筑 + 大紫终局 + ...）→ sim 已经在 finalScore 里算了
  const scores = finalScores(st);
  const N = scores.length;
  // 写出每个样本：特征 + 行动（policy target）+ 终局结果（value target）
  // value target 设计（Multiplayer AlphaZero 风格 value 向量）：
  //   - 标量 v: 从该玩家视角的「(我得 - 对手平均) / 50」压到 [-1, 1]（向后兼容）
  //   - 向量 vv[k]: perspective-ordered，vv[k] = 第 (seat+k)%N 个玩家的相对优势。
  //     vv[0] === v（视角玩家）。特征也是 perspective-first 排列，所以两者对齐。
  //     推理只读 vv[0]；vv[1..] 作辅助多任务。固定写 4 维（不足补 0，多则截断）。
  const VVDIM = 4;
  function relAdv(playerIdx) {
    if (VALUE_MODE === 'rank') {
      // 名次→value：独占第 1 = +1，末名 = -1，线性；并列取平均名次
      let better = 0, equal = 0;
      for (let i = 0; i < N; i++) { if (i === playerIdx) continue; if (scores[i] > scores[playerIdx]) better++; else if (scores[i] === scores[playerIdx]) equal++; }
      const rank = better + equal / 2; // 0 = 独占第一
      return N > 1 ? Math.max(-1, Math.min(1, 1 - 2 * rank / (N - 1))) : 0;
    }
    if (VALUE_MODE === 'vsbest') {
      // 对“最强对手”的分差 → 聚焦“是否在抢第一”，仍稠密
      let best = -Infinity;
      for (let i = 0; i < N; i++) if (i !== playerIdx && scores[i] > best) best = scores[i];
      return Math.max(-1, Math.min(1, (scores[playerIdx] - best) / 30));
    }
    // margin（默认 = 原行为：对手平均分差 / 50）
    let oppSum = 0;
    for (let i = 0; i < N; i++) if (i !== playerIdx) oppSum += scores[i];
    return Math.max(-1, Math.min(1, (scores[playerIdx] - oppSum / (N - 1)) / 50));
  }
  for (const s of gameSamples) {
    const value = relAdv(s.seat);
    const vv = new Array(VVDIM).fill(0);
    for (let k = 0; k < VVDIM && k < N; k++) {
      vv[k] = Math.round(relAdv((s.seat + k) % N) * 10000) / 10000;
    }
    // 把 Float32Array 转成普通数字数组写 JSON（精度足够）
    const featuresArr = new Array(s.features.length);
    for (let i = 0; i < s.features.length; i++) featuresArr[i] = Math.round(s.features[i] * 10000) / 10000;
    const line = JSON.stringify({ f: featuresArr, a: s.role_idx, v: Math.round(value * 10000) / 10000, vv, n: NUM_PLAYERS });
    fs.writeSync(fd, line + '\n');
    totalSamples++;
  }
  totalGames++;
  // 进度
  const elapsed = (Date.now() - startMs) / 1000;
  if (g >= progressTick) {
    const eta = elapsed / (g + 1) * (GAMES - g - 1);
    console.log(`  game ${g + 1}/${GAMES}  samples=${totalSamples}  elapsed=${elapsed.toFixed(1)}s  eta=${eta.toFixed(0)}s  samples/sec=${(totalSamples / Math.max(1, elapsed)).toFixed(1)}`);
    progressTick = Math.max(g + 1, Math.floor(g + GAMES / 20)); // 每 5% 报一次
  }
}

fs.closeSync(fd);
const total = (Date.now() - startMs) / 1000;
console.log('---');
console.log(`Done: ${totalGames} games, ${totalSamples} samples in ${total.toFixed(1)}s`);
console.log(`Avg ${(totalSamples / totalGames).toFixed(1)} samples/game, ${(totalSamples / total).toFixed(1)} samples/sec`);
console.log(`Output: ${OUT_PATH}`);
const sizeMB = (fs.statSync(OUT_PATH).size / 1e6).toFixed(2);
console.log(`Size  : ${sizeMB} MB`);
})().catch(e => { console.error(e); process.exit(1); });
