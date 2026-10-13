const assert = require('node:assert/strict');
const base = process.env.ROOMS_TEST_BASE || 'http://127.0.0.1:8898';
const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = Array.from({length: 4}, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
async function call(path, body) {
  const res = await fetch(base + '/rooms/' + code + '/' + path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  return {status: res.status, data: await res.json()};
}
const connect = (role, name, auth) => call('connect', {auth, meta: {role, name, clientId: name}});
(async () => {
  try { await fetch(base + '/', {signal: AbortSignal.timeout(2000)}); }
  catch (e) { if (!process.env.ROOMS_TEST_BASE) { console.log('skipped: 本机房间服务未启动（npm run dev:online）'); process.exit(2); } throw e; }
  assert.equal((await connect('guest', 'missing')).status, 404);
  const h = (await connect('host', 'host')).data;
  assert.ok(h.auth && h.token);
  assert.equal((await connect('host', 'impostor')).status, 409);
  const g = (await connect('guest', 'guest')).data;
  assert.equal(g.presence.length, 2);
  assert.ok(!JSON.stringify(g.presence).includes(h.auth), 'presence must not expose credentials');
  assert.equal((await call('send', {auth: 'bad', id: 'bad', message: {type: 'state'}})).status, 401);
  assert.equal((await call('send', {auth: g.auth, id: 'forge', message: {type: 'state'}})).status, 403);
  const input = {auth: g.auth, id: 'input-1', message: {type: 'input-response', reqId: 'r1', token: h.token, value: 2}};
  assert.equal((await call('send', input)).status, 200);
  assert.equal((await call('send', input)).status, 200);
  const hp = (await call('poll?auth=' + h.auth + '&since=' + h.seq)).data;
  const acts = hp.events.filter(e => e.message?.type === 'input-response');
  assert.equal(acts.length, 1, 'retry must be deduplicated');
  assert.equal(acts[0].message.token, g.token, 'server stamps sender token');
  assert.ok(!JSON.stringify(hp).includes(g.auth), 'poll must not expose other credentials');
  await call('send', {auth: h.auth, id: 'state-1', message: {type: 'state', snap: {_seq: 42, players: []}}});
  const gp = (await call('poll?auth=' + g.auth + '&since=' + g.seq)).data;
  assert.equal(gp.events.find(e => e.message?.type === 'state').message.snap._seq, 42);
  const rejoined = (await connect('guest', 'guest-reloaded', g.auth)).data;
  assert.equal(rejoined.token, g.token);
  assert.equal(rejoined.latest.snap._seq, 42);
  const rh = (await connect('host', 'host-reloaded', h.auth)).data;
  assert.equal(rh.token, h.token);
  assert.equal((await connect('guest', 'stolen-role', h.auth)).status, 403);
  const waiting = call('poll?auth=' + g.auth + '&since=' + rh.seq);
  await new Promise(resolve => setTimeout(resolve, 150));
  await call('send', {auth: h.auth, id: 'wake', message: {type: 'input-request', reqId: 'r2', seat: 1}});
  assert.ok((await waiting).data.events.some(e => e.message?.reqId === 'r2'), 'long poll wakes on new input');
  await call('leave', {auth: g.auth});
  const left = (await call('poll?auth=' + h.auth + '&since=' + rh.seq)).data;
  assert.equal(left.presence.length, 1);
  await connect('guest', 'guest-back', g.auth);
  for (let i = 0; i < 82; i++) {
    if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 1050));
    assert.equal((await call('send', {auth: h.auth, id: 'gap-' + i, message: {type: 'state', snap: {_seq: 100 + i}}})).status, 200);
  }
  const reset = (await call('poll?auth=' + g.auth + '&since=0')).data;
  assert.equal(reset.reset, true);
  assert.equal(reset.latest.snap._seq, 181);
  console.log('ROOMS OK: create/join, authentication, sender validation, deduplication, long poll, reconnect, presence, gap recovery');
})().catch(e => { console.error(e); process.exitCode = 1; });
