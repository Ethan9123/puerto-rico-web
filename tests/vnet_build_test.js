// tests/vnet_build_test.js — Phase 3a：价值网 1-ply 建造前瞻
//   ① 默认关闭时 vnetPickBuilding 返回 null（默认路径零影响）
//   ② 开启后返回合法的 options 下标或 -1(PASS)，且确定性
//   ③ 因子化续局确实回到角色边界（azDecision type==="role"）或终局 —— 保证价值网在训练分布内
//   ④ 安全闸：az 可建集合与 options 不一致时回退 null
//   ⑤ 非 4 人局 / 扩展局 / 网未加载 → null
'use strict';
const { loadEngine } = require('../tools/_sandbox.js');
const { sandbox, PRSim: S, run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'nn_wasm.js', 'sim_nn.js'] });
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

(async () => {
  await S.loadNetwork('mcts_value_nn.json');

  // ---- ③ 先直接验证"续到角色边界"这一核心假设（不依赖 game.js 的 G）----
  {
    let checked = 0, atRole = 0, terminal = 0;
    const st = S.newState(4, [5, 5, 5, 5]);
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 300 && checked < 40) {
      const dec = S.azDecision(st);
      if (!dec) break;
      if (dec.type === 'build') {
        for (const act of dec.actions) {
          const st2 = S.clone(st);
          S.azApply(st2, act);
          let d2 = S.azDecision(st2), g2 = 0;
          while (d2 && d2.type !== 'role' && g2++ < 400) { S.azApply(st2, S.azHeuristicAction(st2, d2)); d2 = S.azDecision(st2); }
          checked++;
          if (S.isTerminal(st2)) terminal++;
          else if (d2 && d2.type === 'role') { atRole++; ok(S.currentChooser(st2) >= 0, '③ 角色边界应有合法 chooser'); }
          else ok(false, '③ 续局既非终局也非角色边界');
          if (checked >= 40) break;
        }
      }
      S.azApply(st, S.azHeuristicAction(st, dec));
    }
    console.log(`③ build 前瞻续局：${checked} 次，回到角色边界 ${atRole}，终局 ${terminal}`);
    ok(checked > 0 && atRole + terminal === checked, '③ 每次续局都落在角色边界或终局（价值网训练分布内）');
  }

  // ---- 用 game.js 起一局真实对局来驱动 vnetPickBuilding ----
  const setLevels = (lv) => { run(`window._aiThinkBudget = { L4:50, L5:100, hardIters:60, hardMs:1e9, expertIters:120, expertMs:1e9, alphaIters:120, alphaMs:1e9 };`); void lv; };
  setLevels(6);
  run(`
    document.getElementById('player-count').value = '4';
    document.getElementById('all-ai').checked = true;
  `);
  // 直接构造 G（避免跑完整 startGame 的 UI 依赖）
  run(`G = new Game(4, ['A','B','C','D']); G.players.forEach(p => { p.isHuman=false; p._aiLevel=6; });`);
  const calls = [];
  run(`window.__vnetProbe = [];`);

  // ① 默认关闭
  {
    const r = run(`(function(){
      const p = G.players[0];
      const opts = BUILDINGS.filter(b => (G.buildingStock[b.id]||0) > 0).slice(0,6).map(b => ({ b, cost: b.cost }));
      return vnetPickBuilding(p, opts, true);
    })()`);
    ok(r === null, `① 默认关闭应返回 null，实际 ${r}`);
  }

  // ② 开启后返回合法下标 / -1，且确定性
  run(`window._l6VnetBuild = true;`);
  {
    const probe = `(function(){
      const p = G.players[0];
      const bcard = G.roleCards.find(r => r.name === 'Builder');
      bcard.taken = true; bcard.takenBy = 0;      // 模拟 Builder 已被 0 号选走
      const opts = BUILDINGS.filter(b => (G.buildingStock[b.id]||0) > 0 && b.cost <= p.money + 3).slice(0,8).map(b => ({ b, cost: b.cost }));
      if (!opts.length) return 'NO_OPTIONS';
      const a = vnetPickBuilding(p, opts, true);
      const b = vnetPickBuilding(p, opts, true);
      return JSON.stringify({ a, b, n: opts.length });
    })()`;
    const raw = run(probe);
    if (raw === 'NO_OPTIONS') { console.log('② 跳过（无可建选项）'); }
    else {
      const { a, b, n } = JSON.parse(raw);
      console.log(`② vnetPickBuilding → ${a} (候选 ${n})，重复调用 → ${b}`);
      ok(a === null || a === -1 || (a >= 0 && a < n), `② 返回值须为 null/-1/合法下标，实际 ${a}`);
      ok(a === b, '② 同状态两次调用结果一致（确定性）');
      calls.push(a);
    }
  }

  // ④ 安全闸：给一个与 az 不一致的 options 集合 → null
  {
    const r = run(`(function(){
      const p = G.players[0];
      const fake = [{ b: { id: 999, cost: 1 }, cost: 1 }];   // az 里不存在的建筑 id
      return vnetPickBuilding(p, fake, true);
    })()`);
    ok(r === null, `④ 集合不一致必须回退 null，实际 ${r}`);
  }

  // ⑤ 守卫：非 4 人局
  {
    const r = run(`(function(){
      const saved = G.numPlayers; G.numPlayers = 3;
      const p = G.players[0];
      const opts = BUILDINGS.filter(b => (G.buildingStock[b.id]||0) > 0).slice(0,4).map(b => ({ b, cost: b.cost }));
      const out = vnetPickBuilding(p, opts, true);
      G.numPlayers = saved; return out;
    })()`);
    ok(r === null, `⑤ 3 人局须回退 null（evalLeafVecNN 仅 4 人），实际 ${r}`);
  }
  // ⑤ 守卫：扩展局
  {
    const r = run(`(function(){
      G.expansionNobles = true;
      const p = G.players[0];
      const opts = BUILDINGS.filter(b => (G.buildingStock[b.id]||0) > 0).slice(0,4).map(b => ({ b, cost: b.cost }));
      const out = vnetPickBuilding(p, opts, true);
      G.expansionNobles = false; return out;
    })()`);
    ok(r === null, `⑤ 扩展局须回退 null，实际 ${r}`);
  }
  run(`window._l6VnetBuild = false;`);
  void calls;

  console.log(fails ? `\nVNET BUILD TEST FAILED: ${fails}` : '\nVNET BUILD TEST OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
