// 扩展模式（Expansion I 新建筑）全 AI 自对弈守恒测试。
// 用法: node tests/exp_harness.js [gamesPerN]
const vm = require('vm');

// 共享 Node 沙盒（tools/_sandbox.js）替代原先每个测试各自复制的 makeEl()/vm 样板
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js'] });

const gamesPerN = parseInt(process.argv[2] || '4');

const testSrc = `(async () => {
  render = function () {};
  flyToDest = function () {};
  showToast = function () {};
  window._allAIMode = true;
  window._fastSpectator = true;
  window._aiThinkBudget = { L4: 50, L5: 100, hardIters: 60, hardMs: 1e9, expertIters: 100, expertMs: 1e9 };
  await loadAIDNA();

  const expectedGoods = { corn: 10, indigo: 12, sugar: 11, tobacco: 9, coffee: 8 };
  const expectedColonists = { 3: 58, 4: 79, 5: 100 }; // 官方总数 = 供应池(55/75/95) + 初始殖民船(玩家数)，与 sim_test 一致
  const problems = [];
  const expBuilt = new Set();

  for (const mode of ["newbuildings", "nobles"]) {
  for (const n of [3, 4, 5]) {
    for (let i = 0; i < ${gamesPerN}; i++) {
      G = new Game(n, 'AI', mode);
      G.expansionType = mode;
      G.players.forEach((p, k) => { p.isHuman = false; loadDNA(p, k); p._aiLevel = 3; });
      await runMainLoop();
      G.players.forEach(p => p.buildings.forEach(b => { if (b.bid >= 24) expBuilt.add(b.bid); }));
      // 殖民者守恒（totalColonists 含贵族 → 扣除贵族数后比对）
      const noblesOnBoards = G.players.reduce((s,p)=>s+G.nobleCount(p),0);
      const colonistsTotal = G.colonistsLeft + G.colonistsOnShip + G.players.reduce((s,p)=>s+G.totalColonists(p),0) - noblesOnBoards;
      if (colonistsTotal !== expectedColonists[n]) problems.push('colonists '+mode+' '+n+'p='+colonistsTotal);
      // 贵族守恒（共 20）
      if (mode === "nobles") {
        const nobleTotal = G.noblesLeft + G.noblesOnShip + noblesOnBoards;
        if (nobleTotal !== 20) problems.push('nobles '+n+'p='+nobleTotal);
      }
      // 货物守恒
      for (const kind of GOODS) {
        const gp = G.players.reduce((s,p)=>s+p.goods[kind],0);
        const gs = G.ships.reduce((s,sh)=>s+(sh.good===kind?sh.count:0),0);
        const gt = G.tradingHouse.filter(g => g === kind).length;
        if (G.supply[kind]+gp+gs+gt !== expectedGoods[kind]) problems.push('goods '+n+'p '+kind+'='+(G.supply[kind]+gp+gs+gt));
      }
      // 雕像不得重复计分：拥有雕像者 specialVPs 不应包含 +8（无修道院等时为 0 也行，这里只验证总分可计算）
      for (const p of G.players) {
        const sp = G.getSpecialVPs(p);
        if (!isFinite(sp) || sp < 0) problems.push('specialVP bad');
      }
      if (!(G.gameOver && G.endTriggered)) problems.push('endflag '+mode+' '+n+'p');
    }
  }
  }
  return { problems: problems.slice(0, 20), problemCount: problems.length, expBuilt: [...expBuilt].sort((a,b)=>a-b) };
})()`;

vm.runInContext(testSrc, sandbox).then((r) => {
  console.log('expansion buildings built across games:', r.expBuilt.join(','));
  console.log('invariant problems:', r.problemCount, r.problems);
  if (r.problemCount === 0) console.log('EXPANSION OK');
  else process.exit(1);
}).catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
