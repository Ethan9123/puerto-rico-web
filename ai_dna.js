// ============================================================
// DNA-driven AI — 基于 PuertoRicoEvolver 1.52 的进化策略
// ============================================================
// DNA 结构（519 个字符）：
//   chars 1-12   : 阶段触发器（每2字符一个：Men_Mid/Men_Late/VPs_Mid/VPs_Late/Spaces_Mid/Spaces_Late）
//   chars 13-58  : Early 角色策略（46 字符）
//   chars 59-104 : Mid 角色策略
//   chars 105-150: Late 角色策略
//   chars 151-239: Early 派工策略（89 字符）
//   chars 240-328: Mid 派工
//   chars 329-417: Late 派工
//   chars 418-442: Early 建筑偏好（25 字符）
//   chars 443-467: Mid 建筑
//   chars 468-492: Late 建筑
//   chars 493-501: Early 种植园（9 字符）
//   chars 502-510: Mid 种植园
//   chars 511-519: Late 种植园
//
// 字符映射（来自 VBA）：
//   建筑字符 A..W = 23 个建筑(BUILDINGS id 1..23)
//   #  = 占位符（不买）
//   ]  = 优先级断点
//   种植园字符 1=corn 2=indigo 3=sugar 4=tobacco 5=coffee 6=quarry d=不同 s=有生产空间 f=任意 u=未填生产 j=任意非空 o=任意空

// 加载 DNA 数据（异步从 ai_dna.json）
let AI_POOL = null;
async function loadAIDNA() {
  try {
    const resp = await fetch("ai_dna.json");
    AI_POOL = await resp.json();
    console.log("AI DNA loaded:", Object.keys(AI_POOL).map(k => k + ":" + AI_POOL[k].length).join(", "));
  } catch (e) {
    console.warn("Could not load ai_dna.json, falling back to heuristic AI", e);
    AI_POOL = null;
  }
}
loadAIDNA();

// 把 13 个 chromosome 串拼回 519 字符 DNA（兼容 JSON 中数字型 chr1）
function joinDNA(parts) {
  let chr1 = String(parts[0]).replace(/\.0+$/, "").padStart(12, "0").slice(0, 12);
  return chr1 + parts.slice(1).join("");
}

// 为一个 AI 玩家选一个 DNA（来自对应顺位的 top）
function pickDNAForPlayer(p) {
  if (!AI_POOL) return null;
  const pos = `P${Math.min(5, Math.max(1, p.idx + 1))}`;
  const pool = AI_POOL[pos];
  if (!pool || pool.length === 0) return null;
  const top = pool[Math.floor(Math.random() * Math.min(5, pool.length))]; // top 5 中随机
  const dna = joinDNA(top.dna);
  return { dna, meta: { name: top.name, avg: top.avg } };
}

// ============================================================
// DNA 拆分
// ============================================================
function splitDNA(dna) {
  return {
    triggers:     dna.slice(0, 12),
    roleEarly:    dna.slice(12, 58),
    roleMid:      dna.slice(58, 104),
    roleLate:     dna.slice(104, 150),
    manningEarly: dna.slice(150, 239),
    manningMid:   dna.slice(239, 328),
    manningLate:  dna.slice(328, 417),
    buildEarly:   dna.slice(417, 442),
    buildMid:     dna.slice(442, 467),
    buildLate:    dna.slice(467, 492),
    plantEarly:   dna.slice(492, 501),
    plantMid:     dna.slice(501, 510),
    plantLate:    dna.slice(510, 519),
  };
}

