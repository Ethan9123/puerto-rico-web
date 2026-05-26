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

function matchesTrigger(action, level, player) {
  // 简化判定（按 VBA 注释）
  const lvl = parseInt(level);
  switch (action) {
    case "m": {
      // mX = Mayor if has at least X more spaces than men
      let openJobs = 0;
      for (const pl of player.plantations) if (!pl.manned) openJobs++;
      for (const b of player.buildings) openJobs += BLD_BY_ID[b.bid].men - b.men;
      // 特殊 mf = 船上有 6 或 11 人
      if (level === "f") return G.colonistsOnShip >= 6;
      return openJobs >= lvl;
    }
    case "s": {
      // sX = Settler if plantation type X available
      if (level === "d") {
        const owned = new Set(player.plantations.map(pl => pl.good));
        return G.plantationPool.some(g => !owned.has(g));
      }
      if (level === "s") {
        // production space: have factory with empty plantation need
        return G.plantationPool.length > 0;
      }
      // 1-5 = specific good
      const goodMap = { "1": "corn", "2": "indigo", "3": "sugar", "4": "tobacco", "5": "coffee", "6": "quarry" };
      const g = goodMap[level];
      if (!g) return G.plantationPool.length > 0;
      if (g === "quarry") return G.quarriesLeft > 0;
      return G.plantationPool.includes(g);
    }
    case "b": {
      // bX = Builder if has at least X cash + manned quarries
      let qManned = 0;
      for (const pl of player.plantations) if (pl.good === "quarry" && pl.manned) qManned++;
      return (player.money + qManned) >= lvl;
    }
    case "c": {
      // cX = Craftsman if produce at least X goods
      let prod = 0;
      for (const g of GOODS) prod += G.productionCapacity(player, g);
      if (level === "w") return G.isManned(player, 18);
      if (level === "s") return G.isManned(player, 10) || G.isManned(player, 14);
      if (level === "e") return prod >= 4 && (G.isManned(player, 18) || G.isManned(player, 10));
      return prod >= lvl;
    }
    case "t": {
      // tX = Trader if can earn at least X gold (rough)
      const hasOffice = G.isManned(player, 12);
      let best = 0;
      for (const g of GOODS) {
        if (player.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g))) {
          best = Math.max(best, GOOD_PRICE[g]);
        }
      }
      return best >= lvl;
    }
    case "d": {
      // dX = Captain if has at least X goods
      const total = GOODS.reduce((s, g) => s + player.goods[g], 0);
      return total >= lvl;
    }
    case "p": {
      // pX = Prospector if X gold
      return lvl <= 1;
    }
    case "g": {
      // gX = take best cash option if at least X gold available
      // approximate: take 1 (always at least 1 from role bonus or prospector)
      return lvl <= 1;
    }
    default:
      return false;
  }
}

// ============================================================
// 选种植园（基于 DNA）
// ============================================================
const PLANT_CHAR = { "1": "corn", "2": "indigo", "3": "sugar", "4": "tobacco", "5": "coffee", "6": "quarry" };

function dnaPickPlantation(player, options, isChooser) {
  if (!player._dna) return null;
  const phase = detectPhase(player._dna.triggers, {
    colonistsLeft: G.colonistsLeft, vpLeft: G.vpLeft, minSpaces: calcMinSpaces()
  });
  const order = phase === 1 ? player._dna.plantEarly : phase === 2 ? player._dna.plantMid : player._dna.plantLate;
  // order is 9 chars, walking left-to-right
  for (const ch of order) {
    if (ch === "1" || ch === "2" || ch === "3" || ch === "4" || ch === "5") {
      const g = PLANT_CHAR[ch];
      const idx = options.findIndex(o => o.kind === "plant" && o.good === g);
      if (idx >= 0) return idx;
    } else if (ch === "6") {
      // quarry
      const idx = options.findIndex(o => o.kind === "quarry");
      if (idx >= 0) return idx;
    } else if (ch === "d") {
      // different from owned
      const owned = new Set(player.plantations.map(pl => pl.good));
      const idx = options.findIndex(o => o.kind === "plant" && !owned.has(o.good));
      if (idx >= 0) return idx;
    } else if (ch === "s" || ch === "f" || ch === "u" || ch === "j") {
      // s=有生产空间, f=任意, u=未填生产, j=任意
      const idx = options.findIndex(o => o.kind === "plant");
      if (idx >= 0) return idx;
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
