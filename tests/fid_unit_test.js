// tests/fid_unit_test.js — sim.js 保真模式 st._fid 的逐条单元对照（第三轮 Stage 4）
//
// 在同一个沙盒里加载 game.js + sim.js，**构造**局面（随机模糊 + 手工边界例），把同一个 G 同时喂给
// game.js 的真实 AI 函数与 sim.js 的 fid 版本，逐项比较：
//   ① evalBuilding(fid) ≡ evalBuildingValue            （含 _specBuyPen 投机买厂罚）
//   ② fidPickBuild ≡ aiPickBuilding                     （不因负分 PASS、大紫抢卡、攒钱抢大紫）
//   ③ pickPlantation(fid) ≡ aiPickPlantation            （采石场上限：非建筑流 早期 2 / 中后期 1）
//   ④ reallocate(p, fid) ≡ aiReallocate                 （CHAIN_DONE、兜底放置顺序）
//   ⑤ 装船：fid 下 az 每次现算阶段 ≡ rankCaptainForAI(gamePhase())
//   ⑥ 庄园：az 拓殖在决策**前**抽、对同一 oi 幂等（azDecision 反复调用只抽一次）、无选项也抽；
//      doSettler(fid) 与 az(fid) 两路逐位一致（factored parity）
//   ⑦ 扩展模块开启时 fid 全部失效（与标志关闭逐位相同）
//   ⑧ 标志搬运：clone 复制 _fid、关闭时不写字段；worker 传输（Object.assign + structuredClone）保留；
//      buildSimState 只在 window._l6Fid 且基础局时置位
//   ⑨ simStateAtSubDecision 新增的 settle / trade / craftbonus 重建：一致的选项集合放行，篡改或身份不符 → null
//   ⑩ 阶段镜像：fidPhase ≡ gamePhase()，1-5 人全扫（game.js 殖民者分母在 1/2 人局与 sim COL_TOTAL 不同）；
//      2 人局随机局面上 pickPlantation(fid) / fidPickBuild 同样 ≡ game.js（4 人对照对人数相关分歧是盲的）
//   ⑪ 重建的拓殖局面以 fid **关**续跑：庄园已抽（az.hac = oi）→ 一次选田只多 1 块田、牌堆不再动
//   ⑧ 另含：window._l6Heur 覆盖了 L6_HEUR_DEFAULTS 的键（且值不同）→ buildSimState 不置 _fid
// 非空洞：①–④ 同时统计 fid **关**时与 game.js 的分歧数，必须 >0（否则对照没有区分力）。
// 反向验证（手工，见 AI_STRENGTH §18 Stage 4 记录）：把 sim.js 采石场 fid 上限改回 2 → ③ 红；
//   去掉 fidPickBuild 的攒钱规则 → ② 红；去掉 FID_CHAIN_DONE → ④ 红；去掉 az.hac 幂等判断 → ⑥ 红；
//   FID_COL_TOTAL 改回 {1:29, 2:40} → ⑩ 红；azApply 拓殖去掉 az.hac !== az.oi → ⑪ 红；
//   l6FidAllowed 去掉 _l6Heur 检查 → ⑧ 红。
'use strict';
const { loadEngine } = require('../tools/_sandbox.js');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const M = {}; for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
let envRng = mulberry32(4242); M.random = () => envRng();
const { run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js'], beforeLoad: sb => { sb.Math = M; } });

const out = run(`(() => {
  const R = {};
  const S = PRSim, I = PRSim._internal;
  const rnd = (function (a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(20261201);
  const ri = (n) => Math.floor(rnd() * n);
  const PL = ["corn", "indigo", "sugar", "tobacco", "coffee", "quarry"];
  const BASE = BUILDINGS.filter(b => b.id <= 23);
  // 随机基础局局面：直接改写真实 G 的字段（与 buildSimState 读取的字段一致）
  function randomGame(N) {
    N = N || 4;
    G = new Game(N, "AI", {});
    G.players.forEach(p => { p.isHuman = false; p._aiLevel = 5; });
    G.colonistsLeft = ri({ 2: 43, 3: 56, 4: 76, 5: 96 }[N]); G.vpLeft = ri({ 2: 66, 3: 76, 4: 101, 5: 123 }[N]);
    G.quarriesLeft = ri(9);
    G.plantationPool = []; for (let k = 0; k < 5; k++) G.plantationPool.push(PL[ri(5)]);
    for (const b of BASE) G.buildingStock[b.id] = rnd() < 0.8 ? (b.type === "production" ? 1 + ri(3) : 1) : 0;
    for (const p of G.players) {
      const np = 1 + ri(12); p.plantations = [];
      for (let k = 0; k < np; k++) p.plantations.push({ good: PL[rnd() < 0.12 ? 5 : ri(5)], manned: rnd() < 0.5 });
      p.buildings = []; let used = 0;
      const cand = BASE.slice().sort(() => rnd() - 0.5);
      const nb = ri(8);
      for (const b of cand) { if (p.buildings.length >= nb) break; if (used + b.size > 12) continue; used += b.size; p.buildings.push({ bid: b.id, men: ri(b.men + 1) }); }
      p.money = ri(16); p.vp = ri(25);
      p.goods = { corn: ri(4), indigo: ri(3), sugar: ri(3), tobacco: ri(3), coffee: ri(2) };
      p._unplacedMen = ri(5);
    }
    return G;
  }
  const simState = (fid) => { const st = buildSimState(G); if (fid) st._fid = true; return st; };

  // ① evalBuilding
  { let n = 0, bad = 0, offDiff = 0, ex = null;
    for (let t = 0; t < 300; t++) {
      randomGame();
      const pi = ri(4), p = G.players[pi];
      const stOn = simState(true), stOff = simState(false);
      for (const ph of ["early", "mid", "late"]) for (const b of BASE) {
        const want = evalBuildingValue(p, b, ph);
        const got = I.evalBuilding(stOn, stOn.players[pi], b, ph), gotOff = I.evalBuilding(stOff, stOff.players[pi], b, ph);
        n++; if (got !== want) { bad++; if (!ex) ex = { bid: b.id, ph, want, got }; } if (gotOff !== want) offDiff++;
      }
    }
    R.evalBuilding = { n, bad, offDiff, ex };
  }
  // ② 建造选择
  { let n = 0, bad = 0, offDiff = 0, passes = 0, saves = 0, grabs = 0, ex = null;
    for (let t = 0; t < 4000; t++) {
      randomGame();
      const pi = ri(4), p = G.players[pi], isCh = rnd() < 0.3;
      const options = buildBuilderOptions(p, isCh);
      if (!options.length) continue;
      const want = aiPickBuilding(p, options, isCh);
      const stOn = simState(true), stOff = simState(false);
      const cands = options.map(o => ({ b: o.b, cost: o.cost }));
      const got = I.fidPickBuild(stOn, stOn.players[pi], cands, isCh, I.fidPhase(stOn));
      // fid 关的旧规则：最高分 ≤0 → PASS
      let bi = -1, bs = -Infinity; const ph = S.phaseOf(stOff);
      for (let k = 0; k < cands.length; k++) { const s = I.evalBuilding(stOff, stOff.players[pi], cands[k].b, ph) - cands[k].cost * 3 + (isCh ? 5 : 0); if (s > bs) { bs = s; bi = k; } }
      const gotOff = bs <= 0 ? -1 : bi;
      n++; if (want < 0) passes++;
      const tgt = I.fidBestLargeViolet(stOn, stOn.players[pi]);
      if (want < 0 && tgt) saves++;
      if (want >= 0 && tgt && options[want].b.id === tgt.id) grabs++;
      if (got !== want) { bad++; if (!ex) ex = { want, got, opts: options.map(o => o.b.id) }; }
      if (gotOff !== want) offDiff++;
    }
    R.pickBuild = { n, bad, offDiff, passes, saves, grabs, ex };
  }
  // ③ 选田 / 采石场
  { let n = 0, bad = 0, offDiff = 0, quarry = 0, ex = null;
    for (let t = 0; t < 4000; t++) {
      randomGame();
      const pi = ri(4), p = G.players[pi], isCh = rnd() < 0.6;
      if (p.plantations.length >= 12) continue;
      const options = G.plantationPool.map((g, k) => ({ kind: "plant", good: g, idx: k }));
      if (G.quarriesLeft > 0 && (isCh || G.isManned(p, 9))) options.push({ kind: "quarry" });
      const want = aiPickPlantation(p, options, isCh);
      const stOn = simState(true), stOff = simState(false);
      const got = I.pickPlantation(stOn, stOn.players[pi], options, isCh), gotOff = I.pickPlantation(stOff, stOff.players[pi], options, isCh);
      n++; if (options[want].kind === "quarry") quarry++;
      if (got !== want) { bad++; if (!ex) ex = { want, got }; }
      if (gotOff !== want) offDiff++;
    }
    R.pickPlantation = { n, bad, offDiff, quarry, ex };
  }
  // ④ 市长派工
  { let n = 0, bad = 0, offDiff = 0, ex = null;
    const sig = (p, u) => p.plantations.map(x => x.manned ? 1 : 0).join("") + "|" + p.buildings.map(b => b.men).join(",") + "|" + u;
    for (let t = 0; t < 3000; t++) {
      randomGame();
      const pi = ri(4), p = G.players[pi];
      p._unplacedMen = 1 + ri(5);
      const stOn = simState(true), stOff = simState(false);
      aiReallocate(p);
      I.reallocate(stOn.players[pi], true); I.reallocate(stOff.players[pi], false);
      const want = sig(p, p._unplacedMen), got = sig(stOn.players[pi], stOn.players[pi].unplaced), gotOff = sig(stOff.players[pi], stOff.players[pi].unplaced);
      n++; if (got !== want) { bad++; if (!ex) ex = { want, got }; } if (gotOff !== want) offDiff++;
    }
    R.reallocate = { n, bad, offDiff, ex };
  }
  // ⑤ 装船：cphase 固定为 "mid"，但当前真实阶段为 late（VP 池已近空）→ fid 必须按现算阶段选
  { let n = 0, bad = 0, offDiff = 0;
    for (let t = 0; t < 600; t++) {
      randomGame();
      G.vpLeft = ri(30); // late
      const ch = ri(4), ord = [0, 1, 2, 3].map(k => (ch + k) % 4), oi = ri(4), p = G.players[ord[oi]];
      G.ships.forEach(s => { s.good = null; s.count = 0; });
      if (rnd() < 0.5) { G.ships[0].good = "corn"; G.ships[0].count = 1; }
      const st = simState(false); st.picksThisTurn = 0;
      st.az = { phase: "captain", chooser: ch, ord, oi, progressed: false, chooserBonusUsed: false, cphase: "mid" };
      const dec = S.azDecision(st);
      if (!dec || dec.type !== "captain" || dec.chooser !== p.idx) continue;
      const og = {}; for (const g of GOODS) { let s = 0; for (const x of G.players) if (x !== p) s += x.goods[g] || 0; og[g] = s; }
      const gameC = []; for (const a of dec.actions) { const sh = Math.floor(a / 10), g = GOODS[a % 10]; if (sh === 3) gameC.push({ ship: "wharf", good: g, amount: Math.min(p.goods[g], 11) }); else gameC.push({ ship: sh, good: g, amount: Math.min(p.goods[g], G.ships[sh].capacity - G.ships[sh].count) }); }
      const w = rankCaptainForAI(gameC, G.ships, gamePhase(), og, p._captainDeny)[0];
      const want = captainCandCode(w);
      const stOn = S.clone(st); stOn._fid = true;
      const got = S.azHeuristicAction(stOn, dec), gotOff = S.azHeuristicAction(S.clone(st), dec);
      n++; if (got !== want) bad++; if (gotOff !== want) offDiff++;
    }
    R.captain = { n, bad, offDiff };
  }
  // ⑥ 庄园（Hacienda）：az 在决策前抽、幂等；无选项也抽；doSettler 与 az 两路一致
  {
    const r = { idem: false, before: false, noOpt: false, skipFull: false, parity: 0, parityBad: 0, parityHac: 0 };
    const mk = () => {
      const st = S.newState(4, [5, 5, 5, 5], (function (a) { return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })(7));
      st._fid = true;
      return st;
    };
    { // 幂等 + 决策前：chooser 0 拥有镇守的庄园；azDecision 调 3 次只抽 1 张
      const st = mk(); const p = st.players[st.governor];
      p.buildings.push({ bid: 8, men: 1 });
      const ri0 = st.roleCards.findIndex(c => c.name === "Settler");
      const deck0 = st.plantationDeck.length, n0 = p.plantations.length;
      S.azApply(st, ri0);
      const d1 = S.azDecision(st), d2 = S.azDecision(st), d3 = S.azDecision(st);
      r.before = d1 && d1.type === "settle" && d1.chooser === p.idx && p.plantations.length === n0 + 1;
      r.idem = st.plantationDeck.length === deck0 - 1 && p.plantations.length === n0 + 1 && JSON.stringify(d1) === JSON.stringify(d3);
    }
    { // 无选项也抽：非 chooser、明牌池空、无建筑工地 → 没有决策，但庄园照样抽（game.js 同）
      const st = mk(); const gi = st.governor, oiP = st.players[(gi + 1) % 4];
      oiP.buildings.push({ bid: 8, men: 1 });
      const ri0 = st.roleCards.findIndex(c => c.name === "Settler");
      S.azApply(st, ri0);
      st.plantationPool = [];                 // 清空明牌 → 除 chooser(采石场) 外都无选项
      const n0 = oiP.plantations.length;
      let d = S.azDecision(st), guard = 0;
      while (d && d.type !== "role" && guard++ < 50) { S.azApply(st, S.azHeuristicAction(st, d)); d = S.azDecision(st); }
      r.noOpt = oiP.plantations.length === n0 + 1;
    }
    { // 抽满 12 格 → 不再有明牌决策
      const st = mk(); const p = st.players[st.governor];
      p.buildings.push({ bid: 8, men: 1 });
      while (p.plantations.length < 11) p.plantations.push({ good: "corn", manned: false });
      const ri0 = st.roleCards.findIndex(c => c.name === "Settler");
      S.azApply(st, ri0);
      const d = S.azDecision(st);
      r.skipFull = p.plantations.length === 12 && !(d && d.type === "settle" && d.chooser === p.idx);
    }
    { // factored parity：fid 下 applyRole(do*) 与 azPlayHeuristic 整局逐位一致（含庄园持有者）
      for (let s = 1; s <= 30; s++) {
        const mkR = (a) => () => { a = (a * 48271) % 2147483647; return a / 2147483647; };
        // 两路各用一份**独立但同种子**的 RNG（clone 会共享 rnd 函数 → 先跑的一路会把后一路的洗牌流吃掉）
        const mkS = () => {
          const x = S.newState(4, [5, 5, 5, 5], mkR(s * 7919)); x._fid = true;
          // 让一半对局里有人开局就拥有镇守的庄园、另一人钱多，覆盖庄园/大紫/攒钱分支
          if (s % 2) { x.players[s % 4].buildings.push({ bid: 8, men: 1 }); x.buildingStock[8]--; x.players[(s + 1) % 4].money = 12; }
          return x;
        };
        const a = mkS(), b = mkS();
        let g = 0;
        while (!S.isTerminal(a) && g++ < 400) { const ch = S.currentChooser(a); if (ch < 0) break; const L = S.legalRoleIdxs(a); S.applyRole(a, S.heuristicPickRole(a, ch, L)); }
        b.az = { phase: "role" };
        // az 路径的角色决策用同一启发式 → 两路应走出同一局
        S.azPlayHeuristic(b);
        const strip = (st) => JSON.stringify(st.players.map(p => [p.money, p.vp, p.plantations.map(x => x.good + (x.manned ? 1 : 0)).join(","), p.buildings.map(x => x.bid + ":" + x.men).join(",")]));
        r.parity++; if (strip(a) !== strip(b)) r.parityBad++;
        if (a.players.some(p => p.buildings.some(x => x.bid === 8 && x.men > 0))) r.parityHac++;
      }
    }
    R.hacienda = r;
  }
  // ⑦ 扩展开关下 fid 失效：同一局面 fid 开/关逐位相同
  {
    let n = 0, bad = 0;
    for (let t = 0; t < 300; t++) {
      randomGame();
      const pi = ri(4);
      for (const flag of ["expansionNobles", "expansionTibs", "expansion"]) {
        const a = simState(false), b = simState(false); a[flag] = true; b[flag] = true; b._fid = true;
        const opts = G.plantationPool.map((g, k) => ({ kind: "plant", good: g, idx: k })).concat([{ kind: "quarry" }]);
        const x1 = I.pickPlantation(a, a.players[pi], opts, true), x2 = I.pickPlantation(b, b.players[pi], opts, true);
        const e1 = BASE.map(bb => I.evalBuilding(a, a.players[pi], bb, "mid")).join(), e2 = BASE.map(bb => I.evalBuilding(b, b.players[pi], bb, "mid")).join();
        const a2 = S.clone(a), b2 = S.clone(b); I.doBuilder(a2, pi); I.doBuilder(b2, pi); I.doSettler(a2, pi); I.doSettler(b2, pi); I.doMayor(a2, pi); I.doMayor(b2, pi);
        const j1 = JSON.stringify(a2.players), j2 = JSON.stringify(b2.players);
        n++; if (x1 !== x2 || e1 !== e2 || j1 !== j2 || I.fidOn(b)) bad++;
      }
    }
    R.inert = { n, bad };
  }
  // ⑧ 标志搬运
  {
    randomGame();
    const off = buildSimState(G);
    const r = { offNoKey: !("_fid" in off) && !("_fid" in S.clone(off)) };
    const on = buildSimState(G); on._fid = true;
    r.cloneCopies = S.clone(on)._fid === true;
    const wire = Object.assign({}, on); delete wire.rnd;           // 与 PRAIPool.pickRoleParallel 同样的传输准备
    r.transport = structuredClone(wire)._fid === true;
    window._l6Fid = true;
    r.buildOn = buildSimState(G)._fid === true;
    G.expansionNobles = true;
    r.buildOffMods = !("_fid" in buildSimState(G));
    G.expansionNobles = false;
    // _l6Heur 改了 fid 硬编码的默认参数 → 不开；与默认值相同的注入不算改动
    window._l6Heur = { bd_grabMid: 25 }; r.heurOff = !("_fid" in buildSimState(G));
    window._l6Heur = { pl_moneyLean: 9 }; r.heurOff = r.heurOff && !("_fid" in buildSimState(G));
    window._l6Heur = { bd_grabMid: 16, pl_moneyLean: 7 }; r.heurSame = buildSimState(G)._fid === true;
    delete window._l6Heur; delete window._l6Fid;
    r.buildDefault = !("_fid" in buildSimState(G));
    R.flag = r;
  }
  // ⑨ 新增三类子决策重建（settle/trade/craftbonus）的安全闸：一致的选项集合 → 通过；篡改 → null
  {
    const r = { settleOk: 0, settleRej: 0, tradeOk: 0, tradeRej: 0, craftOk: 0, craftRej: 0, tries: 0 };
    for (let t = 0; t < 200; t++) {
      randomGame();
      for (const c of G.roleCards) { c.taken = false; c.takenBy = null; }
      const ch = ri(4), p = G.players[(ch + ri(4)) % 4], isCh = p.idx === ch;
      const take = (name) => { const c = G.roleCards.find(x => x.name === name); c.taken = true; c.takenBy = ch; };
      r.tries++;
      // settle
      take("Settler");
      if (p.plantations.length < 12) {
        const options = G.plantationPool.map((g, k) => ({ kind: "plant", good: g, idx: k }));
        if (G.quarriesLeft > 0 && (isCh || G.isManned(p, 9))) options.push({ kind: "quarry" });
        if (simStateAtSubDecision("settle", p, { options, isChooser: isCh })) r.settleOk++;
        const bad = options.filter(o => o.kind !== "quarry" || rnd() < 0.5).concat(G.quarriesLeft > 0 && !isCh && !G.isManned(p, 9) ? [{ kind: "quarry" }] : []);
        const drop = G.plantationPool[0];
        const bad2 = bad.filter(o => o.good !== drop);
        if (bad2.length && !simStateAtSubDecision("settle", p, { options: bad2, isChooser: isCh })) r.settleRej++;
        if (simStateAtSubDecision("settle", p, { options, isChooser: !isCh })) r.settleRej -= 1000;   // 身份不符必须拒
      }
      // trade
      take("Trader");
      const opts = GOODS.filter(g => p.goods[g] > 0 && (G.isManned(p, 12) || !G.tradingHouse.includes(g))).map(g => ({ g, dest: "house" }));
      if (opts.length && G.tradingHouse.length < 4) {
        if (simStateAtSubDecision("trade", p, { opts, isChooser: isCh })) r.tradeOk++;
        const missing = GOODS.find(g => !opts.some(o => o.g === g));
        if (missing && !simStateAtSubDecision("trade", p, { opts: opts.concat([{ g: missing, dest: "house" }]), isChooser: isCh })) r.tradeRej++;
      }
      // craftbonus（只对选择者）
      take("Craftsman");
      const cp = G.players[ch];
      const own = new Set(GOODS.filter(g => G.productionCapacity(cp, g) > 0));
      const avail = GOODS.filter(g => G.supply[g] > 0 && own.has(g));
      if (avail.length) {
        if (simStateAtSubDecision("craftbonus", cp, { available: avail, ownKinds: own })) r.craftOk++;
        if (!simStateAtSubDecision("craftbonus", cp, { available: avail.slice(1), ownKinds: own }) || avail.length === 1) r.craftRej++;
      }
    }
    R.gate = r;
  }
  // ⑩ 阶段镜像 + 2 人局对照
  {
    const r = { n: 0, bad: 0, offDiff2p: 0, ex: null, pl2: 0, pl2bad: 0, pl2off: 0, bd2: 0, bd2bad: 0, bd2off: 0, plEx: null, bdEx: null };
    randomGame(4);
    const N0 = G.numPlayers;
    const colMax = { 1: 30, 2: 42, 3: 55, 4: 75, 5: 95 }, vpMax = { 1: 50, 2: 65, 3: 75, 4: 100, 5: 122 };
    for (let N = 1; N <= 5; N++) {
      G.numPlayers = N;   // gamePhase 只读 G.numPlayers / colonistsLeft / vpLeft
      for (let c = 0; c <= colMax[N]; c++) for (const v of [vpMax[N], Math.round(vpMax[N] * 0.5), 0]) {
        G.colonistsLeft = c; G.vpLeft = v;
        const st = { numPlayers: N, colonistsLeft: c, vpLeft: v };
        const want = gamePhase(), got = I.fidPhase(st);
        r.n++; if (got !== want) { r.bad++; if (!r.ex) r.ex = { N, c, v, want, got }; }
        if (N === 2 && S.phaseOf(st) !== want) r.offDiff2p++;
      }
    }
    G.numPlayers = N0;
    // 2 人局随机局面：殖民者余量集中在分母敏感区（27-28 → mid/early、14 → late/mid）与全程随机
    const hot = [28, 27, 14, 13];
    for (let t = 0; t < 3000; t++) {
      randomGame(2);
      if (t % 2 === 0) G.colonistsLeft = hot[ri(hot.length)];
      G.vpLeft = 40 + ri(26);   // VP 侧保持靠前 → 阶段由殖民者分母决定
      const pi = ri(2), p = G.players[pi], isCh = rnd() < 0.6;
      if (p.plantations.length < 12) {
        const options = G.plantationPool.map((g, k) => ({ kind: "plant", good: g, idx: k }));
        if (G.quarriesLeft > 0 && (isCh || G.isManned(p, 9))) options.push({ kind: "quarry" });
        const want = aiPickPlantation(p, options, isCh);
        const stOn = simState(true);
        const got = I.pickPlantation(stOn, stOn.players[pi], options, isCh);
        // 对照：fid 规则但用 phaseOf 分母（即修复前的行为）——只为证明本例对分母敏感
        r.pl2++; if (got !== want) { r.pl2bad++; if (!r.plEx) r.plEx = { want, got, c: G.colonistsLeft }; }
        if (S.phaseOf(stOn) !== gamePhase()) r.pl2off++;
      }
      const options = buildBuilderOptions(p, isCh);
      if (options.length) {
        const want = aiPickBuilding(p, options, isCh);
        const stOn = simState(true);
        const got = I.fidPickBuild(stOn, stOn.players[pi], options.map(o => ({ b: o.b, cost: o.cost })), isCh, I.fidPhase(stOn));
        r.bd2++; if (got !== want) { r.bd2bad++; if (!r.bdEx) r.bdEx = { want, got, c: G.colonistsLeft }; }
        // 经 az 层（azHeuristicAction）走一遍：fid 分支内部自取阶段，必须与 game.js 一致
        const card = G.roleCards.find(x => x.name === "Builder"); for (const c of G.roleCards) { c.taken = false; c.takenBy = null; }
        card.taken = true; card.takenBy = isCh ? pi : 1 - pi;
        const rb = simStateAtSubDecision("build", p, { options });
        if (rb) {
          const s2 = S.clone(rb.st); s2._fid = true;
          const a = S.azHeuristicAction(s2, rb.dec), wantA = want < 0 ? S.AZ_PASS : options[want].b.id;
          r.bd2++; if (a !== wantA) { r.bd2bad++; if (!r.bdEx) r.bdEx = { via: "az", want: wantA, got: a, c: G.colonistsLeft }; }
        }
        if (S.phaseOf(stOn) !== gamePhase()) r.bd2off++;
      }
    }
    R.phase = r;
  }
  // ⑪ 重建的拓殖局面以 fid 关续跑：庄园已抽过 → 一次选田只多 1 块
  {
    const r = { off: null, on: null, next: null };
    for (const fid of [false, true]) {
      randomGame(4);
      for (const c of G.roleCards) { c.taken = false; c.takenBy = null; }
      const card = G.roleCards.find(x => x.name === "Settler"); card.taken = true; card.takenBy = 0;
      const p = G.players[0];
      p.plantations = [{ good: "corn", manned: true }];
      p.buildings = [{ bid: 8, men: 1 }];
      p.plantations.push({ good: G.plantationDeck.pop(), manned: false });   // game.js doSettler：选田前已抽庄园
      const q = G.players[1];                                                 // 下一位也有庄园 → 续跑时照常抽（fid 关：选后抽）
      q.plantations = [{ good: "corn", manned: true }]; q.buildings = [{ bid: 8, men: 1 }];
      G.quarriesLeft = 5;
      const options = G.plantationPool.map((g, k) => ({ kind: "plant", good: g, idx: k })); options.push({ kind: "quarry" });
      const rb = simStateAtSubDecision("settle", p, { options, isChooser: true });
      if (!rb) continue;
      if (fid) rb.st._fid = true;
      const n0 = rb.st.players[0].plantations.length, d0 = rb.st.plantationDeck.length;
      S.azApply(rb.st, rb.dec.actions[0]);
      const one = rb.st.players[0].plantations.length === n0 + 1 && rb.st.plantationDeck.length === d0;
      // 续到下一位（seat 1）：选一次后它的庄园必须恰好抽 1 张（fid 关在选后、fid 开在决策前）
      const m0 = rb.st.players[1].plantations.length, e0 = rb.st.plantationDeck.length;
      const d1 = S.azDecision(rb.st);
      let next = false;
      if (d1 && d1.type === "settle" && d1.chooser === 1) { S.azApply(rb.st, d1.actions[0]); next = rb.st.players[1].plantations.length === m0 + 2 && rb.st.plantationDeck.length === e0 - 1; }
      r[fid ? "on" : "off"] = one; r.next = (r.next === null ? true : r.next) && next;
    }
    R.hacRebuild = r;
  }
  return JSON.stringify(R);
})()`);

const R = JSON.parse(out);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('  ok', m); };
const e = R.evalBuilding, b = R.pickBuild, pl = R.pickPlantation, re = R.reallocate, ca = R.captain, h = R.hacienda;
ok(e.bad === 0, `① evalBuilding(fid) ≡ evalBuildingValue：${e.n} 次比较，不一致 ${e.bad}${e.ex ? ' 例 ' + JSON.stringify(e.ex) : ''}`);
ok(e.offDiff > 0, `① 非空洞：fid 关时不一致 ${e.offDiff}（_specBuyPen）`);
ok(b.bad === 0, `② fidPickBuild ≡ aiPickBuilding：${b.n} 次，不一致 ${b.bad}${b.ex ? ' 例 ' + JSON.stringify(b.ex) : ''}`);
ok(b.offDiff > 0 && b.passes > 0 && b.grabs > 0, `② 非空洞：fid 关不一致 ${b.offDiff}，game PASS ${b.passes}（攒钱 ${b.saves}），抢大紫 ${b.grabs}`);
ok(pl.bad === 0, `③ pickPlantation(fid) ≡ aiPickPlantation：${pl.n} 次，不一致 ${pl.bad}${pl.ex ? ' 例 ' + JSON.stringify(pl.ex) : ''}`);
ok(pl.offDiff > 0 && pl.quarry > 0, `③ 非空洞：fid 关不一致 ${pl.offDiff}，选采石场 ${pl.quarry}`);
ok(re.bad === 0, `④ reallocate(fid) ≡ aiReallocate：${re.n} 次，不一致 ${re.bad}${re.ex ? ' 例 ' + JSON.stringify(re.ex) : ''}`);
ok(re.offDiff > 0, `④ 非空洞：fid 关不一致 ${re.offDiff}`);
ok(ca.n > 50 && ca.bad === 0, `⑤ 装船 fid 现算阶段 ≡ rankCaptainForAI(gamePhase())：${ca.n} 次，不一致 ${ca.bad}`);
ok(ca.offDiff > 0, `⑤ 非空洞：沿用 cphase 时不一致 ${ca.offDiff}`);
ok(h.before, '⑥ 庄园在拓殖决策之前抽（决策时已在面板上）');
ok(h.idem, '⑥ 同一 oi 反复 azDecision 只抽一次（幂等）');
ok(h.noOpt, '⑥ 无选项的玩家照样抽庄园（同 game.js）');
ok(h.skipFull, '⑥ 庄园抽满 12 格后不再有明牌决策');
ok(h.parity >= 30 && h.parityBad === 0 && h.parityHac > 0, `⑥ fid 下 applyRole 与 azPlayHeuristic 整局一致：${h.parity} 局，不一致 ${h.parityBad}（含庄园局 ${h.parityHac}）`);
ok(R.inert.n > 0 && R.inert.bad === 0, `⑦ 扩展开关下 fid 失效：${R.inert.n} 次，不一致 ${R.inert.bad}`);
const f = R.flag;
ok(f.offNoKey, '⑧ 标志关：buildSimState / clone 不写 _fid 字段');
ok(f.cloneCopies, '⑧ clone 复制 _fid');
ok(f.transport, '⑧ worker 传输（Object.assign + structuredClone）保留 _fid');
ok(f.buildOn && f.buildOffMods && f.buildDefault, '⑧ buildSimState：仅 window._l6Fid 且基础局置位');
ok(f.heurOff && f.heurSame, `⑧ window._l6Heur 改了默认参数 → 不置 _fid（off=${f.heurOff}）；与默认值相同的注入不影响（same=${f.heurSame}）`);
const gt = R.gate;
ok(gt.settleOk > 50 && gt.tradeOk > 50 && gt.craftOk > 50, `⑨ 重建安全闸放行一致的选项集合：settle ${gt.settleOk} · trade ${gt.tradeOk} · craftbonus ${gt.craftOk}（/${gt.tries}）`);
ok(gt.settleRej > 50 && gt.tradeRej > 50 && gt.craftRej > 50, `⑨ 篡改选项集合 / 身份不符 → null：settle ${gt.settleRej} · trade ${gt.tradeRej} · craftbonus ${gt.craftRej}`);
const ph = R.phase;
ok(ph.n > 0 && ph.bad === 0, `⑩ fidPhase ≡ gamePhase（1-5 人全扫）：${ph.n} 次，不一致 ${ph.bad}${ph.ex ? ' 例 ' + JSON.stringify(ph.ex) : ''}`);
ok(ph.offDiff2p > 0, `⑩ 非空洞：2 人局 phaseOf ≠ gamePhase ${ph.offDiff2p} 次（分母 40 vs 42）`);
ok(ph.pl2 > 500 && ph.pl2bad === 0, `⑩ 2 人局 pickPlantation(fid) ≡ aiPickPlantation：${ph.pl2} 次，不一致 ${ph.pl2bad}${ph.plEx ? ' 例 ' + JSON.stringify(ph.plEx) : ''}`);
ok(ph.bd2 > 500 && ph.bd2bad === 0, `⑩ 2 人局 fidPickBuild / az build(fid) ≡ aiPickBuilding：${ph.bd2} 次，不一致 ${ph.bd2bad}${ph.bdEx ? ' 例 ' + JSON.stringify(ph.bdEx) : ''}`);
ok(ph.pl2off > 0 && ph.bd2off > 0, `⑩ 非空洞：2 人局样本里阶段分母敏感的局面 选田 ${ph.pl2off} · 建造 ${ph.bd2off}`);
const hr = R.hacRebuild;
ok(hr.off === true && hr.on === true, `⑪ 重建的拓殖局面续跑一次选田只多 1 块田、牌堆不动：fid 关 ${hr.off} · fid 开 ${hr.on}`);
ok(hr.next === true, `⑪ 续跑到下一位庄园持有者：选田 + 庄园恰好共 2 块、牌堆 −1（fid 关/开）`);
if (fails) { console.log(`fid_unit_test: ${fails} FAIL`); process.exit(1); }
console.log('fid_unit_test: all ok');
