// ============================================================
// netplay.js — 联机对战 Phase 3：远程出手（远程座位的人类输入路由）
// ============================================================
// 主机权威不变：房主浏览器跑唯一真引擎、掌随机/AI。本层只解决一件事——
// 当引擎轮到一个【由远程客人掌控的座位】做人类决策时，把这次输入「外包」给那个客人：
//   房主：engine 调到 humanPickFromList / humanBoardSelect / humanPickRole 时，
//          若当前行动座位属于某个在场客人 → 发 input-request 并 await 客人回传的结果，
//          其间显示「等待 X 出手」浮层（含「房主代打」兜底，防客人掉线卡死）。
//   客人：收到自己座位的 input-request → 用【完全相同的本地 UI 函数】渲染该决策、
//          玩家点选后把结果（下标/key）回传房主。
//
// 为什么能复用同一套 UI：客人本来就在实时观战（spectate.js 把房主状态套进客人的 G），
// 所以客人手里有当前 G，直接跑 humanPickFromList(...) 就能画出与房主一致的选项；
// 返回的只是一个下标/key，房主据此推进引擎 —— 引擎逻辑零改动。
//
// 协议（复用 net.js 的广播信道）：
//   房主→客人  { type:'input-request',  reqId, seat, kind, payload, snap }
//   客人→房主  { type:'input-response', reqId, value }
//   （另有 spectate.js 的 state / gameover）
//
// 路由键：引擎在每个人类输入点把 G._actingSeat 设为当前行动座位（game.js 里设置）。
// v1 仅基础规则；扩展建筑的额外决策点留到 Phase 3.1。
// ============================================================
(function (root) {
  "use strict";

  let _session = null;      // PRNet session
  let _role = null;         // 'host' | 'guest'
  let _online = false;      // 是否处于联机对局
  let _seatOwners = {};     // { seatIdx: clientId } —— 远程客人掌控的座位
  let _myId = null;         // 本端 clientId
  let _takenOver = {};      // { seatIdx: true } —— 房主已接管的座位（客人掉线/代打后转本地）
  const _pending = {};      // host: { reqId: {resolve, seat} }
  let _reqSeq = 0;
  let _guestBusy = false;   // guest: 是否正在做一次远程输入（其间不要被 state 广播打断）

  // G 是 game.js 的词法全局（let），不是 window.G —— 自由变量 G 能跨脚本读到正确绑定，window.G 不能。
  function game() { return (typeof G !== "undefined" && G) ? G : null; }

  function clearPending() { for (const k in _pending) { if (_pending[k].timer) clearTimeout(_pending[k].timer); delete _pending[k]; } }
  function setup(opts) {
    _session = opts.session || null;
    _role = opts.role || (_session && _session.role) || null;
    _myId = (opts.myId) || (_session && _session.clientId) || null;
    _seatOwners = opts.seatOwners || {};
    _online = !!opts.online;
    _takenOver = {};
    clearPending();
    _guestBusy = false;
  }
  function teardown() { _online = false; _session = null; _seatOwners = {}; _takenOver = {}; _guestBusy = false; removeOverlay(); removeReclaimUI(); clearPending(); }

  function presentIds() {
    try { return (_session && _session.presence ? _session.presence() : []).map((m) => m && m.clientId); }
    catch (e) { return []; }
  }
  function ownerConnected(clientId) { return presentIds().indexOf(clientId) >= 0; }

  // ---------- 房主侧：是否把当前输入路由给远程客人 ----------
  function shouldRoute() {
    if (_role !== "host" || !_online) return false;
    const g = game();
    const seat = g ? g._actingSeat : null;
    if (seat == null) return false;
    const owner = _seatOwners[seat];
    if (!owner) return false;            // 本地座位（房主自己 / AI）
    if (_takenOver[seat]) return false;  // 房主已接管
    if (!ownerConnected(owner)) return false; // 客人掉线 → 房主本地代跑，避免卡死
    return true;
  }

  // 闲置/掉线 → 专家 AI 接管的阈值（可用 window._netIdleMs 覆盖，便于测试）
  function idleMs() { return (typeof root._netIdleMs === "number" && root._netIdleMs > 0) ? root._netIdleMs : 180000; } // 默认 3 分钟

  // 引擎里的 3 个输入原语在入口调用：返回 Promise 则走网络，返回 null 则走本地。
  function maybeRoute(kind, payload) {
    if (_role !== "host" || !_online) return null;
    const g = game();
    const seat = g ? g._actingSeat : null;
    if (seat == null) return null;
    const owner = _seatOwners[seat];
    if (!owner) return null;                                   // 本地座位（房主自己 / AI）
    // 已被接管的座位：本地直接给「专家 AI / 安全默认」作答，不弹房主 UI、不再走网络
    if (_takenOver[seat]) return Promise.resolve(aiDefaultFor(kind, payload, g.players[seat]));
    // 客人此刻不在场（掉线）：立即转专家 AI 接管
    if (!ownerConnected(owner)) { aiTakeover(seat, "掉线"); return Promise.resolve(aiDefaultFor(kind, payload, g.players[seat])); }
    return request(seat, kind, payload);
  }

  function request(seat, kind, payload) {
    const reqId = (_myId || "h") + ":" + (++_reqSeq);
    const snap = (typeof PRSpectate !== "undefined" && PRSpectate.snapshot) ? PRSpectate.snapshot() : null;
    showOverlay(seat, kind, payload);
    const p = new Promise((resolve) => { _pending[reqId] = { resolve, seat, kind, payload }; });
    // 3 分钟无响应 → 专家 AI 接管该座位（含本次挂起请求）
    _pending[reqId].timer = setTimeout(() => aiTakeover(seat, "3 分钟未操作"), idleMs());
    try { _session.send({ type: "input-request", reqId, seat, kind, payload, snap }); } catch (e) {}
    return p;
  }

  function resolvePending(reqId, value) {
    const pend = _pending[reqId];
    if (!pend) return;                 // 过期/重复响应：忽略
    if (pend.timer) clearTimeout(pend.timer);
    delete _pending[reqId];
    if (!hasPending()) removeOverlay();
    pend.resolve(value);
  }
  function hasPending() { for (const k in _pending) return true; return false; }

  // 某座位长时间未操作 / 掉线 → 由房主的专家级(L5) AI 接管：把该座位转为 AI，
  // 当前挂起的输入用 AI/安全默认作答，之后所有决策走引擎原生 AI 分支（p.isHuman=false）。
  function aiTakeover(seat, reason) {
    const g = game(); if (!g) return;
    const p = g.players[seat]; if (!p) return;
    if (_takenOver[seat]) return;        // 幂等：已接管
    const origName = (p.name || ("座位" + (seat + 1))).replace(/（AI 接管）$/, "");
    _takenOver[seat] = origName;          // 记原名，供重连交还时恢复
    delete _seatOwners[seat];            // 不再向该座位路由
    p.isHuman = false;
    p._aiLevel = 5;                       // 专家级
    p._remote = null;
    p.name = origName + "（AI 接管）";
    g._takenOverSeats = g._takenOverSeats || {};
    g._takenOverSeats[seat] = origName;   // 进广播快照 → 客人据此显示「认领座位」
    try { if (typeof loadDNA === "function") loadDNA(p, seat); } catch (e) {} // 装备 DNA 供 AI 决策
    // 结算该座位所有挂起请求
    for (const reqId in _pending) {
      const pend = _pending[reqId];
      if (pend.seat !== seat) continue;
      if (pend.timer) clearTimeout(pend.timer);
      delete _pending[reqId];
      pend.resolve(aiDefaultFor(pend.kind, pend.payload, p));
    }
    if (!hasPending()) removeOverlay();
    try { if (g.logEvent) g.logEvent(`🤖 ${p.name}（${reason}）由专家 AI 接管`, "role"); } catch (e) {}
    try { if (typeof showToast === "function") showToast(`<div class="t-title">🤖 ${esc(p.name)} 由专家 AI 接管</div><div class="t-sub">${esc(reason)}</div>`, { kind: "role" }); } catch (e) {}
    try { _session && _session.send({ type: "takeover", seat, reason }); } catch (e) {} // 通知客人（横幅转为「已被接管」）
    if (typeof render === "function") render(); // 立即广播一帧，客人看到该座位变 AI
  }

  // 当前挂起决策的 AI/安全默认答案。pickRole 用真实 AI；其余取首个合法项（标签/选项都是合法的）。
  function aiDefaultFor(kind, payload, p) {
    if (kind === "pickRole") {
      const g = game();
      const avail = (payload.availableNames || []).map((n) => (g.roleCards || []).find((r) => r.name === n)).filter(Boolean);
      if (typeof aiPickRole === "function" && avail.length) { try { return aiPickRole(p, avail); } catch (e) {} }
      return 0;
    }
    if (kind === "boardSelect") { const c = payload.choices; return (c && c.length) ? c[0].key : (payload.allowSkip ? null : 0); }
    return payload.allowCancel ? 0 : 0; // pickFromList：首个合法项
  }

  // 在场名单变化时（lobby 转发）：某个仍持座位的客人离场 → 立即 AI 接管
  function onPresence(list) {
    if (_role !== "host" || !_online) return;
    const ids = (list || []).map((m) => m && m.clientId);
    for (const s in _seatOwners) {
      const owner = _seatOwners[s];
      if (owner && ids.indexOf(owner) < 0) aiTakeover(+s, "掉线");
    }
  }

  // 调本地原语（房主接管 / 客人执行都用它）。不会再次路由：客人 _role!=host，房主已 takenOver。
  function localRun(kind, payload) {
    if (kind === "pickFromList") return root.humanPickFromList(payload.title, payload.labels, payload.allowCancel, payload.bodyHtml || "");
    if (kind === "boardSelect") return root.humanBoardSelect(payload);
    if (kind === "pickRole") {
      const g = game(); if (!g) return Promise.resolve(null);
      const avail = (payload.availableNames || []).map((n) => (g.roleCards || []).find((r) => r.name === n)).filter(Boolean);
      return root.humanPickRole(avail, g.players[payload.seat != null ? payload.seat : g._actingSeat]);
    }
    return Promise.resolve(null);
  }

  // ---------- 客人侧：收到自己座位的请求 → 跑本地 UI → 回传 ----------
  function mySeat() {
    for (const s in _seatOwners) if (_seatOwners[s] === _myId) return +s;
    return -1;
  }
  async function onInputRequest(msg) {
    if (_role !== "guest") return;
    if (_seatOwners[msg.seat] !== _myId) return;   // 不是我的座位，忽略（其它客人的）
    // 先把房主随请求附带的最新状态套进来，保证选项 UI 与房主一致
    if (msg.snap && typeof PRSpectate !== "undefined" && PRSpectate.applyState) {
      _guestBusy = false; PRSpectate.applyState(msg.snap);
    }
    _guestBusy = true;                              // 其间屏蔽 state 广播，避免打断输入 UI
    let value = null;
    try { value = await localRun(msg.kind, Object.assign({ seat: msg.seat }, msg.payload)); }
    finally { _guestBusy = false; }
    try { _session.send({ type: "input-response", reqId: msg.reqId, value }); } catch (e) {}
  }

  function handleMessage(msg) {
    if (!msg) return;
    if (msg.type === "input-request") onInputRequest(msg);
    else if (msg.type === "input-response" && _role === "host") resolvePending(msg.reqId, msg.value);
    else if (msg.type === "takeover" && _role === "guest") onTakenOver(msg);
    else if (msg.type === "reclaim" && _role === "host") onReclaim(msg);
    else if (msg.type === "reclaimed" && _role === "guest") onReclaimed(msg);
  }

  // ---------- 重连交还：被 AI 接管的座位，原玩家回来后可认领 ----------
  // 客人（无座位）点「认领座位」→ 发 reclaim；房主把该座位从 AI 翻回远程人类、广播 reclaimed。
  function myName() {
    try { return (document.getElementById("player-name") || {}).value || "玩家"; } catch (e) { return "玩家"; }
  }
  function reclaim(seat) {
    if (_role !== "guest" || !_online) return;
    try { _session.send({ type: "reclaim", seat: +seat, clientId: _myId, name: myName() }); } catch (e) {}
  }
  function onReclaim(msg) { // 房主侧
    const g = game(); if (!g) return;
    const seat = msg.seat;
    if (!_takenOver[seat]) return;        // 该座位不可认领（未被接管 / 已被别人认领）
    const p = g.players[seat]; if (!p) return;
    p.isHuman = true;
    p._remote = msg.clientId;
    p._aiLevel = null;
    p.name = msg.name || _takenOver[seat] || p.name;
    _seatOwners[seat] = msg.clientId;     // 之后该座位的输入重新路由给（新的）客人
    delete _takenOver[seat];
    if (g._takenOverSeats) delete g._takenOverSeats[seat];
    try { if (g.logEvent) g.logEvent(`↩️ ${p.name} 重连，收回座位 ${seat + 1}（不再由 AI 代打）`, "role"); } catch (e) {}
    try { if (typeof showToast === "function") showToast(`<div class="t-title">↩️ ${esc(p.name)} 回来了</div><div class="t-sub">收回座位 ${seat + 1}</div>`, { kind: "role" }); } catch (e) {}
    try { _session.send({ type: "reclaimed", seat, clientId: msg.clientId, name: p.name }); } catch (e) {}
    if (typeof render === "function") render(); // 广播一帧
  }
  function onReclaimed(msg) { // 客人侧
    if (msg.clientId !== _myId) { refreshReclaimUI(); return; } // 别人认领了：刷新认领栏
    _seatOwners[msg.seat] = _myId;        // 我重新拥有该座位 → onInputRequest 会认我的请求
    removeReclaimUI();
    try { if (typeof showToast === "function") showToast(`<div class="t-title">↩️ 你已收回座位 ${msg.seat + 1}</div><div class="t-sub">轮到你时会弹出操作</div>`, { kind: "gain" }); } catch (e) {}
  }

  // 客人观战时刷新「认领座位」栏：自己无座位 且 存在被接管的座位 → 列出可认领按钮
  function refreshReclaimUI() {
    if (_role !== "guest" || !_online) return removeReclaimUI();
    if (mySeat() >= 0) return removeReclaimUI();       // 我已有座位，无需认领
    const g = game();
    const tos = g && g._takenOverSeats ? g._takenOverSeats : null;
    const seats = tos ? Object.keys(tos) : [];
    if (!seats.length) return removeReclaimUI();
    let bar = document.getElementById("netplay-reclaim");
    if (!bar) { bar = document.createElement("div"); bar.id = "netplay-reclaim"; document.body.appendChild(bar); }
    bar.innerHTML = '<span class="nr-label">🔁 有座位被 AI 接管，可认领：</span>';
    seats.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "nr-btn";
      btn.textContent = "认领 " + esc(tos[s]) + "（座位 " + (+s + 1) + "）";
      btn.onclick = () => reclaim(+s);
      bar.appendChild(btn);
    });
  }
  function removeReclaimUI() { const b = document.getElementById("netplay-reclaim"); if (b) b.remove(); }

  // 客人侧：自己的座位被房主 AI 接管 → 退出输入态、横幅改为「已被接管」（之后纯观战）
  function onTakenOver(msg) {
    if (msg.seat !== mySeat()) return;
    _guestBusy = false;
    delete _seatOwners[msg.seat]; // 本端也撤掉归属：不再期待该座位的请求
    // 清掉客人手里没答完的决策 UI（弹窗 / 棋盘选择高亮）。用 cancelPendingSelect 而非
    // resolveBoardSelect(null)——后者会把 null 传进 humanPickRole 等下游导致崩溃。
    try { if (typeof root.cancelPendingSelect === "function") root.cancelPendingSelect(); } catch (e) {}
    try { if (typeof hideModal === "function") hideModal(); } catch (e) {}
    // 横幅会被后续 state 广播覆盖，故用 toast 给一个持久通知
    try { if (typeof showToast === "function") showToast('<div class="t-title">🤖 你已被专家 AI 接管</div><div class="t-sub">' + esc(msg.reason || "超时/掉线") + " · 你现在是观战</div>", { kind: "role" }); } catch (e) {}
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------- 房主浮层：等待远程出手 + 代打兜底 ----------
  // 房主手动让 AI 接管（点浮层按钮）：接管首个挂起请求所属座位
  function manualTakeover() {
    for (const reqId in _pending) { aiTakeover(_pending[reqId].seat, "房主手动"); return; }
  }
  function showOverlay(seat, kind, payload) {
    let ov = document.getElementById("netplay-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "netplay-overlay";
      ov.innerHTML = '<div class="np-card"><div class="np-spin"></div><div class="np-msg"></div>' +
        '<div class="np-sub">3 分钟无操作将自动由专家 AI 接管</div>' +
        '<button type="button" class="np-takeover">🤖 立即让 AI 接管</button></div>';
      document.body.appendChild(ov);
      ov.querySelector(".np-takeover").onclick = manualTakeover;
    }
    const g = game();
    const nm = (g && g.players[seat] && g.players[seat].name) || ("座位 " + (seat + 1));
    ov.querySelector(".np-msg").textContent = "⏳ 等待 " + nm + " 出手……";
    ov.classList.add("show");
  }
  function removeOverlay() { const ov = document.getElementById("netplay-overlay"); if (ov) ov.classList.remove("show"); }

  root.PRNetPlay = {
    setup, teardown, maybeRoute, handleMessage, onPresence,
    reclaim, refreshReclaimUI,
    isOnline: () => _online,
    role: () => _role,
    mySeat,
    seatOwners: () => _seatOwners,
    guestBusy: () => _guestBusy,
    takenOver: () => Object.assign({}, _takenOver),
    _debug: () => ({ _role, _online, _seatOwners, _takenOver, pending: Object.keys(_pending) }),
  };
})(typeof window !== "undefined" ? window : this);
