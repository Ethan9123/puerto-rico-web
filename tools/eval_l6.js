// L6 (AlphaZero NN+PUCT) vs L5 (原版 ISMCTS) 等墙钟时间对打。
// 用法: node tools/eval_l6.js [budgetMs] [games] [nn_path]
//   budgetMs : 每步思考时间（毫秒），默认 800
//   games    : 对战局数，默认 24
//   nn_path  : NN JSON 路径，默认 mcts_value_nn.json
'use strict';
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');

const BUDGET = parseInt(process.argv[2] || '800');
const GAMES = parseInt(process.argv[3] || '24');
const NN_PATH = process.argv[4] || 'mcts_value_nn.json';

const { PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });
const ROLE_NAMES = ['Settler','Mayor','Builder','Craftsman','Trader','Captain','Prospector'];

async function main() {
  await S.loadNetwork(NN_PATH);
  console.log(`L6(AlphaZero+PUCT) vs 3×L5(原版ISMCTS) — 每步 ${BUDGET}ms, ${GAMES} 局`);

  let l6Wins = 0, l6Score = 0, oppScore = 0, played = 0;
  const t0 = Date.now();
  for (let g = 0; g < GAMES; g++) {
    const seat = g % 4;
    let st = S.newState(4, new Array(4).fill(5));
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 400) {
      const ch = S.currentChooser(st); if (ch < 0) break;
      const legal = S.legalRoleIdxs(st); if (!legal.length) break;
      const opts = (ch === seat)
        ? {
            budgetMs: BUDGET, maxIters: 1e9, C: 1.5,
            truncate: 999, // hybrid: full rollout + NN policy prior
            evalLeafFn: (state, pp) => S.evalLeafNN(state, pp),
            priorPolicyFn: (state, pp) => {
              const o = S.networkEval(state, pp);
              if (!o) return null;
              const lg = S.legalRoleIdxs(state);
              const legalNames = new Set(lg.map(i => state.roleCards[i].name));
              const dist = {};
              let s = 0;
              for (let k = 0; k < ROLE_NAMES.length; k++) {
                if (legalNames.has(ROLE_NAMES[k])) { dist[ROLE_NAMES[k]] = o.policy[k]; s += o.policy[k]; }
              }
              if (s > 0) for (const k of Object.keys(dist)) dist[k] /= s;
              return dist;
            },
          }
        : { budgetMs: BUDGET, maxIters: 1e9 };
      S.applyRole(st, S.ismctsPickRoleIdx(st, opts));
    }
    if (!st.gameOver) continue;
    played++;
    const sc = st.players.map(S.finalScore);
    const best = Math.max(...sc);
    if (sc[seat] === best) l6Wins++;
    for (let i = 0; i < 4; i++) {
      if (i === seat) l6Score += sc[i];
      else oppScore += sc[i] / 3;
    }
    process.stdout.write(`\r  game ${g+1}/${GAMES} l6=${sc[seat]} avg_opp=${((sc[0]+sc[1]+sc[2]+sc[3]-sc[seat])/3).toFixed(1)} winrate=${(l6Wins/played*100).toFixed(0)}%`);
  }
  process.stdout.write('\n');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`Played: ${played}/${GAMES}  elapsed: ${elapsed}s`);
  console.log(`L6 winrate: ${(l6Wins/played*100).toFixed(1)}% (fair=25%)`);
  console.log(`Avg score: L6=${(l6Score/played).toFixed(1)}  L5=${(oppScore/played).toFixed(1)}`);
  console.log(l6Wins/played > 0.30 ? '\n[OK] L6 stronger than L5' : '\n[!]  L6 not clearly stronger — need more training or budget');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
