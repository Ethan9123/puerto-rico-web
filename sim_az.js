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

  // ---------- ResNet JS 推理 ----------
  function _dense(input, W, b) {
    const outDim = W.length, inDim = W[0].length;
    const out = new Float32Array(outDim);
    for (let i = 0; i < outDim; i++) { const Wi = W[i]; let s = b[i]; for (let j = 0; j < inDim; j++) s += Wi[j] * input[j]; out[i] = s; }
    return out;
  }
  function _relu(x) { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] > 0 ? x[i] : 0; return o; }
  function _softmaxMasked(logits, mask) {
    // 只在 mask=1 的位置 softmax，其余置 0
    let m = -Infinity; for (let i = 0; i < logits.length; i++) if (mask[i] && logits[i] > m) m = logits[i];
    const e = new Float32Array(logits.length); let s = 0;
    for (let i = 0; i < logits.length; i++) { if (mask[i]) { e[i] = Math.exp(logits[i] - m); s += e[i]; } }
    if (s <= 0) { // 退化：均匀分布在 legal 上
      let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
      for (let i = 0; i < e.length; i++) e[i] = mask[i] ? 1 / n : 0;
      return e;
    }
    for (let i = 0; i < e.length; i++) e[i] = e[i] / s;
    return e;
  }
  // 一次 ResNet 前向，返回 { policyLogits:[69], value:[n_value] }。value[0]=当前决策者视角。
  function azForward(net, features) {
    if (features.length !== net.feature_dim) throw new Error(`azForward: feature dim ${features.length} vs ${net.feature_dim}`);
    let h = _relu(_dense(features, net.stem.W, net.stem.b));
    for (const blk of net.blocks) {
      const r = h;
      let x = _relu(_dense(h, blk.l1.W, blk.l1.b));
      x = _dense(x, blk.l2.W, blk.l2.b);
      const nh = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) { const v = x[i] + r[i]; nh[i] = v > 0 ? v : 0; } // 残差 + relu
      h = nh;
    }
    const policyLogits = _dense(h, net.policy_head.W, net.policy_head.b);
    const vraw = _dense(h, net.value_head.W, net.value_head.b);
    const value = new Float32Array(vraw.length);
    for (let i = 0; i < vraw.length; i++) value[i] = Math.tanh(vraw[i]);
    return { policyLogits, value };
  }
  let AZ_NET = null;
  async function azLoadNetwork(src) {
    let net;
    if (src && typeof src === "object") net = src;
    else { const res = await fetch(src); if (!res.ok) throw new Error("azLoadNetwork HTTP " + res.status); net = await res.json(); }
    if (net.arch !== "resnet" || !net.blocks) throw new Error("azLoadNetwork: not a resnet az model");
    AZ_NET = net;
    if (typeof console !== "undefined") console.log(`[sim_az] loaded resnet: feature=${net.feature_dim} action=${net.action_dim} value=${net.n_value} blocks=${net.blocks.length} hidden=${net.hidden} val_loss=${(net.val_loss || 0).toFixed(4)}`);
    return net;
  }
  function azIsLoaded() { return AZ_NET !== null; }
  // 在某决策点评估：返回 { policy:{[legal action]→prob}, value:[n_value], policyVec:[69] }
  function azEval(state, dec) {
    if (!AZ_NET) return null;
    const f = azFeatures(state, dec);
    const out = azForward(AZ_NET, f);
    const mask = legalMask(dec);
    const probs = _softmaxMasked(out.policyLogits, mask);
    const policy = {}; // 局部动作 → 概率
    for (const a of dec.actions) { const gi = toGlobal(dec.type, a); policy[a] = probs[gi]; }
    return { policy, value: out.value, policyVec: probs };
  }

  Object.assign(PRSim, {
    azActionToGlobal: toGlobal,
    azGlobalToAction: toLocal,
    azLegalMask: legalMask,
    azFeatures,
    azForward,
    azLoadNetwork,
    azIsLoaded,
    azEval,
    AZ_ACTION_DIM,
    AZ_FEATURE_DIM,
    AZ_DEC_TYPES: DEC_TYPES,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { toGlobal, toLocal, legalMask, azFeatures, azForward, azLoadNetwork, azIsLoaded, azEval, AZ_ACTION_DIM, AZ_FEATURE_DIM, DEC_TYPES };
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
