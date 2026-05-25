// ============================================================
// 波多黎各 Puerto Rico — 完整规则实现
// 基于 Tony Mitton 的 PuertoRicoEvolver 1.52 (VBA) + Rio Grande 原版规则书
// ============================================================

// ---- 静态数据 ----
const GOODS = ["corn", "indigo", "sugar", "tobacco", "coffee"];
const GOOD_NAMES = { corn: "玉米", indigo: "靛蓝", sugar: "蔗糖", tobacco: "烟草", coffee: "咖啡" };
const GOOD_PRICE = { corn: 0, indigo: 1, sugar: 2, tobacco: 3, coffee: 4 };

// 角色：Mayor 在原 VBA 是 role 1，原版规则的角色顺序为
// Settler, Mayor, Builder, Craftsman, Trader, Captain, Prospector
const ROLE_LIST = ["Settler", "Mayor", "Builder", "Craftsman", "Trader", "Captain", "Prospector"];
const ROLE_BONUS = {
  Settler: "可拿1种植园（首选可拿采石场）",
  Mayor: "拿殖民者：船+岛上+1人",
  Builder: "建造1栋建筑，比成本-1金币",
  Craftsman: "生产货物，可额外取1货",
  Trader: "卖1种货物到贸易站，+1金币",
  Captain: "运货物，每运1货=1胜利点",
  Prospector: "拿1金币",
};
const ROLE_NAME_CN = {
  Settler: "拓殖者", Mayor: "市长", Builder: "建造师",
  Craftsman: "工匠", Trader: "商人", Captain: "船长", Prospector: "金矿主"
};

// 5 级 AI 难度（基于实测胜率从弱到强）
const AI_LEVEL_NAMES = {
  1: { cn: "入门", en: "Beginner", desc: "只看自己面板" },
  2: { cn: "进化", en: "DNA",      desc: "700代进化AI" },
  3: { cn: "普通", en: "Normal",   desc: "看邻座+流派" },
  4: { cn: "困难", en: "Hard",     desc: "看全场+智能覆盖" },
  5: { cn: "专家", en: "Expert",   desc: "针对领先者+前瞻" },
};

// 23 建筑（来自 VBA Initial_Setup）
// id, name(中), 类型, 成本, 容人数, 胜利点, 占地, 是否大型, 数量
// type: production | violet | large_violet
const BUILDINGS = [
  // 生产建筑
  { id: 1,  name: "小靛蓝厂",    cn: "小靛蓝厂",    img: "01_small_indigo.png",    type: "production", cost: 1,  men: 1, vp: 1, size: 1, qty: 4, good: "indigo" },
  { id: 2,  name: "小制糖厂",    cn: "小制糖厂",    img: "02_small_sugar.png",     type: "production", cost: 2,  men: 1, vp: 1, size: 1, qty: 4, good: "sugar" },
  { id: 3,  name: "大靛蓝厂",    cn: "大靛蓝厂",    img: "03_large_indigo.png",    type: "production", cost: 3,  men: 3, vp: 2, size: 1, qty: 3, good: "indigo" },
  { id: 4,  name: "大制糖厂",    cn: "大制糖厂",    img: "04_large_sugar.png",     type: "production", cost: 4,  men: 3, vp: 2, size: 1, qty: 3, good: "sugar" },
  { id: 5,  name: "烟草仓库",    cn: "烟草仓库",    img: "05_tobacco_storage.png", type: "production", cost: 5,  men: 3, vp: 3, size: 1, qty: 3, good: "tobacco" },
  { id: 6,  name: "咖啡烘焙厂",  cn: "咖啡烘焙厂",  img: "06_coffee_roaster.png",  type: "production", cost: 6,  men: 2, vp: 3, size: 1, qty: 3, good: "coffee" },
  // 紫色小建筑
  { id: 7,  name: "小市场",      cn: "小市场",      img: "07_small_market.png",    type: "violet", cost: 1, men: 1, vp: 1, size: 1, qty: 2, effect: "trader_plus_1" },
  { id: 8,  name: "庄园",        cn: "庄园",        img: "08_hacienda.png",        type: "violet", cost: 2, men: 1, vp: 1, size: 1, qty: 2, effect: "settler_extra_plantation" },
  { id: 9,  name: "建筑工地",    cn: "建筑工地",    img: "09_construction_hut.png",type: "violet", cost: 2, men: 1, vp: 1, size: 1, qty: 2, effect: "settler_can_take_quarry" },
  { id: 10, name: "小仓库",      cn: "小仓库",      img: "10_small_warehouse.png", type: "violet", cost: 3, men: 1, vp: 1, size: 1, qty: 2, effect: "store_1_kind" },
  { id: 11, name: "济贫院",      cn: "济贫院",      img: "11_hospice.png",         type: "violet", cost: 4, men: 1, vp: 2, size: 1, qty: 2, effect: "settler_man_new_plantation" },
  { id: 12, name: "办公室",      cn: "办公室",      img: "12_office.png",          type: "violet", cost: 5, men: 1, vp: 2, size: 1, qty: 2, effect: "trader_duplicate" },
  { id: 13, name: "大市场",      cn: "大市场",      img: "13_large_market.png",    type: "violet", cost: 5, men: 1, vp: 2, size: 1, qty: 2, effect: "trader_plus_2" },
  { id: 14, name: "大仓库",      cn: "大仓库",      img: "14_large_warehouse.png", type: "violet", cost: 6, men: 1, vp: 2, size: 1, qty: 2, effect: "store_2_kinds" },
  { id: 15, name: "工厂",        cn: "工厂",        img: "15_factory.png",         type: "violet", cost: 7, men: 1, vp: 3, size: 1, qty: 2, effect: "craftsman_bonus" },
  { id: 16, name: "大学",        cn: "大学",        img: "16_university.png",      type: "violet", cost: 8, men: 1, vp: 3, size: 1, qty: 2, effect: "builder_extra_colonist" },
  { id: 17, name: "港口",        cn: "港口",        img: "17_harbour.png",         type: "violet", cost: 8, men: 1, vp: 3, size: 1, qty: 2, effect: "captain_bonus_vp" },
  { id: 18, name: "码头",        cn: "码头",        img: "18_wharf.png",           type: "violet", cost: 9, men: 1, vp: 3, size: 1, qty: 2, effect: "personal_ship" },
  // 紫色大建筑（4VP，占2格）
  { id: 19, name: "公会大厅",    cn: "公会大厅",    img: "19_guild_hall.png",      type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "guild_hall" },
  { id: 20, name: "官邸",        cn: "官邸",        img: "20_residence.png",       type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "residence" },
  { id: 21, name: "城堡",        cn: "城堡",        img: "21_fortress.png",        type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "fortress" },
  { id: 22, name: "海关大楼",    cn: "海关大楼",    img: "22_customs_house.png",   type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "customs" },
  { id: 23, name: "市政厅",      cn: "市政厅",      img: "23_city_hall.png",       type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "city_hall" },
];
const BLD_BY_ID = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));

const RULES_TEXT = `
<h3>游戏目标</h3>
<p>积累最多胜利点 (VP) 获胜。VP 来自：装船运货、建筑基础分、特殊大建筑结算。</p>

<h3>每回合</h3>
<ol>
<li>总督依次选择一个角色卡（其他玩家随后跟随做该角色动作，但只有选择者享受奖励）</li>
<li>所有角色卡执行完后，本回合结束，未被选的角色卡每张+1金币，总督顺位顺时针推进</li>
</ol>

<h3>7 个角色</h3>
<ul>
<li><b>拓殖者</b>：每人从池中拿1张种植园（选择者也可拿采石场）</li>
<li><b>市长</b>：补充殖民者到船 → 选择者+1 → 依顺序每人拿走船上殖民者并放到自己板上</li>
<li><b>建造师</b>：每人可建造1栋建筑（选择者-1金币）</li>
<li><b>工匠</b>：所有生产建筑生产货物（满人&有种植园），选择者额外取1个</li>
<li><b>商人</b>：每人可卖1种货物到贸易站，选择者+1金币</li>
<li><b>船长</b>：依次装船，每运1货=1VP，选择者全程+1VP；之后只保留1货，其余丢失</li>
<li><b>金矿主</b>：选择者+1金币，其他人无动作</li>
</ul>

<h3>结束条件</h3>
<p>触发任一即可：① 殖民者用尽 ② 任一玩家建满 12 格 ③ VP 用尽。游戏继续到本轮结束。</p>

<h3>大建筑结算（需有人镇守）</h3>
<ul>
<li>公会大厅: 每小生产建筑+1，大生产建筑+2</li>
<li>官邸: 占有种植园 ≤9→4VP, 10→5, 11→6, 12→7</li>
<li>城堡: 每3个殖民者+1VP（含建筑+种植园上的）</li>
<li>海关大楼: 每4个船运VP+1VP</li>
<li>市政厅: 每个紫色建筑+1VP</li>
</ul>
`;

document.getElementById("rules-text").innerHTML = RULES_TEXT;

// ============================================================
// 游戏状态
// ============================================================
class Game {
  constructor(numPlayers, humanName) {
    this.numPlayers = numPlayers;
    this.players = [];
    for (let i = 0; i < numPlayers; i++) {
      this.players.push(this.newPlayer(i, i === 0 ? humanName : `电脑P${i}`, i === 0));
    }
    this.governor = 0;
    this.currentRoleIdx = -1;
    this.turnNumber = 1;
    this.gameOver = false;
    this.endTriggered = false;

    // 资源池
    this.colonistsLeft = { 3: 55, 4: 75, 5: 95 }[numPlayers] - numPlayers; // 减去船上人数
    this.colonistsOnShip = numPlayers;
    this.vpLeft = { 3: 75, 4: 100, 5: 122 }[numPlayers];

    // 货物供应
    this.supply = { corn: 10, indigo: 11, sugar: 11, tobacco: 9, coffee: 9 };

    // 建筑供应
    this.buildingStock = {};
    BUILDINGS.forEach(b => this.buildingStock[b.id] = b.qty);

    // 种植园
    this.quarriesLeft = 8;
    this.plantationDeck = this.makePlantationDeck();
    this.plantationDiscard = [];
    this.plantationPool = [];

    // 船：3 / 4 / 5 玩家时船容量为 4/5/6, 5/6/7, 6/7/8
    this.ships = [];
    for (let i = 0; i < 3; i++) {
      this.ships.push({ capacity: numPlayers + 1 + i, good: null, count: 0 });
    }
    // 贸易站
    this.tradingHouse = []; // 上限 4

    // 角色卡
    this.roleCount = numPlayers + 3; // 3p=6, 4p=7, 5p=8
    this.roles = ROLE_LIST.slice(0, this.roleCount - (this.roleCount > 7 ? 0 : 0));
    // role obj: { name, money, taken }
    // Prospector 重复一次以达到 8 个 (5玩家)
    const usedNames = ROLE_LIST.slice();
    if (this.roleCount === 8) usedNames.push("Prospector");
    this.roleCards = usedNames.slice(0, this.roleCount).map(n => ({ name: n, money: 0, taken: false, takenBy: null }));

    // 起始首页朝上的种植园数 = 玩家+1
    this.flipPlantations();

    // 起始种植园：
    // 3p: P1=Indigo, P2=Indigo, P3=Corn
    // 4p: P1=I, P2=I, P3=Corn, P4=Corn
    // 5p: P1=I, P2=I, P3=I, P4=C, P5=C
    const startingPlant = {
      3: ["indigo", "indigo", "corn"],
      4: ["indigo", "indigo", "corn", "corn"],
      5: ["indigo", "indigo", "indigo", "corn", "corn"],
    }[numPlayers];
    for (let i = 0; i < numPlayers; i++) {
      this.players[i].plantations.push({ good: startingPlant[i], manned: false });
    }

    // 起始金币：玩家数-1
    for (let p of this.players) p.money = numPlayers - 1;

    this.log = [];
    this.logEvent(`游戏开始：${numPlayers} 玩家`);
  }

  newPlayer(idx, name, isHuman) {
    const p = {
      idx, name, isHuman,
      money: 0, vp: 0,
      shippingVP: 0,         // 来自船运的 VP，海关大楼用
      plantations: [],       // {good, manned}
      buildings: [],         // {bid, men}
      goods: { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 },
      buildingSpaceLeft: 12, // 板上总格
    };
    // 给电脑分配 DNA（来自进化好的 AI 池）
    if (!isHuman && typeof pickDNAForPlayer === "function") {
      const r = pickDNAForPlayer(p);
      if (r) {
        p._dna = splitDNA(r.dna);
        p._dnaMeta = r.meta;
        p.name = `电脑${r.meta.name}`;
      }
    }
    return p;
  }

  makePlantationDeck() {
    // 3p: 9c+10i+11s+9t+8co, 4p: 8c+10i+11s+9t+8co, 5p: 8c+9i+11s+9t+8co
    // (近似实现 VBA 中的字符串)
    const counts = {
      3: { corn: 9, indigo: 10, sugar: 11, tobacco: 9, coffee: 8 },
      4: { corn: 8, indigo: 10, sugar: 11, tobacco: 9, coffee: 8 },
      5: { corn: 8, indigo: 9, sugar: 11, tobacco: 9, coffee: 8 },
    }[this.numPlayers];
    const deck = [];
    for (const g of GOODS) for (let i = 0; i < counts[g]; i++) deck.push(g);
    // shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  flipPlantations() {
    const target = this.numPlayers + 1;
    while (this.plantationPool.length < target) {
      // FIX #26: 牌堆耗尽时洗弃牌堆形成新牌堆
      if (this.plantationDeck.length === 0) {
        if (this.plantationDiscard.length === 0) break; // 真正耗尽
        // shuffle discard into new deck
        const shuffled = this.plantationDiscard.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        this.plantationDeck = shuffled;
        this.plantationDiscard = [];
        this.logEvent(`种植园牌堆耗尽，洗弃牌堆作新牌堆 (${this.plantationDeck.length} 张)`, "action");
      }
      this.plantationPool.push(this.plantationDeck.pop());
    }
  }

