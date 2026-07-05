// ============================================================
// trace.js — 真人 vs AI 对局日志记录器（exploit 数据采集）
// ============================================================
// 目的：把每一局（尤其有真人参与的局）的「决策点 → 选择 → 局面快照 → 终局结果」
// 结构化记录下来，用于：
//   1) 分析真人在哪些局面、用什么招打赢了 AI（找漏洞）；
//   2) 当作模仿学习 / 最佳回应（exploiter）训练的标注数据。
// 全部存浏览器 localStorage，不联网、不上传。控制台可用：
//   PRTrace.stats()    查看累计真人胜率等汇总
//   PRTrace.export()   下载全部对局 JSON（喂给训练）
//   PRTrace.clear()    清空日志
//   PRTrace.last()     看最近一局的真人决策点
//
// 加载顺序：在 index.html 中 game.js 之后（recordPick 调用 buildSimState）。
(function (root) {
  "use strict";
  const LS_KEY = "pr_trace_games_v1";
  const MAX_GAMES = 150;          // 滚动上限，避免 localStorage 撑爆（每局含若干快照）
  let cur = null;                 // 当前进行中的对局

  // ---- 训练数据采集配置 ----------------------------------------------------
  // 把「真人参与」的对局转成与现有训练管线一致的 JSONL（{f,a,v,vv,n}），
  // 并（可选）自动 POST 到后端 /collect，便于在 /dump 一次性取回喂 train/。
  // 默认开启上传：本项目部署方明确希望集中收集真实对局数据用于分析/训练。
  // 隐私：上传「真人参与」的对局（胜负都收，value 按真实终局结果标注）；仅含训练用的
  //       局面特征/动作/终局结果 + 一个匿名随机 id(anonId，纯本地生成、无 PII，仅用于分析胜率是否
  //       集中在少数玩家)，不含昵称/IP/设备信息（CF 边缘会看到 IP，但后端不存）。
  // 端用户可随时退出：URL 加 ?collect=0（会被记住），或控制台 PRTrace.config.upload=false。
  const CFG_KEY = "pr_trace_cfg_v1";
  const VVDIM = 4;                 // value 向量维度，对齐 train/load_data.py
  const SCHEMA_VER = 2;            // v2: 增 anonId + 人类子决策(build) az-format 样本({k:"sub",t,...})

  // 匿名玩家标识：稳定随机 id（仅本浏览器 localStorage，不含任何 PII），用于分析真人胜率是否
  // 集中在少数"学穿"玩家。生成一次后固定。
  const ANON_KEY = "pr_anon_id_v1";
  function _anonId() {
    try {
      let id = root.localStorage.getItem(ANON_KEY);
      if (!id) { id = "a" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); root.localStorage.setItem(ANON_KEY, id); }
      return id;
    } catch (e) { return null; }
  }
  const config = {
    upload: true,                 // 真人对局结束后自动上传到 endpoint
    endpoint: "/collect",         // 后端收集端点（与站点同源）
    valueMode: "margin",          // margin | rank | vsbest（口径对齐 selfplay_dump.js）
    uploadOnlyWins: false,        // false=胜负局都收（数据量大、训练信号更全）；true=仅真人胜局
  };
  (function _applyCfg() {
    try { Object.assign(config, JSON.parse(root.localStorage.getItem(CFG_KEY)) || {}); } catch (e) {}
    try {
      const q = new URLSearchParams(root.location.search);
      if (q.has("collect")) {
        config.upload = q.get("collect") !== "0" && q.get("collect") !== "false";
        try { root.localStorage.setItem(CFG_KEY, JSON.stringify({ upload: config.upload })); } catch (e) {}
      }
      if (q.has("endpoint")) config.endpoint = q.get("endpoint");
      if (q.has("valuemode")) config.valueMode = q.get("valuemode");
    } catch (e) {}
  })();

  function _snapshot(G) {
    // 复用现有 buildSimState 拿一份纯数据 sim 状态（可序列化、可回放给 bot 评估）
    try { if (typeof buildSimState === "function") return buildSimState(G); } catch (e) {}
    return null;
  }
  function _load() {
    try { return JSON.parse(root.localStorage.getItem(LS_KEY)) || []; } catch (e) { return []; }
  }
  function _save(arr) {
    try { root.localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(-MAX_GAMES))); return true; }
    catch (e) { if (root.console) console.warn("[PRTrace] localStorage 写入失败（可能超额），建议先 PRTrace.export() 再 PRTrace.clear()"); return false; }
  }

  // 开局：记录配置
  function begin(G) {
    const humanSeat = G.players.findIndex(p => p.isHuman);
    let net = "deploy"; // 标记本局对手宗师用的哪张 value-NN（rank 候选 / 部署网）
    try { if (new URLSearchParams(root.location.search).get("net") === "rank") net = "rank"; } catch (e) {}
    cur = {
      ts: Date.now(),
      net,
      numPlayers: G.numPlayers,
      humanSeat,
      governorStart: G.governor,
      aiLevels: G.players.map(p => p.isHuman ? "human" : (p._aiLevel || null)),
      seats: G.players.map(p => p.name),
      picks: [],         // 全部选角色事件（轻量，重建角色经济）
      decisions: [],     // 仅真人"选角色"决策点（带局面快照，较重）
      subDecisions: [],  // 仅真人子决策(build/…)决策点（带快照）→ 对手模型的核心数据
      anonId: _anonId(),
      result: null,
    };
  }

  // 每次"选角色"被敲定时调用（在 chosen.taken=true 之前 → 快照里该角色仍可选）
  function recordPick(G, seat, isHuman, available, chosenRole) {
    if (!cur) return;
    cur.picks.push({ turn: G.turnNumber, seat, isHuman, role: chosenRole });
    if (isHuman) {
      cur.decisions.push({
        turn: G.turnNumber, seat,
        available: available.map(r => ({ name: r.name, money: r.money })),
        chosen: chosenRole,
        state: _snapshot(G),   // 决策时刻、动作执行前的纯数据局面（可喂给 bot 问"它会选啥"）
      });
    }
  }

  // 真人"子决策"（build/settle/trade/captain…）敲定时调用（在动作执行前 → 快照=决策时刻局面）。
  // type: 因子化决策类型(须为 sim_az 的 DEC_TYPES 之一, 如 "build")；options: 候选动作数组(记录用)；
  // chosen: 所选的局部动作(build=建筑 bid)。→ 对手模型 = 学"人在这个局面会怎么选"。
  function recordSubDecision(G, seat, type, options, chosen) {
    if (!cur) return;
    const p = G.players && G.players[seat];
    if (!p || !p.isHuman) return;   // 只采真人子决策
    cur.subDecisions.push({
      turn: G.turnNumber, seat, type,
      options: Array.isArray(options) ? options.slice(0, 24) : [],
      chosen,
      state: _snapshot(G),
    });
  }

  // 终局：写入 localStorage
  function finish(G, finalScores, winnerSeat, endReason) {
    if (!cur) return;
    cur.result = {
      endReason, turns: G.turnNumber,
      scores: finalScores,                 // [{seat,total,base,buildingVP,special}]
      winnerSeat,
      humanWon: (cur.humanSeat >= 0 && winnerSeat === cur.humanSeat),
    };
    const all = _load(); all.push(cur); _save(all);
    const tag = cur.humanSeat >= 0 ? (cur.result.humanWon ? "真人胜✅" : "真人负❌") : "全AI";
    if (root.console) console.log(`[PRTrace] 已记录对局 #${all.length}（${tag}，${cur.numPlayers}人，第${G.turnNumber}回合）。PRTrace.stats() 看汇总`);
    try { _uploadGame(cur); } catch (e) {}   // 真人胜局 → 自动上传训练样本（失败静默）
    cur = null;
    _renderExportBtn();
  }

  // ---- 训练样本转换（与 tools/selfplay_dump.js 逐口径对齐）-----------------
  const _r4 = (x) => Math.round(x * 10000) / 10000;

  // 终局相对优势 → value 目标。scores 必须按座位(seat)索引。
  function _relAdv(scores, playerIdx, mode) {
    const N = scores.length;
    if (N <= 1) return 0;
    if (mode === "rank") {
      // 名次→value：独占第 1 = +1，末名 = -1（并列取平均名次）
      let better = 0, equal = 0;
      for (let i = 0; i < N; i++) { if (i === playerIdx) continue; if (scores[i] > scores[playerIdx]) better++; else if (scores[i] === scores[playerIdx]) equal++; }
      const rank = better + equal / 2;
      return Math.max(-1, Math.min(1, 1 - 2 * rank / (N - 1)));
    }
    if (mode === "vsbest") {
      let best = -Infinity;
      for (let i = 0; i < N; i++) if (i !== playerIdx && scores[i] > best) best = scores[i];
      return Math.max(-1, Math.min(1, (scores[playerIdx] - best) / 30));
    }
    // margin（默认）：(我分 - 对手平均) / 50
    let oppSum = 0;
    for (let i = 0; i < N; i++) if (i !== playerIdx) oppSum += scores[i];
    return Math.max(-1, Math.min(1, (scores[playerIdx] - oppSum / (N - 1)) / 50));
  }

  // 把一局（cur 或 localStorage 存档）转成训练 JSONL 行数组。
  // 只用「真人决策点」(decisions)：特征=extractRich(决策时快照, 真人座位)，
  // 动作=所选角色 policy idx，value=终局相对优势（与自对弈同口径，perspective-first）。
  function gameToTrainingLines(game, opts) {
    opts = opts || {};
    const mode = opts.valueMode || config.valueMode;
    const out = [];
    if (!game || !game.result || !Array.isArray(game.decisions)) return out;
    if (typeof PRSim === "undefined" || !PRSim || typeof PRSim.extractRich !== "function") return out;
    const N = game.numPlayers;
    // result.scores 按名次排序的 [{seat,total}] → 还原成按座位索引的分数数组
    const scores = new Array(N).fill(0);
    for (const s of (game.result.scores || [])) if (s && s.seat >= 0 && s.seat < N) scores[s.seat] = s.total;
    for (const d of game.decisions) {
      const st = d.state, seat = d.seat;
      if (!st || seat == null || seat < 0 || seat >= N) continue;
      let f;
      try { f = PRSim.extractRich(st, seat); } catch (e) { continue; }
      if (!f || f.length !== PRSim.FEATURE_DIM_RICH) continue;
      const a = PRSim.roleNameToPolicyIdx(d.chosen);
      if (!(a >= 0)) continue;
      const v = _r4(_relAdv(scores, seat, mode));
      const vv = new Array(VVDIM).fill(0);
      for (let k = 0; k < VVDIM && k < N; k++) vv[k] = _r4(_relAdv(scores, (seat + k) % N, mode));
      const fArr = new Array(f.length);
      for (let i = 0; i < f.length; i++) fArr[i] = _r4(f[i]);
      out.push(JSON.stringify({ f: fArr, a, v, vv, n: N }));
    }
    // 人类子决策 → az-format 样本(452 维特征 + 全局动作 idx)，与 selfplay_az.js 同口径，喂对手/人类策略网。
    // 需 sim_az.js 已加载(azFeatures/azActionToGlobal)；未加载则跳过(角色样本不受影响，向后兼容)。
    if (typeof PRSim.azFeatures === "function" && typeof PRSim.azActionToGlobal === "function" &&
        PRSim.AZ_FEATURE_DIM && PRSim.AZ_ACTION_DIM && Array.isArray(game.subDecisions)) {
      for (const d of game.subDecisions) {
        const st = d.state, seat = d.seat;
        if (!st || seat == null || seat < 0 || seat >= N || !d.type) continue;
        let f, a;
        try { f = PRSim.azFeatures(st, { chooser: seat, type: d.type }); } catch (e) { continue; }
        if (!f || f.length !== PRSim.AZ_FEATURE_DIM) continue;
        try { a = PRSim.azActionToGlobal(d.type, d.chosen); } catch (e) { continue; }
        if (!(a >= 0 && a < PRSim.AZ_ACTION_DIM)) continue;
        const v = _r4(_relAdv(scores, seat, mode));
        const vv = new Array(VVDIM).fill(0);
        for (let k = 0; k < VVDIM && k < N; k++) vv[k] = _r4(_relAdv(scores, (seat + k) % N, mode));
        const fArr = new Array(f.length);
        for (let i = 0; i < f.length; i++) fArr[i] = _r4(f[i]);
        out.push(JSON.stringify({ k: "sub", t: d.type, f: fArr, a, v, vv, n: N }));
      }
    }
    return out;
  }

  // 真人胜局 → 后端 /collect（fire-and-forget；非浏览器或关闭上传则跳过）
  function _uploadGame(game) {
    if (!config.upload) return;
    if (typeof root.navigator === "undefined" || typeof root.location === "undefined") return;
    if (!(game && game.humanSeat >= 0)) return;
    if (config.uploadOnlyWins && !(game.result && game.result.humanWon)) return;
    let lines;
    try { lines = gameToTrainingLines(game); } catch (e) { return; }
    if (!lines.length) return;
    const payload = JSON.stringify({
      ver: SCHEMA_VER, ts: game.ts, n: game.numPlayers, humanSeat: game.humanSeat,
      turns: game.result.turns, valueMode: config.valueMode, scores: game.result.scores,
      anonId: game.anonId || null, lines,
    });
    try {
      const blob = new Blob([payload], { type: "application/json" });
      if (root.navigator.sendBeacon && root.navigator.sendBeacon(config.endpoint, blob)) return;
      root.fetch(config.endpoint, { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    } catch (e) {}
  }

  // 客户端导出：本浏览器存的（默认仅真人胜局）对局 → 训练 JSONL 下载。
  function exportJSONL(opts) {
    opts = opts || {};
    const onlyWins = opts.onlyWins !== false;
    const all = _load();
    const games = all.filter(g => g.humanSeat >= 0 && g.result && (!onlyWins || g.result.humanWon));
    let lines = [];
    for (const g of games) lines = lines.concat(gameToTrainingLines(g, opts));
    if (!lines.length) { if (root.console) console.log("[PRTrace] 没有可导出的训练样本（需要先有真人胜局）"); return "无数据"; }
    const blob = new Blob([lines.join("\n") + "\n"], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = root.document.createElement("a");
    a.href = url; a.download = `pr-human-wins-${games.length}g-${lines.length}s-${Date.now()}.jsonl`;
    root.document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    return `已导出 ${games.length} 局 / ${lines.length} 样本`;
  }

  function stats() {
    const all = _load();
    const human = all.filter(g => g.humanSeat >= 0 && g.result);
    const wins = human.filter(g => g.result.humanWon).length;
    const byPC = {};
    for (const g of human) {
      const k = g.numPlayers + "p";
      byPC[k] = byPC[k] || { games: 0, humanWins: 0 };
      byPC[k].games++; if (g.result.humanWon) byPC[k].humanWins++;
    }
    const s = {
      totalGames: all.length,
      humanGames: human.length,
      humanWins: wins,
      humanWinRate: human.length ? +(wins / human.length * 100).toFixed(1) : null,
      byPlayerCount: byPC,
    };
    if (root.console) { console.log("[PRTrace] 汇总:", s); if (console.table) console.table(byPC); }
    return s;
  }

  function last() {
    const all = _load();
    return all.length ? all[all.length - 1] : null;
  }

  function exportJSON() {
    const all = _load();
    if (!all.length) { if (root.console) console.log("[PRTrace] 暂无对局可导出"); return "无数据"; }
    const blob = new Blob([JSON.stringify(all)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = root.document.createElement("a");
    a.href = url; a.download = `pr-traces-${all.length}games-${Date.now()}.json`;
    root.document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    return `已导出 ${all.length} 局`;
  }

  function clear() { _save([]); _renderExportBtn(); return "已清空对局日志"; }

  // 右下角悬浮导出按钮（有数据才显示），省得去控制台敲命令
  function _renderExportBtn() {
    if (typeof root.document === "undefined") return;
    const doc = root.document;
    const mkBtn = (id, bottom, title, onclick) => {
      let b = doc.getElementById(id);
      if (!b) {
        b = doc.createElement("button");
        b.id = id;
        b.style.cssText = `position:fixed;right:10px;bottom:${bottom}px;z-index:9998;background:#2c3e50;color:#cbd5df;border:1px solid #5a738c;border-radius:14px;padding:5px 12px;font-size:12px;cursor:pointer;opacity:.75;box-shadow:0 2px 6px rgba(0,0,0,.35)`;
        b.title = title;
        b.onmouseenter = () => b.style.opacity = "1";
        b.onmouseleave = () => b.style.opacity = ".75";
        b.onclick = onclick;
        doc.body.appendChild(b);
      }
      return b;
    };
    const render = () => {
      if (!doc.body) return;
      const all = _load();
      const n = all.length;
      const wins = all.filter(g => g.humanSeat >= 0 && g.result && g.result.humanWon).length;
      let btn = doc.getElementById("pr-export-btn");
      let btn2 = doc.getElementById("pr-export-jsonl-btn");
      if (n === 0) { if (btn) btn.remove(); if (btn2) btn2.remove(); return; }
      btn = mkBtn("pr-export-btn", 10, "导出全部真人对局原始 JSON（漏洞分析用）", () => exportJSON());
      btn.textContent = `📥 对局 JSON (${n})`;
      btn2 = mkBtn("pr-export-jsonl-btn", 44, "导出真人胜局训练 JSONL（直接喂 train/）", () => exportJSONL());
      btn2.textContent = `🎯 训练 JSONL (${wins})`;
    };
    if (doc.body) render();
    else doc.addEventListener("DOMContentLoaded", render);
  }
  _renderExportBtn();

  // URL 触发：?export=jsonl 自动下载训练 JSONL；?export=json 下载原始对局
  (function _maybeAutoExport() {
    try {
      const mode = new URLSearchParams(root.location.search).get("export");
      if (!mode) return;
      const run = () => { if (mode === "jsonl") exportJSONL(); else if (mode === "json") exportJSON(); };
      if (root.document && root.document.body) setTimeout(run, 300);
      else if (root.document) root.document.addEventListener("DOMContentLoaded", () => setTimeout(run, 300));
    } catch (e) {}
  })();

  root.PRTrace = { begin, recordPick, recordSubDecision, finish, stats, last, current: () => cur, export: exportJSON, exportJSONL, gameToTrainingLines, config, clear, _load };
})(typeof window !== "undefined" ? window : this);
