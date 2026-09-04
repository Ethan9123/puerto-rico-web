// 诊断: 评测局(game.js 全流程)里 L5/L6 的角色决策到底走了搜索还是回退/捷径
// 统计: ismctsPickRoleIdx 真实调用次数 vs 角色决策总数; 以及单局耗时
// 用法: node tools/fallback_probe.js [games=2]
'use strict';
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
const { run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });

const GAMES = parseInt(process.argv[2] || '2');

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:400, expertMs:1e9, alphaIters:400, alphaMs:1e9 };
  await loadAIDNA();
  await loadAlphaZeroNN();
  // 插桩: 包一层 ismctsPickRoleIdx 统计真实搜索调用与耗时分布
  const stats = { searchCalls: 0, searchMs: 0, searchIters: [], shortcut1: 0 };
  const _orig = PRSim.ismctsPickRoleIdx;
  PRSim.ismctsPickRoleIdx = function(st, opts) {
    const legal = PRSim.legalRoleIdxs(st);
    if (legal.length <= 1) { stats.shortcut1++; return _orig.call(this, st, opts); }
    stats.searchCalls++;
    const t = Date.now();
    const r = _orig.call(this, st, opts);
    stats.searchMs += Date.now() - t;
    return r;
  };
  const N = 4;
  const out = [];
  for (let g = 0; g < ${GAMES}; g++) {
    stats.searchCalls = 0; stats.searchMs = 0; stats.shortcut1 = 0;
    const seat = g % N;
    const levels = [5,5,5,5]; levels[seat] = 6;
    const tg = Date.now();
    G = new Game(N, 'AI');
    G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel=levels[i]; });
    await runMainLoop();
    const gameMs = Date.now() - tg;
    // 角色决策总数 = 回合数 × 4 (粗估: 用 roleCards taken 记录不可得, 直接看 searchCalls + shortcut)
    out.push({ g, gameMs, searchCalls: stats.searchCalls, shortcut1: stats.shortcut1,
               searchMs: stats.searchMs, avgSearchMs: stats.searchCalls ? Math.round(stats.searchMs / stats.searchCalls) : 0 });
    console.log('game ' + g + ': ' + (gameMs/1000).toFixed(1) + 's, 多选搜索=' + stats.searchCalls
      + ' 单选捷径=' + stats.shortcut1 + ' 搜索总耗时=' + (stats.searchMs/1000).toFixed(1) + 's 平均=' + (stats.searchCalls ? Math.round(stats.searchMs/stats.searchCalls) : 0) + 'ms/次');
  }
  return out;
})()`;

run(src).then(rows => {
  const tot = rows.reduce((s, r) => ({ ms: s.ms + r.gameMs, sc: s.sc + r.searchCalls, sh: s.sh + r.shortcut1, sm: s.sm + r.searchMs }), {ms:0,sc:0,sh:0,sm:0});
  console.log(`\n=== ${rows.length} 局汇总 ===`);
  console.log(`  每局: ${(tot.ms/rows.length/1000).toFixed(1)}s   多选搜索 ${(tot.sc/rows.length).toFixed(1)} 次/局 (平均 ${tot.sc?Math.round(tot.sm/tot.sc):0}ms/次)   单选捷径 ${(tot.sh/rows.length).toFixed(1)} 次/局`);
  console.log(`  搜索占墙钟: ${(tot.sm/tot.ms*100).toFixed(0)}%`);
}).catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
