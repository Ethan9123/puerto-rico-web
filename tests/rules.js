(async function () {
  const out = document.getElementById('out');
  const log = (m) => { out.textContent += m + "\n"; };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  function checkInitialStocks(n) {
    const g = new Game(n, 'AI');
    const bTotal = BUILDINGS.reduce((s, b) => s + g.buildingStock[b.id], 0);
    assert(bTotal === 23, `buildings total mismatch for ${n}p: ${bTotal}`);
  }

  function conservationSnapshot(g) {
    const colonistsInPlayers = g.players.reduce((s, p) => s + g.totalColonists(p), 0);
    const colonistsTotal = g.colonistsLeft + g.colonistsOnShip + colonistsInPlayers;
    const goodsPlayers = GOODS.reduce((acc, kind) => {
      acc[kind] = g.players.reduce((s, p) => s + p.goods[kind], 0);
      return acc;
    }, {});
    const goodsShips = GOODS.reduce((acc, kind) => {
      acc[kind] = g.ships.reduce((s, ship) => s + (ship.good === kind ? ship.count : 0), 0);
      return acc;
    }, {});
    return { colonistsTotal, goodsPlayers, goodsShips, supply: { ...g.supply } };
  }

  const expectedGoods = { corn: 10, indigo: 11, sugar: 11, tobacco: 9, coffee: 9 };
  const expectedColonists = { 3: 55, 4: 75, 5: 95 };

  for (let n = 3; n <= 5; n++) checkInitialStocks(n);

  for (let i = 0; i < 20; i++) {
    const n = 3 + (i % 3);
    const g = new Game(n, 'AI');
    g.players.forEach(p => { p.isHuman = false; p._aiLevel = 5; });
    const snap = conservationSnapshot(g);

    assert(snap.colonistsTotal === expectedColonists[n], `colonists mismatch g${i+1}: ${snap.colonistsTotal}`);
    for (const kind of GOODS) {
      const total = snap.supply[kind] + snap.goodsPlayers[kind] + snap.goodsShips[kind];
      assert(total === expectedGoods[kind], `${kind} mismatch g${i+1}: ${total}`);
    }

    const bTotal = BUILDINGS.reduce((s, b) => s + g.buildingStock[b.id], 0);
    assert(bTotal === 23, `buildings stock mismatch g${i+1}: ${bTotal}`);
    log(`Game ${i + 1}: ok (${n} players)`);
  }

  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  G = new Game(4, 'AI');
  G.players.forEach(p => { p.isHuman = false; p._aiLevel = 5; });
  await runMainLoop();
  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const elapsedMs = t1 - t0;
  assert(elapsedMs < 30000, `4p all-L5 game too slow: ${Math.round(elapsedMs)}ms`);
  log(`4p all-L5 full game runtime: ${Math.round(elapsedMs)}ms`);
  log('All checks passed.');
})();
