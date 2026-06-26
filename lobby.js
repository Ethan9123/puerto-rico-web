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

  function showRoom(panel, code) {
    const mode = PRNet.crossDevice() ? "跨设备 (Supabase)" : "本机多标签 (本地测试)";
    panel.querySelector(".lobby-actions").classList.add("hidden");
    const room = panel.querySelector(".lobby-room");
    room.classList.remove("hidden");
    room.querySelector(".lobby-code").textContent = code;
    room.querySelector(".lobby-mode").textContent = mode;
  }

  function buildPanel() {
    const box = document.querySelector(".setup-box");
    if (!box || document.getElementById("lobby-panel")) return;
    const myName = () => (document.getElementById("player-name") || {}).value || "玩家";

    const playersList = el("div", { class: "lobby-players" });
    const codeInput = el("input", { class: "lobby-join-code", maxlength: "6", placeholder: "房间码", style: "text-transform:uppercase;width:120px" });

    const onPresence = (list) => renderPresence(playersList, list);
    const onMessage = (msg) => { /* Phase 2：状态广播 / 远程出手将在此分发 */ };

    const btnCreate = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["创建房间"]);
    const btnJoin = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["加入"]);
    btnCreate.onclick = async () => {
      btnCreate.disabled = true;
      try { session = await PRNet.host({ name: myName(), onPresence, onMessage }); showRoom(panel, session.code); }
      catch (e) { btnCreate.disabled = false; alert("创建房间失败：" + (e && e.message || e)); }
    };
    btnJoin.onclick = async () => {
      const code = (codeInput.value || "").toUpperCase().trim();
      if (code.length < 4) { alert("请输入房间码"); return; }
      btnJoin.disabled = true;
      try { session = await PRNet.join(code, { name: myName(), onPresence, onMessage }); showRoom(panel, session.code); }
      catch (e) { btnJoin.disabled = false; alert("加入房间失败：" + (e && e.message || e)); }
    };
    const btnLeave = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["离开房间"]);
    btnLeave.onclick = () => { if (session) { session.close(); session = null; } panel.querySelector(".lobby-room").classList.add("hidden"); panel.querySelector(".lobby-actions").classList.remove("hidden"); btnCreate.disabled = false; btnJoin.disabled = false; };

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
        el("div", { class: "lobby-row" }, ["在房间里："]),
        playersList,
        el("div", { class: "lobby-hint" }, ["Phase 1：房间已打通。下一步接入「开始对战 / 实时观战 / 远程出手」。"]),
        el("div", { class: "lobby-row" }, [btnLeave]),
      ]),
    ]);
    // 放在「开始游戏」按钮之前
    const startBtn = document.getElementById("btn-start");
    box.insertBefore(panel, startBtn || null);
    window.addEventListener("pagehide", () => { if (session) session.close(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildPanel);
  else buildPanel();
})();
