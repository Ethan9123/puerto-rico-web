// ============================================================
// lobby.js — 联机对战大厅 UI（Phase 1：建/加入房间 + 在场名单）
// ============================================================
// 把一个「🌐 联机对战」面板注入设置页。Phase 1 只做房间与在场（证明传输打通）；
// 开始对战 / 实时观战 / 远程出手在后续阶段接入（复用 serializeGame/render）。
(function () {
  "use strict";
  let session = null;

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === "class") e.className = attrs[k]; else if (k === "html") e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (children || []).forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  }

  function renderPresence(listEl, presence) {
    listEl.innerHTML = "";
    presence.forEach((m, i) => {
      const tag = m.role === "host" ? "👑 房主" : "玩家";
      listEl.appendChild(el("div", { class: "lobby-player" }, [`${i + 1}. ${m.name || "玩家"} · ${tag}`]));
    });
    if (!presence.length) listEl.appendChild(el("div", { class: "lobby-empty" }, ["（暂无玩家）"]));
  }

  function showRoom(panel, code, role) {
    const mode = PRNet.crossDevice() ? "跨设备 (Supabase)" : "本机多标签 (本地测试)";
    panel.querySelector(".lobby-actions").classList.add("hidden");
    const room = panel.querySelector(".lobby-room");
    room.classList.remove("hidden");
    room.querySelector(".lobby-code").textContent = code;
    room.querySelector(".lobby-mode").textContent = mode;
    // 房主可「开始对战」；客人显示「等待房主开始 → 自动进入观战」
    const isHost = role === "host";
    const startWrap = room.querySelector(".lobby-host-start");
    const waitHint = room.querySelector(".lobby-guest-wait");
    if (startWrap) startWrap.classList.toggle("hidden", !isHost);
    if (waitHint) waitHint.classList.toggle("hidden", isHost);
    // 房主：展示可分享的邀请链接（手机/群友打开即自动填好房间码）
    const inviteWrap = room.querySelector(".lobby-invite");
    if (inviteWrap) {
      inviteWrap.classList.toggle("hidden", !isHost);
      if (isHost) {
        const link = inviteLink(code);
        const linkEl = inviteWrap.querySelector(".lobby-invite-link");
        linkEl.textContent = link;
        linkEl.setAttribute("href", link);
        const copyBtn = inviteWrap.querySelector(".lobby-copy");
        copyBtn.onclick = () => {
          const done = () => { copyBtn.textContent = "已复制 ✓"; setTimeout(() => (copyBtn.textContent = "复制链接"), 1500); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done).catch(() => prompt("复制此链接发给群友：", link));
          else prompt("复制此链接发给群友：", link);
        };
      }
    }
  }
  function inviteLink(code) {
    try { return location.origin + location.pathname + "?room=" + encodeURIComponent(code); }
    catch (e) { return "?room=" + code; }
  }

  function buildPanel() {
    const box = document.querySelector(".setup-box");
    if (!box || document.getElementById("lobby-panel")) return;
    const myName = () => (document.getElementById("player-name") || {}).value || "玩家";

    const playersList = el("div", { class: "lobby-players" });
    const codeInput = el("input", { class: "lobby-join-code", maxlength: "6", placeholder: "房间码", style: "text-transform:uppercase;width:120px" });

    const onPresence = (list) => {
      renderPresence(playersList, list);
      // 房主：客人掉线（离场）→ 立即由专家 AI 接管其座位
      if (typeof PRNetPlay !== "undefined") PRNetPlay.onPresence(list);
      // 客人：把房主名字告诉观战层（横幅显示），房主在场时更新
      if (session && session.role === "guest" && typeof PRSpectate !== "undefined") {
        const host = list.find((m) => m && m.role === "host");
        if (host) PRSpectate.startSpectating(session, { hostName: host.name });
      }
    };
    // 收到广播：input-request/response（远程出手）→ PRNetPlay；state/gameover（观战）→ PRSpectate
    const onMessage = (msg) => {
      if (typeof PRNetPlay !== "undefined") PRNetPlay.handleMessage(msg);
      if (typeof PRSpectate !== "undefined") PRSpectate.handleMessage(msg);
    };

    const btnCreate = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["创建房间"]);
    const btnJoin = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["加入"]);
    btnCreate.onclick = async () => {
      btnCreate.disabled = true;
      try { session = await PRNet.host({ name: myName(), onPresence, onMessage }); window.PR_SESSION = session; showRoom(panel, session.code, session.role); }
      catch (e) { btnCreate.disabled = false; alert("创建房间失败：" + (e && e.message || e)); }
    };
    btnJoin.onclick = async () => {
      const code = (codeInput.value || "").toUpperCase().trim();
      if (code.length < 4) { alert("请输入房间码"); return; }
      btnJoin.disabled = true;
      try {
        session = await PRNet.join(code, { name: myName(), onPresence, onMessage });
        window.PR_SESSION = session;
        if (typeof PRSpectate !== "undefined") PRSpectate.startSpectating(session, {});
        showRoom(panel, session.code, session.role);
      }
      catch (e) { btnJoin.disabled = false; alert("加入房间失败：" + (e && e.message || e)); }
    };
    // 房主：开始对战 —— 座位 0=房主本地；在场客人按加入顺序占座位 1..k；其余=AI。
    const btnHostStart = el("button", { class: "qs-btn lobby-btn lobby-start-btn", type: "button" }, ["▶ 开始对战（房主）"]);
    btnHostStart.onclick = () => {
      if (!session || session.role !== "host") return;
      const n = parseInt((document.getElementById("player-count") || {}).value) || 3;
      const guests = (session.presence ? session.presence() : []).filter((m) => m && m.role === "guest");
      const seatOwners = {}, names = {};
      let seat = 1;
      for (const g of guests) { if (seat >= n) break; seatOwners[seat] = g.clientId; names[seat] = g.name || ("玩家" + (seat + 1)); seat++; }
      if (typeof PRNetPlay !== "undefined") PRNetPlay.setup({ session, role: "host", seatOwners, myId: session.clientId, online: true });
      if (typeof PRSpectate !== "undefined") PRSpectate.startHosting(session);
      if (typeof startGame === "function") startGame({ online: true, seatOwners, names }); // render() 会广播首帧
    };
    const btnLeave = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["离开房间"]);
    btnLeave.onclick = () => {
      if (typeof PRSpectate !== "undefined") { PRSpectate.stopHosting(); PRSpectate.stopSpectating(); }
      if (typeof PRNetPlay !== "undefined") PRNetPlay.teardown();
      if (session) { session.close(); session = null; } window.PR_SESSION = null;
      panel.querySelector(".lobby-room").classList.add("hidden"); panel.querySelector(".lobby-actions").classList.remove("hidden");
      btnCreate.disabled = false; btnJoin.disabled = false;
    };

    const panel = el("fieldset", { class: "module-select", id: "lobby-panel" }, [
      el("legend", null, ["🌐 联机对战 (Beta)"]),
      el("div", { class: "lobby-actions" }, [
        el("div", { class: "lobby-row" }, [btnCreate]),
        el("div", { class: "lobby-row" }, [codeInput, btnJoin]),
        el("div", { class: "lobby-hint", html: PRNet.crossDevice() ? "已连 Supabase：可跨设备对战。" : "未配置 Supabase：当前为<b>本机多标签</b>测试模式（同一浏览器开两个标签可联机）。" }),
      ]),
      el("div", { class: "lobby-room hidden" }, [
        el("div", { class: "lobby-row" }, [el("span", null, ["房间码："]), el("b", { class: "lobby-code", style: "font-size:22px;letter-spacing:3px;color:#f3c969" }, ["----"])]),
        el("div", { class: "lobby-row lobby-mode-row" }, [el("span", null, ["连接："]), el("span", { class: "lobby-mode" }, ["—"])]),
        el("div", { class: "lobby-invite lobby-row hidden" }, [
          el("span", null, ["邀请链接："]),
          el("a", { class: "lobby-invite-link", target: "_blank", rel: "noopener", style: "color:#7fc7ff;word-break:break-all;font-size:12px" }, ["—"]),
          el("button", { class: "qs-btn lobby-copy", type: "button", style: "font-size:12px;padding:3px 10px" }, ["复制链接"]),
        ]),
        el("div", { class: "lobby-row" }, ["在房间里："]),
        playersList,
        el("div", { class: "lobby-row lobby-host-start hidden" }, [btnHostStart]),
        el("div", { class: "lobby-hint lobby-host-start hidden" }, ["用上方设置（人数/难度/扩展）开一局；在场客人按加入顺序分到座位一起玩，多余座位为 AI。"]),
        el("div", { class: "lobby-hint lobby-guest-wait hidden" }, ["⏳ 等待房主开始……开始后你将自动进入<b>实时观战</b>。"]),
        el("div", { class: "lobby-row" }, [btnLeave]),
      ]),
    ]);
    // 放在「开始游戏」按钮之前
    const startBtn = document.getElementById("btn-start");
    box.insertBefore(panel, startBtn || null);
    window.addEventListener("pagehide", () => { if (session) session.close(); });

    // 邀请链接：?room=CODE 打开时，自动填好房间码并提示加入（房主需先建好房间）
    let invited = null;
    try { invited = new URLSearchParams(location.search).get("room"); } catch (e) {}
    if (invited) {
      codeInput.value = invited.toUpperCase().trim().slice(0, 6);
      const hint = panel.querySelector(".lobby-actions .lobby-hint");
      if (hint) hint.innerHTML = "🎟 你被邀请加入房间 <b style='color:#f3c969'>" + codeInput.value + "</b> —— 填好名字点「加入」即可（需房主已建好房间）。";
      codeInput.scrollIntoView({ block: "center" });
      btnJoin.classList.add("lobby-pulse");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildPanel);
  else buildPanel();
})();
