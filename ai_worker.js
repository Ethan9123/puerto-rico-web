// ============================================================
// ai_worker.js — L4/L5/L6 角色搜索的 Web Worker（classic script）
// ============================================================
// 目的：把 PRSim.ismctsPickRoleIdx（同步、每次决策 5-12s）搬离主线程，UI 不再冻结；
//       主线程 game.js 的 PRAIPool 起 K 个 worker 做 root-parallel：每个 worker 用不同种子
//       独立搜索，回传根统计 {nm, N, Q}，主线程按角色名合并后用 PRSim.selectRootRole 选角。
// 只加载 sim.js / sim_features.js / (nn_wasm.js) / sim_nn.js —— 绝不加载 game.js（顶层触 DOM）；
// sim*.js 所需的静态表(BUILDINGS 等)由主线程通过 init 消息传入 self._PR_STATIC。
//
// 消息协议（主线程 → worker）：
//   {type:'init', staticData:{BUILDINGS,BLD_BY_ID,GOODS,GOOD_PRICE,ROLE_LIST}, nnUrl?:string|object, knobs?}
//     → 回 {type:'ready', nn:boolean, wasm:boolean}（nn=NN 权重是否加载成功；nnUrl 缺省则不加载 NN）
//   {type:'loadnn', nnUrl:string|object}   按需加载 NN（仅 L6/alpha 需要；主线程池默认 init 不带 nnUrl）
//     → 回 {type:'nnready', nn:boolean, wasm:boolean, message?}
//   {type:'pick', id, state, mode:'hard'|'expert'|'alpha', opts:{budgetMs,maxIters,C,truncate,tempSample?,valueW?}, seed, knobs, tables?}
//     → 回 {type:'result', id, idx, stats:[{nm,N,Q}], iters}  或  {type:'error', id, message}
//   knobs: {_mctsC,_mctsEps,_captainDeny,_alphaC,...} 原样赋到 self（sim.js 通过 root._mctsC 等读取）
//   tables: {ids:[本局在场建筑 id 顺序], costs:{id:cost}} —— 主线程 Game 构造/轮抽/平衡模式会就地改 BUILDINGS 与
//           BLD_BY_ID[*].cost；worker 收到后就地同步 self._PR_STATIC（sim.js 的 BUILDINGS_/BLD 绑定的是同一对象）。
// 主线程会丢弃 id 不等于当前请求的回复（过期回复永不生效）。
(function (self) {
  "use strict";
  // sim.js 里 rankCaptain 读 window._captainDeny（带 typeof window 守卫）；worker 无 window，
  // 令 window === self 使该旋钮在 worker 内同样生效。
  if (typeof self.window === "undefined") self.window = self;

  // 与 tools/eval_paired_worker.js 相同的 mulberry32：每个 worker 用不同种子 → 搜索路径互异
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function applyKnobs(knobs) {
    if (!knobs || typeof knobs !== "object") return;
    for (const k of Object.keys(knobs)) self[k] = knobs[k];
  }

  let loaded = false;
  let nnOk = false;

  function loadEngine() {
    if (loaded) return;
    importScripts("sim.js", "sim_features.js");
    try { importScripts("nn_wasm.js"); } catch (e) { /* 可选加速器缺失 → 纯 JS 前向 */ }
    importScripts("sim_nn.js");
    loaded = true;
  }

  // 就地同步本局在场建筑表 / 造价（镜像 game.js Game 构造(BUILDINGS.length=0 后重推)、runDraft 的 splice、
  // 以及平衡模式 BLD_BY_ID[15/16].cost）。必须就地改：sim.js 的 BUILDINGS_/BLD 是加载时绑定的同一对象。
  function syncTables(t) {
    const S = self._PR_STATIC;
    if (!t || !S) return;
    if (t.costs) for (const id in t.costs) { const b = S.BLD_BY_ID[id]; if (b && typeof t.costs[id] === "number") b.cost = t.costs[id]; }
    if (Array.isArray(t.ids)) {
      S.BUILDINGS.length = 0;
      for (const id of t.ids) { const b = S.BLD_BY_ID[id]; if (b) S.BUILDINGS.push(b); }
    }
  }

  let nnLoading = null;
  async function loadNN(nnUrl) {
    if (nnOk) return { nn: true };
    if (!nnLoading) {
      nnLoading = (async () => {
        try { await self.PRSim.loadNetwork(nnUrl); nnOk = !!(self.PRSim.isLoaded && self.PRSim.isLoaded()); return { nn: nnOk }; }
        catch (e) { nnOk = false; return { nn: false, message: (e && e.message) ? e.message : String(e) }; }
        finally { nnLoading = null; }
      })();
    }
    return nnLoading;
  }

  async function handleInit(msg) {
    self._PR_STATIC = msg.staticData;
    applyKnobs(msg.knobs);
    loadEngine();
    nnOk = false;
    if (msg.nnUrl) await loadNN(msg.nnUrl); // 可选：init 即带权重（主线程池默认不带，改为 loadnn 按需加载）
    const wasm = !!(self.PRNNWasm && self.PRNNWasm.available);
    self.postMessage({ type: "ready", nn: nnOk, wasm });
  }

  async function handleLoadNN(msg) {
    if (!loaded) { self.postMessage({ type: "nnready", nn: false, wasm: false, message: "worker not initialised" }); return; }
    const r = await loadNN(msg.nnUrl);
    const wasm = !!(self.PRNNWasm && self.PRNNWasm.available);
    self.postMessage({ type: "nnready", nn: !!r.nn, wasm, message: r.message });
  }

  function handlePick(msg) {
    const id = msg.id;
    try {
      if (!loaded) throw new Error("worker not initialised");
      const PRSim = self.PRSim;
      applyKnobs(msg.knobs);
      syncTables(msg.tables);
      if (msg.mode === "alpha" && !nnOk) throw new Error("NN not loaded in worker");
      const st = msg.state;
      st.rnd = mulberry32((msg.seed >>> 0) || 1); // 各 worker 独立种子 → root-parallel 探索多样化
      const base = Object.assign({}, msg.opts || {}, { returnStats: true });
      const opts = PRSim.searchOptsForMode(msg.mode, base); // 与 game.js 同款函数型选项重建
      const r = PRSim.ismctsPickRoleIdx(st, opts);
      self.postMessage({ type: "result", id, idx: r.idx, stats: r.stats, iters: r.iters });
    } catch (e) {
      self.postMessage({ type: "error", id, message: (e && e.message) ? e.message : String(e) });
    }
  }

  self.onmessage = function (ev) {
    const msg = ev && ev.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "init") {
      handleInit(msg).catch(e => self.postMessage({ type: "error", id: null, message: (e && e.message) ? e.message : String(e) }));
    } else if (msg.type === "loadnn") {
      handleLoadNN(msg).catch(e => self.postMessage({ type: "nnready", nn: false, wasm: false, message: (e && e.message) ? e.message : String(e) }));
    } else if (msg.type === "pick") {
      handlePick(msg);
    }
  };
})(typeof self !== "undefined" ? self : globalThis);
