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

  function setup(opts) {
    _session = opts.session || null;
    _role = opts.role || (_session && _session.role) || null;
    _myId = (opts.myId) || (_session && _session.clientId) || null;
    _seatOwners = opts.seatOwners || {};
    _online = !!opts.online;
    _takenOver = {};
    for (const k in _pending) delete _pending[k];
    _guestBusy = false;
  }
  function teardown() { _online = false; _session = null; _seatOwners = {}; _takenOver = {}; _guestBusy = false; removeOverlay(); for (const k in _pending) delete _pending[k]; }

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

  // 引擎里的 3 个输入原语在入口调用：返回 Promise 则走网络，返回 null 则走本地。
  function maybeRoute(kind, payload) {
    if (!shouldRoute()) return null;
    return request(kind, payload);
  }

  function request(kind, payload) {
    const seat = game()._actingSeat;
    const reqId = (_myId || "h") + ":" + (++_reqSeq);
    const snap = (typeof PRSpectate !== "undefined" && PRSpectate.snapshot) ? PRSpectate.snapshot() : null;
    showOverlay(seat, kind, payload);
    const p = new Promise((resolve) => { _pending[reqId] = { resolve, seat, kind, payload }; });
    try { _session.send({ type: "input-request", reqId, seat, kind, payload, snap }); } catch (e) {}
    return p;
  }

  function resolvePending(reqId, value) {
    const pend = _pending[reqId];
    if (!pend) return;                 // 过期/重复响应：忽略
    delete _pending[reqId];
    if (!hasPending()) removeOverlay();
    pend.resolve(value);
  }
  function hasPending() { for (const k in _pending) return true; return false; }

  // 房主代打：把当前挂起的请求转为本地输入（客人掉线/太慢时兜底）。
  // 之后该座位标记为已接管 → 后续输入都走本地，引擎无感。
  function takeOver() {
    const ids = Object.keys(_pending);
    if (!ids.length) return;
    const reqId = ids[0];
    const pend = _pending[reqId];
    _takenOver[pend.seat] = true;       // 该座位转本地
    delete _pending[reqId];
    removeOverlay();
    // 用本地 UI 重新征询（此时 shouldRoute()=false → 跑本地原语）
    localRun(pend.kind, pend.payload).then((v) => pend.resolve(v));
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
  }

  // ---------- 房主浮层：等待远程出手 + 代打兜底 ----------
  function showOverlay(seat, kind, payload) {
    let ov = document.getElementById("netplay-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "netplay-overlay";
      ov.innerHTML = '<div class="np-card"><div class="np-spin"></div><div class="np-msg"></div>' +
        '<button type="button" class="np-takeover">⏱ 房主代打这一步</button></div>';
      document.body.appendChild(ov);
      ov.querySelector(".np-takeover").onclick = takeOver;
    }
    const g = game();
    const nm = (g && g.players[seat] && g.players[seat].name) || ("座位 " + (seat + 1));
    ov.querySelector(".np-msg").textContent = "⏳ 等待 " + nm + " 出手……";
    ov.classList.add("show");
  }
  function removeOverlay() { const ov = document.getElementById("netplay-overlay"); if (ov) ov.classList.remove("show"); }

  root.PRNetPlay = {
    setup, teardown, maybeRoute, handleMessage,
    isOnline: () => _online,
    role: () => _role,
    mySeat,
    seatOwners: () => _seatOwners,
    guestBusy: () => _guestBusy,
    _debug: () => ({ _role, _online, _seatOwners, _takenOver, pending: Object.keys(_pending) }),
  };
})(typeof window !== "undefined" ? window : this);
