const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = new Map();
const sent = [];
let answer, cancelled = 0, cleared = 0, modal;
const element = () => ({style: {setProperty() {}}, classList: {add() {}, remove() {}, toggle() {}}, appendChild() {}, remove() { elements.delete(this.id); }});
const root = {setTimeout, clearTimeout, setInterval, clearInterval, navigator: {},
  document: {title: 'Puerto Rico', getElementById: id => elements.get(id), createElement: element,
    body: {appendChild: el => elements.set(el.id, el)}, documentElement: element()},
  Game: function Game() {}, render() {}, addEventListener() {},
  humanPickFromList: () => new Promise(resolve => { answer = resolve; }),
  cancelPendingSelect() { cancelled++; answer?.(null); }, hideModal() {},
  showModal(title, body, buttons) { modal = {title, body, buttons}; },
  PRRoomLobby: {clearReconnect() { cleared++; }, returnToLobby() {}},
  PR_SESSION: {token: 'guest', clientId: 'g', send: async msg => { sent.push(msg); return 'ok'; }},
};
root.window = root;
root.setGlobalGame = g => { root.G = g; };
vm.createContext(root);
for (const file of ['netplay.js', 'spectate.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), root);
const snap = (seq, owners = {1: 'guest'}, extra = {}) => ({_seq: seq, _online: true, _seatOwners: owners, players: [], ...extra});
const request = (id, state, seat = 1) => root.PRNetPlay.handleMessage({type: 'input-request', reqId: id, seat, kind: 'pickFromList', payload: {labels: ['确认']}, snap: state});
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  root.PRSpectate.startSpectating(root.PR_SESSION);
  root.PRSpectate.applyState(snap(10));
  request('first', snap(11));
  assert.equal(root.PRNetPlay.guestBusy(), true);
  root.PRSpectate.applyState(snap(12));
  root.PRSpectate.applyState(snap(13));
  assert.equal(root.G._seq, 11, 'incoming state must preserve an active decision');
  assert.equal(root.PRSpectate._debug().lastSeq, 11, 'queued state is not yet applied');
  answer(0); await settle();
  assert.equal(root.G._seq, 13, 'latest queued board is rendered after input');
  assert.equal(sent.length, 1);
  request('revoked', snap(14));
  root.PRSpectate.applyState(snap(15, {}));
  await settle();
  assert.equal(root.PRNetPlay.mySeat(), -1);
  assert.equal(root.PRNetPlay.guestBusy(), false);
  assert.equal(root.G._seq, 15);
  assert.equal(sent.length, 1, 'revoked input must not send an answer even without takeover event');
  assert.equal(cancelled, 1);
  request('reclaimed', snap(16, {2: 'guest'}), 2);
  assert.equal(root.PRNetPlay.mySeat(), 2, 'input snapshot repairs missed reclaim event');
  assert.equal(root.PRNetPlay.guestBusy(), true);
  root.PRSpectate.applyState(snap(14));
  assert.equal(root.PRNetPlay.mySeat(), 2, 'stale state cannot change seat ownership');
  root.PRSpectate.handleMessage({type: 'gameover', snap: snap(17, {2: 'guest'}, {gameOver: true}), body: 'final scores'});
  await settle();
  assert.equal(sent.length, 1, 'game over cancels pending input');
  assert.equal(root.G.gameOver, true);
  assert.equal(root.PRNetPlay.guestBusy(), false);
  assert.equal(cleared, 1, 'finished guests must not auto-rejoin');
  assert.equal(modal.buttons[0].label, '返回大厅');
  console.log('SPECTATE SYNC OK: queued state, missed takeover/reclaim, stale snapshots, game-over cleanup');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { root.PRNetPlay.teardown(); root.PRSpectate.stopSpectating(); });