  logEvent(msg, cls = "") {
    this.log.unshift({ msg, cls });
    if (this.log.length > 200) this.log.pop();
  }

  // ---- 玩家能力查询 ----
  ownsBuilding(p, bid) {
    return p.buildings.find(b => b.bid === bid);
  }
  isManned(p, bid) {
    const b = this.ownsBuilding(p, bid);
    return b && b.men >= BLD_BY_ID[bid].men;
  }
  totalColonists(p) {
    let n = 0;
    for (const pl of p.plantations) if (pl.manned) n++;
    for (const b of p.buildings) n += b.men;
    n += (p._unplacedMen || 0); // 岸边的也算（用于 Fortress 计分）
    return n;
  }
  buildingUsedSpaces(p) {
    let s = 0;
    for (const b of p.buildings) s += BLD_BY_ID[b.bid].size;
    return s;
  }
  totalPlantations(p) { return p.plantations.length; }

  // 生产能力：当前一回合能产多少 g 种货物
  productionCapacity(p, good) {
    if (good === "corn") {
      let c = 0;
      for (const pl of p.plantations)
        if (pl.good === "corn" && pl.manned) c++;
      return c;
    }
    // 其他需要种植园+加工建筑（按对应bid）
    const refining = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] }[good];
    let plantsManned = 0;
    for (const pl of p.plantations)
      if (pl.good === good && pl.manned) plantsManned++;
    let factoryCapacity = 0;
    for (const bid of refining) {
      const bb = this.ownsBuilding(p, bid);
      if (bb) factoryCapacity += bb.men;
    }
    return Math.min(plantsManned, factoryCapacity);
  }

  // 仓库容量（船长阶段后保留货物用）：
  // FIX: 默认只能留 1 个货物（任意1种1个），小仓库 +1 种满量，大仓库 +2 种满量。
  // 返回 {warehouseKinds: N种满量, extraSingle: 1} 即保留 N 种 + 1 个其他
  storageKinds(p) {
    let kinds = 0;
    if (this.isManned(p, 10)) kinds += 1; // small warehouse
    if (this.isManned(p, 14)) kinds += 2; // large warehouse
    return kinds;
  }

  // 折扣（采石场，依建筑费用区间）
  effectiveCost(p, bld) {
    // 在 Builder 阶段拿采石场折扣：每个有人的采石场 -1，上限 = bld.size→max quarries
    // 来自 VBA: building (1,4)..(23,4) - max quarries
    const maxQuarries = {1:1,2:1,3:2,4:2,5:3,6:3,7:1,8:1,9:1,10:1,11:2,12:2,13:2,14:2,15:3,16:3,17:3,18:3,19:4,20:4,21:4,22:4,23:4}[bld.id];
    let qManned = 0;
    for (const pl of p.plantations) if (pl.good === "quarry" && pl.manned) qManned++;
    return Math.max(0, bld.cost - Math.min(qManned, maxQuarries));
  }

  // 玩家可用的"小奖励金"：当前选角色的玩家在 Builder 阶段额外 -1
  effectiveCostWithRoleBonus(p, bld, isRoleChooser) {
    let c = this.effectiveCost(p, bld);
    if (isRoleChooser) c = Math.max(0, c - 1);
    return c;
  }
}

// ============================================================
// 全局游戏对象 + 流程引擎
// ============================================================
let G = null;
let pendingResolver = null; // 当 UI 在等待人玩家选择时的 promise resolver

// 通用睡眠工具（用于 AI 节奏）
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 装载 DNA 到玩家
function loadDNA(p, idx) {
  const pool = AI_POOL && AI_POOL["P" + Math.min(idx + 1, 5)];
  const meta = pool && pool[idx % Math.min(5, pool.length)];
  if (meta) {
    p._dna = splitDNA(joinDNA(meta.dna));
    p._dnaMeta = meta;
  }
}

// 全 AI 对战测试 helper
// highLvl: 1 个测试 AI 等级; lowLvl: 3 个对手等级
async function runBattle(highLvl, lowLvl, games = 8, maxMs = 3500) {
  const wins = {high: 0, low: 0, draws: 0};
  const totalScore = {high: 0, low: 0};
  let actualGames = 0;
  for (let i = 0; i < games; i++) {
    document.getElementById('player-count').value = '4';
    document.getElementById('all-ai').checked = true;
    document.getElementById('ai-level').value = String(lowLvl);
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('btn-start').click();
    // 给所有玩家配 DNA（不论等级；用到时再激活）
    G.players.forEach((p, idx) => loadDNA(p, idx));
    // 设置 lowLvl 给所有玩家
    G.players.forEach(p => { p._aiLevel = lowLvl; });
    // 测试 AI 放在第 i % 4 座
    const seat = i % 4;
    G.players[seat]._aiLevel = highLvl;
    G.players[seat].name = `H${highLvl}-s${seat}`;
    const t0 = Date.now();
    while (!G.gameOver && Date.now() - t0 < maxMs) await sleep(30);
    if (!G.gameOver) continue;
    actualGames++;
    const scored = G.players.map(p => ({lvl: p._aiLevel, total: p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp, 0) + G.getSpecialVPs(p)}));
    scored.sort((a,b) => b.total - a.total);
    if (scored[0].lvl === highLvl) wins.high++;
    else wins.low++;
    // 平均分按等级
    for (const s of scored) {
      if (s.lvl === highLvl) totalScore.high += s.total;
      else totalScore.low += s.total / 3; // 3 个 lowLvl 玩家平均
    }
  }
  return {
    matchup: `L${highLvl} vs 3×L${lowLvl}`,
    games: actualGames,
    highWins: wins.high,
    lowWins: wins.low,
    winrate: actualGames > 0 ? (wins.high / actualGames * 100).toFixed(0) + '%' : 'n/a',
    avgScoreHigh: actualGames > 0 ? (totalScore.high / actualGames).toFixed(1) : 'n/a',
    avgScoreLow: actualGames > 0 ? (totalScore.low / actualGames).toFixed(1) : 'n/a'
  };
}
window.runBattle = runBattle;

// FLIP 飞行动画：把源元素从当前位置克隆飞到目标元素位置（不阻塞主循环）
function flyToDest(source, destFn, duration = 450) {
  // 全 AI 测试模式跳过动画
  if (window._allAIMode || !source) {
    render();
    return;
  }
  // 清理可能残留的 ghost
  document.querySelectorAll(".fly-ghost").forEach(g => g.remove());
  const srcRect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.className = (ghost.className || "") + " fly-ghost";
  ghost.style.cssText = `position:fixed; left:${srcRect.left}px; top:${srcRect.top}px;
    width:${srcRect.width}px; height:${srcRect.height}px; margin:0; z-index:9999;
    pointer-events:none; transition:all ${duration}ms cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow:0 8px 24px rgba(0,0,0,0.5); animation:none;`;
  document.body.appendChild(ghost);
  render();
  setTimeout(() => {
    const destEl = destFn();
    if (!destEl) { ghost.remove(); return; }
    const destRect = destEl.getBoundingClientRect();
    ghost.style.left = destRect.left + "px";
    ghost.style.top = destRect.top + "px";
    ghost.style.width = destRect.width + "px";
    ghost.style.height = destRect.height + "px";
    destEl.style.visibility = "hidden";
    setTimeout(() => {
      destEl.style.visibility = "";
      ghost.remove();
    }, duration);
    // 兜底：1秒后强制清理
    setTimeout(() => ghost.remove(), duration + 1500);
  }, 30);
}

function startGame() {
  const n = parseInt(document.getElementById("player-count").value);
  const name = document.getElementById("player-name").value || "玩家";
  const allAI = document.getElementById("all-ai")?.checked;
  G = new Game(n, name);
  // 读取每个 CPU 的独立难度
  G.players.forEach((p, i) => {
    // 装备 DNA（不论用不用，都给一个）
    loadDNA(p, i);
    if (allAI || i > 0) {
      p.isHuman = false;
      // 单 CPU 难度从 #cpu-level-i 读取
      const sel = document.getElementById(`cpu-level-${i}`);
      const lvl = sel ? parseInt(sel.value) : 4;
      p._aiLevel = lvl;
      const nameMeta = AI_LEVEL_NAMES[lvl] || AI_LEVEL_NAMES[3];
      p.name = `CPU${i + 1}·${nameMeta.cn}`;
    }
  });
  window._allAIMode = !!allAI;
  document.getElementById("setup-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  render();
  runMainLoop();
}

// 动态渲染每个 CPU 的难度下拉
function renderCpuLevels() {
  const np = parseInt(document.getElementById("player-count").value);
  const allAI = document.getElementById("all-ai")?.checked;
  const container = document.getElementById("cpu-levels");
  if (!container) return;
  container.innerHTML = "";
  const startIdx = allAI ? 0 : 1; // 全 AI 时第 0 个也是 CPU
  for (let i = startIdx; i < np; i++) {
    const wrap = document.createElement("label");
    wrap.className = "cpu-row";
    // 默认值：依玩家数和位置选 — 后面 CPU 默认更强
    const defaultLvl = (i === np - 1) ? 5 : (i === np - 2) ? 4 : (i === 1) ? 2 : 3;
    wrap.innerHTML = `
      <span>CPU ${i + 1}：</span>
      <select id="cpu-level-${i}" class="cpu-level-sel">
        ${Object.entries(AI_LEVEL_NAMES).map(([lvl, meta]) =>
          `<option value="${lvl}" ${parseInt(lvl) === defaultLvl ? 'selected' : ''}>L${lvl} ${meta.cn} · ${meta.desc}</option>`).join("")}
      </select>
    `;
    container.appendChild(wrap);
  }
}
document.getElementById("player-count").addEventListener("change", renderCpuLevels);
document.getElementById("all-ai")?.addEventListener("change", renderCpuLevels);
// 快速设定按钮
document.querySelectorAll(".qs-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const set = btn.dataset.set;
    document.querySelectorAll(".cpu-level-sel").forEach((sel, idx) => {
      if (set === "all1") sel.value = "1";
      else if (set === "all3") sel.value = "3";
      else if (set === "all5") sel.value = "5";
      else if (set === "mixed") {
        // 混合：依次 1,2,3,4,5 循环
        sel.value = String((idx % 5) + 1);
      }
    });
  });
});
// 初次渲染
renderCpuLevels();

document.getElementById("btn-start").onclick = startGame;
document.getElementById("btn-restart").onclick = () => location.reload();
document.getElementById("btn-show-rules").onclick = () => {
  showModal("游戏规则", RULES_TEXT, [{ label: "关闭", fn: hideModal }]);
};

// ============================================================
// 主循环（async 形式）
// ============================================================
async function runMainLoop() {
  while (!G.gameOver) {
    G.logEvent(`=== 第 ${G.turnNumber} 回合 — 总督: ${G.players[G.governor].name} ===`, "role");

    // 重置 role taken
    for (const r of G.roleCards) { r.taken = false; r.takenBy = null; }

    // 角色轮转：从 governor 开始
    for (let step = 0; step < G.numPlayers; step++) {
      if (G.gameOver) break;
      const playerIdx = (G.governor + step) % G.numPlayers;
      const player = G.players[playerIdx];

      // 该玩家选择一张未被选的角色卡
      const available = G.roleCards.filter(r => !r.taken);
      if (available.length === 0) break;
      G._currentPlayer = playerIdx; // 在选择前设置当前玩家
      render();
      let chosenIdx;
      if (player.isHuman) {
        chosenIdx = await humanPickRole(available);
      } else {
        // 仅在有人类玩家时延时（给人类看清节奏）；全 AI 测试模式立即执行
        if (!window._allAIMode) await sleep(450);
        chosenIdx = aiPickRole(player, available);
      }
      const chosen = available[chosenIdx];
      chosen.taken = true;
      chosen.takenBy = playerIdx;
      const bonusMoney = chosen.money;
      chosen.money = 0;
      player.money += bonusMoney;
      G.logEvent(`${player.name} 选择 [${ROLE_NAME_CN[chosen.name]}]${bonusMoney ? ` +${bonusMoney}金` : ""}`, "role");
      G._currentPrompt = `阶段：${ROLE_NAME_CN[chosen.name]}（由 ${player.name} 选择${bonusMoney ? `，+${bonusMoney}金` : ""}）`;
      G._currentPlayer = playerIdx;
      render();

      // 执行角色
      await runRolePhase(chosen.name, playerIdx);
      G._currentPrompt = null;

      // 检查游戏结束
      checkEndCondition();
      render();
    }

    // 回合结束：未被选的角色卡 +1 金
    for (const r of G.roleCards) {
      if (!r.taken) r.money += 1;
    }

    if (G.endTriggered) {
      G.gameOver = true;
      break;
    }

    G.governor = (G.governor + 1) % G.numPlayers;
    G.turnNumber++;
    G.flipPlantations();
  }

  await endGame();
}

function checkEndCondition() {
  if (G.colonistsLeft <= 0 && G.colonistsOnShip <= 0) G.endTriggered = true;
  if (G.vpLeft <= 0) G.endTriggered = true;
  for (const p of G.players) {
    if (G.buildingUsedSpaces(p) >= 12) G.endTriggered = true;
  }
}

