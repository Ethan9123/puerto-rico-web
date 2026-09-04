// 测量相邻档位 "1 高 vs 3 低" 的胜率(座位轮转)。用法: node tools/tier_winrate.js [games]
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
const { run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js'] });

const GAMES = parseInt(process.argv[2] || '60');
// 每组 [高档, 低档]
const MATCHUPS = [[2,1],[3,2],[4,3]];

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true;
  window._fastSpectator = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:400, expertMs:1e9 };
  await loadAIDNA();
  const N = 4;
  const matchups = ${JSON.stringify(MATCHUPS)};
  const out = [];
  for (const [hi, lo] of matchups) {
    let wins = 0, played = 0, hiScore = 0, loScore = 0;
    for (let g = 0; g < ${GAMES}; g++) {
      const seat = g % N;
      const levels = [lo,lo,lo,lo]; levels[seat] = hi;
      G = new Game(N, 'AI');
      G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel=levels[i]; }); // 给所有玩家配 DNA(同真实 startGame)
      await runMainLoop();
      if (!G.gameOver) continue;
      played++;
      const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
      const best = Math.max(...totals);
      // 平手按并列胜者均摊（4人局并列少见）
      const winnerCount = totals.filter(t => t === best).length;
      if (totals[seat] === best) wins += 1 / winnerCount;
      for (let i=0;i<N;i++){ if(i===seat) hiScore+=totals[i]; else loScore+=totals[i]/(N-1); }
    }
    out.push({ hi, lo, played, winrate: wins/played, hiAvg: hiScore/played, loAvg: loScore/played });
  }
  return out;
})()`;

const NM = {1:'入门',2:'进化',3:'普通',4:'困难',5:'专家'};
const t0 = Date.now();
run(src).then(rows => {
  console.log(`相邻档位 1 高 vs 3 低 胜率（每组 ${GAMES} 局，座位轮转） / ${((Date.now()-t0)/1000).toFixed(0)}s`);
  let allPass = true;
  for (const r of rows) {
    const pass = r.winrate >= 0.60;
    if (!pass) allPass = false;
    console.log(`  1×${NM[r.hi]} vs 3×${NM[r.lo]} : 胜率 ${(r.winrate*100).toFixed(0)}%  均分 ${r.hiAvg.toFixed(1)} / ${r.loAvg.toFixed(1)}  ${pass?'✅':'⛔'}`);
  }
  console.log(allPass ? '\n全部 ≥60%' : '\n有未达 60% 的组');
}).catch(e => { console.error('ERROR', e); process.exit(1); });
