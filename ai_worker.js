// ============================================================
// ai_worker.js — L4/L5/L6 角色搜索的 Web Worker（classic script）
// ============================================================
// 目的：把 PRSim.ismctsPickRoleIdx（同步、每次决策 5-12s）搬离主线程，UI 不再冻结；
//       主线程 game.js 的 PRAIPool 起 K 个 worker 做 root-parallel：每个 worker 用不同种子
//       独立搜索，回传根统计 {nm, N, Q}，主线程按角色名合并后用 PRSim.selectRootRole 选角。
//       树并行（L6 opt-in，tpinit/tppaths）：树在主线程，worker 只对主线程选好的路径做确定化+重放+叶评估（PRSim.tpEvalPath）。
// 只加载 sim.js / sim_features.js / (nn_wasm.js) / sim_nn.js / (sim_sub.js) —— 绝不加载 game.js（顶层触 DOM）；
// sim*.js 所需的静态表(BUILDINGS 等)由主线程通过 init 消息传入 self._PR_STATIC。
//
// 消息协议（主线程 → worker）：
//   {type:'init', staticData:{BUILDINGS,BLD_BY_ID,GOODS,GOOD_PRICE,ROLE_LIST}, nnUrl?:string|object, knobs?}
//     → 回 {type:'ready', nn:boolean, wasm:boolean}（nn=NN 权重是否加载成功；nnUrl 缺省则不加载 NN）
//   {type:'loadnn', nnUrl?:string|object, vnetUrl?:string|object}   按需加载 NN / 价值网（仅 L6/alpha 需要；主线程池默认 init 不带 nnUrl）
//     → 回 {type:'nnready', nn:boolean, vnet:boolean, wasm:boolean, message?}
//   {type:'pick', id, state, mode:'hard'|'expert'|'alpha', opts:{budgetMs,maxIters,C,truncate,tempSample?,valueW?}, seed, knobs, tables?}
//     → 回 {type:'result', id, idx, stats:[{nm,N,Q}], iters}  或  {type:'error', id, message}
//   {type:'tpinit', id, state, mode:'alpha', opts, seed, knobs, tables}     树并行（第三轮 Stage 3，AI_STRENGTH §18.2 补充 C）：
//     缓存本次决策的根状态 + 一条 rnd=mulberry32(seed) 流 + 重建好的搜索选项；**不回复**（出错也不回，
//     错误在随后每条 tppaths 上报 → 主线程「一条消息一个回复」的记账不被打乱）
//   {type:'tppaths', id, reqs:[{path:[角色名...], pless, N}, ...]}
//     → 回 {type:'tpresult', id, results:[PRSim.tpEvalPath(...) 的返回, ...]}  或  {type:'error', id, message}
//     id 与缓存的决策不符（新决策的 tpinit 已覆盖）→ 回 error；主线程按 id 丢弃过期回复。
//   {type:'subeval', id, state, dec:{type,chooser,actions}, actions, rs, fid, knobs, tables}   （第三轮 Stage 5c：L6 子决策搜索的一块求值）
//     → 回 {type:'result', id, vals}（vals[a][k] = PRSub v(actions[a], rs[k])，与主线程 subEvalBatch 逐位相同）或 {type:'error', id, message}
//     主线程 PRAIPool.subEval 把 (候选 × perm) 网格切给 K 个 worker、按 r 顺序拼回；决策规则（连续减半 + 门）只在主线程跑。
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
  let subErr = "not loaded";   // sim_sub.js 的加载错误（null = 已加载）

  function loadEngine() {
    if (loaded) return;
    importScripts("sim.js", "sim_features.js");
    try { importScripts("nn_wasm.js"); } catch (e) { /* 可选加速器缺失 → 纯 JS 前向 */ }
    importScripts("sim_nn.js");
    // 子决策搜索核心（Stage 5c）：可选——加载失败只让 subeval 回错（主线程据此回退启发式），
    // 绝不连累角色搜索（worker init 失败 = 整个池失效、L4-L6 选角全部回退同步）。
    try { importScripts("sim_sub.js"); subErr = null; } catch (e) { subErr = (e && e.message) ? e.message : String(e); }
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
  // Phase 2：独立价值网（叶评估）；主线程在 _l6ValueNet 开启时经 loadnn.vnetUrl 请求加载
  let vnetOk = false, vnetLoading = null;
  async function loadVNet(vnetUrl) {
    if (vnetOk) return { vnet: true };
    if (!vnetLoading) {
      vnetLoading = (async () => {
        try {
          if (typeof self.PRSim.loadValueNet !== "function") throw new Error("sim_nn.js lacks loadValueNet");
          await self.PRSim.loadValueNet(vnetUrl); vnetOk = !!(self.PRSim.valueNetLoaded && self.PRSim.valueNetLoaded()); return { vnet: vnetOk };
        } catch (e) { vnetOk = false; return { vnet: false, message: (e && e.message) ? e.message : String(e) }; }
        finally { vnetLoading = null; }
      })();
    }
    return vnetLoading;
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
    if (!loaded) { self.postMessage({ type: "nnready", nn: false, vnet: false, wasm: false, message: "worker not initialised" }); return; }
    let message;
    if (msg.nnUrl) { const r = await loadNN(msg.nnUrl); if (r.message) message = r.message; }
    if (msg.vnetUrl) { const r = await loadVNet(msg.vnetUrl); if (r.message) message = (message ? message + "; " : "") + r.message; }
    const wasm = !!(self.PRNNWasm && self.PRNNWasm.available);
    self.postMessage({ type: "nnready", nn: nnOk, vnet: vnetOk, wasm, message });
  }

  function handlePick(msg) {
    const id = msg.id;
    try {
      if (!loaded) throw new Error("worker not initialised");
      const PRSim = self.PRSim;
      applyKnobs(msg.knobs);
      syncTables(msg.tables);
      if (msg.mode === "alpha" && !nnOk) throw new Error("NN not loaded in worker");
      if (msg.mode === "alpha" && self._l6ValueNet && !vnetOk) throw new Error("value net not loaded in worker"); // 不静默退化到 rollout
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

  // ---- 树并行（TP）：worker 只持有根状态与随机流，树在主线程 ----
  // 为什么 rnd 必须按决策缓存、跨消息延续：单树一次决策里所有迭代共用 rootState.rnd 一条流；K=1 时本 worker
  // 按到达顺序逐条处理路径 → 与单树逐迭代消耗同一条流（tests/tp_test.js ① 逐位钉住）。每条消息重建流就错了。
  let tp = null;   // { id, st, opts } 或 { id, err }
  function handleTpInit(msg) {
    try {
      if (!loaded) throw new Error("worker not initialised");
      const PRSim = self.PRSim;
      applyKnobs(msg.knobs);
      syncTables(msg.tables);
      if (msg.mode !== "alpha") throw new Error("tree-parallel supports alpha mode only");
      if (!nnOk) throw new Error("NN not loaded in worker");
      if (self._l6ValueNet && !vnetOk) throw new Error("value net not loaded in worker"); // 不静默退化
      if (typeof PRSim.tpEvalPath !== "function") throw new Error("sim.js lacks tpEvalPath");
      const st = msg.state;
      st.rnd = mulberry32((msg.seed >>> 0) || 1);           // 与 handlePick 同式：同一 seed → 与根并行/单树同一条流
      const opts = PRSim.searchOptsForMode(msg.mode, Object.assign({}, msg.opts || {}));
      tp = { id: msg.id, st, opts };
    } catch (e) {
      tp = { id: msg.id, err: (e && e.message) ? e.message : String(e) };
    }
  }
  function handleTpPaths(msg) {
    const id = msg.id;
    try {
      if (!tp || tp.id !== id) throw new Error("tppaths for unknown decision " + id + " (cached " + (tp ? tp.id : "none") + ")");
      if (tp.err) throw new Error(tp.err);
      const reqs = Array.isArray(msg.reqs) ? msg.reqs : [];
      const results = [];
      for (const r of reqs) results.push(self.PRSim.tpEvalPath(tp.st, r, tp.opts));   // 严格按到达顺序：随机流顺序即迭代顺序
      self.postMessage({ type: "tpresult", id, results });
    } catch (e) {
      self.postMessage({ type: "error", id, message: (e && e.message) ? e.message : String(e) });
    }
  }

  function handleSubEval(msg) {
    const id = msg.id;
    try {
      if (!loaded) throw new Error("worker not initialised");
      if (!self.PRSub) throw new Error("sim_sub.js unavailable in worker: " + subErr);
      applyKnobs(msg.knobs);
      syncTables(msg.tables);
      // st 经 structuredClone 到达（rnd 已去掉）；subEvalBatch 自行规范化、核对 dec、按 (decisionSeed, r) 建 perm 流
      const vals = self.PRSub.subEvalBatch(msg.state, msg.dec, msg.actions, msg.rs, { fid: !!msg.fid });
      self.postMessage({ type: "result", id, vals });
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
    } else if (msg.type === "tpinit") {
      handleTpInit(msg);
    } else if (msg.type === "tppaths") {
      handleTpPaths(msg);
    } else if (msg.type === "subeval") {
      handleSubEval(msg);
    }
  };
})(typeof self !== "undefined" ? self : globalThis);
