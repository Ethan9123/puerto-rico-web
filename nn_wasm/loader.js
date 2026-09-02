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
// 构建信息：__BUILD_INFO__
(function (root) {
  "use strict";

  const SIMD_B64 = "__SIMD_B64__";
  const SCALAR_B64 = "__SCALAR_B64__";

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
