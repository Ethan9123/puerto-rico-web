// 测量最强档位 宗师(L6, AlphaZero NN) "1 高 vs 3 低" 对每个更低档的胜率(座位轮转)。
// 直接回答用户目标: 最强 AI 能否以 ≥60% 胜任何其他 NPC 组合。
// 复用 game.js 真实 AI + 部署的 NN(mcts_value_nn.json), 方法学与 tier_winrate.js 一致。
// 用法: node tools/tier_winrate_top.js [gamesPerMatchup] [lowList]
//   node tools/tier_winrate_top.js 40            # 宗师 vs 3×{专家,困难,普通,进化,入门}
//   node tools/tier_winrate_top.js 80 5          # 只测最难: 宗师 vs 3×专家, 80 局
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
// 必须含 sim_features + sim_nn, 否则 L6 没 NN 会回退到 L5
const { run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });

const GAMES = parseInt(process.argv[2] || '40');
const LOWS = process.argv[3] ? process.argv[3].split(',').map(Number) : [5,4,3,2,1];
const MATCHUPS = LOWS.map(lo => [6, lo]);
const NN_OVERRIDE = process.argv[4] || null; // 候选 NN json 路径(A/B 用); 不传则用部署的 mcts_value_nn.json

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  // 方法学对齐 tier_winrate.js(iter-bounded, ms=1e9 → 可复现); 增补 L6 的 alpha 预算
  window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:400, expertMs:1e9, alphaIters:400, alphaMs:1e9 };
  ${NN_OVERRIDE ? `window.__MCTS_VALUE_NN__ = ${JSON.stringify(NN_OVERRIDE)};` : ''}
  await loadAIDNA();
  const nnOk = await loadAlphaZeroNN();
  if (!nnOk || !(PRSim.isLoaded && PRSim.isLoaded())) throw new Error('NN 未加载 → L6 会回退 L5, 测量无意义');
  const N = 4;
  const matchups = ${JSON.stringify(MATCHUPS)};
  const out = [];
  for (const [hi, lo] of matchups) {
    let wins = 0, played = 0, hiScore = 0, loScore = 0;
    for (let g = 0; g < ${GAMES}; g++) {
      const seat = g % N;
      const levels = [lo,lo,lo,lo]; levels[seat] = hi;
      G = new Game(N, 'AI');
      G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel=levels[i]; });
      await runMainLoop();
      if (!G.gameOver) continue;
      played++;
      const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
      const best = Math.max(...totals);
      const winnerCount = totals.filter(t => t === best).length;
      if (totals[seat] === best) wins += 1 / winnerCount;
      for (let i=0;i<N;i++){ if(i===seat) hiScore+=totals[i]; else loScore+=totals[i]/(N-1); }
    }
    out.push({ hi, lo, played, winrate: wins/played, hiAvg: hiScore/played, loAvg: loScore/played });
    console.log('  [done] 宗师 vs 3×lvl'+lo+' : '+(wins/played*100).toFixed(0)+'% ('+played+'局)');
  }
  return out;
})()`;

const NM = {1:'入门',2:'进化',3:'普通',4:'困难',5:'专家',6:'宗师'};
const t0 = Date.now();
console.log(`宗师(L6) vs 3×低档 胜率（每组 ${GAMES} 局，座位轮转，alphaIters=400/expertIters=400）NN=${NN_OVERRIDE||'mcts_value_nn.json(部署)'}`);
run(src).then(rows => {
  console.log(`\n=== 结果 / ${((Date.now()-t0)/1000).toFixed(0)}s ===`);
  let allPass = true;
  for (const r of rows) {
    const pass = r.winrate >= 0.60;
    if (!pass) allPass = false;
    console.log(`  1×${NM[r.hi]} vs 3×${NM[r.lo]} : 胜率 ${(r.winrate*100).toFixed(1)}%  均分 ${r.hiAvg.toFixed(1)} / ${r.loAvg.toFixed(1)}  ${pass?'达标(>=60%)':'未达60%'}`);
  }
  console.log(allPass ? '\n[结论] 宗师对所有更低档组合均 >=60% — 目标达成' : '\n[结论] 存在 <60% 的组合(见上)');
}).catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
