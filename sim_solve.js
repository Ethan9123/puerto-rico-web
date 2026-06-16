// ============================================================
// sim_solve.js — 终局精确 maxⁿ 求解器（additive，不改 sim.js）
// ============================================================
// 诊断(tools/endgame_probe.js)证明: endTriggered 后剩余因子化决策树中位 ~10^4 节点、
// 最坏 ~10^7.8 → 完整 maxⁿ 精确求解可行。这是唯一未被证伪的提升方向(AI_STRENGTH §7)。
//
// 设计:
//   - 用 PRSim.azDecision/azApply/clone/isTerminal/finalScore 走因子化树到终局。
//   - maxⁿ 回溯: 每个决策点 chooser 选「让自己终局 VP 最大」的动作; 返回 4 维 VP 向量。
//   - 节点预算 cap: 超预算抛 BUDGET → 调用方回退启发式(只有极少数最坏局会触发)。
//   - 隐藏信息(种植园牌堆顺序)按当前 clone 的确定化处理(决策时在真实状态上求解, 自洽)。
//   - 平局摊分用与 finalScore 一致的口径: 这里直接比较各自 VP, 平手时不特殊处理
//     (maxⁿ 下每人只关心自己 VP 绝对值, 这与"抢第一"目标一致——抬高自己即可)。
//
// 仅供 L6 在终局调用: PRSim.solveEndgame(state, capNodes) -> { action, values } | null
(function (root) {
  "use strict";
  const PRSim = root.PRSim;
  if (!PRSim || typeof PRSim.azDecision !== "function") throw new Error("sim_solve.js: load sim.js (factored layer) first");

  const BUDGET = { hit: false };

  // 估算"从此状态到终局沿启发式主线的多选决策数" → 便宜的预筛(避免对大树启动求解)。
  // 返回 Σlog10(branch); 调用方用阈值(如 <=6 即 ~1e6 节点)决定是否求解。
  function endgameMagnitude(state, guardMax) {
    const st = PRSim.clone(state);
    let logSize = 0, guard = 0;
    const gmax = guardMax || 60;
    while (guard++ < gmax) {
      const dec = PRSim.azDecision(st);
      if (!dec) break;
      const b = dec.actions.length;
      if (b > 1) logSize += Math.log10(b);
      PRSim.azApply(st, PRSim.azHeuristicAction(st, dec));
    }
    return logSize;
  }

  // 精确 maxⁿ: 返回从 state 起最优play下的终局 VP 向量 [v0..v3]。
  // budget.n 递减; <=0 抛 'BUDGET'。
  function solveValues(state, budget) {
    if (PRSim.isTerminal(state)) {
      return state.players.map(p => PRSim.finalScore(p));
    }
    const dec = PRSim.azDecision(state);
    if (!dec) return state.players.map(p => PRSim.finalScore(p));
    const ch = dec.chooser;
    let bestVec = null, bestVal = -Infinity;
    for (const a of dec.actions) {
      if (--budget.n <= 0) throw 'BUDGET';
      const ns = PRSim.clone(state);
      PRSim.azApply(ns, a);
      const vec = solveValues(ns, budget);
      if (vec[ch] > bestVal) { bestVal = vec[ch]; bestVec = vec; }
    }
    return bestVec;
  }

  // 顶层: 求当前决策的最优动作 + 全员终局 VP 向量。超预算返回 null。
  function solveEndgame(state, capNodes) {
    const cap = capNodes || 4e6;
    if (PRSim.isTerminal(state)) return null;
    const dec = PRSim.azDecision(state);
    if (!dec || dec.actions.length === 0) return null;
    const ch = dec.chooser;
    const budget = { n: cap };
    try {
      let bestA = dec.actions[0], bestVal = -Infinity, bestVec = null;
      for (const a of dec.actions) {
        if (--budget.n <= 0) throw 'BUDGET';
        const ns = PRSim.clone(state);
        PRSim.azApply(ns, a);
        const vec = solveValues(ns, budget);
        if (vec[ch] > bestVal) { bestVal = vec[ch]; bestA = a; bestVec = vec; }
      }
      return { action: bestA, values: bestVec, chooser: ch, type: dec.type, nodesUsed: cap - budget.n };
    } catch (e) {
      if (e === 'BUDGET') return null;
      throw e;
    }
  }

  Object.assign(PRSim, { solveEndgame, endgameMagnitude });
  if (typeof module !== "undefined" && module.exports) Object.assign(module.exports, { solveEndgame, endgameMagnitude });
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
