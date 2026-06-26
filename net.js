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
  const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 去掉易混的 0/O/1/I/L
  function makeCode(n) { let s = ""; for (let i = 0; i < (n || 4); i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return s; }
  function makeId() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
  function hasSupabase() { return !!(root.PR_SUPABASE && root.PR_SUPABASE.url && root.PR_SUPABASE.key); }

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
      // 动态加载 supabase-js（部署站 / 联网时）。本地自测走 LocalTransport，不会到这。
      await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    }
    _supaClient = root.supabase.createClient(root.PR_SUPABASE.url, root.PR_SUPABASE.key, { realtime: { params: { eventsPerSecond: 20 } } });
    return _supaClient;
  }
  function SupabaseTransport(room, clientId) {
    let ch = null, onMsg = null, onPres = null;
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
        await new Promise((res) => ch.subscribe((status) => { if (status === "SUBSCRIBED") { ch.track(meta); res(); } }));
      },
      send(msg) { if (ch) ch.send({ type: "broadcast", event: "msg", payload: msg }); },
      presence() { return presList(); },
      updateMeta(meta) { if (ch) ch.track(meta); },
      close() { if (ch) { try { ch.unsubscribe(); } catch (e) {} ch = null; } },
    };
  }

  function makeTransport(room, clientId) {
    return hasSupabase() ? SupabaseTransport(room, clientId) : LocalTransport(room, clientId);
  }

  async function startSession(code, role, opts) {
    const clientId = makeId();
    const transport = makeTransport(code, clientId);
    let presence = [];
    const meta = { clientId, name: (opts && opts.name) || "玩家", role, joinedAt: Date.now() };
    await transport.open(meta, {
      onMessage: (msg) => { if (opts && opts.onMessage) opts.onMessage(msg); },
      onPresence: (list) => { presence = list; if (opts && opts.onPresence) opts.onPresence(list); },
    });
    return {
      code, role, clientId,
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
    makeCode,
    host(opts) { const code = (opts && opts.code) || makeCode(4); return startSession(code, "host", opts); },
    join(code, opts) { return startSession(String(code || "").toUpperCase().trim(), "guest", opts); },
  };
  root.PRNet = PRNet;
})(typeof window !== "undefined" ? window : this);
