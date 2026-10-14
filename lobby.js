// ============================================================
// lobby.js — 联机大厅、房间设置与重连
// ============================================================
(function () {
  "use strict";
  let session = null;

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === "class") e.className = attrs[k]; else if (k === "html") e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (children || []).forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  }

  function renderPresence(listEl, presence, config) {
    listEl.innerHTML = "";
    presence.forEach((m, i) => {
      const tag = m.role === "host" ? "👑 房主" : "玩家";
      const seat = config?.randomSeats ? '🎲' : `${i + 1}.`;
      listEl.appendChild(el("div", { class: "lobby-player" }, [`${seat} ${m.name || "玩家"} · ${tag}`]));
    });
    for (let i = 0; i < (config?.bots || 0); i++) {
      const seat = config.randomSeats ? '🎲' : `${presence.length + i + 1}.`;
      listEl.appendChild(el('div', {class: 'lobby-player lobby-bot'}, [`${seat} 🤖 机器人 ${i + 1} · L${config.botLevel}`]));
    }
    if (!presence.length) listEl.appendChild(el("div", { class: "lobby-empty" }, ["（暂无玩家）"]));
  }

  function showRoom(panel, code, role) {
    const mode = PRNet.crossDevice() ? "跨设备 (Cloudflare)" : "本机多标签 (本地测试)";
    panel.querySelector(".lobby-actions").classList.add("hidden");
    const room = panel.querySelector(".lobby-room");
    room.classList.remove("hidden");
    room.querySelector(".lobby-code").textContent = code;
    room.querySelector(".lobby-mode").textContent = mode;
    // 房主可「开始对战」；客人显示「等待房主开始 → 自动进入观战」
    const isHost = role === "host";
    if (isHost) try {
      const saved = JSON.parse(sessionStorage.getItem('prroom_settings_' + code) || 'null');
      if (saved) {
        room.querySelector('#room-bots').value = saved.bots;
        room.querySelector('#room-bot-level').value = saved.level;
        room.querySelector('#room-random-seats').checked = saved.random === true;
        if (saved.total) document.getElementById('player-count').value = saved.total;
      }
    } catch (e) {}
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
    // 房间码统一 4 位（net.js makeCode(4)）。此前生成 4 / 输入框 maxlength 6 / 校验 <4 / 截断 6 三处不一致。
    const codeInput = el("input", { class: "lobby-join-code", maxlength: "4", placeholder: "房间码", autocapitalize: "characters", autocomplete: "off", style: "text-transform:uppercase;width:120px" });
    const botCount = el('select', {id: 'room-bots'}, [el('option', {value: 'auto'}, ['按总人数补齐']), ...Array.from({length: 5}, (_, i) => el('option', {value: String(i)}, [`${i} 个`]))]);
    const botLevel = el('select', {id: 'room-bot-level'}, ['入门', '进化', '普通', '困难', '专家', '宗师'].map((name, i) => el('option', {value: String(i + 1)}, [`L${i + 1} ${name}`])));
    botLevel.value = '3';
    const randomSeats = el('input', {id: 'room-random-seats', type: 'checkbox'});
    const settingsSummary = el('div', {class: 'lobby-hint room-settings'});
    const readiness = el('div', {class: 'lobby-hint room-readiness', role: 'status', 'aria-live': 'polite'});
    const connection = el('span', {class: 'lobby-connection', role: 'status', 'aria-live': 'polite'}, ['连接中……']);
    const errorLine = el('div', {class: 'lobby-error hidden', role: 'alert'});
    let lastSettings = '';
    let roomConfig = null, connecting = false, connectionReady = false, starting = false;
    const peopleCount = () => 1 + new Set((session?.presence() || []).filter(p => p.role === 'guest').map(p => p.token)).size;
    const currentBots = () => botCount.value === 'auto' ? Math.max(0, Number(document.getElementById('player-count').value) - peopleCount()) : Number(botCount.value);
    function showSettings(config) {
      roomConfig = config;
      settingsSummary.textContent = `${config.humans} 位真人 + ${config.bots} 个机器人（L${config.botLevel}） · ${config.randomSeats ? '随机座位，开局时抽签' : '按加入顺序入座'} · 最多 5 个座位`;
      renderPresence(playersList, session?.presence() || [], config);
    }
    function refreshStart() {
      if (session?.role !== 'host') return;
      const humans = peopleCount(), bots = currentBots(), total = humans + bots;
      let problem = '';
      if (humans > 5) problem = '真人超过 5 位，请多出的朋友先离开房间，开局后可回来观战。';
      else if (total > 5) problem = `已超出 ${total - 5} 个座位，请减少机器人数量。`;
      else if (total < 2) problem = '还需要 1 位朋友或 1 个机器人才能开局。';
      readiness.textContent = connecting ? '正在恢复房间设置与存档……' : !connectionReady ? '正在恢复连接，连上后即可开局。' : problem || `可以开始 ${total} 人对局${total === 2 ? '（双人规则）' : ''}。`;
      readiness.classList.toggle('room-warning', !!problem || !connectionReady);
      btnHostStart.disabled = !!problem || !connectionReady || starting || connecting;
      btnHostStart.title = btnHostStart.disabled ? readiness.textContent : '';
      addBot.disabled = total >= 5;
      removeBot.disabled = bots === 0;
      botLevel.disabled = bots === 0;
      for (const option of botCount.options) if (option.value !== 'auto') option.disabled = humans + Number(option.value) > 5;
    }
    function publishSettings() {
      if (!session || session.role !== 'host') return;
      if (!document.getElementById('game-screen').classList.contains('hidden')) return;
      try { sessionStorage.setItem('prroom_settings_' + session.code, JSON.stringify({bots: botCount.value, level: botLevel.value, random: randomSeats.checked, total: document.getElementById('player-count').value})); } catch (e) {}
      const config = {type: 'room-config', humans: peopleCount(), bots: currentBots(), botLevel: Number(botLevel.value), randomSeats: randomSeats.checked};
      showSettings(config);
      refreshStart();
      const key = JSON.stringify(config);
      if (key !== lastSettings) {
        lastSettings = key;
        session.send(config).then(status => { if (status !== 'ok' && lastSettings === key) lastSettings = ''; });
      }
    }
    const addBot = el('button', {type: 'button', class: 'qs-btn'}, ['＋ 添加机器人']);
    const removeBot = el('button', {type: 'button', class: 'qs-btn'}, ['− 移除机器人']);
    addBot.onclick = () => {
      if (peopleCount() + currentBots() >= 5) { netError('无法添加机器人', new Error('最多 5 个座位，请减少机器人数量')); return; }
      botCount.value = String(currentBots() + 1); publishSettings();
    };
    removeBot.onclick = () => { botCount.value = String(Math.max(0, currentBots() - 1)); publishSettings(); };
    botCount.onchange = botLevel.onchange = randomSeats.onchange = publishSettings;
    document.getElementById('player-count').addEventListener('change', publishSettings);

    let _prevPresence = 0;
    const onPresence = (list) => {
      renderPresence(playersList, list, roomConfig);
      // 房主：客人掉线（离场）→ 立即由专家 AI 接管其座位
      if (typeof PRNetPlay !== "undefined") PRNetPlay.onPresence(list);
      // 房主：有新客人进房（人数增加）→ 立即推一帧当前状态，让新人马上看到棋盘（观战/认领）
      if (session && session.role === "host" && list.length > _prevPresence && typeof PRSpectate !== "undefined" && PRSpectate.isHosting && PRSpectate.isHosting()) PRSpectate.pushNow();
      _prevPresence = list.length;
      publishSettings();
      // 客人：把房主名字告诉观战层（横幅显示）；房主断线 / 重连时更新横幅
      if (session && session.role === "guest" && typeof PRSpectate !== "undefined") {
        const host = list.find((m) => m && m.role === "host");
        if (host) {
          PRSpectate.startSpectating(session, { hostName: host.name });
          if (PRSpectate.onHostBack) PRSpectate.onHostBack(host.name);
        } else if (PRSpectate.isSpectating && PRSpectate.isSpectating()) {
          PRSpectate.onHostLeft();
        }
      }
    };
    // 本端连接状态（net.js 上报：频道 CLOSED/CHANNEL_ERROR/TIMED_OUT/重新 SUBSCRIBED，及浏览器 OFFLINE/ONLINE）
    const onStatus = (status, detail) => {
      const bad = (status === "OFFLINE" || status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT");
      const wasReady = connectionReady;
      if (bad || status === 'ONLINE') connectionReady = false;
      else if (status === 'SUBSCRIBED') connectionReady = true;
      connection.textContent = connectionReady ? '● 已连接' : status === 'OFFLINE' ? '● 网络已断开，等待恢复' : '● 正在重连……';
      connection.classList.toggle('room-warning', !connectionReady);
      refreshStart();
      if (session && session.role === "guest" && typeof PRSpectate !== "undefined" && PRSpectate.onConnStatus) PRSpectate.onConnStatus(status, detail);
      else if (session && session.role === "host" && typeof showToast === "function") {
        if (bad && wasReady) showToast('<div class="t-title">⚠️ 你（房主）的连接断了</div><div class="t-sub">正在重连……客人那边会看到提示</div>', { kind: "warn", duration: 4000 });
        else if (status === "SUBSCRIBED" && !wasReady) showToast('<div class="t-title">✅ 已重新连上</div>', { kind: "role" });
      }
      if (status === 'SUBSCRIBED') publishSettings();
    };
    // 收到广播：input-request/response（远程出手）→ PRNetPlay；state/gameover（观战）→ PRSpectate
    const onMessage = (msg) => {
      if (msg?.type === 'room-config' && session?.role === 'guest') showSettings(msg);
      if (typeof PRNetPlay !== "undefined") PRNetPlay.handleMessage(msg);
      if (typeof PRSpectate !== "undefined") PRSpectate.handleMessage(msg);
    };

    // 联机失败一律走这里：此前用原生 alert()，在手机上生硬、还会把 `[object Event]` 直接甩给用户。
    // 项目本来就有 showToast（game.js:764），复用它；showToast 不可用时才退回 alert。
    function netError(prefix, e) {
      const hint = panel.querySelector(".lobby-actions .lobby-hint");
      if (hint) hint.textContent = prefix + "：" + ((e && e.message) || "连接失败，请稍后重试");
      const msg = (e && e.message) || (typeof e === "string" ? e : "") || "未知错误";
      errorLine.textContent = prefix + '：' + msg;
      errorLine.classList.remove('hidden');
      if (typeof showToast === "function") {
        const safe = text => { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; };
        showToast('<div class="t-title">⚠️ ' + safe(prefix) + '</div><div class="t-sub">' + safe(msg) + "</div>", { kind: "role", duration: 5000 });
      } else { alert(prefix + "：" + msg); }
    }
    const btnCreate = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["创建房间"]);
    const btnJoin = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["加入"]);
    function setConnecting(value) {
      connecting = value;
      btnCreate.disabled = btnJoin.disabled = value;
      btnLeave.disabled = value;
      codeInput.disabled = value;
      setLocalStartEnabled(!value && !session);
      if (value) errorLine.classList.add('hidden');
      refreshStart();
    }
    function roomOpened() {
      lastSettings = ''; roomConfig = null; starting = false;
      connectionReady = true;
      connection.textContent = '● 已连接';
      connection.classList.remove('room-warning');
      showRoom(panel, session.code, session.role);
      publishSettings();
    }
    btnCreate.onclick = async () => {
      if (connecting || session) return;
      setConnecting(true);
      btnCreate.textContent = "创建中……";
      try {
        session = await PRNet.host({ name: myName(), onPresence, onMessage, onStatus });
        window.PR_SESSION = session;
        // 此前只有客人记 prnet_room，房主什么都不记 → 房主一刷新就以 guest 身份重连进自己的房间，
        // 引擎状态全没了，客人永远卡在「等待重连」。现在记下角色，重连走 attemptRehost。
        try { sessionStorage.setItem("prnet_room", session.code); sessionStorage.setItem("prnet_role", "host"); sessionStorage.setItem("prnet_name", myName()); } catch (e) {}
        setLocalStartEnabled(false);   // 联机会话期间禁掉单机「开始游戏」，见下
        roomOpened();
      } catch (e) {
        netError("创建房间失败", e);
      } finally {
        // ⚠ 必须 finally：此前只在 catch 里恢复，一旦 host() 永不落定（订阅回调漏处理
        //   CHANNEL_ERROR/TIMED_OUT/CLOSED），按钮就永久变灰且零提示。net.js 那边已加超时，
        //   这里再兜一层，保证按钮状态不会与实际不符。
        setConnecting(false);
        btnCreate.textContent = "创建房间";
      }
    };
    async function attemptJoin() {
      if (connecting || session) return;
      const code = (codeInput.value || "").toUpperCase().trim();
      if (!code) throw new Error("请输入房间码");
      if (code.length !== 4) throw new Error("房间码是 4 位（不含易混的 0/O/1/I/L），请核对后重试");
      if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(code)) throw new Error('房间码只能使用大写字母和 2–9，不含 O/I/L，请核对后重试');
      setConnecting(true);
      btnJoin.textContent = '加入中……';
      try {
        session = await PRNet.join(code, { name: myName(), onPresence, onMessage, onStatus });
        window.PR_SESSION = session;
        // 记住本标签所在房间 + 名字 → 刷新/断线后自动重连（sessionStorage 仅本标签、刷新存活）
        try { sessionStorage.setItem("prnet_room", session.code); sessionStorage.setItem("prnet_role", "guest"); sessionStorage.setItem("prnet_name", myName()); } catch (e) {}
        if (typeof PRSpectate !== "undefined") PRSpectate.startSpectating(session, {});
        roomOpened();
        setLocalStartEnabled(false);
      } finally { setConnecting(false); btnJoin.textContent = '加入'; }
    }
    btnJoin.onclick = () => attemptJoin().catch((e) => netError("加入房间失败", e));
    codeInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); btnJoin.click(); } });
    // 房主刷新/断线后回来：用【同一个房间码】重开房间（客人的 presence 会看到房主回来），
    // 再取回该房间的对局存档（本地 / KV 取新），以房主身份接着跑。
    // 顺序有讲究：restoreGame → PRNetPlay.setup（要 G._seatOwners）→ startHosting → 再起主循环；
    // 若先起主循环，第一个远程座位的输入会在 setup 之前被当成本地输入弹给房主。
    async function attemptRehost(code) {
      setConnecting(true);
      try {
        session = await PRNet.host({ code, name: myName(), onPresence, onMessage, onStatus });
        window.PR_SESSION = session;
        setLocalStartEnabled(false);
        roomOpened();
        const saved = (typeof getBestRoomSave === "function") ? await getBestRoomSave(session.code) : null;
        if (!saved) return;
        if (typeof restoreGame !== "function" || !restoreGame(saved)) { netError('续局失败', new Error('上一局存档已失效，可以直接开新局')); return; }
        const seatOwners = (typeof G !== "undefined" && G && G._seatOwners) || {};
        if (typeof PRNetPlay !== "undefined") PRNetPlay.setup({ session, role: "host", seatOwners, hostSeat: G._hostSeat, seatTokens: G._seatTokens, takenOver: G._takenOverSeats, myToken: session.token, myId: session.clientId, online: true });
        if (typeof PRSpectate !== "undefined") PRSpectate.startHosting(session);
        if (typeof resumeGame === "function") resumeGame(saved, true);
        try { if (typeof G !== "undefined" && G && G.logEvent) G.logEvent("🔄 房主重连，对局从存档继续", "role"); } catch (e) {}
      } finally { setConnecting(false); }
    }
    // 确认名单后生成实际座位；随机模式在开局时抽签。
    const btnHostStart = el("button", { class: "qs-btn lobby-btn lobby-start-btn", type: "button" }, ["▶ 开始对战（房主）"]);
    btnHostStart.onclick = () => {
      if (!session || session.role !== "host" || !connectionReady || starting || connecting) return;
      const guests = (session.presence ? session.presence() : []).filter((m) => m && m.role === "guest" && m.token);
      let plan;
      try { plan = PRRoomPlan({host: {token: session.token, name: myName()}, guests, total: Number(document.getElementById('player-count').value), bots: botCount.value, randomSeats: randomSeats.checked}); }
      catch (e) { netError('无法开始对战', e); return; }
      starting = true; refreshStart();
      const {seatOwners, hostSeat} = plan;
      if (typeof PRNetPlay !== "undefined") PRNetPlay.setup({ session, role: "host", seatOwners, hostSeat, myToken: session.token, myId: session.clientId, online: true });
      if (typeof PRSpectate !== "undefined") PRSpectate.startHosting(session);
      if (typeof startGame === "function") startGame({...plan, online: true, botLevel: Number(botLevel.value), randomSeats: randomSeats.checked});
    };
    const btnLeave = el("button", { class: "qs-btn lobby-btn", type: "button" }, ["离开房间"]);
    btnLeave.onclick = () => {
      try { sessionStorage.removeItem("prnet_room"); sessionStorage.removeItem('prnet_role'); } catch (e) {} // 主动离开 → 不再自动重连
      if (typeof PRSpectate !== "undefined") { PRSpectate.stopHosting(); PRSpectate.stopSpectating(); }
      if (typeof PRNetPlay !== "undefined") PRNetPlay.teardown();
      if (session) { session.close(); session = null; } window.PR_SESSION = null;
      lastSettings = ''; roomConfig = null; starting = false;
      errorLine.classList.add('hidden');
      panel.querySelector(".lobby-room").classList.add("hidden"); panel.querySelector(".lobby-actions").classList.remove("hidden");
      btnCreate.disabled = false; btnJoin.disabled = false;
      setLocalStartEnabled(true);   // 离开房间 → 单机「开始游戏」恢复可用（否则会把人锁死在联机态）
    };

    const panel = el("fieldset", { class: "module-select", id: "lobby-panel" }, [
      el("legend", null, ["🌐 联机对战 (Beta)"]),
      errorLine,
      el("div", { class: "lobby-actions" }, [
        el("div", { class: "lobby-row" }, [btnCreate]),
        el("div", { class: "lobby-row" }, [codeInput, btnJoin]),
        el("div", { class: "lobby-hint", html: PRNet.crossDevice() ? "联机服务已配置，创建或加入房间后连接。" : "离线模式：当前为<b>本机多标签</b>测试模式（同一浏览器开两个标签可联机）。" }),
      ]),
      el("div", { class: "lobby-room hidden" }, [
        el("div", { class: "lobby-row" }, [el("span", null, ["房间码："]), el("b", { class: "lobby-code", style: "font-size:22px;letter-spacing:3px;color:#f3c969" }, ["----"])]),
        el("div", { class: "lobby-row lobby-mode-row" }, [connection, el("span", { class: "lobby-mode" }, ["—"])]),
        el("div", { class: "lobby-invite lobby-row hidden" }, [
          el("span", null, ["邀请链接："]),
          el("a", { class: "lobby-invite-link", target: "_blank", rel: "noopener", style: "color:#7fc7ff;word-break:break-all;font-size:12px" }, ["—"]),
          el("button", { class: "qs-btn lobby-copy", type: "button", style: "font-size:12px;padding:3px 10px" }, ["复制链接"]),
        ]),
        el("div", { class: "lobby-row" }, ["本局玩家与机器人："]),
        playersList,
        settingsSummary,
        el("div", { class: "lobby-host-start hidden" }, [
          el('div', {class: 'lobby-row'}, [el('label', null, ['机器人：', botCount]), addBot, removeBot]),
          el('div', {class: 'lobby-row'}, [el('label', null, ['机器人难度：', botLevel])]),
          el('label', null, [randomSeats, ' 随机座位（含房主、朋友和机器人）']),
          readiness,
          el('div', {class: 'lobby-row'}, [btnHostStart]),
          el('div', {class: 'lobby-hint'}, ['人数按真人和机器人合计，最多 5 人；机器人可在开局后由新朋友认领。'])
        ]),
        el("div", { class: "lobby-hint lobby-guest-wait hidden" }, ["⏳ 等待房主开始……开局后自动入座，轮到你时会提示操作。"]),
        el("div", { class: "lobby-row" }, [btnLeave]),
      ]),
    ]);
    // 放在「开始游戏」按钮之前
    const startBtn = document.getElementById("btn-start");
    box.insertBefore(panel, startBtn || null);
    // 在房间里时禁用单机「开始游戏」：面板就插在它上方，很容易误点；而客人一旦开了本地局，
    // 房主的下一帧 state 广播会经 applyState → setGlobalGame 把 G 整个换掉，本地局凭空消失。
    function setLocalStartEnabled(on) {
      if (!startBtn) return;
      startBtn.disabled = !on;
      startBtn.title = on ? "" : "正在联机房间中——离开房间后才能开始单机对局";
      startBtn.style.opacity = on ? "" : "0.5";
    }
    window.addEventListener("pagehide", () => { if (session) session.close(); });

    const hint = panel.querySelector(".lobby-actions .lobby-hint");
    let invited = null, reconnectRoom = null;
    try { invited = new URLSearchParams(location.search).get("room"); } catch (e) {}
    try { reconnectRoom = sessionStorage.getItem("prnet_room"); } catch (e) {}
    let reconnectRole = null; try { reconnectRole = sessionStorage.getItem("prnet_role"); } catch (e) {}
    if (invited && reconnectRoom && invited.toUpperCase().trim() === reconnectRoom.toUpperCase().trim()) invited = null;
    if (reconnectRoom && !invited) try { const name = sessionStorage.getItem('prnet_name'); if (name) document.getElementById('player-name').value = name; } catch (e) {}
    if (reconnectRoom && !invited && reconnectRole === "host") {
      codeInput.value = reconnectRoom.toUpperCase().trim().slice(0, 4);
      if (hint) hint.innerHTML = "🔄 正在以房主身份重开房间 <b style='color:#f3c969'>" + codeInput.value + "</b>……";
      attemptRehost(codeInput.value).catch((e) => {
        try { sessionStorage.removeItem("prnet_room"); sessionStorage.removeItem("prnet_role"); } catch (e2) {}
        netError('房主重连失败', e);
      });
    } else if (reconnectRoom && !invited) {
      // 断线/刷新重连：本标签刷新前在某房间里 → 自动回去（无需重输房间码；房主据 token 自动还座位）
      codeInput.value = reconnectRoom.toUpperCase().trim().slice(0, 4);
      if (hint) hint.innerHTML = "🔄 正在重连房间 <b style='color:#f3c969'>" + codeInput.value + "</b>……";
      attemptJoin().catch(() => { try { sessionStorage.removeItem("prnet_room"); } catch (e) {} if (hint) hint.innerHTML = "重连失败（房主可能已离开）。需要的话可手动重新加入。"; });
    } else if (invited) {
      // 邀请链接：?room=CODE 打开时，自动填好房间码并提示加入（房主需先建好房间）
      codeInput.value = invited.toUpperCase().trim().slice(0, 4);
      if (hint) hint.innerHTML = "🎟 你被邀请加入房间 <b style='color:#f3c969'>" + codeInput.value + "</b> —— 填好名字点「加入」即可（需房主已建好房间）。";
      codeInput.scrollIntoView({ block: "center" });
      btnJoin.classList.add("lobby-pulse");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildPanel);
  else buildPanel();
})();
