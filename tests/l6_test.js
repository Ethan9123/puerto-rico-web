// 真实引擎集成验证：L6(ISMCTS) vs 3×L5(真实启发式专家)，跑完整 runMainLoop。
const vm = require('vm');

// 共享 Node 沙盒（tools/_sandbox.js）替代原先每个测试各自复制的 makeEl()/vm 样板
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js'] });

const GAMES = parseInt(process.argv[2]||'16');
const ITERS = parseInt(process.argv[3]||'150');

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true;
  window._fastSpectator = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:${ITERS}, expertMs:1e9 };
  await loadAIDNA();
  const N = 4;
  let l6Wins = 0, l6Score = 0, l5Score = 0, played = 0;
  for (let g = 0; g < ${GAMES}; g++) {
    const seat = g % N;                       // MCTS 座位轮转，消除位置偏置
    const levels = [4,4,4,4]; levels[seat] = 5; // 4=困难(强启发式), 5=专家(MCTS)
    G = new Game(N, 'AI');
    G.players.forEach((p,i)=>{ p.isHuman=false; p._aiLevel=levels[i]; });
    await runMainLoop();
    if (!G.gameOver) continue;
    played++;
    const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
    const best = Math.max(...totals);
    if (totals[seat] === best) l6Wins++;
    for (let i=0;i<N;i++){ if(i===seat) l6Score+=totals[i]; else l5Score+=totals[i]/(N-1); }
  }
  return { played, l6Wins, l6Avg: l6Score/played, l5Avg: l5Score/played, winrate: l6Wins/played };
})()`;

vm.runInContext(src, sandbox).then(r => {
  console.log(`L5 专家(ISMCTS ${ITERS} iters) vs 3×L4 困难(强启发式) — ${r.played} 局`);
  console.log(`  胜率 ${(r.winrate*100).toFixed(0)}%  (公平=25%)`);
  console.log(`  均分  专家=${r.l6Avg.toFixed(1)}   困难=${r.l5Avg.toFixed(1)}`);
  console.log(r.winrate > 0.25 && r.l6Avg > r.l5Avg ? '\nOK: 专家(MCTS) 在真实引擎中强于 困难(启发式)' : '\n需调参：专家未明显超过困难');
}).catch(e => { console.error('ERROR', e); process.exit(1); });
