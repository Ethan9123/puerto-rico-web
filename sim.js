// ============================================================
// sim.js — 波多黎各无头确定性规则引擎 + ISMCTS（实时搜索 AI）
// ============================================================
// 设计：
//  - 纯函数状态(plain object)，可深拷贝、同步、无 UI/无全局耦合。
//  - 只对"选角色"做 MCTS 搜索（最高价值决策）；其余子决策
//    （选田/派工/建造/生产奖励/卖货/装船/留货）由启发式策略执行。
//  - 依赖 game.js 的静态数据：BUILDINGS / BLD_BY_ID / GOODS / GOOD_PRICE / GOOD_NAMES / ROLE_LIST。
// 在浏览器中 game.js 先加载，这些为全局；Node 测试桩同样先 load game.js。
(function (root) {
  "use strict";
  const A = (typeof BUILDINGS !== "undefined") ? { BUILDINGS, BLD_BY_ID, GOODS, GOOD_PRICE, ROLE_LIST } : root._PR_STATIC;

  const BUILDINGS_ = A.BUILDINGS, BLD = A.BLD_BY_ID, GOODS_ = A.GOODS, PRICE = A.GOOD_PRICE, ROLES_ = A.ROLE_LIST;
  const REFINE = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] };

  // ---------- 建表 ----------
  const COL_TOTAL = { 3: 55, 4: 75, 5: 95 };
  const VP_TOTAL = { 3: 75, 4: 100, 5: 122 };
  const START_MONEY = (n) => n - 1;
  const PLANT_COUNTS = {
    3: { corn: 9, indigo: 10, sugar: 11, tobacco: 9, coffee: 8 },
    4: { corn: 8, indigo: 10, sugar: 11, tobacco: 9, coffee: 8 },
    5: { corn: 8, indigo: 9, sugar: 11, tobacco: 9, coffee: 8 },
  };
  const START_PLANT = {
    3: ["indigo", "indigo", "corn"],
    4: ["indigo", "indigo", "corn", "corn"],
    5: ["indigo", "indigo", "indigo", "corn", "corn"],
  };

  // ---------- RNG（可注入种子，便于复现）----------
  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- 查询助手（纯，operate on player / state）----------
  function ownsBuilding(p, bid) { return p.buildings.find(b => b.bid === bid); }
  function isManned(p, bid) { const b = ownsBuilding(p, bid); return !!b && b.men >= BLD[bid].men; }
  function buildingUsedSpaces(p) { let s = 0; for (const b of p.buildings) s += BLD[b.bid].size; return s; }
  function totalColonists(p) {
    let n = p.unplaced || 0;
    for (const pl of p.plantations) if (pl.manned) n++;
    for (const b of p.buildings) n += b.men;
    return n;
  }
  function productionCapacity(p, good) {
    if (good === "corn") { let c = 0; for (const pl of p.plantations) if (pl.good === "corn" && pl.manned) c++; return c; }
    let plantsManned = 0;
    for (const pl of p.plantations) if (pl.good === good && pl.manned) plantsManned++;
    let fac = 0;
    for (const bid of (REFINE[good] || [])) { const bb = ownsBuilding(p, bid); if (bb) fac += bb.men; }
    return Math.min(plantsManned, fac);
  }
  function storageKinds(p) { let k = 0; if (isManned(p, 10)) k += 1; if (isManned(p, 14)) k += 2; return k; }
  function effectiveCost(p, bld) {
    const maxQ = { 1:1,2:1,3:2,4:2,5:3,6:3,7:1,8:1,9:1,10:1,11:2,12:2,13:2,14:2,15:3,16:3,17:3,18:3,19:4,20:4,21:4,22:4,23:4 }[bld.id];
    let q = 0; for (const pl of p.plantations) if (pl.good === "quarry" && pl.manned) q++;
    return Math.max(0, bld.cost - Math.min(q, maxQ));
  }
  function effectiveCostBonus(p, bld, chooser) { let c = effectiveCost(p, bld); if (chooser) c = Math.max(0, c - 1); return c; }

  function specialVPs(p) {
    let v = 0;
    if (isManned(p, 19)) for (const b of p.buildings) { const bd = BLD[b.bid]; if (bd.type === "production") v += (bd.men === 1 ? 1 : 2); }
    if (isManned(p, 20)) { const n = p.plantations.length; v += (n <= 9 ? 4 : n === 10 ? 5 : n === 11 ? 6 : 7); }
    if (isManned(p, 21)) v += Math.floor(totalColonists(p) / 3);
    if (isManned(p, 22)) v += Math.floor(p.shippingVP / 4);
    if (isManned(p, 23)) for (const b of p.buildings) { const t = BLD[b.bid].type; if (t === "violet" || t === "large_violet") v += 1; }
    return v;
  }
  function finalScore(p) {
    let s = p.vp;
    for (const b of p.buildings) s += BLD[b.bid].vp;
    return s + specialVPs(p);
  }

  // ---------- 初始局面 ----------
  function newState(numPlayers, levels, rnd) {
    const players = [];
    for (let i = 0; i < numPlayers; i++) {
      players.push({
        idx: i, money: 0, vp: 0, shippingVP: 0,
        plantations: [], buildings: [],
        goods: { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 },
        unplaced: 0, wharfUsed: false,
        aiLevel: levels ? levels[i % levels.length] : 5,
      });
    }
    const deck = [];
    const counts = PLANT_COUNTS[numPlayers];
    for (const g of GOODS_) for (let i = 0; i < counts[g]; i++) deck.push(g);
    shuffle(deck, rnd);

    const st = {
      numPlayers, governor: Math.floor((rnd ? rnd() : Math.random()) * numPlayers),
      turnNumber: 1, gameOver: false, endTriggered: false,
      colonistsLeft: COL_TOTAL[numPlayers] - numPlayers, colonistsOnShip: numPlayers,
      vpLeft: VP_TOTAL[numPlayers],
      supply: { corn: 10, indigo: 11, sugar: 11, tobacco: 9, coffee: 9 },
      buildingStock: {}, quarriesLeft: 8,
      plantationDeck: deck, plantationDiscard: [], plantationPool: [],
      ships: [], tradingHouse: [], roleCards: [],
      picksThisTurn: 0, players, rnd: rnd || Math.random,
    };
    BUILDINGS_.forEach(b => st.buildingStock[b.id] = b.qty);
    for (let i = 0; i < 3; i++) st.ships.push({ capacity: numPlayers + 1 + i, good: null, count: 0 });
    const roleCount = numPlayers + 3;
    const used = ROLES_.slice(); if (roleCount === 8) used.push("Prospector");
    st.roleCards = used.slice(0, roleCount).map(n => ({ name: n, money: 0, taken: false, takenBy: null }));
    flipPlantations(st);
    const sp = START_PLANT[numPlayers];
    for (let step = 0; step < numPlayers; step++) players[(st.governor + step) % numPlayers].plantations.push({ good: sp[step], manned: false });
    for (const p of players) p.money = START_MONEY(numPlayers);
    return st;
  }

  function flipPlantations(st) {
    const target = st.numPlayers + 1;
    while (st.plantationPool.length < target) {
      if (st.plantationDeck.length === 0) {
        if (st.plantationDiscard.length === 0) break;
        st.plantationDeck = shuffle(st.plantationDiscard.slice(), st.rnd);
        st.plantationDiscard = [];
      }
      st.plantationPool.push(st.plantationDeck.pop());
    }
  }

  // 深拷贝（结构已知，手写比 structuredClone 快）
  function clone(st) {
    const c = {
      numPlayers: st.numPlayers, governor: st.governor, turnNumber: st.turnNumber,
      gameOver: st.gameOver, endTriggered: st.endTriggered,
      colonistsLeft: st.colonistsLeft, colonistsOnShip: st.colonistsOnShip, vpLeft: st.vpLeft,
      supply: Object.assign({}, st.supply), buildingStock: Object.assign({}, st.buildingStock),
      quarriesLeft: st.quarriesLeft,
      plantationDeck: st.plantationDeck.slice(), plantationDiscard: st.plantationDiscard.slice(),
      plantationPool: st.plantationPool.slice(),
      ships: st.ships.map(s => ({ capacity: s.capacity, good: s.good, count: s.count })),
      tradingHouse: st.tradingHouse.slice(),
      roleCards: st.roleCards.map(r => ({ name: r.name, money: r.money, taken: r.taken, takenBy: r.takenBy })),
      picksThisTurn: st.picksThisTurn, rnd: st.rnd,
      players: st.players.map(p => ({
        idx: p.idx, money: p.money, vp: p.vp, shippingVP: p.shippingVP,
        plantations: p.plantations.map(pl => ({ good: pl.good, manned: pl.manned })),
        buildings: p.buildings.map(b => ({ bid: b.bid, men: b.men })),
        goods: Object.assign({}, p.goods), unplaced: p.unplaced, wharfUsed: p.wharfUsed, aiLevel: p.aiLevel,
      })),
    };
    return c;
  }

  // ---------- 决策点 ----------
  function currentChooser(st) {
    if (st.gameOver) return -1;
    if (st.picksThisTurn >= st.numPlayers) return -1;
    return (st.governor + st.picksThisTurn) % st.numPlayers;
  }
  function legalRoleIdxs(st) {
    const out = [];
    for (let i = 0; i < st.roleCards.length; i++) if (!st.roleCards[i].taken) out.push(i);
    return out;
  }

  // ---------- 启发式子策略 ----------
  function pickPlantation(st, p, options, isChooser) {
    // 采石场：建筑流权重高
    let qCount = 0; for (const pl of p.plantations) if (pl.good === "quarry") qCount++;
    const violet = p.buildings.filter(b => { const t = BLD[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
    const lean = violet >= 1 || p.money >= 7;
    const cap = lean ? 4 : 2;
    if (isChooser && qCount < cap && st.quarriesLeft > 0) { const qi = options.findIndex(o => o.kind === "quarry"); if (qi >= 0) return qi; }
    // 补全产业链
    for (let i = 0; i < options.length; i++) {
      const o = options[i]; if (o.kind !== "plant") continue;
      const ref = REFINE[o.good]; if (!ref) continue;
      let have = p.plantations.filter(pp => pp.good === o.good).length, fac = 0;
      for (const bid of ref) { const bb = ownsBuilding(p, bid); if (bb) fac += BLD[bid].men; }
      if (have < fac) return i;
    }
    for (const g of ["corn", "indigo", "sugar", "tobacco", "coffee"]) { const i = options.findIndex(o => o.kind === "plant" && o.good === g); if (i >= 0) return i; }
    return 0;
  }

  function reallocate(p) {
    let rem = p.unplaced || 0; if (rem <= 0) { p.unplaced = 0; return; }
    const prodUnit = g => 4 + PRICE[g] * 2;
    const violet = p.buildings.filter(b => { const t = BLD[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
    const quarryGain = Math.min(11, 4 + violet * 2);
    const estLV = (id) => {
      if (id === 19) { let s = 0; for (const b of p.buildings) { const bd = BLD[b.bid]; if (bd.type === "production") s += (bd.men === 1 ? 1 : 2); } return s; }
      if (id === 20) { const n = p.plantations.length; return n <= 9 ? 4 : n === 10 ? 5 : n === 11 ? 6 : 7; }
      if (id === 21) return Math.floor(totalColonists(p) / 3);
      if (id === 22) return Math.floor(p.shippingVP / 4);
      if (id === 23) return p.buildings.filter(b => { const t = BLD[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
      return 1;
    };
    const violetVal = (b) => {
      const bd = BLD[b.bid];
      if (bd.type === "large_violet") return Math.max(8, estLV(bd.id) * 4);
      return ({ 17: 12, 18: 10, 15: 10, 13: 8, 12: 7, 7: 6, 16: 6, 8: 5, 9: 5, 11: 5, 10: 4, 14: 4 })[bd.id] || 5;
    };
    while (rem > 0) {
      const fields = { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 }, fT = { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };
      for (const pl of p.plantations) { if (pl.good === "quarry") continue; fT[pl.good]++; if (pl.manned) fields[pl.good]++; }
      const fc = { indigo: 0, sugar: 0, tobacco: 0, coffee: 0 }, fcT = { indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };
      for (const b of p.buildings) { const bd = BLD[b.bid]; if (bd.type === "production" && bd.good && bd.good !== "corn") { fc[bd.good] += b.men; fcT[bd.good] += bd.men; } }
      let best = null, bestGain = 0.01;
      for (const pl of p.plantations) {
        if (pl.manned) continue;
        let gain;
        if (pl.good === "quarry") gain = quarryGain;
        else if (pl.good === "corn") gain = prodUnit("corn");
        else gain = (fields[pl.good] < fcT[pl.good]) ? prodUnit(pl.good) : 0;
        if (gain > bestGain) { bestGain = gain; best = { k: "p", r: pl }; }
      }
      for (const b of p.buildings) {
        const bd = BLD[b.bid]; if (b.men >= bd.men) continue;
        let gain;
        if (bd.type === "production" && bd.good && bd.good !== "corn") gain = (fc[bd.good] < fT[bd.good]) ? prodUnit(bd.good) : 0;
        else if (bd.type === "production") gain = prodUnit("corn");
        else gain = (b.men === 0) ? violetVal(b) : 0;
        if (gain > bestGain) { bestGain = gain; best = { k: "b", r: b }; }
      }
      if (!best) break;
      if (best.k === "p") best.r.manned = true; else best.r.men++;
      rem--;
    }
    p.unplaced = rem;
  }

  function estLVSpecial(p, id) {
    if (id === 19) { let s = 0; for (const b of p.buildings) { const bd = BLD[b.bid]; if (bd.type === "production") s += (bd.men === 1 ? 1 : 2); } return s; }
    if (id === 20) { const n = p.plantations.length; return n <= 9 ? 4 : n === 10 ? 5 : n === 11 ? 6 : 7; }
    if (id === 21) return Math.floor(totalColonists(p) / 3);
    if (id === 22) return Math.floor(p.shippingVP / 4);
    if (id === 23) return p.buildings.filter(b => { const t = BLD[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
    return 1;
  }
  // 收入引擎早→得分建筑中→大紫晚（与 game.js evalBuildingValue 同步）
  function evalBuilding(st, p, b, phase) {
    let v = b.vp * 5;
    const id = b.id;
    if (b.type === "production") {
      const good = b.good;
      const owned = p.plantations.filter(pl => pl.good === good).length;
      const pool = st.plantationPool.filter(g => g === good).length;
      let ex = 0; for (const bb of p.buildings) { const bd = BLD[bb.bid]; if (bd.type === "production" && bd.good === good) ex += bd.men; }
      const now = Math.max(0, Math.min(owned - ex, b.men)), soon = Math.max(0, Math.min(owned + pool - ex, b.men));
      if (soon <= 0) return v - 30;
      v += now * 12 + (soon - now) * 4;
      const income = (good === "coffee" || good === "tobacco");
      if (phase === "early") v += income ? 22 : 10; else if (phase === "mid") v += income ? 10 : 4; else v -= 12;
      return v;
    }
    switch (id) {
      case 7:  v += phase === "early" ? 14 : phase === "mid" ? 16 : 6; break;
      case 8:  v += phase === "early" ? 12 : 3; break;
      case 9:  v += phase === "early" ? 12 : 2; break;
      case 10: v += phase === "mid" ? 14 : phase === "early" ? 6 : 9; break;
      case 11: v += phase === "early" ? 2 : 4; break;
      case 12: v += 5; break;
      case 13: v += phase === "mid" ? 16 : 8; break;
      case 14: v += 3; break;
      case 15: { const kinds = GOODS_.filter(g => productionCapacity(p, g) > 0).length; v += kinds * 8 + (phase === "early" ? 16 : phase === "mid" ? 10 : -4); break; }
      case 16: v += 1; break;
      case 17: v += phase === "mid" ? 28 : phase === "early" ? 14 : 8; break;
      case 18: v += phase === "mid" ? 22 : phase === "early" ? 8 : 6; break;
    }
    if (b.type === "large_violet") v += estLVSpecial(p, id) * 4 + (phase === "late" ? 20 : phase === "mid" ? 8 : 0);
    return v;
  }

  function phaseOf(st) {
    const cu = 1 - st.colonistsLeft / COL_TOTAL[st.numPlayers];
    const vu = 1 - st.vpLeft / VP_TOTAL[st.numPlayers];
    const pr = Math.max(cu, vu);
    return pr < 0.33 ? "early" : pr < 0.66 ? "mid" : "late";
  }

  // ---------- 角色阶段（顺时针 from chooser）----------
  function order(st, chooser) { const o = []; for (let i = 0; i < st.numPlayers; i++) o.push((chooser + i) % st.numPlayers); return o; }

  function doSettler(st, chooser) {
    for (const i of order(st, chooser)) {
      const p = st.players[i];
      if (p.plantations.length >= 12) continue;
      const hut = isManned(p, 9);
      const opts = [];
      for (let k = 0; k < st.plantationPool.length; k++) opts.push({ kind: "plant", good: st.plantationPool[k], idx: k });
      if (st.quarriesLeft > 0 && (i === chooser || hut)) opts.push({ kind: "quarry" });
      if (opts.length === 0) continue;
      const pick = opts[pickPlantation(st, p, opts, i === chooser)];
      let pl;
      if (pick.kind === "quarry") { st.quarriesLeft--; pl = { good: "quarry", manned: false }; }
      else { pl = { good: pick.good, manned: false }; st.plantationPool.splice(pick.idx, 1); }
      p.plantations.push(pl);
      if (isManned(p, 8) && p.plantations.length < 12 && st.plantationDeck.length > 0) p.plantations.push({ good: st.plantationDeck.pop(), manned: false });
      if (isManned(p, 11)) { if (st.colonistsLeft > 0) { pl.manned = true; st.colonistsLeft--; } else if (st.colonistsOnShip > 0) { pl.manned = true; st.colonistsOnShip--; } }
    }
    if (st.plantationPool.length > 0) { st.plantationDiscard = st.plantationDiscard.concat(st.plantationPool); st.plantationPool = []; }
  }

  function doMayor(st, chooser) {
    const ord = order(st, chooser);
    if (st.colonistsLeft > 0) { st.colonistsLeft--; st.players[chooser].unplaced = (st.players[chooser].unplaced || 0) + 1; }
    let safety = 0;
    while (st.colonistsOnShip > 0 && safety++ < 200) {
      for (const i of ord) { if (st.colonistsOnShip <= 0) break; st.players[i].unplaced = (st.players[i].unplaced || 0) + 1; st.colonistsOnShip--; }
    }
    for (const i of ord) { const p = st.players[i]; if (p.unplaced) reallocate(p); }
    let open = 0; for (const p of st.players) for (const b of p.buildings) open += (BLD[b.bid].men - b.men);
    const refill = Math.max(st.numPlayers, open);
    if (st.colonistsLeft < refill) st.endTriggered = true;
    const actual = Math.min(refill, st.colonistsLeft);
    st.colonistsOnShip = actual; st.colonistsLeft -= actual;
  }

  function doBuilder(st, chooser) {
    const phase = phaseOf(st);
    for (const i of order(st, chooser)) {
      const p = st.players[i];
      if (buildingUsedSpaces(p) >= 12) continue;
      const opts = [];
      for (const b of BUILDINGS_) {
        if (st.buildingStock[b.id] <= 0) continue;
        if (ownsBuilding(p, b.id)) continue;
        if (12 - buildingUsedSpaces(p) < b.size) continue;
        const cost = effectiveCostBonus(p, b, i === chooser);
        if (p.money < cost) continue;
        opts.push({ b, cost });
      }
      if (opts.length === 0) continue;
      let bestI = -1, bestS = -Infinity;
      for (let k = 0; k < opts.length; k++) { let s = evalBuilding(st, p, opts[k].b, phase) - opts[k].cost * 3 + (i === chooser ? 5 : 0); if (s > bestS) { bestS = s; bestI = k; } }
      if (bestI < 0 || bestS <= 0) continue; // 没有正收益建筑就不建
      const { b, cost } = opts[bestI];
      p.money -= cost; st.buildingStock[b.id]--; p.buildings.push({ bid: b.id, men: 0 });
      if (isManned(p, 16)) { const nb = p.buildings[p.buildings.length - 1]; if (st.colonistsLeft > 0) { nb.men = Math.min(1, BLD[b.id].men); st.colonistsLeft--; } else if (st.colonistsOnShip > 0) { nb.men = Math.min(1, BLD[b.id].men); st.colonistsOnShip--; } }
    }
  }

  function doCraftsman(st, chooser) {
    const produced = new Set();
    const perKinds = st.players.map(() => new Set());
    for (const g of GOODS_) {
      for (const i of order(st, chooser)) {
        if (st.supply[g] <= 0) break;
        const p = st.players[i];
        let cap = productionCapacity(p, g), did = false;
        while (cap > 0 && st.supply[g] > 0) { p.goods[g]++; st.supply[g]--; cap--; produced.add(g); did = true; }
        if (did) perKinds[i].add(g);
      }
    }
    const fb = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 };
    for (let i = 0; i < st.players.length; i++) { const p = st.players[i]; if (isManned(p, 15)) { const bonus = fb[perKinds[i].size] || 0; if (bonus > 0) p.money += bonus; } }
    const ch = st.players[chooser];
    const avail = GOODS_.filter(g => st.supply[g] > 0 && produced.has(g));
    if (avail.length > 0) { const g = avail.reduce((a, b) => PRICE[a] >= PRICE[b] ? a : b); ch.goods[g]++; st.supply[g]--; }
  }

  function doTrader(st, chooser) {
    for (const i of order(st, chooser)) {
      const p = st.players[i];
      if (st.tradingHouse.length >= 4) break;
      const office = isManned(p, 12);
      const sellable = GOODS_.filter(g => p.goods[g] > 0 && (office || !st.tradingHouse.includes(g)));
      if (sellable.length === 0) continue;
      const g = sellable.reduce((a, b) => PRICE[a] >= PRICE[b] ? a : b);
      p.goods[g]--; st.tradingHouse.push(g);
      let earn = PRICE[g]; if (i === chooser) earn += 1; if (isManned(p, 7)) earn += 1; if (isManned(p, 13)) earn += 2;
      p.money += earn;
    }
    if (st.tradingHouse.length >= 4) { for (const g of st.tradingHouse) st.supply[g]++; st.tradingHouse = []; }
  }

  function rankCaptain(cands, ships, phase) {
    const score = (c) => {
      if (c.ship === "wharf") return -1;
      const s = ships[c.ship]; const rem = s.capacity - s.count;
      let v = (s.good === c.good ? 1000 : 0) + rem * 10 + (c.amount || 0);
      if (phase && phase !== "late") v += (4 - PRICE[c.good]) * 60; // 早/中期弃廉价货、留咖啡/烟草
      return v;
    };
    return cands.slice().sort((a, b) => score(b) - score(a));
  }
  function doCaptain(st, chooser) {
    const phase = phaseOf(st);
    const ord = order(st, chooser);
    const bonusUsed = new Set();
    let progress = true;
    while (progress) {
      progress = false;
      for (const i of ord) {
        const p = st.players[i];
        const cands = [];
        for (let s = 0; s < st.ships.length; s++) {
          const ship = st.ships[s]; if (ship.count >= ship.capacity) continue;
          if (ship.good === null) {
            for (const g of GOODS_) { if (p.goods[g] <= 0) continue; if (st.ships.some((sh, idx) => idx !== s && sh.good === g)) continue; cands.push({ ship: s, good: g, amount: Math.min(p.goods[g], ship.capacity - ship.count) }); }
          } else if (p.goods[ship.good] > 0) cands.push({ ship: s, good: ship.good, amount: Math.min(p.goods[ship.good], ship.capacity - ship.count) });
        }
        if (isManned(p, 18) && !p.wharfUsed) for (const g of GOODS_) if (p.goods[g] > 0) cands.push({ ship: "wharf", good: g, amount: p.goods[g] });
        if (cands.length === 0) continue;
        const pick = rankCaptain(cands, st.ships, phase)[0];
        let loaded;
        if (pick.ship === "wharf") { p.goods[pick.good] -= pick.amount; loaded = pick.amount; p.wharfUsed = true; st.supply[pick.good] += pick.amount; }
        else { const ship = st.ships[pick.ship]; if (ship.good === null) ship.good = pick.good; loaded = Math.min(pick.amount, ship.capacity - ship.count); ship.count += loaded; p.goods[pick.good] -= loaded; }
        let vp = loaded;
        if (i === chooser && !bonusUsed.has(i)) { vp += 1; bonusUsed.add(i); }
        if (isManned(p, 17)) vp += 1;
        const g = Math.min(vp, st.vpLeft); p.vp += g; p.shippingVP += g; st.vpLeft -= g;
        progress = true;
      }
    }
    for (const ship of st.ships) if (ship.count >= ship.capacity) { st.supply[ship.good] += ship.count; ship.good = null; ship.count = 0; }
    for (const p of st.players) {
      const total = GOODS_.reduce((s, g) => s + p.goods[g], 0);
      if (total > 0) {
        const kinds = storageKinds(p);
        const sorted = GOODS_.filter(g => p.goods[g] > 0).sort((a, b) => PRICE[b] - PRICE[a]);
        const keep = {}; const full = sorted.slice(0, kinds);
        for (const g of full) keep[g] = p.goods[g];
        const rest = sorted.filter(g => !full.includes(g)); if (rest.length > 0) keep[rest[0]] = 1;
        for (const g of GOODS_) { const disc = p.goods[g] - (keep[g] || 0); if (disc > 0) st.supply[g] += disc; p.goods[g] = keep[g] || 0; }
      }
      p.wharfUsed = false;
    }
  }

  function checkEnd(st) {
    if (st.colonistsLeft <= 0 && st.colonistsOnShip <= 0) st.endTriggered = true;
    if (st.vpLeft <= 0) st.endTriggered = true;
    for (const p of st.players) if (buildingUsedSpaces(p) >= 12) { st.endTriggered = true; break; }
  }

  // ---------- 应用一次"选角色"决策（推进到下一个 chooser 或结束）----------
  function applyRole(st, roleIdx) {
    const chooser = currentChooser(st);
    if (chooser < 0) return st;
    const card = st.roleCards[roleIdx];
    card.taken = true; card.takenBy = chooser;
    st.players[chooser].money += card.money; card.money = 0;
    switch (card.name) {
      case "Settler": doSettler(st, chooser); break;
      case "Mayor": doMayor(st, chooser); break;
      case "Builder": doBuilder(st, chooser); break;
      case "Craftsman": doCraftsman(st, chooser); break;
      case "Trader": doTrader(st, chooser); break;
      case "Captain": doCaptain(st, chooser); break;
      case "Prospector": st.players[chooser].money += 1; break;
    }
    checkEnd(st);
    st.picksThisTurn++;
    // 本回合所有人选完(或无牌可选) → 回合结束
    if (st.picksThisTurn >= st.numPlayers || legalRoleIdxs(st).length === 0) {
      for (const r of st.roleCards) if (!r.taken) r.money += 1;
      if (st.endTriggered) { st.gameOver = true; }
      else {
        st.governor = (st.governor + 1) % st.numPlayers;
        st.turnNumber++;
        flipPlantations(st);
        for (const r of st.roleCards) { r.taken = false; r.takenBy = null; }
        st.picksThisTurn = 0;
      }
    }
    return st;
  }

  // 防止无限局：硬上限
  const MAX_TURNS = 60;
  function isTerminal(st) { return st.gameOver || st.turnNumber > MAX_TURNS; }

  // ---------- rollout 用的快速启发式选角色 ----------
  function heuristicPickRole(st, chooser, legal) {
    const p = st.players[chooser];
    const has = name => { for (const i of legal) if (st.roleCards[i].name === name) return i; return -1; };
    const goods = GOODS_.reduce((s, g) => s + p.goods[g], 0);
    let open = 0; for (const pl of p.plantations) if (!pl.manned) open++; for (const b of p.buildings) open += (BLD[b.bid].men - b.men);
    // 高奖金角色卡优先
    let bestMoney = -1, bestMoneyVal = 2; for (const i of legal) if (st.roleCards[i].money > bestMoneyVal) { bestMoneyVal = st.roleCards[i].money; bestMoney = i; }
    let cap = 0; for (const s of st.ships) cap += (s.capacity - s.count);
    const downstream = st.players[(chooser + 1) % st.numPlayers];
    const mannedCorn = p.plantations.filter(pl => pl.good === "corn" && pl.manned).length;
    // 规则①：玉米地多+有货+船有空 → 运船
    if (mannedCorn >= 2 && goods >= 3 && cap > 0 && has("Captain") >= 0) return has("Captain");
    // 规则②：高价作物(咖啡/烟草)且下家也有 → 卖掉卡下家
    if (st.tradingHouse.length < 4 && has("Trader") >= 0) {
      const office = isManned(p, 12);
      for (const g of ["coffee", "tobacco"]) {
        if (p.goods[g] > 0 && downstream.goods[g] > 0 && (office || !st.tradingHouse.includes(g))) return has("Trader");
      }
    }
    // 规则③：落后/对手引擎成熟 → 买大紫或塞满12格加速结束
    if (p.money >= 10 && has("Builder") >= 0) {
      const myScore = finalScore(p);
      let lead = 0, oppMature = false;
      for (const o of st.players) { if (o === p) continue; const s = finalScore(o); if (s > lead) lead = s; let pr = 0; for (const g of GOODS_) pr += productionCapacity(o, g); if (pr >= 5 && o.buildings.length >= 5) oppMature = true; }
      if (myScore < lead - 3 || oppMature) {
        const spaceLeft = 12 - buildingUsedSpaces(p);
        for (const b of BUILDINGS_) {
          if (st.buildingStock[b.id] <= 0 || ownsBuilding(p, b.id) || spaceLeft < b.size) continue;
          if (p.money >= Math.max(0, b.cost - 1) && (b.type === "large_violet" || spaceLeft <= 4)) return has("Builder");
        }
      }
    }
    if (goods >= 4 && cap > 0 && has("Captain") >= 0) return has("Captain");
    if (open >= 1 && st.colonistsOnShip >= 1 && has("Mayor") >= 0) return has("Mayor");
    if (p.money >= 5) { const b = has("Builder"); if (b >= 0) return b; }
    let prod = 0; for (const g of GOODS_) prod += productionCapacity(p, g);
    if (prod >= 2 && has("Craftsman") >= 0) return has("Craftsman");
    if (goods >= 2 && st.tradingHouse.length < 4 && has("Trader") >= 0) return has("Trader");
    if (bestMoney >= 0) return bestMoney;
    if (p.plantations.length < 4 && has("Settler") >= 0) return has("Settler");
    if (has("Prospector") >= 0) return has("Prospector");
    return legal[0];
  }

  function rolloutToEnd(st, rnd) {
    let guard = 0;
    while (!isTerminal(st) && guard++ < 400) {
      const ch = currentChooser(st);
      if (ch < 0) break;
      const legal = legalRoleIdxs(st);
      if (legal.length === 0) break;
      // ε-greedy：大多用启发式，小概率随机，增加探索多样性
      let ri;
      if ((rnd ? rnd() : Math.random()) < 0.15) ri = legal[Math.floor((rnd ? rnd() : Math.random()) * legal.length)];
      else ri = heuristicPickRole(st, ch, legal);
      applyRole(st, ri);
    }
    return st;
  }

  // 终局奖励（从 perspective 玩家视角）：胜=1、平分摊、负=0；叠加小幅分差降噪
  function reward(st, perspective) {
    const scores = st.players.map(finalScore);
    const my = scores[perspective];
    const best = Math.max(...scores);
    const winners = scores.filter(s => s === best).length;
    let r = (my === best) ? (1 / winners) : 0;
    const second = Math.max(...scores.filter((_, i) => i !== perspective), 0);
    const margin = (my - second) / 30; // 归一化分差
    return 0.8 * r + 0.2 * Math.max(-1, Math.min(1, margin));
  }

  // ---------- 价值函数（自对弈训练的逻辑回归，指导 MCTS 叶子评估）----------
  // 从 perspective 玩家视角抽取状态特征（与对手相对）。第 0 维为偏置。
  function extractFeatures(st, idx) {
    const me = st.players[idx];
    const myScore = finalScore(me);
    const oppCount = st.numPlayers - 1;
    let bestOpp = 0, sumOpp = 0, avgOppProd = 0, avgOppBuild = 0;
    let myProd = 0; for (const g of GOODS_) myProd += productionCapacity(me, g);
    for (const p of st.players) {
      if (p === me) continue;
      const s = finalScore(p); if (s > bestOpp) bestOpp = s; sumOpp += s;
      let pr = 0; for (const g of GOODS_) pr += productionCapacity(p, g);
      avgOppProd += pr; avgOppBuild += p.buildings.length;
    }
    avgOppProd /= oppCount; avgOppBuild /= oppCount;
    const myGoods = GOODS_.reduce((a, g) => a + me.goods[g], 0);
    let myQuarry = 0; for (const pl of me.plantations) if (pl.good === "quarry" && pl.manned) myQuarry++;
    let bigV = 0; for (const b of me.buildings) { const bd = BLD[b.bid]; if (bd.type === "large_violet" && b.men >= bd.men) bigV++; }
    const colTot = COL_TOTAL[st.numPlayers], vpTot = VP_TOTAL[st.numPlayers];
    const progress = Math.max(1 - st.colonistsLeft / colTot, 1 - st.vpLeft / vpTot);
    return [
      1,                                        // 0 偏置
      myScore / 40,                             // 1 我的分
      (myScore - bestOpp) / 25,                 // 2 与最强对手分差
      (myScore - sumOpp / oppCount) / 25,       // 3 与平均对手分差
      myGoods / 10,                             // 4 我的货
      myProd / 8,                               // 5 我的产能
      (myProd - avgOppProd) / 5,                // 6 产能优势
      me.buildings.length / 10,                 // 7 建筑数
      (me.buildings.length - avgOppBuild) / 5,  // 8 建筑优势
      me.plantations.length / 12,               // 9 田数
      me.money / 12,                            // 10 钱
      totalColonists(me) / 18,                  // 11 殖民者
      myQuarry / 4,                             // 12 已上岗采石场
      me.shippingVP / 20,                       // 13 船运 VP
      bigV / 2,                                 // 14 已激活大紫
      progress,                                 // 15 进程
      st.vpLeft / vpTot,                        // 16 VP 池余量
      st.colonistsLeft / colTot,                // 17 殖民者池余量
    ];
  }
  const FEATURE_DIM = 18;

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  // 返回胜率估计 [0,1]
  function evalValue(features, W) {
    let z = 0; for (let i = 0; i < features.length; i++) z += features[i] * W[i];
    return sigmoid(z);
  }

  // 叶子评估：有权重 W 时截断 rollout truncate 步后用价值函数；否则全 rollout。
  // 返回一个函数 perspective→[-1,1] 奖励（统一标度供 UCT 用）。
  function evalLeaf(st, W, truncate, rnd) {
    if (!W) { rolloutToEnd(st, rnd); return (persp) => reward(st, persp); }
    let steps = 0;
    while (!isTerminal(st) && steps++ < truncate) {
      const ch = currentChooser(st); if (ch < 0) break;
      const legal = legalRoleIdxs(st); if (!legal.length) break;
      applyRole(st, heuristicPickRole(st, ch, legal));
    }
    if (isTerminal(st)) return (persp) => reward(st, persp);
    return (persp) => 2 * evalValue(extractFeatures(st, persp), W) - 1; // [0,1]→[-1,1]
  }

  // ---------- ISMCTS（单观察者，确定化隐藏牌堆）----------
  function determinize(st) {
    // 重排未知的种植园牌堆顺序（公开的 pool 不动）；对手 VP 在本模型中已公开（简化）
    const c = clone(st);
    shuffle(c.plantationDeck, c.rnd);
    return c;
  }

  function ismctsPickRoleIdx(rootState, opts) {
    opts = opts || {};
    const budgetMs = opts.budgetMs || 1500;
    const maxIters = opts.maxIters || 20000;
    const C = opts.C || 1.4;
    const valueW = opts.valueW || null;        // 价值函数权重（给定则用价值制导）
    const truncate = opts.truncate != null ? opts.truncate : 6; // 截断 rollout 步数
    if (currentChooser(rootState) < 0) return -1;
    const rootLegal = legalRoleIdxs(rootState);
    if (rootLegal.length <= 1) return rootLegal[0];

    // 信息集树：节点 children keyed by 角色名（角色卡公开 → 各确定化下动作集一致）。
    const root = { N: 0, Q: 0, children: new Map() };
    const t0 = Date.now();
    let iters = 0;
    while (iters < maxIters) {
      if ((iters & 15) === 0 && Date.now() - t0 >= budgetMs) break;
      iters++;
      const st = determinize(rootState);
      const visited = []; // {child, chooser}
      let node = root;
      while (!isTerminal(st)) {
        const ch = currentChooser(st);
        if (ch < 0) break;
        const legal = legalRoleIdxs(st);
        if (legal.length === 0) break;
        for (const i of legal) { const nm = st.roleCards[i].name; if (!node.children.has(nm)) node.children.set(nm, { N: 0, Q: 0, children: new Map() }); }
        // UCT（未访问动作记 +∞，优先扩展）
        let chosen = null, bestV = -Infinity;
        for (const i of legal) {
          const nm = st.roleCards[i].name, c = node.children.get(nm);
          const v = c.N === 0 ? Infinity : c.Q / c.N + C * Math.sqrt(Math.log(node.N + 1) / c.N);
          if (v > bestV) { bestV = v; chosen = nm; }
        }
        const ri = legal.find(i => st.roleCards[i].name === chosen);
        const child = node.children.get(chosen);
        const wasUnvisited = child.N === 0;
        visited.push({ child, chooser: ch });
        applyRole(st, ri);
        node = child;
        if (wasUnvisited) break; // 扩展一个新节点后转 rollout
      }
      const leafEval = evalLeaf(st, valueW, truncate, rootState.rnd);
      root.N++;
      for (const v of visited) { v.child.N++; v.child.Q += leafEval(v.chooser); }
    }
    // 选 root 下访问最多的动作（最稳健）
    let bestName = null, bestN = -1;
    for (const [nm, c] of root.children) if (c.N > bestN) { bestN = c.N; bestName = nm; }
    const ri = rootLegal.find(i => rootState.roleCards[i].name === bestName);
    return ri != null ? ri : rootLegal[0];
  }

  const API = {
    newState, clone, applyRole, legalRoleIdxs, currentChooser, isTerminal,
    finalScore, specialVPs, rolloutToEnd, heuristicPickRole, reward,
    ismctsPickRoleIdx, phaseOf, totalColonists, productionCapacity,
    extractFeatures, evalValue, FEATURE_DIM,
    _internal: { doSettler, doMayor, doBuilder, doCraftsman, doTrader, doCaptain, reallocate, pickPlantation },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PRSim = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
