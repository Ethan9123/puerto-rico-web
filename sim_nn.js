// ============================================================
// sim_nn.js — AlphaZero 网络的 JS 端推理（手写矩阵乘法，无依赖）
// ============================================================
// 设计：
//  - 加载 train/exports/weights-*.json 即用，不依赖 TF.js/ONNX
//  - 给 ISMCTS 提供 P(role) + V(state)；替换 evalLeaf 的截断+线性 value
//  - 单次 forward < 1ms（CPU），可在 MCTS 内大量调用
//
// 加载顺序：game.js → sim.js → sim_features.js → sim_nn.js
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

  function _softmax(arr) {
    let m = -Infinity; for (const v of arr) if (v > m) m = v;
    const e = arr.map(v => Math.exp(v - m));
    let s = 0; for (const v of e) s += v;
    if (s <= 0) return arr.map(() => 1 / arr.length);
    return e.map(v => v / s);
  }

  // 一次 Dense 前向：out = W·in + b（W 形状 [out, in]，row-major）
  function _dense(input, W, b) {
    const outDim = W.length;
    const inDim = W[0].length;
    const out = new Float32Array(outDim);
    for (let i = 0; i < outDim; i++) {
      const Wi = W[i];
      let s = b[i];
      for (let j = 0; j < inDim; j++) s += Wi[j] * input[j];
      out[i] = s;
    }
    return out;
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

  // 一次完整前向，返回 { policy: Float32Array[7], value: number ∈ [-1, 1] }
  function _forward(net, features) {
    if (features.length !== net.feature_dim) {
      throw new Error(`forward: feature dim mismatch ${features.length} vs ${net.feature_dim}`);
    }
    let cur = features;
    let trunkOut = null;            // 走完 trunk 的输出（给 head 用）
    let policyLogits = null, value = null;
    for (const L of net.layers) {
      if (L.head === "policy") {
        policyLogits = _dense(trunkOut || cur, L.W, L.b);
        continue; // 不更新 cur，因为 policy head 是分叉
      }
      if (L.head === "value") {
        cur = _dense(trunkOut || cur, L.W, L.b);
        continue;
      }
      // 普通 trunk 层
      if (L.type === "linear") {
        cur = _dense(cur, L.W, L.b);
      } else if (L.type === "relu") {
        cur = _relu(cur);
      } else if (L.type === "tanh") {
        cur = _tanh(cur);
        // 价值 head 后的 tanh 完结
        value = cur[0];
        continue;
      }
      // 在最后一个 ReLU 之后、head 之前，记录 trunk 输出
      if (L.type === "relu" && L.name && L.name.startsWith("trunk.5")) trunkOut = cur;
    }
    if (!policyLogits) throw new Error("network has no policy head");
    if (value === null) throw new Error("network has no value head");
    return { policy: _softmax(policyLogits), policyLogits, value };
  }

  // 加载网络。url 在浏览器是相对 / 绝对路径；Node 由调用方注入 fetch
  async function loadNetwork(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("loadNetwork: HTTP " + res.status);
    const net = await res.json();
    if (!net.feature_dim || !net.layers || !Array.isArray(net.layers)) {
      throw new Error("loadNetwork: invalid network JSON");
    }
    NET = net;
    console.log(`[sim_nn] loaded ${net.layers.length} layers, feature_dim=${net.feature_dim}, n_roles=${net.n_roles}, val_loss=${(net.val_loss || 0).toFixed(4)}`);
    return net;
  }

  function unloadNetwork() { NET = null; }

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

  function isLoaded() { return NET !== null; }

  Object.assign(PRSim, { loadNetwork, unloadNetwork, networkEval, evalLeafNN, isLoaded });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { loadNetwork, unloadNetwork, networkEval, evalLeafNN, isLoaded, _forward, _softmax };
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
