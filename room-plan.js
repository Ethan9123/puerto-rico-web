(function (root) {
  'use strict';
  function planRoom({host, guests, total, bots, randomSeats}, random = Math.random) {
    const seen = new Set([host.token]);
    const people = [host];
    for (const guest of guests) if (guest.token && !seen.has(guest.token)) { seen.add(guest.token); people.push(guest); }
    const count = bots === 'auto' ? Math.max(0, total - people.length) : Number(bots);
    if (!Number.isInteger(count) || count < 0 || count > 4) throw new Error('机器人数量应为 0–4 个');
    const n = people.length + count;
    if (n < 2) throw new Error('联机至少需要 2 个座位，请加入朋友或添加机器人');
    if (n > 5) throw new Error('最多 5 个座位，请减少机器人数量');
    const order = people.concat(Array(count).fill(null));
    if (randomSeats) for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const seatOwners = {}, names = {};
    let hostSeat = 0;
    order.forEach((person, seat) => {
      if (!person) return;
      names[seat] = person.name;
      if (person.token === host.token) hostSeat = seat;
      else seatOwners[seat] = person.token;
    });
    return {numPlayers: n, botCount: count, hostSeat, seatOwners, names};
  }
  root.PRRoomPlan = planRoom;
  if (typeof module !== 'undefined' && module.exports) module.exports = planRoom;
})(typeof window !== 'undefined' ? window : globalThis);
