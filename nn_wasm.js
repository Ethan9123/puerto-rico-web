// ============================================================
// nn_wasm.js — sim_nn.js 前向传播的 WebAssembly(SIMD) 加速后端
// ============================================================
// ★ 本文件由 tools/build_wasm.sh 从 nn_wasm/loader.js + nn_wasm/src/lib.rs 生成，请勿手改 ★
//   重新构建：tools/build_wasm.sh（需要 rustup target wasm32-unknown-unknown）
//
// 内嵌两份 wasm 模块（base64）：simd128 版优先，不支持 SIMD 的运行时退回标量版，
// 两者都失败（或没有 WebAssembly）时 ready() 返回 false → sim_nn.js 继续用纯 JS 前向。
// 适用环境：浏览器主线程 window、Web Worker self、Node vm 沙盒 globalThis（tools/_sandbox.js）。
//
// API（root.PRNNWasm）：
//   available : boolean   实例化成功后为 true
//   simd      : boolean   当前实例是否为 simd128 版
//   backend   : 'wasm-simd' | 'wasm' | 'js'
//   ready()   : Promise<boolean>   只实例化一次；缺 WebAssembly 或两个模块都失败 → false
//   createForward(net) → forward(features) → { policyLogits, value, valueVec }
//       语义与 sim_nn.js 的 _forward 完全一致（含 trunk.5 截取给两个 head；softmax 由 sim_nn.js 做）。
//       权重在创建时一次性拷入 wasm 内存(f32)，之后每次前向只拷 features 并逐层调 dense()。
//
// 构建信息：simd 4820 B (sha256 26020de8ec26), scalar 1907 B (sha256 7a0c84da911e)
(function (root) {
  "use strict";

  const SIMD_B64 = "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";
  const SCALAR_B64 = "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";

  // base64 → Uint8Array（优先 atob；缺失时用内置解码，保证 Node 旧版本/奇异环境也能跑）
  function decodeB64(s) {
    if (typeof atob === "function") {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    const T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const lut = new Int16Array(256).fill(-1);
    for (let i = 0; i < 64; i++) lut[T.charCodeAt(i)] = i;
    const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
    const out = new Uint8Array((clean.length * 3) >> 2);
    let acc = 0, bits = 0, n = 0;
    for (let i = 0; i < clean.length; i++) {
      acc = (acc << 6) | lut[clean.charCodeAt(i)]; bits += 6;
      if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 0xff; }
    }
    return out.subarray(0, n);
  }

  const api = {
    available: false,
    simd: false,
    backend: "js",
    _exports: null,     // 实例导出（dense/activate/memory）
    _error: null,       // 最近一次实例化失败原因（调试用）
  };

  let readyPromise = null;

  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      if (typeof WebAssembly === "undefined" || typeof WebAssembly.instantiate !== "function") {
        api._error = "WebAssembly unavailable";
        return false;
      }
      const candidates = [["simd", SIMD_B64, true], ["scalar", SCALAR_B64, false]];
      for (const [name, b64, isSimd] of candidates) {
        try {
          const bytes = decodeB64(b64);
          if (typeof WebAssembly.validate === "function" && !WebAssembly.validate(bytes)) {
            api._error = name + ": validate() false (feature unsupported)";
            continue;
          }
          const res = await WebAssembly.instantiate(bytes, {});
          const inst = res && res.instance ? res.instance : res;
          const ex = inst && inst.exports;
          if (!ex || typeof ex.dense !== "function" || typeof ex.activate !== "function" || !ex.memory) {
            api._error = name + ": missing exports"; continue;
          }
          if (typeof ex.abi_version === "function" && ex.abi_version() !== 1) {
            api._error = name + ": abi_version mismatch"; continue;
          }
          api._exports = ex;
          api.simd = isSimd;
          api.available = true;
          api.backend = isSimd ? "wasm-simd" : "wasm";
          api._error = null;
          return true;
        } catch (e) {
          api._error = name + ": " + (e && e.message ? e.message : String(e));
        }
      }
      return false;
    })();
    return readyPromise;
  }

  // 把 net.layers 编译成 wasm 内存上的固定「程序」，返回 forward(features)。
  // 逐层符号执行与 sim_nn.js _forward 相同的控制流（policy/value head 分叉、trunk.5 截取、
  // tanh 后 continue），把 buffer 分配好；再把「linear → 紧随其后的 relu/tanh」融合成一次
  // dense(act) 调用。JS 版每层都新建数组，这里除 trunkOut 外均原地激活（trunkOut 被两个
  // head 共享，若再被激活会拷贝到新 buffer，保持与 JS 语义一致）。
  function createForward(net) {
    if (!api.available || !api._exports) throw new Error("PRNNWasm.createForward: call ready() first");
    if (!net || !net.feature_dim || !Array.isArray(net.layers)) throw new Error("PRNNWasm.createForward: invalid net");
    const ex = api._exports;
    const memory = ex.memory;

    // ---- 线性分配器（16 字节对齐，单位：float 下标）----
    let floatCount = 0;
    function allocFloats(n) { const off = floatCount; floatCount += (n + 3) & ~3; return off; }

    const featDim = net.feature_dim | 0;
    const inOff = allocFloats(featDim + 8); // 末尾留零填充
    const bufs = []; // { off, n }
    function newBuf(n) { const b = { off: allocFloats(n + 8), n }; bufs.push(b); return b; }
    const IN = { off: inOff, n: featDim, isInput: true };

    // 权重区
    const weights = []; // { L, wOff, bOff, inDim, outDim }
    function getDims(L) {
      if (L._Wf) return { inDim: L._inDim, outDim: L._outDim };
      if (L.W) return { inDim: L.W[0].length, outDim: L.W.length };
      throw new Error("PRNNWasm: linear layer without weights: " + (L.name || "?"));
    }
    function weightsOf(L) {
      const d = getDims(L);
      const rec = { L, inDim: d.inDim, outDim: d.outDim, wOff: allocFloats(d.inDim * d.outDim), bOff: allocFloats(d.outDim) };
      weights.push(rec);
      return rec;
    }

    // ---- 符号执行 ----
    const ops = []; // {kind:'dense', w, src, dst, act} | {kind:'act', src, dst, act}
    let cur = IN, trunkOut = null, policyBuf = null, valueBuf = null;
    function dense(src, L) {
      const w = weightsOf(L);
      if (src.n !== w.inDim) throw new Error(`PRNNWasm: dim mismatch at ${L.name || "?"}: ${src.n} vs ${w.inDim}`);
      const dst = newBuf(w.outDim);
      ops.push({ kind: "dense", w, src, dst, act: 0 });
      return dst;
    }
    function act(src, code) {
      const dst = (src === trunkOut) ? newBuf(src.n) : src;
      ops.push({ kind: "act", src, dst, act: code });
      return dst;
    }
    for (const L of net.layers) {
      if (L.head === "policy") { policyBuf = dense(trunkOut || cur, L); continue; }
      if (L.head === "value") { cur = dense(trunkOut || cur, L); continue; }
      if (L.type === "linear") {
        cur = dense(cur, L);
      } else if (L.type === "relu") {
        cur = act(cur, 1);
      } else if (L.type === "tanh") {
        cur = act(cur, 2);
        valueBuf = cur;
        continue;
      }
      if (L.type === "relu" && L.name && L.name.startsWith("trunk.5")) trunkOut = cur;
    }
    if (!policyBuf && !net.value_only) throw new Error("network has no policy head");
    if (!valueBuf) throw new Error("network has no value head");

    // ---- 融合 dense + 紧随的原地激活 ----
    const prog = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i], nx = ops[i + 1];
      if (op.kind === "dense" && nx && nx.kind === "act" && nx.src === op.dst && nx.dst === op.dst) {
        prog.push({ kind: "dense", w: op.w, src: op.src, dst: op.dst, act: nx.act });
        i++;
      } else prog.push(op);
    }

    // ---- 分配 wasm 内存并拷入权重 ----
    const bytes = floatCount * 4;
    const pages = Math.ceil(bytes / 65536) + 1;
    const oldPages = memory.grow(pages);
    if (oldPages < 0) throw new Error("PRNNWasm: memory.grow failed");
    const base = oldPages * 65536; // 字节偏移，页对齐
    let cachedBuffer = null, F = null;
    function view() {
      if (memory.buffer !== cachedBuffer) { cachedBuffer = memory.buffer; F = new Float32Array(cachedBuffer); }
      return F;
    }
    const baseF = base >> 2;
    {
      const V = view();
      for (const w of weights) {
        const L = w.L;
        if (L._Wf) V.set(L._Wf, baseF + w.wOff);
        else { let k = baseF + w.wOff; for (let i = 0; i < w.outDim; i++) { const Wi = L.W[i]; for (let j = 0; j < w.inDim; j++) V[k++] = Wi[j]; } }
        V.set(L._bf ? L._bf : L.b, baseF + w.bOff);
      }
    }

    // 预先算好每条指令的字节地址
    const P = prog.map(op => op.kind === "dense"
      ? { d: 1, x: base + op.src.off * 4, w: base + op.w.wOff * 4, b: base + op.w.bOff * 4, o: base + op.dst.off * 4, n: op.w.inDim, m: op.w.outDim, act: op.act }
      : { d: 0, s: base + op.src.off * 4, o: base + op.dst.off * 4, n: op.src.n, act: op.act });
    // value_only 网无 policy 段：pF=-1 → forward 返回 policyLogits=null
    const inF = baseF + inOff, pF = policyBuf ? baseF + policyBuf.off : -1, pN = policyBuf ? policyBuf.n : 0, vF = baseF + valueBuf.off, vN = valueBuf.n;
    const wasmDense = ex.dense, wasmAct = ex.activate;

    function forward(features) {
      if (features.length !== featDim) {
        throw new Error(`forward: feature dim mismatch ${features.length} vs ${featDim}`);
      }
      const V = view();
      V.set(features, inF);
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        if (q.d) wasmDense(q.x, q.w, q.b, q.o, q.n, q.m, q.act);
        else wasmAct(q.s, q.o, q.n, q.act);
      }
      const policyLogits = pF >= 0 ? V.slice(pF, pF + pN) : null;
      const valueVec = V.slice(vF, vF + vN);
      return { policyLogits, value: valueVec[0], valueVec };
    }
    forward.program = P;
    forward.bytes = bytes;
    return forward;
  }

  api.ready = ready;
  api.createForward = createForward;
  root.PRNNWasm = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this)));