async function runRolePhase(roleName, chooserIdx) {
  // 顺时针从 chooser 开始
  const order = [];
  for (let i = 0; i < G.numPlayers; i++) {
    order.push((chooserIdx + i) % G.numPlayers);
  }
  switch (roleName) {
    case "Settler":
      for (const i of order) await doSettler(i, i === chooserIdx);
      // FIX: 拓殖者阶段结束后，所有未被选的种植园全部弃掉，下回合重新翻
      if (G.plantationPool.length > 0) {
        G.plantationDiscard = G.plantationDiscard.concat(G.plantationPool);
        G.logEvent(`弃掉 ${G.plantationPool.length} 张未选的种植园`, "action");
        G.plantationPool = [];
      }
      break;
    case "Mayor":     await doMayor(chooserIdx, order); break;
    case "Builder":   for (const i of order) await doBuilder(i, i === chooserIdx); break;
    case "Craftsman": await doCraftsman(chooserIdx, order); break;
    case "Trader":
      for (const i of order) await doTrader(i, i === chooserIdx);
      // FIX #32: 阶段末作为 trader 的最后职责，若贸易站满则清空到供应区
      if (G.tradingHouse.length >= 4) {
        for (const g of G.tradingHouse) G.supply[g]++;
        G.logEvent(`贸易站已满，${G.tradingHouse.length} 个货物归还供应区`, "action");
        G.tradingHouse = [];
      }
      break;
    case "Captain":   await doCaptain(order, chooserIdx); break;
    case "Prospector":
      G.players[chooserIdx].money += 1;
      G.logEvent(`${G.players[chooserIdx].name} 拿 1 金币`, "action");
      break;
  }
}

// ============================================================
// 角色阶段实现
// ============================================================
async function doSettler(playerIdx, isChooser) {
  const p = G.players[playerIdx];
  if (p.plantations.length >= 12) return; // 满
  const hasConstructionHut = G.isManned(p, 9);
  // 选项：池中种植园 + 可选采石场（chooser 或 有 construction hut）
  const options = [];
  for (let i = 0; i < G.plantationPool.length; i++) {
    options.push({ kind: "plant", good: G.plantationPool[i], idx: i });
  }
  if (G.quarriesLeft > 0 && (isChooser || hasConstructionHut)) {
    options.push({ kind: "quarry" });
  }
  if (options.length === 0) return;
  let pickIdx;
  if (p.isHuman) {
    pickIdx = await humanBoardSelect({
      type: "plantation",
      choices: options.map((o, i) => ({ key: i, opt: o })),
      promptText: `${p.name} 拓殖：点击种植园池中的一张${(isChooser || hasConstructionHut) ? "（或采石场）" : ""}`,
      allowSkip: true,
    });
    if (pickIdx === null) return;
  } else {
    pickIdx = aiPickPlantation(p, options, isChooser);
  }
  const choice = options[pickIdx];
  // 🎬 动画：保存源元素引用（mutation 前）
  let sourceEl = null;
  if (choice.kind === "quarry") {
    sourceEl = document.querySelector('#plantations-pool [data-pool-quarry]');
  } else {
    sourceEl = document.querySelector(`#plantations-pool [data-pool-idx="${choice.idx}"]`);
  }
  let plantation;
  if (choice.kind === "quarry") {
    G.quarriesLeft--;
    plantation = { good: "quarry", manned: false };
  } else {
    plantation = { good: choice.good, manned: false };
    G.plantationPool.splice(choice.idx, 1);
  }
  p.plantations.push(plantation);
  const newIdx = p.plantations.length - 1;
  // 🎬 触发动画（非阻塞）
  flyToDest(sourceEl, () =>
    document.querySelector(`.player-board[data-player="${playerIdx}"] .plantation-grid .plantation:nth-child(${newIdx + 1})`)
  );
  // 等动画播放（全 AI 模式短一些）
  if (!window._allAIMode) await sleep(480);
  // 庄园 Hacienda 效果：拿种植园同时从牌堆拿一张额外
  if (G.isManned(p, 8) && p.plantations.length < 12 && G.plantationDeck.length > 0) {
    const extra = G.plantationDeck.pop();
    p.plantations.push({ good: extra, manned: false });
    G.logEvent(`${p.name} 庄园效果：+${GOOD_NAMES[extra]}`, "action");
  }
  // 济贫院 Hospice 效果：新种植园上+1人。优先从供应区，没有则从船上。
  if (G.isManned(p, 11)) {
    if (G.colonistsLeft > 0) {
      plantation.manned = true;
      G.colonistsLeft--;
      G.logEvent(`${p.name} 济贫院效果：殖民者上岗 (从供应区)`, "action");
    } else if (G.colonistsOnShip > 0) {
      plantation.manned = true;
      G.colonistsOnShip--;
      G.logEvent(`${p.name} 济贫院效果：殖民者上岗 (从船上)`, "action");
    }
  }
  G.logEvent(`${p.name} 拓殖：${choice.kind === "quarry" ? "🪨采石场" : plantEmoji(choice.good) + GOOD_NAMES[choice.good]}`, "action");
}

async function doMayor(chooserIdx, order) {
  // FIX: chooser 的奖励殖民者来自总供应区（colonistsLeft），不是船上
  if (G.colonistsLeft > 0) {
    const p = G.players[chooserIdx];
    G.colonistsLeft--;
    p._unplacedMen = (p._unplacedMen || 0) + 1;
    G.logEvent(`${p.name} 市长特权：从供应区+1殖民者`, "action");
  }
  // FIX: 船上的殖民者按顺时针轮转分配 (每次1人) 直到船空
  let safety = 0;
  while (G.colonistsOnShip > 0 && safety++ < 100) {
    for (const i of order) {
      if (G.colonistsOnShip <= 0) break;
      const p = G.players[i];
      p._unplacedMen = (p._unplacedMen || 0) + 1;
      G.colonistsOnShip--;
    }
  }
  // FIX #30 & #31: 先让玩家分配（强制满岗），再补船
  for (const i of order) {
    const p = G.players[i];
    if (!p._unplacedMen) continue;
    if (p.isHuman) {
      await humanReallocate(p);
    } else {
      aiReallocate(p);
    }
    // 不归零 _unplacedMen，让放不下的"留在岸边"
  }
  // 现在再算补船：补船数 = 所有玩家分配后建筑物未占据的空格之总和
  let openBuildingSlots = 0;
  for (const p of G.players) {
    for (const b of p.buildings) openBuildingSlots += (BLD_BY_ID[b.bid].men - b.men);
  }
  const refill = Math.max(G.numPlayers, openBuildingSlots);
  // 游戏结束条件：供应不足以补满船 → 本回合结束后游戏结束
  if (G.colonistsLeft < refill) {
    G.endTriggered = true;
    G.logEvent(`⚠ 供应殖民者不足（${G.colonistsLeft} < 需补 ${refill}），本回合后游戏结束`, "role");
  }
  const actualRefill = Math.min(refill, G.colonistsLeft);
  G.colonistsOnShip = actualRefill;
  G.colonistsLeft -= actualRefill;
  G.logEvent(`市长阶段结束，已分配并补船 ${actualRefill} 人`, "action");
}

async function humanReallocate(p) {
  // FIX #31 + #33: 必须填满所有空位（如果有）；允许先"拿下"已上岗的殖民者到岸边重分配
  let remaining = p._unplacedMen;

  // 第一阶段：允许玩家拿下已有的殖民者（可选）
  while (true) {
    const occupied = [];
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (b.men > 0) {
        occupied.push({ kind: "rm_building", bid: b.bid, label: `拿下 ${bd.cn} (${b.men}/${bd.men})` });
      }
    }
    for (let i = 0; i < p.plantations.length; i++) {
      const pl = p.plantations[i];
      if (pl.manned) {
        occupied.push({ kind: "rm_plant", idx: i, label: `拿下 ${pl.good === "quarry" ? "🪨" : plantEmoji(pl.good)} ${pl.good === "quarry" ? "采石场" : GOOD_NAMES[pl.good]}` });
      }
    }
    if (occupied.length === 0) break;
    occupied.unshift({ kind: "done_picking", label: "✓ 完成拿下，开始放置" });
    const idx = await humanPickFromList(
      `市长阶段：可拿下已上岗的殖民者重分配（当前岸边 ${remaining} 人）`,
      occupied.map(o => o.label), false
    );
    const choice = occupied[idx];
    if (choice.kind === "done_picking") break;
    if (choice.kind === "rm_building") {
      const b = p.buildings.find(bb => bb.bid === choice.bid);
      b.men--;
      remaining++;
    } else if (choice.kind === "rm_plant") {
      p.plantations[choice.idx].manned = false;
      remaining++;
    }
  }

  // 第二阶段：放置（必须填满）
  while (remaining > 0) {
    const slots = [];
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (b.men < bd.men) slots.push({ kind: "building", bid: b.bid, label: `${bd.cn} (${b.men}/${bd.men})` });
    }
    for (let i = 0; i < p.plantations.length; i++) {
      const pl = p.plantations[i];
      if (!pl.manned) slots.push({ kind: "plant", idx: i, label: (pl.good === "quarry" ? "🪨" : plantEmoji(pl.good)) + " " + (pl.good === "quarry" ? "采石场" : GOOD_NAMES[pl.good]) });
    }
    if (slots.length === 0) break;
    const idx = await humanPickFromList(`必须放置殖民者（剩余 ${remaining} 人，规则要求填满所有空位）`, slots.map(s => s.label), false);
    const choice = slots[idx];
    if (choice.kind === "building") {
      const b = p.buildings.find(bb => bb.bid === choice.bid);
      b.men++;
    } else {
      p.plantations[choice.idx].manned = true;
    }
    remaining--;
  }
  p._unplacedMen = remaining;
}

function aiReallocate(p) {
  // AI 简单策略：优先放产业链关键位置（生产建筑+种植园+紫色建筑）
  let remaining = p._unplacedMen;
  const updateAtEnd = () => { p._unplacedMen = remaining; };
  // 1) 先填生产建筑岗位（让产业能运行）
  const prio = [...p.buildings].sort((a, b) => {
    const ba = BLD_BY_ID[a.bid], bb = BLD_BY_ID[b.bid];
    // 大型生产 > 小型生产 > 大紫 > 紫
    const rank = bb => bb.type === "production" ? (bb.size === 1 && bb.men > 1 ? 1 : 2) : (bb.type === "large_violet" ? 3 : 4);
    return rank(ba) - rank(bb);
  });
  for (const b of prio) {
    const bd = BLD_BY_ID[b.bid];
    while (remaining > 0 && b.men < bd.men) {
      b.men++; remaining--;
    }
  }
  // 2) 再上种植园
  // 顺序：玉米、靛蓝、采石场、糖、烟、咖啡
  const plantOrder = ["corn", "indigo", "quarry", "sugar", "tobacco", "coffee"];
  for (const g of plantOrder) {
    for (const pl of p.plantations) {
      if (remaining <= 0) break;
      if (pl.good === g && !pl.manned) { pl.manned = true; remaining--; }
    }
  }
  // 3) 剩余的随便填空位
  for (const b of p.buildings) {
    const bd = BLD_BY_ID[b.bid];
    while (remaining > 0 && b.men < bd.men) { b.men++; remaining--; }
  }
  for (const pl of p.plantations) {
    if (remaining <= 0) break;
    if (!pl.manned) { pl.manned = true; remaining--; }
  }
  updateAtEnd(); // 把没放下的留在 _unplacedMen（"岸边"）
}

async function doBuilder(playerIdx, isChooser) {
  const p = G.players[playerIdx];
  if (G.buildingUsedSpaces(p) >= 12) return;
  // 列出可买且能负担的建筑
  const options = [];
  for (const b of BUILDINGS) {
    if (G.buildingStock[b.id] <= 0) continue;
    if (G.ownsBuilding(p, b.id)) continue; // 不能重复买
    if (12 - G.buildingUsedSpaces(p) < b.size) continue;
    const cost = G.effectiveCostWithRoleBonus(p, b, isChooser);
    if (p.money < cost) continue;
    options.push({ b, cost });
  }
  if (options.length === 0) return;
  let pickIdx;
  if (p.isHuman) {
    pickIdx = await humanBoardSelect({
      type: "building",
      choices: options.map((o, i) => ({ key: i, opt: o })),
      promptText: `${p.name} 建造：点击建筑市场中可购的建筑${isChooser ? "（你有-1金折扣）" : ""}`,
      allowSkip: true,
    });
    if (pickIdx === null) return;
  } else {
    pickIdx = aiPickBuilding(p, options, isChooser);
    if (pickIdx < 0) return;
  }
  const { b, cost } = options[pickIdx];
  // 🎬 动画：保存源元素引用
  const sourceEl = document.querySelector(`#buildings-pool [data-bid="${b.id}"]`);
  p.money -= cost;
  G.buildingStock[b.id]--;
  p.buildings.push({ bid: b.id, men: 0 });
  const newBldIdx = p.buildings.length - 1;
  flyToDest(sourceEl, () =>
    document.querySelector(`.player-board[data-player="${playerIdx}"] .building-grid .mini-building:nth-child(${newBldIdx + 1})`)
  , 500);
  if (!window._allAIMode) await sleep(520);
  // 大学：建造后+1殖民者直接上岗。优先从供应区取，没有则从船上取。
  if (G.isManned(p, 16)) {
    if (G.colonistsLeft > 0) {
      p.buildings[p.buildings.length - 1].men = Math.min(1, BLD_BY_ID[b.id].men);
      G.colonistsLeft--;
      G.logEvent(`${p.name} 大学效果：建筑直接上1人 (从供应区)`, "action");
    } else if (G.colonistsOnShip > 0) {
      p.buildings[p.buildings.length - 1].men = Math.min(1, BLD_BY_ID[b.id].men);
      G.colonistsOnShip--;
      G.logEvent(`${p.name} 大学效果：建筑直接上1人 (从船上)`, "action");
    }
  }
  G.logEvent(`${p.name} 建造 ${b.cn} (花费${cost}金)`, "action");
}

