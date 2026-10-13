(function (root) {
  'use strict';
  root.PRRoomTransport = function (room, clientId) {
    const base = String(root.PR_ROOMS_URL || location.origin).replace(/\/$/, '') + '/rooms/' + encodeURIComponent(room);
    const key = 'prroom_auth_' + room;
    let auth = '', stopped = false, callbacks, metadata, seq = 0, list = [], timer, polling, connected = false, sendSeq = 0;
    try { auth = sessionStorage.getItem(key) || ''; } catch {}
    async function call(path, body, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal) signal.addEventListener('abort', abort, {once: true});
      const timeout = setTimeout(abort, 15000);
      try {
        const res = await fetch(base + '/' + path, body === undefined ? {signal: controller.signal} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: controller.signal});
        let data;
        try { data = await res.json(); } catch { throw new Error('房间服务未启用，请使用联机站点地址'); }
        if (!res.ok) throw new Error(data.error || '房间服务连接失败');
        return data;
      } finally { clearTimeout(timeout); if (signal) signal.removeEventListener('abort', abort); }
    }
    function apply(data) {
      seq = data.seq;
      list = data.presence || [];
      callbacks.onPresence(list);
      if (data.config) callbacks.onMessage(data.config);
      if (data.latest) callbacks.onMessage(data.latest);
      if (data.pending) callbacks.onMessage(data.pending);
      for (const e of data.events || []) if (e.message) callbacks.onMessage(e.message);
    }
    async function poll() {
      if (stopped) return;
      polling = new AbortController();
      try {
        const data = await call('poll?auth=' + encodeURIComponent(auth) + '&since=' + seq, undefined, polling.signal);
        if (stopped) return;
        if (!connected) { connected = true; callbacks.onStatus?.('SUBSCRIBED'); }
        apply(data);
        timer = setTimeout(poll, 100);
      } catch (e) {
        if (stopped) return;
        connected = false; callbacks.onStatus?.('CHANNEL_ERROR', e.message);
        timer = setTimeout(poll, 2000);
      }
    }
    return {
      async open(meta, cb) {
        metadata = meta; callbacks = cb;
        const data = await call('connect', {auth, meta});
        auth = data.auth; meta.token = data.token;
        try { sessionStorage.setItem(key, auth); } catch {}
        seq = data.seq; list = data.presence || []; callbacks.onPresence(list);
        connected = true;
        timer = setTimeout(() => { if (!stopped) { apply(data); poll(); } }, 0);
        return {token: data.token};
      },
      async send(message) {
        if (stopped) return 'error';
        const id = clientId + ':' + (++sendSeq);
        for (let attempt = 0; attempt < 2; attempt++) {
          try { await call('send', {auth, id, message}); return 'ok'; }
          catch (e) { if (attempt === 1) { callbacks.onStatus?.('CHANNEL_ERROR', e.message); return 'error'; } }
        }
      },
      presence() { return list; },
      updateMeta(meta) { metadata = meta; },
      close() {
        stopped = true; clearTimeout(timer); polling?.abort();
        call('leave', {auth}).catch(() => {});
      },
    };
  };
})(typeof window !== 'undefined' ? window : this);
