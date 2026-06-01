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

  // ---------- Gumbel AlphaZero 搜索（因子化博弈树 + ISMCTS 确定化 + value 向量 maxn backup）----------
  // determinize：重排未翻开的种植园牌堆(隐藏信息)，公开 pool 不动。
  function determinize(st, rng) {
    const c = PRSim.clone(st);
    const d = c.plantationDeck;
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
    return c;
  }
  function _gumbel(rng) { return -Math.log(-Math.log(rng() + 1e-12) + 1e-12); }

  // 一次模拟：从 root 应用候选动作 rootAct 后，沿 PUCT 下行到叶，NN 评估 + 回传。
  // 返回 rootChooser 视角的叶 value。同时回填路径上各边统计。
  function _simulate(rootState, rootAct, rootChild, rootChooser, np, evalFn, C, rng) {
    const st = determinize(rootState, rng);
    PRSim.azApply(st, rootAct);
    const path = []; // {node, action, chooser}
    let node = rootChild;
    let leafVal = null; // (chooser) => value
    let guard = 0;
    while (guard++ < 600) {
      const dec = PRSim.azDecision(st);
      if (!dec) { leafVal = (ch) => PRSim.reward(st, ch); break; } // 终局
      if (!node.expanded) {
        const ev = evalFn(st, dec);
        const probs = _softmaxMasked(ev.policyLogits, legalMask(dec));
        node.expanded = true;
        node.P = {}; node.eN = {}; node.eW = {}; node.children = {}; node.N = 0;
        for (const a of dec.actions) { node.P[a] = probs[toGlobal(dec.type, a)]; node.eN[a] = 0; node.eW[a] = 0; }
        const lc = dec.chooser, V = ev.value;
        leafVal = (ch) => V[(((ch - lc) % np) + np) % np]; // value 向量按座次偏移取该玩家视角
        break;
      }
      // PUCT 选边 —— 用 live dec.actions(当前确定化下的合法动作), 而非缓存。
      // ISMCTS 关键: 不同确定化下 settle 等动作内容会变, 必须用当前状态的合法动作, 否则 azApply 收到非法动作崩溃/串味。
      let bestA = dec.actions[0], bestU = -Infinity;
      const sN = node.N;
      for (const a of dec.actions) {
        const P = (node.P[a] != null) ? node.P[a] : (1 / dec.actions.length);
        const eN = node.eN[a] || 0, eW = node.eW[a] || 0;
        const q = eN > 0 ? eW / eN : 0;
        const u = q + C * P * Math.sqrt(sN + 1) / (1 + eN);
        if (u > bestU) { bestU = u; bestA = a; }
      }
      if (node.eN[bestA] == null) { node.eN[bestA] = 0; node.eW[bestA] = 0; if (node.P[bestA] == null) node.P[bestA] = 1 / dec.actions.length; }
      path.push({ node, action: bestA, chooser: dec.chooser });
      PRSim.azApply(st, bestA);
      if (!node.children[bestA]) node.children[bestA] = { expanded: false };
      node = node.children[bestA];
    }
    for (const s of path) { s.node.eN[s.action]++; s.node.eW[s.action] += leafVal(s.chooser); s.node.N++; }
    return leafVal(rootChooser);
  }

  // Gumbel 根选择 + sequential halving。返回 { action, policyTarget:[69], rootValue, visits }
  function azGumbelSearch(rootState, opts) {
    opts = opts || {};
    const evalFn = opts.evalFn || ((s, d) => { const out = azForward(AZ_NET, azFeatures(s, d)); return { policyLogits: out.policyLogits, value: out.value }; });
    const numSims = opts.numSims || 64;
    const mCand = opts.numConsidered || 16;
    const C = opts.C || 1.25;
    const cVisit = opts.cVisit || 50, cScale = opts.cScale || 0.1;
    const rng = opts.rng || rootState.rnd || Math.random;
    const np = rootState.numPlayers;
    // value 向量固定 4 维(AZ_VALUE/模型 value 头=4)。np>4 时 leafVal 会取到 V[4]=undefined → NaN 回传。
    // 显式拒绝(5 人 AZ 需训练/导出 5 维 value 才支持)。
    if (np > 4) throw new Error(`azGumbelSearch 不支持 ${np} 人(value 向量仅 4 维); 5 人 AZ 需 5 维 value 模型`);

    const probe = PRSim.clone(rootState);
    const rootDec = PRSim.azDecision(probe);
    if (!rootDec) return null;
    const rootChooser = rootDec.chooser;
    const legal = rootDec.actions.slice();
    const target = new Float32Array(AZ_ACTION_DIM);
    if (legal.length === 1) { target[toGlobal(rootDec.type, legal[0])] = 1; return { action: legal[0], policyTarget: target, rootValue: 0, visits: { [legal[0]]: 1 } }; }

    const rootEv = evalFn(rootState, rootDec);
    const rootProbs = _softmaxMasked(rootEv.policyLogits, legalMask(rootDec));
    const rootValSelf = rootEv.value[0]; // 当前决策者视角的 NN value
    const logit = (a) => rootEv.policyLogits[toGlobal(rootDec.type, a)];
    const gum = {}; for (const a of legal) gum[a] = _gumbel(rng);

    // Gumbel top-m 候选
    let surv = legal.slice().sort((a, b) => (logit(b) + gum[b]) - (logit(a) + gum[a])).slice(0, Math.min(mCand, legal.length));
    const rN = {}, rW = {}, rootChildren = {};
    for (const a of legal) { rN[a] = 0; rW[a] = 0; }
    for (const a of surv) rootChildren[a] = { expanded: false };

    const rounds = Math.max(1, Math.ceil(Math.log2(surv.length)));
    let simsLeft = numSims;
    for (let r = 0; r < rounds && simsLeft > 0; r++) {
      const perCand = Math.max(1, Math.floor(numSims / (rounds * surv.length)));
      for (const a of surv) {
        for (let s = 0; s < perCand && simsLeft > 0; s++) {
          simsLeft--;
          const v = _simulate(rootState, a, rootChildren[a], rootChooser, np, evalFn, C, rng);
          rN[a]++; rW[a] += v;
        }
      }
      // sigma 变换后按 (logit + gumbel + sigma(qhat)) 砍掉一半
      let maxN = 0; for (const a of surv) if (rN[a] > maxN) maxN = rN[a];
      const sigma = (q) => (cVisit + maxN) * cScale * q;
      const score = (a) => logit(a) + gum[a] + sigma(rN[a] > 0 ? rW[a] / rN[a] : rootValSelf);
      surv = surv.sort((a, b) => score(b) - score(a)).slice(0, Math.max(1, Math.ceil(surv.length / 2)));
    }
    // 最终动作 = 幸存者(按 score 排序后第一)
    let maxN = 0; for (const a of legal) if (rN[a] > maxN) maxN = rN[a];
    const sigma = (q) => (cVisit + maxN) * cScale * q;
    const best = surv[0];

    // 训练用改进策略 pi' = softmax over legal of (logit + sigma(completedQ))
    const completedQ = (a) => rN[a] > 0 ? rW[a] / rN[a] : rootValSelf;
    let mx = -Infinity; for (const a of legal) { const z = logit(a) + sigma(completedQ(a)); if (z > mx) mx = z; }
    let sum = 0; const ez = {};
    for (const a of legal) { ez[a] = Math.exp(logit(a) + sigma(completedQ(a)) - mx); sum += ez[a]; }
    for (const a of legal) target[toGlobal(rootDec.type, a)] = ez[a] / sum;
    const visits = {}; for (const a of legal) visits[a] = rN[a];
    return { action: best, policyTarget: target, rootValue: rootValSelf, visits };
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
    azGumbelSearch,
    AZ_ACTION_DIM,
    AZ_FEATURE_DIM,
    AZ_DEC_TYPES: DEC_TYPES,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { toGlobal, toLocal, legalMask, azFeatures, azForward, azLoadNetwork, azIsLoaded, azEval, azGumbelSearch, AZ_ACTION_DIM, AZ_FEATURE_DIM, DEC_TYPES };
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
