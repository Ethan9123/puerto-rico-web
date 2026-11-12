const assert = require('node:assert/strict');
const planRoom = require('../room-plan.js');
const host = {token: 'host', name: '房主'};
const guest = {token: 'guest', name: '朋友'};
const normal = planRoom({host, guests: [guest], total: 4, bots: 'auto', randomSeats: false});
assert.equal(normal.numPlayers, 4);
assert.equal(normal.botCount, 2);
assert.equal(normal.hostSeat, 0);
assert.deepEqual(normal.seatOwners, {1: 'guest'});
const random = planRoom({host, guests: [guest], total: 3, bots: 3, randomSeats: true}, () => 0);
assert.equal(random.numPlayers, 5);
assert.equal(random.hostSeat, 4);
assert.deepEqual(random.seatOwners, {0: 'guest'});
assert.equal(random.names[4], '房主');
assert.equal(random.names[0], '朋友');
assert.equal(planRoom({host, guests: [guest, guest], total: 3, bots: 0}).numPlayers, 2);
assert.throws(() => planRoom({host, guests: [], total: 1, bots: 0}), /至少/);
assert.throws(() => planRoom({host, guests: [guest], total: 5, bots: 4}), /最多/);
assert.throws(() => planRoom({host, guests: [], total: 3, bots: 1.5}), /数量/);
for (let n = 2; n <= 5; n++) for (let k = 0; k < 100; k++) {
  const plan = planRoom({host, guests: [guest], total: n, bots: 'auto', randomSeats: true});
  assert.equal(plan.numPlayers, n);
  assert.ok(!(plan.hostSeat in plan.seatOwners));
  assert.equal(Object.values(plan.seatOwners).filter(t => t === guest.token).length, 1);
}
console.log('ROOM PLAN OK: explicit bots, automatic fill, shuffled host/guest/bot seats, capacity and identity invariants');
