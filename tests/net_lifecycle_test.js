const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function fixture({fail = false, delayedHost = false} = {}) {
  const listeners = new Map(), messages = [], statuses = [];
  let callbacks, present = [], closes = 0, reconnects = 0;
  const root = {
    PR_ROOMS_URL: 'https://rooms.test', setTimeout, clearTimeout,
    sessionStorage: {getItem() {}, setItem() {}},
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    PRRoomTransport: () => ({
      async open(meta, cb) {
        callbacks = cb;
        if (fail) throw new Error('connection refused');
        present = delayedHost ? [] : [{role: 'host', clientId: 'other'}];
        cb.onMessage({type: 'state', snap: {round: 4}});
        return {token: 'seat-token'};
      },
      presence: () => present,
      reconnect() { reconnects++; },
      close() { closes++; },
    }),
  };
  root.window = root;
  vm.createContext(root);
  vm.runInContext(fs.readFileSync('net.js', 'utf8'), root);
  return {
    root, listeners, messages, statuses,
    get callbacks() { return callbacks; },
    get closes() { return closes; }, get reconnects() { return reconnects; },
    hostReturns() { present = [{role: 'host', clientId: 'other'}]; },
    options: {onMessage: m => messages.push(m), onStatus: s => statuses.push(s)},
  };
}
const tick = () => new Promise(r => setTimeout(r, 20));
(async () => {
  const failed = fixture({fail: true});
  for (let i = 0; i < 3; i++) await assert.rejects(failed.root.PRNet.host(failed.options), /connection refused/);
  assert.equal(failed.closes, 3);
  assert.equal(failed.listeners.get('online').size, 0, 'failed joins must remove browser listeners');
  assert.equal(failed.listeners.get('offline').size, 0);

  const guest = fixture({delayedHost: true});
  const joining = guest.root.PRNet.join('ABCD', guest.options);
  await tick();
  assert.equal(guest.messages.length, 0, 'initial snapshot must wait for the session to be returned');
  guest.hostReturns();
  const session = await joining;
  assert.equal(guest.messages.length, 0);
  await tick();
  assert.equal(guest.messages[0].snap.round, 4);
  for (const fn of guest.listeners.get('online')) fn();
  assert.equal(guest.reconnects, 1);
  assert.deepEqual(guest.statuses, ['ONLINE'], 'browser online is not yet server confirmation');
  session.close(); session.close();
  guest.callbacks.onMessage({type: 'state'});
  assert.equal(guest.messages.length, 1, 'closed sessions cannot apply stale messages');
  assert.equal(guest.closes, 1);
  assert.equal(guest.listeners.get('online').size, 0);
  console.log('NET LIFECYCLE OK: failed connection cleanup, delayed snapshot, reconnect confirmation, idempotent close');
})().catch(e => { console.error(e); process.exitCode = 1; });