async function doCraftsman(chooserIdx, order) {
  // 生产阶段：每人按生产能力生产货物（受供应限制）
  const producedKinds = new Set(); // 全场实际生产了哪些货物
  const perPlayerProducedKinds = G.players.map(() => new Set()); // 每位玩家本回合生产的种类（工厂奖励用）
  for (const g of GOODS) {
    for (const i of order) {
      if (G.supply[g] <= 0) break;
      const p = G.players[i];
      let cap = G.productionCapacity(p, g);
      let producedThis = false;
      while (cap > 0 && G.supply[g] > 0) {
        p.goods[g]++;
        G.supply[g]--;
        cap--;
        producedKinds.add(g);
        producedThis = true;
      }
      if (producedThis) perPlayerProducedKinds[i].add(g);
    }
  }
  // FIX: Factory 工厂奖励 — 镇守工厂的玩家按本回合生产的种类拿金币
  // 2种=1金, 3种=2金, 4种=3金, 5种=5金
  const factoryBonus = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 };
  for (let i = 0; i < G.players.length; i++) {
    const p = G.players[i];
    if (G.isManned(p, 15)) { // 工厂
      const kinds = perPlayerProducedKinds[i].size;
      const bonus = factoryBonus[kinds] || 0;
      if (bonus > 0) {
        p.money += bonus;
        G.logEvent(`${p.name} 工厂奖励：${kinds}种货物+${bonus}金`, "action");
      }
    }
  }
  // chooser 额外取1个 — FIX: 仅限本回合刚生产出的种类
  const chooser = G.players[chooserIdx];
  const available = GOODS.filter(g => G.supply[g] > 0 && producedKinds.has(g));
  if (available.length > 0) {
    let g;
    if (chooser.isHuman) {
      const idx = await humanPickFromList("工匠奖励：选 1 种货物", available.map(g => GOOD_NAMES[g]), true);
      if (idx === null) { /* skip */ }
      else g = available[idx];
    } else {
      // AI 选最贵的
      g = available.reduce((a, b) => GOOD_PRICE[a] >= GOOD_PRICE[b] ? a : b);
    }
    if (g) {
      chooser.goods[g]++;
      G.supply[g]--;
      G.logEvent(`${chooser.name} 工匠奖励：+1 ${GOOD_NAMES[g]}`, "action");
    }
  }
  G.logEvent(`生产阶段结束`, "action");
}

async function doTrader(playerIdx, isChooser) {
  const p = G.players[playerIdx];
  if (G.tradingHouse.length >= 4) return;
  // 同一商品贸易站不能重复（除非有 Office）
  const hasOffice = G.isManned(p, 12);
  const sellable = GOODS.filter(g => p.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g)));
  if (sellable.length === 0) return;
  let g;
  if (p.isHuman) {
    const idx = await humanPickFromList("商人：选 1 种货物出售", sellable.map(g => `${GOOD_NAMES[g]} (+${GOOD_PRICE[g] + (isChooser ? 1 : 0)}金)`), true);
    if (idx === null) return;
    g = sellable[idx];
  } else {
    g = sellable.reduce((a, b) => GOOD_PRICE[a] >= GOOD_PRICE[b] ? a : b);
  }
  p.goods[g]--;
  G.tradingHouse.push(g);
  let earn = GOOD_PRICE[g];
  if (isChooser) earn += 1;
  if (G.isManned(p, 7)) earn += 1;   // 小市场
  if (G.isManned(p, 13)) earn += 2;  // 大市场
  p.money += earn;
  G.logEvent(`${p.name} 卖 ${GOOD_NAMES[g]} +${earn}金`, "action");
  // 贸易站满则清空
  if (G.tradingHouse.length === 4) {
    // 实际：贸易站需要在商人阶段开始检测，但简化处理
  }
}

async function doCaptain(order, chooserIdx) {
  // 装船阶段：循环，每人必须运（如果能运），直到无人能再装
  // FIX: chooser +1VP 总共一次（首次装船时），不是每次
  // FIX: Harbor +1VP 每次装船（不是只第一次）
  const chooserBonusUsed = new Set(); // 谁已经拿过 captain chooser 奖励了
  let progress = true;
  while (progress) {
    progress = false;
    for (const i of order) {
      const p = G.players[i];
      // 找出该玩家能装的货物 (有货 + 有匹配的船 OR 任意未装船的)
      const candidates = [];
      for (let s = 0; s < G.ships.length; s++) {
        const ship = G.ships[s];
        if (ship.count >= ship.capacity) continue;
        if (ship.good === null) {
          // 这艘船空，必须没有别的船在装同种货
          for (const g of GOODS) {
            if (p.goods[g] <= 0) continue;
            // 玩家不能装一种已经在别的船上的货物（除非那船满了？不，原版规则：每种货物只能在一艘船）
            const usedOnOther = G.ships.some((sh, idx) => idx !== s && sh.good === g);
            if (usedOnOther) continue;
            candidates.push({ ship: s, good: g, amount: Math.min(p.goods[g], ship.capacity - ship.count) });
          }
        } else {
          if (p.goods[ship.good] > 0) {
            candidates.push({ ship: s, good: ship.good, amount: Math.min(p.goods[ship.good], ship.capacity - ship.count) });
          }
        }
      }
      // 码头（Wharf）作为私人船 — 可装任意货物（含已经在货船上的种类）
      const hasWharf = G.isManned(p, 18);
      if (hasWharf && !p._wharfUsedThisRound) {
        for (const g of GOODS) {
          if (p.goods[g] > 0) {
            candidates.push({ ship: "wharf", good: g, amount: p.goods[g] });
          }
        }
      }
      if (candidates.length === 0) continue;
      // 玩家选择
      let pick;
      if (p.isHuman) {
        const labels = candidates.map(c => c.ship === "wharf" ? `🚢码头 装全部 ${c.amount}个${GOOD_NAMES[c.good]}` : `船${c.ship + 1} 装${c.amount}个${GOOD_NAMES[c.good]}`);
        const idx = await humanPickFromList("船长：装船", labels, false);
        pick = candidates[idx];
      } else {
        // AI 装船：
        // 1) 优先用 Wharf（如果有且要卸多）→ 单种一次性清完
        // 2) 否则选可装最多量的方案
        // 3) 若量相同，优先填满船的（让船下回合归零，给自己多一次装船机会）
        // 4) 否则装最贵的货物
        pick = candidates.reduce((best, c) => {
          if (!best) return c;
          // Wharf > 货船（如果 amount 接近）
          const wA = best.ship === "wharf" ? 1 : 0;
          const wB = c.ship === "wharf" ? 1 : 0;
          // 估每个选项的"效率"分数
          const scoreOf = (ch) => {
            let s = ch.amount * 10;
            // 装满船 +5
            if (ch.ship !== "wharf") {
              const ship = G.ships[ch.ship];
              if (ship.count + ch.amount >= ship.capacity) s += 8;
            }
            // 高价货物略加分
            s += GOOD_PRICE[ch.good] * 0.5;
            return s;
          };
          return scoreOf(c) > scoreOf(best) ? c : best;
        }, null);
      }
      // 执行装船
      const isWharf = pick.ship === "wharf";
      let loaded;
      if (isWharf) {
        p.goods[pick.good] -= pick.amount;
        loaded = pick.amount;
        p._wharfUsedThisRound = true;
        // FIX #27: Wharf 装的货物直接回供应区（"placed in the supply"）
        G.supply[pick.good] += pick.amount;
      } else {
        const ship = G.ships[pick.ship];
        if (ship.good === null) ship.good = pick.good;
        loaded = Math.min(pick.amount, ship.capacity - ship.count);
        ship.count += loaded;
        p.goods[pick.good] -= loaded;
      }
      let vp = loaded;
      // FIX: chooser +1VP 仅首次装船
      if (i === chooserIdx && !chooserBonusUsed.has(i)) {
        vp += 1;
        chooserBonusUsed.add(i);
      }
      // FIX: Harbor 每次装船 +1VP
      if (G.isManned(p, 17)) vp += 1;
      const vpGain = Math.min(vp, G.vpLeft);
      p.vp += vpGain;
      p.shippingVP += vpGain;
      G.vpLeft -= vpGain;
      G.logEvent(`${p.name} ${isWharf ? "用码头装" : `装船${pick.ship + 1}:`} ${loaded}${GOOD_NAMES[pick.good]} (+${vpGain}VP)`, "action");
      progress = true;
    }
  }
  // 装船阶段结束：满船的货物归还到供应区；玩家选择保留货物，其余丢弃
  // FIX #25: 满船的货物归还到供应区（Captain 阶段最后步骤）
  for (let s = 0; s < G.ships.length; s++) {
    const ship = G.ships[s];
    if (ship.count >= ship.capacity) {
      G.supply[ship.good] += ship.count;
      ship.good = null;
      ship.count = 0;
    }
  }
  // 每人保留货物
  for (const p of G.players) {
    const totalGoods = GOODS.reduce((s, g) => s + p.goods[g], 0);
    if (totalGoods === 0) continue;
    const storageKinds = G.storageKinds(p);
    // 玩家可保留：storageKinds 种货物（每种任意多）+ 单独 1 个其他货物
    // 简化：让玩家选择保留方案
    if (p.isHuman) {
      const kept = await humanKeepGoods(p, storageKinds);
      // FIX #28: 丢弃的货物返回供应区（不是凭空消失）
      for (const g of GOODS) {
        const discarded = p.goods[g] - (kept[g] || 0);
        if (discarded > 0) G.supply[g] += discarded;
        p.goods[g] = kept[g] || 0;
      }
    } else {
      // AI 保留最贵的 N 种满量 + 1 个其他
      const sorted = GOODS.filter(g => p.goods[g] > 0).sort((a, b) => GOOD_PRICE[b] - GOOD_PRICE[a]);
      const keep = {};
      const fullKinds = sorted.slice(0, storageKinds); // 默认 0 种满量
      for (const g of fullKinds) keep[g] = p.goods[g];
      // 单个最贵剩余货
      const rest = sorted.filter(g => !fullKinds.includes(g));
      if (rest.length > 0) keep[rest[0]] = 1;
      // FIX #28: 丢弃的返回供应区
      for (const g of GOODS) {
        const discarded = p.goods[g] - (keep[g] || 0);
        if (discarded > 0) G.supply[g] += discarded;
        p.goods[g] = keep[g] || 0;
      }
    }
    // 清重置 wharf
    p._wharfUsedThisRound = false;
  }
  G.logEvent(`船长阶段结束`, "action");
}

async function humanKeepGoods(p, kinds) {
  // 简化：列出当前货物，玩家点击勾选要保留的几种
  const owned = GOODS.filter(g => p.goods[g] > 0);
  if (owned.length <= kinds) {
    const keep = {};
    for (const g of owned) keep[g] = p.goods[g];
    return keep;
  }
  // 选择 kinds 种保留满量 + 再选 1 种保留 1 个
  const kept = {};
  for (let i = 0; i < kinds; i++) {
    const remaining = owned.filter(g => !(g in kept));
    if (remaining.length === 0) break;
    const idx = await humanPickFromList(`保留货物（满量，剩余 ${kinds - i} 种）`, remaining.map(g => `${GOOD_NAMES[g]} ×${p.goods[g]}`), false);
    kept[remaining[idx]] = p.goods[remaining[idx]];
  }
  // 再问 1 个其他货物
  const others = owned.filter(g => !(g in kept));
  if (others.length > 0) {
    const idx = await humanPickFromList("再保留 1 个其他货物（其余将丢弃）", [...others.map(g => `1×${GOOD_NAMES[g]}`), "全部丢弃"], false);
    if (idx < others.length) kept[others[idx]] = 1;
  }
  return kept;
}

// ============================================================
// AI 决策 — 专家级"卡位"启发式
// 参考：Mark's BGG strategy guide, BGA tips, BoardOfLife opening theory
// 阶段感知（Opening/Mid/Endgame）+ 对手价值估算 + 否决奖励
// ============================================================

function gamePhase() {
  // 基于殖民者用量+VP余量估算阶段
  const colTotal = { 3: 55, 4: 75, 5: 95 }[G.numPlayers];
  const colUsedRatio = 1 - G.colonistsLeft / colTotal;
  const vpStart = { 3: 75, 4: 100, 5: 122 }[G.numPlayers];
  const vpUsedRatio = 1 - G.vpLeft / vpStart;
  const progress = Math.max(colUsedRatio, vpUsedRatio);
  if (progress < 0.33) return "early";
  if (progress < 0.66) return "mid";
  return "late";
}

function aiPickRole(p, available) {
  const lvl = p._aiLevel || 3;
  if (lvl === 1) return level1PickRole(p, available);
  if (lvl === 2) {
    // 纯 DNA AI
    if (p._dna) {
      const idx = dnaPickRole(p, available);
      if (idx !== null && idx >= 0 && idx < available.length) return idx;
    }
    return level1PickRole(p, available);
  }
  if (lvl === 3) return level2PickRoleNew(p, available);
  if (lvl === 4) return level3Final(p, available);
  if (lvl === 5) return level4Final(p, available);
  return level2PickRoleNew(p, available);
}

// L3: L2 + 后期 Captain 优先（保证装船最大化）
function level3Final(me, available) {
  const phase = gamePhase();
  const has = name => available.find(r => r.name === name);
  // 后期 + 我货物 ≥ 3 → 强制 Captain
  const myGoods = GOODS.reduce((s,g)=>s+me.goods[g], 0);
  if (phase !== "early" && myGoods >= 3 && has("Captain")) {
    return available.indexOf(has("Captain"));
  }
  // 后期 + 我有大紫未上人 + Mayor 在 → Mayor
  if (phase !== "early" && has("Mayor")) {
    for (const b of me.buildings) {
      if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) {
        return available.indexOf(has("Mayor"));
      }
    }
  }
  return level2PickRoleNew(me, available);
}

