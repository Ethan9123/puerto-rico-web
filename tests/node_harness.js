// 最小 DOM shim + vm 沙箱，用于在 Node 里跑全 AI 自对弈，验证 AI 强度梯队与守恒不变量。
// 用法: node tests/node_harness.js [perConfig] [mixed]
const vm = require('vm');

// 共享 Node 沙盒（tools/_sandbox.js）替代原先每个测试各自复制的 makeEl()/vm 样板
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js'] });

const perConfig = parseInt(process.argv[2] || '8');
const mixedGames = parseInt(process.argv[3] || '20');
const expertIters = parseInt(process.argv[4] || '150'); // 测试用较小迭代提速

const testSrc = `(async () => {
  // 关掉渲染/动画/toast 提速
  render = function () {};
  flyToDest = function () {};
  showToast = function () {};
  window._allAIMode = true;
  window._fastSpectator = true;
  window._aiThinkBudget = { L4: 50, L5: 100, hardIters: 60, hardMs: 1e9, expertIters: ${expertIters}, expertMs: 1e9 };

  await loadAIDNA();

  const expectedGoods = { corn: 10, indigo: 12, sugar: 11, tobacco: 9, coffee: 8 };
  const expectedColonists = { 3: 58, 4: 79, 5: 100 }; // 官方总数 = 供应池(55/75/95) + 初始殖民船(玩家数)，与 sim_test 一致
  const builtSeen = new Set(), rolesSeen = new Set();
  const levelVpSums = {1:0,2:0,3:0,4:0,5:0}, levelCounts = {1:0,2:0,3:0,4:0,5:0};
  const problems = [];

  async function runOneGame(n, levels) {
    G = new Game(n, 'AI');
    G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = levels[i % levels.length]; });
    window._allAIMode = true;
    window._fastSpectator = true;
    await runMainLoop();
    for (const r of G.roleCards) if (r.takenBy !== null) rolesSeen.add(r.name);
    G.players.forEach(p => p.buildings.forEach(b => builtSeen.add(b.bid)));
    const colonistsTotal = G.colonistsLeft + G.colonistsOnShip + G.players.reduce((s,p)=>s+G.totalColonists(p),0);
    if (colonistsTotal !== expectedColonists[n]) problems.push('colonists '+n+'p='+colonistsTotal);
    for (const kind of GOODS) {
      const gp = G.players.reduce((s,p)=>s+p.goods[kind],0);
      const gs = G.ships.reduce((s,sh)=>s+(sh.good===kind?sh.count:0),0);
      const gt = G.tradingHouse.filter(g => g === kind).length;
      if (G.supply[kind]+gp+gs+gt !== expectedGoods[kind]) problems.push('goods '+kind);
    }
    if (!(G.gameOver && G.endTriggered)) problems.push('endflag '+n+'p');
    const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
    totals.forEach((v,idx)=>{ if (v<=0) problems.push('nonpos vp p'+idx+'='+v); });
    return totals;
  }

  // 守恒/终局用全 L3(强启发式，快)跑 3/4/5 人，避免全 MCTS 太慢
  for (const n of [3,4,5]) {
    for (let i = 0; i < ${perConfig}; i++) {
      await runOneGame(n, [3,3,3,3,3]);
    }
  }
  for (let g = 0; g < ${mixedGames}; g++) {
    // 轮转座位，消除"某等级永远坐某位"的偏置
    const base = [1,2,3,4,5];
    const levels = base.map((_, i) => base[(i + g) % 5]);
    const totals = await runOneGame(5, levels);
    for (let i = 0; i < 5; i++) { levelVpSums[levels[i]] += totals[i]; levelCounts[levels[i]] += 1; }
  }
  const avg = {};
  for (const l of [1,2,3,4,5]) avg[l] = levelVpSums[l] / levelCounts[l];
  return {
    avg, builtSeenSize: builtSeen.size, rolesSeenSize: rolesSeen.size,
    problems: problems.slice(0, 20), problemCount: problems.length,
    hierarchyOK: avg[5] > avg[4] && avg[4] > avg[3] && avg[3] > avg[2] && avg[2] > avg[1],
  };
})()`;

vm.runInContext(testSrc, sandbox).then((r) => {
  console.log('avg VP by level:',
    [1,2,3,4,5].map(l => 'L' + l + '=' + r.avg[l].toFixed(2)).join('  '));
  console.log('hierarchy L5>L4>L3>L2>L1 :', r.hierarchyOK);
  console.log('buildings seen:', r.builtSeenSize + '/23', ' roles seen:', r.rolesSeenSize + '/7');
  console.log('invariant problems:', r.problemCount, r.problems);
}).catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