// ============================================================
// 阶段检测
// ============================================================
function detectPhase(triggers, gameState) {
  const men_mid    = parseInt(triggers.slice(0, 2)) || 0;
  const men_late   = parseInt(triggers.slice(2, 4)) || 0;
  const vps_mid    = parseInt(triggers.slice(4, 6)) || 0;
  const vps_late   = parseInt(triggers.slice(6, 8)) || 0;
  const spaces_mid = parseInt(triggers.slice(8, 10)) || 0;
  const spaces_late= parseInt(triggers.slice(10, 12)) || 0;

  const colonistsLeft = gameState.colonistsLeft;
  const vpLeft = gameState.vpLeft;
  const minSpaces = gameState.minSpaces;

  let phase = 1;
  if (men_mid > colonistsLeft || vps_mid > vpLeft || spaces_mid > minSpaces) phase = 2;
  if (men_late > colonistsLeft || vps_late > vpLeft || spaces_late > minSpaces) phase = 3;
  return phase;
}

// 计算最小建筑空间
function calcMinSpaces() {
  let min = 12;
  for (const p of G.players) {
    const used = G.buildingUsedSpaces(p);
    if (12 - used < min) min = 12 - used;
  }
  return min;
}

// ============================================================
// 选角色（基于 DNA）
// ============================================================
// 字符到角色名的映射（按 VBA 注释中的顺序）：
//   m=Mayor, s=Settler, b=Builder, c=Craftsman, t=Trader, d=Captain, p=Prospector
const ROLE_CHAR = { m: "Mayor", s: "Settler", b: "Builder", c: "Craftsman", t: "Trader", d: "Captain", p: "Prospector" };

// Capitalize 层（取自 VBA Musts 阶段的精神：capitalize 自己的引擎）。
// 只抢两类"稀有且高价值"的建造，不会每回合触发，故不会过度建造提前结束游戏：
//   (1) 买得起任一大紫(10块/4VP+终局特殊分) → 抢建造兑现
//   (2) 我有某经济作物田 ≥2 却完全没有对应加工厂 → 补厂启动产线
function dnaMustsRole(player, available) {
  const builderIdx = available.findIndex(r => r.name === "Builder");
  if (builderIdx < 0) return -1;
  const spaceLeft = 12 - G.buildingUsedSpaces(player);
  const canBuy = (b) => b && G.buildingStock[b.id] > 0 && !G.ownsBuilding(player, b.id) && spaceLeft >= b.size && player.money >= G.effectiveCostWithRoleBonus(player, b, true);
  for (const b of BUILDINGS) if (b.type === "large_violet" && canBuy(b)) return builderIdx;
  const refMap = { coffee: [6], tobacco: [5], sugar: [2, 4], indigo: [1, 3] };
  for (const g of ["coffee", "tobacco", "sugar", "indigo"]) {
    if (player.plantations.filter(pl => pl.good === g).length < 2) continue;
    if (refMap[g].some(bid => G.ownsBuilding(player, bid))) continue; // 已有加工厂
    for (const bid of refMap[g]) if (canBuy(BLD_BY_ID[bid])) return builderIdx;
  }
  return -1;
}

function dnaPickRole(player, available) {
  if (!player._dna) return null;
  // Musts 阶段：仅"高价值"必抢（补产业链 / 大紫），不含买便宜小建筑——避免过度建造提前结束游戏拉低分。
  const must = dnaMustsRole(player, available);
  if (must >= 0) return must;
  const phase = detectPhase(player._dna.triggers, {
    colonistsLeft: G.colonistsLeft, vpLeft: G.vpLeft, minSpaces: calcMinSpaces()
  });
  const phaseDNA = phase === 1 ? player._dna.roleEarly : phase === 2 ? player._dna.roleMid : player._dna.roleLate;
  // phaseDNA: 20 chars "musts" + ']' + 16 chars triggers + ']0' + 7 chars default
  const sep1 = phaseDNA.indexOf("]");
  if (sep1 < 0) return null;
  const sep2 = phaseDNA.indexOf("]", sep1 + 1);
  const triggers = phaseDNA.slice(sep1 + 1, sep2);
  const defaults = phaseDNA.slice(sep2 + 2); // skip "]0"

  // 简化解析：trigger 段 8 对 (action, level) — 按顺序判断是否满足，满足就选该 action
  // 触发字符：m=Mayor, s=Settler, b=Builder, c=Craftsman, t=Trader, d=Captain, p=Prospector, g=最大金钱
  const availableNames = new Set(available.map(r => r.name));

  for (let i = 0; i + 1 < triggers.length; i += 2) {
    const action = triggers[i];
    const level = triggers[i + 1];
    const roleName = ROLE_CHAR[action];
    if (!roleName || !availableNames.has(roleName)) continue;
    if (matchesTrigger(action, level, player)) {
      return available.findIndex(r => r.name === roleName);
    }
  }

  // 默认顺序
  for (const ch of defaults) {
    const name = ROLE_CHAR[ch];
    if (name && availableNames.has(name)) {
      return available.findIndex(r => r.name === name);
    }
  }

  // 兜底
  return 0;
}