// L4: L3 + 后期大紫优先（抢得分）
function level4Final(me, available) {
  const phase = gamePhase();
  const has = name => available.find(r => r.name === name);
  // 后期 + 我能买大紫 + Builder 在 → Builder
  if (phase === "late" && has("Builder")) {
    for (const b of BUILDINGS) {
      if (b.type !== "large_violet") continue;
      if (G.buildingStock[b.id] <= 0) continue;
      if (G.ownsBuilding(me, b.id)) continue;
      if (12 - G.buildingUsedSpaces(me) < b.size) continue;
      const cost = G.effectiveCostWithRoleBonus(me, b, true);
      if (me.money >= cost) {
        return available.indexOf(has("Builder"));
      }
    }
  }
  // 后期 + 钱不够 + 我货物 ≥ 1 + 可卖经济作物 → 抢 Trader
  if (phase !== "early" && me.money < 8 && has("Trader")) {
    for (const g of ["coffee", "tobacco"]) {
      if (me.goods[g] > 0 && !G.tradingHouse.includes(g)) {
        return available.indexOf(has("Trader"));
      }
    }
  }
  // 其他用 L3 决策
  const fallback = level3Final(me, available);

  // L5 前瞻：一轮角色相位估算（50ms预算）
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  const budgetMs = 50;
  let bestIdx = fallback;
  let bestMargin = -Infinity;

  for (let i = 0; i < available.length; i++) {
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (now - t0 > budgetMs) break;
    const role = available[i];

    const myProjected = estimateRoleRoundVP(me, role, true);
    let oppBest = -Infinity;
    for (const opp of G.players) {
      if (opp === me) continue;
      const oppAvail = available.filter((_, idx) => idx !== i);
      const oppPick = oppAvail.length ? aiPickRole(opp, oppAvail) : -1;
      const oppRole = oppPick >= 0 ? oppAvail[oppPick] : role;
      const oppProjected = estimateRoleRoundVP(opp, oppRole, true) + estimateRoleRoundVP(opp, role, false) - projectedRoundVP(opp);
      if (oppProjected > oppBest) oppBest = oppProjected;
    }

    const margin = myProjected - oppBest;
    if (margin > bestMargin) {
      bestMargin = margin;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function projectedRoundVP(p) {
  return p.vp + p.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].vp, 0) + G.getSpecialVPs(p);
}

function estimateRoleRoundVP(p, roleCard, isChooser) {
  let s = projectedRoundVP(p) + (isChooser ? roleCard.money * 0.15 : 0);
  if (roleCard.name === "Prospector" && isChooser) s += 0.4;
  if (roleCard.name === "Captain") {
    const goods = GOODS.reduce((sum, g) => sum + p.goods[g], 0);
    s += Math.min(goods, 4) + (isChooser ? 1 : 0);
  }
  if (roleCard.name === "Trader") {
    let bestSale = 0;
    for (const g of GOODS) {
      if (p.goods[g] > 0 && (G.ownsBuilding(p, 12) || !G.tradingHouse.includes(g))) {
        bestSale = Math.max(bestSale, GOOD_PRICE[g] + (isChooser ? 1 : 0));
      }
    }
    s += bestSale * 0.7;
  }
  if (roleCard.name === "Builder") {
    for (const b of BUILDINGS) {
      if (G.buildingStock[b.id] <= 0 || G.ownsBuilding(p, b.id)) continue;
      if (12 - G.buildingUsedSpaces(p) < b.size) continue;
      const cost = G.effectiveCostWithRoleBonus(p, b, isChooser);
      if (p.money >= cost) { s += b.vp + (b.type === "large_violet" ? 1.5 : 0.5); break; }
    }
  }
  if (roleCard.name === "Craftsman") {
    let prod = 0;
    for (const g of GOODS) prod += Math.max(0, Math.min(G.productionCapacity(p, g), G.supply[g]));
    s += prod * 0.55 + (isChooser ? 0.2 : 0);
  }
  if (roleCard.name === "Mayor") {
    let openJobs = 0;
    for (const b of p.buildings) openJobs += (BLD_BY_ID[b.bid].men - b.men);
    s += Math.min(openJobs + p.plantations.filter(pl => !pl.manned).length, G.colonistsOnShip + (isChooser ? 1 : 0)) * 0.3;
  }
  if (roleCard.name === "Settler") s += 0.4;
  return s;
}

// L3：L2 + 看全场（不仅下家）的 Captain/Trader 抢卡
function level3PickRoleSimple(me, available) {
  const allOthers = G.players.filter(p => p !== me);
  const has = name => available.find(r => r.name === name);
  const myGoods = GOODS.reduce((s,g)=>s+me.goods[g], 0);

  // === 全场感知 ===
  // 1) 任一对手有 ≥4 货物 + Captain 可选 + 我也有货 → 抢 Captain
  if (has("Captain") && myGoods >= 1) {
    let oppHasManyGoods = false;
    for (const opp of allOthers) {
      const oppGoods = GOODS.reduce((s,g)=>s+opp.goods[g], 0);
      if (oppGoods >= 4) oppHasManyGoods = true;
    }
    if (oppHasManyGoods) return available.indexOf(has("Captain"));
  }
  // 2) 任一对手有经济作物（tobacco/coffee）+ Trader 可选 + 我可卖 ≥ 2 金 → 抢 Trader
  if (has("Trader") && myGoods > 0) {
    let oppHasEcon = false;
    for (const opp of allOthers) {
      if (opp.goods.tobacco > 0 || opp.goods.coffee > 0) oppHasEcon = true;
    }
    let myBestSale = 0;
    for (const g of GOODS) {
      if (me.goods[g] > 0 && !G.tradingHouse.includes(g)) {
        myBestSale = Math.max(myBestSale, GOOD_PRICE[g] + 1);
      }
    }
    if (oppHasEcon && myBestSale >= 2) return available.indexOf(has("Trader"));
  }
  // 否则回到 L2 选择
  return level2PickRoleNew(me, available);
}

// L4 简化：L3 决策 + 后期关键行动覆盖
function level4PickRoleSimple(me, available) {
  const phase = gamePhase();
  const has = name => available.find(r => r.name === name);
  // === 紧急覆盖 1: 我有大紫未上人 + Mayor 在 → 选 Mayor ===
  if (phase !== "early" && has("Mayor")) {
    for (const b of me.buildings) {
      if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) {
        return available.indexOf(has("Mayor"));
      }
    }
  }
  // === 紧急覆盖 2: 我能买大紫 + Builder 在 → 选 Builder ===
  if (phase === "late" && has("Builder")) {
    for (const b of BUILDINGS) {
      if (b.type !== "large_violet") continue;
      if (G.buildingStock[b.id] <= 0) continue;
      if (G.ownsBuilding(me, b.id)) continue;
      if (12 - G.buildingUsedSpaces(me) < b.size) continue;
      const cost = G.effectiveCostWithRoleBonus(me, b, true);
      if (me.money >= cost) {
        return available.indexOf(has("Builder"));
      }
    }
  }
  // === 紧急覆盖 3: 我有 ≥4 货物 + Captain 在 → 选 Captain ===
  const myGoods = GOODS.reduce((s,g)=>s+me.goods[g], 0);
  if (myGoods >= 4 && has("Captain")) {
    return available.indexOf(has("Captain"));
  }
  // 其他情况用 L3
  return level3PickRoleSimple(me, available);
}

// L3: L2 + 看全场玩家工厂/产能/资金 → 更精细的"何时不要选 Craftsman/Mayor"
function level3PickRoleNew(me, available) {
  const l2Choice = level2PickRoleNew(me, available);
  const allOthers = G.players.filter(p => p !== me);
  const phase = gamePhase();

  // 评分：先用 L2 偏好，再加全场感知
  const scores = available.map((r, i) => {
    let score = roleValueFor(me, r, true, phase) + r.money * 10;
    // L2 推荐 +5
    if (i === l2Choice) score += 5;
    // 工匠：看自己产能是否优势
    if (r.name === "Craftsman") {
      let myProd = 0;
      for (const g of GOODS) myProd += G.productionCapacity(me, g);
      let oppMaxProd = 0;
      for (const opp of allOthers) {
        let pp = 0;
        for (const g of GOODS) pp += G.productionCapacity(opp, g);
        if (pp > oppMaxProd) oppMaxProd = pp;
      }
      // 自己产能 >= 对手最大 → +10；否则 -10
      score += (myProd - oppMaxProd) * 5;
    }
    // Mayor：对手有未上人大紫 → -15
    if (r.name === "Mayor") {
      for (const opp of allOthers) {
        for (const b of opp.buildings) {
          if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) {
            score -= 15;
          }
        }
      }
    }
    return { i, score };
  });
  scores.sort((a,b) => b.score - a.score);
  return scores[0].i;
}

// L4: L3 + 后期大紫优先 + 后期 Captain 优先 + 领先者轻度针对
function level4PickRoleNew(me, available) {
  const l3Choice = level3PickRoleNew(me, available);
  const phase = gamePhase();
  const leader = findLeader();
  const meIsLeader = leader.leader === me;

  const scores = available.map((r, i) => {
    let score = roleValueFor(me, r, true, phase) + r.money * 10;
    // L3 推荐 +5
    if (i === l3Choice) score += 5;
    // 后期大紫机会 → Builder +40
    if (phase === "late" && r.name === "Builder") {
      for (const b of BUILDINGS) {
        if (b.type !== "large_violet") continue;
        if (G.buildingStock[b.id] <= 0) continue;
        if (G.ownsBuilding(me, b.id)) continue;
        if (12 - G.buildingUsedSpaces(me) < b.size) continue;
        const cost = G.effectiveCostWithRoleBonus(me, b, true);
        if (me.money >= cost) {
          const violetCount = me.buildings.filter(bb => BLD_BY_ID[bb.bid].type === "violet" || BLD_BY_ID[bb.bid].type === "large_violet").length;
          if (b.id === 19) score += me.buildings.filter(bb => BLD_BY_ID[bb.bid].type === "production").length >= 3 ? 40 : 15;
          if (b.id === 23) score += violetCount >= 4 ? 40 : 15;
          if (b.id === 22) score += me.shippingVP >= 12 ? 40 : 15;
          if (b.id === 20) score += me.plantations.length >= 9 ? 40 : 15;
          if (b.id === 21) score += 25;
        }
      }
    }
    // 后期 + 货物多 → Captain +25
    if (phase === "late" && r.name === "Captain") {
      const myG = GOODS.reduce((s,g) => s + me.goods[g], 0);
      if (myG >= 3) score += 25;
    }
    // 后期 + 大紫缺人 → Mayor +30
    if (phase !== "early" && r.name === "Mayor") {
      for (const b of me.buildings) {
        if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) score += 30;
      }
    }
    // 领先者轻度针对（仅当我非领先时）
    if (!meIsLeader && leader.leader) {
      const leaderChooser = roleValueFor(leader.leader, r, true, phase);
      const leaderFollower = roleValueFor(leader.leader, r, false, phase);
      score += (leaderChooser - leaderFollower) * 0.25;
    }
    return { i, score };
  });
  scores.sort((a,b) => b.score - a.score);
  return scores[0].i;
}

// L2 简化版：L1 决策 + 卡上奖金 + 邻座感知
function level2PickRoleNew(me, available) {
  // 先看 L1 强烈推荐的
  const l1Choice = level1PickRole(me, available);
  // 但如果有角色卡上有 ≥ 2 金币，优先抢
  let bestMoneyIdx = -1, bestMoneyVal = 1;
  for (let i = 0; i < available.length; i++) {
    if (available[i].money >= bestMoneyVal) {
      bestMoneyVal = available[i].money;
      bestMoneyIdx = i;
    }
  }
  // 邻座感知：若下家货物多 + Captain 在 → 抢 Captain 卡他
  const myIdx = G.players.indexOf(me);
  const downstream = G.players[(myIdx + 1) % G.numPlayers];
  const downGoods = GOODS.reduce((s,g) => s + downstream.goods[g], 0);
  const captainIdx = available.findIndex(r => r.name === "Captain");
  if (captainIdx >= 0 && downGoods >= 3 && GOODS.reduce((s,g)=>s+me.goods[g], 0) >= 1) {
    return captainIdx;
  }
  // 否则采用 L1 选择或高金币卡
  if (bestMoneyVal >= 3 && available[bestMoneyIdx].money > 2) return bestMoneyIdx;
  return l1Choice;
}

