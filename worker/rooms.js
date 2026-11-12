const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*'}});
const HOST_MESSAGES = new Set(['state', 'gameover', 'input-request', 'takeover', 'reclaimed', 'room-config']);
const GUEST_MESSAGES = new Set(['input-response', 'reclaim']);
const ALIVE = 30000;
const MAX_BODY_BYTES = 500000;
const MAX_HISTORY_BYTES = 600000;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

export class PuertoRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = {members: [], seq: 0, events: [], latest: null, pending: null, expires: 0};
    this.waiters = new Set();
    ctx.blockConcurrencyWhile(async () => { this.data = await ctx.storage.get('room') || this.data; });
  }
  async save() {
    this.data.expires = Date.now() + 24 * 60 * 60 * 1000;
    await this.ctx.storage.put('room', this.data);
    await this.ctx.storage.setAlarm(this.data.expires);
  }
  emit(from, message) {
    this.data.events.push({seq: ++this.data.seq, from, message});
    this.data.events = this.data.events.slice(-80);
    while (this.data.events.length > 1 && bytes(this.data.events) > MAX_HISTORY_BYTES) this.data.events.shift();
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }
  presence() { return this.data.members.filter(m => Date.now() - m.seen < ALIVE).map(m => m.meta); }
  async alarm() { if (Date.now() >= this.data.expires) { await this.ctx.storage.deleteAll(); this.data = {members: [], seq: 0, events: [], latest: null, pending: null, expires: 0}; } }
  async fetch(req) {
    const url = new URL(req.url);
    const action = url.pathname.split('/').pop();
    if (req.method === 'OPTIONS') return new Response(null, {headers: {'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'Content-Type'}});
    let body = {};
    if (req.method === 'POST') {
      const reader = req.body?.getReader();
      const chunks = [];
      let size = 0;
      let oversized = false;
      if (reader) while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) { oversized = true; chunks.length = 0; }
        if (!oversized) chunks.push(value);
      }
      if (oversized) return reply({error: '消息过大'}, 413);
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      const raw = new TextDecoder().decode(buffer);
      try { body = JSON.parse(raw); } catch { return reply({error: '消息格式错误'}, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error: '消息格式错误'}, 400);
    }
    if (action === 'connect' && req.method === 'POST') {
      const meta = body.meta;
      if (!meta || !['host', 'guest'].includes(meta.role) || typeof meta.clientId !== 'string' || meta.clientId.length > 80) return reply({error: '身份格式错误'}, 400);
      let member = this.data.members.find(m => m.auth === body.auth && typeof body.auth === 'string');
      const host = this.data.members.find(m => m.meta.role === 'host');
      if (!member && meta.role === 'host' && host) return reply({error: '房间码已被占用，请重新创建房间'}, 409);
      if (!member && meta.role === 'guest' && !host) return reply({error: '房间不存在，请核对房间码'}, 404);
      if (member && member.meta.role !== meta.role) return reply({error: '房间身份不匹配'}, 403);
      if (!member) {
        if (this.data.members.length >= 24) return reply({error: '房间人数已满'}, 409);
        member = {auth: crypto.randomUUID(), meta: {token: crypto.randomUUID(), role: meta.role, joinedAt: Date.now()}, ids: []};
        this.data.members.push(member);
      }
      member.meta.clientId = meta.clientId;
      member.meta.name = String(meta.name || '玩家').slice(0, 32);
      member.seen = Date.now();
      this.emit('', null);
      await this.save();
      return reply({auth: member.auth, token: member.meta.token, seq: this.data.seq, presence: this.presence(), config: this.data.config, latest: meta.role === 'guest' ? this.data.latest : null, pending: meta.role === 'guest' ? this.data.pending : null});
    }
    const auth = req.method === 'POST' ? body.auth : url.searchParams.get('auth');
    const member = this.data.members.find(m => m.auth === auth && typeof auth === 'string');
    if (!member) return reply({error: '房间会话已失效，请重新加入'}, 401);
    if (action === 'poll' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since'));
      if (!Number.isSafeInteger(since) || since < 0 || since > this.data.seq) return reply({error: '事件编号错误'}, 400);
      member.seen = Date.now();
      const oldest = this.data.events[0]?.seq || this.data.seq;
      if (since < oldest - 1) return reply({seq: this.data.seq, presence: this.presence(), events: [], config: this.data.config, latest: member.meta.role === 'guest' ? this.data.latest : null, pending: member.meta.role === 'guest' ? this.data.pending : null, reset: true});
      if (since === this.data.seq) await new Promise(resolve => {
        const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
        const timer = setTimeout(wake, 10000);
        this.waiters.add(wake);
      });
      return reply({seq: this.data.seq, presence: this.presence(), events: this.data.events.filter(e => e.seq > since && e.from !== member.auth).map(e => ({seq: e.seq, message: e.message}))});
    }
    if (action === 'send' && req.method === 'POST') {
      const msg = body.message;
      if (typeof body.id !== 'string' || body.id.length > 80 || !msg || typeof msg !== 'object') return reply({error: '消息格式错误'}, 400);
      if (member.ids.includes(body.id)) return reply({ok: true});
      const allowed = member.meta.role === 'host' ? HOST_MESSAGES : GUEST_MESSAGES;
      if (!allowed.has(msg.type)) return reply({error: '不允许发送此消息'}, 403);
      const now = Date.now();
      if (now - (member.bucketAt || 0) > 1000) { member.bucketAt = now; member.count = 0; }
      if (++member.count > 30) return reply({error: '操作太快，请稍后重试'}, 429);
      member.seen = now;
      let clean = {...msg};
      if (clean.type === 'room-config') {
        if (!Number.isInteger(clean.humans) || clean.humans < 1 || clean.humans > 24 || !Number.isInteger(clean.bots) || clean.bots < 0 || clean.bots > 4 || !Number.isInteger(clean.botLevel) || clean.botLevel < 1 || clean.botLevel > 6 || typeof clean.randomSeats !== 'boolean') return reply({error: '房间设置无效'}, 400);
        clean = {type: 'room-config', humans: clean.humans, bots: clean.bots, botLevel: clean.botLevel, randomSeats: clean.randomSeats};
      }
      if (member.meta.role === 'guest') { clean.token = member.meta.token; clean.name = member.meta.name; }
      if (clean.type === 'state' || clean.type === 'gameover') {
        const previous = this.data.latest;
        // HTTP 重试可能晚于新帧到达；重连存档必须单调前进，终局不可被旧广播覆盖。
        if (previous?.type === 'gameover' || (Number.isFinite(previous?.snap?._seq) && (!Number.isFinite(clean.snap?._seq) || clean.snap._seq <= previous.snap._seq))) return reply({ok: true});
        this.data.latest = clean;
      }
      if (clean.type === 'room-config') this.data.config = clean;
      if (clean.type === 'input-request') this.data.pending = clean;
      if ((clean.type === 'input-response' && clean.reqId === this.data.pending?.reqId && this.data.latest?.snap?._seatOwners?.[this.data.pending.seat] === member.meta.token) || clean.type === 'takeover' || clean.type === 'gameover') this.data.pending = null;
      member.ids.push(body.id); member.ids = member.ids.slice(-100);
      this.emit(member.auth, clean);
      await this.save();
      return reply({ok: true});
    }
    if (action === 'leave' && req.method === 'POST') {
      member.seen = 0;
      this.emit('', null);
      await this.save();
      return reply({ok: true});
    }
    return reply({error: '接口不存在'}, 404);
  }
}