// 我现在卖 1 货能拿多少金（含小/大市场加成；不含 chooser+1 与卡上奖金，与 VBA 一致）
function dnaBestSale(player) {
  const hasOffice = G.isManned(player, 12);
  let best = 0;
  for (const g of GOODS) {
    if (player.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g))) {
      let earn = GOOD_PRICE[g];
      if (G.isManned(player, 7)) earn += 1;
      if (G.isManned(player, 13)) earn += 2;
      best = Math.max(best, earn);
    }
  }
  return best;
}
// 当前能卖货的其他玩家数（贸易站非满且有可卖货）
function dnaOtherSellers(player) {
  if (G.tradingHouse.length >= 4) return 0;
  let n = 0;
  for (const p of G.players) {
    if (p === player) continue;
    const office = G.isManned(p, 12);
    if (GOODS.some(g => p.goods[g] > 0 && (office || !G.tradingHouse.includes(g)))) n++;
  }
  return n;
}

function matchesTrigger(action, level, player) {
  // 忠实于 VBA strComputer_Selects_Role 的 Stage-2 偏好判定
  const lvl = parseInt(level);
  switch (action) {
    case "m": {
      // mX = 空岗(建筑+种植园) ≥ X 时选市长；mf = 船上正好 6 或 11 人
      if (level === "f") return G.colonistsOnShip === 6 || G.colonistsOnShip === 11;
      let openJobs = 0;
      for (const pl of player.plantations) if (!pl.manned) openJobs++;
      for (const b of player.buildings) openJobs += BLD_BY_ID[b.bid].men - b.men;
      return openJobs >= lvl;
    }
    case "s": {
      // sX = 有 X 类田可拿（1-6 指定 / d=有自己没有的类 / s=有自己加工空位可吃的类）
      if (level === "d") {
        const owned = new Set(player.plantations.map(pl => pl.good));
        return G.plantationPool.some(g => !owned.has(g)) || (G.quarriesLeft > 0 && !owned.has("quarry"));
      }
      if (level === "s") {
        // 我有某加工厂、其产能 > 已有对应田 → 池里又有该田
        const refining = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] };
        for (const g of Object.keys(refining)) {
          let cap = 0; for (const bid of refining[g]) { const bb = G.ownsBuilding(player, bid); if (bb) cap += BLD_BY_ID[bid].men; }
          const have = player.plantations.filter(pl => pl.good === g).length;
          if (cap > have && G.plantationPool.includes(g)) return true;
        }
        return false;
      }
      const goodMap = { "1": "corn", "2": "indigo", "3": "sugar", "4": "tobacco", "5": "coffee", "6": "quarry" };
      const g = goodMap[level];
      if (!g) return G.plantationPool.length > 0;
      if (g === "quarry") return G.quarriesLeft > 0;
      return G.plantationPool.includes(g);
    }
    case "b": {
      // bX = 现金 + 已上岗采石场 ≥ X 时选建造
      let qManned = 0;
      for (const pl of player.plantations) if (pl.good === "quarry" && pl.manned) qManned++;
      return (player.money + qManned) >= lvl;
    }
    case "c": {
      // cX = 本回合产 ≥X 货；cs=有仓库&产≥4；cw=有码头&产≥4；ce=两者之一&产≥4
      let prod = 0;
      for (const g of GOODS) prod += Math.min(G.productionCapacity(player, g), G.supply[g]);
      if (level === "s") return (G.isManned(player, 10) || G.isManned(player, 14)) && prod >= 4;
      if (level === "w") return G.isManned(player, 18) && prod >= 4;
      if (level === "e") return prod >= 4 && (G.isManned(player, 18) || G.isManned(player, 10) || G.isManned(player, 14));
      return prod >= lvl;
    }
    case "t": {
      // tX = 卖货赚 ≥X 金；tf=我是唯一卖家(≥2)；tt=最多2人能卖(≥2)；tu=tt或≥4；tg=tf或≥4；tm=我赚最多(≥2)
      const my = dnaBestSale(player);
      if (my <= 0 || G.tradingHouse.length >= 4) return false;
      const others = dnaOtherSellers(player);
      switch (level) {
        case "f": return others === 0 && my >= 2;
        case "t": return others <= 1 && my >= 2;
        case "u": return (others <= 1 && my >= 2) || my >= 4;
        case "g": return (others === 0 && my >= 2) || my >= 4;
        case "m": {
          if (my < 2) return false;
          for (const p of G.players) { if (p === player) continue; if (dnaBestSale(p) > my) return false; }
          return true;
        }
        default: return my >= lvl;
      }
    }
    case "d": {
      // dX = 手上货 ≥X 个时选船长
      const total = GOODS.reduce((s, g) => s + player.goods[g], 0);
      return total >= lvl;
    }
    case "p":   // pX = 金矿能赚 ≥X 金（金矿恒 +1，阈值 ≤1 才触发）
    case "g":   // gX = 最佳现金动作 ≥X 金（近似：阈值 ≤1 触发）
      return lvl <= 1;
    default:
      return false;
  }
}

