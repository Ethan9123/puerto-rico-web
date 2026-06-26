// ============================================================
// spectate.js — 联机对战 Phase 2：实时观战
// ============================================================
// 主机权威：房主浏览器跑真引擎，每次 render() 把当前对局状态广播给房间里的客人；
// 客人收到后把状态套进自己的 G（只读重放）并 render()，看到与房主一致的画面。
// 客人不跑引擎、不触发任何输入循环（pendingSelect 恒为 null → 棋盘点击天然无副作用），
// 所以这层是纯展示，零改动游戏逻辑。远程出手（客人坐真实座位）留到 Phase 3。
//
// 复用：序列化逻辑与 #48 的 serializeGame 同源（丢 _dna/_persona、按 key 接回），
// 但这里允许 gameOver（要把终局画面也广播给客人）。
//
// 对外（被 game.js / lobby.js 调用）：
//   PRSpectate.startHosting(session)         房主：开始把状态广播给客人
//   PRSpectate.stopHosting()
//   PRSpectate.onHostRender()                game.js render() 末尾调用（非房主时 no-op）
//   PRSpectate.onHostGameOver(title, body)   game.js endGame() 末尾调用
//   PRSpectate.startSpectating(session, info) 客人：进入观战待命
//   PRSpectate.handleMessage(msg)            lobby.js 收到广播时分发（state / gameover）
//   PRSpectate.stopSpectating()
// ============================================================
(function (root) {
  "use strict";

  // ---- 状态快照（与 serializeGame 同源，但允许 gameOver） ----
  function snapshot() {
    if (typeof G === "undefined" || !G) return null;
    try {
      const snap = JSON.parse(JSON.stringify(G, (k, v) =>
        (k === "_dna" || k === "_lastCraftKinds" || k === "_persona") ? undefined : v));
      if (Array.isArray(snap.log)) snap.log = snap.log.slice(0, 50); // 控体积
      if (Array.isArray(snap.players)) snap.players.forEach((p, i) => {
        const src = G.players[i];
        if (src && src._persona) p._personaKey = src._persona.key;
      });
      snap._specVer = 1;
      return snap;
    } catch (e) { return null; }
  }

  // ============ 房主侧：广播 ============
  let hostSession = null, lastSent = 0, timer = null;
  const THROTTLE = 300; // 节流：AI 连续 render 时只发最新一帧

  function flush() {
    timer = null; lastSent = Date.now();
    if (!hostSession) return;
    const snap = snapshot();
    if (snap) try { hostSession.send({ type: "state", snap }); } catch (e) {}
  }
  function onHostRender() {
    if (!hostSession) return;
    const now = Date.now(), wait = THROTTLE - (now - lastSent);
    if (wait <= 0) flush();
    else if (!timer) timer = setTimeout(flush, wait);
  }
  function startHosting(session) { hostSession = session; lastSent = 0; }
  function stopHosting() { hostSession = null; if (timer) { clearTimeout(timer); timer = null; } }
  function onHostGameOver(title, body) {
    if (!hostSession) return;
    if (timer) { clearTimeout(timer); timer = null; }
    const snap = snapshot();
    try { hostSession.send({ type: "gameover", snap, title: title || "", body: body || "" }); } catch (e) {}
  }

  // ============ 客人侧：重放 ============
  let guestSession = null, hostName = "";

  function banner(text) {
    let b = document.getElementById("spectate-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "spectate-banner";
      document.body.appendChild(b);
    }
    b.innerHTML = text;
  }
  function removeBanner() { const b = document.getElementById("spectate-banner"); if (b) b.remove(); }

  function applyState(snap) {
    if (!snap || typeof Game === "undefined") return;
    try {
      const g = Object.assign(Object.create(Game.prototype), snap);
      for (const p of (g.players || [])) {
        if (p._dnaMeta && p._dnaMeta.dna) { try { p._dna = splitDNA(joinDNA(p._dnaMeta.dna)); } catch (e) {} }
        if (p._personaKey) { const pa = (typeof AI_PERSONAS !== "undefined") && AI_PERSONAS.find(x => x.key === p._personaKey); if (pa) p._persona = pa; }
      }
      g._spectator = true;             // 标记只读（render 仍照常画，点击因 pendingSelect=null 无副作用）
      // G 是 game.js 的词法全局，必须经 setter 注入（直接 window.G=g 不会更新 render 读到的 G）
      if (typeof setGlobalGame === "function") setGlobalGame(g);
      else root.G = g;
      const setup = document.getElementById("setup-screen");
      const screen = document.getElementById("game-screen");
      if (setup) setup.classList.add("hidden");
      if (screen) screen.classList.remove("hidden");
      banner(`👀 观战中${hostName ? "（房主：" + esc(hostName) + "）" : ""} · 你看到的是房主的实时对局`);
      if (typeof render === "function") render();
    } catch (e) { console.warn("[spectate] applyState failed:", e); }
  }

  function applyGameOver(msg) {
    applyState(msg && msg.snap);
    if (msg && msg.body && typeof showModal === "function") {
      showModal(msg.title || "🎉 游戏结束", msg.body, [
        { label: "返回大厅", fn: () => location.reload(), primary: true },
      ]);
    }
  }

  function handleMessage(msg) {
    if (!msg || !guestSession) return;     // 只有客人重放；房主忽略（自己不会收到自己的广播）
    if (msg.type === "state") applyState(msg.snap);
    else if (msg.type === "gameover") applyGameOver(msg);
  }

  function startSpectating(session, info) {
    guestSession = session;
    hostName = (info && info.hostName) || "";
  }
  function stopSpectating() { guestSession = null; removeBanner(); }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  root.PRSpectate = {
    snapshot,
    startHosting, stopHosting, onHostRender, onHostGameOver,
    startSpectating, stopSpectating, handleMessage,
    isHosting: () => !!hostSession,
    isSpectating: () => !!guestSession,
  };
})(typeof window !== "undefined" ? window : this);
