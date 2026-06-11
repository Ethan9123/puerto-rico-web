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
      picks: [],      // 全部选角色事件（轻量，重建角色经济）
      decisions: [],  // 仅真人决策点（带局面快照，较重）
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
    cur = null;
    _renderExportBtn();
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
    const render = () => {
      if (!doc.body) return;
      const n = _load().length;
      let btn = doc.getElementById("pr-export-btn");
      if (n === 0) { if (btn) btn.remove(); return; }
      if (!btn) {
        btn = doc.createElement("button");
        btn.id = "pr-export-btn";
        btn.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:9998;background:#2c3e50;color:#cbd5df;border:1px solid #5a738c;border-radius:14px;padding:5px 12px;font-size:12px;cursor:pointer;opacity:.75;box-shadow:0 2px 6px rgba(0,0,0,.35)";
        btn.title = "导出全部真人对局 JSON（喂给 analyze_traces.js 做漏洞分析）";
        btn.onmouseenter = () => btn.style.opacity = "1";
        btn.onmouseleave = () => btn.style.opacity = ".75";
        btn.onclick = () => exportJSON();
        doc.body.appendChild(btn);
      }
      btn.textContent = `📥 导出对局 (${n})`;
    };
    if (doc.body) render();
    else doc.addEventListener("DOMContentLoaded", render);
  }
  _renderExportBtn();

  root.PRTrace = { begin, recordPick, finish, stats, last, current: () => cur, export: exportJSON, clear, _load };
})(typeof window !== "undefined" ? window : this);
