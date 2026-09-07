// 鲁棒性矩阵: 每个难度(L1-L6) × 每个扩展模式, 4×同档全AI局。
// 检查: 游戏正常结束 / 无抛错 / sim 无崩溃(ISMCTS failed) / 分数合理(非0/NaN) / AI 是否建了扩展建筑。
// 用法: node tools/exp_matrix.js [gamesPerCell=3]
'use strict';
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
let simErrs = 0;
const realErr = console.error;
const { run } = loadEngine({
  files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'],
  // 与旧样板一致: 沙盒内 console.error 只计数 sim 崩溃, warn 静音
  extraGlobals: { console: { log: console.log, warn: () => {}, error: (...a) => { if (String(a.join(' ')).match(/ISMCTS failed|failed|TypeError|undefined/)) simErrs++; } } },
});

const GPC = parseInt(process.argv[2] || '3');
const MODES = ['none', 'newbuildings', 'nobles', 'tibs'];
const LEVELS = [1, 2, 3, 4, 5, 6];
const NM = { 1:'入门', 2:'进化', 3:'普通', 4:'困难', 5:'专家', 6:'宗师' };

const src = `(async () => {
  render=function(){}; flyToDest=function(){}; showToast=function(){};
  window._allAIMode = true; window._fastSpectator = true;
  // 低预算: 只测鲁棒性/能否应对, 不测强度
  window._aiThinkBudget = { L4:30, L5:40, hardIters:20, hardMs:1e9, expertIters:40, expertMs:1e9, alphaIters:40, alphaMs:1e9 };
  await loadAIDNA();
  await loadAlphaZeroNN();
  const rows = [];
  for (const mode of ${JSON.stringify(MODES)}) {
    for (const lvl of ${JSON.stringify(LEVELS)}) {
      let done = 0, thrown = 0, builtExp = 0, scoreSum = 0, scoreBad = 0;
      for (let g = 0; g < ${GPC}; g++) {
        try {
          G = new Game(4, 'AI', mode);
          G.players.forEach((p,i)=>{ p.isHuman=false; loadDNA(p, i); p._aiLevel = lvl; });
          await runMainLoop();
          if (!G.gameOver) { continue; }
          done++;
          const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
          for (const t of totals) { scoreSum += t; if (!isFinite(t) || t < 0) scoreBad++; }
          // 是否有人建了扩展建筑(>=24)
          if (G.players.some(p => p.buildings.some(b => b.bid >= 24))) builtExp++;
        } catch (e) { thrown++; console.log('  THROW ['+mode+' L'+lvl+']: '+(e && e.message || e)); }
      }
      rows.push({ mode, lvl, done, thrown, builtExp, avg: done ? (scoreSum/(done*4)).toFixed(1) : '-', scoreBad });
    }
  }
  return rows;
})()`;

console.log('鲁棒性矩阵: 4 模式 × 6 难度 × ' + GPC + ' 局/格 (4×同档全AI)\n');
run(src).then(rows => {
  // 按模式分组打印
  for (const mode of MODES) {
    console.log('=== ' + mode + ' ===');
    for (const lvl of LEVELS) {
      const r = rows.find(x => x.mode === mode && x.lvl === lvl);
      const ok = r.done === GPC && r.thrown === 0 && r.scoreBad === 0;
      console.log('  L' + lvl + ' ' + NM[lvl].padEnd(2) + ' : 完成 ' + r.done + '/' + GPC + ' 抛错 ' + r.thrown + ' 均分 ' + r.avg + ' 建扩展 ' + r.builtExp + '/' + r.done + (ok ? '  ✅' : '  ❌'));
    }
  }
  console.log('\n全局 sim 崩溃(ISMCTS failed 类): ' + simErrs);
  const allOk = rows.every(r => r.done === GPC && r.thrown === 0 && r.scoreBad === 0);
  console.log(allOk && simErrs === 0 ? '\n✅ 全部 24 格: L1~L6 在所有扩展模式下都能正常应对(无崩溃/正常结束/分数合理)' : '\n⚠ 存在问题格(见上 ❌ / 崩溃计数)');
}).catch(e => { realErr('FATAL', e && e.stack || e); process.exit(1); });
