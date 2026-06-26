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
  const COL_TOTAL = { 1: 29, 2: 40, 3: 55, 4: 75, 5: 95 }; // 殖民者供应池(船上另置=玩家数, 不从池扣)
  const VP_TOTAL = { 1: 50, 2: 65, 3: 75, 4: 100, 5: 122 };
  const START_MONEY = (n) => ({ 1: 2, 2: 3 })[n] ?? (n - 1);
  // 每轮选角色次数：1p=3, 2p=6（官方变体每人 3 次），3-5p=玩家数
  const picksPerRound = (n) => ({ 1: 3, 2: 6 })[n] || n;
  const ROLE_COUNT = { 1: 7, 2: 7, 3: 6, 4: 7, 5: 8 };
  const SUPPLY_BY_N = { 2: { corn: 8, indigo: 10, sugar: 9, tobacco: 7, coffee: 6 } };
  const PLANT_COUNTS = {
    1: { corn: 7, indigo: 9, sugar: 8, tobacco: 6, coffee: 5 },
    2: { corn: 6, indigo: 8, sugar: 8, tobacco: 6, coffee: 5 }, // -3/种 再扣起始田(1玉米+1靛蓝)
    3: { corn: 9, indigo: 10, sugar: 11, tobacco: 9, coffee: 8 },
    4: { corn: 8, indigo: 10, sugar: 11, tobacco: 9, coffee: 8 },
    5: { corn: 8, indigo: 9, sugar: 11, tobacco: 9, coffee: 8 },
  };
  const START_PLANT = {
    1: ["indigo"],
    2: ["indigo", "corn"],
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
  // 某玩家是否在做某货（用于垄断/撞货判断）
  function simProduces(pl, g) {
    if (pl.plantations.some(x => x.good === g)) return true;
    const ref = REFINE[g];
    return !!(ref && ref.some(bid => ownsBuilding(pl, bid)));
  }
  function anyOppProduces(st, me, g) {
    for (const o of st.players) { if (o === me) continue; if (simProduces(o, g)) return true; }
    return false;
  }
  function effectiveCost(p, bld, np) {
    const maxQ = { 1:1,2:1,3:2,4:2,5:3,6:3,7:1,8:1,9:1,10:1,11:2,12:2,13:2,14:2,15:3,16:3,17:3,18:3,19:4,20:4,21:4,22:4,23:4,
      24:1,25:1,26:1,27:1,28:2,29:2,30:2,31:2,32:3,33:3,34:3,35:3,36:4,37:4 }[bld.id] || 1; // 含扩展 24-37
    let q = 0; for (const pl of p.plantations) if (pl.good === "quarry" && pl.manned) q++;
    const forest = Math.floor(p.plantations.filter(pl => pl.good === "forest").length / 2); // 扩展：森林屋折扣
    const baseCost = (bld.id === 53 && np) ? (7 + np) : bld.cost; // Tibs 大教堂(53)：官方造价 7 + 玩家数（非固定 10）
    return Math.max(0, baseCost - Math.min(q, maxQ) - forest);
  }
  function effectiveCostBonus(p, bld, chooser, np) { let c = effectiveCost(p, bld, np); if (chooser) c = Math.max(0, c - (isManned(p, 33) ? 2 : 1)); return c; } // 图书馆建造翻倍

  function specialVPs(p) {
    let v = 0;
    if (isManned(p, 19)) for (const b of p.buildings) { const bd = BLD[b.bid]; if (bd.type === "production") v += (bd.men === 1 ? 1 : 2); }
    if (isManned(p, 20)) { const n = p.plantations.length; v += (n <= 9 ? 4 : n === 10 ? 5 : n === 11 ? 6 : 7); }
    if (isManned(p, 21)) v += Math.floor(totalColonists(p) / 3);
    if (isManned(p, 22)) v += Math.floor(p.vp / 4) /* 海关：按全部 VP 筹码（与 game.js 同口径） */;
    if (isManned(p, 23)) for (const b of p.buildings) { const t = BLD[b.bid].type; if (t === "violet" || t === "large_violet") v += 1; }
    // 扩展：Statue(37) 直接 +8（无需镇守）；Cloister(36) 每 3 张同类种植园成套 1/3/6/10（需镇守）
    // Statue(37)：印刷 VP 即 8，已计入建筑分，这里不再加（避免双重计分）
    if (isManned(p, 36)) {
      const cnt = {}; for (const pl of p.plantations) cnt[pl.good] = (cnt[pl.good] || 0) + 1; // 官方：全部岛屿地块成套
      let sets = 0; for (const k in cnt) sets += Math.floor(cnt[k] / 3);
      v += [0, 1, 3, 6, 10][Math.min(sets, 4)];
    }
    // 贵族扩展(标量)：每名贵族终局 +1VP；皇家花园(45) 镇守时每名贵族再 +1VP
    const nb = p.nobleCount || 0;
    if (nb > 0) { v += nb; if (isManned(p, 45)) v += nb; }
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
      colonistsLeft: COL_TOTAL[numPlayers], colonistsOnShip: numPlayers,
      vpLeft: VP_TOTAL[numPlayers],
      supply: Object.assign({}, SUPPLY_BY_N[numPlayers] || { corn: 10, indigo: 12, sugar: 11, tobacco: 9, coffee: 8 }),
      buildingStock: {}, quarriesLeft: (numPlayers === 2) ? 5 : 8,
      plantationDeck: deck, plantationDiscard: [], plantationPool: [],
      ships: [], tradingHouse: [], roleCards: [],
      picksThisTurn: 0, players, rnd: rnd || Math.random,
    };
    BUILDINGS_.forEach(b => st.buildingStock[b.id] = (numPlayers === 2) ? (BLD[b.id].type === "production" ? 2 : 1) : b.qty);
    if (numPlayers <= 2) { for (const cap of [4, 6]) st.ships.push({ capacity: cap, good: null, count: 0 }); }
    else { for (let i = 0; i < 3; i++) st.ships.push({ capacity: numPlayers + 1 + i, good: null, count: 0 }); }
    const roleCount = ROLE_COUNT[numPlayers];
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
      expansionNobles: st.expansionNobles, noblesLeft: st.noblesLeft, noblesOnShip: st.noblesOnShip, // 贵族扩展(标量)
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
        nobleCount: p.nobleCount, // 贵族扩展(标量)
      })),
    };
    // 复制因子化决策游标(MCTS 需要在子决策处 clone 分叉)
    if (st.az) c.az = Object.assign({}, st.az, {
      ord: st.az.ord ? st.az.ord.slice() : undefined,
      produced: st.az.produced ? st.az.produced.slice() : undefined,
    });
    return c;
  }

  // ---------- 决策点 ----------
  function currentChooser(st) {
    if (st.gameOver) return -1;
    if (st.picksThisTurn >= picksPerRound(st.numPlayers)) return -1;
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
    // 在 plant 选项里打分：补产业链 > 垄断 > 避免撞右手高价货 > 多样化
    const upstream = st.players[(p.idx - 1 + st.numPlayers) % st.numPlayers];
    const ph = phaseOf(st);
    let bestI = -1, bestS = -Infinity;
    for (let i = 0; i < options.length; i++) {
      const o = options[i]; if (o.kind !== "plant") continue;
      const g = o.good;
      let s = PRICE[g] * 1.5;
      if (g === "corn") s += (ph === "early" ? 6 : 3);
      const ref = REFINE[g];
      let fac = 0; if (ref) for (const bid of ref) { const bb = ownsBuilding(p, bid); if (bb) fac += BLD[bid].men; }
      const myCount = p.plantations.filter(pp => pp.good === g).length;
      if (ref && myCount < fac) s += 14;
      if (myCount === 0 && g !== "corn") s += 2;
      if (!anyOppProduces(st, p, g)) s += 3 + PRICE[g];
      if ((g === "coffee" || g === "tobacco") && simProduces(upstream, g)) s -= 5;
      if (s > bestS) { bestS = s; bestI = i; }
    }
    return bestI >= 0 ? bestI : 0;
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
      if (id === 22) return Math.floor(p.vp / 4) /* 海关：按全部 VP 筹码（与 game.js 同口径） */;
      if (id === 23) return p.buildings.filter(b => { const t = BLD[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
      return 1;
    };
    const violetVal = (b) => {
      const bd = BLD[b.bid];
      if (bd.type === "large_violet") return Math.max(8, estLV(bd.id) * 4);
      return ({ 17: 12, 18: 10, 15: 10, 13: 8, 12: 7, 7: 6, 16: 6, 8: 5, 9: 5, 11: 5, 10: 4, 14: 4,
        // 新建筑扩展先验
        34: 12, 35: 11, 33: 11, 32: 10, 30: 9, 28: 9, 29: 8, 31: 8, 27: 6, 24: 6, 26: 6, 25: 5 })[bd.id] || 5;
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
      if (!best) {
        // 规则：只要面板上还有空位就必须放置，不能主动留在岸边（森林不可上工人）
        const pl = p.plantations.find(x => !x.manned && x.good !== "forest" && x.good !== "quarry") || p.plantations.find(x => !x.manned && x.good !== "forest");
        if (pl) { pl.manned = true; rem--; continue; }
        const bb = p.buildings.find(x => x.men < BLD[x.bid].men);
        if (bb) { bb.men++; rem--; continue; }
        break;
      }
      if (best.k === "p") best.r.manned = true; else best.r.men++;
      rem--;
    }
    p.unplaced = rem;
  }

  function estLVSpecial(p, id) {
    if (id === 19) { let s = 0; for (const b of p.buildings) { const bd = BLD[b.bid]; if (bd.type === "production") s += (bd.men === 1 ? 1 : 2); } return s; }
    if (id === 20) { const n = p.plantations.length; return n <= 9 ? 4 : n === 10 ? 5 : n === 11 ? 6 : 7; }
    if (id === 21) return Math.floor(totalColonists(p) / 3);
    if (id === 22) return Math.floor(p.vp / 4) /* 海关：按全部 VP 筹码（与 game.js 同口径） */;
    if (id === 23) return p.buildings.filter(b => { const t = BLD[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
    // 扩展：Cloister(36) 估成套；Statue(37) 的 8VP 已在 vp 字段
    if (id === 36) { const cnt = {}; for (const pl of p.plantations) cnt[pl.good] = (cnt[pl.good] || 0) + 1; let sets = 0; for (const k in cnt) sets += Math.floor(cnt[k] / 3); return [0, 1, 3, 6, 10][Math.min(sets, 4)]; } // 修道院:全部岛屿地块成套
    if (id === 37) return 0;
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
      if (income) { // 垄断/不撞右手
        if (!anyOppProduces(st, p, good)) v += 8;
        else if (simProduces(st.players[(p.idx - 1 + st.numPlayers) % st.numPlayers], good)) v -= 6;
      }
      if (ownsBuilding(p, 19)) v += (b.men === 1 ? 1 : 2) * 5; // combo：已有公会大厅 → 每个生产建筑额外终局 VP
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
      case 15: { // 工厂：多样性收入引擎(早中很强)。kinds 用"已产或有田"前瞻计数 + 高多样非线性奖励
        let kinds = 0;
        for (const g of GOODS_) if (productionCapacity(p, g) > 0 || p.plantations.some(pl => pl.good === g)) kinds++;
        const fb = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 };
        v += kinds * 6 + fb[Math.min(5, kinds)] * 4 + (phase === "early" ? 16 : phase === "mid" ? 10 : -4);
        break;
      }
      case 16: v += 1; break;
      case 17: v += phase === "mid" ? 28 : phase === "early" ? 14 : 8; break;
      case 18: v += phase === "mid" ? 22 : phase === "early" ? 8 : 6; break;
      // 新建筑扩展（与 game.js evalBuildingValue 同步）
      case 24: { const u = ownsBuilding(p, 3) || ownsBuilding(p, 4); v += u ? (phase === "late" ? 4 : 12) : 1; break; }
      case 25: v += phase === "early" ? 5 : 3; break;
      case 26: { const vio = p.buildings.filter(bb => { const t = BLD[bb.bid].type; return t === "violet" || t === "large_violet"; }).length; v += vio >= 2 ? (phase === "late" ? 3 : 8) : 2; break; }
      case 27: { let prod = 0; for (const g of GOODS_) prod += productionCapacity(p, g); v += Math.min(14, prod * 3) + (phase === "early" ? 2 : 4); break; }
      case 28: v += phase === "early" ? 7 : phase === "mid" ? 5 : 1; break;
      case 29: v += phase === "mid" ? 16 : phase === "early" ? 12 : 8; break;
      case 30: { const sl = 12 - buildingUsedSpaces(p); v += (phase === "early" ? 22 : phase === "mid" ? 12 : 2) * Math.min(1, sl / 3); break; }
      case 31: v += phase === "mid" ? 20 : phase === "early" ? 10 : 12; break;
      case 32: v += phase === "mid" ? 22 : phase === "early" ? 12 : 12; break;
      case 33: v += phase === "mid" ? 20 : phase === "early" ? 16 : 8; break;
      case 34: { let best = 0; for (const g of GOODS_) if (g !== "corn") best = Math.max(best, productionCapacity(p, g)); v += best * 7 + (phase === "early" ? 22 : phase === "mid" ? 14 : -2); break; }
      case 35: v += phase === "mid" ? 24 : phase === "early" ? 14 : 10; break;
    }
    // 大紫快照估值(早期低=鼓励晚买正确)；combo 在生产分支处理。与 game.js 同步(*5/28/14, PR#22)
    if (b.type === "large_violet") v += estLVSpecial(p, id) * 5 + (phase === "late" ? 28 : phase === "mid" ? 14 : 0);
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
    // 扩展：图书馆(33) 拓殖翻倍 — chooser 再从剩余明牌池拿 1 张种植园
    const sc = st.players[chooser];
    if (isManned(sc, 33) && sc.plantations.length < 12 && st.plantationPool.length > 0) {
      const opts = st.plantationPool.map((g, k) => ({ kind: "plant", good: g, idx: k }));
      const pi = pickPlantation(st, sc, opts, false);
      if (pi != null && opts[pi]) {
        const libPl = { good: opts[pi].good, manned: false };
        sc.plantations.push(libPl);
        st.plantationPool.splice(opts[pi].idx, 1);
        // 规则书：济贫院只对第一张地块给殖民者，图书馆的第二张地块不触发
      }
    }
    if (st.plantationPool.length > 0) { st.plantationDiscard = st.plantationDiscard.concat(st.plantationPool); st.plantationPool = []; }
  }

  function doMayor(st, chooser) {
    const ord = order(st, chooser);
    { const p = st.players[chooser]; let take = isManned(p, 33) ? 2 : 1; while (take-- > 0 && st.colonistsLeft > 0) { st.colonistsLeft--; p.unplaced = (p.unplaced || 0) + 1; } } // 图书馆翻倍
    let safety = 0;
    while (st.colonistsOnShip > 0 && safety++ < 200) {
      for (const i of ord) { if (st.colonistsOnShip <= 0) break; st.players[i].unplaced = (st.players[i].unplaced || 0) + 1; st.colonistsOnShip--; }
    }
    // 贵族扩展(标量近似)：每市长阶段 1 名贵族给选择者(既是工人也是终局VP)；别墅(43) 额外 +1
    if (st.expansionNobles) {
      const give = (pi) => { const p = st.players[pi]; p.unplaced = (p.unplaced || 0) + 1; p.nobleCount = (p.nobleCount || 0) + 1; };
      if (st.noblesLeft > 0) { st.noblesLeft--; give(chooser); }
      for (const i of ord) if (isManned(st.players[i], 43) && st.noblesLeft > 0) { st.noblesLeft--; give(i); }
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
        const cost = effectiveCostBonus(p, b, i === chooser, st.numPlayers);
        const bm = isManned(p, 25) ? Math.min(3, (GOODS_.some(g => p.goods[g] > 0) ? 1 : 0) + ((p.unplaced || 0) > 0 ? 1 : 0)) : 0; // 黑市(AI不舍VP)
        if (p.money + bm < cost) continue;
        opts.push({ b, cost });
      }
      if (opts.length === 0) continue;
      let bestI = -1, bestS = -Infinity;
      for (let k = 0; k < opts.length; k++) { let s = evalBuilding(st, p, opts[k].b, phase) - opts[k].cost * 3 + (i === chooser ? 5 : 0); if (s > bestS) { bestS = s; bestI = k; } }
      if (bestI < 0 || bestS <= 0) continue; // 没有正收益建筑就不建
      const { b, cost } = opts[bestI];
      if (cost > p.money && isManned(p, 25)) { // 扩展：黑市付费（还货+岸边工人抵差额，用尽余钱）
        let gap = cost - p.money;
        const g = GOODS_.slice().sort((a, bb) => PRICE[a] - PRICE[bb]).find(gg => p.goods[gg] > 0);
        if (gap > 0 && g) { p.goods[g]--; st.supply[g]++; gap--; }
        if (gap > 0 && (p.unplaced || 0) > 0) { p.unplaced--; st.colonistsLeft++; gap--; }
        p.money = 0;
      } else p.money -= cost;
      st.buildingStock[b.id]--; p.buildings.push({ bid: b.id, men: 0 });
      // 扩展：教堂(30) 按建造列得 VP（建教堂本身不得分）
      if (b.id !== 30 && isManned(p, 30)) { const tier = b.cost <= 3 ? 1 : b.cost <= 6 ? 2 : b.cost <= 9 ? 3 : 4; const cv = tier >= 4 ? 2 : tier >= 2 ? 1 : 0; if (cv > 0 && st.vpLeft > 0) { const got = Math.min(cv, st.vpLeft); p.vp += got; st.vpLeft -= got; } }
      if (isManned(p, 16)) { const nb = p.buildings[p.buildings.length - 1]; if (st.colonistsLeft > 0) { nb.men = Math.min(1, BLD[b.id].men); st.colonistsLeft--; } else if (st.colonistsOnShip > 0) { nb.men = Math.min(1, BLD[b.id].men); st.colonistsOnShip--; } }
    }
  }

  // 工匠自动生产 + 工厂奖励（不含 chooser 额外取货）。返回已生产货种集合。
  // 抽出为独立函数，供 doCraftsman 与因子化层共用，保证两路逻辑一致。
  function craftsmanProduce(st, chooser) {
    const produced = new Set();
    const perKinds = st.players.map(() => new Set());
    const perCount = st.players.map(() => ({ corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 }));
    for (const g of GOODS_) {
      for (const i of order(st, chooser)) {
        if (st.supply[g] <= 0) break;
        const p = st.players[i];
        let cap = productionCapacity(p, g), did = false;
        while (cap > 0 && st.supply[g] > 0) { p.goods[g]++; st.supply[g]--; cap--; produced.add(g); did = true; perCount[i][g]++; }
        if (did) perKinds[i].add(g);
      }
    }
    // 扩展：引水渠(24) 大靛蓝/糖厂 +1；专业工厂(34) 最多单货(非玉米)-1 得金
    for (let i = 0; i < st.players.length; i++) {
      const p = st.players[i];
      if (isManned(p, 24)) {
        const big3 = ownsBuilding(p, 3), big4 = ownsBuilding(p, 4); // 规则：大厂有人参与生产即可，不要求满员
        if (big3 && big3.men > 0 && perCount[i].indigo > 0 && st.supply.indigo > 0) { p.goods.indigo++; st.supply.indigo--; perCount[i].indigo++; perKinds[i].add("indigo"); }
        if (big4 && big4.men > 0 && perCount[i].sugar > 0 && st.supply.sugar > 0) { p.goods.sugar++; st.supply.sugar--; perCount[i].sugar++; perKinds[i].add("sugar"); }
      }
      if (isManned(p, 34)) {
        // 专业工厂：最多单货(非玉米) - 第二多；只有一种时全部计入
        const sfc = GOODS_.filter(g => g !== "corn").map(g => perCount[i][g]).sort((a, b) => b - a);
        const gain = Math.max(0, (sfc[0] || 0) - 1); // 规则书：最多单货(非玉米)产量 - 1
        if (gain > 0) p.money += gain;
      }
    }
    const fb = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 };
    for (let i = 0; i < st.players.length; i++) {
      const p = st.players[i];
      if (isManned(p, 15)) { const bonus = fb[perKinds[i].size] || 0; if (bonus > 0) p.money += bonus; }
      // 贵族扩展(标量)：珠宝匠(44) 每名贵族 +1金（强金币引擎）
      if (st.expansionNobles && isManned(p, 44)) p.money += (p.nobleCount || 0);
    }
    return perKinds[chooser]; // 规则：工匠特权只能拿"自己本回合产出"的种类
  }
  function doCraftsman(st, chooser) {
    // 扩展：招待所(28) — 工匠前把客工(gh.men)部署到能立刻提升生产的空位
    for (const p of st.players) {
      const gh = ownsBuilding(p, 28); if (!gh || gh.men <= 0) continue;
      const ref = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] };
      const fc = g => (ref[g] || []).reduce((s, fb) => { const bb = ownsBuilding(p, fb); return s + (bb ? bb.men : 0); }, 0);
      const mp = g => p.plantations.filter(x => x.good === g && x.manned).length;
      let guard = 0;
      while (gh.men > 0 && guard++ < 12) {
        let placed = false;
        for (const bid of [3, 4, 5, 6, 1, 2]) { const b = ownsBuilding(p, bid); if (!b) continue; const bd = BLD[bid]; if (b.men >= bd.men) continue; if (mp(bd.good) > fc(bd.good)) { b.men++; gh.men--; placed = true; break; } }
        if (placed) continue;
        for (const pl of p.plantations) { if (pl.manned || pl.good === "quarry" || pl.good === "forest") continue; if (pl.good === "corn" || fc(pl.good) > mp(pl.good)) { pl.manned = true; gh.men--; placed = true; break; } }
        if (!placed) break;
      }
    }
    const produced = craftsmanProduce(st, chooser);
    const ch = st.players[chooser];
    const avail = GOODS_.filter(g => st.supply[g] > 0 && produced.has(g));
    if (avail.length > 0) {
      const g = avail.reduce((a, b) => PRICE[a] >= PRICE[b] ? a : b); ch.goods[g]++; st.supply[g]--;
      if (isManned(ch, 33)) { const a2 = GOODS_.filter(x => produced.has(x) && st.supply[x] > 0); if (a2.length) { const g2 = a2.reduce((a, b) => PRICE[a] >= PRICE[b] ? a : b); ch.goods[g2]++; st.supply[g2]--; } } // 图书馆：再拿1个(可同种)
    }
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
      let earn = PRICE[g]; if (i === chooser) earn += isManned(p, 33) ? 2 : 1; if (isManned(p, 7)) earn += 1; if (isManned(p, 13)) earn += 2; // 图书馆翻倍
      p.money += earn;
    }
    if (st.tradingHouse.length >= 4) { for (const g of st.tradingHouse) st.supply[g]++; st.tradingHouse = []; }
  }

  function rankCaptain(cands, ships, phase) {
    const score = (c) => {
      if (c.ship === "wharf" || c.ship === "smallwharf") return -1; // 私人船(码头/小码头)优先级最低(先用货船吃 VP)
      const s = ships[c.ship]; const rem = s.capacity - s.count;
      let v = (s.good === c.good ? 1000 : 0) + rem * 10 + (c.amount || 0);
      if (phase && phase !== "late") v += (4 - PRICE[c.good]) * 60; // 早/中期弃廉价货、留咖啡/烟草
      return v;
    };
    return cands.slice().sort((a, b) => score(b) - score(a));
  }
  // 某玩家本轮可装船的候选 {ship(0..2 或 "wharf"), good, amount}。抽出供 doCaptain 与因子化层共用。
  function captainCands(st, p) {
    const cands = [];
    for (let s = 0; s < st.ships.length; s++) {
      const ship = st.ships[s]; if (ship.count >= ship.capacity) continue;
      if (ship.good === null) {
        for (const g of GOODS_) { if (p.goods[g] <= 0) continue; if (st.ships.some((sh, idx) => idx !== s && sh.good === g)) continue; cands.push({ ship: s, good: g, amount: Math.min(p.goods[g], ship.capacity - ship.count) }); }
      } else if (p.goods[ship.good] > 0) cands.push({ ship: s, good: ship.good, amount: Math.min(p.goods[ship.good], ship.capacity - ship.count) });
    }
    // 规则：选定一种货后必须装"尽可能多" — 同种货有多艘可选船时只能选装载量最大的
    const maxByGood = {};
    for (const c of cands) maxByGood[c.good] = Math.max(maxByGood[c.good] || 0, c.amount);
    const legal = cands.filter(c => c.amount === maxByGood[c.good]);
    // 码头：私人船，容量 11，不受上述约束
    if (isManned(p, 18) && !p.wharfUsed) for (const g of GOODS_) if (p.goods[g] > 0) legal.push({ ship: "wharf", good: g, amount: Math.min(p.goods[g], 11) });
    // 扩展：小码头(31) — 自有船，可装任意货，每 2 货 = 1VP
    if (isManned(p, 31) && !p.smallWharfUsed) for (const g of GOODS_) if (p.goods[g] > 0) legal.push({ ship: "smallwharf", good: g, amount: p.goods[g] });
    return legal;
  }
  // 装船一次（修改 st，给 i 加 shippingVP），返回 loaded
  function captainLoad(st, i, chooser, bonusUsed, pick) {
    const p = st.players[i];
    let loaded;
    const isSmallWharf = pick.ship === "smallwharf";
    if (pick.ship === "wharf" || isSmallWharf) {
      p.goods[pick.good] -= pick.amount; loaded = pick.amount;
      if (pick.ship === "wharf") p.wharfUsed = true; else p.smallWharfUsed = true;
      st.supply[pick.good] += pick.amount;
    } else {
      const ship = st.ships[pick.ship]; if (ship.good === null) ship.good = pick.good;
      loaded = Math.min(pick.amount, ship.capacity - ship.count); ship.count += loaded; p.goods[pick.good] -= loaded;
    }
    // 小码头：每 2 货 = 1VP
    let vp = isSmallWharf ? Math.floor(loaded / 2) : loaded;
    if (i === chooser && !bonusUsed.has(i) && loaded > 0) { vp += isManned(p, 33) ? 2 : 1; bonusUsed.add(i); } // 图书馆翻倍；选择者奖励仅在实际装货时
    if (isManned(p, 17)) vp += 1;
    // 扩展：灯塔装货船 +1金（船长特权在 doCaptain 开始时已给）
    if (isManned(p, 32)) p.money += 1; // 灯塔：与港口同理，每次装运（含码头/小码头）+1金
    const g = Math.min(vp, st.vpLeft); p.vp += g; p.shippingVP += g; st.vpLeft -= g;
    return loaded;
  }
  // 装船阶段末：满船清空 + 各玩家留货(storageKinds 满 + 1)。抽出供两路共用。
  function captainCleanupKeep(st) {
    for (const ship of st.ships) if (ship.count >= ship.capacity) { st.supply[ship.good] += ship.count; ship.good = null; ship.count = 0; }
    for (const p of st.players) {
      const total = GOODS_.reduce((s, g) => s + p.goods[g], 0);
      if (total > 0) {
        const kinds = storageKinds(p);
        const sorted = GOODS_.filter(g => p.goods[g] > 0).sort((a, b) => PRICE[b] - PRICE[a]);
        const keep = {}; const full = sorted.slice(0, kinds);
        for (const g of full) keep[g] = p.goods[g];
        let singleSlots = 1 + (isManned(p, 27) ? 3 : 0); // 扩展：储藏库 +3 单货槽
        for (const g of sorted) { if (singleSlots <= 0) break; if (full.includes(g)) continue; const take = Math.min(p.goods[g], singleSlots); keep[g] = (keep[g] || 0) + take; singleSlots -= take; }
        for (const g of GOODS_) { const disc = p.goods[g] - (keep[g] || 0); if (disc > 0) st.supply[g] += disc; p.goods[g] = keep[g] || 0; }
      }
      p.wharfUsed = false;
      p.smallWharfUsed = false;
    }
  }
  function doCaptain(st, chooser) {
    const phase = phaseOf(st);
    const ord = order(st, chooser);
    const bonusUsed = new Set();
    // 扩展：工会大厅(35) 装船前，手上每 2 个同货 +1 VP
    for (const i of ord) { const p = st.players[i]; if (!isManned(p, 35)) continue; let uh = 0; for (const g of GOODS_) uh += Math.floor(p.goods[g] / 2); if (uh > 0 && st.vpLeft > 0) { const got = Math.min(uh, st.vpLeft); p.vp += got; st.vpLeft -= got; } }
    // 扩展：灯塔(32) — 船长 chooser 不论是否装货都 +1 金
    if (isManned(st.players[chooser], 32)) st.players[chooser].money += 1;
    let progress = true;
    while (progress) {
      progress = false;
      for (const i of ord) {
        const cands = captainCands(st, st.players[i]);
        if (cands.length === 0) continue;
        captainLoad(st, i, chooser, bonusUsed, rankCaptain(cands, st.ships, phase)[0]);
        progress = true;
      }
    }
    captainCleanupKeep(st);
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
      case "Prospector": st.players[chooser].money += isManned(st.players[chooser], 33) ? 2 : 1; break; // 图书馆翻倍
    }
    checkEnd(st);
    st.picksThisTurn++;
    // 本回合选满(或无牌可选) → 回合结束
    if (st.picksThisTurn >= picksPerRound(st.numPlayers) || legalRoleIdxs(st).length === 0) {
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

  // ---------- rollout 选角色：打分模型(基础价值 + 软性策略倾向；倾向是偏好非命令) ----------
  // 与 game.js 的 strategicRoleBias 同口径，让专家的 MCTS rollout 更贴近强手。
  function heuristicPickRole(st, chooser, legal) {
    const p = st.players[chooser];
    const phase = phaseOf(st);
    const goods = GOODS_.reduce((a, g) => a + p.goods[g], 0);
    let cap = 0; for (const s of st.ships) cap += (s.capacity - s.count);
    let myOpen = 0; for (const pl of p.plantations) if (!pl.manned) myOpen++; for (const b of p.buildings) myOpen += (BLD[b.bid].men - b.men);
    let myProd = 0; for (const g of GOODS_) myProd += productionCapacity(p, g);
    const mannedCorn = p.plantations.filter(pl => pl.good === "corn" && pl.manned).length;
    const downstream = st.players[(chooser + 1) % st.numPlayers];
    const office = isManned(p, 12);
    // 对手聚合量(每次调用算一次)
    const myScore = finalScore(p);
    let oppMaxProd = 0, oppOpenMax = 0, oppGoodsMax = 0, lead = 0, oppMature = false;
    for (const o of st.players) {
      if (o === p) continue;
      let pr = 0; for (const g of GOODS_) pr += productionCapacity(o, g);
      if (pr > oppMaxProd) oppMaxProd = pr;
      let op = 0; for (const b of o.buildings) op += (BLD[b.bid].men - b.men); for (const pl of o.plantations) if (!pl.manned) op++;
      if (op > oppOpenMax) oppOpenMax = op;
      const og = GOODS_.reduce((a, g) => a + o.goods[g], 0); if (og > oppGoodsMax) oppGoodsMax = og;
      const sc = finalScore(o); if (sc > lead) lead = sc;
      if (pr >= 5 && o.buildings.length >= 5) oppMature = true;
    }
    const behind = myScore < lead - 3;
    const canRushBuild = () => {
      const spaceLeft = 12 - buildingUsedSpaces(p);
      for (const b of BUILDINGS_) {
        if (st.buildingStock[b.id] <= 0 || ownsBuilding(p, b.id) || spaceLeft < b.size) continue;
        if (p.money >= Math.max(0, b.cost - 1) && (b.type === "large_violet" || (phase === "late" && spaceLeft <= 4))) return true;
      }
      return false;
    };

    let bestI = legal[0], bestS = -Infinity;
    for (const i of legal) {
      const card = st.roleCards[i];
      let s = card.money * (phase === "early" ? 1.0 : 0.5); // 卡上奖金(早期更重)
      switch (card.name) {
        case "Captain":
          s += Math.min(goods, cap) * 1.3;                  // 基础:能运多少
          if (mannedCorn >= 2 && goods >= 3 && cap > 0) s += 6;
          if (oppGoodsMax >= 4 && goods >= 2) s += 4;
          break;
        case "Mayor":
          s += Math.min(myOpen, Math.ceil(st.colonistsOnShip / st.numPlayers) + 1) * 2.2; // 基础:能填岗
          if (oppOpenMax >= 3 && oppOpenMax > myOpen) s -= 6;
          if (myOpen >= 3 && st.colonistsOnShip >= 1) s += 4;
          if (phase !== "early") for (const b of p.buildings) if (BLD[b.bid].type === "large_violet" && b.men < BLD[b.bid].men) { s += 8; break; }
          break;
        case "Builder":
          if (p.money >= 5) s += 4.5;                       // 基础:有钱可建
          if ((behind || oppMature || phase === "late") && canRushBuild()) s += 8;
          break;
        case "Craftsman":
          s += myProd * 1.6;                                // 基础:产能
          if (myProd < oppMaxProd) s -= 6;
          if (phase === "late" && myProd < 3) s -= 6;
          break;
        case "Trader":
          if (st.tradingHouse.length < 4) {
            let bestSell = 0;
            for (const g of GOODS_) if (p.goods[g] > 0 && (office || !st.tradingHouse.includes(g))) bestSell = Math.max(bestSell, PRICE[g] + 1 + (isManned(p, 7) ? 1 : 0) + (isManned(p, 13) ? 2 : 0));
            s += bestSell * 1.2;                            // 基础:能卖多少
            for (const g of ["coffee", "tobacco"]) if (p.goods[g] > 0 && downstream.goods[g] > 0 && (office || !st.tradingHouse.includes(g))) { s += 5; break; }
            if (phase === "late" && !(p.money < 10 && p.money + bestSell >= 10)) s -= 9; // 终盘禁区
          } else s -= 5;
          break;
        case "Settler":
          s += p.plantations.length < 4 ? 3 : 1;            // 基础:缺田
          if (phase === "late") s -= 9;                     // 终盘禁区
          break;
        case "Prospector":
          s += 1.5;
          break;
      }
      if (s > bestS) { bestS = s; bestI = i; }
    }
    return bestI;
  }

  function rolloutToEnd(st, rnd) {
    let guard = 0;
    const eps = (root._mctsEps != null) ? root._mctsEps : 0.05; // rollout 随机率（低=更贴近强手）
    while (!isTerminal(st) && guard++ < 400) {
      const ch = currentChooser(st);
      if (ch < 0) break;
      const legal = legalRoleIdxs(st);
      if (legal.length === 0) break;
      // ε-greedy：大多用启发式，小概率随机增加探索多样性
      let ri;
      if ((rnd ? rnd() : Math.random()) < eps) ri = legal[Math.floor((rnd ? rnd() : Math.random()) * legal.length)];
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

  // ---------- 手写"经济评估"：一个面板的前瞻性经济价值（供 MCTS 叶节点评估，给困难档统筹全局）----------
  // 不止看已实现 VP，还看"未来变现潜力"：收入引擎(产能×货价)=未来每回合的钱/分、
  // 手上货=可立即卖钱/运分、钱=未来买建筑的潜力。MCTS 的截断 rollout 提供"未来若干回合"的前瞻，
  // 本函数给"走到那一步后的经济局面"打分 → 合起来即"这一手在未来 N 回合的收益最大化"。
  function econEval(st, seat) {
    const me = st.players[seat];
    const phase = phaseOf(st);
    let v = finalScore(me); // 已实现 VP（含建筑分+大紫终局特殊分）
    let income = 0, goodsVal = 0;
    for (const g of GOODS_) {
      income += productionCapacity(me, g) * (1 + PRICE[g]); // 收入引擎：玉米1 靛2 糖3 烟4 咖5
      goodsVal += me.goods[g] * (1 + PRICE[g]);             // 手上货的变现价值
    }
    // 阶段权重：早/中期看重收入引擎与钱(为未来买建筑/运货铺路)；终盘已没时间发酵，看重已实现分
    const wIncome = phase === "late" ? 0.25 : 0.8;
    const wMoney = phase === "late" ? 0.15 : 0.4;
    v += income * wIncome + me.money * wMoney + goodsVal * 0.35;
    return v;
  }
  // 经济叶评估的奖励：我的经济价值 − 最强对手的经济价值，归一化到 [-1,1]
  function econReward(st, perspective) {
    const my = econEval(st, perspective);
    let bestOpp = -Infinity;
    for (let i = 0; i < st.numPlayers; i++) if (i !== perspective) { const e = econEval(st, i); if (e > bestOpp) bestOpp = e; }
    if (!isFinite(bestOpp)) bestOpp = 0;
    return Math.max(-1, Math.min(1, (my - bestOpp) / 30));
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
    const C = opts.C || (root._mctsC != null ? root._mctsC : 1.0); // 探索常数(低=更重利用，rollout 已较强)
    const valueW = opts.valueW || null;        // 价值函数权重（给定则用价值制导）
    const truncate = opts.truncate != null ? opts.truncate : 6; // 截断 rollout 步数
    // L6/AlphaZero hooks（向后兼容；不传则同 L5 行为）：
    //   evalLeafFn(st, perspectiveSeat) -> number in [-1, 1]
    //     有则替代 evalLeaf 的截断 rollout，直接用 NN 估值
    //   priorPolicyFn(st, perspectiveSeat) -> { [roleName]: prob }
    //     有则在每个节点用 PUCT 而非 UCT：score = Q/N + C * P * sqrt(N_parent) / (1 + N_child)
    //   evalLeafVecFn(st) -> (persp => value) | null
    //     向量版叶评估: 一次调用给出全部视角的价值(整条回传路径共享一次 NN 前向)。
    //     返回 null 时回退 evalLeafFn(如 5 人局)。
    const evalLeafFn = opts.evalLeafFn || null;
    const evalLeafVecFn = opts.evalLeafVecFn || null;
    const priorPolicyFn = opts.priorPolicyFn || null;
    if (currentChooser(rootState) < 0) return -1;
    const rootLegal = legalRoleIdxs(rootState);
    if (rootLegal.length <= 1) return rootLegal[0];

    // 信息集树：节点 children keyed by 角色名（角色卡公开 → 各确定化下动作集一致）。
    const treeRoot = { N: 0, Q: 0, children: new Map(), P: null };
    const t0 = Date.now();
    let iters = 0;
    while (iters < maxIters) {
      if ((iters & 15) === 0 && Date.now() - t0 >= budgetMs) break;
      iters++;
      const st = determinize(rootState);
      const visited = []; // {child, chooser}
      let node = treeRoot;
      while (!isTerminal(st)) {
        const ch = currentChooser(st);
        if (ch < 0) break;
        const legal = legalRoleIdxs(st);
        if (legal.length === 0) break;
        for (const i of legal) { const nm = st.roleCards[i].name; if (!node.children.has(nm)) node.children.set(nm, { N: 0, Q: 0, children: new Map(), P: null }); }
        // 先验 P（PUCT）：每个节点在第一次访问时计算一次先验，缓存到 node.P[roleName]
        if (priorPolicyFn && !node.P) {
          try { node.P = priorPolicyFn(st, ch) || {}; } catch (e) { node.P = {}; }
        }
        // UCT / PUCT
        let chosen = null, bestV = -Infinity;
        for (const i of legal) {
          const nm = st.roleCards[i].name, c = node.children.get(nm);
          let v;
          if (priorPolicyFn) {
            // PUCT: Q + C * P * sqrt(N_parent) / (1 + N_child)；未访问也用先验排序
            const Pn = (node.P && node.P[nm] != null) ? node.P[nm] : (1 / legal.length);
            const q = c.N === 0 ? 0 : c.Q / c.N;
            v = q + C * Pn * Math.sqrt(node.N + 1) / (1 + c.N);
          } else {
            v = c.N === 0 ? Infinity : c.Q / c.N + C * Math.sqrt(Math.log(node.N + 1) / c.N);
          }
          if (v > bestV) { bestV = v; chosen = nm; }
        }
        const ri = legal.find(i => st.roleCards[i].name === chosen);
        const child = node.children.get(chosen);
        const wasUnvisited = child.N === 0;
        visited.push({ child, chooser: ch });
        applyRole(st, ri);
        node = child;
        if (wasUnvisited) break; // 扩展一个新节点后转 rollout / NN eval
      }
      let leafEval;
      if (evalLeafFn || evalLeafVecFn) {
        // Hybrid 叶评估：先用启发式 rollout 走 truncate 步（这能让 NN 摆脱
        // "训练时见过的偏见状态"），再在新状态上调用 NN value。原本纯 NN
        // 评估会被 NN 的策略偏差锚定（NN 训于 L5/PUCT-导向数据，会偏向
        // 这些动作），引入 truncate 步是把状态稍微推到 NN 训练分布之外，
        // 再让 NN 给出 value 评估。等价于 evalLeaf 把线性 value 换成 NN。
        let steps = 0;
        while (!isTerminal(st) && steps++ < truncate) {
          const ch = currentChooser(st); if (ch < 0) break;
          const legal = legalRoleIdxs(st); if (!legal.length) break;
          applyRole(st, heuristicPickRole(st, ch, legal));
        }
        if (isTerminal(st)) {
          leafEval = (persp) => reward(st, persp);
        } else {
          let vecEval = null;
          if (evalLeafVecFn) { try { vecEval = evalLeafVecFn(st); } catch (e) { vecEval = null; } }
          if (vecEval) {
            leafEval = vecEval; // 已含 clamp/容错
          } else if (evalLeafFn) {
            leafEval = (persp) => {
              try {
                const v = evalLeafFn(st, persp);
                if (typeof v !== "number" || !isFinite(v)) return 0;
                return Math.max(-1, Math.min(1, v));
              } catch (e) { return 0; }
            };
          } else {
            leafEval = evalLeaf(st, valueW, truncate, rootState.rnd);
          }
        }
      } else {
        leafEval = evalLeaf(st, valueW, truncate, rootState.rnd);
      }
      treeRoot.N++;
      for (const v of visited) { v.child.N++; v.child.Q += leafEval(v.chooser); }
    }
    // 选访问最多的根动作（最稳健）
    let bestName = null, bestN = -1;
    for (const [nm, c] of treeRoot.children) if (c.N > bestN) { bestN = c.N; bestName = nm; }
    const ri = rootLegal.find(i => rootState.roleCards[i].name === bestName);
    return ri != null ? ri : rootLegal[0];
  }

  // ============================================================
  // 因子化决策层 (AlphaZero) — additive，不改 applyRole/do*。
  // 把"一回合内的链式子决策"逐个暴露为决策点，供 Gumbel-AlphaZero 搜索/训练。
  // 设计：st.az 游标记录当前所处 factored 阶段及进度；未 factored 的阶段
  //   回退到现成启发式 do*（保证始终能打完整局，可逐阶段 factored 化 + 验证）。
  // 当前已 factored：role（选角色）、builder（建造）。其余阶段走 do* 回退。
  // 决策表示：{ type, chooser, actions:[int...] }；动作 id 含义随 type：
  //   role  → roleIdx (legalRoleIdxs)
  //   build → bid (1..23) 或 -1=pass
  // ============================================================
  const AZ_PASS = -1;
  const AZ_QUARRY = -2; // settler 选采石场的动作 id

  function azEnsure(st) { if (!st.az) st.az = { phase: "role" }; return st.az; }

  // settler 选项：当前玩家可拿的"货种"(GOODS_ 索引去重) + 是否可拿采石场
  function azSettlerOptions(st, i) {
    const p = st.players[i];
    if (p.plantations.length >= 12) return { goods: [], quarry: false };
    const goods = [];
    for (let k = 0; k < GOODS_.length; k++) if (st.plantationPool.includes(GOODS_[k])) goods.push(k);
    const hut = isManned(p, 9);
    const quarry = st.quarriesLeft > 0 && (i === st.az.chooser || hut);
    return { goods, quarry };
  }
  function azSettlerHasDecision(st, i) { const o = azSettlerOptions(st, i); return o.goods.length > 0 || o.quarry; }
  function azSettlerSkipToDecision(st) {
    const az = st.az;
    while (az.oi < az.ord.length) { if (azSettlerHasDecision(st, az.ord[az.oi])) return true; az.oi++; }
    // 全部处理完 → 弃掉剩余明牌种植园(与 doSettler 末段一致)
    if (st.plantationPool.length > 0) { st.plantationDiscard = st.plantationDiscard.concat(st.plantationPool); st.plantationPool = []; }
    return false;
  }

  // 列出某玩家在建造阶段的可建选项（与 doBuilder 同口径）
  function azBuildOptions(st, i) {
    const p = st.players[i];
    if (buildingUsedSpaces(p) >= 12) return [];
    const opts = [];
    for (const b of BUILDINGS_) {
      if (st.buildingStock[b.id] <= 0) continue;
      if (ownsBuilding(p, b.id)) continue;
      if (12 - buildingUsedSpaces(p) < b.size) continue;
      const cost = effectiveCostBonus(p, b, i === st.az.chooser, st.numPlayers);
      if (p.money < cost) continue;
      opts.push(b.id);
    }
    return opts;
  }

  // 推进 builder 游标到"下一个有可建选项的玩家"，没有则结束建造阶段
  function azBuilderSkipToDecision(st) {
    const az = st.az;
    while (az.oi < az.ord.length) {
      const i = az.ord[az.oi];
      if (azBuildOptions(st, i).length > 0) return true; // 该玩家有决策
      az.oi++; // 无可建 → 跳过
    }
    return false; // 全部处理完
  }

  // trader：当前玩家可卖货种(GOODS_ 索引；office 可卖与贸易站重复的)
  function azTraderSellable(st, i) {
    const p = st.players[i]; const office = isManned(p, 12);
    const out = [];
    for (let k = 0; k < GOODS_.length; k++) { const g = GOODS_[k]; if (p.goods[g] > 0 && (office || !st.tradingHouse.includes(g))) out.push(k); }
    return out;
  }
  function azTraderSkipToDecision(st) {
    const az = st.az;
    while (az.oi < az.ord.length) {
      if (st.tradingHouse.length >= 4) return false; // 贸易站满 → 停(同 doTrader 的 break)
      if (azTraderSellable(st, az.ord[az.oi]).length > 0) return true;
      az.oi++;
    }
    return false;
  }
  function azTraderEnd(st) { if (st.tradingHouse.length >= 4) { for (const g of st.tradingHouse) st.supply[g]++; st.tradingHouse = []; } }

  // captain：把候选编码为动作 int = shipSlot*10 + goodIdx（shipSlot 0..2=船, 3=码头wharf）
  function azCaptainEncode(c) { return (c.ship === "wharf" ? 3 : c.ship) * 10 + GOODS_.indexOf(c.good); }
  // 推进到下一个可装船的玩家；整轮无人可装 → 返回 false(装船结束)。轮次用 az.progressed 标记(同 doCaptain 的 while progress)。
  function azCaptainSkipToDecision(st) {
    const az = st.az; let guard = 0;
    while (guard++ < 2000) {
      if (az.oi >= az.ord.length) {
        if (az.progressed) { az.oi = 0; az.progressed = false; continue; } // 新一轮
        return false; // 整轮无装 → 结束
      }
      if (captainCands(st, st.players[az.ord[az.oi]]).length > 0) return true;
      az.oi++;
    }
    return false;
  }

  // 角色阶段收尾（与 applyRole 末段同逻辑）：picksThisTurn++ + 回合/终局推进
  function azFinishRole(st) {
    checkEnd(st);
    st.picksThisTurn++;
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
    st.az.phase = "role";
  }

  // 当前决策点（null = 终局）
  function azDecision(st) {
    azEnsure(st);
    if (isTerminal(st)) return null;
    const az = st.az;
    if (az.phase === "builder") {
      if (!azBuilderSkipToDecision(st)) { azFinishRole(st); return azDecision(st); }
      const i = az.ord[az.oi];
      const actions = azBuildOptions(st, i).concat([AZ_PASS]);
      return { type: "build", chooser: i, actions };
    }
    if (az.phase === "settler") {
      if (!azSettlerSkipToDecision(st)) { azFinishRole(st); return azDecision(st); }
      const i = az.ord[az.oi];
      const o = azSettlerOptions(st, i);
      const actions = o.goods.slice(); if (o.quarry) actions.push(AZ_QUARRY);
      return { type: "settle", chooser: i, actions };
    }
    if (az.phase === "trader") {
      if (!azTraderSkipToDecision(st)) { azTraderEnd(st); azFinishRole(st); return azDecision(st); }
      const i = az.ord[az.oi];
      const actions = azTraderSellable(st, i).concat([AZ_PASS]);
      return { type: "trade", chooser: i, actions };
    }
    if (az.phase === "craftbonus") {
      const avail = [];
      for (let k = 0; k < GOODS_.length; k++) if (st.supply[GOODS_[k]] > 0 && az.produced.indexOf(GOODS_[k]) >= 0) avail.push(k);
      if (avail.length === 0) { azFinishRole(st); return azDecision(st); }
      return { type: "craftbonus", chooser: az.chooser, actions: avail };
    }
    if (az.phase === "captain") {
      if (!azCaptainSkipToDecision(st)) { captainCleanupKeep(st); azFinishRole(st); return azDecision(st); }
      const i = az.ord[az.oi];
      const actions = captainCands(st, st.players[i]).map(azCaptainEncode);
      return { type: "captain", chooser: i, actions };
    }
    // 默认：角色决策
    const ch = currentChooser(st);
    if (ch < 0) return null;
    const legal = legalRoleIdxs(st);
    if (legal.length === 0) return null;
    return { type: "role", chooser: ch, actions: legal.slice() };
  }

  // 应用一个决策动作，推进到下一个决策点
  function azApply(st, action) {
    azEnsure(st);
    const az = st.az;
    if (az.phase === "builder") {
      const i = az.ord[az.oi];
      const p = st.players[i];
      if (action !== AZ_PASS) {
        const b = BLD[action];
        const cost = effectiveCostBonus(p, b, i === az.chooser, st.numPlayers);
        p.money -= cost; st.buildingStock[b.id]--; p.buildings.push({ bid: b.id, men: 0 });
        if (isManned(p, 16)) { const nb = p.buildings[p.buildings.length - 1]; if (st.colonistsLeft > 0) { nb.men = Math.min(1, BLD[b.id].men); st.colonistsLeft--; } else if (st.colonistsOnShip > 0) { nb.men = Math.min(1, BLD[b.id].men); st.colonistsOnShip--; } }
      }
      az.oi++; // 该玩家决策完，下一个
      return st;
    }
    if (az.phase === "settler") {
      const i = az.ord[az.oi];
      const p = st.players[i];
      let pl;
      if (action === AZ_QUARRY) { st.quarriesLeft--; pl = { good: "quarry", manned: false }; }
      else { const good = GOODS_[action]; const idx = st.plantationPool.indexOf(good); pl = { good, manned: false }; st.plantationPool.splice(idx, 1); }
      p.plantations.push(pl);
      if (isManned(p, 8) && p.plantations.length < 12 && st.plantationDeck.length > 0) p.plantations.push({ good: st.plantationDeck.pop(), manned: false }); // Hacienda
      if (isManned(p, 11)) { if (st.colonistsLeft > 0) { pl.manned = true; st.colonistsLeft--; } else if (st.colonistsOnShip > 0) { pl.manned = true; st.colonistsOnShip--; } } // Hospice
      az.oi++;
      return st;
    }
    if (az.phase === "trader") {
      const i = az.ord[az.oi], p = st.players[i];
      if (action !== AZ_PASS) {
        const g = GOODS_[action];
        p.goods[g]--; st.tradingHouse.push(g);
        let earn = PRICE[g]; if (i === az.chooser) earn += 1; if (isManned(p, 7)) earn += 1; if (isManned(p, 13)) earn += 2;
        p.money += earn;
      }
      az.oi++;
      return st;
    }
    if (az.phase === "craftbonus") {
      if (action !== AZ_PASS && action >= 0) { const g = GOODS_[action]; st.players[az.chooser].goods[g]++; st.supply[g]--; }
      azFinishRole(st);
      return st;
    }
    if (az.phase === "captain") {
      const i = az.ord[az.oi], p = st.players[i];
      const shipSlot = Math.floor(action / 10), gi = action % 10, g = GOODS_[gi];
      let pick;
      if (shipSlot === 3) pick = { ship: "wharf", good: g, amount: Math.min(p.goods[g], 11) };
      else { const ship = st.ships[shipSlot]; pick = { ship: shipSlot, good: g, amount: Math.min(p.goods[g], ship.capacity - ship.count) }; }
      const bset = new Set(); if (az.chooserBonusUsed) bset.add(az.chooser);
      captainLoad(st, i, az.chooser, bset, pick);
      az.chooserBonusUsed = bset.has(az.chooser);
      az.progressed = true; az.oi++;
      return st;
    }
    // 角色决策
    const chooser = currentChooser(st);
    const card = st.roleCards[action];
    card.taken = true; card.takenBy = chooser;
    st.players[chooser].money += card.money; card.money = 0;
    if (card.name === "Builder") { az.phase = "builder"; az.chooser = chooser; az.ord = order(st, chooser); az.oi = 0; return st; }
    if (card.name === "Settler") { az.phase = "settler"; az.chooser = chooser; az.ord = order(st, chooser); az.oi = 0; return st; }
    if (card.name === "Trader") { az.phase = "trader"; az.chooser = chooser; az.ord = order(st, chooser); az.oi = 0; return st; }
    if (card.name === "Craftsman") { const produced = craftsmanProduce(st, chooser); az.phase = "craftbonus"; az.chooser = chooser; az.produced = [...produced]; return st; }
    if (card.name === "Captain") { az.phase = "captain"; az.chooser = chooser; az.ord = order(st, chooser); az.oi = 0; az.progressed = false; az.chooserBonusUsed = false; az.cphase = phaseOf(st); return st; }
    // 其余阶段：回退到启发式 do*（Mayor 派工保留贪心）
    switch (card.name) {
      case "Mayor": doMayor(st, chooser); break;
      case "Prospector": st.players[chooser].money += isManned(st.players[chooser], 33) ? 2 : 1; break; // 图书馆翻倍
    }
    azFinishRole(st);
    return st;
  }

  // 启发式驱动 azDecision/azApply（用于验证：应与 applyRole 路径产出一致）
  function azHeuristicAction(st, dec) {
    // 离开 builder 阶段即清掉 phase 缓存——直接调用(selfplay_az/eval_az)时也安全,
    // 不再依赖 azPlayHeuristic 外部清理(否则中后期 builder 复用过期 phase, 选错建筑)。
    if (dec.type !== "build") st.az._bphase = null;
    if (dec.type === "role") return heuristicPickRole(st, dec.chooser, dec.actions);
    if (dec.type === "settle") {
      // 重建 doSettler 的 opts 并用 pickPlantation 选择，映射回 good 索引 / 采石场
      const i = dec.chooser, p = st.players[i];
      const opts = [];
      for (let k = 0; k < st.plantationPool.length; k++) opts.push({ kind: "plant", good: st.plantationPool[k], idx: k });
      const hut = isManned(p, 9);
      if (st.quarriesLeft > 0 && (i === st.az.chooser || hut)) opts.push({ kind: "quarry" });
      const pick = opts[pickPlantation(st, p, opts, i === st.az.chooser)];
      return pick.kind === "quarry" ? AZ_QUARRY : GOODS_.indexOf(pick.good);
    }
    if (dec.type === "trade") {
      // doTrader: 卖最高价可卖货，从不 pass；并列时取 GOODS_ 在前者
      const sell = dec.actions.filter(a => a !== AZ_PASS);
      if (sell.length === 0) return AZ_PASS;
      return sell.reduce((a, b) => PRICE[GOODS_[a]] >= PRICE[GOODS_[b]] ? a : b);
    }
    if (dec.type === "craftbonus") {
      // doCraftsman: chooser 取最高价 available
      return dec.actions.reduce((a, b) => PRICE[GOODS_[a]] >= PRICE[GOODS_[b]] ? a : b);
    }
    if (dec.type === "captain") {
      // doCaptain: rankCaptain 选最优装船(阶段 phase 在 captain 开始时固定为 az.cphase)
      const cands = captainCands(st, st.players[dec.chooser]);
      return azCaptainEncode(rankCaptain(cands, st.ships, st.az.cphase)[0]);
    }
    if (dec.type === "build") {
      // 与 doBuilder 同口径选择：评分最高且 >0 才建，否则 pass
      const i = dec.chooser, p = st.players[i];
      const phase = st.az._bphase || (st.az._bphase = phaseOf(st)); // builder 阶段内 phase 固定
      let best = AZ_PASS, bestS = 0; // 阈值同 doBuilder：bestS<=0 → pass
      for (const a of dec.actions) {
        if (a === AZ_PASS) continue;
        const b = BLD[a];
        const cost = effectiveCostBonus(p, b, i === st.az.chooser, st.numPlayers);
        const s = evalBuilding(st, p, b, phase) - cost * 3 + (i === st.az.chooser ? 5 : 0);
        if (s > bestS) { bestS = s; best = a; }
      }
      return best;
    }
    return dec.actions[0];
  }
  function azPlayHeuristic(st) {
    let guard = 0;
    while (guard++ < 5000) {
      const dec = azDecision(st);
      if (!dec) break;
      azApply(st, azHeuristicAction(st, dec)); // _bphase 现由 azHeuristicAction 自清
    }
    return st;
  }

  const API = {
    newState, clone, applyRole, legalRoleIdxs, currentChooser, isTerminal,
    finalScore, specialVPs, rolloutToEnd, heuristicPickRole, reward, econEval, econReward,
    ismctsPickRoleIdx, phaseOf, totalColonists, productionCapacity,
    extractFeatures, evalValue, FEATURE_DIM,
    azDecision, azApply, azPlayHeuristic, azHeuristicAction, AZ_PASS, AZ_QUARRY,
    _internal: { doSettler, doMayor, doBuilder, doCraftsman, doTrader, doCaptain, reallocate, pickPlantation },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PRSim = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
