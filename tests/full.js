(async function () {
  const out = document.getElementById('out');
  const log = (m) => { out.textContent += m + '\n'; console.log(m); };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const expectedGoods = { corn: 10, indigo: 11, sugar: 11, tobacco: 9, coffee: 9 };
  const expectedColonists = { 3: 55, 4: 75, 5: 95 };
  const builtSeen = new Set();
  const rolesSeen = new Set();
  const levelVpSums = {1:0,2:0,3:0,4:0,5:0};
  const levelCounts = {1:0,2:0,3:0,4:0,5:0};

  const origErr = console.error;
  const errLog = [];
  console.error = (...args) => { errLog.push(args.map(String).join(' ')); origErr(...args); };
  window.onerror = (msg) => { errLog.push(String(msg)); };

  // Captain 选船优先级单元断言：
  // 4人局初始船容量 5/6/7，全空；玩家有2玉米 => 应优先选择 index=2（容量7）
  {
    const g = new Game(4, 'AI');
    const p = g.players[0];
    p.goods.corn = 2;
    const candidates = [];
    for (let s = 0; s < g.ships.length; s++) {
      const ship = g.ships[s];
      candidates.push({ ship: s, good: 'corn', amount: Math.min(p.goods.corn, ship.capacity - ship.count) });
    }
    const ranked = rankCaptainCandidates(candidates, g.ships);
    assert(ranked[0].ship === 2, `captain default ship should be index 2, got ${ranked[0].ship}`);
    log('result unit=captain_default_ship expected=2 actual=' + ranked[0].ship);
  }

  {
    const seats = new Set();
    for (let i = 0; i < 40; i++) {
      const g = new Game(4, 'AI');
      seats.add(g.governor);
    }
    assert(seats.size >= 3, 'random governor distinct seats too small: ' + seats.size);
    log('result unit=random_governor distinctSeats=' + seats.size);
  }

  {
    // 起始种植园应按"总督顺位"分发：1st/2nd=indigo, 后面=corn（4 人局）
    // 即 governor 拿 indigo，governor+1 拿 indigo，governor+2/3 拿 corn
    let pass = 0, fail = 0;
    for (let i = 0; i < 30; i++) {
      const g = new Game(4, 'AI');
      const gov = g.governor;
      const expected = ['indigo', 'indigo', 'corn', 'corn'];
      let ok = true;
      for (let step = 0; step < 4; step++) {
        const idx = (gov + step) % 4;
        if (g.players[idx].plantations[0].good !== expected[step]) { ok = false; break; }
      }
      if (ok) pass++; else fail++;
    }
    assert(fail === 0, `starting plantation order wrong in ${fail}/30 games`);
    log('result unit=starting_plant_order pass=' + pass + '/30');
  }

  {
    document.body.insertAdjacentHTML('beforeend', '<div id="toast-stack"></div>');
    window._allAIMode = false;
    showToast('<div class="t-title">test</div>');
    showToast('<div class="t-title">test2</div>', { duration: 50 });
    const before = document.querySelectorAll('#toast-stack .toast').length;
    assert(before === 2, 'toasts stack: ' + before);
    await new Promise(r => setTimeout(r, 600));
    const after = document.querySelectorAll('#toast-stack .toast').length;
    assert(after <= 1, 'short toast auto-remove: ' + after);
    log('result unit=toast stacks=2 after-short=' + after);
    window._allAIMode = true;
  }

  async function runOneGame(n, levels) {
    G = new Game(n, 'AI');
    G.players.forEach((p, i) => { p.isHuman = false; p._aiLevel = levels[i % levels.length]; });
    window._allAIMode = true;
    await runMainLoop();

    for (const r of G.roleCards) if (r.takenBy !== null) rolesSeen.add(r.name);
    G.players.forEach(p => p.buildings.forEach(b => builtSeen.add(b.bid)));

    const colonistsTotal = G.colonistsLeft + G.colonistsOnShip + G.players.reduce((s,p)=>s+G.totalColonists(p),0);
    assert(colonistsTotal === expectedColonists[n], `colonists invariant fail (${n}p): ${colonistsTotal}`);
    for (const kind of GOODS) {
      const goodsPlayers = G.players.reduce((s,p)=>s+p.goods[kind],0);
      const goodsShips = G.ships.reduce((s,ship)=>s + (ship.good===kind ? ship.count : 0),0);
      assert(G.supply[kind] + goodsPlayers + goodsShips === expectedGoods[kind], `goods invariant fail ${kind}`);
    }
    assert(G.gameOver === true && G.endTriggered === true, `game end flag fail (${n}p)`);
    assert(G.colonistsLeft <= 0 || G.vpLeft <= 0 || G.players.some(p => G.buildingUsedSpaces(p) >= 12), 'no valid end trigger');
    const totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
    totals.forEach((v, idx) => assert(v > 0, `player ${idx} has non-positive VP: ${v}`));
    return totals;
  }

  for (const n of [3,4,5]) {
    for (let i = 0; i < 20; i++) {
      const totals = await runOneGame(n, [5,5,5,5,5]);
      log(`result mode=all-L5 players=${n} game=${i+1} totals=${totals.join(',')}`);
    }
  }

  for (let g = 0; g < 30; g++) {
    const levels = [1,2,3,4,5];
    const totals = await runOneGame(5, levels);
    for (let i = 0; i < 5; i++) {
      levelVpSums[levels[i]] += totals[i];
      levelCounts[levels[i]] += 1;
    }
    log(`result mode=mixed game=${g+1} levels=${levels.join(',')} totals=${totals.join(',')}`);
  }

  const avg = {};
  for (const l of [1,2,3,4,5]) avg[l] = levelVpSums[l] / levelCounts[l];
  assert(avg[5] > avg[4] && avg[4] > avg[3] && avg[3] > avg[2] && avg[2] > avg[1], `AI hierarchy fail: ${JSON.stringify(avg)}`);
  assert(builtSeen.size === 23, `not all buildings built: seen ${builtSeen.size}`);
  assert(rolesSeen.size === 7, `not all roles selected: seen ${rolesSeen.size}`);
  assert(errLog.length === 0, `console errors detected: ${errLog[0]}`);
  log(`Averages: L1=${avg[1].toFixed(2)} L2=${avg[2].toFixed(2)} L3=${avg[3].toFixed(2)} L4=${avg[4].toFixed(2)} L5=${avg[5].toFixed(2)}`);
  log('ALL ASSERTIONS PASSED');
})();
