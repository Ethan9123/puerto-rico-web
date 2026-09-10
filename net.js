// ============================================================
// net.js — 联机对战网络层（Phase 1：传输抽象 + 房间 + 在场名单）
// ============================================================
// 架构：主机权威（host-authoritative）。房主浏览器跑真引擎、掌随机/AI；客人渲染房主广播的
// 状态、轮到自己时把动作发回房主。本文件只负责“传输 + 房间 + 谁在房里”，与游戏引擎解耦。
//
// 两种传输，按配置自动选择：
//   SupabaseTransport — 跨设备：supabase-js 广播频道 + presence（需 window.PR_SUPABASE={url,key}）
//   LocalTransport    — 同浏览器多标签：localStorage 事件，用于本地两标签自测（无需任何后端）
//
// 对外 API：
//   await PRNet.host({name, onMessage, onPresence})            -> session（自动生成房间码）
//   await PRNet.join(code, {name, onMessage, onPresence})      -> session
//   session = { code, role:'host'|'guest', clientId, send(obj), presence():[...], close() }
// ============================================================
(function (root) {
  "use strict";
  const SUBSCRIBE_TIMEOUT_MS = 12000; // 订阅实时频道的上限（含 WebSocket 建连）
  const JOIN_WAIT_MS = 10000;         // 等房主出现在 presence 里的上限（弱网下 3.5s 太短）
  const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 去掉易混的 0/O/1/I/L
  function makeCode(n) { let s = ""; for (let i = 0; i < (n || 4); i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return s; }
  function makeId() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
  function hasSupabase() { return !!(root.PR_SUPABASE && root.PR_SUPABASE.url && root.PR_SUPABASE.key); }

  // 带超时的脚本加载。<script> 的 onerror 在被代理/拦截的网络下不一定触发，
  // 没有超时就会永久挂起（正是「按钮永远变灰、零提示」那类成因）。
  function loadScript(src, timeoutMs) {
    return new Promise((res, rej) => {
      const el = document.createElement("script");
      let done = false;
      const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); fn(arg); };
      const timer = setTimeout(() => finish(rej, new Error("加载超时：" + src)), timeoutMs || 15000);
      el.src = src;
      el.onload = () => finish(res);
      el.onerror = () => finish(rej, new Error("加载失败：" + src));
      document.head.appendChild(el);
    });
  }
  // 稳定身份令牌：按房间码存【sessionStorage】（每标签页独立）。
  //   - 刷新/断网重连：同一标签 sessionStorage 不变 → token 不变 → 房主据 token 自动接回原座位；
  //   - 同浏览器多标签：每标签各自独立 → 房主和客人 token 不会相同（localStorage 会相同，故弃用）；
  //   - 整页关闭：sessionStorage 清空 → 重开是「新玩家」（走手动认领）——关整页本就是更强的离开信号。
  function roomToken(code) {
    const k = "prnet_token_" + code;
    try { let t = sessionStorage.getItem(k); if (!t) { t = "tok-" + Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(k, t); } return t; }
    catch (e) { return "tok-" + Math.random().toString(36).slice(2); }
  }

  // ---------- LocalTransport：localStorage 事件（仅同浏览器多标签，用于自测） ----------
  // 'storage' 事件只在【其它】标签触发，天然适合做标签间 pub/sub。
  function LocalTransport(room, clientId) {
    const PFX = "prnet:" + room + ":";
    const MSG = PFX + "msg";
    let onMsg = null, onPres = null, hbTimer = null, gcTimer = null;
    const self = { meta: null };
    function presKey(id) { return PFX + "p:" + id; }
    function listPresence() {
      const now = Date.now(), out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(PFX + "p:") === 0) {
          try { const v = JSON.parse(localStorage.getItem(k)); if (v && now - v.ts < 9000) out.push(v.meta); } catch (e) {}
        }
      }
      return out.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    }
    function beat() { try { localStorage.setItem(presKey(clientId), JSON.stringify({ ts: Date.now(), meta: self.meta })); } catch (e) {} }
    function onStorage(e) {
      if (!e.key || e.key.indexOf(PFX) !== 0) return;
      if (e.key === MSG && e.newValue) { try { const p = JSON.parse(e.newValue); if (p && p.from !== clientId && onMsg) onMsg(p.msg); } catch (er) {} }
      else if (e.key.indexOf(PFX + "p:") === 0 && onPres) onPres(listPresence());
    }
    return {
      async open(meta, cb) { onMsg = cb.onMessage; onPres = cb.onPresence; self.meta = meta;
        window.addEventListener("storage", onStorage);
        beat(); hbTimer = setInterval(beat, 3000);
        gcTimer = setInterval(() => onPres && onPres(listPresence()), 4000);
        setTimeout(() => onPres && onPres(listPresence()), 50);
      },
      send(msg) { try { localStorage.setItem(MSG, JSON.stringify({ from: clientId, t: Date.now(), msg })); } catch (e) {} },
      presence() { return listPresence(); },
      updateMeta(meta) { self.meta = meta; beat(); },
      close() { window.removeEventListener("storage", onStorage); clearInterval(hbTimer); clearInterval(gcTimer); try { localStorage.removeItem(presKey(clientId)); } catch (e) {} },
    };
  }

  // ---------- SupabaseTransport：广播频道 + presence（跨设备） ----------
  let _supaClient = null;
  async function supa() {
    if (_supaClient) return _supaClient;
    if (!root.supabase || !root.supabase.createClient) {
      // supabase-js 优先走**同源自托管**副本 vendor/supabase.js（`npm run vendor:supabase` 更新）。
      // 此前只从 jsdelivr 动态加载，CDN 一旦不可达联机就整个用不了——而 README/CN-ACCESS.md
      // 记录过 GFW 下 CDN 不稳定，jsdelivr 正是最常被挡的那类。实测在受限网络下
      // 报的是 `创建房间失败：[object Event]`，用户完全无从判断。
      // 自托管与游戏本体同源：游戏能打开，库就能加载。CDN 仅作兜底。
      const sources = ["vendor/supabase.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"];
      let lastErr = null;
      for (const src of sources) {
        try {
          await loadScript(src, 15000);
          if (root.supabase && root.supabase.createClient) { lastErr = null; break; }
          lastErr = new Error("脚本已加载但未导出 supabase：" + src);
        } catch (e) { lastErr = e; }
      }
      if (lastErr || !root.supabase || !root.supabase.createClient) {
        throw new Error("联机组件加载失败（已尝试本地副本与 CDN）。请检查网络后重试。");
      }
    }
    _supaClient = root.supabase.createClient(root.PR_SUPABASE.url, root.PR_SUPABASE.key, { realtime: { params: { eventsPerSecond: 20 } } });
    return _supaClient;
  }
  function SupabaseTransport(room, clientId) {
    let ch = null, onMsg = null, onPres = null, _onVisible = null;
    function presList() {
      const st = ch ? ch.presenceState() : {};
      const out = [];
      for (const k in st) for (const m of st[k]) out.push(m);
      return out.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    }
    return {
      async open(meta, cb) {
        onMsg = cb.onMessage; onPres = cb.onPresence;
        const client = await supa();
        ch = client.channel("pr:" + room, { config: { broadcast: { self: false, ack: false }, presence: { key: clientId } } });
        ch.on("broadcast", { event: "msg" }, (e) => onMsg && onMsg(e.payload));
        ch.on("presence", { event: "sync" }, () => onPres && onPres(presList()));
        // ⚠ 曾经这里只处理 SUBSCRIBED。Supabase 同样会回调 CHANNEL_ERROR / TIMED_OUT / CLOSED，
        // 那三种既不 resolve 也不 reject，且没有超时 → PRNet.host() 永不落定 →
        // lobby 的 catch 永不执行 → 「创建房间」按钮永久变灰且零提示。
        await new Promise((res, rej) => {
          let done = false;
          const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); fn(arg); };
          const timer = setTimeout(() => finish(rej, new Error("连接实时服务超时（网络不稳定或被拦截）")), SUBSCRIBE_TIMEOUT_MS);
          ch.subscribe((status, err) => {
            if (status === "SUBSCRIBED") { try { ch.track(meta); } catch (e) {} finish(res); }
            else if (status === "CHANNEL_ERROR") finish(rej, new Error("实时频道错误：" + ((err && err.message) || "未知原因")));
            else if (status === "TIMED_OUT") finish(rej, new Error("连接实时服务超时"));
            else if (status === "CLOSED") finish(rej, new Error("实时连接已关闭"));
          });
        });
        // iOS Safari freezes backgrounded tabs → re-track presence on tab focus to clear ghost records
        _onVisible = () => { if (document.visibilityState === "visible" && ch) ch.track(meta); };
        document.addEventListener("visibilitychange", _onVisible);
      },
      send(msg) { if (ch) ch.send({ type: "broadcast", event: "msg", payload: msg }); },
      presence() { return presList(); },
      updateMeta(meta) { if (ch) ch.track(meta); },
      close() {
        if (_onVisible) { document.removeEventListener("visibilitychange", _onVisible); _onVisible = null; }
        if (ch) { try { ch.unsubscribe(); } catch (e) {} ch = null; }
      },
    };
  }

  function makeTransport(room, clientId) {
    return hasSupabase() ? SupabaseTransport(room, clientId) : LocalTransport(room, clientId);
  }

  // 客人加入前确认房间里确实有房主。两种传输都是「按需创建」频道/命名空间，open() 对任何
  // 房间码都会成功；若不校验，输错码或房间已散会进入一个空的「只有自己」的房间永远卡住。
  // host-authoritative 设计下客人收不到状态、无法推进，所以这里等到 presence 出现 host 才放行。
  async function waitForHost(transport, clientId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || JOIN_WAIT_MS);
    while (Date.now() < deadline) {
      const list = (transport.presence ? transport.presence() : []) || [];
      if (list.some((m) => m && m.role === "host" && m.clientId !== clientId)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }

  async function startSession(code, role, opts) {
    const clientId = makeId();
    const token = (opts && opts.token) || roomToken(code); // 稳定身份（跨刷新/重连）
    const transport = makeTransport(code, clientId);
    let presence = [];
    const meta = { clientId, token, name: (opts && opts.name) || "玩家", role, joinedAt: Date.now() };
    await transport.open(meta, {
      onMessage: (msg) => { if (opts && opts.onMessage) opts.onMessage(msg); },
      onPresence: (list) => { presence = list; if (opts && opts.onPresence) opts.onPresence(list); },
    });
    if (role === "guest") {
      // 此前固定 3500 ms，且超时一律报「房间不存在」。但这段时间要覆盖 WebSocket 连接 +
      // 频道订阅 + 首次 presence 同步，手机弱网下健康房间也会超时 → 用户看到的是**错误的诊断**。
      // 现在放宽到 JOIN_WAIT_MS，并把「等不到」与「码不对」的措辞分开。
      const ok = await waitForHost(transport, clientId, JOIN_WAIT_MS);
      if (!ok) {
        try { transport.close(); } catch (e) {}
        const err = new Error("没等到房主上线。可能是房间码不对，或网络较慢——请核对房间码后重试。");
        err.code = "NO_HOST";
        throw err;
      }
    }
    return {
      code, role, clientId, token,
      transport: hasSupabase() ? "supabase" : "local",
      send: (obj) => transport.send(obj),
      presence: () => transport.presence ? transport.presence() : presence,
      updateMeta: (m) => transport.updateMeta && transport.updateMeta(Object.assign(meta, m)),
      close: () => transport.close(),
    };
  }

  const PRNet = {
    available: () => true,                 // LocalTransport 总可用；Supabase 视配置
    crossDevice: () => hasSupabase(),       // 是否已配 Supabase（真跨设备）
    makeCode, roomToken,
    host(opts) { const code = (opts && opts.code) || makeCode(4); return startSession(code, "host", opts); },
    join(code, opts) { return startSession(String(code || "").toUpperCase().trim(), "guest", opts); },
  };
  root.PRNet = PRNet;
})(typeof window !== "undefined" ? window : this);
