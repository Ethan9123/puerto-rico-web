// ============================================================
// sim_az.js — AlphaZero 胶水层：统一动作编码 + 决策上下文特征
// ============================================================
// 依赖 sim.js(因子化决策层 azDecision/azApply, AZ_PASS/AZ_QUARRY) 与
// sim_features.js(extractRich, FEATURE_DIM_RICH)。
// 加载顺序：game.js → sim.js → sim_features.js → sim_nn.js → sim_az.js
//
// 统一动作词表(AZ_ACTION_DIM=69)：把每种决策类型的"局部动作"映射到全局索引，
// policy 头在该空间上输出，按当前决策的 legalMask 掩码。
//   role(选角色)   : roleCard 索引 0..7
//   settle(选田)   : 5 货种 + 采石场
//   build(建造)    : 23 建筑 + pass
//   trade(卖货)    : 5 货种 + pass
//   craftbonus(取货): 5 货种
//   captain(装船)  : shipSlot(0..2 船,3 码头) × 5 货种
(function (root) {
  "use strict";
  const PRSim = root.PRSim;
  if (!PRSim || typeof PRSim.azDecision !== "function") throw new Error("sim_az.js: load sim.js (factored layer) first");
  if (typeof PRSim.extractRich !== "function") throw new Error("sim_az.js: load sim_features.js first");

  const GOODS_ = (typeof GOODS !== "undefined") ? GOODS : (root.GOODS || (root._PR_STATIC && root._PR_STATIC.GOODS));
  const N_GOODS = GOODS_.length;          // 5
  const N_BLD = 23;
  const AZ_PASS = PRSim.AZ_PASS;          // -1
  const AZ_QUARRY = PRSim.AZ_QUARRY;      // -2
  const FEATURE_DIM_RICH = PRSim.FEATURE_DIM_RICH || 446;

  // 各决策类型在统一词表中的 [offset, size]
  const SEG = {
    role:       { off: 0,  size: 8 },
    settle:     { off: 8,  size: N_GOODS + 1 },   // 8..13
    build:      { off: 14, size: N_BLD + 1 },     // 14..37 (bid + pass)
    trade:      { off: 38, size: N_GOODS + 1 },   // 38..43
    craftbonus: { off: 44, size: N_GOODS },       // 44..48
    captain:    { off: 49, size: 4 * N_GOODS },   // 49..68 (ship0..3 × good)
  };
  const AZ_ACTION_DIM = 69;
  const DEC_TYPES = ["role", "settle", "build", "trade", "craftbonus", "captain"];
  const AZ_FEATURE_DIM = FEATURE_DIM_RICH + DEC_TYPES.length; // 446 + 6 = 452

  // 局部动作 → 全局索引
  function toGlobal(type, a) {
    const s = SEG[type]; if (!s) return -1;
    switch (type) {
      case "role": return s.off + a;
      case "settle": return s.off + (a === AZ_QUARRY ? N_GOODS : a);
      case "build": return s.off + (a === AZ_PASS ? N_BLD : a - 1);
      case "trade": return s.off + (a === AZ_PASS ? N_GOODS : a);
      case "craftbonus": return s.off + a;
      case "captain": { const ship = Math.floor(a / 10), gi = a % 10; return s.off + ship * N_GOODS + gi; }
    }
    return -1;
  }
  // 全局索引 → 局部动作（喂给 azApply）
  function toLocal(type, g) {
    const s = SEG[type]; if (!s) return null;
    const x = g - s.off;
    switch (type) {
      case "role": return x;
      case "settle": return x === N_GOODS ? AZ_QUARRY : x;
      case "build": return x === N_BLD ? AZ_PASS : x + 1;
      case "trade": return x === N_GOODS ? AZ_PASS : x;
      case "craftbonus": return x;
      case "captain": { const ship = Math.floor(x / N_GOODS), gi = x % N_GOODS; return ship * 10 + gi; }
    }
    return null;
  }

  // 当前决策的合法动作掩码(全局空间)
  function legalMask(dec) {
    const m = new Float32Array(AZ_ACTION_DIM);
    for (const a of dec.actions) { const gi = toGlobal(dec.type, a); if (gi >= 0 && gi < AZ_ACTION_DIM) m[gi] = 1; }
    return m;
  }

  // 决策上下文特征：extractRich(chooser 视角, 446) ++ 决策类型 one-hot(6)
  function azFeatures(state, dec) {
    const base = PRSim.extractRich(state, dec.chooser);
    const out = new Float32Array(base.length + DEC_TYPES.length);
    out.set(base, 0);
    const ti = DEC_TYPES.indexOf(dec.type);
    if (ti >= 0) out[base.length + ti] = 1;
    return out;
  }

  Object.assign(PRSim, {
    azActionToGlobal: toGlobal,
    azGlobalToAction: toLocal,
    azLegalMask: legalMask,
    azFeatures,
    AZ_ACTION_DIM,
    AZ_FEATURE_DIM,
    AZ_DEC_TYPES: DEC_TYPES,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { toGlobal, toLocal, legalMask, azFeatures, AZ_ACTION_DIM, AZ_FEATURE_DIM, DEC_TYPES };
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
