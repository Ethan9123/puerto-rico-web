// Phase 6 集成 smoke test：
//  - 加载 game.js / sim.js / sim_features.js / sim_nn.js
//  - 加载 NN（smoke 模型）
//  - 跑 ISMCTS+NN 制导，验证返回合法角色 idx
//  - 不需要 DOM，重用 nn_parity_test.js 的 sandbox 模式
'use strict';

// 共享 Node 沙盒（tools/_sandbox.js）替代原先每个测试各自复制的 makeEl()/vm 样板
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });

const PRSim = sandbox.PRSim;

(async () => {
  // 1) 检查 networkEval 没加载时返回 null
  if (PRSim.isLoaded()) { console.error('NN should NOT be loaded yet'); process.exit(1); }
  // 2) 加载 smoke NN
  await PRSim.loadNetwork('mcts_value_nn.json');
  if (!PRSim.isLoaded()) { console.error('NN load failed'); process.exit(1); }
  console.log('[smoke] NN loaded OK');

  // 3) 构造一个新的 sim 状态，跑 ISMCTS+NN
  const st = PRSim.newState(4, ()=>Math.random());
  const seat = PRSim.currentChooser(st);
  if (seat < 0) { console.error('no chooser at game start'); process.exit(1); }

  // 验证 NN forward 能跑通
  const out = PRSim.networkEval(st, seat);
  if (!out || !out.policy || typeof out.value !== 'number') {
    console.error('networkEval bad output', out); process.exit(1);
  }
  console.log(`[smoke] networkEval OK: value=${out.value.toFixed(3)}, policy[0..6]=[${[...out.policy].map(x=>x.toFixed(3)).join(',')}]`);

  // 4) 跑 ISMCTS with NN priors + NN leaf eval
  const ROLE_NAMES = ['Settler','Mayor','Builder','Craftsman','Trader','Captain','Prospector'];
  const t0 = Date.now();
  const ri = PRSim.ismctsPickRoleIdx(st, {
    maxIters: 100, budgetMs: 5000, C: 1.5,
    evalLeafFn: (s, p) => PRSim.evalLeafNN(s, p),
    priorPolicyFn: (s, p) => {
      const o = PRSim.networkEval(s, p);
      if (!o) return null;
      const legal = PRSim.legalRoleIdxs(s);
      const dist = {};
      let total = 0;
      const legalNames = new Set(legal.map(i => s.roleCards[i].name));
      for (let k = 0; k < ROLE_NAMES.length; k++) {
        if (legalNames.has(ROLE_NAMES[k])) { dist[ROLE_NAMES[k]] = o.policy[k]; total += o.policy[k]; }
      }
      if (total > 0) for (const k of Object.keys(dist)) dist[k] /= total;
      return dist;
    },
  });
  const dt = Date.now() - t0;
  if (ri < 0 || ri >= st.roleCards.length) { console.error('bad ri', ri); process.exit(1); }
  console.log(`[smoke] L6 ISMCTS picked role ${ri} (${st.roleCards[ri].name}) in ${dt}ms`);

  // 5) 验证 fallback：unloadNetwork 后 evalLeafNN 应返回 0
  PRSim.unloadNetwork();
  const v = PRSim.evalLeafNN(st, seat);
  if (v !== 0) { console.error('evalLeafNN should return 0 when unloaded, got', v); process.exit(1); }
  console.log('[smoke] unload fallback OK');

  console.log('\nAll L6 smoke checks PASSED.');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(99); });
