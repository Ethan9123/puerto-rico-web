// ============================================================
// sim_nn.js — AlphaZero 网络的 JS 端推理（手写矩阵乘法，无依赖）
// ============================================================
// 设计：
//  - 加载 train/exports/weights-*.json 即用，不依赖 TF.js/ONNX
//  - 给 ISMCTS 提供 P(role) + V(state)；替换 evalLeaf 的截断+线性 value
//  - 单次 forward < 1ms（CPU），可在 MCTS 内大量调用
//
// 加载顺序：game.js → sim.js → sim_features.js → (nn_wasm.js, 可选) → sim_nn.js
// 加速：若之前加载了 nn_wasm.js（root.PRNNWasm），loadNetwork 会把前向切到 wasm(SIMD) 内核，
//       约 5-10× 快；root._nnForceJS = true 可强制走纯 JS（对拍/基准用）。PRSim.nnBackend() 查看当前后端。
// 用法：
//   await PRSim.loadNetwork('train/exports/weights-v1.json');
//   const { policy, value } = PRSim.networkEval(state, perspectiveSeat);

(function (root) {
  "use strict";
  if (!root.PRSim || typeof root.PRSim.extractRich !== "function") {
    throw new Error("sim_nn.js: PRSim.extractRich missing; load sim_features.js first");
  }
  const PRSim = root.PRSim;

  // 当前加载的网络（layers 顺序执行）
  let NET = null;
  // Phase 2：独立的小价值网（value_only，无 policy 头）。加载后 evalLeafVecNN 优先用它做叶评估；
  // 目标尺度 = sim.js reward()（0.8·胜份 + 0.2·分差项），与完整 rollout 同尺度，可与 rolloutFrac 混合。
  let VNET = null;

  function _softmax(arr) {
    let m = -Infinity; for (const v of arr) if (v > m) m = v;
    const e = arr.map(v => Math.exp(v - m));
    let s = 0; for (const v of e) s += v;
    if (s <= 0) return arr.map(() => 1 / arr.length);
    return e.map(v => v / s);
  }

  // 一次 Dense 前向：out = W·in + b（W 形状 [out, in]，row-major）
  // 性能: 载入时把嵌套 JS 数组平铺成 Float64Array(_prep)——数值与原嵌套数组
  // 实现逐位一致(同为 f64 乘加、同序)，但缓存局部性好得多。
  function _dense(input, L) {
    const outDim = L._outDim, inDim = L._inDim;
    const Wf = L._Wf, bf = L._bf;
    const out = new Float32Array(outDim);
    for (let i = 0; i < outDim; i++) {
      let s = bf[i];
      const base = i * inDim;
      for (let j = 0; j < inDim; j++) s += Wf[base + j] * input[j];
      out[i] = s;
    }
    return out;
  }

  // 载入时预处理 linear 层 → 平铺权重；之后释放嵌套数组(单进程省 ~100MB+, 浏览器同收益)
  function _prep(net) {
    for (const L of net.layers) {
      if (!L.W) continue;
      const outDim = L.W.length, inDim = L.W[0].length;
      const Wf = new Float64Array(outDim * inDim);
      for (let i = 0; i < outDim; i++) { const Wi = L.W[i]; const base = i * inDim; for (let j = 0; j < inDim; j++) Wf[base + j] = Wi[j]; }
      L._Wf = Wf; L._bf = new Float64Array(L.b); L._outDim = outDim; L._inDim = inDim;
      L.W = null; L.b = null; // 推理只用 _Wf/_bf
    }
  }

  function _relu(input) {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] > 0 ? input[i] : 0;
    return out;
  }

  function _tanh(input) {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = Math.tanh(input[i]);
    return out;
  }

  // 一次完整前向，返回 { policy: Float32Array[7], value: number ∈ [-1, 1], valueVec }
  // valueVec: 价值向量头的完整输出(4 维, perspective-ordered: [k]=视角玩家顺时针第 k 位的价值)。
  // 旧标量网络 valueVec 长度为 1。value === valueVec[0] 不变。
  function _forward(net, features) {
    // WebAssembly 后端（nn_wasm.js, 由 loadNetwork 挂到 net._wasmForward）；root._nnForceJS=true 强制走 JS
    if (net._wasmForward && !root._nnForceJS) {
      const r = net._wasmForward(features);
      return { policy: r.policyLogits ? _softmax(r.policyLogits) : null, policyLogits: r.policyLogits || null, value: r.value, valueVec: r.valueVec };
    }
    if (features.length !== net.feature_dim) {
      throw new Error(`forward: feature dim mismatch ${features.length} vs ${net.feature_dim}`);
    }
    let cur = features;
    let trunkOut = null;            // 走完 trunk 的输出（给 head 用）
    let policyLogits = null, value = null, valueVec = null;
    for (const L of net.layers) {
      if (L.head === "policy") {
        policyLogits = _dense(trunkOut || cur, L);
        continue; // 不更新 cur，因为 policy head 是分叉
      }
      if (L.head === "value") {
        cur = _dense(trunkOut || cur, L);
        continue;
      }
      // 普通 trunk 层
      if (L.type === "linear") {
        cur = _dense(cur, L);
      } else if (L.type === "relu") {
        cur = _relu(cur);
      } else if (L.type === "tanh") {
        cur = _tanh(cur);
        // 价值 head 后的 tanh 完结
        valueVec = cur;
        value = cur[0];
        continue;
      }
      // 在最后一个 ReLU 之后、head 之前，记录 trunk 输出
      if (L.type === "relu" && L.name && L.name.startsWith("trunk.5")) trunkOut = cur;
    }
    if (!policyLogits && !net.value_only) throw new Error("network has no policy head");
    if (value === null) throw new Error("network has no value head");
    return { policy: policyLogits ? _softmax(policyLogits) : null, policyLogits, value, valueVec };
  }

  // 加载网络。src 可以是：
  //   (1) 已内嵌的权重对象 —— 离线双击 index.html(file://) 时用，规避 fetch 本地 json 被 CORS 拦截；
  //   (2) url 字符串 —— 浏览器相对/绝对路径；Node 由调用方注入 fetch。
  // 读取 + 预处理 + 可选 wasm 前向（loadNetwork / loadValueNet 共用）
  async function _loadNet(src, label) {
    let net;
    if (src && typeof src === "object") {
      net = src;
    } else {
      const res = await fetch(src);
      if (!res.ok) throw new Error(label + ": HTTP " + res.status);
      net = await res.json();
    }
    if (!net.feature_dim || !net.layers || !Array.isArray(net.layers)) {
      throw new Error(label + ": invalid network JSON");
    }
    _prep(net);
    // 可选 wasm(SIMD) 后端：nn_wasm.js 在本文件之前加载则尝试启用；任何失败都静默回退纯 JS
    net._wasmForward = null;
    if (root.PRNNWasm && typeof root.PRNNWasm.ready === "function") {
      try {
        const ok = await root.PRNNWasm.ready();
        if (ok) net._wasmForward = root.PRNNWasm.createForward(net);
      } catch (e) {
        net._wasmForward = null;
        console.warn("[sim_nn] wasm backend unavailable, using JS forward:", e && e.message ? e.message : e);
      }
    }
    return net;
  }
  function _backendOf(net) {
    if (root._nnForceJS) return "js";
    if (net && net._wasmForward && root.PRNNWasm && root.PRNNWasm.available) return root.PRNNWasm.simd ? "wasm-simd" : "wasm";
    return "js";
  }

  async function loadNetwork(src) {
    const net = await _loadNet(src, "loadNetwork");
    NET = net;
    console.log(`[sim_nn] loaded ${net.layers.length} layers, feature_dim=${net.feature_dim}, n_roles=${net.n_roles}, val_loss=${(net.val_loss || 0).toFixed(4)}, backend=${nnBackend()}`);
    return net;
  }

  function unloadNetwork() { NET = null; }

  // Phase 2：加载独立价值网（value_only JSON，见 train/train_value_np.py 导出）。
  // src 同 loadNetwork（对象或 URL）。加载后 evalLeafVecNN 用它；不影响 networkEval / policy 先验。
  async function loadValueNet(src) {
    const net = await _loadNet(src, "loadValueNet");
    if (!net.value_only) console.warn("[sim_nn] loadValueNet: network is not marked value_only; using its value head");
    VNET = net;
    console.log(`[sim_nn] value net loaded: ${net.layers.length} layers, arch=${net.arch || "?"}, val_mse=${net.val_mse != null ? Number(net.val_mse).toFixed(5) : "?"}, backend=${_backendOf(net)}`);
    return net;
  }
  function unloadValueNet() { VNET = null; }
  function valueNetLoaded() { return VNET !== null; }
  function valueNetBackend() { return _backendOf(VNET); }

  // 公开评估：返回 {policy: [7], value: scalar}
  function networkEval(state, perspectiveSeat) {
    if (!NET) return null;
    const f = PRSim.extractRich(state, perspectiveSeat);
    return _forward(NET, f);
  }

  // ISMCTS 用：返回从 perspective 视角的「[-1,1] 奖励」函数
  // 替代 sim.js 内的 evalLeaf 的截断+线性 value
  function evalLeafNN(state, perspectiveSeat) {
    const out = networkEval(state, perspectiveSeat);
    if (!out) return 0;
    return out.value;
  }

  // ISMCTS 用(向量版): 一次前向输出全部 4 个视角的价值 → 整条回传路径共享。
  // 原 evalLeafNN 在回传时对路径上每个节点(不同视角)各做一次完整前向(~6-12 次/迭代),
  // 本函数把它压到 1 次。代价: 视角玩家以外的价值来自辅助头 vv[1..3](同目标联合训练,
  // 精度略低于各自视角的 vv[0])。仅支持 4 人局(vv 固定 4 维); 其余人数返回 null,
  // 调用方应回退 evalLeafNN。
  // Phase 2：若已加载独立价值网(VNET)则优先用它；否则退回大网的价值头（旧行为）。
  function evalLeafVecNN(state) {
    const net = VNET || NET;
    if (!net) return null;
    const N = state.numPlayers;
    if (N !== 4) return null;
    const out = _forward(net, PRSim.extractRich(state, 0)); // 视角=座位0 → valueVec[k] 即玩家 k 的价值
    if (!out || !out.valueVec || out.valueVec.length < N) return null;
    const vec = out.valueVec;
    return (persp) => {
      const v = vec[persp];
      return (typeof v === "number" && isFinite(v)) ? Math.max(-1, Math.min(1, v)) : 0;
    };
  }

  function isLoaded() { return NET !== null; }

  // 当前网络实际使用的前向后端：'wasm-simd' | 'wasm' | 'js'（未加载网络或 _nnForceJS 时为 'js'）
  function nnBackend() { return _backendOf(NET); }

  Object.assign(PRSim, { loadNetwork, unloadNetwork, networkEval, evalLeafNN, evalLeafVecNN, isLoaded, nnBackend,
    loadValueNet, unloadValueNet, valueNetLoaded, valueNetBackend });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { loadNetwork, unloadNetwork, networkEval, evalLeafNN, evalLeafVecNN, isLoaded, nnBackend,
      loadValueNet, unloadValueNet, valueNetLoaded, valueNetBackend, _forward, _softmax };
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
