// ============================================================
// tools/eval_az_sv.js — AZ Gumbel 搜索 + 「强价值」(已部署 55% value-vector NN) 评估
// ============================================================
// 假说: 纯自对弈 AZ 的 value 头很弱(停在持平); 但已部署的 55% value-vector 模型
//       是经验证的强价值信号(L6 之所以胜 L5)。把它当作 azGumbelSearch 的 leaf 评估,
//       AZ 策略先验只提供候选排序, 价值用 55% 模型 → 期望强于 hybrid(启发式 rollout)。
//
// evalFn(state, dec) = { policyLogits: AZ策略, value[k]=networkEval(state,(chooser+k)%np).value }
//   value[k] 即座位 (chooser+k)%np 自身的预测净胜分 → 正好是 maxn backup 需要的 value 向量。
//
// 用法: node tools/eval_az_sv.js [games] [opp] [az_nn] [numsims] [search_types] [value_nn]
//   node tools/eval_az_sv.js 12 heuristic mcts_value_az.json 128 role,build mcts_value_nn.json
'use strict';
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
const { PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js'] });

const GAMES = parseInt(process.argv[2] || '12');
const OPP = process.argv[3] || 'heuristic';
const AZ_NN = process.argv[4] || 'mcts_value_az.json';
const NUMSIMS = parseInt(process.argv[5] || '128');
const SEARCH_TYPES = process.argv[6] || 'role,build';
const VALUE_NN = process.argv[7] || 'mcts_value_nn.json';
const searchSet = SEARCH_TYPES === 'all' ? null : new Set(SEARCH_TYPES.split(','));
const doSearchType = t => searchSet === null ? true : searchSet.has(t);
const L5_ITERS = 300, L5_MS = 1500;

(async () => {
  const azNet = await S.azLoadNetwork(AZ_NN);   // AZ 策略先验 (+ 废弃的 value 头)
  await S.loadNetwork(VALUE_NN);                 // 强价值: 55% value-vector NN
  // 强价值 evalFn: 策略=AZ, value 向量=55% 模型逐座位预测
  function strongValueEval(state, dec) {
    const out = S.azForward(azNet, S.azFeatures(state, dec));
    const np = state.numPlayers, lc = dec.chooser;
    const value = new Float32Array(4);
    for (let k = 0; k < np; k++) value[k] = S.networkEval(state, (lc + k) % np).value;
    return { policyLogits: out.policyLogits, value };
  }
  console.log(`AZ(Gumbel sims=${NUMSIMS}, value=55%NN, search=${SEARCH_TYPES}) vs 3×${OPP} — ${GAMES} 局`);
  let azWins = 0, azScore = 0, oppScore = 0, played = 0;
  const t0 = Date.now();
  for (let g = 0; g < GAMES; g++) {
    const seat = g % 4;
    let s = (g * 2654435761) >>> 0;
    const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const st = S.newState(4, [5, 5, 5, 5], rng);
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 600) {
      const dec = S.azDecision(st);
      if (!dec) break;
      let action;
      if (dec.chooser === seat) {
        action = doSearchType(dec.type) ? S.azGumbelSearch(st, { numSims: NUMSIMS, numConsidered: Math.min(16, dec.actions.length), rng, evalFn: strongValueEval }).action : S.azHeuristicAction(st, dec);
      } else if (OPP === 'l5' && dec.type === 'role') {
        const ri = S.ismctsPickRoleIdx(st, { maxIters: L5_ITERS, budgetMs: L5_MS });
        action = (ri != null && dec.actions.includes(ri)) ? ri : S.azHeuristicAction(st, dec);
      } else {
        action = S.azHeuristicAction(st, dec);
      }
      S.azApply(st, action);
    }
    if (!st.gameOver) continue;
    played++;
    const sc = st.players.map(p => S.finalScore(p));
    const best = Math.max(...sc);
    if (sc[seat] === best) azWins++;
    for (let i = 0; i < 4; i++) { if (i === seat) azScore += sc[i]; else oppScore += sc[i] / 3; }
    process.stdout.write(`\r  ${g+1}/${GAMES} az=${sc[seat]} avgOpp=${((sc.reduce((a,b)=>a+b,0)-sc[seat])/3).toFixed(1)} winrate=${(azWins/played*100).toFixed(0)}%`);
  }
  process.stdout.write('\n');
  console.log(`Played ${played}/${GAMES} in ${((Date.now()-t0)/1000).toFixed(0)}s`);
  console.log(`AZ+55%value winrate: ${(azWins/played*100).toFixed(1)}% (fair=25%)`);
  console.log(`Avg score: AZ=${(azScore/played).toFixed(1)} ${OPP}=${(oppScore/played).toFixed(1)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
