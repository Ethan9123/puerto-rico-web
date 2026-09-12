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
  // 立即推一帧（不节流）。用于有新客人进房时：房主可能正卡在某人输入上、长时间不 render，
  // 新人就会一直停在大厅看不到棋盘——进房即推一帧让其马上进入观战/认领。
  function pushNow() { if (hostSession) flush(); }
  function startHosting(session) { hostSession = session; lastSent = 0; }
  function stopHosting() { hostSession = null; if (timer) { clearTimeout(timer); timer = null; } }
  function onHostGameOver(title, body) {
    if (!hostSession) return;
    try { sessionStorage.removeItem("prnet_room"); sessionStorage.removeItem("prnet_role"); } catch (e) {} // 结束的局不再自动重开
    if (timer) { clearTimeout(timer); timer = null; }
    const snap = snapshot();
    try { hostSession.send({ type: "gameover", snap, title: title || "", body: body || "" }); } catch (e) {}
  }

  // ============ 客人侧：重放 ============
  let guestSession = null, hostName = "", _hostGone = false;
  let _lastBanner = "";   // 最近一条正常横幅，掉线恢复后原样放回
  let _connLost = false;

  function banner(text, warn) {
    if (!warn) _lastBanner = text;
    let b = document.getElementById("spectate-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "spectate-banner";
      document.body.appendChild(b);
    }
    b.innerHTML = text;
    b.style.background = warn ? "linear-gradient(90deg,#7b2d2d,#9b3030)" : "";
    syncBannerHeight();
  }
  // 横幅是 position:fixed 的，不占文档流；#game-screen 要按它的**实际**高度让位（手机上会换行到 2–3 行）。
  // 写成 CSS 变量 --spectate-banner-h，styles.css 用 calc() 读它。
  function syncBannerHeight() {
    const b = document.getElementById("spectate-banner");
    const h = b ? b.offsetHeight : 0;
    document.documentElement.style.setProperty("--spectate-banner-h", h + "px");
  }
  if (typeof window !== "undefined") window.addEventListener("resize", syncBannerHeight);
  function removeBanner() { const b = document.getElementById("spectate-banner"); if (b) b.remove(); }

  function onHostLeft() {
    if (!guestSession) return;
    _hostGone = true;
    banner("⚠️ 房主已断线，等待重连……（若长时间未回，请刷新页面）", true);
  }
  function onHostBack(name) {
    if (!guestSession || !_hostGone) return;
    _hostGone = false;
    hostName = name || hostName;
    banner(`🔄 房主正在重连（${esc(hostName)}），等待下一帧……`);
  }
  // 客人【自己】的连接状态（net.js 经 lobby 转发）。此前完全无感：WebSocket 断了、手机断网了，
  // 横幅照旧写着「🌐 联机中」，棋盘只是静静不动——分不清是对手在想还是自己早就掉了。
  function onConnStatus(status, detail) {
    if (!guestSession) return;
    if (status === "SUBSCRIBED" || status === "ONLINE") {
      if (_connLost) { _connLost = false; banner(_lastBanner || "🌐 已重新连上，等待下一帧……"); }
      return;
    }
    if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "OFFLINE") {
      _connLost = true;
      banner(`⚠️ 你已掉线（${esc(detail || status)}），正在重连……房主会先等你一会儿，超时才交给 AI 代打；回来会自动收回座位`, true);
    }
  }

  function applyState(snap) {
    if (!snap || typeof Game === "undefined") return;
    // 远程出手进行中：客人正盯着自己的决策 UI，别被房主的 state 广播刷掉
    if (typeof PRNetPlay !== "undefined" && PRNetPlay.guestBusy()) return;
    // 联机对局：首次拿到带座位归属的状态时，把客人接入远程出手层
    if (snap._online && snap._seatOwners && typeof PRNetPlay !== "undefined" && !PRNetPlay.isOnline() && root.PR_SESSION) {
      PRNetPlay.setup({ session: root.PR_SESSION, role: "guest", seatOwners: snap._seatOwners, myToken: root.PR_SESSION.token, myId: root.PR_SESSION.clientId, online: true });
    }
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
      let roleTag = "";
      if (typeof PRNetPlay !== "undefined" && PRNetPlay.isOnline()) {
        const seat = PRNetPlay.mySeat();
        roleTag = seat >= 0 ? ` · 你在座位 ${seat + 1} 参战（轮到你时会弹出操作）` : " · 你在观战";
      } else {
        roleTag = " · 你看到的是房主的实时对局";
      }
      // 在等谁：按快照的 _actingSeat（阶段内子决策的实际行动座位），不是只在选角色时才更新的 _currentPlayer
      let waitTag = "";
      const act = (g._actingSeat != null && g.players && g.players[g._actingSeat]) ? g.players[g._actingSeat] : null;
      if (act && !g.gameOver) {
        const mine = (typeof PRNetPlay !== "undefined" && PRNetPlay.isOnline()) ? PRNetPlay.mySeat() : -1;
        waitTag = (mine >= 0 && mine === g._actingSeat) ? " · 🔔 <b>轮到你了</b>"
                : ` · ⏳ 等待 ${esc(act.name)}${act.isHuman ? "" : "（AI）"} 出手……`;
      }
      banner(`🌐 联机中${hostName ? "（房主：" + esc(hostName) + "）" : ""}${roleTag}${waitTag}`);
      if (typeof render === "function") render();
      // 刷新「认领座位」栏：若我无座位且有被 AI 接管的座位，显示认领按钮
      if (typeof PRNetPlay !== "undefined" && PRNetPlay.refreshReclaimUI) PRNetPlay.refreshReclaimUI();
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
    // ⚠ applyState 此前**没有导出**。netplay.js onInputRequest 以 `PRSpectate.applyState &&` 守卫后调用它，
    //   守卫恒假 → 「先把随请求附带的最新状态套进来再开决策 UI」这一步从未执行：客人在旧棋盘上做决策，
    //   房主重连后横幅还卡在「房主正在重连…等待下一帧」（_guestBusy 又挡住了后续帧）。E2E ⑫ 抓出来的。
    applyState,
    snapshot,
    startHosting, stopHosting, onHostRender, onHostGameOver, pushNow,
    startSpectating, stopSpectating, handleMessage,
    onHostLeft, onHostBack, onConnStatus,
    isHosting: () => !!hostSession,
    isSpectating: () => !!guestSession,
  };
})(typeof window !== "undefined" ? window : this);