// 分层评分：depth 越高，加入越多智能
//   depth 1: 仅自己（无对手意识，简单决策树）
//   depth 2: + 邻座（上下家）的"卡位"否决
//   depth 3: + 全场所有对手的否决
//   depth 4: + 领先者针对 + 工匠恐惧 + 大紫优先
function tieredPickRole(me, available, depth) {
  // depth 1：固定决策树
  if (depth === 1) return level1PickRole(me, available);
  // depth 2+ 用评分模型
  const phase = gamePhase();
  const myIdx = G.players.indexOf(me);
  const upstream = G.players[(myIdx - 1 + G.numPlayers) % G.numPlayers];
  const downstream = G.players[(myIdx + 1) % G.numPlayers];
  const neighbors = [upstream, downstream];
  const allOthers = G.players.filter(p => p !== me);
  const leader = findLeader();
  const meIsLeader = leader.leader === me;

  const scores = available.map((r, i) => {
    let score = roleValueFor(me, r, true, phase);
    score += r.money * 10; // 卡上奖金

    // ---- depth ≥ 2: 邻座感知（建设性，非否决）----
    // 不直接减分，而是看："如果下家有大量货物，抢 Captain 同时帮自己装船"
    if (depth >= 2 && r.name === "Captain") {
      // 下家货物多 → Captain 不仅自利还卡他
      let downGoods = 0;
      for (const g of GOODS) downGoods += downstream.goods[g];
      if (downGoods >= 3) score += 8;
    }
    if (depth >= 2 && r.name === "Trader") {
      // 下家有经济作物 → Trader 卡他
      if (downstream.goods.tobacco > 0 || downstream.goods.coffee > 0) score += 6;
    }
    // ---- depth ≥ 3: 全场感知 ----
    if (depth >= 3) {
      // 工匠：考虑产能优势
      if (r.name === "Craftsman") {
        let myProd = 0;
        for (const g of GOODS) myProd += G.productionCapacity(me, g);
        let oppAvgProd = 0;
        for (const opp of allOthers) {
          for (const g of GOODS) oppAvgProd += G.productionCapacity(opp, g);
        }
        oppAvgProd /= Math.max(allOthers.length, 1);
        score += (myProd - oppAvgProd) * 6;
      }
      // Mayor：考虑对手未上人大紫
      if (r.name === "Mayor") {
        for (const opp of allOthers) {
          for (const b of opp.buildings) {
            if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) {
              score -= 12;
            }
          }
        }
      }
    }
    // ---- depth ≥ 4: 关键覆盖 + 优势放大 ----
    if (depth >= 4) {
      // 关键：后期大紫机会 → Builder 大幅加分
      if (phase === "late" && r.name === "Builder") {
        const violetCount = me.buildings.filter(b => BLD_BY_ID[b.bid].type === "violet" || BLD_BY_ID[b.bid].type === "large_violet").length;
        for (const b of BUILDINGS) {
          if (b.type !== "large_violet") continue;
          if (G.buildingStock[b.id] <= 0) continue;
          if (G.ownsBuilding(me, b.id)) continue;
          if (12 - G.buildingUsedSpaces(me) < b.size) continue;
          const cost = G.effectiveCostWithRoleBonus(me, b, true);
          if (me.money >= cost) {
            if (b.id === 19 && me.buildings.filter(bb => BLD_BY_ID[bb.bid].type === "production").length >= 3) score += 40;
            if (b.id === 23 && violetCount >= 4) score += 40;
            if (b.id === 22 && me.shippingVP >= 16) score += 40;
            if (b.id === 20 && me.plantations.length >= 10) score += 40;
            if (b.id === 21) score += 25;
          }
        }
      }
      // 后期 + 货物多 → Captain 优先（最大化船运）
      if (phase === "late" && r.name === "Captain") {
        const myG = GOODS.reduce((s,g)=>s+me.goods[g], 0);
        if (myG >= 3) score += 20;
      }
      // 后期 + 大紫缺人 → Mayor 优先（自家建筑激活）
      if (phase !== "early" && r.name === "Mayor") {
        for (const b of me.buildings) {
          if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) {
            score += 25;
          }
        }
      }
      // 工厂奖励：自己产能多种 → Craftsman 加分
      if (r.name === "Craftsman" && G.isManned(me, 15)) {
        const kinds = GOODS.filter(g => G.productionCapacity(me, g) > 0).length;
        const fb = {1:0, 2:1, 3:2, 4:3, 5:5}[kinds] || 0;
        score += fb * 8;
      }
    }
    return { i, score };
  });
  scores.sort((a,b) => b.score - a.score);
  return scores[0].i;
}

// ============================================================
// 等级 3：看全场 + L2 基础 + 全局否决
// ============================================================
function level3PickRole(me, available) {
  // L3 = L2 决策 + 全场否决调整
  // 先用 L2 选择得到候选
  const l2Choice = level2PickRole(me, available);
  // 再评估全场：若某个角色对所有对手都更有利且 L2 选的不是最优"否决"，可考虑换
  const phase = gamePhase();
  const otherPlayers = G.players.filter(pp => pp !== me);
  const scores = available.map((r, i) => {
    const myV = roleValueFor(me, r, true, phase);
    let totalOppV = 0;
    let bestOppV = 0;
    for (const opp of otherPlayers) {
      const v = roleValueFor(opp, r, true, phase);
      totalOppV += v;
      if (v > bestOppV) bestOppV = v;
    }
    return { i, score: myV + r.money * 10 - bestOppV * 0.12 + (totalOppV * -0.03) };
  });
  scores.sort((a,b) => b.score - a.score);
  // 70% 采用 L2 的，30% 用全场否决
  // 实际上：取两者评分更高的（L2 已经是其评分）
  const l2Score = scores.find(s => s.i === l2Choice)?.score || 0;
  if (scores[0].score > l2Score * 1.1) return scores[0].i;
  return l2Choice;
}

// ============================================================
// 等级 1：简单 AI  — 完全不看对手
// 只看自己面板。1-3 种作物。优先级：缺人→Mayor；卖货≥4分→Captain；钱≥12→Builder
// ============================================================
function level1PickRole(me, available) {
  const myMoney = me.money;
  const myGoodsCount = GOODS.map(g => me.goods[g]).reduce((a,b)=>a+b, 0);
  let openSlots = 0;
  for (const pl of me.plantations) if (!pl.manned) openSlots++;
  for (const b of me.buildings) openSlots += (BLD_BY_ID[b.bid].men - b.men);
  const has = name => available.find(r => r.name === name);

  // 1) 田/建筑缺人 → 市长
  if (openSlots >= 1 && has("Mayor")) return available.indexOf(has("Mayor"));
  // 2) 钱 ≥ 12 → 建造（买最好建筑）
  if (myMoney >= 12 && has("Builder")) return available.indexOf(has("Builder"));
  // 3) 有货物 ≥ 4 个 → 船长（可上船 ≥ 4 VP）
  if (myGoodsCount >= 4 && has("Captain")) return available.indexOf(has("Captain"));
  // 4) 有货物 + Trader 可用 → 商人
  if (myGoodsCount > 0 && has("Trader")) {
    let bestSale = 0;
    const hasOffice = G.isManned(me, 12);
    for (const g of GOODS) {
      if (me.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g))) {
        bestSale = Math.max(bestSale, GOOD_PRICE[g] + 1);
      }
    }
    if (bestSale >= 2) return available.indexOf(has("Trader"));
  }
  // 5) 能生产 → 工匠
  let canProduce = false;
  for (const g of GOODS) if (G.productionCapacity(me, g) > 0) { canProduce = true; break; }
  if (canProduce && has("Craftsman")) return available.indexOf(has("Craftsman"));
  // 6) 种植园不够（<3）→ 拓殖者
  if (me.plantations.length < 3 && has("Settler")) return available.indexOf(has("Settler"));
  // 7) 默认：金矿主（不看角色卡上的钱，纯简单）
  if (has("Prospector")) return available.indexOf(has("Prospector"));
  // 8) 实在没办法：选第一个
  return 0;
}

// ============================================================
// 等级 2：普通 AI — 看邻座 + 流派
// 流派：玉米流 / 杂货流 / 建筑流
// 自动从初始种植园+座位推断流派
// ============================================================
function level2DecideStrategy(p) {
  if (p._strategy) return p._strategy;
  // 根据初始种植园+座位决定
  const starterGood = p.plantations[0]?.good;
  const seat = G.players.indexOf(p);
  // 玉米座位（后座 + 玉米起手）→ 玉米流
  if (starterGood === "corn" && seat >= G.numPlayers - 2) {
    p._strategy = "corn";
  } else if (seat === 0) {
    // 首座 → 建筑流（吃量化）
    p._strategy = "builder";
  } else {
    // 默认杂货流
    p._strategy = "jack";
  }
  return p._strategy;
}

function level2PickRole(me, available) {
  // L2 = L1 基础 + 邻座感知 + 流派偏好
  const phase = gamePhase();
  const upstream = G.players[(G.players.indexOf(me) - 1 + G.numPlayers) % G.numPlayers];
  const downstream = G.players[(G.players.indexOf(me) + 1) % G.numPlayers];
  const has = n => available.find(r => r.name === n);
  const myMoney = me.money;
  const myGoodsCount = GOODS.reduce((s,g)=>s+me.goods[g], 0);
  const myKinds = GOODS.filter(g => me.goods[g] > 0).length;
  let openSlots = 0;
  for (const pl of me.plantations) if (!pl.manned) openSlots++;
  for (const b of me.buildings) openSlots += (BLD_BY_ID[b.bid].men - b.men);

  // === 紧急规则 ===
  // 仓库不够强制 Captain
  const stKinds = G.storageKinds(me);
  if (myKinds > stKinds + 1 && has("Captain")) return available.indexOf(has("Captain"));

  // === 邻座感知 ===
  // 下家有经济作物 + Trader 卡上有钱 → 抢 Trader（即使我自己卖得少）
  const downHasEcon = downstream.goods.tobacco > 0 || downstream.goods.coffee > 0;
  const downGoods = GOODS.reduce((s,g)=>s+downstream.goods[g], 0);
  if (downHasEcon && myGoodsCount > 0 && has("Trader")) {
    const t = has("Trader");
    if (t.money >= 1 || myKinds >= 2) return available.indexOf(t);
  }
  // 下家货物 ≥ 3 + 我没货 → 抢 Captain 卡他
  if (downGoods >= 3 && myGoodsCount === 0 && has("Captain")) {
    return available.indexOf(has("Captain"));
  }
  // 上家走相同经济流派 → 我转杂货
  // (这里就影响 Settler/Builder 倾向)

  // === 基础（L1 类似但更细）===
  // 1) Mayor: 缺人多 (>=2) 才选，避免帮对手
  if (openSlots >= 2 && has("Mayor")) {
    // 但若对手大紫未上人，不选
    let oppNeedsMan = false;
    for (const opp of G.players) {
      if (opp === me) continue;
      for (const b of opp.buildings) {
        if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) oppNeedsMan = true;
      }
    }
    if (!oppNeedsMan) return available.indexOf(has("Mayor"));
  }
  // 2) Captain: 货物多 (>=4)
  if (myGoodsCount >= 4 && has("Captain")) return available.indexOf(has("Captain"));
  // 3) Builder: 钱多 + 能买好建筑
  if (myMoney >= 7 && has("Builder")) {
    // 检查有可买的高价值建筑
    for (const b of BUILDINGS) {
      if (G.buildingStock[b.id] <= 0) continue;
      if (G.ownsBuilding(me, b.id)) continue;
      if (12 - G.buildingUsedSpaces(me) < b.size) continue;
      const cost = G.effectiveCostWithRoleBonus(me, b, true);
      if (me.money >= cost && b.vp >= 2) return available.indexOf(has("Builder"));
    }
  }
  // 4) Trader: 能赚 >= 3
  if (myGoodsCount > 0 && has("Trader")) {
    let bestSale = 0;
    const hasOffice = G.isManned(me, 12);
    for (const g of GOODS) {
      if (me.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g))) {
        let earn = GOOD_PRICE[g] + 1;
        if (G.isManned(me, 7)) earn += 1;
        if (G.isManned(me, 13)) earn += 2;
        bestSale = Math.max(bestSale, earn);
      }
    }
    if (bestSale >= 3) return available.indexOf(has("Trader"));
  }
  // 5) Craftsman: 仅在自己产能 >= 对手平均时
  if (has("Craftsman")) {
    let myProd = 0;
    for (const g of GOODS) myProd += G.productionCapacity(me, g);
    let oppMaxProd = 0;
    for (const opp of [upstream, downstream]) {
      let pProd = 0;
      for (const g of GOODS) pProd += G.productionCapacity(opp, g);
      if (pProd > oppMaxProd) oppMaxProd = pProd;
    }
    if (myProd >= 2 && myProd >= oppMaxProd) return available.indexOf(has("Craftsman"));
  }
  // 6) Settler: 种植园少
  if (me.plantations.length < 4 && has("Settler")) return available.indexOf(has("Settler"));
  // 7) Late game + 大紫未上人 → Mayor
  if (phase === "late" && has("Mayor")) {
    for (const b of me.buildings) {
      if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) {
        return available.indexOf(has("Mayor"));
      }
    }
  }
  // 8) 默认：拿钱最多
  let best = -1, bestI = 0;
  for (let i = 0; i < available.length; i++) {
    if (available[i].money > best) { best = available[i].money; bestI = i; }
  }
  return bestI;
}

// ============================================================
// 等级 4：专家 AI — 全场扫描 + 前瞻 + 针对领先者
// ============================================================
function projectedScore(p) {
  // 估计该玩家终局得分（VP + 建筑 + 特殊 + 未来潜力）
  let s = p.vp;
  for (const b of p.buildings) s += BLD_BY_ID[b.bid].vp;
  s += G.getSpecialVPs(p);
  // 未来潜力：货物 × 1（可装船）+ 金币/2（可买分）
  const goods = GOODS.reduce((sum,g) => sum + p.goods[g], 0);
  s += goods * 0.8;
  s += p.money * 0.4;
  return s;
}

function findLeader() {
  let best = -1, leader = null;
  for (const p of G.players) {
    const s = projectedScore(p);
    if (s > best) { best = s; leader = p; }
  }
  return { leader, score: best };
}

function level4PickRole(me, available) {
  // L4 = L3 决策基础 + 领先者针对 + 关键时刻覆盖
  // 1) 先取 L2 的选择作为基础（同 L3 的根基）
  const l2Choice = level2PickRole(me, available);
  // 2) 检查关键覆盖规则
  const phase = gamePhase();
  const leader = findLeader();
  const meIsLeader = leader.leader === me;
  const otherPlayers = G.players.filter(pp => pp !== me);
  const has = name => available.find(r => r.name === name);
  const myMoney = me.money;
  const myGoodsCount = GOODS.reduce((s,g)=>s+me.goods[g], 0);
  const myKinds = GOODS.filter(g => me.goods[g] > 0).length;

  // 3) 评估每个角色的 L4 价值
  const scores = available.map((r, i) => {
    const myV = roleValueFor(me, r, true, phase);
    let leaderChooserV = 0, leaderFollowerV = 0;
    let bestOppChooserV = 0, sumOppFollower = 0;
    for (const opp of otherPlayers) {
      const asChooser = roleValueFor(opp, r, true, phase);
      const asFollower = roleValueFor(opp, r, false, phase);
      if (asChooser > bestOppChooserV) bestOppChooserV = asChooser;
      sumOppFollower += asFollower;
      if (opp === leader.leader) {
        leaderChooserV = asChooser;
        leaderFollowerV = asFollower;
      }
    }
    const leaderSteal = leaderChooserV - leaderFollowerV;
    let total = myV + r.money * 12;
    // 一般否决：让对手得不到太多
    total -= sumOppFollower * 0.05;
    // 否决领先者
    if (!meIsLeader && leader.leader) total += leaderSteal * 0.5;
    // L2 选的有 +5 加成（继承 L2 的好选择）
    if (i === l2Choice) total += 8;
    return { i, score: total, name: r.name };
  });
  scores.sort((a,b) => b.score - a.score);
  return scores[0].i;
}

