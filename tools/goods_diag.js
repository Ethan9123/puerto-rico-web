// 诊断: 所有经济货(靛蓝/蔗糖/烟草/咖啡)是否都有"买厂却不产货"(死厂)问题。
// 对每种货, 统计每局结束时拥有该货加工厂的 AI 里有多少产能=0, 并细分原因。
// 可传 CHAIN_DONE 覆盖(给全部玩家设 p._chainDone), 用于测不同奖励值对死厂率的影响。
// 用法: node tools/goods_diag.js [games=40] [level=4] [chainDone=5]
'use strict';
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
const { run } = loadEngine({
  files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'],
  extraGlobals: { console: { log: console.log, warn: () => {}, error: () => {} } }, // 与旧样板一致: 沙盒内静音 warn/error
});

const GAMES = parseInt(process.argv[2] || '40');
const LVL = parseInt(process.argv[3] || '4');
const CD = process.argv[4] != null ? parseInt(process.argv[4]) : 5;

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = { L4:40, L5:50, hardIters:20, hardMs:1e9, expertIters:50, expertMs:1e9, alphaIters:50, alphaMs:1e9 };
  await loadAIDNA(); await loadAlphaZeroNN();
  const FACT = { indigo:[1,3], sugar:[2,4], tobacco:[5], coffee:[6] };
  const stat = {}; for (const g of Object.keys(FACT)) stat[g] = { own:0, dead:0, a:0, b:0, c:0 };
  let games = 0;
  for (let gi = 0; gi < ${GAMES}; gi++) {
    G = new Game(4, 'AI');
    G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel = ${LVL}; p._chainDone = ${CD}; });
    await runMainLoop(); if (!G.gameOver) continue; games++;
    for (const p of G.players) {
      for (const good of Object.keys(FACT)) {
        const facts = p.buildings.filter(b => FACT[good].includes(b.bid));
        if (!facts.length) continue;
        stat[good].own++;
        const prod = G.productionCapacity(p, good);
        if (prod !== 0) continue;
        stat[good].dead++;
        const fields = p.plantations.filter(pl => pl.good === good);
        const manned = fields.filter(pl => pl.manned).length;
        if (fields.length === 0) stat[good].a++;          // 无田(投机买厂)
        else if (manned === 0) stat[good].b++;            // 有田没上人
        else stat[good].c++;                              // 有有人田但厂空
      }
    }
  }
  return { games, stat };
})()`;

run(src).then(r => {
  console.log('\\n=== 全货死厂诊断 (' + r.games + ' 局, L' + LVL + ', CHAIN_DONE=' + CD + ') ===');
  console.log('  货种     拥有厂  死厂(率)      细分 a无田/b田未上人/c厂空');
  const order = ['indigo','sugar','tobacco','coffee'];
  const cn = { indigo:'靛蓝', sugar:'蔗糖', tobacco:'烟草', coffee:'咖啡' };
  for (const g of order) {
    const s = r.stat[g];
    const rate = s.own ? (s.dead/s.own*100).toFixed(0) : '0';
    console.log('  ' + cn[g] + '   ' + String(s.own).padStart(6) + '  ' + String(s.dead).padStart(3) + ' (' + rate.padStart(3) + '%)    ' + s.a + ' / ' + s.b + ' / ' + s.c);
  }
}).catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
