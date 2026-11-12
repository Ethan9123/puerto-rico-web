const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = {setTimeout, clearTimeout, setInterval, clearInterval,
  document: {getElementById() { return null; }},
  G: {players: [{isHuman: true}, {isHuman: true}, {isHuman: false}, {isHuman: false}],
    _takenOverSeats: {2: '机器人 1', 3: '机器人 2'}},
  render() {},
};
root.window = root;
vm.createContext(root);
vm.runInContext(fs.readFileSync('netplay.js', 'utf8'), root);
const sent = [];
const session = {role: 'host', token: 'host', clientId: 'h',
  presence: () => [{role: 'host', token: 'host'}, {role: 'guest', token: 'seated'}, {role: 'guest', token: 'visitor', name: '朋友'}],
  send: msg => sent.push(msg)};
root.PRNetPlay.setup({session, role: 'host', online: true, seatOwners: {1: 'seated'}});
function claim(token, seat) { root.PRNetPlay.handleMessage({type: 'reclaim', token, seat, name: '伪造名字'}); }
claim('seated', 2);
claim('unknown', 2);
claim('host', 2);
claim('visitor', '2');
claim('visitor', -1);
assert.equal(sent.length, 0, 'seated, absent, host and malformed identities cannot claim');
root.G.gameOver = true;
claim('visitor', 2);
assert.equal(sent.length, 0, 'finished games cannot change ownership');
root.G.gameOver = false;
claim('visitor', 2);
assert.equal(root.G.players[2].isHuman, true);
assert.equal(root.G.players[2].name, '朋友');
assert.equal(root.PRNetPlay.seatOwners()[2], 'visitor');
assert.equal(root.G._seatTokens[2], 'visitor');
assert.equal(root.G._takenOverSeats[2], undefined);
claim('visitor', 3);
assert.equal(root.G.players[3].isHuman, false);
assert.equal(sent.length, 1, 'one visitor can claim exactly one seat');
root.PRNetPlay.teardown();
console.log('NETPLAY IDENTITY OK: one seat per guest, active member validation, finished game protection');