function advancedPickRole(me, available) {
  const phase = gamePhase();
  const others = G.players.filter(pp => pp !== me);
  // 计算"如果我选 X 角色，我得多少价值"和"如果不选给对手最佳的人多少价值"
  const scores = available.map((r, i) => {
    const myValue = roleValueFor(me, r, true, phase);
    // 对手们的最佳价值（他们当作 chooser）
    let bestOpponentValue = 0;
    for (const opp of others) {
      const oppV = roleValueFor(opp, r, true, phase);
      if (oppV > bestOpponentValue) bestOpponentValue = oppV;
    }
    // 我选这个角色得到 myValue + 阻止对手得到 bestOpponentValue
    // 但要权衡：如果对手只是"将得到"少量，否决意义小
    const denialBonus = Math.max(0, bestOpponentValue - myValue * 0.5);
    const total = myValue + r.money * 10 + denialBonus * 0.4;
    return { i, score: total, name: r.name, myValue, bestOpponentValue, money: r.money };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores[0].i;
}

// 一个玩家选某角色的价值估算（chooser视角）
function roleValueFor(p, r, asChooser, phase) {
  let s = 0;
  switch (r.name) {
    case "Captain": {
      const totalGoods = GOODS.reduce((sum, g) => sum + p.goods[g], 0);
      // 每装 1 货 ≈ 1 VP，+1 chooser bonus
      const harbor = G.isManned(p, 17) ? 1 : 0;
      // 估算可装的最大量（受船容量约束，但简化：玩家自己货物 vs 船剩余总容量）
      let totalShipCap = 0;
      for (const ship of G.ships) totalShipCap += (ship.capacity - ship.count);
      const wharf = G.isManned(p, 18) ? 99 : 0;
      const myShipping = Math.min(totalGoods, totalShipCap + wharf);
      s += myShipping * (10 + harbor * 5);
      if (asChooser) s += 12; // chooser +1VP
      // 仓库不够，强制丢失的货物危机
      const storageKinds = G.storageKinds(p);
      const kindsHeld = GOODS.filter(g => p.goods[g] > 0).length;
      if (kindsHeld > storageKinds + 1) s += (kindsHeld - storageKinds - 1) * 35; // 紧急
      // Endgame: Captain 更值
      if (phase === "late") s += myShipping * 5;
      break;
    }
    case "Mayor": {
      // 未占岗位
      let openJobs = 0;
      for (const pl of p.plantations) if (!pl.manned) openJobs++;
      for (const b of p.buildings) openJobs += (BLD_BY_ID[b.bid].men - b.men);
      s += openJobs * 18;
      // 船上的殖民者也算（每个 ≈ 5）
      s += G.colonistsOnShip * 6;
      if (asChooser) s += 18; // +1 from supply
      // Late game: Mayor 更值（要激活大建筑）
      if (phase === "late") {
        // 未上人的大紫建筑
        for (const b of p.buildings) {
          if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) {
            s += 40; // 急需上岗
          }
        }
      }
      break;
    }
    case "Builder": {
      let best = 0;
      let bestCost = 999;
      let bestBld = null;
      for (const b of BUILDINGS) {
        if (G.buildingStock[b.id] <= 0) continue;
        if (G.ownsBuilding(p, b.id)) continue;
        if (12 - G.buildingUsedSpaces(p) < b.size) continue;
        const cost = G.effectiveCostWithRoleBonus(p, b, asChooser);
        if (p.money >= cost) {
          // 评分该建筑
          const v = evalBuildingValue(p, b, phase);
          if (v > best) { best = v; bestCost = cost; bestBld = b; }
        }
      }
      s += best;
      if (asChooser && best > 0) s += 8; // -1 gold value
      // Late game: Builder 更值 (大紫建筑)
      if (phase === "late" && bestBld && bestBld.type === "large_violet") s += 25;
      break;
    }
    case "Craftsman": {
      // 关键：只有自己是主要生产者时才值得选 Craftsman (否则帮对手)
      let myProd = 0;
      const myProdByGood = {};
      for (const g of GOODS) {
        myProdByGood[g] = G.productionCapacity(p, g);
        myProd += myProdByGood[g];
      }
      // 估算对手平均产量
      let oppAvgProd = 0;
      const oppCount = G.players.length - 1;
      for (const opp of G.players) {
        if (opp === p) continue;
        for (const g of GOODS) oppAvgProd += G.productionCapacity(opp, g);
      }
      if (oppCount > 0) oppAvgProd /= oppCount;
      // 我相对优势
      const advantage = myProd - oppAvgProd;
      s += myProd * 8;
      s += advantage * 12; // 优势越大越值
      // Factory bonus 估算
      if (G.isManned(p, 15)) {
        const kinds = Object.values(myProdByGood).filter(v => v > 0).length;
        const fb = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 }[kinds] || 0;
        s += fb * 6;
      }
      // chooser bonus
      if (asChooser && myProd > 0) s += 8;
      // 否决：如果我没什么产能但对手有，少选这个
      if (myProd === 0) s -= 20;
      break;
    }
    case "Trader": {
      // 我能卖多少
      let bestSale = 0;
      const hasOffice = G.isManned(p, 12);
      for (const g of GOODS) {
        if (p.goods[g] <= 0) continue;
        if (!hasOffice && G.tradingHouse.includes(g)) continue;
        let earn = GOOD_PRICE[g];
        if (asChooser) earn += 1;
        if (G.isManned(p, 7)) earn += 1;
        if (G.isManned(p, 13)) earn += 2;
        if (earn > bestSale) bestSale = earn;
      }
      s += bestSale * 14;
      // 否决：对手货物多 → 抢 Trader 阻止他赚
      // (单独通过 advancedPickRole 的对手价值计算实现)
      break;
    }
    case "Settler": {
      if (p.plantations.length >= 12) { s = 0; break; }
      // 评估池里能拿到的最好种植园
      const myGoods = {};
      for (const pl of p.plantations) myGoods[pl.good] = (myGoods[pl.good] || 0) + 1;
      let bestPlant = 0;
      for (const g of G.plantationPool) {
        let v = 6;
        // 已经有对应加工厂但缺种植园
        const refining = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] }[g];
        if (refining) {
          let factCap = 0;
          for (const bid of refining) {
            const bb = G.ownsBuilding(p, bid);
            if (bb) factCap += BLD_BY_ID[bid].men;
          }
          const have = myGoods[g] || 0;
          if (have < factCap) v += 12; // 急需
        }
        if (g === "corn" && phase === "early") v += 8; // 早期玉米强
        v += GOOD_PRICE[g] * 2; // 贵货种植园更值
        bestPlant = Math.max(bestPlant, v);
      }
      s += bestPlant;
      // chooser 可以拿采石场 — 早期非常值
      if (asChooser && G.quarriesLeft > 0) {
        const myQuarries = p.plantations.filter(pl => pl.good === "quarry").length;
        if (myQuarries < 4) s += (phase === "early" ? 25 : phase === "mid" ? 15 : 5);
      }
      // 板上空间不足时不值
      if (p.plantations.length >= 10) s -= 10;
      break;
    }
    case "Prospector":
      // 默认 +1 金币，弱
      s += asChooser ? 6 : 0;
      // 当其他选项都很差时是好选择
      break;
  }
  return s;
}

// 评估一座建筑对此玩家的价值
function evalBuildingValue(p, b, phase) {
  let v = b.vp * 6;
  // 生产链建筑：补全或扩产
  if (b.type === "production") {
    if (phase === "early") v += 20;
    if (phase === "mid") v += 10;
    if (phase === "late") v -= 10; // 后期来不及发挥
    // 大型生产更强
    if (b.men > 1) v += b.men * 4;
  }
  // 紫色建筑 — 看具体效果
  const id = b.id;
  if (id === 7) v += phase === "mid" ? 18 : 8; // 小市场
  if (id === 8) v += 12; // 庄园（拿种植园 +1）
  if (id === 9) v += phase === "early" ? 18 : 5; // 建筑工地（采石场）
  if (id === 10) v += 8; // 小仓库
  if (id === 11) v += phase === "early" ? 18 : 6; // 济贫院
  if (id === 12) v += 14; // 办公室
  if (id === 13) v += 18; // 大市场
  if (id === 14) v += 10; // 大仓库
  if (id === 15) {
    // 工厂 — 看种类多样性
    const kinds = GOODS.filter(g => G.productionCapacity(p, g) > 0).length;
    v += kinds * 10;
  }
  if (id === 16) v += phase === "mid" || phase === "late" ? 22 : 8; // 大学
  if (id === 17) v += 30; // 港口
  if (id === 18) v += 25; // 码头
  // 大紫建筑 — 看条件
  if (id === 19) {
    // 公会大厅
    const prodSmall = p.buildings.filter(bb => BLD_BY_ID[bb.bid].type === "production" && BLD_BY_ID[bb.bid].men === 1).length;
    const prodLarge = p.buildings.filter(bb => BLD_BY_ID[bb.bid].type === "production" && BLD_BY_ID[bb.bid].men > 1).length;
    v += (prodSmall + prodLarge * 2) * 5;
  }
  if (id === 20) {
    v += p.plantations.length * 3;
  }
  if (id === 21) {
    v += G.totalColonists(p) * 2;
  }
  if (id === 22) v += p.shippingVP * 2; // 海关大楼
  if (id === 23) {
    const violet = p.buildings.filter(bb => BLD_BY_ID[bb.bid].type === "violet" || BLD_BY_ID[bb.bid].type === "large_violet").length;
    v += violet * 4;
  }
  return v;
}

function aiPickPlantation(p, options, isChooser) {
  if (p._dna) {
    const idx = dnaPickPlantation(p, options, isChooser);
    if (idx !== null && idx >= 0 && idx < options.length) return idx;
  }
  // chooser 优先采石场（除非已经很多）
  let qCount = 0;
  for (const pl of p.plantations) if (pl.good === "quarry") qCount++;
  if (isChooser && qCount < 3) {
    const qOpt = options.findIndex(o => o.kind === "quarry");
    if (qOpt >= 0) return qOpt;
  }
  // 否则：拿能补全产业链的（有加工建筑没种植园）
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    if (o.kind !== "plant") continue;
    const g = o.good;
    // 有该种加工建筑且种植园不够
    let plantCount = p.plantations.filter(pp => pp.good === g).length;
    let factCap = 0;
    const refining = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] }[g];
    if (refining) {
      for (const bid of refining) {
        const bb = G.ownsBuilding(p, bid);
        if (bb) factCap += BLD_BY_ID[bid].men;
      }
      if (plantCount < factCap) return i;
    }
  }
  // 缺什么补什么：早期玉米和靛蓝
  const priorityGood = ["corn", "indigo", "sugar", "tobacco", "coffee"];
  for (const g of priorityGood) {
    const idx = options.findIndex(o => o.kind === "plant" && o.good === g);
    if (idx >= 0) return idx;
  }
  return 0;
}

function aiPickBuilding(p, options, isChooser) {
  if (p._dna && p._useDNA) {
    const idx = dnaPickBuilding(p, options, isChooser);
    if (idx !== null && idx >= 0 && idx < options.length) return idx;
  }
  const phase = gamePhase();
  const scored = options.map((o, i) => {
    let score = evalBuildingValue(p, o.b, phase);
    // 价格高减分（机会成本）
    score -= o.cost * 3;
    // chooser 折扣略加分
    if (isChooser) score += 5;
    return { i, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].i;
}

// ============================================================
// 人类玩家交互
// ============================================================

// 全局：当前等待的可点击选择
// pendingSelect = { type, choices, resolve, allowSkip, promptText }
let pendingSelect = null;

function humanBoardSelect({ type, choices, promptText, allowSkip }) {
  // type: 'role' | 'plantation' | 'building' | 'good' | 'slot'
  // choices: 数组，每项含 {key, ...具体数据}
  return new Promise(resolve => {
    pendingSelect = { type, choices, resolve, allowSkip, promptText };
    G._currentPrompt = promptText;
    render();
  });
}

function resolveBoardSelect(idx) {
  if (!pendingSelect) return;
  const r = pendingSelect.resolve;
  pendingSelect = null;
  G._currentPrompt = null;
  r(idx);
}

function humanPickRole(available) {
  return humanBoardSelect({
    type: "role",
    choices: available.map((r, i) => ({ key: i, role: r })),
    promptText: "你必须选择一个角色 — 点击下方角色卡",
    allowSkip: false,
  });
}

function humanPickFromList(title, labels, allowCancel) {
  return new Promise(resolve => {
    const buttons = labels.map((label, i) => ({
      label, fn: () => { hideModal(); resolve(i); }
    }));
    if (allowCancel) {
      buttons.push({ label: "跳过", fn: () => { hideModal(); resolve(null); } });
    }
    showModal(title, "", buttons);
  });
}

function showModal(title, body, buttons) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = body;
  const bb = document.getElementById("modal-buttons");
  bb.innerHTML = "";
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.textContent = b.label;
    btn.onclick = b.fn;
    if (b.primary) btn.classList.add("primary");
    bb.appendChild(btn);
  }
  document.getElementById("modal").classList.remove("hidden");
}
function hideModal() {
  document.getElementById("modal").classList.add("hidden");
}

// ============================================================
// 渲染
// ============================================================
function plantEmoji(g) {
  return { corn: "🌽", indigo: "🟦", sugar: "⬜", tobacco: "🟤", coffee: "☕", quarry: "🪨" }[g] || "❔";
}

