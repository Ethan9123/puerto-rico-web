// NN 前向数值一致性基准: 确定性生成若干局面, 打印 networkEval 全精度输出。
// 优化 sim_nn.js 前后各跑一次, diff 输出必须为空(扁平化必须逐位一致)。
// 用法: node tools/nn_parity.js > data/.nn_parity_{before|after}.txt
'use strict';
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
const { PRSim } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });

(async () => {
  await PRSim.loadNetwork('mcts_value_nn.json');
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const st = PRSim.newState(4, [5,5,5,5], rnd);
  let step = 0, probes = 0;
  while (!PRSim.isTerminal(st) && step < 200) {
    const ch = PRSim.currentChooser(st); if (ch < 0) break;
    const legal = PRSim.legalRoleIdxs(st); if (!legal.length) break;
    if (step % 5 === 0) {
      for (let p = 0; p < 4; p++) {
        const o = PRSim.networkEval(st, p);
        console.log(`step=${step} persp=${p} value=${o.value.toPrecision(17)} policy=[${[...o.policy].map(x => x.toPrecision(17)).join(',')}]`);
        probes++;
      }
    }
    PRSim.applyRole(st, PRSim.heuristicPickRole(st, ch, legal));
    step++;
  }
  console.error(`probes=${probes} steps=${step}`);
})().catch(e => { console.error(e); process.exit(1); });
