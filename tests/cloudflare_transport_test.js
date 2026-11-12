const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const base = process.env.ROOMS_TEST_BASE || 'http://127.0.0.1:8898';
function client(storage = new Map()) {
  const root = {PR_ROOMS_URL: base, location: {origin: base}, fetch, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    sessionStorage: {getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v)},
    addEventListener() {}, removeEventListener() {}};
  root.window = root;
  vm.createContext(root);
  for (const name of ['room-transport.js', 'net.js']) vm.runInContext(fs.readFileSync(name, 'utf8'), root);
  return {net: root.PRNet, storage, root};
}
async function until(fn) {
  const end = Date.now() + 5000;
  while (!fn()) { if (Date.now() > end) throw new Error('message not received'); await new Promise(r => setTimeout(r, 50)); }
}
(async () => {
  try { await fetch(base + '/', {signal: AbortSignal.timeout(2000)}); }
  catch (e) { if (!process.env.ROOMS_TEST_BASE) { console.log('skipped: 本机房间服务未启动（npm run dev:online）'); process.exit(2); } throw e; }
  const h = client(), g = client(), hmsgs = [], gmsgs = [];
  const hostStatus = [], guestStatus = [];
  let hs, gs, back;
  try {
    hs = await h.net.host({name: 'transport-host', onMessage: m => hmsgs.push(m), onStatus: s => hostStatus.push(s)});
    gs = await g.net.join(hs.code, {name: 'transport-guest', onMessage: m => gmsgs.push(m), onStatus: s => guestStatus.push(s)});
    assert.equal(hs.transport, 'cloudflare');
    await until(() => hs.presence().length === 2);
    assert.equal(await hs.send({type: 'state', snap: {_seq: 1}}), 'ok');
    await until(() => gmsgs.some(m => m.type === 'state'));
    assert.equal(await gs.send({type: 'input-response', reqId: 'round1', token: 'forged', value: 3}), 'ok');
    await until(() => hmsgs.some(m => m.reqId === 'round1'));
    assert.equal(hmsgs.find(m => m.reqId === 'round1').token, gs.token);
    assert.equal(await gs.send({type: 'state', snap: {_seq: 999}}), 'error');
    assert.equal(guestStatus.includes('CHANNEL_ERROR'), false, 'rejected message is not a network outage');
    h.root.fetch = (url, options) => String(url).endsWith('/send') ? Promise.reject(new Error('simulated send failure')) : fetch(url, options);
    assert.equal(await hs.send({type: 'state', snap: {_seq: 2}}), 'error');
    assert.equal(await hs.send({type: 'state', snap: {_seq: 2}}), 'error');
    assert.deepEqual(hostStatus, ['CHANNEL_ERROR'], 'repeated send errors emit one connection warning');
    h.root.fetch = fetch;
    assert.equal(await hs.send({type: 'state', snap: {_seq: 2}}), 'ok');
    await until(() => hostStatus.includes('SUBSCRIBED'));
    gs.close();
    const reload = client(g.storage), messages = [];
    back = await reload.net.join(hs.code, {name: 'transport-guest', onMessage: m => messages.push(m)});
    assert.equal(back.token, gs.token);
    await until(() => messages.some(m => m.type === 'state' && m.snap._seq === 2));
    assert.equal(await back.send({type: 'reclaim', seat: 1}), 'ok');
    await until(() => hmsgs.some(m => m.type === 'reclaim'));
    console.log('TRANSPORT OK: independent clients, state/input delivery, sender binding, rejection, send failure/recovery, stored identity and snapshot');
  } finally { hs?.close(); gs?.close(); back?.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