function render() {
  // Topbar
  document.getElementById("game-info").textContent = `第 ${G.turnNumber} 回合 · 总督 👑 ${G.players[G.governor].name}`;
  // BGA风格顶部 prompt: 当前角色 + 当前玩家 + 跳过按钮
  const actionBar = document.getElementById("action-bar");
  let html = "";
  if (G._currentPrompt) {
    html += `<span class="prompt">${G._currentPrompt}</span>`;
  }
  if (pendingSelect && pendingSelect.allowSkip) {
    html += ` <button class="skip-btn" onclick="resolveBoardSelect(null)">跳过</button>`;
  }
  actionBar.innerHTML = html;
  // BGA 风格紧凑资源池：货物供应 + 银行
  document.getElementById("resources-info").innerHTML = `
    <div class="resource-block">
      <span class="rb-title">货物供应</span>
      ${GOODS.map(g => `<span class="rb-good good-${g}" title="${GOOD_NAMES[g]}">${G.supply[g]}</span>`).join("")}
    </div>
    <div class="resource-block">
      <span class="rb-title">银行</span>
      <span class="rb-item">👷${G.colonistsLeft}</span>
      <span class="rb-item">🚢${G.colonistsOnShip}</span>
      <span class="rb-item">⭐${G.vpLeft}</span>
      <span class="rb-item">🪨${G.quarriesLeft}</span>
    </div>
  `;

  // Roles
  const rolesDiv = document.getElementById("roles");
  rolesDiv.innerHTML = "";
  const roleClickMap = pendingSelect && pendingSelect.type === "role"
    ? new Map(pendingSelect.choices.map(c => [c.role, c.key]))
    : null;
  for (const r of G.roleCards) {
    const div = document.createElement("div");
    div.className = "role-card role-" + r.name;
    if (r.taken) div.classList.add("taken");
    if (roleClickMap && roleClickMap.has(r)) {
      div.classList.add("selectable");
      const idx = roleClickMap.get(r);
      div.onclick = () => resolveBoardSelect(idx);
    }
    div.innerHTML = `
      <div class="role-name">${ROLE_NAME_CN[r.name]}</div>
      <div class="role-bonus">${ROLE_BONUS[r.name]}</div>
      ${r.money ? `<div class="role-coin">${r.money}</div>` : ""}
    `;
    rolesDiv.appendChild(div);
  }

  // Plantations pool
  const planDiv = document.getElementById("plantations-pool");
  planDiv.innerHTML = "";
  const plantClickMap = pendingSelect && pendingSelect.type === "plantation"
    ? pendingSelect.choices
    : null;
  for (let i = 0; i < G.plantationPool.length; i++) {
    const g = G.plantationPool[i];
    const d = document.createElement("div");
    d.className = "plantation plant-" + g;
    d.textContent = GOOD_NAMES[g];
    d.dataset.poolIdx = i; // 用于动画源定位
    if (plantClickMap) {
      const choice = plantClickMap.find(c => c.opt.kind === "plant" && c.opt.idx === i);
      if (choice) {
        d.classList.add("selectable");
        d.onclick = () => resolveBoardSelect(choice.key);
      }
    }
    planDiv.appendChild(d);
  }
  if (G.quarriesLeft > 0) {
    const q = document.createElement("div");
    q.className = "plantation plant-quarry";
    q.dataset.poolQuarry = "1";
    q.innerHTML = "采石场<br>×" + G.quarriesLeft;
    if (plantClickMap) {
      const choice = plantClickMap.find(c => c.opt.kind === "quarry");
      if (choice) {
        q.classList.add("selectable");
        q.onclick = () => resolveBoardSelect(choice.key);
      }
    }
    planDiv.appendChild(q);
  }

  // Buildings pool — BGA 风格 4 行布局（按矿场折扣等级）
  const bldDiv = document.getElementById("buildings-pool");
  bldDiv.innerHTML = "";
  const bldClickMap = pendingSelect && pendingSelect.type === "building"
    ? new Map(pendingSelect.choices.map(c => [c.opt.b.id, { key: c.key, cost: c.opt.cost }]))
    : null;
  // 按 max quarry discount 分组
  const tierBuildings = [[], [], [], []];
  const tierByBid = {1:1,2:1,3:2,4:2,5:3,6:3,7:1,8:1,9:1,10:1,11:2,12:2,13:2,14:2,15:3,16:3,17:3,18:3,19:4,20:4,21:4,22:4,23:4};
  for (const b of BUILDINGS) {
    if (G.buildingStock[b.id] <= 0) continue;
    tierBuildings[tierByBid[b.id] - 1].push(b);
  }
  for (let tier = 0; tier < 4; tier++) {
    const row = document.createElement("div");
    row.className = "building-row";
    const label = document.createElement("div");
    label.className = "tier-label";
    label.innerHTML = `<span class="tier-num">${tier+1}</span> <span class="tier-icon">🪨</span>`;
    row.appendChild(label);
    for (const b of tierBuildings[tier]) {
    const left = G.buildingStock[b.id];
    const div = document.createElement("div");
    div.className = "building-card";
    div.dataset.bid = b.id;
    if (b.type === "violet") div.classList.add("violet");
    if (b.type === "large_violet") div.classList.add("large-violet");
    if (b.type === "production") div.classList.add("production");
    let costNote = "";
    if (bldClickMap && bldClickMap.has(b.id)) {
      const info = bldClickMap.get(b.id);
      div.classList.add("selectable");
      div.onclick = () => resolveBoardSelect(info.key);
      if (info.cost !== b.cost) costNote = ` (实付 ${info.cost})`;
    } else if (bldClickMap) {
      div.classList.add("disabled");
    }
    div.innerHTML = `
      <img src="assets/buildings/${b.img}" alt="${b.cn}">
      <div class="badge">×${left}</div>
      <div class="info"><span>${b.cn}</span><span>${b.cost}💰 ${b.vp}⭐${costNote}</span></div>
    `;
    row.appendChild(div);
    }
    bldDiv.appendChild(row);
  }

  // Ships + Trader
  const shipsDiv = document.getElementById("ships");
  shipsDiv.innerHTML = "";
  for (let s = 0; s < G.ships.length; s++) {
    const ship = G.ships[s];
    const div = document.createElement("div");
    div.className = "ship" + (ship.count >= ship.capacity ? " full" : "");
    div.innerHTML = `
      <div class="ship-header">船 ${s + 1} (${ship.count}/${ship.capacity})</div>
      <div class="ship-cargo">${ship.good ? plantEmoji(ship.good).repeat(ship.count) : "（空）"}</div>
    `;
    shipsDiv.appendChild(div);
  }
  const tr = document.createElement("div");
  tr.className = "trader";
  tr.innerHTML = `<div class="ship-header">贸易站 (${G.tradingHouse.length}/4)</div>
    <div class="trader-slots">${G.tradingHouse.map(g => plantEmoji(g)).join(" ")}</div>`;
  shipsDiv.appendChild(tr);

  // Players
  const pa = document.getElementById("players-area");
  pa.innerHTML = "";
  for (let i = 0; i < G.players.length; i++) {
    const p = G.players[i];
    const div = document.createElement("div");
    div.className = "player-board";
    div.dataset.player = i;
    if (i === G.governor) div.classList.add("governor");
    if (i === G._currentPlayer) div.classList.add("current");
    const totalVP = p.vp + G.getDisplayVPs(p);
    div.innerHTML = `
      <div class="player-header">
        <span class="player-name">${i === G.governor ? "👑 " : ""}${p.name}${p.isHuman ? " (你)" : " (AI)"}</span>
        <span class="player-stats">
          <span class="stat">💰${p.money}</span>
          <span class="stat">⭐${totalVP}</span>
          <span class="stat">👷${G.totalColonists(p)}</span>
        </span>
      </div>
      <div class="player-section">
        <h5>种植园 (${p.plantations.length}/12)</h5>
        <div class="plantation-grid">
          ${p.plantations.map(pl => `<div class="plantation plant-${pl.good}" title="${pl.manned ? '已上人' : '空岗'}">${pl.manned ? "👷" : ""}</div>`).join("")}
        </div>
      </div>
      <div class="player-section">
        <h5>建筑 (${G.buildingUsedSpaces(p)}/12)</h5>
        <div class="building-grid">
          ${p.buildings.map(b => {
            const bd = BLD_BY_ID[b.bid];
            return `<div class="mini-building" title="${bd.cn}">
              <img src="assets/buildings/${bd.img}">
              <div class="men">${"👷".repeat(b.men)}${"⚪".repeat(bd.men - b.men)}</div>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="player-section">
        <h5>货物</h5>
        <div class="goods-display">
          ${GOODS.filter(g => p.goods[g] > 0).map(g => `<span class="good good-${g}">×${p.goods[g]}</span>`).join("") || "<span style='color:#888'>（无）</span>"}
        </div>
      </div>
    `;
    pa.appendChild(div);
  }

  // Log
  const logDiv = document.getElementById("log");
  logDiv.innerHTML = G.log.slice(0, 30).map(e => `<div class="entry ${e.cls}">${e.msg}</div>`).join("");
}

// 显示玩家潜在 VP（含建筑+特殊）
Game.prototype.getDisplayVPs = function (p) {
  let vp = 0;
  for (const b of p.buildings) vp += BLD_BY_ID[b.bid].vp;
  vp += this.getSpecialVPs(p);
  return vp;
};

Game.prototype.getSpecialVPs = function (p) {
  let v = 0;
  // Guild Hall (19)
  if (this.isManned(p, 19)) {
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (bd.type === "production") v += (bd.men === 1 ? 1 : 2);
    }
  }
  // Residence (20)
  if (this.isManned(p, 20)) {
    const n = p.plantations.length;
    v += (n <= 9 ? 4 : n === 10 ? 5 : n === 11 ? 6 : 7);
  }
  // Fortress (21)
  if (this.isManned(p, 21)) {
    v += Math.floor(this.totalColonists(p) / 3);
  }
  // Customs House (22)
  if (this.isManned(p, 22)) {
    v += Math.floor(p.shippingVP / 4);
  }
  // City Hall (23)
  if (this.isManned(p, 23)) {
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (bd.type === "violet" || bd.type === "large_violet") v += 1;
    }
  }
  return v;
};

// ============================================================
// 游戏结束
// ============================================================
async function endGame() {
  // 计算最终得分
  const scores = G.players.map(p => {
    const base = p.vp;
    const buildingVP = p.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].vp, 0);
    const special = G.getSpecialVPs(p);
    const total = base + buildingVP + special;
    return { p, base, buildingVP, special, total };
  });
  scores.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    // tiebreaker: money + goods
    const tieA = a.p.money + GOODS.reduce((s, g) => s + a.p.goods[g], 0);
    const tieB = b.p.money + GOODS.reduce((s, g) => s + b.p.goods[g], 0);
    return tieB - tieA;
  });
  // 触发原因
  let endReason = "未知";
  if (G.colonistsLeft <= 0) endReason = "💀 殖民者用尽";
  else if (G.vpLeft <= 0) endReason = "⭐ VP 池用尽";
  else {
    for (const p of G.players) if (G.buildingUsedSpaces(p) >= 12) { endReason = `🏛 ${p.name} 建满12格`; break; }
  }
  // 详细分项
  const detailRows = scores.map((s, i) => {
    const p = s.p;
    const goodsCount = GOODS.reduce((sum, g) => sum + p.goods[g], 0);
    const tiebreak = p.money + goodsCount;
    // 特殊建筑细分
    const specialDetail = [];
    if (G.isManned(p, 19)) specialDetail.push(`公会大厅:${G.guildHallVPs ? G.guildHallVPs(p) : ""}`);
    if (G.isManned(p, 20)) specialDetail.push(`官邸:${p.plantations.length <= 9 ? 4 : p.plantations.length === 10 ? 5 : p.plantations.length === 11 ? 6 : 7}`);
    if (G.isManned(p, 21)) specialDetail.push(`城堡:${Math.floor(G.totalColonists(p)/3)}`);
    if (G.isManned(p, 22)) specialDetail.push(`海关大楼:${Math.floor(p.shippingVP/4)}`);
    if (G.isManned(p, 23)) specialDetail.push(`市政厅`);
    return `
      <tr style="background:${i === 0 ? '#4a6938' : 'transparent'}; border-bottom: 1px solid #444;">
        <td style="padding:6px 4px">${i === 0 ? "🏆 " : `${i+1}. `}${p.name}</td>
        <td style="text-align:center">${s.base}</td>
        <td style="text-align:center">${s.buildingVP}</td>
        <td style="text-align:center" title="${specialDetail.join(', ')}">${s.special}</td>
        <td style="text-align:center"><b style="color:#f3c969">${s.total}</b></td>
        <td style="text-align:center; font-size:11px; color:#999">${p.buildings.length}🏛 / ${p.plantations.length}🌱 / ${G.totalColonists(p)}👷 / ${p.money}💰 / ${goodsCount}📦</td>
      </tr>
    `;
  }).join("");
  const body = `
    <p style="color:#aaa; font-size:13px">结束原因：${endReason} | 第 ${G.turnNumber} 回合</p>
    <table style="width:100%; border-collapse: collapse;">
      <thead>
        <tr style="border-bottom: 2px solid #f3c969;">
          <th style="text-align:left; padding:4px">玩家</th>
          <th>船运</th><th>建筑</th><th>特殊</th><th>总分</th>
          <th style="font-size:11px;">建/种/工/钱/货</th>
        </tr>
      </thead>
      <tbody>${detailRows}</tbody>
    </table>
    <p>胜利者：<b style="color:#f3c969">${scores[0].p.name}</b>（${scores[0].total} VP）</p>
  `;
  showModal("🎉 游戏结束", body, [
    { label: "再玩一局", fn: () => location.reload(), primary: true },
  ]);
}
