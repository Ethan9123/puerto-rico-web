'use strict';
// Offline only: synthetic capabilities, isolated VM, in-memory KV, no HTTP listener.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {loadEngine, createStorage} = require('../tools/_sandbox.js');
const token = 'a'.repeat(64), other = 'b'.repeat(64);

async function workerTests() {
  const source = fs.readFileSync('worker/index.js', 'utf8')
    .replace("export { PuertoRoom } from './rooms.js';", '')
    .replace('export default {', 'globalThis.worker = {');
  const scope = {Response, Request, URL, TextEncoder, Uint8Array, crypto: webcrypto};
  vm.runInNewContext(source, scope);
  const data = new Map([['save:roomabcd', 'legacy-private']]);
  const kv = {
    get: async key => data.get(key) || null,
    put: async (key, value) => data.set(key, value),
    delete: async key => data.delete(key),
  };
  const call = (path, options = {}) => scope.worker.fetch(new Request('https://offline.invalid' + path, options), {PR_TRACES: kv});
  const save = body => call('/game-save', {method: 'POST', body: JSON.stringify(body)});
  const load = (id, auth) => call('/game-load?id=' + id, {headers: auth ? {'X-Save-Token': auth} : {}});
  assert.equal((await load('roomabcd')).status, 401);
  assert.equal((await load('roomabcd', 'invalid')).status, 401);
  assert.equal((await save({id: 'roomabcd', snap: 'forged'})).status, 401);
  assert.equal((await save({id: 'roomabcd', token, snap: 42})).status, 400);
  assert.equal((await (await load('roomabcd', token)).json()).snap, null, 'never migrate legacy cloud data by public id');
  assert.equal((await save({id: 'roomabcd', token, snap: 'owner'})).status, 200);
  const owner = await load('roomabcd', token);
  assert.equal(owner.headers.get('cache-control'), 'no-store');
  assert.equal((await owner.json()).snap, 'owner');
  assert.equal((await (await load('roomabcd', other)).json()).snap, null);
  await save({id: 'roomabcd', token: other, snap: 'different-owner'});
  await save({id: 'roomabcd', token: other, snap: ''});
  assert.equal((await (await load('roomabcd', token)).json()).snap, 'owner', 'wrong token cannot overwrite/delete owner');
  await save({id: 'roomabcd', token, snap: ''});
  assert.equal((await (await load('roomabcd', token)).json()).snap, null);
  assert.equal(data.get('save:roomabcd'), 'legacy-private', 'legacy data untouched');
  assert.ok([...data.keys()].every(key => !key.includes(token)), 'raw capability is not a KV key');
  const preflight = await call('/game-load', {method: 'OPTIONS'});
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Save-Token/);
}

async function clientTests() {
  const requests = [], beacons = [], storage = createStorage();
  storage.setItem('pr_save_v1', '{"_savedAt":1}');
  const {sandbox, run} = loadEngine({files: ['ai_dna.js', 'game.js'], extraGlobals: {
    localStorage: storage, crypto: webcrypto, Blob,
    fetch: async (url, opts) => { if (!url.startsWith('/game-')) return {ok: true, json: async () => ({})}; requests.push({url, opts}); return {ok:true, json:async () => ({ok:true,snap:null})}; },
    navigator: {sendBeacon: (url, blob) => {beacons.push({url, blob}); return true;}},
  }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 0, 'loading old local save does not send unauthenticated cloud requests');
  run('kvSync()');
  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].opts.body);
  assert.match(body.token, /^[a-f0-9]{64}$/);
  assert.equal(body.snap, '{"_savedAt":1}', 'local save is unchanged');
  assert.ok(!body.snap.includes(body.token));
  run('kvSyncBeacon()');
  assert.equal(JSON.parse(await beacons[0].blob.text()).token, body.token);
  await run('kvLoad()');
  const get = requests.at(-1);
  assert.equal(get.opts.headers['X-Save-Token'], body.token);
  assert.ok(!get.url.includes(body.token));
  assert.equal(get.opts.cache, 'no-store');
  run('kvDelete()');
  assert.equal(JSON.parse(requests.at(-1).opts.body).snap, '');
  assert.equal(JSON.parse(requests.at(-1).opts.body).token, body.token);
  // Per-room token is stable across host refresh, distinct from the solo token.
  run('G = {_online: true, _roomCode: "ABCD"}');
  storage.setItem('pr_save_v1:room:ABCD', '{"_savedAt":2}');
  run('kvSync()');
  const room = JSON.parse(requests.at(-1).opts.body);
  assert.equal(room.id, 'roomabcd');
  assert.notEqual(room.token, body.token);
  run('kvSync()');
  assert.equal(JSON.parse(requests.at(-1).opts.body).token, room.token);
  assert.equal(await run('getBestRoomSave("ABCD")'), '{"_savedAt":2}');
  assert.equal(requests.at(-1).opts.headers['X-Save-Token'], room.token);
  run('G._spectator = true');
  const count = requests.length;
  run('kvSync(); kvDelete(); kvSyncBeacon()');
  assert.equal(requests.length, count, 'guests cannot sync host saves');
  run('G = null');
  storage.removeItem('pr_save_auth_v2:pr_save_v1');
  sandbox.crypto = undefined;
  run('kvSync(); kvSyncBeacon()');
  assert.equal(requests.length, count, 'no insecure randomness fallback');
  sandbox.localStorage = {getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}};
  assert.equal(run('prDeviceId()'), null, 'no shared anon ID');
  run('kvSync(); kvDelete(); kvSyncBeacon()');
  await run('kvLoad()');
  assert.equal(requests.length, count, 'storage failure is cloud fail-closed');
}
(async () => { await workerTests(); await clientTests(); console.log('PASS cloud save capability authorization (worker + client, offline)'); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
