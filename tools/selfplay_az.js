// ============================================================
// tools/selfplay_az.js — 全决策 AlphaZero 自对弈数据生成
// ============================================================
// 用因子化引擎打全决策自对弈，每个决策点记录:
//   f   : azFeatures(452)
//   pi  : 策略目标(稀疏 [[globalActionIdx, prob], ...])
//   legal: 合法动作全局索引(供训练掩码)
//   v   : value 向量(终局回填, chooser 视角座次序, 长 4)
//   n   : 玩家数
//
// 模式:
//   heuristic (gen0 引导): 动作=启发式; pi=该动作 one-hot — 行为克隆, 快速冷启动
//   nn        (gen N)    : 动作=azGumbelSearch(NN制导); pi=搜索改进策略 — 真正提升
//
// 用法:
//   node tools/selfplay_az.js [GAMES] [OUT] [NUM_PLAYERS] [MODE] [NN_PATH] [NUMSIMS]
//   node tools/selfplay_az.js 3000 data/az-gen0.jsonl 4 heuristic
//   node tools/selfplay_az.js 1500 data/az-gen1.jsonl 4 nn mcts_value_az.json 64
'use strict';
const fs = require('fs');
const path = require('path');
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');

const { PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js'] });

const GAMES = parseInt(process.argv[2] || '2000');
const OUT = process.argv[3] || path.join(__dirname, '..', 'data', `az-${Date.now()}.jsonl`);
const NP = parseInt(process.argv[4] || '4');
const MODE = process.argv[5] || 'heuristic';
const NN_PATH = process.argv[6] || null;
const NUMSIMS = parseInt(process.argv[7] || '64');
// 第8参数: 集中搜索的决策类型(逗号分隔), 默认 all(全决策)。例: "role,build" 只在高价值决策上搜索
const SEARCH_TYPES = process.argv[8] || 'all';
const searchSet = SEARCH_TYPES === 'all' ? null : new Set(SEARCH_TYPES.split(','));
function doSearchType(t) { return searchSet === null ? true : searchSet.has(t); }
// value 目标口径（环境变量）：margin(默认/原行为) | rank(名次→±1，抢第一) | vsbest(对最强对手分差/30)
const VALUE_MODE = process.env.VALUE_MODE || 'margin';
function seatValue(sc, me, np) {
  if (VALUE_MODE === 'rank') {
    let better = 0, equal = 0;
    for (let j = 0; j < np; j++) { if (j === me) continue; if (sc[j] > sc[me]) better++; else if (sc[j] === sc[me]) equal++; }
    const rank = better + equal / 2;
    return np > 1 ? Math.max(-1, Math.min(1, 1 - 2 * rank / (np - 1))) : 0;
  }
  if (VALUE_MODE === 'vsbest') {
    let best = -Infinity;
    for (let j = 0; j < np; j++) if (j !== me && sc[j] > best) best = sc[j];
    return Math.max(-1, Math.min(1, (sc[me] - best) / 30));
  }
  let opp = 0, c = 0; for (let j = 0; j < np; j++) if (j !== me) { opp += sc[j]; c++; }
  return Math.max(-1, Math.min(1, (sc[me] - opp / c) / 50));
}
console.log(`  value mode   : ${VALUE_MODE}`);

// AZ value 向量固定 4 维(模型 value 头 / load_data_az 的 N_VALUE=4)。NP>4 会写出
// 5 元 value(终局回填 v[k] 循环)且与 train_az.py 的 4 维 vpred 不兼容 → 直接拒绝。
if (NP > 4) { console.error(`selfplay_az.js 不支持 NP=${NP}: AZ value 向量仅 4 维(5 人需 5 维 value 模型/loader)`); process.exit(1); }

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const fd = fs.openSync(OUT, 'w');

(async () => {
  let NET = null;
  if (MODE === 'nn' || MODE === 'hybrid') {
    if (!NN_PATH) { console.error(MODE + ' mode needs NN_PATH'); process.exit(1); }
    NET = await S.azLoadNetwork(NN_PATH);
  }
  // hybrid evalFn: NN 策略先验 + 启发式 rollout 价值(强引导, 突破启发式持平)
  function hybridEval(state, dec) {
    const out = S.azForward(NET, S.azFeatures(state, dec));
    const c = S.clone(state); S.azPlayHeuristic(c);
    const sc = c.players.map(p => S.finalScore(p)); const np = state.numPlayers, lc = dec.chooser;
    const value = new Float32Array(4);
    for (let k = 0; k < np; k++) value[k] = seatValue(sc, (lc + k) % np, np);
    return { policyLogits: out.policyLogits, value };
  }
  const searchEvalFn = MODE === 'hybrid' ? hybridEval : undefined; // undefined → azGumbelSearch 默认用 NN
  console.log(`SelfPlay AZ: games=${GAMES} out=${OUT} np=${NP} mode=${MODE} ${MODE!=='heuristic'?'sims='+NUMSIMS:''}`);
  console.log(`  feature_dim=${S.AZ_FEATURE_DIM} action_dim=${S.AZ_ACTION_DIM}`);

  let totalSamples = 0, totalGames = 0, startMs = Date.now(), tick = 0;
  for (let g = 0; g < GAMES; g++) {
    let seed = (g * 2654435761) >>> 0;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const st = S.newState(NP, new Array(NP).fill(5), rng);
    const samples = []; // {f, pi(sparse), legal, chooser}
    let steps = 0;
    while (!S.isTerminal(st) && steps++ < 600) {
      const dec = S.azDecision(st);
      if (!dec) break;
      const useSearch = (MODE === 'nn' || MODE === 'hybrid') && doSearchType(dec.type);
      let action, piSparse = null;
      if (useSearch) {
        const res = S.azGumbelSearch(st, { numSims: NUMSIMS, numConsidered: Math.min(16, dec.actions.length), rng, evalFn: searchEvalFn });
        action = res.action;
        piSparse = [];
        for (const a of dec.actions) { const gi = S.azActionToGlobal(dec.type, a); const p = res.policyTarget[gi]; if (p > 1e-6) piSparse.push([gi, Math.round(p * 10000) / 10000]); }
      } else {
        // heuristic 模式 或 nn/hybrid 的非搜索决策(集中模式): 用启发式 + one-hot 克隆目标(仍记录, 保留全决策数据+value泛化)
        action = S.azHeuristicAction(st, dec);
        piSparse = [[S.azActionToGlobal(dec.type, action), 1]];
      }
      if (piSparse) { // 只记录有(搜索/克隆)策略目标的决策
        const f = S.azFeatures(st, dec);
        const legal = dec.actions.map(a => S.azActionToGlobal(dec.type, a));
        const fr = new Array(f.length); for (let i = 0; i < f.length; i++) fr[i] = Math.round(f[i] * 10000) / 10000;
        samples.push({ f: fr, pi: piSparse, legal, chooser: dec.chooser });
      }
      S.azApply(st, action);
    }
    // 终局回填 value 向量(chooser 视角座次序)
    const sc = st.players.map(p => S.finalScore(p));
    for (const s of samples) {
      const v = [0, 0, 0, 0];
      for (let k = 0; k < NP; k++) {
        v[k] = Math.round(seatValue(sc, (s.chooser + k) % NP, NP) * 10000) / 10000;
      }
      fs.writeSync(fd, JSON.stringify({ f: s.f, pi: s.pi, legal: s.legal, v, n: NP }) + '\n');
      totalSamples++;
    }
    totalGames++;
    if (g >= tick) {
      const el = (Date.now() - startMs) / 1000;
      console.log(`  game ${g + 1}/${GAMES} samples=${totalSamples} elapsed=${el.toFixed(1)}s eta=${(el/(g+1)*(GAMES-g-1)).toFixed(0)}s ${(totalSamples/Math.max(1,el)).toFixed(1)}/s`);
      tick = Math.max(g + 1, Math.floor(g + GAMES / 20));
    }
  }
  fs.closeSync(fd);
  const total = (Date.now() - startMs) / 1000;
  console.log(`Done: ${totalGames} games, ${totalSamples} samples in ${total.toFixed(1)}s (${(totalSamples/total).toFixed(1)}/s)`);
  console.log(`Size: ${(fs.statSync(OUT).size/1e6).toFixed(2)} MB`);
})().catch(e => { console.error(e); process.exit(1); });
