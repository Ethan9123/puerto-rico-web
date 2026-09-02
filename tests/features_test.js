// Phase 1 验证：跑 20 局 sim 自对弈，每一步抽 features，断言：
//  - 长度恒为 FEATURE_DIM_RICH
//  - 全部 finite（没 NaN/Inf）
//  - 所有元素 ∈ [0, 1]（部分允许 < 0，但本设计都是 [0,1] 归一化）
//  - 视角不同时，玩家槽位顺序不同（确认镜像逻辑）

// 共享 Node 沙盒（tools/_sandbox.js）替代原先每个测试各自复制的 makeEl()/vm 样板
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js'] });

const PRSim = sandbox.PRSim;
const { extractRich, FEATURE_DIM_RICH, MAX_PLAYERS, PER_PLAYER_DIM, GLOBAL_DIM } = PRSim;

console.log(`FEATURE_DIM_RICH = ${FEATURE_DIM_RICH}`);
console.log(`  per-player dim = ${PER_PLAYER_DIM} × ${MAX_PLAYERS} slots = ${PER_PLAYER_DIM * MAX_PLAYERS}`);
console.log(`  global dim = ${GLOBAL_DIM}`);
console.log('---');

let fail = 0, total = 0;

function checkVec(vec, where) {
  total++;
  if (!(vec instanceof Float32Array)) { console.error(`[${where}] not Float32Array`); fail++; return; }
  if (vec.length !== FEATURE_DIM_RICH) { console.error(`[${where}] wrong length: ${vec.length} (expected ${FEATURE_DIM_RICH})`); fail++; return; }
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (!isFinite(v)) { console.error(`[${where}] vec[${i}] = ${v} (NaN/Inf)`); fail++; return; }
    if (v < 0 || v > 1.0001) { console.error(`[${where}] vec[${i}] = ${v} (out of [0,1])`); fail++; return; }
  }
}

const N_GAMES = 20;
let snapshots = 0;
for (let g = 0; g < N_GAMES; g++) {
  const numP = 3 + (g % 3); // 3, 4, 5 轮转
  const levels = [];
  for (let i = 0; i < numP; i++) levels.push(2 + (i % 4)); // 各种 AI 等级
  const state = PRSim.newState(numP, levels);
  // 跑游戏到结束，每 5 步抽样一次特征
  let step = 0;
  while (!PRSim.isTerminal(state) && step < 500) {
    if (step % 5 === 0) {
      for (let seat = 0; seat < state.numPlayers; seat++) {
        const v = extractRich(state, seat);
        checkVec(v, `game${g} step${step} seat${seat}`);
        snapshots++;
      }
    }
    const ch = PRSim.currentChooser(state);
    if (ch < 0) break;
    const legal = PRSim.legalRoleIdxs(state);
    if (!legal.length) break;
    // 用简单启发式随便选个角色
    const choice = legal[Math.floor(Math.random() * legal.length)];
    PRSim.applyRole(state, choice);
    step++;
  }
}

// 镜像验证：同一局面，不同 perspective 的玩家槽位 0 应不同
const state0 = PRSim.newState(4);
const fA = extractRich(state0, 0);
const fB = extractRich(state0, 1);
// 玩家槽位 0 对应 vp（特征 idx 0）；不同视角的 0 号玩家不同 → 多半 vp 值不同（开局都是 0 反例），
// 改测视角 one-hot：global base[99..103] 不同
const G_BASE = MAX_PLAYERS * PER_PLAYER_DIM;
let mirrorOk = false;
for (let i = 99; i < 104; i++) {
  if (fA[G_BASE + i] !== fB[G_BASE + i]) { mirrorOk = true; break; }
}
if (!mirrorOk) { console.error('[mirror] perspective one-hot did not change between seats'); fail++; }
else console.log('mirror: OK (perspective one-hot differs between seats)');

console.log('---');
console.log(`snapshots checked: ${snapshots}`);
console.log(`assertions total : ${total}`);
console.log(`failures         : ${fail}`);
process.exit(fail > 0 ? 1 : 0);