// ============================================================
// 选种植园（基于 DNA）
// ============================================================
const PLANT_CHAR = { "1": "corn", "2": "indigo", "3": "sugar", "4": "tobacco", "5": "coffee", "6": "quarry" };

// 各货合理拥有上限（VBA intMax_Number；超过则该类降权到最后）
const PLANT_MAX = { corn: 11, indigo: 3, sugar: 3, tobacco: 2, coffee: 1, quarry: 3 };
const GOODS5 = ["corn", "indigo", "sugar", "tobacco", "coffee"]; // 按价格升序

// 某玩家是否"拥有该种植园"(prodOrPlant=2) 或 "能产该货"(prodOrPlant=1)
function dnaNeighborHas(p, good, prodOrPlant) {
  if (prodOrPlant === 2) return p.plantations.some(pl => pl.good === good);
  // 产能：有该田 且 (玉米 或 有对应加工厂)
  if (!p.plantations.some(pl => pl.good === good)) return false;
  if (good === "corn") return true;
  const ref = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] }[good];
  return ref && ref.some(bid => G.ownsBuilding(p, bid));
}

function dnaPickPlantation(player, options, isChooser) {
  if (!player._dna) return null;
  const phase = detectPhase(player._dna.triggers, {
    colonistsLeft: G.colonistsLeft, vpLeft: G.vpLeft, minSpaces: calcMinSpaces()
  });
  const order = phase === 1 ? player._dna.plantEarly : phase === 2 ? player._dna.plantMid : player._dna.plantLate;
  const n = G.numPlayers;
  const owned = {}; for (const pl of player.plantations) owned[pl.good] = (owned[pl.good] || 0) + 1;
  // 候选 good（按 VBA：已达该类上限的排到最后再考虑）
  const availGoods = GOODS5.filter(g => options.some(o => o.kind === "plant" && o.good === g));
  const underCap = availGoods.filter(g => (owned[g] || 0) <= (PLANT_MAX[g] || 0));
  const overCap = availGoods.filter(g => (owned[g] || 0) > (PLANT_MAX[g] || 0));
  const ranked = underCap.concat(overCap); // 优先未超上限的
  const idxOf = g => options.findIndex(o => o.kind === "plant" && o.good === g);
  // 我有加工空位可吃的货（s 用）
  const hasProdSpace = (g) => {
    if (g === "corn") return false;
    const ref = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] }[g];
    let cap = 0; if (ref) for (const bid of ref) { const bb = G.ownsBuilding(player, bid); if (bb) cap += BLD_BY_ID[bid].men; }
    return cap > (owned[g] || 0);
  };
  const byPriceDesc = arr => arr.slice().sort((a, b) => GOOD_PRICE[b] - GOOD_PRICE[a]);
  const byPriceAsc = arr => arr.slice().sort((a, b) => GOOD_PRICE[a] - GOOD_PRICE[b]);

  for (const ch of order) {
    // 指定货 1-5 / 采石场 6
    if (ch >= "1" && ch <= "5") { const i = idxOf(PLANT_CHAR[ch]); if (i >= 0) return i; continue; }
    if (ch === "6") { const i = options.findIndex(o => o.kind === "quarry"); if (i >= 0) return i; continue; }
    // u = 最贵且没人(别的玩家)拥有的种植园；t = 最贵且没人能产的产能型
    if (ch === "u" || ch === "t") {
      const por = ch === "u" ? 2 : 1;
      for (const g of byPriceDesc(ranked)) {
        const someoneElse = G.players.some(p => p !== player && dnaNeighborHas(p, g, por));
        if (!someoneElse) { const i = idxOf(g); if (i >= 0) return i; }
      }
      continue;
    }
    // f = 我未拥有/未支撑的最贵种植园
    if (ch === "f") {
      for (const g of byPriceDesc(ranked)) if (!(owned[g] > 0)) { const i = idxOf(g); if (i >= 0) return i; }
      continue;
    }
    // s = 我有加工空位可吃的最贵种植园
    if (ch === "s") {
      for (const g of byPriceDesc(ranked)) if (hasProdSpace(g)) { const i = idxOf(g); if (i >= 0) return i; }
      continue;
    }
    // d = 与已有不同里最便宜的
    if (ch === "d") {
      for (const g of byPriceAsc(ranked)) if (!(owned[g] > 0)) { const i = idxOf(g); if (i >= 0) return i; }
      continue;
    }
    // 邻座卡位：l r k q j p i o（方向×种植园或产能×抢他有的/避开他有的）
    if ("lrkqjpio".includes(ch)) {
      const dir = ("lkji".includes(ch)) ? 1 : (n - 1);          // 左 / 右
      const por = ("lrjp".includes(ch)) ? 2 : 1;                 // 看种植园 / 产能
      const wantHas = !("lrkq".includes(ch));                    // true=抢他有的, false=避开他有的
      const nb = G.players[(player.idx + dir) % n];
      for (const g of byPriceDesc(ranked)) {
        if (dnaNeighborHas(nb, g, por) === wantHas) { const i = idxOf(g); if (i >= 0) return i; }
      }
      continue;
    }
  }
  return 0;
}

// ============================================================
// 选建筑（基于 DNA）
// ============================================================
// 字符 A=building1 (小靛蓝厂) B=building2 ... W=building23 (市政厅)
// # 是占位（don't buy），] 是断点
function dnaPickBuilding(player, options, isChooser) {
  if (!player._dna) return -1;
  const phase = detectPhase(player._dna.triggers, {
    colonistsLeft: G.colonistsLeft, vpLeft: G.vpLeft, minSpaces: calcMinSpaces()
  });
  const order = phase === 1 ? player._dna.buildEarly : phase === 2 ? player._dna.buildMid : player._dna.buildLate;
  // 找第一个 A-W 字符且 options 中可买的
  for (const ch of order) {
    if (ch === "]" || ch === "#") {
      // 这些是分隔/不买信号，遇到后继续看
      continue;
    }
    const code = ch.charCodeAt(0) - "A".charCodeAt(0);
    if (code < 0 || code >= 23) continue;
    const bid = code + 1;
    const idx = options.findIndex(o => o.b.id === bid);
    if (idx >= 0) return idx;
  }
  return -1;
}
