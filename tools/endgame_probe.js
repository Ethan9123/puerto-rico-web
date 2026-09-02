// ============================================================
// tools/endgame_probe.js — 终局精确求解器可行性诊断
// ============================================================
// 唯一未证伪的提升方向是"终局精确求解器"。但它能不能做, 取决于:
//   终局(endTriggered 触发后)剩余的因子化决策树有多大?
//   - 若 < ~1e7 节点 → 完整 maxn 精确求解可行, 值得建。
//   - 若爆炸(>1e9) → 完整求解不可行; 只能浅层近似, 而浅层≈现有 rollout, 大概率第九条负结果。
// 本脚本用 azDecision/azApply 自对弈到终局, 在 endTriggered 那一刻测量:
//   剩余决策数、各决策分支数、树大小估计(Π分支, 封顶), 以及"距终局还有几个角色阶段"。
//
// 用法: node tools/endgame_probe.js [games=200] [seed=12345]
'use strict';
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
const { PRSim } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js'] });

const GAMES = parseInt(process.argv[2] || '200');
const SEED0 = parseInt(process.argv[3] || '12345');

// 从给定状态用启发式因子化推进, 在每个决策点收集分支数, 直到终局
function measureFromHere(st, capNodes) {
  let decisions = 0, sumBranch = 0, maxBranch = 0;
  let logTreeSize = 0; // Σ log10(branch) → 树大小数量级
  let rolePhases = 0;
  let guard = 0;
  while (guard++ < 2000) {
    const dec = PRSim.azDecision(st);
    if (!dec) break;
    const b = dec.actions.length;
    decisions++;
    sumBranch += b;
    if (b > maxBranch) maxBranch = b;
    if (b > 1) logTreeSize += Math.log10(b); // 只有多选才贡献分支
    if (dec.type === 'role') rolePhases++;
    // 启发式选一个动作推进(测"一条主线"的长度与沿途分支)
    PRSim.azApply(st, PRSim.azHeuristicAction(st, dec));
  }
  return { decisions, sumBranch, maxBranch, logTreeSize, rolePhases };
}

(async () => {
  await PRSim.loadNetwork('mcts_value_nn.json').catch(() => {});
  const samples = []; // 每局一条: endTrigger 时刻的终局规模
  let triggered = 0;
  for (let g = 0; g < GAMES; g++) {
    let seed = (SEED0 + g * 7919) >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const st = PRSim.newState(4, [5,5,5,5], rnd);
    let guard = 0, captured = null;
    while (guard++ < 2000) {
      const dec = PRSim.azDecision(st);
      if (!dec) break;
      // 第一次检测到 endTriggered → 克隆当下, 测量剩余树
      if (st.endTriggered && !captured) {
        captured = measureFromHere(PRSim.clone(st), 1e7);
        triggered++;
      }
      PRSim.azApply(st, PRSim.azHeuristicAction(st, dec));
    }
    if (captured) samples.push(captured);
  }
  const stat = (key) => {
    const arr = samples.map(s => s[key]).sort((a, b) => a - b);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const med = arr[Math.floor(arr.length / 2)];
    return { mean, med, min: arr[0], max: arr[arr.length - 1] };
  };
  const d = stat('decisions'), r = stat('rolePhases'), lt = stat('logTreeSize'), mb = stat('maxBranch');
  console.log(`\n=== 终局规模诊断 (${samples.length}/${GAMES} 局测到 endTrigger) ===`);
  console.log(`从 endTriggered 那一刻到终局:`);
  console.log(`  剩余决策数:   均 ${d.mean.toFixed(1)}  中位 ${d.med}  范围 [${d.min}, ${d.max}]`);
  console.log(`  剩余角色阶段: 均 ${r.mean.toFixed(1)}  中位 ${r.med}  范围 [${r.min}, ${r.max}]`);
  console.log(`  单决策最大分支: 均 ${mb.mean.toFixed(1)}  最大 ${mb.max}`);
  console.log(`  树大小数量级 Σlog10(分支): 均 10^${lt.mean.toFixed(1)}  中位 10^${lt.med.toFixed(1)}  最大 10^${lt.max.toFixed(1)}`);
  const feasMed = lt.med, feasMax = lt.max;
  console.log(`\n[判定]`);
  console.log(`  中位局: ~10^${feasMed.toFixed(1)} 节点 → ${feasMed <= 7 ? '✅ 完整精确 maxn 可行' : feasMed <= 9 ? '⚠ 需 α-β/剪枝才可行' : '✗ 完整求解不可行(只能浅层近似)'}`);
  console.log(`  最坏局: ~10^${feasMax.toFixed(1)} 节点 → ${feasMax <= 7 ? '✅ 仍可行' : feasMax <= 9 ? '⚠ 边界' : '✗ 爆炸'}`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
