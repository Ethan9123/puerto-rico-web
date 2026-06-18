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
  Buccaneer: "四选一海盗行动（仅你执行）",
};
const ROLE_TOOLTIP_DATA = {
  Settler: { action: "按顺序拿 1 个种植园；选择者可改拿采石场。", privilege: "选角者优先且可拿采石场。", tip: "适合：你缺关键种植园/要抢采石场；不适合：明牌没有你要的田，且会明显喂肥后手玩家。" },
  Mayor: { action: "补殖民者船并依次分配，选择者额外 +1 殖民者。", privilege: "额外拿 1 名殖民者。", tip: "适合：你有空岗要立刻启动建筑/种植园；不适合：你空岗少、却会让对手关键建筑全部上线。" },
  Builder: { action: "每位玩家可建 1 栋建筑。", privilege: "建造费用 -1 金币。", tip: "适合：你能靠 -1 提前达成强力建筑曲线；不适合：你没钱或只会帮对手先手拿走核心建筑。" },
  Craftsman: { action: "所有可生产位产货（需 manned 种植园 + 加工建筑容量；玉米只要 manned 种植园）。", privilege: "额外拿 1 个本回合已产出过的种类（场上无人产出则无可拿）。", tip: "适合：你能转化为卖货/装船分；不适合：你产不出货，反而给对手大量产能兑现。" },
  Trader: { action: "每位玩家可卖 1 种货到贸易站。", privilege: "卖货时额外 +1 金币。", tip: "适合：你有高价值货且贸易站位子对你有利；不适合：你无货或会先帮对手卖掉高价货。" },
  Captain: { action: "轮流装船得 VP，阶段末弃货（可仓库保留）。", privilege: "本阶段你首次装船额外 +1VP。", tip: "适合：你货多且能抢装船位；不适合：你货少且会让对手先清空大量高价货。" },
  Prospector: { action: "仅选择者执行。", privilege: "立即 +1 金币。", tip: "适合：你需要补 1 金完成关键建造阈值；不适合：场上有更高价值角色窗口可直接转分或卡位。" },
  Buccaneer: { action: "仅选择者执行：从 4 个海盗行动里选 1 个——劫掠(清空一艘货船，留≤3 货)、洗劫(清空贸易站，每货 +1VP)、突袭(殖民者堆削到每人 1 名，你留≤3 名)、劫持(占一个无人角色，拿其累积金币并执行该角色)。", privilege: "仅人类可选；不给其他玩家特权、自身不累积金币；持有奖励币时这一轮不可再选。", tip: "适合：用洗劫换 VP、或突袭卡住对手补人节奏；不适合：4 个行动当前对你都无明显收益时。" },
};
const ROLE_NAME_CN = {
  Settler: "拓殖者", Mayor: "市长", Builder: "建造师",
  Craftsman: "工匠", Trader: "商人", Captain: "船长", Prospector: "金矿主",
  Buccaneer: "海盗"
};

// 6 级 AI 难度（从弱到强；顶档为 AlphaZero 神经网络制导的 MCTS）
const AI_LEVEL_NAMES = {
  1: { cn: "入门", en: "Beginner",  desc: "只看自己面板" },
  2: { cn: "进化", en: "DNA",       desc: "700代进化AI" },
  3: { cn: "普通", en: "Normal",    desc: "看邻座+流派" },
  4: { cn: "困难", en: "Hard",      desc: "全场卡位+前瞻+策略" },
  5: { cn: "专家", en: "Expert",    desc: "MCTS 深搜·逐步深想" },
  6: { cn: "宗师", en: "AlphaZero", desc: "神经网络制导 MCTS（自训练）" },
};

// 设置界面可选难度阶梯（内部 _aiLevel 与显示序号一致）：
// 1=简单启发式, 2=DNA, 3=邻座启发式, 4=全场卡位强启发式, 5=ISMCTS 深搜, 6=AlphaZero NN+MCTS。
const SELECTABLE_LEVELS = [
  { internal: 1, label: "L1" },
  { internal: 2, label: "L2" },
  { internal: 3, label: "L3" },
  { internal: 4, label: "L4" },
  { internal: 5, label: "L5" },
  { internal: 6, label: "L6" },
];

// 23 建筑（来自 VBA Initial_Setup）
// id, name(中), 类型, 成本, 容人数, 胜利点, 占地, 是否大型, 数量
// type: production | violet | large_violet
const BUILDINGS = [
  // 生产建筑
  { id: 1,  name: "小靛蓝厂",    cn: "小靛蓝厂",    img: "01_small_indigo.jpg",    type: "production", cost: 1,  men: 1, vp: 1, size: 1, qty: 4, good: "indigo" },
  { id: 2,  name: "小制糖厂",    cn: "小制糖厂",    img: "02_small_sugar.jpg",     type: "production", cost: 2,  men: 1, vp: 1, size: 1, qty: 4, good: "sugar" },
  { id: 3,  name: "大靛蓝厂",    cn: "大靛蓝厂",    img: "03_large_indigo.jpg",    type: "production", cost: 3,  men: 3, vp: 2, size: 1, qty: 3, good: "indigo" },
  { id: 4,  name: "大制糖厂",    cn: "大制糖厂",    img: "04_large_sugar.jpg",     type: "production", cost: 4,  men: 3, vp: 2, size: 1, qty: 3, good: "sugar" },
  { id: 5,  name: "烟草仓库",    cn: "烟草仓库",    img: "05_tobacco_storage.jpg", type: "production", cost: 5,  men: 3, vp: 3, size: 1, qty: 3, good: "tobacco" },
  { id: 6,  name: "咖啡烘焙厂",  cn: "咖啡烘焙厂",  img: "06_coffee_roaster.jpg",  type: "production", cost: 6,  men: 2, vp: 3, size: 1, qty: 3, good: "coffee" },
  // 紫色小建筑
  { id: 7,  name: "小市场",      cn: "小市场",      img: "07_small_market.jpg",    type: "violet", cost: 1, men: 1, vp: 1, size: 1, qty: 2, effect: "trader_plus_1" },
  { id: 8,  name: "庄园",        cn: "庄园",        img: "08_hacienda.jpg",        type: "violet", cost: 2, men: 1, vp: 1, size: 1, qty: 2, effect: "settler_extra_plantation" },
  { id: 9,  name: "建筑工地",    cn: "建筑工地",    img: "09_construction_hut.jpg",type: "violet", cost: 2, men: 1, vp: 1, size: 1, qty: 2, effect: "settler_can_take_quarry" },
  { id: 10, name: "小仓库",      cn: "小仓库",      img: "10_small_warehouse.jpg", type: "violet", cost: 3, men: 1, vp: 1, size: 1, qty: 2, effect: "store_1_kind" },
  { id: 11, name: "济贫院",      cn: "济贫院",      img: "11_hospice.jpg",         type: "violet", cost: 4, men: 1, vp: 2, size: 1, qty: 2, effect: "settler_man_new_plantation" },
  { id: 12, name: "办公室",      cn: "办公室",      img: "12_office.jpg",          type: "violet", cost: 5, men: 1, vp: 2, size: 1, qty: 2, effect: "trader_duplicate" },
  { id: 13, name: "大市场",      cn: "大市场",      img: "13_large_market.jpg",    type: "violet", cost: 5, men: 1, vp: 2, size: 1, qty: 2, effect: "trader_plus_2" },
  { id: 14, name: "大仓库",      cn: "大仓库",      img: "14_large_warehouse.jpg", type: "violet", cost: 6, men: 1, vp: 2, size: 1, qty: 2, effect: "store_2_kinds" },
  { id: 15, name: "工厂",        cn: "工厂",        img: "15_factory.jpg",         type: "violet", cost: 7, men: 1, vp: 3, size: 1, qty: 2, effect: "craftsman_bonus" },
  { id: 16, name: "大学",        cn: "大学",        img: "16_university.jpg",      type: "violet", cost: 8, men: 1, vp: 3, size: 1, qty: 2, effect: "builder_extra_colonist" },
  { id: 17, name: "港口",        cn: "港口",        img: "17_harbour.jpg",         type: "violet", cost: 8, men: 1, vp: 3, size: 1, qty: 2, effect: "captain_bonus_vp" },
  { id: 18, name: "码头",        cn: "码头",        img: "18_wharf.jpg",           type: "violet", cost: 9, men: 1, vp: 3, size: 1, qty: 2, effect: "personal_ship" },
  // 紫色大建筑（4VP，占2格）
  { id: 19, name: "公会大厅",    cn: "公会大厅",    img: "19_guild_hall.jpg",      type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "guild_hall" },
  { id: 20, name: "官邸",        cn: "官邸",        img: "20_residence.jpg",       type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "residence" },
  { id: 21, name: "城堡",        cn: "城堡",        img: "21_fortress.jpg",        type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "fortress" },
  { id: 22, name: "海关大楼",    cn: "海关大楼",    img: "22_customs_house.jpg",   type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "customs" },
  { id: 23, name: "市政厅",      cn: "市政厅",      img: "23_city_hall.jpg",       type: "large_violet", cost: 10, men: 1, vp: 4, size: 2, qty: 1, effect: "city_hall" },
];
const BLD_BY_ID = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));
const BUILDING_EN = {
  1: "Small Indigo Plant", 2: "Small Sugar Mill", 3: "Large Indigo Plant", 4: "Large Sugar Mill", 5: "Tobacco Storage", 6: "Coffee Roaster",
  7: "Small Market", 8: "Hacienda", 9: "Construction Hut", 10: "Small Warehouse", 11: "Hospice", 12: "Office", 13: "Large Market",
  14: "Large Warehouse", 15: "Factory", 16: "University", 17: "Harbor", 18: "Wharf", 19: "Guild Hall", 20: "Residence", 21: "Fortress", 22: "Customs House", 23: "City Hall"
};
const BUILDING_EFFECT_TEXT = {
  1: "工匠阶段：有靛蓝种植园且有人镇守时生产靛蓝。小型生产建筑 1 工人槽。",
  2: "工匠阶段：有蔗糖种植园且有人镇守时生产蔗糖。小型生产建筑 1 工人槽。",
  3: "工匠阶段：有靛蓝种植园且有人镇守时生产靛蓝。大型生产建筑通常 3 工人槽。",
  4: "工匠阶段：有蔗糖种植园且有人镇守时生产蔗糖。大型生产建筑通常 3 工人槽。",
  5: "工匠阶段：有烟草种植园且有人镇守时生产烟草。大型生产建筑 3 工人槽。",
  6: "工匠阶段：有咖啡种植园且有人镇守时生产咖啡。咖啡烘焙厂为例外：2 工人槽。",
  7: "商人阶段：每次卖货 +1 金币。",
  8: "拓殖者阶段：拿明牌种植园前，从牌堆顶额外拿一张（不能是采石场）。",
  9: "拓殖者阶段：可改为拿一个采石场。",
  10: "船长阶段末可保留 +1 种全量货物。",
  11: "拓殖者阶段：新拿的种植园直接 +1 工人。",
  12: "商人阶段：可卖与贸易站现有相同种类的货物。",
  13: "商人阶段：每次卖货 +2 金币。",
  14: "船长阶段末可保留 +2 种全量货物。",
  15: "工匠阶段：按产货种类得 2种=1金 3种=2金 4种=3金 5种=5金。",
  16: "建造师阶段：建好建筑立即放 1 名殖民者上去。",
  17: "船长阶段：每次装船 +1 VP。",
  18: "船长阶段：可一次性把一种货物全部丢入供应区抵 VP（每阶段一次）。",
  19: "终局：每小型生产建筑+1VP，每大型生产建筑+2VP（需有人镇守）。大型紫色：占2格，需1工人激活。",
  20: "终局：占用 ≤9 格=4VP, 10=5, 11=6, 12=7（需有人镇守）。大型紫色：占2格，需1工人激活。",
  21: "终局：每 3 名殖民者 +1VP（含岸边，需有人镇守）。大型紫色：占2格，需1工人激活。",
  22: "终局：每 4 个船运 VP +1 VP（需有人镇守）。大型紫色：占2格，需1工人激活。",
  23: "终局：每紫色建筑 +1VP（需有人镇守，含自己）。大型紫色：占2格，需1工人激活。"
};
const TYPE_CN = { production: "生产", violet: "紫色", large_violet: "大型紫色" };
const TIER_BY_BID = {1:1,2:1,3:2,4:2,5:3,6:3,7:1,8:1,9:1,10:1,11:2,12:2,13:2,14:2,15:3,16:3,17:3,18:3,19:4,20:4,21:4,22:4,23:4};

// ============================================================
// 新建筑扩展 (官方 Expansion I — The New Buildings)
// 数值取自 BGG 该扩展官方文件 ExpansionBuildings_V2(标准费用→VP 阶梯)；效果对齐 Rio Grande Deluxe 规则书。
// 效果分阶段实装：终局类(雕像/修道院)已生效；局部/深逻辑效果见 P2/P3。
// 美术来自 San Juan(Franz Vohwinkel)同人卡表，仅限非商业使用。
// ============================================================
const EXPANSION_BUILDINGS = [
  { id:24, name:"Aqueduct",          cn:"引水渠",   img:"24_aqueduct.jpg",          type:"violet",       cost:1,  men:1, vp:1, size:1, qty:2, tier:1, effect:"aqueduct" },
  { id:25, name:"Black Market",      cn:"黑市",     img:"25_black_market.jpg",      type:"violet",       cost:2,  men:1, vp:1, size:1, qty:2, tier:1, effect:"black_market" },
  { id:26, name:"Forest House",      cn:"森林屋",   img:"26_forest_house.jpg",      type:"violet",       cost:2,  men:1, vp:1, size:1, qty:2, tier:1, effect:"forest_house" },
  { id:27, name:"Storehouse",        cn:"储藏库",   img:"27_storehouse.jpg",        type:"violet",       cost:3,  men:1, vp:1, size:1, qty:2, tier:1, effect:"storehouse" },
  { id:28, name:"Guesthouse",        cn:"招待所",   img:"28_guesthouse.jpg",        type:"violet",       cost:4,  men:2, vp:2, size:1, qty:2, tier:2, effect:"guesthouse" },
  { id:29, name:"Trading Post",      cn:"贸易驿站", img:"29_trading_post.jpg",      type:"violet",       cost:5,  men:1, vp:2, size:1, qty:2, tier:2, effect:"trading_post" },
  { id:30, name:"Church",            cn:"教堂",     img:"30_church.jpg",            type:"violet",       cost:5,  men:1, vp:2, size:1, qty:2, tier:2, effect:"church" },
  { id:31, name:"Small Wharf",       cn:"小码头",   img:"31_small_wharf.jpg",       type:"violet",       cost:6,  men:1, vp:2, size:1, qty:2, tier:2, effect:"small_wharf" },
  { id:32, name:"Lighthouse",        cn:"灯塔",     img:"32_lighthouse.jpg",        type:"violet",       cost:7,  men:1, vp:3, size:1, qty:2, tier:3, effect:"lighthouse" },
  { id:33, name:"Library",           cn:"图书馆",   img:"33_library.jpg",           type:"violet",       cost:8,  men:1, vp:3, size:1, qty:2, tier:3, effect:"library" },
  { id:34, name:"Specialty Factory", cn:"专业工厂", img:"34_specialty_factory.jpg", type:"violet",       cost:8,  men:1, vp:3, size:1, qty:2, tier:3, effect:"specialty_factory" },
  { id:35, name:"Union Hall",        cn:"工会大厅", img:"35_union_hall.jpg",        type:"violet",       cost:9,  men:1, vp:3, size:1, qty:2, tier:3, effect:"union_hall" },
  { id:36, name:"Cloister",          cn:"修道院",   img:"36_cloister.jpg",          type:"large_violet", cost:10, men:1, vp:4, size:2, qty:1, tier:4, effect:"cloister" },
  { id:37, name:"Statue",            cn:"雕像",     img:"37_statue.jpg",            type:"large_violet", cost:10, men:0, vp:8, size:2, qty:1, tier:4, effect:"statue" },
];
// 贵族扩展 (官方 Expansion II — The Nobles)：7 紫色 + 1 生产(珠宝匠) + 20 贵族
// 数值取自周年版图鉴：地产办2/1 礼拜堂3/1 狩猎小屋4/2 规划办5/2 皇家供应商6/2 别墅7/3 珠宝匠8/3 皇家花园10/4(大)
const NOBLE_BUILDINGS = [
  { id:38, name:"Land Office",     cn:"地产办公室", img:"38_land_office.jpg",   type:"violet",       cost:2,  men:1, vp:1, size:1, qty:2, tier:1, effect:"land_office" },
  { id:39, name:"Chapel",          cn:"礼拜堂",     img:"39_chapel.jpg",        type:"violet",       cost:3,  men:1, vp:1, size:1, qty:2, tier:1, effect:"chapel" },
  { id:40, name:"Hunting Lodge",   cn:"狩猎小屋",   img:"40_hunting_lodge.jpg", type:"violet",       cost:4,  men:1, vp:2, size:1, qty:2, tier:2, effect:"hunting_lodge" },
  { id:41, name:"Construction Office", cn:"营建办公室", img:"41_zoning_office.jpg", type:"violet",   cost:5,  men:1, vp:2, size:1, qty:2, tier:2, effect:"zoning_office" }, // 官方名 Construction Office（德 Bauamt；旧译 Zoning/规划办公室）；图沿用 41_zoning_office.jpg
  { id:42, name:"Royal Supplier",  cn:"皇家供应商", img:"42_royal_supplier.jpg",type:"violet",       cost:6,  men:1, vp:2, size:1, qty:2, tier:2, effect:"royal_supplier" },
  { id:43, name:"Villa",           cn:"别墅",       img:"43_villa.jpg",         type:"violet",       cost:7,  men:1, vp:3, size:1, qty:2, tier:3, effect:"villa" },
  { id:44, name:"Jeweler",         cn:"珠宝匠",     img:"44_jeweler.jpg",       type:"production",   cost:8,  men:1, vp:3, size:1, qty:2, tier:3, effect:"jeweler" }, // 官方定位=生产建筑：市政厅不计入、公会大厅按大型生产建筑计 2VP（特判）、2p 库存 2 栋
  { id:45, name:"Royal Garden",    cn:"皇家花园",   img:"45_royal_garden.jpg",  type:"large_violet", cost:10, men:1, vp:4, size:2, qty:1, tier:4, effect:"royal_garden" },
];
Object.assign(BLD_BY_ID, Object.fromEntries(NOBLE_BUILDINGS.map(b => [b.id, b])));
Object.assign(TIER_BY_BID, { 38:1, 39:1, 40:2, 41:2, 42:2, 43:3, 44:3, 45:4 });
Object.assign(BUILDING_EN, { 38:"Land Office", 39:"Chapel", 40:"Hunting Lodge", 41:"Construction Office", 42:"Royal Supplier", 43:"Villa", 44:"Jeweler", 45:"Royal Garden" });
Object.assign(BUILDING_EFFECT_TEXT, {
  38:"商人阶段（可在卖货之外额外使用）：殖民者驻守→付 1 金从暗牌堆抽 1 张种植园放上岛；贵族驻守→弃 1 张种植园/森林（非采石场）得 1 金。",
  39:"工匠阶段：殖民者驻守→+1 金；贵族驻守→+1 VP。",
  40:"拓殖阶段末：殖民者驻守→可弃 1 张种植园/森林；贵族驻守→若你岛上空格【独多】+2 VP。",
  41:"建造阶段：殖民者驻守→1~3 列建筑 -1 金；贵族驻守→第 4 列大建筑 -2 金。",
  42:"船长阶段首次装船前：每有 1 名贵族可弃 1 个货（须不同种）入供应区，每个 +1 VP（不吃港口/灯塔加成）。",
  43:"市长阶段：额外从供应区拿 1 名贵族（没有贵族则拿殖民者）。",
  44:"工匠阶段：你板上每有 1 名贵族 +1 金。公会大厅按大型生产建筑计 2VP。",
  45:"终局：你板上每名贵族额外 +1 VP（贵族变 2 VP/个）。占 2 格。",
});

const BASE_BUILDINGS = BUILDINGS.slice(); // 原始 23 个基础建筑的纯净副本（轮抽会改 BUILDINGS，构造时据此复原）
// 查询表/文本始终登记扩展建筑（是否「激活进市场」由 Game 构造时的 BUILDINGS 数组控制）
Object.assign(BLD_BY_ID, Object.fromEntries(EXPANSION_BUILDINGS.map(b => [b.id, b])));
Object.assign(TIER_BY_BID, { 24:1,25:1,26:1,27:1,28:2,29:2,30:2,31:2,32:3,33:3,34:3,35:3,36:4,37:4 });
Object.assign(BUILDING_EN, { 24:"Aqueduct",25:"Black Market",26:"Forest House",27:"Storehouse",28:"Guesthouse",29:"Trading Post",30:"Church",31:"Small Wharf",32:"Lighthouse",33:"Library",34:"Specialty Factory",35:"Union Hall",36:"Cloister",37:"Statue" });
Object.assign(BUILDING_EFFECT_TEXT, {
  24:"工匠阶段：用【大靛蓝厂/大制糖厂】生产时，该货 +1。",
  25:"建造阶段：建造时可还 1货 + 1殖民者(岸边或板块上,黑市自身除外) + 1VP 各抵 1 金（最多 -3，且建完不能剩钱）。",
  26:"拓殖阶段：可改拿「森林」——翻扣 1 张明牌种植园置于岛上；每 2 块森林使建造 -1 金（不受采石场列限、不上工人）。",
  27:"船长阶段末：除正常保留外，额外保留任意 3 个货物。",
  28:"招待所(2 工人槽)：把最多 2 个殖民者停在此当「客工」。官方：客工可在任意阶段、任意时点派往任意空位立即上岗（本实现在每个非市长阶段开始时给出派遣机会）；上岗后须工作到下个市长阶段。",
  29:"商人阶段：可把 1 个货物卖给【自己的】贸易站（任意货、含重复、即使公共站满），按价得金，货入供应区（市场不加成）。",
  30:"建造阶段：建造时按建筑列额外 +0/1/2 VP。",
  31:"船长阶段：自有船；装运货物每 2 个 = 1 VP（货入供应区）。",
  32:"船长阶段：每次装运（含码头/小码头）+1 金；选择船长角色者，阶段开始额外 +1 金（不论是否装货）。",
  33:"各阶段：你选到角色的【特权翻倍】（工匠+2货(可同种)、拓殖者末再拿1张田、建造-2金、商人/船长/金矿主/市长特权×2）。",
  34:"工匠阶段：得金 = 产量最多的单一货物(非玉米)数量 − 1。",
  35:"船长阶段：首次装船前，手上每 2 个同种货物 +1 VP。",
  36:"终局：每 3 张同类【岛屿地块】(含采石场/森林)成套 → 1/2/3/4 套得 1/3/6/10 VP（需镇守）。占 2 格。",
  37:"终局：建筑本身即 8 VP（计入建筑分）；不可放工人。占 2 格。",
});

// ============================================================
// Tibs 自制扩展（同人，来自 TTS "Puerto Rico (Tibs Edition)"）
// 非官方；规则按卡面缩写裁定。仅 expansion==="tibs" 时进市场（不影响官方局与 AI 训练/评测）。
// cost/tier 已折算到引擎的金币造价→VP 阶梯；标注[简化]者为避免新增持久状态而做的合理裁定。
// ============================================================
const TIBS_BUILDINGS = [
  { id:46, name:"Gold Mine",       cn:"金矿",   img:"46_gold_mine.jpg",       type:"violet",       cost:1,  men:2, vp:1, size:1, qty:2, tier:1, effect:"gold_mine" },
  { id:47, name:"Well",            cn:"水井",   img:"47_well.jpg",            type:"violet",       cost:3,  men:1, vp:1, size:1, qty:2, tier:2, effect:"well" },
  { id:48, name:"Boarding House",  cn:"寄宿屋", img:"48_boarding_house.jpg",  type:"violet",       cost:4,  men:1, vp:2, size:1, qty:2, tier:2, effect:"boarding_house" },
  { id:49, name:"Tower",           cn:"塔楼",   img:"49_tower.jpg",           type:"violet",       cost:4,  men:1, vp:2, size:1, qty:2, tier:2, effect:"tower" },
  { id:50, name:"Customs Station", cn:"海关站", img:"50_customs_station.jpg", type:"violet",       cost:8,  men:1, vp:3, size:1, qty:2, tier:3, effect:"customs_station" },
  { id:51, name:"Archive",         cn:"档案馆", img:"51_archive.jpg",         type:"violet",       cost:8,  men:1, vp:3, size:1, qty:2, tier:3, effect:"archive" },
  { id:52, name:"Bank",            cn:"银行",   img:"52_bank.jpg",            type:"violet",       cost:8,  men:1, vp:4, size:1, qty:2, tier:3, effect:"bank" },
  { id:53, name:"Cathedral",       cn:"大教堂", img:"53_cathedral.jpg",       type:"large_violet", cost:10, men:1, vp:4, size:2, qty:1, tier:4, effect:"cathedral" },
];
Object.assign(BLD_BY_ID, Object.fromEntries(TIBS_BUILDINGS.map(b => [b.id, b])));
Object.assign(TIER_BY_BID, { 46:1, 47:2, 48:2, 49:2, 50:3, 51:3, 52:3, 53:4 });
Object.assign(BUILDING_EN, { 46:"Gold Mine", 47:"Well", 48:"Boarding House", 49:"Tower", 50:"Customs Station", 51:"Archive", 52:"Bank", 53:"Cathedral" });
// 规则取自 mod 内嵌 Building Rules（Tibs 原文，权威）
Object.assign(BUILDING_EFFECT_TEXT, {
  46:"工匠阶段：满员（2 殖民者）时可把两名殖民者移回岸边(San Juan) + 拿 1 金。仅 1 人时无效。需 2 工人槽。",
  47:"工匠阶段：若你生产了玉米或靛蓝，可额外多产 1 个（两者只能择一）。镇守生效。",
  48:"拓殖阶段：你拿到的明牌种植园/采石场自带 1 名殖民者（供应区→没有则从殖民者堆）。镇守生效。",
  49:"被动：当其他玩家选择某角色时，你也获得该角色的【特权】（你当总督起始位时除外）。镇守生效。",
  50:"船长阶段：选船长 +1 VP；阶段末每艘满货船清空时，你各得回 1 个该船的货（在存货之后，不腐坏、不触发档案馆等）。镇守生效。",
  51:"船长阶段末：除免费保留 1 桶外，每种货各可保留 1 桶，并立即按保留的货物种类数 +1 VP/种。镇守生效。",
  52:"投资机制：建造银行时可投入≤8 枚未花的金币；贵族驻守时你每选 1 个角色可投 1 金（累计上限 8）。投入的金不可再用。终局每枚投资 +1 VP。",
  53:"终局：每个【其他玩家】拥有的大型建筑 +2 VP（无需镇守对方建筑）。占 2 格，需镇守本建筑。",
});

// 无美术资源的建筑（贵族扩展 38+）用文字占位卡面，避免 404 / 裂图
function bldImgHtml(b) {
  if (b.img) return `<img src="assets/buildings/${b.img}" alt="${b.cn}">`;
  return `<div class="img-placeholder" style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;min-height:48px;background:linear-gradient(135deg,#6b5b8e,#4a3f63);color:#f0e6d2;font-size:12px;text-align:center;border-radius:4px;">🏛️<span>${b.cn}</span></div>`;
}

function buildBuildingTooltip(b) {
  return `
    <div class="tt-title">${b.cn} · ${BUILDING_EN[b.id]}</div>
    <div class="tt-meta">成本 ${b.cost}💰 · ${b.vp}⭐ · ${b.men}工人槽 · ${TYPE_CN[b.type]}</div>
    <div class="tt-meta">采石场折扣上限：${TIER_BY_BID[b.id]} 金币</div>
    <div class="tt-effect">${BUILDING_EFFECT_TEXT[b.id]}</div>
  `;
}
// 计算"如果现在选 Mayor，每人能拿多少"
function getMayorPreview() {
  if (typeof G === 'undefined' || !G || !G.players) return null;
  const n = G.numPlayers;
  const shipK = G.colonistsOnShip || 0;
  const supply = G.colonistsLeft || 0;
  // 顺时针从 chooser(=pos0) 逐个分发；chooser 拿到 ⌈shipK/n⌉ 个
  const base = n > 0 ? Math.floor(shipK / n) : 0;
  const extra = n > 0 ? (shipK % n) : 0;
  const chooserFromShip = base + (extra > 0 ? 1 : 0);
  const chooserBonus = supply > 0 ? 1 : 0;
  return { shipTotal: shipK, supply, base, extra, chooserFromShip, chooserBonus, chooserTotal: chooserFromShip + chooserBonus };
}
function getCaptainPreview() {
  if (typeof G === 'undefined' || !G || !G.ships) return null;
  const ships = G.ships.map((s, i) => `船${i+1} ${s.count}/${s.capacity}${s.good ? ` (${GOOD_NAMES[s.good]})` : ' 空'}`);
  return { ships };
}
function getTraderPreview() {
  if (typeof G === 'undefined' || !G || !G.tradingHouse) return null;
  return { used: G.tradingHouse.length, cap: 4, full: G.tradingHouse.length === 4 };
}

function buildRoleTooltip(roleName) {
  const d = ROLE_TOOLTIP_DATA[roleName];
  if (!d) return `<div class="tt-title">${ROLE_NAME_CN[roleName] || roleName}</div>`; // 防御：未登记的角色不致 render 崩溃
  let extra = '';
  if (roleName === 'Mayor') {
    const m = getMayorPreview();
    if (m) {
      extra = `<div class="tt-effect" style="border-top:1px solid #555;margin-top:6px;padding-top:6px;">
        <b>当前状态：</b>船上 ${m.shipTotal} 殖民者，供应 ${m.supply} 殖民者<br>
        若你选 [市长]：船 +${m.chooserFromShip}，特权 +${m.chooserBonus}，<b>共 ${m.chooserTotal} 人</b>
      </div>`;
    }
  } else if (roleName === 'Captain') {
    const c = getCaptainPreview();
    if (c) extra = `<div class="tt-effect" style="border-top:1px solid #555;margin-top:6px;padding-top:6px;"><b>当前船况：</b><br>${c.ships.join('<br>')}</div>`;
  } else if (roleName === 'Trader') {
    const t = getTraderPreview();
    if (t) extra = `<div class="tt-effect" style="border-top:1px solid #555;margin-top:6px;padding-top:6px;"><b>贸易站：</b>${t.used}/${t.cap}${t.full ? '（满，阶段末清空）' : ''}</div>`;
  }
  return `<div class="tt-title">${ROLE_NAME_CN[roleName]} · ${roleName}</div>
    <div class="tt-meta"><b>行动：</b>${d.action}</div>
    <div class="tt-meta"><b>特权：</b>${d.privilege}</div>
    <div class="tt-effect"><b>时机提示：</b>${d.tip}</div>${extra}`;
}

function rankCaptainCandidates(candidates, ships) {
  const score = (c) => {
    if (c.ship === "wharf" || c.ship === "smallwharf") return -1;
    const ship = ships[c.ship];
    const rem = ship.capacity - ship.count;
    const sameKind = ship.good === c.good ? 1 : 0;
    return sameKind * 1000 + rem * 10 + (c.amount || 0);
  };
  return candidates.slice().sort((a, b) => score(b) - score(a));
}
window.rankCaptainCandidates = rankCaptainCandidates;

// AI 装船：装船效率为主；早/中期额外倾向运便宜货(玉米/靛蓝/糖)，
// 把咖啡/烟草留给商人换钱(早期金>分)；后期不再保留、全力运分。
function rankCaptainForAI(candidates, ships, phase) {
  const score = (c) => {
    if (c.ship === "wharf" || c.ship === "smallwharf") return -1; // 私人船留作最后手段
    const ship = ships[c.ship];
    const rem = ship.capacity - ship.count;
    const sameKind = ship.good === c.good ? 1 : 0;
    let s = sameKind * 1000 + rem * 10 + (c.amount || 0);
    if (phase !== "late") s += (4 - GOOD_PRICE[c.good]) * 60; // 便宜货优先(corn+240…coffee+0)
    return s;
  };
  return candidates.slice().sort((a, b) => score(b) - score(a));
}

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
  // 扩展模块归一化：第3参兼容【旧字符串】(none/newbuildings/nobles/tibs，累积语义)
  // 与【新对象】({newBuildings,nobles,tibsBuildings,festival,buccaneer}，独立任意组合)。
  static normalizeModules(expansion, buccaneer) {
    if (expansion && typeof expansion === "object") {
      return {
        newBuildings:  !!expansion.newBuildings,
        nobles:        !!expansion.nobles,
        tibsBuildings: !!expansion.tibsBuildings,
        festival:      !!expansion.festival,
        buccaneer:     !!expansion.buccaneer,
      };
    }
    const s = (expansion === true) ? "newbuildings" : (expansion || "none");
    const tibsB = s === "tibs";
    return {
      newBuildings:  s === "newbuildings" || s === "nobles" || s === "tibs",
      nobles:        s === "nobles" || s === "tibs",
      tibsBuildings: tibsB,
      festival:      tibsB,                 // 旧语义：tibs 自动开节庆
      buccaneer:     tibsB && !!buccaneer,  // 旧语义：tibs 且勾选才开海盗
    };
  }

  constructor(numPlayers, humanName, expansion, buccaneer) {
    this.numPlayers = numPlayers;
    // —— 5 个独立扩展模块开关（可任意组合）；旧字符串经 normalizeModules 映射为累积集合 ——
    const mods = Game.normalizeModules(expansion, buccaneer);
    this.mods = mods;
    this.modNewBuildings  = mods.newBuildings;   // 新建筑(24-37) + 建筑轮抽
    this.modNobles        = mods.nobles;         // 贵族棋子机制 + 贵族建筑(38-45)（同一开关，避免“有贵族建筑无贵族棋子”）
    this.modTibsBuildings = mods.tibsBuildings;  // Tibs 自制建筑(46-53)（寄宿屋48取代济贫院11）
    this.modFestival      = mods.festival;       // 节庆竞速目标
    this.modBuccaneer     = mods.buccaneer;      // 第 8 角色海盗（仅人类）
    // 旧字段名保留为派生别名（下游 ~40 处 expansion*/module* 读取无需改动）：
    this.expansion       = this.modNewBuildings;   // 语义收窄：只 gate 新建筑池(24-37)+轮抽
    this.expansionNobles = this.modNobles;         // 1:1
    this.expansionTibs   = this.modTibsBuildings;  // 语义收窄：只代表 Tibs 建筑池(46-53)
    // 新建筑扩展：把全局 BUILDINGS 从纯净基础副本复原（轮抽可能改过它），启用时追加扩展建筑。
    // （BUILDINGS 是市场/库存/sim 的唯一建筑来源；构造时控制它即可整体开关扩展。）
    BUILDINGS.length = 0;
    // Tibs 版把官方【济贫院 Hospice(11)】改名重做为【寄宿屋 Boarding House(48)】(对采石场也生效)。
    // 故 Tibs 局用 48 取代 11，从可买池排除 11，避免同一局里两张近乎相同的建筑并存(忠实 mod)。
    // 非 Tibs 局(基础/新建筑/贵族)保留济贫院(11)不变。BLD_BY_ID[11] 仍在(查表不受影响)。
    for (const b of BASE_BUILDINGS) { if (this.expansionTibs && b.id === 11) continue; BUILDINGS.push(b); }
    if (this.expansion) for (const b of EXPANSION_BUILDINGS) BUILDINGS.push(b);
    if (this.expansionNobles) for (const b of NOBLE_BUILDINGS) BUILDINGS.push(b);
    if (this.expansionTibs) for (const b of TIBS_BUILDINGS) BUILDINGS.push(b);
    this.players = [];
    for (let i = 0; i < numPlayers; i++) {
      this.players.push(this.newPlayer(i, i === 0 ? humanName : `电脑P${i}`, i === 0));
    }
    this.governor = Math.floor(Math.random() * numPlayers);
    this.currentRoleIdx = -1;
    this.turnNumber = 1;
    this.gameOver = false;
    this.endTriggered = false;

    // 资源池
    // 1p=单人闯关(缩放) / 2p=官方Alea变体(殖民者40+2=42,65VP) / 3-5p=原版
    this.colonistsLeft = { 1: 30, 2: 42, 3: 55, 4: 75, 5: 95 }[numPlayers] - numPlayers; // 减去船上人数
    this.colonistsOnShip = numPlayers;
    // 贵族扩展：20 名贵族；开局起殖民者船上 1 名贵族替换 1 名殖民者
    this.noblesLeft = 0; this.noblesOnShip = 0;
    if (this.expansionNobles) {
      this.noblesLeft = 19; // 20 - 1（开局上船）
      this.noblesOnShip = 1;
      this.colonistsOnShip -= 1;
      this.colonistsLeft += 1; // 船上少 1 名殖民者，留在供应区
    }
    this.vpLeft = { 1: 50, 2: 65, 3: 75, 4: 100, 5: 122 }[numPlayers];

    // 货物供应（原版实物数量：玉米10/靛蓝12/蔗糖11/烟草9/咖啡8；2p 官方变体：每种 -2）
    this.supply = ({
      2: { corn: 8, indigo: 10, sugar: 9, tobacco: 7, coffee: 6 },
    })[numPlayers] || { corn: 10, indigo: 12, sugar: 11, tobacco: 9, coffee: 8 };

    // 建筑供应（2p 官方变体：每种生产建筑 2 栋、每种紫色建筑 1 栋）
    this.buildingStock = {};
    BUILDINGS.forEach(b => {
      this.buildingStock[b.id] = (numPlayers === 2) ? (b.type === "production" ? 2 : 1) : b.qty;
    });

    // 种植园（2p 变体：移除 3 个采石场 → 5 个）
    this.quarriesLeft = (numPlayers === 2) ? 5 : 8;
    this.plantationDeck = this.makePlantationDeck();
    this.plantationDiscard = [];
    this.plantationPool = [];

    // 船：3/4/5 玩家时船容量为 4/5/6, 5/6/7, 6/7/8；1/2 玩家用官方变体的 2 艘船(容量 4 与 6)
    this.ships = [];
    if (numPlayers <= 2) {
      for (const cap of [4, 6]) this.ships.push({ capacity: cap, good: null, count: 0 });
    } else {
      for (let i = 0; i < 3; i++) this.ships.push({ capacity: numPlayers + 1 + i, good: null, count: 0 });
    }
    // 贸易站
    this.tradingHouse = []; // 上限 4

    // 角色卡（1p 闯关 & 2p 变体都用全部 7 张：6 个独特 + 1 个金矿主；3p=6, 4p=7, 5p=8）
    this.roleCount = { 1: 7, 2: 7, 3: 6, 4: 7, 5: 8 }[numPlayers];
    this.roles = ROLE_LIST.slice(0, Math.min(this.roleCount, 7));
    // role obj: { name, money, taken }
    // Prospector 重复一次以达到 8 个 (5玩家)
    const usedNames = ROLE_LIST.slice();
    if (this.roleCount === 8) usedNames.push("Prospector");
    this.roleCards = usedNames.slice(0, this.roleCount).map(n => ({ name: n, money: 0, taken: false, takenBy: null }));
    // Tibs 海盗模块：额外加 1 张 Buccaneer 角色卡（仅人类可选，AI/ sim 不参与，避免冲击 7 角色 AI）
    this._buccaneerReward = -1; // 持有奖励币的玩家(=不可再选 Buccaneer)，-1=无
    if (this.modBuccaneer) {
      this.roleCards.push({ name: "Buccaneer", money: 0, taken: false, takenBy: null });
    }

    // 起始首页朝上的种植园数 = 玩家+1
    this.flipPlantations();

    // 起始种植园：
    // 3p: 1st=Indigo, 2nd=Indigo, 3rd=Corn
    // 4p: 1st=I, 2nd=I, 3rd=Corn, 4th=Corn
    // 5p: 1st=I, 2nd=I, 3rd=I, 4th=C, 5th=C
    // 第 1 顺位 = 总督，按顺时针展开发牌
    const startingPlant = {
      1: ["indigo"],
      2: ["indigo", "corn"],            // 总督=靛蓝，次席=玉米（官方 2p 变体）
      3: ["indigo", "indigo", "corn"],
      4: ["indigo", "indigo", "corn", "corn"],
      5: ["indigo", "indigo", "indigo", "corn", "corn"],
    }[numPlayers];
    for (let step = 0; step < numPlayers; step++) {
      const idx = (this.governor + step) % numPlayers;
      this.players[idx].plantations.push({ good: startingPlant[step], manned: false });
    }

    // 起始金币：1p=2, 2p=3(官方变体), 否则玩家数-1
    const startMoney = { 1: 2, 2: 3 }[numPlayers] ?? (numPlayers - 1);
    for (let p of this.players) p.money = startMoney;

    // 节庆模块（独立开关）：3 个竞速目标
    this.moduleFestival = this.modFestival;
    // 海盗模块（独立开关）：第 8 个角色海盗（仅人类可选）
    this.moduleBuccaneer = this.modBuccaneer;
    this.log = [];
    this.logEvent(`游戏开始：${numPlayers} 玩家`);
    this.logEvent(`抽选首任总督：${this.players[this.governor].name}`, 'role');
    if (this.moduleFestival) this.setupFestival();
    // 给人类玩家提示他们的顺位与起始田
    const humanPlayer = this.players.find(p => p.isHuman);
    if (humanPlayer) {
      const seat = ((humanPlayer.idx - this.governor) + numPlayers) % numPlayers + 1;
      const startGood = humanPlayer.plantations[0].good;
      this.logEvent(`你是第 ${seat} 顺位（起始 ${GOOD_NAMES[startGood] || startGood} 田）`, 'role');
    }
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
      _invest: 0,            // Tibs 银行(52)：已投资金币（终局每枚 +1VP，不可再用）
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
      1: { corn: 7, indigo: 9, sugar: 8, tobacco: 6, coffee: 5 },
      2: { corn: 6, indigo: 8, sugar: 8, tobacco: 6, coffee: 5 }, // 全套每种 -3（官方 2p 变体），再扣 2 张起始田（1玉米+1靛蓝）
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
  // 某玩家是否在做某货（有该货种植园，或非玉米时拥有对应加工厂）——用于垄断/撞货判断
  playerProduces(p, g) {
    if (p.plantations.some(pl => pl.good === g)) return true;
    const ref = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] }[g];
    return !!(ref && ref.some(bid => this.ownsBuilding(p, bid)));
  }
  anyOpponentProduces(me, g) {
    for (const p of this.players) { if (p === me) continue; if (this.playerProduces(p, g)) return true; }
    return false;
  }
  isManned(p, bid) {
    const b = this.ownsBuilding(p, bid);
    return b && b.men >= BLD_BY_ID[bid].men;
  }
  // Tibs 塔楼(49)：当【别人】选角色时，镇守塔楼的非总督玩家也获得该角色特权。
  // 用法：在各阶段对【非选择者】判定 towerActive(p) 即与"选择者特权"等价处理。
  towerActive(p) {
    return this.expansionTibs && this.isManned(p, 49) && p.idx !== this.governor;
  }
  totalColonists(p) {
    let n = 0;
    for (const pl of p.plantations) if (pl.manned) n++;
    for (const b of p.buildings) n += b.men;
    n += (p._unplacedMen || 0); // 岸边的也算（用于 Fortress 计分）
    n += (p._unplacedNobles || 0); // 贵族按殖民者计（Fortress 官方规则）
    return n;
  }
  // 贵族扩展：玩家板上（含岸边）的贵族总数。b.men 含贵族，b.nobles 是其中贵族数；田用 pl.noble 标记。
  nobleCount(p) {
    let n = p._unplacedNobles || 0;
    for (const pl of p.plantations) if (pl.manned && pl.noble) n++;
    for (const b of p.buildings) n += (b.nobles || 0);
    return n;
  }
  // 某建筑是否被贵族驻守（用于礼拜堂/狩猎小屋/规划办的贵族功能；1 槽建筑非贵即民）
  isNobleManned(p, bid) {
    const b = this.ownsBuilding(p, bid);
    return !!(b && (b.nobles || 0) >= 1);
  }
  // 某建筑是否被殖民者驻守（贵族功能与殖民者功能互斥）
  isColonistManned(p, bid) {
    const b = this.ownsBuilding(p, bid);
    return !!(b && b.men - (b.nobles || 0) >= 1);
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
    // 采石场折扣：每个有人采石场 -1，上限 = 该建筑所在费用列（TIER_BY_BID 已含扩展 24-37）
    const maxQuarries = TIER_BY_BID[bld.id] || 1;
    let qManned = 0;
    for (const pl of p.plantations) if (pl.good === "quarry" && pl.manned) qManned++;
    // 扩展：森林屋 — 每 2 块森林 -1（不受费用列上限）
    const forestDiscount = Math.floor(p.plantations.filter(pl => pl.good === "forest").length / 2);
    // 扩展II：规划办公室(41) — 殖民者驻守：1~3 列建筑 -1；贵族驻守：第 4 列大建筑 -2
    let zoning = 0;
    const colTier = TIER_BY_BID[bld.id] || 1;
    if (colTier <= 3 && this.isColonistManned(p, 41)) zoning = 1;
    if (colTier >= 4 && this.isNobleManned(p, 41)) zoning = 2;
    return Math.max(0, bld.cost - Math.min(qManned, maxQuarries) - forestDiscount - zoning);
  }

  // 玩家可用的"小奖励金"：当前选角色的玩家在 Builder 阶段额外 -1（图书馆 -2）
  effectiveCostWithRoleBonus(p, bld, isRoleChooser) {
    let c = this.effectiveCost(p, bld);
    if (isRoleChooser) c = Math.max(0, c - (this.isManned(p, 33) ? 2 : 1)); // 图书馆：建造特权翻倍
    return c;
  }

  // 扩展：黑市(25) — 建造时可还 1货 + 1工人(岸边) + 1VP 各抵 1 金（最多 3）。
  // AI 不为建造牺牲 VP（只用货+岸边工人）。
  blackMarketCapacity(p) {
    if (!this.isManned(p, 25)) return 0;
    const hasGood = GOODS.some(g => p.goods[g] > 0) ? 1 : 0;
    // 规则书：可归还任意 1 名殖民者（岸边或板块上），但不能是黑市上那个。AI 只用岸边的（合法子集）。
    const hasTileCol = p.isHuman && (
      p.plantations.some(pl => pl.manned) ||
      p.buildings.some(b => b.men > 0 && !(b.bid === 25 && b.men === 1))
    );
    const hasCol = ((p._unplacedMen || 0) > 0 || hasTileCol) ? 1 : 0;
    const hasVP = (p.isHuman && p.vp > 0) ? 1 : 0;
    return Math.min(3, hasGood + hasCol + hasVP);
  }
  payWithBlackMarket(p, gap) {
    let need = gap;
    if (need > 0) { // 退最便宜的 1 货
      const g = GOODS.slice().sort((a, b) => GOOD_PRICE[a] - GOOD_PRICE[b]).find(gg => p.goods[gg] > 0);
      if (g) { p.goods[g]--; this.supply[g]++; need--; this.logEvent(`${p.name} 黑市：还 1 ${GOOD_NAMES[g]} 抵 1 金`, "action"); }
    }
    if (need > 0 && (p._unplacedMen || 0) > 0) { p._unplacedMen--; this.colonistsLeft++; need--; this.logEvent(`${p.name} 黑市：还 1 殖民者 抵 1 金`, "action"); }
    if (need > 0 && p.vp > 0) { p.vp--; this.vpLeft++; need--; this.logEvent(`${p.name} 黑市：还 1 VP 抵 1 金`, "action"); }
    return gap - need;
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

// 全 AI 观战模式的节奏（让人类能看清每一步）：
//   - 每个 AI 操作（选角色+执行阶段）后停 5 秒
//   - 一个大回合（所有人操作完、换起始玩家前）后停 10 秒
const SPECTATOR_ACTION_DELAY = 5000;
const SPECTATOR_ROUND_DELAY = 10000;

function showToast(html, opts = {}) {
  if (window._allAIMode) return;
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const t = document.createElement('div');
  t.className = 'toast' + (opts.kind ? ' ' + opts.kind : '');
  t.innerHTML = html;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const dur = opts.duration ?? 1800;
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, dur);
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
  // 仅无头测试/训练(_fastSpectator)跳过动画；真人观战全 AI 对战时照常播放拿取动画
  if (window._fastSpectator || !source) {
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

// ============================================================
// 「解说台」（足球解说风格）
//   - 开牌前：用独立"行家"软评分预测每位 AI 选牌的概率，激情解说
//   - 开牌后：核对预测命中/落空，累计本场命中率
//   全 AI 观战自动启用；人机对战由开局「🎙️ 实况解说」开关控制（连真人玩家
//   的每一手也会被预测和点评）。无头测试/训练(_fastSpectator)完全跳过。
// ============================================================
const CAST_PREDICT_MS = 2600; // 预测后的悬念时间（观战）
const CAST_REACT_MS = 1800;   // 揭晓后的反应时间（观战）
const CAST_PVE_PREDICT_MS = 1700; // 人机局节奏更紧凑，少压真人的等待时间
const CAST_PVE_REACT_MS = 1500;

function spectatorOn() { return !!window._allAIMode && !window._fastSpectator; }
function castOn() { return spectatorOn() || (!!window._liveCastOn && !window._fastSpectator); }

function commentarySay(html, kind) {
  const box = document.getElementById("commentary-box");
  if (!box) return;
  box.className = "cast-" + (kind || "talk"); // 同时移除 hidden
  box.innerHTML = html;
  box.style.animation = "none";
  void box.offsetWidth; // 强制回流以重放脉冲动画
  box.style.animation = "";
}

function castPick(a) { return a[Math.floor(Math.random() * a.length)]; }

// 给每位 AI 选手起名（足球解说要喊名字）。全 AI 局：所有人取昵称；人机局：CPU 取昵称、人类保留自填名。
const CAST_NAME_POOL = ["黄金手", "老狐狸", "暴风眼", "冷面杀手", "独狼", "闪电", "赌神", "铁算盘",
  "夜枭", "疾风", "磐石", "黑马", "狂澜", "鬼才", "老枪", "天秤"];
function assignCastNames() {
  const pool = CAST_NAME_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let k = 0;
  for (const p of G.players) { if (!p.isHuman) p.name = pool[k++ % pool.length]; }
  maybeAssignPersonas();
}

// ============================================================
// 群友人格 NPC：在专家(L5)/宗师(L6) 局里，13 位群友各自独立掷 12% 决定本局是否登场，
// 各有独门玩法。调试/演示可在控制台 window._forcePersona = "苦寒"（或 key）强制出现一位。
//   - thinkMs：自定义思考时长（让时间预算成为搜索约束 → 真的多想）
//   - build  ：建筑大师（启用终局精确建造求解器，建造更优）
//   - spite  ：恶心人类（以该概率抢人类想要的角色 / 偷人类的货田 / 占人类的装船道）
// ============================================================
// 设计准则：每位群友都是 L6 内核（=宗师强度），风格只用「不削弱实力」的杠杆表达——
//   思考更久(thinkMs，越久越强；上限压到 ≤8s，避免长考拖节奏)、建筑大师(build，启用终局精确建造，≈中性偏正)、
//   恶心人类(spite，仅在有真人时触发；纯 AI 局零影响 → 1群友vs3宗师=纯L6≈25%)、
//   多样化产线(diverse，仅在有真人时触发；同 spite 闸，纯 AI 局零影响 → 基准里仍是纯 L6)、
//   成套收集(collect，仅在有真人时触发；同 spite 闸 → 有田就配厂/喂厂、攒钱凑齐产业链)、
//   大建筑流(bigbuild，仅在有真人时触发；同 spite 闸 → 囤矿场，第8回合后攒钱抢自己加分最多的10元大建筑)、
//   钱币敏感(coin，仅在有真人时触发；同 spite 闸 → 哪个角色卡累计了≥2枚币就大概率去抢那笔奖励币)。
// 因此每位在「1群友 vs 3宗师」里都 ≥ 宗师基线（≥23%），同时各有棋路。
// 实测（200 局, 等算力 iters=100）：拾光 25.7% (95%CI [19.6,31.7])，与纯 L6 基线无显著差异 ✅。
const AI_PERSONAS = [
  { key: "xixi",    name: "西西", level: 6, thinkMs: 8000,  build: 1,                desc: "建筑大师·想得最久(8s)，终局建造步步精算" },
  { key: "kuhan",   name: "苦寒", level: 6, spite: 0.75,                            desc: "专坑你·高概率抢你角色、偷你的田、堵你的船" },
  { key: "laoma",   name: "老马", level: 6, thinkMs: 6000,                          desc: "老马识途·算得深(6s)、稳扎稳打" },
  { key: "xinliu",  name: "心流", level: 6, thinkMs: 3000,                          desc: "行云流水·当机立断、出手最快(3s)" },
  { key: "zhongda", name: "仲达", level: 6, spite: 0.45, thinkMs: 5000,            desc: "隐忍仲达·伺机使绊、偶尔阴你一手" },
  { key: "shiguang",name: "拾光", level: 6, build: 1, thinkMs: 5000,               desc: "建筑收藏家·终局精确建造，把建造算到极致" },
  { key: "chazong", name: "茶总", level: 6, thinkMs: 6000,                          desc: "财大气粗·深算(6s)、稳健不浪" },
  { key: "kuankuan",name: "宽宽", level: 6, thinkMs: 4000,                          desc: "堂堂正正·纯实力，不使绊子" },
  { key: "sc",      name: "SC",   level: 6, thinkMs: 8000,  build: 0.6, spite: 0.35, desc: "全能型·又强又阴：深思(8s)＋精算建造＋偶尔阴你" },
  { key: "wuyu",    name: "吾鱼", level: 6, diverse: 0.7,                            desc: "样样都来·爱铺 3+ 种货，专收工厂等多货生金建筑" },
  { key: "rafael",  name: "Rafael", level: 6, collect: 0.7,                         desc: "成套收集·有田就配厂、给厂喂田，凑齐田↔厂产业链" },
  { key: "feb",     name: "二月", level: 6, bigbuild: 0.7,                          desc: "矿场流·囤1~2矿场，中后期猛攻最值钱的10元大建筑(能买俩更好)" },
  { key: "ethan",   name: "Ethan", level: 6, coin: 0.8,                            desc: "钱币敏感·角色卡攒到2~3枚币就大概率去抢那笔奖励" },
];
const PERSONA_CHANCE = 0.12; // 每个群友各自独立掷 12% 决定本局是否登场（→ 约 81% 的局至少 1 位）
function maybeAssignPersonas() {
  const forced = window._forcePersona;
  // 可分配群友的 AI 席位：仅专家/宗师对手
  const slots = G.players.filter(p => !p.isHuman && (p._aiLevel || 0) >= 5);
  if (!slots.length) return;
  let si = 0;
  const assign = (p, persona) => {
    p._persona = persona;
    p.name = persona.name;
    p._aiLevel = Math.max(p._aiLevel || 5, persona.level);
    if (persona.thinkMs) p._thinkMs = persona.thinkMs;
    G._hasPersona = true;
  };
  // 强制指定（基准/调试 window._forcePersona）：占用第一个席位
  if (forced && !G._personaForced) {
    const persona = AI_PERSONAS.find(x => x.key === forced || x.name === forced);
    if (persona) { assign(slots[si++], persona); G._personaForced = true; }
  }
  // 每个群友各自独立掷 PERSONA_CHANCE；命中且还有空席位就登场。
  //   - 同一局不会出现相同群友：每个群友只掷一次、占一个独立席位。
  //   - 同一局可出现不同群友：多个命中各占不同席位。
  // 先打乱顺序，避免席位不够时总是偏向 AI_PERSONAS 前面的群友。
  const pool = AI_PERSONAS.filter(x => !(forced && (x.key === forced || x.name === forced)));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  for (const persona of pool) {
    if (si >= slots.length) break;
    if (Math.random() < PERSONA_CHANCE) assign(slots[si++], persona);
  }
}
// spite 只在「场上有真人可坑」时才掷骰 → 纯 AI 局(含 1群友vs3宗师基准)里 spite 路径零触发、
// 与纯 L6 逐字节一致，保证群友在基准里就是宗师强度。
function _spiteRoll(p) {
  return !!(p._persona && p._persona.spite && G.players.some(x => x.isHuman) && Math.random() < p._persona.spite);
}
// 苦寒/仲达 的"恶心"招之一：以 spite 概率 snatch 人类此刻最想要的角色（牺牲一点最优换膈应人类）。
function spiteRolePick(p, available) {
  const human = G.players.find(x => x.isHuman);
  if (!human || typeof level2PickRoleNew !== "function") return null;
  try { const idx = level2PickRoleNew(human, available); if (idx >= 0 && idx < available.length) return idx; } catch (e) {}
  return null;
}
// 群友·吾鱼：多样化产线（爱铺 3+ 种货）+ 收购"多货生产加钱"的建筑。与 spite 同理人类闸：
// 纯 AI 局(含 1群友vs3宗师基准)里 diverse 路径零触发 → 吾鱼在基准里就是纯 L6，保证 ≥23%。
function _diverseRoll(p) {
  return !!(p._persona && p._persona.diverse && G.players.some(x => x.isHuman) && Math.random() < p._persona.diverse);
}
// 吾鱼建造偏好：先抢工厂(15，多货→金的招牌建筑)，其次给还不能产的货补一座生产建筑（扩产线种类），
// 再次扩展的专业工厂(34)/档案馆(51)。返回 options 下标，或 null 表示无合适目标→回退普通启发式。
function diverseBuildPick(p, options) {
  const has = id => options.findIndex(o => o.b.id === id);
  // 1) 工厂(15)：生产种类越多得金越多——吾鱼的核心
  let i = has(15); if (i >= 0) return i;
  // 2) 给"还没有对应生产建筑"的货补一座 → 让能产的货种类增多
  const prodBldGood = { 1: "indigo", 3: "indigo", 2: "sugar", 4: "sugar", 5: "tobacco", 6: "coffee" };
  const ownedProdGoods = new Set();
  for (const b of p.buildings) { const g = prodBldGood[b.bid]; if (g) ownedProdGoods.add(g); }
  const myPlantGoods = new Set(p.plantations.filter(pl => pl.good && pl.good !== "quarry").map(pl => pl.good));
  let bestI = -1, bestPr = -1;
  for (let k = 0; k < options.length; k++) {
    const g = prodBldGood[options[k].b.id];
    if (!g || ownedProdGoods.has(g)) continue;          // 没映射 / 已有这种货的厂 → 不增加种类
    const pr = (myPlantGoods.has(g) ? 2 : 1) + (BLD_BY_ID[options[k].b.id].vp || 0) * 0.1; // 有该货田→能立刻产，优先
    if (pr > bestPr) { bestPr = pr; bestI = k; }
  }
  if (bestI >= 0) return bestI;
  // 3) 扩展：专业工厂(34)/档案馆(51) 同样奖励多货
  for (const id of [34, 51]) { const j = has(id); if (j >= 0) return j; }
  return null;
}
// 吾鱼拓殖偏好：优先拿"自己还没产的货种"的田，逼近 3+ 种产线。返回下标或 null。
function diversePlantPick(p, options) {
  const myGoods = new Set(p.plantations.filter(pl => pl.good && pl.good !== "quarry").map(pl => pl.good));
  let bestI = -1, bestS = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    if (o.kind !== "plant" || myGoods.has(o.good)) continue; // 只看能新增货种的田
    const s = (GOOD_PRICE[o.good] || 0);                     // 新货种里略偏贵货(多样化不亏价值)
    if (s > bestS) { bestS = s; bestI = i; }
  }
  return bestI >= 0 ? bestI : null;
}

// 群友·Rafael：成套收集（垂直整合）——有某货的田就配该货的厂、给已有厂的货加田喂厂、攒钱拿贵厂。
// 同 spite 人类闸：纯 AI 局(基准)零触发 → Rafael 在基准里就是纯 L6，保证 ≥23%。
const PROD_BLD_FOR_GOOD = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] };
function _collectRoll(p) {
  return !!(p._persona && p._persona.collect && G.players.some(x => x.isHuman) && Math.random() < p._persona.collect);
}
// 列出 Rafael "有该货田、但还没有该货生产建筑" 的货种（缺厂的货）
function _missingFactoryGoods(p) {
  const out = [];
  for (const g of ["indigo", "sugar", "tobacco", "coffee"]) {
    const hasField = p.plantations.some(pl => pl.good === g);
    const hasFactory = PROD_BLD_FOR_GOOD[g].some(id => G.ownsBuilding(p, id));
    if (hasField && !hasFactory) out.push(g);
  }
  return out;
}
// Rafael 建造：优先给"有田没厂"的货补对应生产建筑(成套，贵货优先=攒钱拿咖啡厂)，其次升级到大厂(深化套)。
function collectBuildPick(p, options) {
  const prodBldGood = { 1: "indigo", 3: "indigo", 2: "sugar", 4: "sugar", 5: "tobacco", 6: "coffee" };
  const fieldCount = {};
  for (const pl of p.plantations) if (pl.good && pl.good !== "quarry") fieldCount[pl.good] = (fieldCount[pl.good] || 0) + 1;
  let bestI = -1, bestPr = -Infinity;
  for (let k = 0; k < options.length; k++) {
    const g = prodBldGood[options[k].b.id];
    if (!g || !(fieldCount[g] > 0)) continue;          // 只配自己有田的货——没田的厂 Rafael 不要
    const ownsAnyFactory = PROD_BLD_FOR_GOOD[g].some(id => G.ownsBuilding(p, id));
    const base = ownsAnyFactory ? 1 : 4;               // 还没该货厂→成套补厂(最优)；已有→升大厂(深化，次优)
    const pr = base + (GOOD_PRICE[g] || 0) + (fieldCount[g] || 0) * 0.5; // 贵货&田多者优先
    if (pr > bestPr) { bestPr = pr; bestI = k; }
  }
  return bestI >= 0 ? bestI : null;
}
// Rafael 拓殖：优先给"已有厂的货"加田(喂厂成套)，其次深化已有货种(为成套铺垫)。
function collectPlantPick(p, options) {
  const fieldCount = {};
  for (const pl of p.plantations) if (pl.good && pl.good !== "quarry") fieldCount[pl.good] = (fieldCount[pl.good] || 0) + 1;
  let bestI = -1, bestS = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    if (o.kind !== "plant") continue;
    const g = o.good;
    let s = (GOOD_PRICE[g] || 0);
    if (PROD_BLD_FOR_GOOD[g] && PROD_BLD_FOR_GOOD[g].some(id => G.ownsBuilding(p, id))) s += 6; // 有厂的货加田=喂厂成套(最优)
    else if (fieldCount[g] > 0) s += 3;                                                          // 已有田的货深化(铺垫成套)
    if (s > bestS) { bestS = s; bestI = i; }
  }
  return bestI >= 0 ? bestI : null;
}
// Rafael 选角：差一点就能买起对应贵厂(咖啡/烟草)时，倾向金矿主攒钱（"攒钱拿咖啡厂"）。
function collectRolePick(p, available) {
  const pi = available.findIndex(r => r.name === "Prospector");
  if (pi < 0) return null;
  for (const g of _missingFactoryGoods(p)) {
    if (g !== "coffee" && g !== "tobacco") continue;   // 只为贵厂专门攒钱
    for (const id of PROD_BLD_FOR_GOOD[g]) {
      const b = BLD_BY_ID[id];
      if (!b || G.buildingStock[id] <= 0) continue;
      const cost = G.effectiveCost(p, b);
      if (p.money < cost && p.money >= cost - 3) return pi; // 差≤3金 → 去拿金攒齐
    }
  }
  return null;
}

// 群友·二月：矿场流——囤 1-2 矿场（给大建筑打折），第 8 回合后攒钱抢"对自己加分最多"的 10 元大建筑，
// 有空间/有货就接着买第二个。同 spite 人类闸：纯 AI 局零触发 → 基准里就是纯 L6，保证 ≥23%。
function _bigbuildRoll(p) {
  return !!(p._persona && p._persona.bigbuild && G.players.some(x => x.isHuman) && Math.random() < p._persona.bigbuild);
}
// 二月拓殖：还没囤够 2 个矿场就优先拿矿场（矿场折扣大建筑、最高费用列可减到 4）。
function bigbuildPlantPick(p, options) {
  const qCount = p.plantations.filter(pl => pl.good === "quarry").length;
  if (qCount >= 2) return null;                       // 1-2 个就够，不贪
  const qi = options.findIndex(o => o.kind === "quarry");
  return qi >= 0 ? qi : null;
}
// 二月建造：第 8 回合后，能买大紫就立刻抢"对自己加分最多"的那个（已拥有的会跳过 → 支持买第二个）；
// 买不起但只差一点（≤3 金）→ 跳过本次建造攒钱，绝不把钱浪费在小建筑上。
function bigbuildBuildPick(p, options) {
  if (G.turnNumber <= 8) return null;
  let bestI = -1, bestS = -Infinity;
  for (let k = 0; k < options.length; k++) {
    if (options[k].b.type !== "large_violet") continue;
    const s = estLargeVioletSpecial(p, options[k].b.id); // 对二月这块板子能加多少分
    if (s > bestS) { bestS = s; bestI = k; }
  }
  if (bestI >= 0) return bestI;                       // 有可买大紫 → 买加分最高的
  const tgt = bestLargeViolet(p);                     // 盯着的大紫还差一点 → 跳过攒钱(不买小建筑)
  if (tgt) {
    const cost = G.effectiveCost(p, BLD_BY_ID[tgt.id]);
    if (p.money < cost && p.money >= cost - 3) return -1; // -1 = PASS（攒钱）
  }
  return null;
}
// 二月选角：第 8 回合后锁定加分最高的大建筑——买得起就抢建造(享 -1 折上折)，仅差 1-2 金才金矿主补齐；
// 差得多就回退正常发育攒钱（不为 +1 金浪费选角）。
function bigbuildRolePick(p, available) {
  if (G.turnNumber <= 8) return null;
  const tgt = bestLargeViolet(p);                     // 库存内/未拥有/有 2 格空间里终局分最高的大紫
  if (!tgt) return null;
  const cost = G.effectiveCost(p, BLD_BY_ID[tgt.id]); // 含矿场折扣
  if (p.money >= cost) {
    const bi = available.findIndex(r => r.name === "Builder");
    if (bi >= 0) return bi;                            // 买得起 → 抢建造特权(再 -1 更省、且抢在对手前)
  } else if (p.money >= cost - 2) {
    const pi = available.findIndex(r => r.name === "Prospector");
    if (pi >= 0) return pi;                            // 仅差 1-2 金 → 金矿主补齐
  }
  return null;                                          // 还差得多 → 正常发育攒钱
}

// 群友·Ethan：对角色卡上累计的奖励币很敏感——某张角色卡攒到 ≥2 枚币时，大概率直接去抢那张（拿走那笔币）。
// 同 spite 人类闸：纯 AI 局零触发 → Ethan 在基准里就是纯 L6，保证 ≥23%。
function _coinRoll(p) {
  return !!(p._persona && p._persona.coin && G.players.some(x => x.isHuman) && Math.random() < p._persona.coin);
}
// 在可选角色里挑"累计金币最多"的一张；阈值 ≥2 枚才动心（攒到 2~3 枚时概率大大提高）。
function coinRolePick(p, available) {
  let bestI = -1, bestM = 1;                            // 初值 1 → 只有 money≥2 才会被选中
  for (let i = 0; i < available.length; i++) {
    const m = available[i].money || 0;
    if (m > bestM) { bestM = m; bestI = i; }
  }
  return bestI >= 0 ? bestI : null;
}

// 解说员"看穿"廉价确定型 AI 的真实决策（L1/L2/L3 复用其本级逻辑预判，命中率大增）。
// L4 的本级逻辑≈行家软评分(argmax)，无需特判；L5/L6 是 MCTS/NN，昂贵且随机 → 不预判，保留"专家爆冷"的戏剧性。
function predictedPickName(me, available) {
  const lvl = me._aiLevel || 3;
  try {
    let idx = null;
    if (lvl === 1) idx = level1PickRole(me, available);
    else if (lvl === 2) {
      if (me._dna && typeof dnaPickRole === "function") {
        const di = dnaPickRole(me, available);
        idx = (di !== null && di >= 0 && di < available.length && typeof dnaLookaheadRefine === "function")
          ? dnaLookaheadRefine(me, available, di) : di;
      } else idx = level1PickRole(me, available);
    } else if (lvl === 3) idx = level2PickRoleNew(me, available);
    else return null; // L4/L5/L6
    if (idx !== null && idx >= 0 && idx < available.length) return available[idx].name;
  } catch (e) { /* 预判失败则回退启发式 */ }
  return null;
}

// 解说员的"行家评分"：自身收益−资敌 + 策略倾向 → softmax 成概率；再用本级预判把确定型 AI 的真实选择顶到首位。
function commentatorPredict(me, available) {
  const phase = gamePhase();
  const scored = available.map(r => ({
    r,
    s: roleSelfMinusOpp(me, r.name, r.money).margin + strategicRoleBias(me, r.name, phase),
  }));
  const mx = Math.max(...scored.map(x => x.s));
  const T = 1.3; // softmax 温度：越小越尖锐（角色价值早期接近，过大会一片五五开）
  let Z = 0;
  for (const x of scored) { x.e = Math.exp((x.s - mx) / T); Z += x.e; }
  for (const x of scored) x.p = x.e / Z;
  scored.sort((a, b) => b.p - a.p);
  // 本级预判（L1/L2/L3）：把该 AI 真正会选的角色提到首位并提高置信度
  const predName = predictedPickName(me, available);
  if (predName) {
    const k = scored.findIndex(x => x.r.name === predName);
    if (k > 0) {
      const [picked] = scored.splice(k, 1);
      picked.p = Math.max(picked.p, scored[0].p) + 0.15;
      scored.unshift(picked);
    } else if (k === 0) {
      scored[0].p = Math.min(0.95, scored[0].p + 0.12);
    }
    const Z2 = scored.reduce((a, x) => a + x.p, 0);
    for (const x of scored) x.p /= Z2;
  }
  return scored; // 概率降序 [{r,s,p}]
}

// 当前局势分（终局计分口径：VP筹码 + 建筑分 + 大紫特殊分）
function castEstScore(p) {
  return p.vp + p.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].vp, 0) + G.getSpecialVPs(p);
}
function castStandings() {
  const arr = G.players.map(p => ({ p, v: castEstScore(p) }));
  arr.sort((a, b) => b.v - a.v || (b.p.money - a.p.money));
  return arr; // 降序
}

// 解说员的"局势模型"：这一手收益多大、净赚多少(资敌后)、最想抢这张牌的对手是谁(卡位判断)、当前排名
function castAnalyzeMove(chooser, roleName) {
  const info = roleSelfMinusOpp(chooser, roleName, 0); // {myGain, oppMax, margin}
  let rival = null, rivalWant = -1;
  for (const opp of G.players) {
    if (opp === chooser) continue;
    const want = snapshotProjectedScore(simulatePlayerSnapshot(G, opp.idx, roleName, true)) - baselineSnapScore(opp.idx);
    if (want > rivalWant) { rivalWant = want; rival = opp; }
  }
  const standings = castStandings();
  const chooserRank = standings.findIndex(s => s.p === chooser);
  const rivalRank = rival ? standings.findIndex(s => s.p === rival) : 99;
  return {
    myGain: info.myGain, margin: info.margin, oppMax: info.oppMax,
    rival, rivalWant, rivalRank, standings,
    leader: standings[0].p, last: standings[standings.length - 1].p,
    chooserRank, n: G.numPlayers,
  };
}

const CAST_REASON = {
  Captain: ["船舱在召唤，是时候装船兑换分数了！", "再不装船仓库就要爆仓啦！", "码头的汽笛已经拉响，这批货拖不得了！", "分数就摆在甲板上，伸手就能拿！"],
  Trader: ["贸易站还空着，正是套现的好时机！", "高价货在手，不卖更待何时！", "商人的算盘珠子都崩出火星了！", "这波行情，错过要拍大腿！"],
  Builder: ["金币鼓鼓的，该置办大产业了！", "建筑市场有好货，钱要花在刀刃上！", "口袋里的金币烫手，不花出去睡不着觉！", "圣胡安的天际线就等这一砖了！"],
  Mayor: ["空岗一大片，人力才是硬道理！", "殖民船满载，抢人要趁早！", "厂房建得再漂亮，没人干活就是摆设！", "招工启事贴满全城，就看谁下手快！"],
  Craftsman: ["生产线火力全开，工匠能榨干每一分产能！", "原料齐备，开足马力生产！", "仓库的门都快被货顶开了，还要再来一轮！", "烟囱冒烟的声音，就是分数的声音！"],
  Settler: ["地盘还不够，先圈块好地再说！", "采石场和好田，拓殖者眼里全是机会！", "好地不等人，今天不圈明天就是别人的！", "万丈高楼平地起，先把地基打牢！"],
  Prospector: ["没有更香的选择，稳稳收一金也不亏！", "闷声发财，金矿主默默 +1！", "别人抢破头，他蹲在河边淘金子！", "一块钱也是钱，攒着攒着就是一座庄园！"],
};
function castReason(role) { return castPick(CAST_REASON[role] || [""]); }

// 终局热度：0 平稳 / 1 末日临近 / 2 终场哨已吹（影响解说狂热度与"控速·绝杀"桥段）
function castEndgameHeat() {
  if (G.endTriggered) return 2;
  let maxUsed = 0; for (const p of G.players) maxUsed = Math.max(maxUsed, G.buildingUsedSpaces(p));
  const signals = (G.colonistsLeft <= G.numPlayers ? 1 : 0) + (G.vpLeft <= 10 ? 1 : 0) + (maxUsed >= 10 ? 1 : 0);
  if (signals >= 2) return 2;
  if (signals >= 1 || gamePhase() === "late") return 1;
  return 0;
}
function castCashCrops(me) { const c = []; if (me.goods.coffee > 0) c.push("咖啡"); if (me.goods.tobacco > 0) c.push("烟草"); return c; }

// 波多黎各"黑话"桥段：按角色 + 阶段 + 终局热度，生成一句贴合实况的术语解说（蹭蹭/工匠恐惧/经济作物/大建/控速…）
function castJargon(me, roleName, phase, heat) {
  switch (roleName) {
    case "Settler":
      return phase === "early" ? castPick(["圈地运动开始！", "先占一块好地，地基决定上限！"])
        : castPick(["第一个矿，就是省下的整座江山！", "多样化！多一种作物多一条活路！"]);
    case "Mayor":
      if (heat >= 1) return castPick(["他在数供应堆的工人——这是要踩下刹车控速！", "空工位、招聘所……他在拨弄结束游戏的倒计时！"]);
      return castPick(["抢人！人力才是第一生产力！", "殖民船一扫而空！"]);
    case "Builder": {
      const canBig = me.money >= 10 && BUILDINGS.some(b => b.type === "large_violet" && G.buildingStock[b.id] > 0 && !me.buildings.some(x => x.bid === b.id));
      if (canBig || heat >= 1) return castPick(["大建在向他招手！公会厅？堡垒？通天塔即将拔地而起！", "10 块大件争夺，这一砸可能就是满额奖励分！"]);
      return castPick(["趁对手没钱，悄悄添置产业！", "建筑市场扫货！"]);
    }
    case "Craftsman":
      return castPick(["『工匠恐惧』的阴云笼罩全场——他这是在给下家的交易和上船递刀子啊！", "他不是在生产，他是在为全场对手做嫁衣！工匠恐惧！"]);
    case "Trader": {
      const cc = castCashCrops(me);
      if (cc.length) return castPick([`套现！把${cc[0]}变成白花花的金币！`, "经济作物出手，雪球要滚起来了！"]);
      if (G.tradingHouse.length >= 3) return "贸易站只剩最后的空格，手慢无！";
      return "套现一笔，落袋为安！";
    }
    case "Captain": {
      let opc = null;
      for (const p of G.players) { if (p === me) continue; if (p.goods.coffee > 0) { opc = "咖啡"; break; } if (p.goods.tobacco > 0) opc = "烟草"; }
      if (opc) return castPick([`要把对手的${opc}强行掀进大西洋！`, `强制装船！谁也别想留着${opc}过夜！`]);
      return castPick(["强制装船，谁也跑不掉！", "1 货 1 分，刷分时刻！"]);
    }
    case "Prospector":
      return castPick(["带血的低保 +1，闷声发财！", "没有更香的，先把这块钱攥在手里！"]);
  }
  return "";
}

// 低概率随机花絮：解说员的"人味"——看台、搭档、从业自嘲，让播报不那么像机器
const CAST_COLOR = [
  "看台上的椰子树都跟着摇了三摇！",
  "我的搭档老何已经把领带扯下来当毛巾用了！",
  "导播！快给个特写！",
  "观众朋友们，这就是波多黎各——每一张角色牌都是人生的十字路口！",
  "解说席的咖啡又凉了，谁还顾得上喝！",
  "圣胡安的海风此刻都为之一滞！",
  "干了三十年解说，这种局面我手心还是会出汗！",
  "电视机前的观众请扶稳坐好！",
];
function castColorMaybe() { return Math.random() < 0.22 ? ` ${castPick(CAST_COLOR)}` : ""; }

// 连选执念：同一位选手反复拿同一张角色，是解说最爱的"人设"素材
function castStreakNote(me, roleName) {
  G._castPicks = G._castPicks || {};
  const key = me.idx + ":" + roleName;
  const n = (G._castPicks[key] = (G._castPicks[key] || 0) + 1);
  if (n === 3) return ` 注意——这已经是${me.isHuman ? "你" : "他"}本场<b>第 3 次</b>拿起 <b>${ROLE_NAME_CN[roleName]}</b>了，执念初现！`;
  if (n >= 4) return ` <b>${ROLE_NAME_CN[roleName]}</b>×${n}！${me.isHuman ? "你对这张牌是真爱啊！" : `${me.name} 和这张牌怕不是签了终身合同！`}`;
  return "";
}

// 头名易主：比分被反超是全场最大的新闻，必须单独喊出来
function castLeadChangeNote(standings) {
  const allZero = standings.every(s => s.v === 0);
  if (allZero) return "";
  const leader = standings[0].p;
  const prev = G._castLeader;
  G._castLeader = leader;
  if (prev && prev !== leader) {
    return castPick([
      ` 👑 风云突变！<b>${leader.name}</b> 把 <b>${prev.name}</b> 从王座上拽了下来，头名易主！`,
      ` 👑 改朝换代！积分榜第一的名字现在写着——<b>${leader.name}</b>！`,
    ]);
  }
  return "";
}

// 开场白：解说员介绍今晚的对阵（castOn 时开局播一次）
function castOpening() {
  const human = G.players.find(p => p.isHuman);
  const ais = G.players.filter(p => !p.isHuman);
  const roster = ais.map(p => `<b>${p.name}</b>（${AI_LEVEL_NAMES[p._aiLevel] ? AI_LEVEL_NAMES[p._aiLevel].cn : "?"}）`).join("、");
  let line;
  if (G.numPlayers === 1) {
    line = `欢迎来到圣胡安体育场！今晚是 <b>${human.name}</b> 的单人闯关之夜——一个人，一座岛，和一个不断刷新的分数纪录。让我们看看这位总督能把岛经营到什么高度！`;
  } else if (human) {
    line = castPick([
      `欢迎来到圣胡安体育场！灯光打向主队入场通道——<b>${human.name}</b> 来了！今晚的对手是 ${roster}。七张角色牌已经摆上桌，祝各位好运，比赛——开始！`,
      `观众朋友们晚上好！这里是波多黎各殖民大赛现场。挑战者 <b>${human.name}</b> 将迎战 ${roster}。我已经迫不及待了，发牌！`,
    ]);
  } else {
    line = `欢迎来到圣胡安体育场！今晚的全明星对决：${roster}。神仙打架，凡人观战，我们直接进入比赛！`;
  }
  commentarySay(`<div class="cast-head">🎙️ 解说台</div><div class="cast-line">${line}</div>`, "talk");
}

// 终场颁奖词：宣布冠军（castOn 时终局播一次）
function castFinale(scores) {
  const champ = scores[0], runner = scores[1];
  const gap = runner ? champ.total - runner.total : 0;
  let line;
  if (G.numPlayers === 1) {
    line = `终场哨响！<b>${champ.p.name}</b> 的单人航程定格在 <b>${champ.total}</b> 分！这座岛记住了你的名字！`;
  } else if (champ.p.isHuman) {
    line = castPick([
      `终场哨响！！冠军是——<b>${champ.p.name}</b>！！${gap <= 2 ? `仅仅 ${gap} 分的差距，从机器的牙缝里抢下胜利！` : `${champ.total} 分，碾压群雄！`}人类的荣光今夜由你守护！向看台挥手吧！`,
      `比赛结束！<b>${champ.p.name}</b> 以 <b>${champ.total}</b> 分登顶！我看到 ${runner ? `<b>${runner.p.name}</b> 的散热风扇还在不甘地转着` : "对手已经低下了头"}——但今晚，王冠属于人类！`,
    ]);
  } else {
    const human = scores.find(s => s.p.isHuman);
    line = `终场哨响！<b>${champ.p.name}</b> 以 <b>${champ.total}</b> 分捧起奖杯${gap <= 2 ? `——仅 ${gap} 分险胜，惊出我一身冷汗` : ""}！` +
      (human ? ` <b>${human.p.name}</b> 名列第 ${scores.indexOf(human) + 1}（${human.total} 分），${scores.indexOf(human) === 1 ? "虽败犹荣，下一局就是你的！" : "胜败乃兵家常事，回去复盘，我们再战！"}` : "");
  }
  commentarySay(`<div class="cast-head">🎙️ 解说台 · 终场</div><div class="cast-line cast-hit">${line}</div>`, "power");
}

// 真人玩家选角前：解说员当众押注（不阻塞，思考多久都行——悬念由玩家自己制造）
function commentaryPreRoleHuman(me, available) {
  const pred = commentatorPredict(me, available);
  const top = pred[0];
  const pct = Math.round(top.p * 100);
  const hot = `<b class="cast-hot">${ROLE_NAME_CN[top.r.name]}</b>`;
  const heat = castEndgameHeat();
  const opener = heat === 2 ? `🔚 生死时速！` : (heat === 1 ? `⏳ 末日临近——` : ``);
  const line = castPick([
    `${opener}聚光灯打向 <b>${me.name}</b>！全场安静——行家盘口最看好 ${hot}（<b>${pct}%</b>）。按套路走，还是给我们一个惊喜？`,
    `${opener}轮到 <b>${me.name}</b> 出手了！我当众押 ${hot}（<b>${pct}%</b>）——来，打我的脸，我等着！`,
    `${opener}<b>${me.name}</b> 的手悬在七张牌上方……我赌 ${hot}（<b>${pct}%</b>）！${castReason(top.r.name)}`,
  ]);
  commentarySay(`<div class="cast-head">🎙️ 解说台</div><div class="cast-line">${line}</div>`, "predict");
  return pred;
}

function commentaryPreRole(me, available) {
  const pred = commentatorPredict(me, available);
  const top = pred[0], second = pred[1];
  const lvl = AI_LEVEL_NAMES[me._aiLevel] ? AI_LEVEL_NAMES[me._aiLevel].cn : "";
  const st = castStandings();
  const myRank = st.findIndex(s => s.p === me);
  const pos = myRank === 0 ? `领跑全场的 ` : (myRank === st.length - 1 ? `暂列末席的 ` : ``);
  const pct = Math.round(top.p * 100);
  const hot = `<b class="cast-hot">${ROLE_NAME_CN[top.r.name]}</b>`;
  let lead;
  if (pct >= 45) lead = castPick([
    `我重押 ${hot}！可能性 <b>${pct}%</b>！${castReason(top.r.name)}`,
    `毫无悬念——${hot}！<b>${pct}%</b>！${castReason(top.r.name)}`,
    `闭着眼睛报：${hot}！<b>${pct}%</b>！${castReason(top.r.name)}`,
  ]);
  else if (pct >= 28) lead = castPick([
    `我看好 ${hot}（<b>${pct}%</b>）！${castReason(top.r.name)}`,
    `直觉告诉我是 ${hot}（<b>${pct}%</b>）！${castReason(top.r.name)}`,
  ]);
  else lead = castPick([
    `七张牌几乎五五开——我咬牙压 ${hot}（仅 <b>${pct}%</b>），这一手太难猜了！`,
    `盘口乱成一锅粥！我硬着头皮报 ${hot}（<b>${pct}%</b>），猜错别笑话我！`,
  ]);
  const heat = castEndgameHeat();
  const opener = heat === 2 ? `🔚 生死时速！` : (heat === 1 ? `⏳ 末日临近——` : ``);
  let html = `<div class="cast-head">🎙️ 解说台</div>`;
  html += `<div class="cast-line">${opener}轮到 ${pos}<b>${me.name}</b>（${lvl}）登场！${lead}`;
  if (second && second.p > 0.18 && pct >= 28) html += `　紧追的是 <b>${ROLE_NAME_CN[second.r.name]}</b>（${Math.round(second.p * 100)}%）！`;
  html += `</div>`;
  commentarySay(html, "predict");
  return pred;
}

// 揭晓：以"局势模型"判断这一手好坏/是否卡位，套用足球解说的极端情绪模板。
// 真人玩家(hu)走第二人称专属台词——解说员是在跟你说话，不是在念稿。
function commentaryPostRole(me, pred, chosenRole) {
  G._castTotal = (G._castTotal || 0) + 1;
  const rank = pred.findIndex(x => x.r.name === chosenRole); // 0=解说首选
  if (rank === 0) G._castHits = (G._castHits || 0) + 1;
  const cn = ROLE_NAME_CN[chosenRole];
  const a = castAnalyzeMove(me, chosenRole);
  const nm = `<b>${me.name}</b>`;
  const hu = !!me.isHuman;
  const phase = gamePhase();
  const heat = castEndgameHeat();
  // 判定戏剧类型
  const isProspector = chosenRole === "Prospector"; // 金矿主无跟随动作，既不卡人也不资敌
  const isBlock = !isProspector && a.rival && a.rivalWant >= 2.0 && a.rivalRank <= 1 && a.rival !== me;
  const isWaste = !isProspector && a.myGain < 0.6 && a.oppMax >= 1.5; // 真·亏：自己几乎没赚，还把行动资敌
  const isMeh = a.myGain < 1.0;
  const isPower = a.myGain >= 3.0;
  const solo = a.n === 1; // 单人闯关没有领跑/垫底之说
  const amTrailing = !solo && a.chooserRank >= a.n - 1;
  const amLeading = !solo && a.chooserRank === 0;
  let line, kind, endgameSpecial = false;
  if (heat === 2 && chosenRole === "Builder" && me.money >= 10) {
    kind = "power"; endgameSpecial = true;
    line = hu ? castPick([
      `终场哨在即，${nm}，你这一锤砸下了大件！！满额奖励分就在眼前——这可能就是属于你的惊天逆转！历史在此刻拐弯！`,
      `末日倒计时声中，你的通天塔轰然建起！！要一锤定音了吗？！我和全场观众一起屏住了呼吸！`,
    ]) : castPick([
      `终场哨在即，${nm} 一锤砸下大件！！这一砸可能就是惊天逆转的满额奖励分——历史在此刻拐弯！`,
      `末日倒计时声中，${nm} 的通天塔轰然建起！！要一锤定音了吗？！全场屏住呼吸！`,
    ]);
  } else if (heat === 2 && (chosenRole === "Mayor" || chosenRole === "Craftsman") && !isBlock) {
    kind = "block"; endgameSpecial = true;
    line = hu ? castPick([
      `控速！${nm}，你在精算供应堆的每一个木头人——你想亲手决定终场哨什么时候吹响！好大的胆子，我喜欢！`,
      `生死时速！你一只手按住刹车，一只手踩着油门——整张牌桌的命运攥在你的手心里！`,
    ]) : castPick([
      `控速大师！${nm} 在精算供应堆的每一个木头人，要强行吹响全场结束的哨音！这是一场关于流速的拔河！`,
      `生死时速！${nm} 一只手按在刹车上，一只手按在油门上——他在亲手决定游戏什么时候暴毙！`,
    ]);
  } else if (isBlock && a.rivalRank === 0) {
    kind = "block";
    line = hu ? castPick([
      `斩断！斩——断！${nm}，你一把抢走 <b>${cn}</b>，直接掐住了领头羊 <b>${a.rival.name}</b> 的咽喉！！这一刀又稳又狠，我看到它的引擎当场熄火！为你起立鼓掌！`,
      `心机！太有心机了！你这手 <b>${cn}</b> 根本不是为了自己——是把 <b>${a.rival.name}</b> 摁在地上摩擦！！教科书级别的卡位，这才是会玩波多黎各的人！`,
    ]) : castPick([
      `斩断！斩——断！${nm} 一把抢走 <b>${cn}</b>，直接掐死了领头羊 <b>${a.rival.name}</b> 的命脉！！这一刀又稳又狠，<b>${a.rival.name}</b> 的引擎当场熄火！全场沸腾！`,
      `不可思议！${nm} 这手 <b>${cn}</b> 根本不是为了自己——是为了把 <b>${a.rival.name}</b> 摁在地上摩擦！！教科书级别的卡位，绝了！`,
    ]);
  } else if (isBlock) {
    kind = "block";
    line = hu ? castPick([
      `卡位！${nm}，你抢下 <b>${cn}</b>，一刀切断了 <b>${a.rival.name}</b> 的财路！要是机器会做表情，它现在脸都绿了！漂亮！`,
      `好一记釜底抽薪！你把 <b>${a.rival.name}</b> 最想要的 <b>${cn}</b> 生生夺走！这股杀气，我隔着解说席都感觉到了！`,
    ]) : castPick([
      `卡位！${nm} 抢下 <b>${cn}</b>，一刀切断了 <b>${a.rival.name}</b> 的财路！${a.rival.name} 脸都绿了！漂亮！`,
      `好一记釜底抽薪！${nm} 把 <b>${a.rival.name}</b> 最想要的 <b>${cn}</b> 生生夺走！这就是高手的杀气！`,
      `毒辣！${nm} 看都不看自己的收益，先把 <b>${a.rival.name}</b> 的算盘掀翻在地！心理战拉满！`,
    ]);
  } else if (isWaste) {
    kind = "miss";
    line = hu ? castPick([
      `（捂住话筒）……朋友，咱俩商量一下？你这手 <b>${cn}</b> 自己几乎没捞到，行动还白送了全场……我相信你有更深的布局，对吧？对吧？！`,
      `哎呀呀！${nm}，这手 <b>${cn}</b> 颗粒无收还资敌——大意了啊！不过比赛还长，深呼吸，下一手找回来！`,
    ]) : castPick([
      `（停顿）……他在干什么？！${nm} 这手 <b>${cn}</b> 自己几乎没捞到，却把行动白送全场！业余！不可原谅！这一步要写进检讨书！`,
      `灾难！纯纯的灾难！${nm} 选了 <b>${cn}</b> 颗粒无收，反倒给对手们做了嫁衣裳！看不懂，真的看不懂！`,
      `全场倒吸一口凉气——${nm} 的 <b>${cn}</b> 是给对手们集体发红包啊！经理，快申请暂停！`,
    ]);
  } else if (isProspector) {
    kind = "talk";
    line = hu ? castPick([
      `${nm} 务实地摸了金矿主，闷声 +1 金。低调，但金币不会说谎——攒着，憋个大的！`,
      `你选了金矿主，独吞一块钱，谁也蹭不到。稳！有时候最朴素的一手就是最好的一手。`,
    ]) : castPick([
      `没有更香的选择，${nm} 务实地摸了金矿主，闷声 +1 金——不亏，但也只是过渡。`,
      `${nm} 选金矿主求稳，独吞一块钱。没人能蹭，安全牌一张。`,
      `${nm} 蹲在河边淘了块金子。平平无奇？不，省下的每一手都是伏笔。`,
    ]);
  } else if (isPower && amLeading) {
    kind = "power";
    line = hu ? castPick([
      `霸气外露！领跑的 ${nm} 用一记 <b>${cn}</b> 把优势焊死，预计净赚 <b>${a.myGain.toFixed(1)}</b> 分！王座上的风景如何？全场都在仰望你！`,
      `碾压！就是碾压！你的 <b>${cn}</b> 又是一波暴击，AI 的风扇都转出了哀鸣！谁能拦住你？！`,
    ]) : castPick([
      `霸气外露！领跑的 ${nm} 用一记 <b>${cn}</b> 把优势焊死，预计净赚 <b>${a.myGain.toFixed(1)}</b> 分！这是属于王者的从容！`,
      `碾压！就是碾压！${nm} 的 <b>${cn}</b> 又是一波暴击，把分差拉到令人窒息！谁能拦住他？！`,
    ]);
  } else if (amTrailing && a.myGain >= 1.2) {
    kind = "power";
    line = hu ? castPick([
      `但是！！！垫底的 ${nm} 没有认输！这记 <b>${cn}</b> 撕开一道口子，净赚 <b>${a.myGain.toFixed(1)}</b> 分——我听到了绝境中的怒吼！英雄不死，翻盘有望！`,
      `不服输！你在最艰难的时刻祭出 <b>${cn}</b>，硬生生抢回一口气！这就是冠军的心脏！看台都被你点燃了！`,
    ]) : castPick([
      `但是！！！垫底的 ${nm} 没有认输！这记 <b>${cn}</b> 撕开一道口子，净赚 <b>${a.myGain.toFixed(1)}</b> 分——绝境中的怒吼，英雄不死！`,
      `不服输！${nm} 在最艰难的时刻祭出 <b>${cn}</b>，硬生生抢回一口气！这就是冠军的心脏！`,
    ]);
  } else if (isPower) {
    kind = "power";
    line = hu ? castPick([
      `漂亮！${nm}，你这记 <b>${cn}</b> 价值连城，预计净赚 <b>${a.myGain.toFixed(1)}</b> 分！强！实在是强！`,
      `世界级的一手！你拿下 <b>${cn}</b>，收益拉满——这水平，解说席集体起立！`,
    ]) : castPick([
      `漂亮！${nm} 这记 <b>${cn}</b> 价值连城，预计净赚 <b>${a.myGain.toFixed(1)}</b> 分！强！太强了！`,
      `世界级的一手！${nm} 拿下 <b>${cn}</b>，收益拉满，全场起立！`,
      `教科书都要为这一手加印一页！${nm} 的 <b>${cn}</b>，净赚 <b>${a.myGain.toFixed(1)}</b> 分，行云流水！`,
    ]);
  } else if (isMeh) {
    kind = "talk";
    line = hu ? castPick([
      `${nm} 选了 <b>${cn}</b>，收益平平（约 <b>${a.myGain.toFixed(1)}</b> 分）。稳健的一手——还是说，在憋什么后手？我盯着你呢。`,
      `不温不火，你拿下 <b>${cn}</b>。没什么火花，但棋盘上的杀招往往就藏在这种安静里。`,
    ]) : castPick([
      `${nm} 选了 <b>${cn}</b>，收益平平（约 <b>${a.myGain.toFixed(1)}</b> 分），保守的一手，把节奏交还牌桌。`,
      `不温不火，${nm} 拿下 <b>${cn}</b>，没什么火花，稳字当头。`,
      `${nm} 轻拿轻放一张 <b>${cn}</b>，象棋里这叫等着——看谁先沉不住气。`,
    ]);
  } else {
    kind = "talk";
    line = hu ? castPick([
      `${nm} 稳稳选下 <b>${cn}</b>，预计赚 <b>${a.myGain.toFixed(1)}</b> 分，扎实的一手。基本功，看得见！`,
      `合理！你的 <b>${cn}</b> 收益 <b>${a.myGain.toFixed(1)}</b> 分，按部就班推进——大赛拼的就是少犯错。`,
    ]) : castPick([
      `${nm} 稳稳选下 <b>${cn}</b>，预计赚 <b>${a.myGain.toFixed(1)}</b> 分，扎实的一手。`,
      `合理！${nm} 的 <b>${cn}</b> 收益 <b>${a.myGain.toFixed(1)}</b> 分，按部就班推进。`,
    ]);
  }
  // 贴合实况的"黑话"桥段（端游/控速分支自带，不重复）
  if (!endgameSpecial) { const jg = castJargon(me, chosenRole, phase, heat); if (jg) line += ` ${jg}`; }
  // 连选执念 + 头名易主 + 低概率花絮
  line += castStreakNote(me, chosenRole);
  line += castLeadChangeNote(a.standings);
  line += castColorMaybe();
  // 预测核对小花絮
  let tag = "";
  if (rank === 0) tag = hu ? `　<span class="cast-hit">[被解说看穿了✓]</span>` : `　<span class="cast-hit">[解说命中✓]</span>`;
  else if (rank > 2) tag = hu ? `　<span class="cast-miss">[你让解说员当众社死✗]</span>` : `　<span class="cast-miss">[爆冷·打脸✗]</span>`;
  // 局势播报
  const L = a.standings[0], gap = (a.standings[0].v - (a.standings[1] ? a.standings[1].v : 0));
  const allZero = a.standings.every(s => s.v === 0);
  const standingTxt = solo ? `单人闯关 · 当前 <b>${a.standings[0].v}</b> 分`
    : allZero ? `比分尚未拉开，群雄逐鹿` : `<b>${L.p.name}</b> 以 ${L.v} 分领跑（领先次席 ${gap} 分）`;
  const heatNote = heat === 2 ? `🔚 终场哨已吹响！　` : (heat === 1 ? `⏳ 末日倒计时…　` : ``);
  const acc = G._castTotal ? Math.round((G._castHits || 0) / G._castTotal * 100) : 0;
  let html = `<div class="cast-head">🎙️ 解说台</div>`;
  html += `<div class="cast-line ${kind === "miss" ? "cast-miss" : (kind === "block" || kind === "power" ? "cast-hit" : "")}">${line}${tag}</div>`;
  html += `<div class="cast-foot">${heatNote}局势：${standingTxt}　·　解说命中 ${G._castHits || 0}/${G._castTotal}（${acc}%）</div>`;
  commentarySay(html, kind);
}

function startGame() {
  const n = parseInt(document.getElementById("player-count").value);
  const name = document.getElementById("player-name").value || "玩家";
  // 单人闯关没有 AI 对手，强制玩家为真人（忽略"全部 AI"勾选）
  const allAI = (n >= 2) && !!document.getElementById("all-ai")?.checked;
  // 5 个独立扩展模块，可任意组合勾选
  const mods = {
    newBuildings:  !!document.getElementById("mod-newbuildings")?.checked,
    nobles:        !!document.getElementById("mod-nobles")?.checked,
    tibsBuildings: !!document.getElementById("mod-tibs")?.checked,
    festival:      !!document.getElementById("mod-festival")?.checked,
    buccaneer:     !!document.getElementById("mod-buccaneer")?.checked,
  };
  G = new Game(n, name, mods); // 第 4 参省略，海盗已在 mods 内
  G.expansionType = mods;
  let needsNN = false;
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
      if (lvl === 6) needsNN = true;
    }
  });
  window._allAIMode = !!allAI;
  window._liveCastOn = !!document.getElementById("live-cast")?.checked; // 人机对战实况解说开关
  assignCastNames(); // 给每位 AI 选手起一个昵称（解说要喊名字；难度由解说单独播报）
  // 读取 AI 思考预算。全 AI 观战模式也尊重所选预算（配合 5s/10s 节奏让观众
  // 能看清强 AI 的对局），不再强制 fast。想快速看完可自行选 fast。
  const budgetSel = document.getElementById("ai-think-budget");
  const budgetMode = budgetSel ? budgetSel.value : 'deep';
  // 困难/专家(MCTS)用搜索迭代数(iters)+墙钟上限(ms)；L4/L5/L6 键供内部启发式深度用
  // L6(AlphaZero) 用 NN 制导 PUCT，每次 sim 跑一次 NN forward (~1ms)，所以 iters/ms 都比 L5 略低
  const budgetMap = {
    fast:    { L4: 50,    L5: 100,   hardIters: 60,  hardMs: 500,  expertIters: 200,  expertMs: 800,  alphaIters: 100,  alphaMs: 600 },
    normal:  { L4: 800,   L5: 1500,  hardIters: 150, hardMs: 2000, expertIters: 1000, expertMs: 3000, alphaIters: 400,  alphaMs: 2500 },
    deep:    { L4: 1500,  L5: 6000,  hardIters: 350, hardMs: 5000, expertIters: 1800, expertMs: 6000, alphaIters: 800,  alphaMs: 5000 },
    // 极限：迭代上限大幅抬高，让【时间预算】成为唯一约束 → AI 真的把整段时间用满、不停推演更多可能（L6 此前 1600 次常在 10s 前就停了）
    extreme: { L4: 2500,  L5: 10000, hardIters: 700, hardMs: 8000, expertIters: 60000, expertMs: 12000, alphaIters: 40000, alphaMs: 12000 },
  };
  window._aiThinkBudget = budgetMap[budgetMode] || budgetMap.deep;
  document.getElementById("setup-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  // 观战解说台：仅真人观战全 AI 对战时显示，新开局先清空/隐藏
  const cbox = document.getElementById("commentary-box");
  if (cbox) { cbox.className = "hidden"; cbox.innerHTML = ""; }
  render();
  // L6 异步加载 NN（不阻塞 startup；未加载完前若选 L6 会回退到 L5）
  if (needsNN) loadAlphaZeroNN();
  if (typeof PRTrace !== "undefined") PRTrace.begin(G); // 对局日志：开局
  runMainLoop();
}

// 懒加载 AlphaZero NN，首次需要时调用一次。
// 优先用内嵌的 window.__MCTS_VALUE_NN__（由 mcts_value_nn_data.js 提供）——双击 index.html
// 离线运行时，file:// 下 fetch 本地 json 会被浏览器 CORS 拦截，靠内嵌权重才能让宗师离线可用；
// 没有内嵌时再 fetch mcts_value_nn.json（线上 / 本地服务器 / Node 测试）。失败则静默回退到 L5。
// 测试用：右上角悬浮徽标，提示当前用的是哪个 value-NN（仅 ?net=rank 时出现）
function showNetBadge(text) {
  if (typeof document === "undefined" || document.getElementById("net-badge")) return;
  const b = document.createElement("div");
  b.id = "net-badge"; b.textContent = text;
  b.style.cssText = "position:fixed;top:8px;right:8px;z-index:9999;background:#7a3b00;color:#ffd479;border:1px solid #ffd479;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,.4)";
  document.body.appendChild(b);
}
let _nnLoadPromise = null;
function loadAlphaZeroNN() {
  if (typeof PRSim === "undefined" || !PRSim || !PRSim.loadNetwork) return Promise.resolve(null);
  if (PRSim.isLoaded && PRSim.isLoaded()) return Promise.resolve(true);
  if (_nnLoadPromise) return _nnLoadPromise;
  // 默认用内嵌(离线)或部署网；URL 加 ?net=rank 时强制加载 rank 候选网（测试用，不影响默认部署网）
  let src, netTag = "deploy";
  let netParam = null;
  try { netParam = new URLSearchParams(location.search).get("net"); } catch (e) {}
  if (netParam === "rank") {
    src = "mcts_value_nn_rank.json"; netTag = "rank候选";
    showNetBadge("🧪 测试网: rank 候选（抢第一目标）");
  } else {
    src = (typeof window !== "undefined" && window.__MCTS_VALUE_NN__) ? window.__MCTS_VALUE_NN__ : "mcts_value_nn.json";
  }
  _nnLoadPromise = PRSim.loadNetwork(src)
    .then(() => { console.log(`[L6] AlphaZero NN loaded (${netTag})`); return true; })
    .catch(e => { console.warn("[L6] AlphaZero NN missing, fallback to L5 behavior:", e.message); return false; });
  return _nnLoadPromise;
}

// 动态渲染每个 CPU 的难度下拉
function renderCpuLevels() {
  const np = parseInt(document.getElementById("player-count").value);
  const allAI = document.getElementById("all-ai")?.checked;
  const container = document.getElementById("cpu-levels");
  if (!container) return;
  container.innerHTML = "";
  // 模式说明（单人 / 双人变体）
  const note = document.getElementById("mode-note");
  if (note) {
    if (np === 1) {
      note.classList.remove("hidden");
      note.innerHTML = `🏝️ <b>单人闯关</b>：独自经营全岛，每轮从 7 个角色中选 <b>3</b> 个执行。目标是把终局 VP 刷到最高 —— 结算时按分数评定头衔（学徒 → 总督大人）。船容量 4/6，资源池已为单人缩放。`;
    } else if (np === 2) {
      note.classList.remove("hidden");
      note.innerHTML = `⚔️ <b>官方双人变体（Alea/Ravensburger）</b>：每轮两人<b>轮流各选 3 个角色</b>（共 6 次）再换总督；建筑库存减半、仅 2 艘船(容量 4/6)、65 VP、起始 3 金 + 总督靛蓝/次席玉米。`;
    } else {
      note.classList.add("hidden");
      note.innerHTML = "";
    }
  }
  if (np === 1) return; // 单人无 CPU
  const startIdx = allAI ? 0 : 1; // 全 AI 时第 0 个也是 CPU
  for (let i = startIdx; i < np; i++) {
    const wrap = document.createElement("label");
    wrap.className = "cpu-row";
    // 默认值（内部 _aiLevel）：后面 CPU 默认更强 — 最后=专家(5)，次后=困难(4)
    const defaultInternal = (i === np - 1) ? 5 : (i === np - 2) ? 4 : (i === 1) ? 2 : 3;
    wrap.innerHTML = `
      <span>CPU ${i + 1}：</span>
      <select id="cpu-level-${i}" class="cpu-level-sel">
        ${SELECTABLE_LEVELS.map(({ internal, label }) =>
          `<option value="${internal}" ${internal === defaultInternal ? 'selected' : ''}>${label} ${AI_LEVEL_NAMES[internal].cn} · ${AI_LEVEL_NAMES[internal].desc}</option>`).join("")}
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
      else if (set === "all5") sel.value = "5"; // 专家(MCTS深搜)
      else if (set === "all6") sel.value = "6"; // 宗师(AlphaZero)
      else if (set === "mixed") {
        // 混合：1,2,3,4,5,6 循环 = 入门/进化/普通/困难/专家/宗师
        sel.value = String((idx % 6) + 1);
      }
    });
  });
});
// 扩展模块预设按钮（基础 / 官方新建筑+贵族 / 全开含Tibs）——一键勾选 5 个独立模块复选框
document.querySelectorAll("[data-mods]").forEach(btn => {
  btn.addEventListener("click", () => {
    const set = (id, on) => { const el = document.getElementById(id); if (el) el.checked = on; };
    const p = btn.dataset.mods;
    const cfg = p === "official" ? [1, 1, 0, 0, 0]
              : p === "all"      ? [1, 1, 1, 1, 1]
              :                    [0, 0, 0, 0, 0]; // none
    ["mod-newbuildings", "mod-nobles", "mod-tibs", "mod-festival", "mod-buccaneer"].forEach((id, i) => set(id, !!cfg[i]));
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
// 新建筑扩展：开局「轮抽选建筑」——从 24 小(基础12+新12)选 12、7 大(基础5+新2)选 5；生产建筑(1-6)恒在。
// 每个费用列的空位数 = 基础游戏该列的小建筑数；玩家从总督起顺时针轮流挑选哪些建筑进入本局。
async function runDraft(G) {
  const smallSlots = { 1: 1, 2: 2, 3: 1, 4: 1, 5: 2, 6: 1, 7: 1, 8: 2, 9: 1 }; // 共 12
  const largeSlots = { 10: 5 };
  // 扩展II 贵族建筑(38+)不参与轮抽：官方规则是"额外加在板上"
  const poolSmall = BUILDINGS.filter(b => b.type === "violet" && b.id < 38);
  const poolLarge = BUILDINGS.filter(b => b.type === "large_violet" && b.id < 38);
  const picked = new Set();
  const totalPicks = 12 + 5;
  G.logEvent(`🏛️ 新建筑扩展：轮抽建筑开始（每人轮流选哪些建筑进入本局，共 ${totalPicks} 个）`, "role");
  for (let t = 0; t < totalPicks; t++) {
    const pidx = (G.governor + t) % G.numPlayers;
    const p = G.players[pidx];
    const pickable = [];
    for (const b of poolSmall) if (!picked.has(b.id) && smallSlots[b.cost] > 0) pickable.push(b);
    for (const b of poolLarge) if (!picked.has(b.id) && largeSlots[b.cost] > 0) pickable.push(b);
    if (pickable.length === 0) break;
    let chosen;
    if (p.isHuman) {
      G._currentPlayer = pidx;
      G._currentPrompt = `🏛️ 轮抽建筑（第 ${t + 1}/${totalPicks}）：选 1 个进入本局`;
      render();
      const labels = pickable.map(b => `${b.cn} ${b.id >= 24 ? "🆕" : ""}（${b.cost}💰 ${b.vp}⭐）`);
      const idx = await humanPickFromList("🏛️ 轮抽：选 1 个建筑进入本局", labels, false);
      chosen = pickable[idx >= 0 ? idx : 0];
    } else {
      let best = pickable[0], bestV = -Infinity;
      for (const b of pickable) { const v = evalBuildingValue(p, b, "early"); if (v > bestV) { bestV = v; best = b; } }
      chosen = best;
    }
    picked.add(chosen.id);
    if (chosen.type === "violet") smallSlots[chosen.cost]--; else largeSlots[chosen.cost]--;
    G.logEvent(`${p.name} 轮抽选入：${chosen.cn}`, "action");
  }
  // 重建在场建筑 = 生产(1-6) + 被选中的紫色/大紫；未选入的从市场/库存移除
  const keep = new Set([1, 2, 3, 4, 5, 6, ...picked]);
  if (G.expansionNobles) for (const b of NOBLE_BUILDINGS) keep.add(b.id); // 贵族建筑全部保留
  if (G.expansionTibs) for (const b of TIBS_BUILDINGS) keep.add(b.id);    // Tibs 自制建筑全部保留
  for (let i = BUILDINGS.length - 1; i >= 0; i--) if (!keep.has(BUILDINGS[i].id)) BUILDINGS.splice(i, 1);
  G.buildingStock = {};
  BUILDINGS.forEach(b => G.buildingStock[b.id] = (G.numPlayers === 2) ? (b.type === "production" ? 2 : 1) : b.qty);
  G._drafted = true;
  G._currentPrompt = null;
  G.logEvent(`🏛️ 轮抽完成：本局共 ${BUILDINGS.length} 个建筑可建（6 生产 + 17 紫色/大紫）`, "role");
  render();
}

async function runMainLoop() {
  if (castOn()) castOpening(); // 解说开场白：介绍今晚的对阵
  // 扩展：开局先轮抽决定哪些建筑进入本局
  if (G.expansion && !G._drafted) await runDraft(G);
  while (!G.gameOver) {
    G.logEvent(`=== 第 ${G.turnNumber} 回合 — 总督: ${G.players[G.governor].name} ===`, "role");

    // 重置 role taken
    for (const r of G.roleCards) { r.taken = false; r.takenBy = null; }

    // 角色轮转：从 governor 开始
    // 注意：endTriggered 在 checkEndCondition 设置，但 gameOver 只在本 for-loop 结束后设。
    // 因此 endTriggered 触发后剩余玩家仍然完整地选角色 + 执行角色阶段 → 符合规则
    // "the game ends at the end of the round when..."
    // 每轮选角色次数：1p 闯关每轮选 3 个角色；2p 官方变体每人轮流选 3 个(共 6 次)再换总督；3-5p 每人 1 次
    const picksThisRound = { 1: 3, 2: 6 }[G.numPlayers] || G.numPlayers;
    for (let step = 0; step < picksThisRound; step++) {
      if (G.gameOver) break; // 安全网，正常流程下不会触发
      const playerIdx = (G.governor + step) % G.numPlayers;
      const player = G.players[playerIdx];

      // 该玩家选择一张未被选的角色卡
      // Tibs 海盗：仅人类可选 Buccaneer（AI 跳过以保护 7 角色 AI）；持奖励币者不可再选
      const available = G.roleCards.filter(r => !r.taken &&
        (r.name !== "Buccaneer" || (player.isHuman && G._buccaneerReward !== playerIdx)));
      if (available.length === 0) break;
      G._currentPlayer = playerIdx; // 在选择前设置当前玩家
      render();
      let chosenIdx;
      if (player.isHuman) {
        // 实况解说：当众押注真人的选择（不阻塞，玩家想多久都行），选完再点评
        const castPred = castOn() ? commentaryPreRoleHuman(player, available) : null;
        chosenIdx = await humanPickRole(available, player);
        if (castPred) commentaryPostRole(player, castPred, available[chosenIdx].name);
      } else {
        // 解说：开牌前预测（观战节奏慢、人机局节奏紧凑）；无解说时仅短暂延时给人类看清节奏
        let castPred = null;
        if (castOn()) {
          castPred = commentaryPreRole(player, available);
          await sleep(spectatorOn() ? CAST_PREDICT_MS : CAST_PVE_PREDICT_MS);
        } else if (!window._allAIMode) await sleep(700);
        chosenIdx = aiPickRole(player, available);
        // 解说：开牌后核对
        if (castPred) { commentaryPostRole(player, castPred, available[chosenIdx].name); await sleep(spectatorOn() ? CAST_REACT_MS : CAST_PVE_REACT_MS); }
      }
      const chosen = available[chosenIdx];
      // 对局日志：在标记 taken 之前记录（快照里该角色仍可选）
      if (typeof PRTrace !== "undefined") PRTrace.recordPick(G, playerIdx, player.isHuman, available, chosen.name);
      chosen.taken = true;
      chosen.takenBy = playerIdx;
      if (chosen.name === "Buccaneer") G._buccaneerReward = playerIdx; // 拿走奖励币（直到他人选 Buccaneer）
      const bonusMoney = chosen.money;
      chosen.money = 0;
      player.money += bonusMoney;
      G.logEvent(`${player.name} 选择 [${ROLE_NAME_CN[chosen.name]}]${bonusMoney ? ` +${bonusMoney}金` : ""}`, "role");
      // 解说台开着时不再弹"选了X"的 toast，避免和解说重复刷屏
      if (!player.isHuman && !window._allAIMode && !castOn()) {
        showToast(`<div class="t-title">${player.name} 选了 ${ROLE_NAME_CN[chosen.name]}</div>${bonusMoney ? `<div class="t-sub">+${bonusMoney}金 奖励</div>` : ""}`, { kind: "role" });
      }
      G._currentPrompt = `阶段：${ROLE_NAME_CN[chosen.name]}（由 ${player.name} 选择${bonusMoney ? `，+${bonusMoney}金` : ""}）`;
      G._currentPlayer = playerIdx;
      render();

      // 执行角色
      await runRolePhase(chosen.name, playerIdx);
      G._currentPrompt = null;

      // 检查游戏结束
      checkEndCondition();
      render();

      // 全 AI 观战：每个 AI 操作后停 5 秒，让观众看清这一手（_fastSpectator 时跳过，供无头测试用）
      if (window._allAIMode && !window._fastSpectator) await sleep(SPECTATOR_ACTION_DELAY);
    }

    // 回合结束：未被选的角色卡 +1 金（Buccaneer 不累积金币）
    for (const r of G.roleCards) {
      if (!r.taken && r.name !== "Buccaneer") r.money += 1;
    }

    if (G.endTriggered) {
      G.gameOver = true;
      break;
    }

    // 全 AI 观战：一个大回合结束后、换起始玩家前停 10 秒（_fastSpectator 时跳过，供无头测试用）
    if (window._allAIMode && !window._fastSpectator) {
      G._currentPrompt = `本回合结束 — 即将轮换起始玩家（观战暂停 ${SPECTATOR_ROUND_DELAY / 1000}s）`;
      render();
      await sleep(SPECTATOR_ROUND_DELAY);
      G._currentPrompt = null;
    }

    G.governor = (G.governor + 1) % G.numPlayers;
    G.turnNumber++;
    G.flipPlantations();
  }

  await endGame();
}

function checkEndCondition() {
  // 官方三条结束条件（任一触发；游戏继续到本回合所有玩家选完才结束）
  const wasTriggered = G.endTriggered;
  let triggerReason = null;
  // 注：殖民者不足的【权威】终局触发在 doMayor（颜色补船时 colonistsLeft < refill → endTriggered），
  // 与官方"市长阶段无法补满船即终局"一致。此处是冗余安全网（doMayor 已先触发），不影响时机。
  if (!G.expansionNobles && G.colonistsLeft <= 0 && G.colonistsOnShip <= 0) {
    G.endTriggered = true;
    triggerReason = triggerReason || "殖民者耗尽";
  }
  if (G.vpLeft <= 0) {
    G.endTriggered = true;
    triggerReason = triggerReason || "VP 池用尽";
  }
  for (const p of G.players) {
    if (G.buildingUsedSpaces(p) >= 12) {
      G.endTriggered = true;
      triggerReason = triggerReason || `${p.name} 建满 12 格`;
      break;
    }
  }
  // 首次触发时打 log + toast（避免每个阶段都重复报）
  if (!wasTriggered && G.endTriggered && triggerReason) {
    G.logEvent(`⚠ 末轮触发：${triggerReason}。本回合所有玩家选完角色后游戏结束。`, "role");
    if (typeof showToast === 'function' && !window._allAIMode) {
      showToast(`<div class="t-title">⚠ 末轮触发</div><div class="t-sub">${triggerReason}<br>本回合所有玩家选完后结束</div>`, { kind: "warn", duration: 4500 });
    }
  }
}

// 扩展II：狩猎小屋(40) — 拓殖阶段末结算
async function runHuntingLodge(order) {
  for (const i of order) {
    const p = G.players[i];
    // 贵族驻守：空岛格【独多】+2VP
    if (G.isNobleManned(p, 40)) {
      const myEmpty = 12 - p.plantations.length;
      const maxOther = Math.max(...G.players.filter(q => q !== p).map(q => 12 - q.plantations.length));
      if (myEmpty > maxOther && G.vpLeft > 0) {
        const got = Math.min(2, G.vpLeft);
        p.vp += got; G.vpLeft -= got;
        G.logEvent(`${p.name} 狩猎小屋(贵族)：空格独多 +${got} VP`, "action");
      }
    } else if (G.isColonistManned(p, 40)) {
      // 殖民者驻守：可弃 1 张种植园/森林（非采石场）；板块上的工人回岸边
      const cands = p.plantations.map((pl, k) => ({ pl, k })).filter(x => x.pl.good !== "quarry");
      if (cands.length === 0) continue;
      let pick = null;
      if (p.isHuman) {
        const labels = ["不弃", ...cands.map(x => `弃 ${x.pl.good === "forest" ? "🌲森林" : plantEmoji(x.pl.good) + GOOD_NAMES[x.pl.good]}${x.pl.manned ? "（工人回岸边）" : ""}`)];
        const idx = await humanPickFromList("狩猎小屋：可弃 1 张种植园/森林（腾出岛格）", labels, false);
        if (idx > 0) pick = cands[idx - 1];
      } // AI 不主动弃田（保守合法策略）
      if (pick) {
        const pl = pick.pl;
        if (pl.manned) {
          if (pl.noble) p._unplacedNobles = (p._unplacedNobles || 0) + 1;
          else p._unplacedMen = (p._unplacedMen || 0) + 1;
        }
        p.plantations.splice(pick.k, 1);
        G.logEvent(`${p.name} 狩猎小屋：弃 1 张${pl.good === "forest" ? "森林" : GOOD_NAMES[pl.good] + "田"}`, "action");
      }
    }
  }
}

// Tibs 海盗(Buccaneer)：选择者从 4 个行动里选 1 个（仅人类选得到此角色）。
// 不给其他玩家特权、不累积金币。规则取自 mod 内嵌 Buccaneer 说明。
async function doBuccaneer(chooserIdx) {
  const p = G.players[chooserIdx];
  const ACTIONS = [
    "🏴‍☠️ 劫掠 Piracy：清空一艘货船，留最多 3 个货",
    "🏴‍☠️ 洗劫 Plundering：清空公共贸易站，每货 +1 VP",
    "🏴‍☠️ 突袭 Attack：殖民者堆减到每人 1 名，你留最多 3 名（岸边）",
    "🏴‍☠️ 劫持 Hijacking：占一个无人角色，拿其累积金币并执行该角色",
  ];
  let act = p.isHuman ? await humanPickFromList("🏴‍☠️ 海盗：选 1 个行动", ACTIONS, false) : 1;
  if (act == null) act = 1;
  if (act === 0) {
    const ships = G.ships.map((s, i) => ({ s, i })).filter(x => x.s.count > 0 && x.s.good);
    if (!ships.length) { G.logEvent(`${p.name} 海盗·劫掠：无可劫货船`, "action"); return; }
    let pick = p.isHuman
      ? ships[await humanPickFromList("劫掠：选一艘货船清空", ships.map(x => `船${x.i + 1}: ${x.s.count}×${GOOD_NAMES[x.s.good]}`), false)]
      : ships.reduce((a, b) => a.s.count >= b.s.count ? a : b);
    const good = pick.s.good, cnt = pick.s.count, keep = Math.min(3, cnt);
    p.goods[good] += keep; G.supply[good] += (cnt - keep);
    pick.s.good = null; pick.s.count = 0;
    G.logEvent(`${p.name} 海盗·劫掠船${pick.i + 1}：留 ${keep}×${GOOD_NAMES[good]}（余 ${cnt - keep} 回供应）`, "action");
  } else if (act === 1) {
    const n = G.tradingHouse.length;
    if (!n) { G.logEvent(`${p.name} 海盗·洗劫：贸易站为空`, "action"); return; }
    for (const g of G.tradingHouse) G.supply[g]++;
    const gain = Math.min(n, G.vpLeft); p.vp += gain; G.vpLeft -= gain; G.tradingHouse = [];
    G.logEvent(`${p.name} 海盗·洗劫贸易站：清 ${n} 货 +${gain} VP`, "action");
  } else if (act === 2) {
    const removed = Math.max(0, G.colonistsLeft - G.numPlayers);
    G.colonistsLeft = Math.min(G.colonistsLeft, G.numPlayers);
    const keep = Math.min(3, removed); p._unplacedMen = (p._unplacedMen || 0) + keep;
    G.logEvent(`${p.name} 海盗·突袭：殖民者堆减到 ${G.colonistsLeft}，你留 ${keep} 名（岸边）`, "action");
  } else {
    const free = G.roleCards.filter(r => !r.taken && r.name !== "Buccaneer");
    if (!free.length) { G.logEvent(`${p.name} 海盗·劫持：无可劫角色`, "action"); return; }
    let pick = p.isHuman
      ? free[await humanPickFromList("劫持：占一个无人角色（拿其金币并执行）", free.map(r => `${ROLE_NAME_CN[r.name]}${r.money ? ` +${r.money}金` : ""}`), false)]
      : free[0];
    p.money += pick.money; pick.money = 0; pick.taken = true; pick.takenBy = chooserIdx;
    G.logEvent(`${p.name} 海盗·劫持 [${ROLE_NAME_CN[pick.name]}]：拿金币并执行该角色`, "action");
    await runRolePhase(pick.name, chooserIdx);
  }
}

async function runRolePhase(roleName, chooserIdx) {
  // 顺时针从 chooser 开始
  const order = [];
  for (let i = 0; i < G.numPlayers; i++) {
    order.push((chooserIdx + i) % G.numPlayers);
  }
  // 扩展：招待所(28) — 官方允许客工在任意阶段任意时点派出；本实现于（市长以外的）每个阶段开始时给出派遣机会，上岗后须留到下个市长阶段
  if (roleName !== "Mayor") {
    for (const i of order) {
      const p = G.players[i];
      if (p.isHuman) await humanMoveGuests(p, roleName);
    }
  }
  switch (roleName) {
    case "Settler":
      for (const i of order) await doSettler(i, i === chooserIdx);
      // 扩展：图书馆(33) 拓殖特权翻倍 — 所有人选完后，chooser 再从剩余明牌池拿 1 张种植园(不能采石场)
      {
        const sc = G.players[chooserIdx];
        if (G.isManned(sc, 33) && sc.plantations.length < 12) {
          // 图书馆+拓殖特权翻倍：再拿 1 张；若有森林屋可改拿森林
          const canForest = G.isManned(sc, 26);
          let tookForest = false;
          if (canForest) {
            let doForest;
            if (sc.isHuman) {
              const fi = await humanPickFromList("图书馆+拓殖：再拿 1 张地块（森林屋可选森林）", ["🌲 森林（每 2 块建造 -1金）", "🌱 从种植园池选"], true);
              doForest = fi === 0;
            } else {
              const violet = sc.buildings.filter(b => { const t = BLD_BY_ID[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
              doForest = violet >= 3 && sc.plantations.filter(pl => pl.good === "forest").length < 4;
            }
            if (doForest && G.plantationPool.length > 0) {
              // 森林同样必须翻扣 1 张明牌田
              let fi2;
              if (sc.isHuman) fi2 = await humanPickFromList("森林屋：选 1 张明牌田翻扣为森林", G.plantationPool.map(g => plantEmoji(g) + GOOD_NAMES[g]), false);
              else fi2 = G.plantationPool.reduce((bi, g, k, arr) => GOOD_PRICE[g] < GOOD_PRICE[arr[bi]] ? k : bi, 0);
              const flipped2 = G.plantationPool.splice(fi2, 1)[0];
              sc.plantations.push({ good: "forest", manned: false });
              G.logEvent(`${sc.name} 图书馆+森林屋：翻扣 ${GOOD_NAMES[flipped2]} 再拿 1 块森林`, "action");
              if (!sc.isHuman && !window._allAIMode) showToast(`<div class="t-title">${sc.name} 图书馆+森林屋 再拿森林</div>`, { kind: "role" });
              if (sc.isHuman && !window._allAIMode) showToast(`<div class="t-title">图书馆+森林屋：再拿 1 块森林</div>`, { kind: "gain" });
              tookForest = true;
            }
          }
          const canQuarry2 = G.isManned(sc, 9) && G.quarriesLeft > 0; // 规则书注：有建筑工地时第二张也可拿采石场
          if (!tookForest && (G.plantationPool.length > 0 || canQuarry2)) {
            const opts2 = G.plantationPool.map((g, k) => ({ kind: "plant", good: g, idx: k }));
            if (canQuarry2) opts2.push({ kind: "quarry" });
            let pi;
            if (sc.isHuman) pi = await humanPickFromList("图书馆+拓殖：再拿 1 张地块", opts2.map(o => o.kind === "quarry" ? "🪨 采石场（建筑工地）" : plantEmoji(o.good) + GOOD_NAMES[o.good]), true);
            else pi = aiPickPlantation(sc, opts2, false);
            if (pi !== null && pi >= 0 && pi < opts2.length && opts2[pi].kind === "quarry") {
              G.quarriesLeft--;
              sc.plantations.push({ good: "quarry", manned: false });
              G.logEvent(`${sc.name} 图书馆+拓殖：再拿 🪨采石场（建筑工地）`, "action");
            } else if (pi !== null && pi >= 0 && pi < opts2.length) {
              const g2 = G.plantationPool.splice(opts2[pi].idx, 1)[0];
              const libPlant = { good: g2, manned: false };
              sc.plantations.push(libPlant);
              G.logEvent(`${sc.name} 图书馆+拓殖：再拿 ${GOOD_NAMES[g2]} 田`, "action");
              if (!sc.isHuman && !window._allAIMode) showToast(`<div class="t-title">${sc.name} 图书馆+拓殖 再拿 ${GOOD_NAMES[g2]} 田</div>`, { kind: "role" });
              if (sc.isHuman && !window._allAIMode) showToast(`<div class="t-title">图书馆+拓殖：再拿 ${GOOD_NAMES[g2]} 田</div>`, { kind: "gain" });
              // 规则书明确：济贫院只对第一张地块给殖民者，图书馆的第二张地块不触发
            }
          }
        }
      }
      // 扩展II：狩猎小屋(40) — 拓殖阶段末：殖民者驻守可弃 1 张种植园/森林；贵族驻守且空格独多 +2VP
      if (G.expansionNobles) await runHuntingLodge(order);
      // FIX: 拓殖者阶段结束后，所有未被选的种植园全部弃掉，下回合重新翻
      if (G.plantationPool.length > 0) {
        G.plantationDiscard = G.plantationDiscard.concat(G.plantationPool);
        G.logEvent(`弃掉 ${G.plantationPool.length} 张未选的种植园`, "action");
        G.plantationPool = [];
      }
      break;
    case "Mayor":     await doMayor(chooserIdx, order); break;
    case "Builder":   for (const i of order) await doBuilder(i, i === chooserIdx); break;
    case "Craftsman":
      for (const p of G.players) if (!p.isHuman) deployGuests(p); // 扩展：招待所 — AI 工匠前自动部署客工到生产位
      await doCraftsman(chooserIdx, order);
      break;
    case "Trader":
      // 扩展II：地产办公室在卖货之外（或不卖货时）也可使用
      for (const i of order) { await doTrader(i, i === chooserIdx); await runLandOffice(G.players[i]); }
      // FIX #32: 阶段末作为 trader 的最后职责，若贸易站满则清空到供应区
      if (G.tradingHouse.length >= 4) {
        for (const g of G.tradingHouse) G.supply[g]++;
        G.logEvent(`贸易站已满，${G.tradingHouse.length} 个货物归还供应区`, "action");
        G.tradingHouse = [];
      }
      break;
    case "Captain":   await doCaptain(order, chooserIdx); break;
    case "Prospector": {
      const pr = G.players[chooserIdx];
      const gold = G.isManned(pr, 33) ? 2 : 1; // 图书馆：特权翻倍
      pr.money += gold;
      G.logEvent(`${pr.name} 拿 ${gold} 金币`, "action");
      if (!window._allAIMode) {
        if (pr.isHuman) showToast(`<div class="t-title">金矿主：你 +${gold}金</div>`, { kind: "gain" });
        else showToast(`<div class="t-title">${pr.name} 金矿主：+${gold}金</div>`, { kind: "role" });
      }
      // Tibs 塔楼(49)：非选择者塔楼主也得金矿主特权 +1 金
      for (const i of order) {
        if (i === chooserIdx) continue;
        const tp = G.players[i];
        if (G.towerActive(tp)) { tp.money += 1; G.logEvent(`${tp.name} 塔楼·金矿主特权：+1 金`, "action"); }
      }
    }
      break;
    case "Buccaneer": await doBuccaneer(chooserIdx); break; // Tibs 海盗
  }
  // Tibs 节庆模块：每个角色阶段结束后结算竞速目标
  if (G.checkFestival) G.checkFestival(roleName);
}

// ============================================================
// 角色阶段实现
// ============================================================
async function doSettler(playerIdx, isChooser) {
  const p = G.players[playerIdx];
  if (p.plantations.length >= 12) return; // 满
  // 扩展：森林屋(26) — 可改拿一块「森林」：从明牌池拿 1 张种植园（不能用采石场）反扣置于岛上
  // （规则书：取走的是明牌池里的实体板块，因此会减少其他玩家的可选明牌）
  if (G.isManned(p, 26) && G.plantationPool.length > 0) {
    let takeForest;
    if (p.isHuman) {
      const idx = await humanPickFromList("森林屋：本次拓殖要拿什么？", ["🌲 拿一块森林（翻扣 1 张明牌田；每 2 块建造 -1 金）", "🌱 拿种植园 / 采石场（正常）"], true);
      if (idx === null) return; // 跳过整个拓殖
      takeForest = (idx === 0);
    } else {
      const violet = p.buildings.filter(b => { const t = BLD_BY_ID[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
      const forests = p.plantations.filter(pl => pl.good === "forest").length;
      takeForest = violet >= 3 && forests < 4; // 建筑流的 AI 才囤森林省建造费
    }
    if (takeForest) {
      let fi;
      if (p.isHuman) {
        fi = await humanPickFromList("森林屋：选 1 张明牌田翻扣为森林", G.plantationPool.map(g => plantEmoji(g) + GOOD_NAMES[g]), false);
      } else {
        // AI：翻扣对自己价值最低（价格最低）的明牌田
        fi = G.plantationPool.reduce((bi, g, k, arr) => GOOD_PRICE[g] < GOOD_PRICE[arr[bi]] ? k : bi, 0);
      }
      const flipped = G.plantationPool.splice(fi, 1)[0];
      p.plantations.push({ good: "forest", manned: false });
      G.logEvent(`${p.name} 森林屋：翻扣 ${GOOD_NAMES[flipped]} 田作为森林`, "action");
      if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 拿了森林（翻扣 ${GOOD_NAMES[flipped]}）</div>`, { kind: "role" });
      // 规则书：济贫院持有者放置森林时，殖民者放到自己的风向标（岸边）
      if (G.isManned(p, 11)) {
        if (G.colonistsLeft > 0) { G.colonistsLeft--; p._unplacedMen = (p._unplacedMen || 0) + 1; G.logEvent(`${p.name} 济贫院+森林：殖民者放到岸边 (从供应区)`, "action"); }
        else if (G.colonistsOnShip > 0) { G.colonistsOnShip--; p._unplacedMen = (p._unplacedMen || 0) + 1; G.logEvent(`${p.name} 济贫院+森林：殖民者放到岸边 (从船上)`, "action"); }
      }
      return;
    }
  }
  // 庄园 Hacienda 效果（规则书：在拿明牌种植园"之前"，可选地从暗牌堆额外拿一张）
  if (G.isManned(p, 8) && p.plantations.length < 12 && G.plantationDeck.length > 0) {
    let useHacienda = true;
    if (p.isHuman) {
      const idx = await humanPickFromList("庄园效果：是否先从暗牌堆额外拿 1 张种植园？", ["使用（拿 1 张暗牌）", "不使用"], false);
      useHacienda = (idx === 0);
    }
    if (useHacienda) {
      const extra = G.plantationDeck.pop();
      p.plantations.push({ good: extra, manned: false });
      G.logEvent(`${p.name} 庄园效果：+${GOOD_NAMES[extra]}`, "action");
    }
  }
  if (p.plantations.length >= 12) return; // 庄园拿满 12 格后不能再拿明牌田
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
  // 等拿田动画播放完（真人观战也播放；仅无头测试跳过）
  if (!window._fastSpectator) await sleep(350);
  // 济贫院 Hospice 效果：新种植园上+1人。优先从供应区，没有则从船上。
  // （注意：规则书明确济贫院只作用于本阶段正常拿的那张田，不作用于庄园的额外暗牌田）
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
  // Tibs 寄宿屋(48 = Tibs 改名的济贫院，但对采石场也生效)：拿到的明牌种植园/采石场自带 1 殖民者
  if (G.expansionTibs && !plantation.manned && G.isManned(p, 48)) {
    if (G.colonistsLeft > 0) { plantation.manned = true; G.colonistsLeft--; G.logEvent(`${p.name} 寄宿屋：新地自带殖民者(供应区)`, "action"); }
    else if (G.colonistsOnShip > 0) { plantation.manned = true; G.colonistsOnShip--; G.logEvent(`${p.name} 寄宿屋：新地自带殖民者(船上)`, "action"); }
  }
  G.logEvent(`${p.name} 拓殖：${choice.kind === "quarry" ? "🪨采石场" : plantEmoji(choice.good) + GOOD_NAMES[choice.good]}`, "action");
  if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 拿了 ${choice.kind === "quarry" ? "采石场" : GOOD_NAMES[choice.good]} 田</div>`, { kind: "role" });
}

async function doMayor(chooserIdx, order) {
  // FIX: chooser 的奖励殖民者来自总供应区（colonistsLeft），不是船上
  // 扩展：图书馆(33) — 市长特权翻倍（从供应区 +2 殖民者）
  {
    const p = G.players[chooserIdx];
    let take = G.isManned(p, 33) ? 2 : 1;
    let got = 0;
    while (take-- > 0 && G.colonistsLeft > 0) { G.colonistsLeft--; p._unplacedMen = (p._unplacedMen || 0) + 1; got++; }
    if (got > 0) {
      G.logEvent(`${p.name} 市长特权：从供应区+${got}殖民者`, "action");
      if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 市长特权${got > 1 ? ' 图书馆 +2' : ' +1'} 殖民者</div>`, { kind: "role" });
    }
  }
  // Tibs 塔楼(49)：非选择者的塔楼主也得市长特权 +1 殖民者
  for (const i of order) {
    if (i === chooserIdx) continue;
    const tp = G.players[i];
    if (G.towerActive(tp) && G.colonistsLeft > 0) {
      G.colonistsLeft--; tp._unplacedMen = (tp._unplacedMen || 0) + 1;
      G.logEvent(`${tp.name} 塔楼·市长特权：+1 殖民者`, "action");
    }
  }
  // 扩展II：别墅(43) — 市长阶段首轮额外从供应区拿 1 名贵族（无贵族则拿殖民者）
  if (G.expansionNobles) {
    for (const i of order) {
      const p = G.players[i];
      if (!G.isManned(p, 43)) continue;
      if (G.noblesLeft > 0) {
        G.noblesLeft--; p._unplacedNobles = (p._unplacedNobles || 0) + 1;
        G.logEvent(`${p.name} 别墅：从供应区 +1 贵族`, "action");
      } else if (G.colonistsLeft > 0) {
        G.colonistsLeft--; p._unplacedMen = (p._unplacedMen || 0) + 1;
        G.logEvent(`${p.name} 别墅：贵族用尽，改拿 1 殖民者`, "action");
      }
    }
  }
  // FIX: 船上的殖民者（含贵族）按顺时针轮转分配 (每次1人) 直到船空；两者都有时玩家自选
  let safety = 0;
  while ((G.colonistsOnShip > 0 || G.noblesOnShip > 0) && safety++ < 200) {
    for (const i of order) {
      if (G.colonistsOnShip <= 0 && G.noblesOnShip <= 0) break;
      const p = G.players[i];
      let takeNoble;
      if (G.noblesOnShip > 0 && G.colonistsOnShip > 0) {
        if (p.isHuman) {
          const ti = await humanPickFromList(`市长：从船上拿哪一个？（船上 殖民者×${G.colonistsOnShip} / 贵族×${G.noblesOnShip}）`, ["🎩 贵族（终局 1 VP，可触发贵族建筑功能）", "👷 殖民者"], false);
          takeNoble = ti === 0;
        } else takeNoble = true; // AI 优先拿贵族
      } else takeNoble = G.noblesOnShip > 0;
      if (takeNoble) { G.noblesOnShip--; p._unplacedNobles = (p._unplacedNobles || 0) + 1; }
      else { G.colonistsOnShip--; p._unplacedMen = (p._unplacedMen || 0) + 1; }
    }
  }
  // 在分配前快照人类玩家本轮收到的殖民者数（含 chooser 特权 +1 / 船上分配）
  const humanForToast = G.players.find(pp => pp.isHuman);
  const humanReceivedMen = humanForToast ? (humanForToast._unplacedMen || 0) : 0;
  // FIX #30 & #31: 先让玩家分配（强制满岗），再补船
  for (const i of order) {
    const p = G.players[i];
    if (!p._unplacedMen && !p._unplacedNobles) continue; // 只有贵族也要进入分配
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
  // （贵族扩展：殖民者耗尽【不再】触发终局——玩家可把全部殖民者用完，终局只看 12 格 / VP 池）
  if (!G.expansionNobles && G.colonistsLeft < refill) {
    G.endTriggered = true;
    G.logEvent(`⚠ 供应殖民者不足（${G.colonistsLeft} < 需补 ${refill}），本回合后游戏结束`, "role");
  }
  // 贵族扩展：补船时用 1 名贵族替换 1 名殖民者（贵族供应有剩时）
  let nobleRefill = 0;
  if (G.expansionNobles && G.noblesLeft > 0 && refill > 0) {
    nobleRefill = 1; G.noblesLeft--;
  }
  const actualRefill = Math.min(refill - nobleRefill, G.colonistsLeft);
  G.colonistsOnShip = actualRefill;
  G.noblesOnShip = nobleRefill;
  G.colonistsLeft -= actualRefill;
  G.logEvent(`市长阶段结束，已分配并补船 ${actualRefill + nobleRefill} 人${nobleRefill ? `（含 ${nobleRefill} 名贵族）` : ""}`, "action");
  if (humanForToast && !window._allAIMode && humanReceivedMen > 0) {
    showToast(`<div class="t-title">市长：你 +${humanReceivedMen} 殖民者</div>`, { kind: "gain" });
  }
}

async function humanReallocate(p) {
  // FIX #31 + #33: 必须填满所有空位（如果有）；允许先"拿下"已上岗的殖民者/贵族到岸边重分配
  let remaining = p._unplacedMen;
  let remNobles = p._unplacedNobles || 0;

  // 第一阶段：允许玩家拿下已有的殖民者/贵族（可选）
  while (true) {
    const occupied = [];
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      const nb = b.nobles || 0;
      if (b.men - nb > 0) occupied.push({ kind: "rm_building", bid: b.bid, noble: false, label: `拿下 👷 ${bd.cn} (${b.men}/${bd.men})` });
      if (nb > 0) occupied.push({ kind: "rm_building", bid: b.bid, noble: true, label: `拿下 🎩 ${bd.cn} (${b.men}/${bd.men})` });
    }
    for (let i = 0; i < p.plantations.length; i++) {
      const pl = p.plantations[i];
      if (pl.manned) {
        occupied.push({ kind: "rm_plant", idx: i, label: `拿下 ${pl.noble ? "🎩" : ""}${pl.good === "quarry" ? "🪨" : plantEmoji(pl.good)} ${pl.good === "quarry" ? "采石场" : GOOD_NAMES[pl.good]}` });
      }
    }
    if (occupied.length === 0) break;
    occupied.unshift({ kind: "done_picking", label: "✓ 完成拿下，开始放置" });
    const idx = await humanPickFromList(
      `市长阶段：可拿下已上岗的殖民者重分配（岸边 👷${remaining}${remNobles ? ` 🎩${remNobles}` : ""}）`,
      occupied.map(o => o.label), false
    );
    const choice = occupied[idx];
    if (choice.kind === "done_picking") break;
    if (choice.kind === "rm_building") {
      const b = p.buildings.find(bb => bb.bid === choice.bid);
      b.men--;
      if (choice.noble) { b.nobles--; remNobles++; }
      else remaining++;
    } else if (choice.kind === "rm_plant") {
      const pl = p.plantations[choice.idx];
      pl.manned = false;
      if (pl.noble) { pl.noble = false; remNobles++; }
      else remaining++;
    }
  }

  // 第二阶段：放置（必须填满；殖民者与贵族都可放任意空位）
  while (remaining + remNobles > 0) {
    const slots = [];
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (b.men < bd.men) slots.push({ kind: "building", bid: b.bid, label: `${bd.cn} (${b.men}/${bd.men})` });
    }
    for (let i = 0; i < p.plantations.length; i++) {
      const pl = p.plantations[i];
      if (pl.good === "forest") continue; // 森林不可上工人
      if (!pl.manned) slots.push({ kind: "plant", idx: i, label: (pl.good === "quarry" ? "🪨" : plantEmoji(pl.good)) + " " + (pl.good === "quarry" ? "采石场" : GOOD_NAMES[pl.good]) });
    }
    if (slots.length === 0) break;
    const idx = await humanPickFromList(`必须放置（剩余 👷${remaining}${remNobles ? ` 🎩${remNobles}` : ""}，规则要求填满所有空位）`, slots.map(s => s.label), false);
    const choice = slots[idx];
    // 选择放殖民者还是贵族（两者都有时询问）
    let useNoble;
    if (remaining > 0 && remNobles > 0) {
      const ti = await humanPickFromList("放置哪种？", ["👷 殖民者", "🎩 贵族（贵族建筑功能需要贵族驻守）"], false);
      useNoble = ti === 1;
    } else useNoble = remNobles > 0;
    if (choice.kind === "building") {
      const b = p.buildings.find(bb => bb.bid === choice.bid);
      b.men++;
      if (useNoble) b.nobles = (b.nobles || 0) + 1;
    } else {
      const pl = p.plantations[choice.idx];
      pl.manned = true;
      if (useNoble) pl.noble = true;
    }
    if (useNoble) remNobles--; else remaining--;
  }
  p._unplacedMen = remaining;
  p._unplacedNobles = remNobles;
}

// 激活大紫建筑的终局特殊分（粗估，用于派工优先级）
function estLargeVioletSpecial(p, id) {
  if (id === 19) { let s = 0; for (const b of p.buildings) { const bd = BLD_BY_ID[b.bid]; if (bd.type === "production") s += (bd.men === 1 ? 1 : 2); } return s; }
  if (id === 20) { const n = p.plantations.length; return n <= 9 ? 4 : n === 10 ? 5 : n === 11 ? 6 : 7; }
  if (id === 21) return Math.floor(G.totalColonists(p) / 3);
  if (id === 22) return Math.floor(p.vp / 4);
  if (id === 23) return p.buildings.filter(b => { const t = BLD_BY_ID[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
  if (id === 53) { let n = 0; for (const op of G.players) { if (op === p) continue; n += op.buildings.filter(b => BLD_BY_ID[b.bid].type === "large_violet").length; } return n * 2; } // Tibs 大教堂：对手大紫数 ×2
  if (id === 45) return G.nobleCount(p); // 贵族扩展 皇家花园：每名贵族再 +1VP
  return 1;
}

// 玩家"心仪的大紫块"：在库存内、未拥有、有 2 格空间的大紫里，挑终局特殊分最高的那个，
// 作为全局规划目标（攒钱去抢 / 优先选建造）。大紫是单张，抢晚就被人拿走。
function bestLargeViolet(p) {
  const spaceLeft = 12 - G.buildingUsedSpaces(p);
  let best = null;
  for (const b of BUILDINGS) {
    if (b.type !== "large_violet") continue;
    if (G.buildingStock[b.id] <= 0 || G.ownsBuilding(p, b.id) || spaceLeft < b.size) continue;
    const special = estLargeVioletSpecial(p, b.id);
    if (!best || special > best.special) best = { id: b.id, special };
  }
  return best;
}

function aiReallocate(p) {
  // 贪心：每次把 1 个工人放到"边际收益最高"的空位（按产业链瓶颈，不浪费工人）。
  let remaining = p._unplacedMen || 0;
  let remNobles = p._unplacedNobles || 0;
  // 贵族扩展：贵族优先驻守贵族功能建筑（皇家花园45/礼拜堂39/规划办41/狩猎小屋40）
  if (remNobles > 0) {
    for (const bid of [45, 39, 41, 40]) {
      if (remNobles <= 0) break;
      const b = G.ownsBuilding(p, bid);
      if (b && b.men < BLD_BY_ID[bid].men) { b.men++; b.nobles = (b.nobles || 0) + 1; remNobles--; }
    }
  }
  if (remaining + remNobles <= 0) { p._unplacedMen = 0; p._unplacedNobles = remNobles; return; }
  // 放 1 人：殖民者优先，殖民者用尽后放贵族（打贵族标记）
  const placeOne = (ref, kind) => {
    const useNoble = remaining <= 0;
    if (kind === "p") { ref.manned = true; if (useNoble) ref.noble = true; }
    else { ref.men++; if (useNoble) ref.nobles = (ref.nobles || 0) + 1; }
    if (useNoble) remNobles--; else remaining--;
  };
  const prodUnit = g => 4 + GOOD_PRICE[g] * 2; // corn4 indigo6 sugar8 tobacco10 coffee12
  // 采石场上岗价值：建筑流（已有紫色建筑越多）越高 —— 每个有人采石场减少未来建造花费
  const violetOwned = p.buildings.filter(b => { const t = BLD_BY_ID[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
  const quarryGain = Math.min(11, 4 + violetOwned * 2);

  const violetManValue = (b) => {
    const bd = BLD_BY_ID[b.bid];
    if (bd.type === "large_violet") return Math.max(8, estLargeVioletSpecial(p, bd.id) * 4); // 激活终局重分
    switch (bd.id) {
      case 17: return 12; // 港口（每次装船+1VP）
      case 18: return 10; // 码头
      case 15: return 10; // 工厂
      case 13: return 8;  // 大市场
      case 12: return 7;  // 办公室
      case 42: return Math.max(5, G.nobleCount(p) * 3); // 皇家供应商：满人后每名贵族 +1VP/船长 → 按贵族数估值（贵族扩展）
      case 7:  return 6;  // 小市场
      case 16: return 6;  // 大学
      case 8: case 9: case 11: return 5; // 庄园/工地/济贫院
      case 10: case 14: return 4; // 仓库
      case 49: return 10; // Tibs 塔楼：得每个其他玩家选的角色特权(强被动)
      case 50: return 8;  // Tibs 海关站：清船续货+选船长VP
      case 51: return 7;  // Tibs 档案馆：每种货留1+即时VP
      case 47: case 48: return 6; // Tibs 水井(+货)/寄宿屋(新地自带殖民者)
      case 52: return 5;  // Tibs 银行(终局投资分)
      case 46: return 3;  // Tibs 金矿(慢速金、占2工人)
      default: return 5;
    }
  };

  while (remaining + remNobles > 0) {
    // 当前产业链状态
    const fields = { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };       // 已上岗田
    const fieldsTotal = { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };  // 田总数
    for (const pl of p.plantations) {
      if (pl.good === "quarry") continue;
      fieldsTotal[pl.good]++;
      if (pl.manned) fields[pl.good]++;
    }
    const facCap = { indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };       // 已上岗加工槽
    const facCapTotal = { indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };  // 加工槽总数
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (bd.type === "production" && bd.good && bd.good !== "corn") {
        facCap[bd.good] += b.men;
        facCapTotal[bd.good] += bd.men;
      }
    }

    // 完成奖励：把"立即增产"(已有对侧【有人】、放下这枚就真出货)的空位抬到violet激活之上。
    // 否则贪心会先去上港口12/工厂10/办公室等紫建，把蔗糖厂(完成仅值8)晾着→产能0死厂(友邻反馈)。
    // 产出=真货→装船VP/交易钱，是胜负根基；半成链只缺一枚时必须先补满，再去激活被动紫建。
    const CHAIN_DONE = (p._chainDone != null) ? p._chainDone : 5; // A/B 钩子: 设 0 = 旧行为(无完成奖励)
    let best = null, bestGain = 0.01; // 仅放置正收益空位；否则留岸边（仍计入 Fortress 且下回合可重分）
    // 种植园空位
    for (const pl of p.plantations) {
      if (pl.manned) continue;
      let gain;
      if (pl.good === "quarry") gain = quarryGain;          // 采石场：建造折扣（建筑流更值）
      else if (pl.good === "corn") gain = prodUnit("corn"); // 玉米直接产出
      // 经济作物田：有【有人】厂槽在等 → 立即增产(满产出+完成奖励)；仅有空厂槽(没上人) → 起链投资(原值)；无厂吃 → 0
      else if (fields[pl.good] < facCap[pl.good]) gain = prodUnit(pl.good) + CHAIN_DONE;
      else if (fields[pl.good] < facCapTotal[pl.good]) gain = prodUnit(pl.good);
      else gain = 0;
      if (gain > bestGain) { bestGain = gain; best = { kind: "p", ref: pl }; }
    }
    // 建筑空槽
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (b.men >= bd.men) continue;
      let gain;
      if (bd.type === "production" && bd.good && bd.good !== "corn") {
        // 加工槽：有【有人】同类田在等 → 立即增产(满产出+完成奖励)；仅有空田(没上人) → 起链投资(原值)；无田喂 → 0
        if (facCap[bd.good] < fields[bd.good]) gain = prodUnit(bd.good) + CHAIN_DONE;
        else if (facCap[bd.good] < fieldsTotal[bd.good]) gain = prodUnit(bd.good);
        else gain = 0;
      } else if (bd.id === 44) {
        gain = Math.max(4, G.nobleCount(p) * 3); // 珠宝匠：满人后每名贵族 +1金/工匠 → 按贵族数估值（贵族扩展）
      } else if (bd.type === "production") {
        gain = prodUnit("corn"); // 玉米类生产建筑（实际不存在，占位）
      } else {
        gain = (b.men === 0) ? violetManValue(b) : 0; // 紫色建筑只需 1 人激活
      }
      if (gain > bestGain) { bestGain = gain; best = { kind: "b", ref: b }; }
    }

    if (!best) {
      // 规则：只要面板上还有空位就必须放置殖民者，不能主动留在岸边（森林不可上工人）
      const pl = p.plantations.find(x => !x.manned && x.good !== "forest");
      if (pl) { placeOne(pl, "p"); continue; }
      const bb = p.buildings.find(x => x.men < BLD_BY_ID[x.bid].men);
      if (bb) { placeOne(bb, "b"); continue; }
      break; // 真的没有空位了 → 余下留岸边（San Juan）
    }
    placeOne(best.ref, best.kind);
  }
  p._unplacedMen = remaining;
  p._unplacedNobles = remNobles;
}

// 扩展：黑市(25) — 人类玩家选择用哪些资源抵钱
async function humanPayBlackMarket(p, gap) {
  let need = gap;
  // 规则书：1货 + 1殖民者 + 1VP 各最多还 1 个；殖民者可来自岸边或任意板块（黑市上那个除外）
  let usedGood = false, usedCol = false, usedVP = false;
  while (need > 0) {
    const opts = [];
    if (!usedGood) {
      for (const g of GOODS) if (p.goods[g] > 0) opts.push({ label: `还 1个${GOOD_NAMES[g]} 抵 1金`, kind: "good", good: g });
    }
    if (!usedCol) {
      if ((p._unplacedMen || 0) > 0) opts.push({ label: `还 1名殖民者（岸边）抵 1金`, kind: "col" });
      p.plantations.forEach((pl, i) => { if (pl.manned) opts.push({ label: `还 1名殖民者（${pl.good === "quarry" ? "采石场" : GOOD_NAMES[pl.good]}上）抵 1金`, kind: "col_plant", idx: i }); });
      for (const b of p.buildings) {
        if (b.men > 0 && !(b.bid === 25 && b.men === 1)) opts.push({ label: `还 1名殖民者（${BLD_BY_ID[b.bid].cn}上）抵 1金`, kind: "col_bld", bid: b.bid });
      }
    }
    if (!usedVP && p.vp > 0) opts.push({ label: `还 1点 VP 抵 1金（慎重！）`, kind: "vp" });
    if (opts.length === 0) break;
    const idx = await humanPickFromList(`黑市：还差 ${need} 金，选择抵扣资源`, opts.map(o => o.label), false);
    const opt = opts[idx];
    if (opt.kind === "good") {
      p.goods[opt.good]--; G.supply[opt.good]++; need--; usedGood = true;
      G.logEvent(`${p.name} 黑市：还 1 ${GOOD_NAMES[opt.good]} 抵 1金`, "action");
      showToast(`<div class="t-title">黑市：还了 1${GOOD_NAMES[opt.good]}</div>`, { kind: "gain" });
    } else if (opt.kind === "col") {
      p._unplacedMen--; G.colonistsLeft++; need--; usedCol = true;
      G.logEvent(`${p.name} 黑市：还 1 殖民者 抵 1金`, "action");
      showToast(`<div class="t-title">黑市：还了 1 殖民者</div>`, { kind: "gain" });
    } else if (opt.kind === "col_plant") {
      const pl = p.plantations[opt.idx];
      pl.manned = false;
      if (pl.noble) { pl.noble = false; G.noblesLeft++; } else G.colonistsLeft++; // 贵族按殖民者计（官方），归还各自供应堆
      need--; usedCol = true;
      G.logEvent(`${p.name} 黑市：从板块拿下 1 ${pl.noble ? "贵族" : "殖民者"}归还 抵 1金`, "action");
      showToast(`<div class="t-title">黑市：还了 1 殖民者</div>`, { kind: "gain" });
    } else if (opt.kind === "col_bld") {
      const b = p.buildings.find(bb => bb.bid === opt.bid);
      b.men--;
      if (b.men < (b.nobles || 0)) { b.nobles--; G.noblesLeft++; } // 只剩贵族时拿下的是贵族
      else G.colonistsLeft++;
      need--; usedCol = true;
      G.logEvent(`${p.name} 黑市：从 ${BLD_BY_ID[opt.bid].cn} 拿下 1 人归还 抵 1金`, "action");
      showToast(`<div class="t-title">黑市：还了 1 殖民者</div>`, { kind: "gain" });
    } else if (opt.kind === "vp") {
      p.vp--; G.vpLeft++; need--; usedVP = true;
      G.logEvent(`${p.name} 黑市：还 1 VP 抵 1金`, "action");
      showToast(`<div class="t-title">黑市：还了 1 VP</div>`, { kind: "gain" });
    }
  }
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
    const cost = G.effectiveCostWithRoleBonus(p, b, isChooser || G.towerActive(p)); // Tibs 塔楼：非选择者也享建造特权 -1
    if (p.money + G.blackMarketCapacity(p) < cost) continue; // 黑市可补差额
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
    const sp = (typeof solverPickBuilding === "function") ? solverPickBuilding(p, options, isChooser) : null;
    pickIdx = (sp !== null) ? sp : aiPickBuilding(p, options, isChooser); // 终局精确(opt-in) 否则启发式
    if (pickIdx < 0) return;
  }
  const { b, cost } = options[pickIdx];
  // 🎬 动画：保存源元素引用
  const sourceEl = document.querySelector(`#buildings-pool [data-bid="${b.id}"]`);
  // 扩展：黑市(25) — 钱不够时还货/工人/VP 抵差额，并用尽所有钱
  if (cost > p.money && G.isManned(p, 25)) {
    if (p.isHuman) {
      await humanPayBlackMarket(p, cost - p.money);
    } else {
      G.payWithBlackMarket(p, cost - p.money);
    }
    p.money = 0;
  } else {
    p.money -= cost;
  }
  G.buildingStock[b.id]--;
  p.buildings.push({ bid: b.id, men: 0 });
  const newBldIdx = p.buildings.length - 1;
  flyToDest(sourceEl, () =>
    document.querySelector(`.player-board[data-player="${playerIdx}"] .building-grid .mini-building:nth-child(${newBldIdx + 1})`)
  , 500);
  if (!window._fastSpectator) await sleep(350);
  // 大学：建造后+1殖民者直接上岗。优先从供应区取，没有则从船上取。
  // （官方注：建造雕像等无工人槽建筑时，该殖民者放到岸边 San Juan）
  if (G.isManned(p, 16)) {
    const slots = BLD_BY_ID[b.id].men;
    const place = () => {
      if (slots > 0) p.buildings[p.buildings.length - 1].men = 1;
      else p._unplacedMen = (p._unplacedMen || 0) + 1;
    };
    if (G.colonistsLeft > 0) {
      place(); G.colonistsLeft--;
      G.logEvent(`${p.name} 大学效果：+1殖民者${slots > 0 ? "直接上岗" : "（无槽建筑→岸边）"} (从供应区)`, "action");
    } else if (G.colonistsOnShip > 0) {
      place(); G.colonistsOnShip--;
      G.logEvent(`${p.name} 大学效果：+1殖民者${slots > 0 ? "直接上岗" : "（无槽建筑→岸边）"} (从船上)`, "action");
    }
  }
  // Tibs 银行(52)：建造时可立即投入 ≤8 枚未花金币（投资锁定，终局 +1VP/枚）
  if (G.expansionTibs && b.id === 52) {
    let invest;
    if (p.isHuman) {
      const max = Math.min(8, p.money);
      invest = max > 0 ? await humanPickFromList(`银行：投资多少金？（终局每枚 +1VP，投资后不可再用）`, Array.from({ length: max + 1 }, (_, k) => `${k} 金`), false) : 0;
    } else {
      invest = Math.min(8, Math.max(0, p.money - 4)); // AI 留 4 金缓冲，其余投资
    }
    if (invest > 0) {
      p.money -= invest; p._invest = (p._invest || 0) + invest;
      G.logEvent(`${p.name} 银行：投资 ${invest} 金`, "action");
      if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">银行：投资 ${invest} 金（终局 +${invest}VP）</div>`, { kind: "gain" });
    }
  }
  G.logEvent(`${p.name} 建造 ${b.cn} (花费${cost}金)`, "action");
  if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 建造 ${b.cn} (花费 ${cost}金)</div>`, { kind: "role" });
  // 扩展：教堂(30) — 镇守时，建造其他建筑按列 +0/1/2 VP（建教堂本身不得分）
  if (b.id !== 30 && G.isManned(p, 30)) {
    const tier = TIER_BY_BID[b.id] || 1;
    const cVP = tier >= 4 ? 2 : (tier >= 2 ? 1 : 0);
    if (cVP > 0 && G.vpLeft > 0) {
      const got = Math.min(cVP, G.vpLeft);
      p.vp += got; G.vpLeft -= got;
      G.logEvent(`${p.name} 教堂：建造 +${got} VP`, "action");
      if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 教堂：+${got} VP</div>`, { kind: "role" });
      if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">教堂：建造奖励 +${got} VP</div>`, { kind: "gain" });
    }
  }
}

// 扩展：招待所(28) — 人类玩家在每个（非市长）阶段开始时可把客工派往任意空位（含紫色建筑）
async function humanMoveGuests(p, roleName) {
  const gh = G.ownsBuilding(p, 28);
  if (!gh || gh.men <= 0) return;
  while (gh.men > 0) {
    const slots = [{ kind: "skip", label: `✓ 保留客工在招待所（剩 ${gh.men} 名）` }];
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (b.bid !== 28 && b.men < bd.men) slots.push({ kind: "b", bid: b.bid, label: `派去 ${bd.cn} (${b.men}/${bd.men})` });
    }
    p.plantations.forEach((pl, i) => {
      if (!pl.manned && pl.good !== "forest") slots.push({ kind: "p", idx: i, label: `派去 ${pl.good === "quarry" ? "🪨采石场" : plantEmoji(pl.good) + GOOD_NAMES[pl.good]}` });
    });
    if (slots.length === 1) break;
    const idx = await humanPickFromList(`招待所：${ROLE_NAME_CN[roleName]}阶段开始，可派出客工（派出后须工作到下个市长阶段）`, slots.map(s => s.label), false);
    const c = slots[idx];
    if (c.kind === "skip") break;
    const isNobleGuest = (gh.men - (gh.nobles || 0)) <= 0; // 殖民者客工先走，只剩贵族时派贵族
    if (c.kind === "b") {
      const tb = p.buildings.find(b => b.bid === c.bid);
      tb.men++;
      if (isNobleGuest) tb.nobles = (tb.nobles || 0) + 1;
    } else {
      p.plantations[c.idx].manned = true;
      if (isNobleGuest) p.plantations[c.idx].noble = true;
    }
    gh.men--;
    if (isNobleGuest) gh.nobles--;
    G.logEvent(`${p.name} 招待所：派 1 名客工上岗`, "action");
  }
}

// 扩展：招待所(28) — 把住在招待所的「客工」(gh.men)部署到能立刻提升生产的空位(工匠阶段前)。
// 还原"2 个可在阶段间自由调动的客工"的核心价值：上回合先把人停在招待所，本回合建完/想清楚再派去生产位。
function deployGuests(p) {
  const gh = G.ownsBuilding(p, 28);
  if (!gh || gh.men <= 0) return;
  const ref = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] };
  const factCap = (good) => (ref[good] || []).reduce((s, fb) => { const bb = G.ownsBuilding(p, fb); return s + (bb ? bb.men : 0); }, 0);
  const mannedPl = (good) => p.plantations.filter(x => x.good === good && x.manned).length;
  let moved = 0, guard = 0;
  const popGuest = (targetBld, targetPl) => { // 殖民者客工先走，只剩贵族时派贵族（打标记）
    const isNoble = (gh.men - (gh.nobles || 0)) <= 0;
    if (targetBld) { targetBld.men++; if (isNoble) targetBld.nobles = (targetBld.nobles || 0) + 1; }
    else if (targetPl) { targetPl.manned = true; if (isNoble) targetPl.noble = true; }
    gh.men--;
    if (isNoble) gh.nobles--;
  };
  while (gh.men > 0 && guard++ < 12) {
    let placed = false;
    for (const bid of [3, 4, 5, 6, 1, 2]) { // 空工厂槽(有闲置满人种植园 → 立刻多产)
      const b = G.ownsBuilding(p, bid); if (!b) continue;
      const bd = BLD_BY_ID[bid]; if (b.men >= bd.men) continue;
      if (mannedPl(bd.good) > factCap(bd.good)) { popGuest(b, null); moved++; placed = true; break; }
    }
    if (placed) continue;
    for (const pl of p.plantations) { // 空种植园(玉米直接产；其他需工厂有余量)
      if (pl.manned || pl.good === "quarry" || pl.good === "forest") continue;
      if (pl.good === "corn" || factCap(pl.good) > mannedPl(pl.good)) { popGuest(null, pl); moved++; placed = true; break; }
    }
    if (!placed) break;
  }
  if (moved > 0) {
    G.logEvent(`${p.name} 招待所：${moved} 名客工出动上岗`, "action");
    if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 招待所：${moved}客工上岗</div>`, { kind: "role" });
    if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">招待所：${moved} 名客工上岗生产</div>`, { kind: "gain" });
  }
}

async function doCraftsman(chooserIdx, order) {
  // 生产阶段：每人按生产能力生产货物（受供应限制）
  // 快照：人类玩家本阶段开始前的货物计数，便于阶段末计算"本轮生产"差量
  const humanForCraftToast = G.players.find(pp => pp.isHuman);
  const humanGoodsBefore = {};
  if (humanForCraftToast) for (const g of GOODS) humanGoodsBefore[g] = humanForCraftToast.goods[g];
  const producedKinds = new Set(); // 全场实际生产了哪些货物
  const perPlayerProducedKinds = G.players.map(() => new Set()); // 每位玩家本回合生产的种类（工厂奖励用）
  const perPlayerProducedCount = G.players.map(() => ({ corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 })); // 扩展：专业工厂/引水渠用
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
        perPlayerProducedCount[i][g]++;
      }
      if (producedThis) perPlayerProducedKinds[i].add(g);
    }
  }
  // 扩展：引水渠(24) 用大靛蓝厂/大制糖厂生产时该货 +1；专业工厂(34) 按最多单一货物(玉米除外)-1 得金
  for (let i = 0; i < G.players.length; i++) {
    const p = G.players[i];
    if (G.isManned(p, 24)) {
      // 规则：大厂里产出≥1 即可（工人可自由归因到大厂），不要求大厂满员
      const big3 = G.ownsBuilding(p, 3), big4 = G.ownsBuilding(p, 4);
      if (big3 && big3.men > 0 && perPlayerProducedCount[i].indigo > 0 && G.supply.indigo > 0) {
        p.goods.indigo++; G.supply.indigo--; perPlayerProducedCount[i].indigo++;
        G.logEvent(`${p.name} 引水渠：+1 靛蓝`, "action");
        if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 引水渠：+1 靛蓝</div>`, { kind: "role" });
        if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">引水渠：+1 靛蓝</div>`, { kind: "gain" });
      }
      if (big4 && big4.men > 0 && perPlayerProducedCount[i].sugar > 0 && G.supply.sugar > 0) {
        p.goods.sugar++; G.supply.sugar--; perPlayerProducedCount[i].sugar++;
        G.logEvent(`${p.name} 引水渠：+1 蔗糖`, "action");
        if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 引水渠：+1 蔗糖</div>`, { kind: "role" });
        if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">引水渠：+1 蔗糖</div>`, { kind: "gain" });
      }
    }
    // 专业工厂(34) 移至阶段末结算（官方注：工匠特权拿到的货也计入）——见下方 paySpecialtyFactory
  }
  const paySpecialtyFactory = () => {
    for (let i = 0; i < G.players.length; i++) {
      const p = G.players[i];
      if (!G.isManned(p, 34)) continue;
      // 专业工厂（规则书）：得金 = 产量最多的单一货物(非玉米)的数量 - 1；阶段末结算，特权货计入
      const sfCounts = GOODS.filter(g => g !== "corn").map(g => perPlayerProducedCount[i][g]).sort((a, b) => b - a);
      const gain = Math.max(0, (sfCounts[0] || 0) - 1);
      if (gain > 0) {
        p.money += gain;
        G.logEvent(`${p.name} 专业工厂：+${gain}金`, "action");
        if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 专业工厂：+${gain}金</div>`, { kind: "role" });
        if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">专业工厂：+${gain}金</div>`, { kind: "gain" });
      }
    }
  };
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
  // 扩展II：礼拜堂(39) 殖民者驻守 +1金 / 贵族驻守 +1VP；珠宝匠(44) 每名贵族 +1金
  if (G.expansionNobles) {
    for (const p of G.players) {
      if (G.isColonistManned(p, 39)) { p.money += 1; G.logEvent(`${p.name} 礼拜堂：+1金`, "action"); }
      else if (G.isNobleManned(p, 39) && G.vpLeft > 0) { p.vp += 1; G.vpLeft -= 1; G.logEvent(`${p.name} 礼拜堂(贵族)：+1 VP`, "action"); }
      if (G.isManned(p, 44)) {
        const jn = G.nobleCount(p);
        if (jn > 0) { p.money += jn; G.logEvent(`${p.name} 珠宝匠：${jn} 名贵族 +${jn}金`, "action"); }
      }
    }
  }
  // 工匠特权：只能选 1 种"选择者自己本回合生产"的货物（规则书：of those YOU have produced）。
  // 例如：你自己没产咖啡（哪怕对手产了）→ 不能拿咖啡；你什么都没产 → 无特权。
  const chooser = G.players[chooserIdx];
  const ownKinds = perPlayerProducedKinds[chooserIdx];
  const available = GOODS.filter(g => G.supply[g] > 0 && ownKinds.has(g));
  if (available.length > 0) {
    let g;
    if (chooser.isHuman) {
      // 已产出但供应区已空 → 规则上无法额外拿取（最常见：玉米流把 10 个玉米攥空了）。
      // 明确标注，避免"我明明产了玉米却不让选"的误解（header 列了它、按钮按规则排除它）。
      const blocked = [...ownKinds].filter(k => G.supply[k] <= 0).map(k => GOOD_NAMES[k]);
      const availList = available.map(k => GOOD_NAMES[k]).join("/");
      const blockedNote = blocked.length ? `　⚠ ${blocked.join("/")} 你已产出，但供应区已耗尽、本回合无法拿取（需装船/清贸易站回流）` : "";
      const labels = available.map(k => `${GOOD_NAMES[k]} (你本回合已产出)`);
      const idx = await humanPickFromList(
        `工匠特权：额外 +1，可选你本回合产出且供应区有货的种类 [${availList}]${blockedNote}`,
        labels, true
      );
      if (idx === null) { /* skip */ }
      else g = available[idx];
    } else {
      // AI 选最贵的（仍只能从 available 选）
      g = available.reduce((a, b) => GOOD_PRICE[a] >= GOOD_PRICE[b] ? a : b);
    }
    // 防御性双重检查：g 必须是自己产出过的且供应 > 0
    if (g && ownKinds.has(g) && G.supply[g] > 0) {
      chooser.goods[g]++;
      G.supply[g]--;
      perPlayerProducedCount[chooserIdx][g]++; // 特权货计入专业工厂（官方注），不影响工厂的"种类"判定
      G.logEvent(`${chooser.name} 工匠奖励：+1 ${GOOD_NAMES[g]}`, "action");
      if (!chooser.isHuman && !window._allAIMode) showToast(`<div class="t-title">${chooser.name} 工匠奖励 +1 ${GOOD_NAMES[g]}</div>`, { kind: "role" });
      // 扩展：图书馆(33) — 工匠特权翻倍，再拿 1 个自己已产出的货（规则书：可与第一个相同，也可不同）
      if (G.isManned(chooser, 33)) {
        const avail2 = GOODS.filter(x => ownKinds.has(x) && G.supply[x] > 0);
        let g2;
        if (avail2.length > 0) {
          if (chooser.isHuman) {
            const idx2 = await humanPickFromList("图书馆+工匠：再额外 +1（可与第一个相同）", avail2.map(k => GOOD_NAMES[k]), true);
            if (idx2 !== null) g2 = avail2[idx2];
          } else {
            g2 = avail2.reduce((a, b) => GOOD_PRICE[a] >= GOOD_PRICE[b] ? a : b);
          }
        }
        if (g2) {
          chooser.goods[g2]++; G.supply[g2]--;
          perPlayerProducedCount[chooserIdx][g2]++; // 同样计入专业工厂
          G.logEvent(`${chooser.name} 图书馆+工匠：再 +1 ${GOOD_NAMES[g2]}`, "action");
          if (!chooser.isHuman && !window._allAIMode) showToast(`<div class="t-title">${chooser.name} 图书馆+工匠：再 +1 ${GOOD_NAMES[g2]}</div>`, { kind: "role" });
          if (chooser.isHuman && !window._allAIMode) showToast(`<div class="t-title">图书馆+工匠：再 +1 ${GOOD_NAMES[g2]}</div>`, { kind: "gain" });
        }
      }
    } else if (g) {
      console.warn(`Craftsman bonus blocked: '${g}' not in own produced kinds or supply empty`, [...ownKinds], G.supply[g]);
    }
  } else {
    // 选择者自己本回合没有生产 → 无特权
    G.logEvent(`${chooser.name} 工匠特权：你本回合未生产任何货物，无可选种类`, "action");
  }
  // Tibs 自制（真实规则）：金矿(46) 满员可把两人移回岸边+1金；水井(47) 产了玉米/靛蓝可多产 1
  if (G.expansionTibs) {
    for (const p of G.players) {
      // 金矿：满员(2 殖民者)时把两名移回岸边(San Juan) + 1 金。AI/默认自动执行(净收益)。
      const gm = G.ownsBuilding(p, 46);
      if (gm && gm.men >= 2) {
        gm.men = 0; p._unplacedMen = (p._unplacedMen || 0) + 2; p.money += 1;
        G.logEvent(`${p.name} 金矿：2 殖民者移回岸边 +1金`, "action");
        if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 金矿：+1金</div>`, { kind: "role" });
        if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">金矿：2人回岸边 +1金</div>`, { kind: "gain" });
      }
      // 水井：本回合产了玉米/靛蓝则多产 1（择一，优先靛蓝）
      if (G.isManned(p, 47)) {
        let g = null;
        if (perPlayerProducedCount[p.idx].indigo > 0 && G.supply.indigo > 0) g = "indigo";
        else if (perPlayerProducedCount[p.idx].corn > 0 && G.supply.corn > 0) g = "corn";
        if (g) {
          p.goods[g]++; G.supply[g]--; perPlayerProducedCount[p.idx][g]++;
          G.logEvent(`${p.name} 水井：+1 ${GOOD_NAMES[g]}`, "action");
          if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 水井：+1 ${GOOD_NAMES[g]}</div>`, { kind: "role" });
          if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">水井：+1 ${GOOD_NAMES[g]}</div>`, { kind: "gain" });
        }
      }
      // 塔楼(49)：非选择者塔楼主也得工匠特权 +1（自己产出的一种，取最贵）
      if (p.idx !== chooserIdx && G.towerActive(p)) {
        const kinds = [...perPlayerProducedKinds[p.idx]].filter(g => G.supply[g] > 0);
        if (kinds.length) {
          const g = kinds.reduce((a, b) => GOOD_PRICE[a] >= GOOD_PRICE[b] ? a : b);
          p.goods[g]++; G.supply[g]--; perPlayerProducedCount[p.idx][g]++;
          G.logEvent(`${p.name} 塔楼·工匠特权：+1 ${GOOD_NAMES[g]}`, "action");
        }
      }
    }
  }
  paySpecialtyFactory(); // 专业工厂：阶段末结算（特权货已计入）
  G._lastCraftKinds = perPlayerProducedKinds; // Tibs 节庆②：记录本回合各玩家产出种类
  G.logEvent(`生产阶段结束`, "action");
  if (humanForCraftToast && !window._allAIMode) {
    // 只展示本回合 *新增* 的货物（包括 chooser 奖励的 +1）
    const line = GOODS
      .filter(g => (humanForCraftToast.goods[g] - (humanGoodsBefore[g] || 0)) > 0)
      .map(g => `+${humanForCraftToast.goods[g] - humanGoodsBefore[g]}${plantEmoji(g)}`)
      .join(" ");
    if (line) showToast(`<div class="t-title">工匠：你 ${line}</div>`, { kind: "gain" });
  }
}

async function doTrader(playerIdx, isChooser) {
  const p = G.players[playerIdx];
  const hasOffice = G.isManned(p, 12);
  const hasPost = G.isManned(p, 29);                 // 扩展：贸易驿站
  const houseFull = G.tradingHouse.length >= 4;
  // 卖给公共贸易站的可选货（满或重复则不可，除非 Office）
  const sellableHouse = houseFull ? [] : GOODS.filter(g => p.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g)));
  // 扩展：卖给【自己的】贸易驿站——任意有的货（含重复、即使公共站满），货入供应区、市场不加成
  const sellablePost = hasPost ? GOODS.filter(g => p.goods[g] > 0) : [];
  if (sellableHouse.length === 0 && sellablePost.length === 0) return;
  const mkBonus = (dest) => dest === "house" ? (G.isManned(p, 7) ? 1 : 0) + (G.isManned(p, 13) ? 2 : 0) : 0;
  const chooserBonus = isChooser ? (G.isManned(p, 33) ? 2 : 1) : 0; // 图书馆：商人特权翻倍
  const opts = [];
  for (const g of sellableHouse) opts.push({ g, dest: "house" });
  for (const g of sellablePost) opts.push({ g, dest: "post" });
  let pick;
  if (p.isHuman) {
    const labels = opts.map(o => `${o.dest === "house" ? "贸易站" : "自家驿站"} 卖 ${GOOD_NAMES[o.g]} (+${GOOD_PRICE[o.g] + chooserBonus + mkBonus(o.dest)}金)`);
    const idx = await humanPickFromList("商人：选择出售", labels, true);
    if (idx === null) return;
    pick = opts[idx];
  } else {
    pick = opts.map(o => ({ o, earn: GOOD_PRICE[o.g] + chooserBonus + mkBonus(o.dest) })).sort((a, b) => b.earn - a.earn)[0].o;
  }
  p.goods[pick.g]--;
  let earn = GOOD_PRICE[pick.g] + chooserBonus + mkBonus(pick.dest);
  if (pick.dest === "house") G.tradingHouse.push(pick.g);
  else G.supply[pick.g]++; // 驿站：货物直接回供应区
  p.money += earn;
  const where = pick.dest === "house" ? "卖" : "(驿站)卖";
  G.logEvent(`${p.name} ${where} ${GOOD_NAMES[pick.g]} +${earn}金`, "action");
  if (!window._allAIMode) {
    if (p.isHuman) showToast(`<div class="t-title">你${where} ${GOOD_NAMES[pick.g]} +${earn}金</div>`, { kind: "gain" });
    else showToast(`<div class="t-title">${p.name} ${where} ${GOOD_NAMES[pick.g]} +${earn}金</div>`, { kind: "role" });
  }
}

// 扩展II：地产办公室(38) — 商人阶段（卖货之外额外使用）：
// 殖民者驻守：付 1 金从暗牌堆抽 1 张种植园放上岛；贵族驻守：弃 1 张种植园/森林（非采石场）得 1 金
async function runLandOffice(p) {
  if (!G.expansionNobles) return;
  if (G.isColonistManned(p, 38)) {
    if (p.money < 1 || p.plantations.length >= 12 || G.plantationDeck.length === 0) return;
    let use;
    if (p.isHuman) {
      const idx = await humanPickFromList("地产办公室：付 1 金从暗牌堆抽 1 张种植园？", ["使用（付 1 金抽暗牌）", "不使用"], false);
      use = idx === 0;
    } else use = p.money >= 3; // AI：现金充裕才买地
    if (use) {
      p.money -= 1;
      let good = G.plantationDeck.pop();
      // 规则：地产办公室抽到的田，若你有森林屋(26)，可看过后改放为森林(从明牌池翻扣 1 张)
      if (G.isManned(p, 26) && G.plantationPool.length > 0) {
        let toForest;
        if (p.isHuman) {
          const idx2 = await humanPickFromList(`地产办+森林屋：抽到 ${plantEmoji(good) + GOOD_NAMES[good]}，改为森林？`, ["🌲 改为森林（翻扣 1 张明牌田；每 2 块建造 -1金）", `🌱 保留 ${GOOD_NAMES[good]} 田`], false);
          toForest = idx2 === 0;
        } else {
          const violet = p.buildings.filter(b => { const t2 = BLD_BY_ID[b.bid].type; return t2 === "violet" || t2 === "large_violet"; }).length;
          const forests = p.plantations.filter(pl => pl.good === "forest").length;
          toForest = violet >= 3 && forests < 4;
        }
        if (toForest) {
          const fi = p.isHuman
            ? await humanPickFromList("森林屋：选 1 张明牌田翻扣为森林", G.plantationPool.map(g => plantEmoji(g) + GOOD_NAMES[g]), false)
            : G.plantationPool.reduce((bi, g, k, arr) => GOOD_PRICE[g] < GOOD_PRICE[arr[bi]] ? k : bi, 0);
          const flipped = G.plantationPool.splice(fi, 1)[0];
          good = "forest";
          G.logEvent(`${p.name} 地产办+森林屋：翻扣 ${GOOD_NAMES[flipped]} 改为森林`, "action");
        }
      }
      p.plantations.push({ good, manned: false });
      G.logEvent(`${p.name} 地产办公室：付 1 金得 ${good === "forest" ? "🌲森林" : GOOD_NAMES[good] + " 田"}`, "action");
      if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 地产办：+${good === "forest" ? "森林" : GOOD_NAMES[good] + " 田"}</div>`, { kind: "role" });
    }
  } else if (G.isNobleManned(p, 38)) {
    const cands = p.plantations.map((pl, k) => ({ pl, k })).filter(x => x.pl.good !== "quarry");
    if (cands.length === 0) return;
    let pick = null;
    if (p.isHuman) {
      const labels = ["不使用", ...cands.map(x => `弃 ${x.pl.good === "forest" ? "🌲森林" : plantEmoji(x.pl.good) + GOOD_NAMES[x.pl.good]} 得 1 金${x.pl.manned ? "（工人回岸边）" : ""}`)];
      const idx = await humanPickFromList("地产办公室(贵族)：可弃 1 张种植园/森林得 1 金", labels, false);
      if (idx > 0) pick = cands[idx - 1];
    } // AI 不主动弃田
    if (pick) {
      const pl = pick.pl;
      if (pl.manned) {
        if (pl.noble) p._unplacedNobles = (p._unplacedNobles || 0) + 1;
        else p._unplacedMen = (p._unplacedMen || 0) + 1;
      }
      p.plantations.splice(pick.k, 1);
      p.money += 1;
      G.logEvent(`${p.name} 地产办公室(贵族)：弃 1 张地块 +1金`, "action");
    }
  }
}

// 扩展：小码头(31) — 人类玩家选择装船货物（可多选不同货物种类）
async function humanSmallWharfLoad(p) {
  const pool = {};
  for (const g of GOODS) if (p.goods[g] > 0) pool[g] = p.goods[g];
  if (Object.keys(pool).length === 0) return {};
  const chosen = {};
  while (true) {
    const opts = GOODS.filter(g => (pool[g] || 0) > 0);
    if (opts.length === 0) break;
    const totalChosen = Object.values(chosen).reduce((s, v) => s + v, 0);
    // 规则书：可装任意数量（≥1），不必把一种货全部装上 → 提供 +1 个 与 +全部 两档
    const labels = [];
    const acts = [];
    if (totalChosen > 0) { labels.push(`✓ 完成（${totalChosen}货 → ${Math.floor(totalChosen / 2)} VP）`); acts.push({ kind: "done" }); }
    for (const g of opts) {
      labels.push(`+1 个 ${GOOD_NAMES[g]}（剩 ${pool[g]}）`); acts.push({ kind: "one", g });
      if (pool[g] > 1) { labels.push(`+全部 ${pool[g]} 个 ${GOOD_NAMES[g]}`); acts.push({ kind: "all", g }); }
    }
    const idx = await humanPickFromList(
      `⛵ 小码头：选择货物装船（每 2 货 = 1 VP${totalChosen > 0 ? `，已选 ${totalChosen} 货` : '，至少选 1 货'}）`,
      labels, true
    );
    if (idx === null) { if (totalChosen > 0) break; /* must choose something */ continue; }
    const act = acts[idx];
    if (act.kind === "done") break;
    const take = act.kind === "all" ? pool[act.g] : 1;
    chosen[act.g] = (chosen[act.g] || 0) + take;
    pool[act.g] -= take;
    if (pool[act.g] <= 0) delete pool[act.g];
  }
  if (Object.values(chosen).reduce((s, v) => s + v, 0) === 0) {
    for (const g of GOODS) if (p.goods[g] > 0) { chosen[g] = p.goods[g]; break; } // fallback: load first good
  }
  return chosen;
}

async function doCaptain(order, chooserIdx) {
  // 装船阶段：循环，每人必须运（如果能运），直到无人能再装
  // FIX: chooser +1VP 总共一次（首次装船时），不是每次
  // FIX: Harbor +1VP 每次装船（不是只第一次）
  const chooserBonusUsed = new Set(); // 谁已经拿过 captain chooser 奖励了
  const towerShipUsed = new Set(); // Tibs 塔楼(49)：非选择者首次装船 +1VP 的去重
  // Tibs 海关站(50)：选船长者 +1 VP（无论是否装船）
  if (G.expansionTibs && G.isManned(G.players[chooserIdx], 50) && G.vpLeft > 0) {
    G.players[chooserIdx].vp += 1; G.players[chooserIdx].shippingVP += 1; G.vpLeft -= 1;
    G.logEvent(`${G.players[chooserIdx].name} 海关站：选船长 +1 VP`, "action");
  }
  // 扩展：工会大厅(35) — 装船前，手上每 2 个同种货物 +1 VP（一次性）
  for (const i of order) {
    const p = G.players[i];
    if (!G.isManned(p, 35)) continue;
    let uhVP = 0;
    for (const g of GOODS) uhVP += Math.floor(p.goods[g] / 2);
    if (uhVP > 0 && G.vpLeft > 0) {
      const got = Math.min(uhVP, G.vpLeft);
      p.vp += got; G.vpLeft -= got;
      G.logEvent(`${p.name} 工会大厅：装船前同货成对 +${got} VP`, "action");
      if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 工会大厅：+${got} VP</div>`, { kind: "role" });
      if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">工会大厅：你 +${got} VP</div>`, { kind: "gain" });
      if (!window._fastSpectator) await sleep(350);
    }
  }
  // 扩展：灯塔(32) — 船长 chooser 不论是否装货都额外 +1 金
  {
    const lhp = G.players[chooserIdx];
    if (G.isManned(lhp, 32)) {
      lhp.money += 1;
      G.logEvent(`${lhp.name} 灯塔：船长特权 +1金（不论装货与否）`, "action");
      if (!lhp.isHuman && !window._allAIMode) showToast(`<div class="t-title">${lhp.name} 灯塔 船长 +1金</div>`, { kind: "role" });
      if (lhp.isHuman && !window._allAIMode) showToast(`<div class="t-title">灯塔：你作为船长 +1金</div>`, { kind: "gain" });
      if (!window._fastSpectator) await sleep(300);
    }
  }
  // 扩展II：皇家供应商(42) — 首次装船前：每名贵族可弃 1 个不同种货入供应区，每个 +1VP（无任何加成）
  if (G.expansionNobles) {
    for (const i of order) {
      const p = G.players[i];
      if (!G.isManned(p, 42)) continue;
      const limit = G.nobleCount(p);
      if (limit <= 0) continue;
      const owned = GOODS.filter(g => p.goods[g] > 0);
      if (owned.length === 0) continue;
      let picks = [];
      if (p.isHuman) {
        const pool2 = new Set(owned);
        while (picks.length < limit && pool2.size > 0) {
          const opts = [...pool2];
          const labels = [`✓ 完成（已选 ${picks.length} 个，每个 +1VP）`, ...opts.map(g => `弃 1 个 ${GOOD_NAMES[g]}（+1VP）`)];
          const idx = await humanPickFromList(`皇家供应商：可弃最多 ${limit} 个不同种货换 VP`, labels, false);
          if (idx === 0) break;
          const g = opts[idx - 1];
          picks.push(g); pool2.delete(g);
        }
      } else {
        // AI：弃低价值货换 VP（玉米/靛蓝/糖），后期全弃
        const cheap = owned.filter(g => GOOD_PRICE[g] <= (gamePhase() === "late" ? 4 : 2));
        picks = cheap.slice(0, limit);
      }
      for (const g of picks) {
        p.goods[g]--; G.supply[g]++;
        const got = Math.min(1, G.vpLeft);
        p.vp += got; p.shippingVP += got; G.vpLeft -= got;
      }
      if (picks.length > 0) {
        G.logEvent(`${p.name} 皇家供应商：弃 ${picks.length} 货 +${picks.length} VP`, "action");
        if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 皇家供应商 +${picks.length} VP</div>`, { kind: "role" });
      }
    }
  }
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
      // 规则：选定一种货后必须装"尽可能多" — 同种货有多艘可选船时，只能选装载量最大的那艘
      // （多艘空船时必须用装得下全部货物的船；都装不下则用最大的）
      {
        const maxByGood = {};
        for (const c of candidates) maxByGood[c.good] = Math.max(maxByGood[c.good] || 0, c.amount);
        const legal = candidates.filter(c => c.amount === maxByGood[c.good]);
        candidates.length = 0;
        candidates.push(...legal);
      }
      // 码头（Wharf）作为私人船 — 可装任意货物（含已经在货船上的种类），容量 11，不受上述约束
      const hasWharf = G.isManned(p, 18);
      if (hasWharf && !p._wharfUsedThisRound) {
        for (const g of GOODS) {
          if (p.goods[g] > 0) {
            candidates.push({ ship: "wharf", good: g, amount: Math.min(p.goods[g], 11) });
          }
        }
      }
      // 扩展：小码头(31) — 自有船，可装任意货物组合、每 2 货 = 1VP
      if (G.isManned(p, 31) && !p._smallWharfUsedThisRound) {
        if (p.isHuman) {
          // 人类：单一"小码头"选项，点击后出多选对话框
          const totalSW = GOODS.reduce((s, g) => s + p.goods[g], 0);
          if (totalSW > 0) candidates.push({ ship: "smallwharf", good: "mix", amount: totalSW });
        } else {
          // AI：按货种独立候选，排名后取最高价值的
          for (const g of GOODS) if (p.goods[g] > 0) candidates.push({ ship: "smallwharf", good: g, amount: p.goods[g] });
        }
      }
      if (candidates.length === 0) continue;
      const sortedCandidates = rankCaptainCandidates(candidates, G.ships);
      // 玩家选择
      let pick;
      if (p.isHuman) {
        const labels = sortedCandidates.map(c => c.ship === "wharf" ? `🚢码头 装全部 ${c.amount}个${GOOD_NAMES[c.good]}` : c.ship === "smallwharf" && c.good === "mix" ? `⛵小码头 装任意货物（共${c.amount}货，每2货=1VP）` : c.ship === "smallwharf" ? `⛵小码头 装 ${c.amount}个${GOOD_NAMES[c.good]}（每2个=1VP）` : `船${c.ship + 1} 装${c.amount}个${GOOD_NAMES[c.good]}`);
        const idx = await humanPickFromList("船长：装船", labels, false);
        pick = sortedCandidates[idx];
      } else {
        // 群友·苦寒/仲达：把人类货量最大的那种货塞进货船，占道恶心人类装船（每种货只能在一艘船）
        let spite = null;
        if (_spiteRoll(p)) {
          const human = G.players.find(x => x.isHuman);
          if (human) {
            let want = null, mx = 0; for (const gg of GOODS) if (human.goods[gg] > mx) { mx = human.goods[gg]; want = gg; }
            if (want) spite = candidates.find(c => c.good === want && c.ship !== "wharf" && c.ship !== "smallwharf") || null;
          }
        }
        // AI：早/中期弃廉价货、留咖啡/烟草给商人；后期全力运分
        const sp = (typeof solverPickCaptain === "function") ? solverPickCaptain(p, candidates, chooserIdx, order, progress, chooserBonusUsed) : null;
        pick = spite || sp || rankCaptainForAI(candidates, G.ships, gamePhase())[0]; // 群友恶心 → 终局精确(opt-in) → 启发式
      }
      // 执行装船
      const isWharf = pick.ship === "wharf";
      const isSmallWharf = pick.ship === "smallwharf";
      const isPersonal = isWharf || isSmallWharf;
      let loaded;
      if (isSmallWharf && p.isHuman) {
        // 人类小码头：多选货物对话框
        const sw = await humanSmallWharfLoad(p);
        loaded = 0;
        for (const g of GOODS) {
          if ((sw[g] || 0) > 0) { p.goods[g] -= sw[g]; G.supply[g] += sw[g]; loaded += sw[g]; }
        }
        p._smallWharfUsedThisRound = true;
      } else if (isPersonal) {
        p.goods[pick.good] -= pick.amount;
        loaded = pick.amount;
        if (isWharf) p._wharfUsedThisRound = true; else p._smallWharfUsedThisRound = true;
        // 私人船装的货物直接回供应区（"placed in the supply"）
        G.supply[pick.good] += pick.amount;
      } else {
        const ship = G.ships[pick.ship];
        if (ship.good === null) ship.good = pick.good;
        loaded = Math.min(pick.amount, ship.capacity - ship.count);
        ship.count += loaded;
        p.goods[pick.good] -= loaded;
      }
      // 扩展：灯塔(32) — 与港口同理：每次装运（含码头/小码头）+1金（船长特权在阶段开始已给）
      if (G.isManned(p, 32)) {
        p.money += 1;
        G.logEvent(`${p.name} 灯塔：装船 +1金`, "action");
        if (!p.isHuman && !window._allAIMode) showToast(`<div class="t-title">${p.name} 灯塔 +1金</div>`, { kind: "role" });
        if (p.isHuman && !window._allAIMode) showToast(`<div class="t-title">灯塔：+1金</div>`, { kind: "gain" });
      }
      // 小码头：每 2 货 = 1VP；其余装船 1 货 = 1VP
      let vp = isSmallWharf ? Math.floor(loaded / 2) : loaded;
      // FIX: chooser +1VP 仅首次装船（图书馆翻倍 +2）。规则：选择者奖励仅在【实际装了货】时给——
      // loaded>0 在此循环体内恒成立(空装船不进此分支)，加显式条件以照字面对齐规则、防未来重构。
      if (i === chooserIdx && !chooserBonusUsed.has(i) && loaded > 0) {
        vp += G.isManned(p, 33) ? 2 : 1;
        chooserBonusUsed.add(i);
      }
      // FIX: Harbor 每次装船 +1VP
      if (G.isManned(p, 17)) vp += 1;
      // Tibs 塔楼(49)：非选择者塔楼主也得船长特权（本阶段首次装船 +1VP）
      if (G.expansionTibs && i !== chooserIdx && G.towerActive(p) && !towerShipUsed.has(i)) { vp += 1; towerShipUsed.add(i); }
      const vpGain = Math.min(vp, G.vpLeft);
      p.vp += vpGain;
      p.shippingVP += vpGain;
      G.vpLeft -= vpGain;
      const shipLabel = isWharf ? "用码头装" : isSmallWharf ? "用小码头装" : `装船${pick.ship + 1}:`;
      const goodLabel = (isSmallWharf && pick.good === "mix") ? "混装" : (GOOD_NAMES[pick.good] || pick.good);
      G.logEvent(`${p.name} ${shipLabel} ${loaded}${goodLabel} (+${vpGain}VP)`, "action");
      if (!window._allAIMode) {
        if (!p.isHuman) showToast(`<div class="t-title">${p.name} ${isPersonal ? shipLabel : "装船#" + (pick.ship + 1)} ${loaded}${goodLabel} (+${vpGain} VP)</div>`, { kind: "role" });
        else showToast(`<div class="t-title">你 ${isPersonal ? shipLabel : "装船#" + (pick.ship + 1)} ${loaded}${goodLabel} (+${vpGain} VP)</div>`, { kind: "gain" });
      }
      if (!window._fastSpectator) await sleep(450);
      progress = true;
    }
  }
  // 装船阶段结束：满船的货物归还到供应区；玩家选择保留货物，其余丢弃
  // FIX #25: 满船的货物归还到供应区（Captain 阶段最后步骤）
  const clearedShipGoods = []; // Tibs 海关站(50)：本阶段清空的满船货种
  for (let s = 0; s < G.ships.length; s++) {
    const ship = G.ships[s];
    if (ship.count >= ship.capacity) {
      if (G.expansionTibs && ship.good) clearedShipGoods.push(ship.good);
      G.supply[ship.good] += ship.count;
      ship.good = null;
      ship.count = 0;
    }
  }
  // 每人保留货物
  for (const p of G.players) {
    // FIX: 码头/小码头使用标记必须对所有玩家无条件重置（包括货物清零的玩家），
    // 否则用码头运光货物的玩家之后的船长阶段码头永久失效
    p._wharfUsedThisRound = false;
    p._smallWharfUsedThisRound = false;
    const totalGoods = GOODS.reduce((s, g) => s + p.goods[g], 0);
    if (totalGoods === 0) continue;
    const storageKinds = G.storageKinds(p);
    // 玩家可保留：storageKinds 种货物（每种任意多）+ 单独 1 个其他货物
    // 简化：让玩家选择保留方案
    if (p.isHuman) {
      const kept = await humanKeepGoods(p, storageKinds);
      // 扩展：储藏库(27) 自动多留最多 3 个最值钱的(否则会丢弃的)货
      if (G.isManned(p, 27)) {
        let extra = 3;
        for (const g of GOODS.slice().sort((a, b) => GOOD_PRICE[b] - GOOD_PRICE[a])) {
          if (extra <= 0) break;
          const avail = p.goods[g] - (kept[g] || 0);
          if (avail > 0) { const t = Math.min(avail, extra); kept[g] = (kept[g] || 0) + t; extra -= t; }
        }
        const saved = 3 - extra;
        if (saved > 0 && !window._allAIMode) showToast(`<div class="t-title">储藏库：额外保留 ${saved} 货</div>`, { kind: "gain" });
      }
      // Tibs 档案馆(51)：每种货各留 1 桶 + 立即 +1VP/种
      if (G.expansionTibs && G.isManned(p, 51)) {
        let types = 0;
        for (const g of GOODS) if (p.goods[g] > 0) { kept[g] = Math.max(kept[g] || 0, 1); types++; }
        if (types > 0 && G.vpLeft > 0) { const gain = Math.min(types, G.vpLeft); p.vp += gain; G.vpLeft -= gain; G.logEvent(`${p.name} 档案馆：留${types}种货 +${gain}VP`, "action"); if (!window._allAIMode) showToast(`<div class="t-title">档案馆：留${types}种 +${gain}VP</div>`, { kind: "gain" }); }
      }
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
      // 单货槽：基础 1 + 扩展储藏库(27) 额外 3
      let singleSlots = 1 + (G.isManned(p, 27) ? 3 : 0);
      for (const g of sorted) {
        if (singleSlots <= 0) break;
        if (fullKinds.includes(g)) continue;
        const take = Math.min(p.goods[g], singleSlots);
        keep[g] = (keep[g] || 0) + take;
        singleSlots -= take;
      }
      // Tibs 档案馆(51)：每种货各留 1 桶 + 立即 +1VP/种
      if (G.expansionTibs && G.isManned(p, 51)) {
        let types = 0;
        for (const g of GOODS) if (p.goods[g] > 0) { keep[g] = Math.max(keep[g] || 0, 1); types++; }
        if (types > 0 && G.vpLeft > 0) { const gain = Math.min(types, G.vpLeft); p.vp += gain; G.vpLeft -= gain; G.logEvent(`${p.name} 档案馆：留${types}种货 +${gain}VP`, "action"); }
      }
      // FIX #28: 丢弃的返回供应区
      for (const g of GOODS) {
        const discarded = p.goods[g] - (keep[g] || 0);
        if (discarded > 0) G.supply[g] += discarded;
        p.goods[g] = keep[g] || 0;
      }
    }
  }
  // Tibs 海关站(50)：阶段末(存货之后)每艘清空的满船，海关站主各得回 1 个该船货(不腐坏)
  if (G.expansionTibs && clearedShipGoods.length) {
    for (const p of G.players) {
      if (!G.isManned(p, 50)) continue;
      for (const cg of clearedShipGoods) {
        if (G.supply[cg] > 0) { p.goods[cg]++; G.supply[cg]--; G.logEvent(`${p.name} 海关站：补回 1 ${GOOD_NAMES[cg]}`, "action"); }
      }
    }
  }
  G.logEvent(`船长阶段结束`, "action");
  const humanCaptain = G.players.find(pp => pp.isHuman);
  if (humanCaptain && !window._allAIMode) {
    const roundShipVP = humanCaptain.shippingVP - (humanCaptain._shipVpToastBase || 0);
    humanCaptain._shipVpToastBase = humanCaptain.shippingVP;
    if (roundShipVP > 0) showToast(`<div class="t-title">你本轮船运 +${roundShipVP} VP</div>`, { kind: "gain" });
  }
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
  const colTotal = { 1: 30, 2: 42, 3: 55, 4: 75, 5: 95 }[G.numPlayers];
  const colUsedRatio = 1 - G.colonistsLeft / colTotal;
  const vpStart = { 1: 50, 2: 65, 3: 75, 4: 100, 5: 122 }[G.numPlayers];
  const vpUsedRatio = 1 - G.vpLeft / vpStart;
  const progress = Math.max(colUsedRatio, vpUsedRatio);
  if (progress < 0.33) return "early";
  if (progress < 0.66) return "mid";
  return "late";
}

function aiPickRole(p, available) {
  let lvl = p._aiLevel || 3;
  // 贵族扩展：sim 引擎未建模贵族 → L4/L5/L6 回退到 L3 强启发式
  if (G.expansionNobles && lvl >= 4) lvl = 3;
  updatePlan(p); // 每回合刷新该 AI 的全局对局计划，供选角色/建筑/派工等各处保持连贯
  // 群友·苦寒/仲达：以 spite 概率抢人类最想要的角色（恶心人类，牺牲一点最优）
  if (_spiteRoll(p)) {
    const si = spiteRolePick(p, available);
    if (si != null) return si;
  }
  // 群友·Rafael：差一点就能买起贵厂时，倾向金矿主攒钱（"攒钱拿咖啡厂"）
  if (_collectRoll(p)) {
    const ci = collectRolePick(p, available);
    if (ci != null) return ci;
  }
  // 群友·二月：第8回合后锁定加分最高的大建筑——买得起抢建造、差一点金矿主攒钱
  if (_bigbuildRoll(p)) {
    const bi = bigbuildRolePick(p, available);
    if (bi != null) return bi;
  }
  // 群友·Ethan：某角色卡攒到 ≥2 枚币 → 大概率直接抢那张拿币
  if (_coinRoll(p)) {
    const ci = coinRolePick(p, available);
    if (ci != null) return ci;
  }
  if (lvl === 1) return level1PickRole(p, available);
  if (lvl === 2) {
    // DNA AI + 浅层自我前瞻（往后看几轮微调，仍以基因为主）
    if (p._dna) {
      const idx = dnaPickRole(p, available);
      if (idx !== null && idx >= 0 && idx < available.length) return dnaLookaheadRefine(p, available, idx);
    }
    return level1PickRole(p, available);
  }
  if (lvl === 3) return level2PickRoleNew(p, available);        // 普通=邻座感知启发式
  if (lvl === 4) return ismctsPickRole(p, available, "hard");   // 困难=轻量ISMCTS(截断前瞻+手写经济评估)统筹全局
  if (lvl === 5) return ismctsPickRole(p, available, "expert"); // 专家=MCTS 深搜·逐步深想
  if (lvl === 6) return alphazeroPickRole(p, available);        // 宗师=AlphaZero NN+MCTS
  return level2PickRoleNew(p, available);
}

// ---- L6: ISMCTS 实时搜索（sim.js）----
// 把当前真实 G 转成无头 sim 状态，跑 ISMCTS 选角色，再映射回 available 索引。
function buildSimState(G) {
  const st = {
    numPlayers: G.numPlayers, governor: G.governor, turnNumber: G.turnNumber,
    gameOver: false, endTriggered: G.endTriggered,
    // 贵族扩展：传标量贵族状态给 sim(让 L5/L6 角色搜索能看见贵族→终局VP)
    expansionNobles: !!G.expansionNobles, noblesLeft: G.noblesLeft || 0, noblesOnShip: G.noblesOnShip || 0,
    colonistsLeft: G.colonistsLeft, colonistsOnShip: G.colonistsOnShip, vpLeft: G.vpLeft,
    supply: Object.assign({}, G.supply), buildingStock: Object.assign({}, G.buildingStock),
    quarriesLeft: G.quarriesLeft,
    plantationDeck: G.plantationDeck.slice(), plantationDiscard: G.plantationDiscard.slice(),
    plantationPool: G.plantationPool.slice(),
    ships: G.ships.map(s => ({ capacity: s.capacity, good: s.good, count: s.count })),
    tradingHouse: G.tradingHouse.slice(),
    roleCards: G.roleCards.filter(r => r.name !== "Buccaneer").map(r => ({ name: r.name, money: r.money, taken: r.taken, takenBy: r.takenBy })), // Tibs 海盗不进 sim（保护7角色AI）
    // 本回合已选人数 = 已 taken 的角色卡数（回合初全部重置为未选）
    picksThisTurn: G.roleCards.filter(r => r.taken).length,
    rnd: Math.random,
    players: G.players.map(p => ({
      idx: p.idx, money: p.money, vp: p.vp, shippingVP: p.shippingVP || 0,
      plantations: p.plantations.map(pl => ({ good: pl.good, manned: pl.manned })),
      buildings: p.buildings.map(b => ({ bid: b.bid, men: b.men })),
      goods: Object.assign({}, p.goods),
      unplaced: p._unplacedMen || 0, wharfUsed: p._wharfUsedThisRound || false, aiLevel: p._aiLevel || 5,
      nobleCount: G.expansionNobles ? G.nobleCount(p) : 0, // 贵族扩展：玩家板上贵族总数(终局每名+1VP)
    })),
  };
  return st;
}

// 终局精确求解器接入 L6 *建造*子决策（opt-in: window._l6SolverBuild，默认关闭；AI_STRENGTH §9）。
// build 是终局最高分歧子决策(74%)。iters=40 配对 A/B 测得 +3.3pp(z=3.75)，但 iters=150 复核(110 局)
// 仅 +0.9pp(z=1.0，不显著)且求解触发率 0.43→0.27/局——**增益随对弈变强而缩小**(更强的角色搜索改变了
// 终局局面，求解器触发更少、修正更小)。未达 z>1.96 换挡标准 → 保持默认关闭。仅基础局生效。
// 返回：null=不适用(回退 aiPickBuilding) | -1=PASS(跳过建造) | >=0=options 下标。
function solverPickBuilding(p, options, isChooser) {
  // 群友·建筑大师(西西/拾光/SC)即使全局开关关闭也启用终局精确建造求解器
  if ((!window._l6SolverBuild && !(p._persona && p._persona.build)) || p._aiLevel !== 6) return null;
  if (typeof PRSim === "undefined" || !PRSim || typeof PRSim.solveEndgame !== "function" || typeof PRSim.azDecision !== "function") return null;
  // 扩展局：az 决策层未完整建模 → 不接管（保持启发式）
  if (G.expansion || G.expansionNobles || G.expansionTibs || G.expansionNewBuildings || G.expansionFestival) return null;
  try {
    const st = buildSimState(G);
    if (!st.endTriggered) return null;                 // 仅终局触发后
    const bcard = st.roleCards.find(r => r.name === "Builder");
    const chooser = bcard ? bcard.takenBy : null;
    if (chooser == null) return null;
    const N = st.numPlayers;
    const ord = []; for (let k = 0; k < N; k++) ord.push((chooser + k) % N);
    const oi = ord.indexOf(p.idx);
    if (oi < 0) return null;
    st.az = { phase: "builder", chooser, ord, oi };     // 重建建造阶段 az 游标，指向当前玩家
    const dec = PRSim.azDecision(st);
    if (!dec || dec.type !== "build" || dec.chooser !== p.idx) return null;
    // 安全闸：az 重建的可建集合必须与 game.js doBuilder 完全一致，否则求解的是错模型 → 回退
    const azIds = dec.actions.filter(a => a >= 0).sort((a, b) => a - b);
    const gameIds = options.map(o => o.b.id).sort((a, b) => a - b);
    if (azIds.length !== gameIds.length || azIds.some((id, i) => id !== gameIds[i])) return null;
    const sol = PRSim.solveEndgame(st, window._l6SolverBuildCap || 2e6);   // 超预算→null→回退（2e6 即 A/B 验证档）
    if (!sol || sol.action == null) return null;
    if (sol.action < 0) return -1;                      // PASS = 不建造
    const idx = options.findIndex(o => o.b.id === sol.action);
    return idx >= 0 ? idx : null;
  } catch (e) { return null; }
}

// 终局精确求解器接入 L6 *船长装船*子决策（opt-in: window._l6SolverCaptain，默认关闭；AI_STRENGTH §9）。
// captain 是终局第二高分歧子决策(55%)，专家共识(BGA/BGG)也视装船为最关键决策。az captainCands 与
// doCaptain 候选逐口径一致(base game)，captain 游标 {phase,chooser,ord,oi,progressed,chooserBonusUsed}
// 可从 doCaptain 循环态精确重建(cphase 仅启发式 rankCaptain 用，精确 maxⁿ 求解不需要)。
// 返回选中的候选对象，或 null 回退到 rankCaptainForAI。
function solverPickCaptain(p, candidates, chooserIdx, order, passProgressed, chooserBonusUsedSet) {
  if (!window._l6SolverCaptain || p._aiLevel !== 6) return null;
  if (typeof PRSim === "undefined" || !PRSim || typeof PRSim.solveEndgame !== "function" || typeof PRSim.azDecision !== "function") return null;
  if (G.expansion || G.expansionNobles || G.expansionTibs || G.expansionNewBuildings || G.expansionFestival) return null;
  try {
    const st = buildSimState(G);
    if (!st.endTriggered) return null;
    const ord = order.slice();
    const oi = ord.indexOf(p.idx);
    if (oi < 0) return null;
    st.az = { phase: "captain", chooser: chooserIdx, ord, oi, progressed: !!passProgressed, chooserBonusUsed: chooserBonusUsedSet.has(chooserIdx) };
    const dec = PRSim.azDecision(st);
    if (!dec || dec.type !== "captain" || dec.chooser !== p.idx) return null;
    // game.js 候选编码为与 az 相同的 int（shipSlot*10 + goodIdx，wharf=3），逐一比对集合 → 不一致即回退
    const enc = c => (c.ship === "wharf" ? 3 : c.ship) * 10 + GOODS.indexOf(c.good);
    const gameCodes = candidates.filter(c => c.ship !== "smallwharf").map(enc).sort((a, b) => a - b);
    const azCodes = dec.actions.slice().sort((a, b) => a - b);
    if (gameCodes.length !== azCodes.length || gameCodes.some((c, i) => c !== azCodes[i])) return null;
    const sol = PRSim.solveEndgame(st, window._l6SolverBuildCap || 2e6);
    if (!sol || sol.action == null) return null;
    const hit = candidates.find(c => c.ship !== "smallwharf" && enc(c) === sol.action);
    return hit || null;
  } catch (e) { return null; }
}

function ismctsPickRole(p, available, tier) {
  // sim.js 未加载时回退到强启发式
  if (typeof PRSim === "undefined" || !PRSim || !PRSim.ismctsPickRoleIdx) return level5Reactive(p, available);
  try {
    const st = buildSimState(G);
    // 健壮性：sim 当前决策者应等于 p；否则回退
    if (PRSim.currentChooser(st) !== p.idx) return level5Reactive(p, available);
    const b = window._aiThinkBudget || {};
    let iters = tier === "hard" ? (b.hardIters || 120) : (b.expertIters || 1500);
    let ms = tier === "hard" ? (b.hardMs || 1500) : (b.expertMs || 6000);
    if (p._thinkMs) { ms = p._thinkMs; iters = Math.max(iters, 100000); } // 群友自定义思考时长
    // 专家档若已加载训练好的价值函数则启用价值制导（否则纯 rollout）
    const valueW = (tier === "expert" && window._mctsValueW) ? window._mctsValueW : null;
    // 困难档(两者结合)：截断 rollout 前瞻若干回合 + 手写"经济评估"做叶节点评估
    //   → 自然实现"统筹全局/未来 N 回合收益最大/买 vs 攒/最优卖货/对手会怎么走(确定化搜索)"。
    const opts = { maxIters: iters, budgetMs: ms, valueW, truncate: 8 };
    if (tier === "hard" && PRSim.econReward) opts.evalLeafFn = (s2, persp) => PRSim.econReward(s2, persp);
    const ri = PRSim.ismctsPickRoleIdx(st, opts);
    if (ri == null || ri < 0) return level5Reactive(p, available);
    const name = st.roleCards[ri].name;
    const idx = available.findIndex(r => r.name === name);
    return idx >= 0 ? idx : level5Reactive(p, available);
  } catch (e) {
    console.warn("ISMCTS failed, fallback", e);
    return level5Reactive(p, available);
  }
}

// ---- L6: AlphaZero（神经网络制导的 ISMCTS）----
// 用 PRSim.networkEval(state, seat) 提供 policy 先验 + value 叶评估，跑 PUCT。
// 网络未加载时回退到 L5(expert) 行为。
function alphazeroPickRole(p, available) {
  if (typeof PRSim === "undefined" || !PRSim || !PRSim.ismctsPickRoleIdx) return level5Reactive(p, available);
  // 网络未加载 → 回退到 L5
  if (!PRSim.isLoaded || !PRSim.isLoaded()) return ismctsPickRole(p, available, "expert");
  try {
    const st = buildSimState(G);
    if (PRSim.currentChooser(st) !== p.idx) return level5Reactive(p, available);
    // 终局精确求解器(opt-in, 默认关闭直到真实评测确认; AI_STRENGTH §9)：
    // endTriggered 后剩余决策树小(中位 ~10^4), 完整 maxⁿ 给出精确最优角色, 绕开启发式天花板。
    // buildSimState 恰是角色边界(az 默认 role 阶段) → 这里求解的就是 role 决策, 干净对齐。
    // 超预算(cap)返回 null → 落到下方 NN-ISMCTS。开关: window._l6Solver。
    if (window._l6Solver && st.endTriggered && typeof PRSim.solveEndgame === "function") {
      try {
        const sol = PRSim.solveEndgame(st, window._l6SolverCap || 1.5e5);
        if (sol && sol.type === "role" && sol.action != null && st.roleCards[sol.action]) {
          const idx = available.findIndex(r => r.name === st.roleCards[sol.action].name);
          if (idx >= 0) return idx;
        }
      } catch (e) { /* 求解失败 → 落到 NN-ISMCTS */ }
    }
    const b = window._aiThinkBudget || {};
    // L6 用更少的 iters：NN 已"看远"，每次模拟更便宜的 NN eval 取代 rollout
    let iters = b.alphaIters || 800;
    let ms = b.alphaMs || 6000;
    if (p._thinkMs) { ms = p._thinkMs; iters = Math.max(iters, 100000); } // 群友自定义思考时长（让时间预算成为唯一约束 → 真的多想）
    // 终局增压：收官期(终局已触发/VP 池将尽/殖民者将尽)的决策决定 1-3 分的胜负毛差,
    // 提高这些少数关键决策的搜索预算。_alphaEndBoost 注入倍率(A/B 调参), 默认 1(关闭)。
    const endBoost = (window._alphaEndBoost != null ? window._alphaEndBoost : 1);
    if (endBoost > 1 && (st.endTriggered || (st.vpLeft != null && st.vpLeft <= 12) || (st.colonistsLeft != null && st.colonistsLeft <= 6))) {
      iters = Math.round(iters * endBoost); ms = ms * endBoost;
    }
    const ROLE_NAMES = ["Settler", "Mayor", "Builder", "Craftsman", "Trader", "Captain", "Prospector"];
    const ri = PRSim.ismctsPickRoleIdx(st, {
      maxIters: iters,
      budgetMs: ms,
      C: (window._alphaC != null ? window._alphaC : 1.5), // PUCT 常数；NN policy 比较自信，稍微鼓励探索（_alphaC 供调参注入）
      truncate: 999, // 全 rollout 到终局：用 NN 仅作 policy prior，value 用真实回报
      evalLeafFn: (state, seat) => PRSim.evalLeafNN(state, seat),
      priorPolicyFn: (state, seat) => {
        const out = PRSim.networkEval(state, seat);
        if (!out) return null;
        // 把 policy[7] 映射回当前 legal 的角色名 → 概率
        const legal = PRSim.legalRoleIdxs(state);
        const legalNames = new Set(legal.map(i => state.roleCards[i].name));
        const dist = {};
        let s = 0;
        for (let k = 0; k < ROLE_NAMES.length; k++) {
          if (legalNames.has(ROLE_NAMES[k])) {
            dist[ROLE_NAMES[k]] = out.policy[k];
            s += out.policy[k];
          }
        }
        if (s > 0) for (const k of Object.keys(dist)) dist[k] /= s;
        else { for (const k of Object.keys(dist)) dist[k] = 1 / Math.max(1, Object.keys(dist).length); }
        return dist;
      },
    });
    if (ri == null || ri < 0) return ismctsPickRole(p, available, "expert");
    const name = st.roleCards[ri].name;
    const idx = available.findIndex(r => r.name === name);
    return idx >= 0 ? idx : ismctsPickRole(p, available, "expert");
  } catch (e) {
    console.warn("AlphaZero ISMCTS failed, fallback to L5", e);
    return ismctsPickRole(p, available, "expert");
  }
}

// 进化(L2)浅层前瞻：在 DNA 首选基础上，往后推演几轮(纯启发式续局)、只看"自己"的投影分来微调。
// 不做对手建模/卡位(那是困难/专家的层级)，且强锚定基因首选——只在明显更优时改选 → 仅"稍微"变强。
function dnaLookaheadRefine(me, available, dnaIdx) {
  if (available.length <= 1) return dnaIdx;
  if (typeof PRSim === "undefined" || !PRSim || !PRSim.clone) return dnaIdx;
  try {
    const st0 = buildSimState(G);
    if (PRSim.currentChooser(st0) !== me.idx) return dnaIdx;
    const ROUNDS = 2; // 往后多看几轮
    let bestI = dnaIdx, bestS = -Infinity;
    for (let i = 0; i < available.length; i++) {
      const st = PRSim.clone(st0);
      const ri = st.roleCards.findIndex(r => r.name === available[i].name && !r.taken);
      if (ri < 0) continue;
      PRSim.applyRole(st, ri);
      const startTurn = st.turnNumber;
      let guard = 0;
      while (!PRSim.isTerminal(st) && st.turnNumber < startTurn + ROUNDS && guard++ < 60) {
        const ch = PRSim.currentChooser(st); if (ch < 0) break;
        const legal = PRSim.legalRoleIdxs(st); if (!legal.length) break;
        PRSim.applyRole(st, PRSim.heuristicPickRole(st, ch, legal));
      }
      let s = PRSim.finalScore(st.players[me.idx]);
      if (i === dnaIdx) s += 5.5; // 强锚定基因首选：看几轮但只在明显更优(>5.5分)时才改 → 仅"稍微"变强、不盖过普通
      if (s > bestS) { bestS = s; bestI = i; }
    }
    return bestI;
  } catch (e) {
    return dnaIdx;
  }
}

// ============================================================
// 威胁分析（L4/L5 共用）：评估某对手当前可拿到的关键 EV
// ============================================================
function opponentThreat(opp) {
  if (!opp) return null;
  const goods = GOODS.reduce((s, g) => s + opp.goods[g], 0);
  const kinds = GOODS.filter(g => opp.goods[g] > 0).length;
  let shipCap = 0;
  for (const ship of G.ships) shipCap += (ship.capacity - ship.count);
  const wharf = G.isManned(opp, 18) ? Math.max(0, ...GOODS.map(g => opp.goods[g])) : 0;
  const harbor = G.isManned(opp, 17) ? 1 : 0;
  const shipping = Math.min(goods, shipCap + wharf);
  const shipVP = shipping * (1 + harbor) + 1;
  const hasOffice = G.isManned(opp, 12);
  let bestSale = 0;
  for (const g of GOODS) {
    if (opp.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g))) {
      let earn = GOOD_PRICE[g] + 1;
      if (G.isManned(opp, 7)) earn += 1;
      if (G.isManned(opp, 13)) earn += 2;
      bestSale = Math.max(bestSale, earn);
    }
  }
  let largeVioletAffordable = 0, bestBuildVP = 0;
  for (const b of BUILDINGS) {
    if (G.buildingStock[b.id] <= 0) continue;
    if (G.ownsBuilding(opp, b.id)) continue;
    if (12 - G.buildingUsedSpaces(opp) < b.size) continue;
    const cost = G.effectiveCostWithRoleBonus(opp, b, true);
    if (opp.money >= cost) {
      bestBuildVP = Math.max(bestBuildVP, b.vp);
      if (b.type === "large_violet") largeVioletAffordable++;
    }
  }
  let openSlots = 0;
  for (const b of opp.buildings) openSlots += (BLD_BY_ID[b.bid].men - b.men);
  for (const pl of opp.plantations) if (!pl.manned) openSlots++;
  let prod = 0;
  for (const g of GOODS) prod += Math.min(G.productionCapacity(opp, g), G.supply[g]);
  return {
    name: opp.name, isHuman: opp.isHuman, goods, kinds, money: opp.money,
    shipping, shipVP, bestSale, bestBuildVP, largeVioletAffordable,
    openSlots, prod, totalScore: projectedScore(opp),
  };
}

// 选反制目标：人类优先（PvAI 体验），否则得分最高的对手
function pickThreatTarget(me) {
  const others = G.players.filter(p => p !== me);
  if (others.length === 0) return null;
  const human = others.find(p => p.isHuman);
  if (human) return human;
  let best = others[0], bestScore = projectedScore(others[0]);
  for (let i = 1; i < others.length; i++) {
    const s = projectedScore(others[i]);
    if (s > bestScore) { bestScore = s; best = others[i]; }
  }
  return best;
}

// 估算"我"当作 chooser 选某角色当下能拿多少（VP 单位，简化）
function myActionEV(me, roleName) {
  switch (roleName) {
    case "Captain": {
      const goods = GOODS.reduce((s,g) => s+me.goods[g], 0);
      let shipCap = 0;
      for (const ship of G.ships) shipCap += (ship.capacity - ship.count);
      const wharf = G.isManned(me, 18) ? Math.max(0, ...GOODS.map(g => me.goods[g])) : 0;
      const harbor = G.isManned(me, 17) ? 1 : 0;
      const shipping = Math.min(goods, shipCap + wharf);
      return shipping * (1 + harbor) + 1;
    }
    case "Trader": {
      const hasOffice = G.isManned(me, 12);
      let best = 0;
      for (const g of GOODS) {
        if (me.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g))) {
          let earn = GOOD_PRICE[g] + 1;
          if (G.isManned(me, 7)) earn += 1;
          if (G.isManned(me, 13)) earn += 2;
          best = Math.max(best, earn);
        }
      }
      return best;
    }
    case "Builder": {
      for (const b of BUILDINGS) {
        if (G.buildingStock[b.id] <= 0) continue;
        if (G.ownsBuilding(me, b.id)) continue;
        if (12 - G.buildingUsedSpaces(me) < b.size) continue;
        const cost = G.effectiveCostWithRoleBonus(me, b, true);
        if (me.money >= cost) {
          return b.vp + (b.type === "large_violet" ? 2 : 0.5);
        }
      }
      return 0;
    }
    case "Craftsman": {
      let prod = 0;
      for (const g of GOODS) prod += Math.min(G.productionCapacity(me, g), G.supply[g]);
      return prod * 0.6 + 0.5;
    }
    case "Mayor": {
      let open = 0;
      for (const b of me.buildings) open += (BLD_BY_ID[b.bid].men - b.men);
      for (const pl of me.plantations) if (!pl.manned) open++;
      const fromShip = G.numPlayers > 0 ? Math.ceil(G.colonistsOnShip / G.numPlayers) : 0;
      return Math.min(open, fromShip + 1) * 1.2;
    }
    case "Settler": return me.plantations.length < 8 ? 1.5 : 0.5;
    case "Prospector": return 1;
    default: return 0;
  }
}

// ============================================================
// L4 (困难) 升级：level3Final 基础 + 5 条针对性反制
// ============================================================
function level4Reactive(me, available) {
  // 打分模型：全场净收益(roleSelfMinusOpp) + 软性策略倾向(strategicRoleBias)。
  // 倾向是加权偏好，不是硬规则——会把选择"拉"向某方向，但净收益等其它因素可压过它。
  const phase = gamePhase();
  let bestI = 0, bestS = -Infinity;
  for (let i = 0; i < available.length; i++) {
    const r = available[i];
    const s = roleSelfMinusOpp(me, r.name, r.money).margin + strategicRoleBias(me, r.name, phase);
    if (s > bestS) { bestS = s; bestI = i; }
  }
  return bestI;
}

// ============================================================
// 全局规划：给每个 AI 一个持久的"对局计划"，让多回合决策连贯成一条战略主线，而不是每步贪心。
// 计划 = 阶段弧线(早:造收入引擎 → 中:转化为得分引擎 → 晚:兑现得分+控场，PR 公认主线)
//   + 心仪大紫(按"与自己面板的终局契合度"estLargeVioletSpecial 选定，即"按想要的大紫终局计分来规划")。
// 用途：level1PickRole 终盘抢大紫(入门/普通)；各级 aiPickBuilding 经 bestLargeViolet 攒钱抢卡。
// 困难(净收益+卡位+大紫规划)/进化(DNA阶段基因)/专家·宗师(MCTS/NN 整局前瞻)各自已有规划，不在此重复。
// ============================================================
function updatePlan(p) {
  const phase = gamePhase();
  const focus = phase === "early" ? "income" : phase === "mid" ? "engine" : "score";
  p._plan = { focus, targetLV: bestLargeViolet(p) };
  return p._plan;
}

// 软性策略倾向：返回对某角色的偏好分(正=更倾向 / 负=更回避)。
// 源自 Alexfrog/jimc：终盘禁区、Mayor 少选、卡下家高价货、运船/建造时机、抢卡反制。
function strategicRoleBias(me, roleName, phase) {
  let s = 0;
  const manned = bid => G.isManned(me, bid);
  const goods = GOODS.reduce((a, g) => a + me.goods[g], 0);
  const downstream = G.players[(me.idx + 1) % G.numPlayers];
  const office = manned(12);
  let shipSpace = 0; for (const sh of G.ships) shipSpace += (sh.capacity - sh.count);
  let myOpen = 0;
  for (const b of me.buildings) myOpen += (BLD_BY_ID[b.bid].men - b.men);
  for (const pl of me.plantations) if (!pl.manned) myOpen++;
  const sellEarn = g => GOOD_PRICE[g] + 1 + (manned(7) ? 1 : 0) + (manned(13) ? 2 : 0);

  switch (roleName) {
    case "Captain": {
      const mannedCorn = me.plantations.filter(pl => pl.good === "corn" && pl.manned).length;
      if (mannedCorn >= 2 && goods >= 3 && shipSpace > 0) s += 6; // 玉米多(只能运)→倾向运船
      let oppGoodsMax = 0; for (const o of G.players) { if (o === me) continue; oppGoodsMax = Math.max(oppGoodsMax, GOODS.reduce((a, g) => a + o.goods[g], 0)); }
      if (oppGoodsMax >= 4 && goods >= 2) s += 4; // 对手货多+我也能装→抢船位/首装+1
      break;
    }
    case "Trader": {
      for (const g of ["coffee", "tobacco"]) { // 高价货且下家也有→卖掉卡下家贸易位
        if (me.goods[g] > 0 && downstream.goods[g] > 0 && (office || !G.tradingHouse.includes(g))) { s += 5; break; }
      }
      if (phase === "late") { // 终盘禁区：收入已高、Builder稀缺→回避，除非这单凑到10金买大建筑
        let earn = 0; for (const g of GOODS) if (me.goods[g] > 0 && (office || !G.tradingHouse.includes(g))) earn = Math.max(earn, sellEarn(g));
        if (!(me.money < 10 && me.money + earn >= 10)) s -= 9;
      }
      break;
    }
    case "Settler": {
      if (phase === "late") s -= 9;        // 终盘禁区：晚期开拓几乎只值奖励金
      if (manned(9)) s += 2;               // 有人镇守建筑工地→略倾向(可拿采石场)
      break;
    }
    case "Craftsman": {
      let myProd = 0, oppMaxProd = 0;
      for (const g of GOODS) myProd += G.productionCapacity(me, g);
      for (const o of G.players) { if (o === me) continue; let pr = 0; for (const g of GOODS) pr += G.productionCapacity(o, g); oppMaxProd = Math.max(oppMaxProd, pr); }
      if (myProd < oppMaxProd) s -= 6;     // 不是产能主力→回避(给下家弹药)
      if (phase === "late" && myProd < 3) s -= 6; // 终盘非运货流禁区
      break;
    }
    case "Mayor": {
      let oppOpenMax = 0;
      for (const o of G.players) { if (o === me) continue; let op = 0; for (const b of o.buildings) op += (BLD_BY_ID[b.bid].men - b.men); for (const pl of o.plantations) if (!pl.manned) op++; oppOpenMax = Math.max(oppOpenMax, op); }
      if (oppOpenMax >= 3 && oppOpenMax > myOpen) s -= 6; // 少选：对手空岗多→送对手免费动作
      if (myOpen >= 3 && G.colonistsOnShip >= 1) s += 4;  // 我自己急需用人→倾向
      if (phase !== "early") for (const b of me.buildings) if (BLD_BY_ID[b.bid].type === "large_violet" && b.men < BLD_BY_ID[b.bid].men) { s += 8; break; } // 激活大紫
      break;
    }
    case "Builder": {
      const leaderP = findLeader().leader;
      const behind = leaderP && leaderP !== me && projectedScore(me) < projectedScore(leaderP) - 3;
      let oppMature = false;
      for (const o of G.players) { if (o === me) continue; let pr = 0; for (const g of GOODS) pr += G.productionCapacity(o, g); if (pr >= 5 && o.buildings.length >= 5) { oppMature = true; break; } }
      if (behind || oppMature || phase === "late") { // 落后/对手成熟/终盘→倾向抢建造(大紫或塞满加速)
        const spaceLeft = 12 - G.buildingUsedSpaces(me);
        for (const b of BUILDINGS) {
          if (G.buildingStock[b.id] <= 0 || G.ownsBuilding(me, b.id) || spaceLeft < b.size) continue;
          const cost = G.effectiveCostWithRoleBonus(me, b, true);
          if (me.money >= cost && (b.type === "large_violet" || (phase === "late" && spaceLeft <= 4))) { s += 8; break; }
        }
      }
      // 心仪大紫的全局规划：买得起就抢（单张，错过被人拿走）；有对手也凑够 10 金 → 抢卡加急
      const tgt = (phase === "mid" || phase === "late") ? bestLargeViolet(me) : null;
      if (tgt && tgt.special >= 3) {
        const cost = G.effectiveCostWithRoleBonus(me, BLD_BY_ID[tgt.id], true);
        if (me.money >= cost) {
          s += 10;
          const spaceLeft = 12 - G.buildingUsedSpaces(me);
          for (const o of G.players) {
            if (o === me) continue;
            if (o.money >= 10 && (12 - G.buildingUsedSpaces(o)) >= 2) { s += 6; break; } // 对手也能抢 → 加急
          }
          void spaceLeft;
        }
      }
      break;
    }
  }
  return s;
}

// ============================================================
// 状态快照：模拟一个玩家在指定角色阶段后的状态变化
// 用于 depth-2 lookahead（不修改 G）
// ============================================================
function simulatePlayerSnapshot(g, playerIdx, roleName, asChooser) {
  const p = g.players[playerIdx];
  const snap = {
    money: p.money,
    vp: p.vp,
    shippingVP: p.shippingVP || 0,
    goods: { corn: p.goods.corn, indigo: p.goods.indigo, sugar: p.goods.sugar, tobacco: p.goods.tobacco, coffee: p.goods.coffee },
    plantationsCount: p.plantations.length,
    mannedPlantations: p.plantations.filter(pl => pl.manned).length,
    buildings: p.buildings.map(b => ({ bid: b.bid, men: b.men })),
    usedSpaces: p.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].size, 0),
  };
  const ownsBldId = (id) => snap.buildings.some(b => b.bid === id && b.men >= 1);
  switch (roleName) {
    case "Captain": {
      const total = GOODS.reduce((s,gd) => s+snap.goods[gd], 0);
      let shipCap = 0;
      for (const ship of g.ships) shipCap += (ship.capacity - ship.count);
      const wharf = ownsBldId(18) ? Math.max(0, ...GOODS.map(gd => snap.goods[gd])) : 0;
      const harbor = ownsBldId(17) ? 1 : 0;
      const shipping = Math.min(total, shipCap + wharf);
      // 真实规则：没装货就拿不到 chooser +1VP（修掉"无货也选船长刷+1分"）
      const vpGain = shipping * (1 + harbor) + ((asChooser && shipping > 0) ? 1 : 0);
      snap.vp += vpGain;
      snap.shippingVP += vpGain;
      // 减货物（按价格大的优先）
      let toShip = shipping;
      for (const gd of [...GOODS].reverse()) {
        const k = Math.min(snap.goods[gd], toShip);
        snap.goods[gd] -= k;
        toShip -= k;
      }
      // 阶段末仅留 1 个其他货 + 仓库容量保留
      const wh1 = ownsBldId(10) ? 1 : 0;
      const wh2 = ownsBldId(14) ? 2 : 0;
      const kindsKeep = wh1 + wh2;
      const sortedKinds = GOODS.filter(gd => snap.goods[gd] > 0).sort((a,b) => GOOD_PRICE[b] - GOOD_PRICE[a]);
      for (let i = kindsKeep; i < sortedKinds.length; i++) {
        // 留 1 个最贵的额外类
        if (i === kindsKeep) snap.goods[sortedKinds[i]] = 1;
        else snap.goods[sortedKinds[i]] = 0;
      }
      break;
    }
    case "Trader": {
      if (g.tradingHouse.length >= 4) break; // 贸易站已满 → 本轮没人卖得出，选商人无意义
      const hasOffice = ownsBldId(12);
      let bestG = null, bestEarn = 0;
      for (const gd of GOODS) {
        if (snap.goods[gd] > 0 && (hasOffice || !g.tradingHouse.includes(gd))) {
          let earn = GOOD_PRICE[gd] + (asChooser ? 1 : 0);
          if (ownsBldId(7)) earn += 1;
          if (ownsBldId(13)) earn += 2;
          if (earn > bestEarn) { bestEarn = earn; bestG = gd; }
        }
      }
      if (bestG) { snap.goods[bestG]--; snap.money += bestEarn; }
      break;
    }
    case "Builder": {
      const discount = asChooser ? 1 : 0;
      let best = null;
      for (const b of BUILDINGS) {
        if (g.buildingStock[b.id] <= 0) continue;
        if (snap.buildings.some(bb => bb.bid === b.id)) continue;
        if (12 - snap.usedSpaces < b.size) continue;
        const cost = Math.max(0, b.cost - discount);
        if (snap.money >= cost) {
          const score = b.vp + (b.type === "large_violet" ? 2 : 0);
          if (!best || score > best.score) best = { b, cost, score };
        }
      }
      if (best) {
        snap.money -= best.cost;
        snap.buildings.push({ bid: best.b.id, men: 0 });
        snap.usedSpaces += best.b.size;
        snap.vp += best.b.vp;
      }
      break;
    }
    case "Craftsman": {
      const producedKinds = [];
      for (const gd of GOODS) {
        const cap = g.productionCapacity(p, gd);
        const made = Math.min(cap, g.supply[gd]);
        if (made > 0) {
          snap.goods[gd] += made;
          producedKinds.push(gd);
        }
      }
      // chooser bonus: best produced kind
      if (asChooser && producedKinds.length > 0) {
        const bestProduced = producedKinds.reduce((a,b) => GOOD_PRICE[a] >= GOOD_PRICE[b] ? a : b);
        snap.goods[bestProduced]++;
      }
      // Factory bonus
      if (ownsBldId(15)) {
        const kinds = producedKinds.length;
        const factoryBonus = {1:0, 2:1, 3:2, 4:3, 5:5}[kinds] || 0;
        snap.money += factoryBonus;
      }
      break;
    }
    case "Mayor": {
      const ship = g.colonistsOnShip;
      const myShareFromShip = Math.ceil(ship / g.numPlayers);
      const supplyBonus = (asChooser && g.colonistsLeft > 0) ? 1 : 0;
      let unplaced = myShareFromShip + supplyBonus;
      // 优先填建筑空岗
      for (const b of snap.buildings) {
        const bd = BLD_BY_ID[b.bid];
        const open = bd.men - b.men;
        const fill = Math.min(open, unplaced);
        b.men += fill;
        unplaced -= fill;
        if (unplaced === 0) break;
      }
      // 再填种植园
      const unmannedPl = snap.plantationsCount - snap.mannedPlantations;
      const fill2 = Math.min(unmannedPl, unplaced);
      snap.mannedPlantations += fill2;
      break;
    }
    case "Settler": {
      if (snap.plantationsCount < 12) snap.plantationsCount += 1;
      // chooser 可拿采石场：折算成"省下的未来建造钱"，建筑流（紫色建筑多）更值
      if (asChooser && g.quarriesLeft > 0) {
        const violetOwned = snap.buildings.filter(b => { const t = BLD_BY_ID[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
        snap.money += 1 + violetOwned * 0.8;
      }
      break;
    }
    case "Prospector": {
      if (asChooser) snap.money += 1;
      break;
    }
  }
  return snap;
}

function snapshotProjectedScore(snap) {
  let s = snap.vp;
  for (const b of snap.buildings) s += BLD_BY_ID[b.bid].vp;
  // 大紫终局加分（粗估）
  for (const b of snap.buildings) {
    const bd = BLD_BY_ID[b.bid];
    if (bd.type === "large_violet" && b.men >= bd.men) {
      // 终局贡献按 4VP 基础（保守）
      s += 1;
    }
  }
  const goods = GOODS.reduce((sum,g) => sum+snap.goods[g], 0);
  s += goods * 0.7;
  s += snap.money * 0.4;
  s += snap.mannedPlantations * 0.3;
  s += snap.plantationsCount * 0.2; // 引擎价值：田越多潜在产能越高（鼓励早期铺设）
  return s;
}

// 一个玩家"什么都不做"的基线分（Prospector 作 follower 不产生任何变化）
function baselineSnapScore(idx) {
  return snapshotProjectedScore(simulatePlayerSnapshot(G, idx, "Prospector", false));
}

// 全场评估：我作为 chooser 选某角色的净收益 = 我的增量 − 最受益对手作为 follower 的增量。
// 体现"选这张牌会不会资敌/该不该卡别人一手"——综合对手的货物、船运能力、产能、可买建筑等。
function roleSelfMinusOpp(me, roleName, rMoney) {
  const myBase = baselineSnapScore(me.idx);
  const mySnap = simulatePlayerSnapshot(G, me.idx, roleName, true);
  mySnap.money += rMoney || 0;
  const myGain = snapshotProjectedScore(mySnap) - myBase;
  let oppMax = 0; // 最受益的对手（follower）能拿到多少 —— 我选此牌的"资敌代价"
  for (const opp of G.players) {
    if (opp === me) continue;
    const og = snapshotProjectedScore(simulatePlayerSnapshot(G, opp.idx, roleName, false)) - baselineSnapScore(opp.idx);
    if (og > oppMax) oppMax = og;
  }
  return { myGain, oppMax, margin: myGain - oppMax };
}

// ============================================================
// L5 (专家) 深度升级：5-8s 预算 + 2 轮 depth-2 snapshot lookahead
// ============================================================
function level5Reactive(me, available) {
  const phase = gamePhase();
  // 基础分 = 全场净收益 + 软性策略倾向（与 level4Reactive 同口径）
  const baseScore = available.map(r => roleSelfMinusOpp(me, r.name, r.money).margin + strategicRoleBias(me, r.name, phase));
  let baseBest = 0; for (let i = 1; i < baseScore.length; i++) if (baseScore[i] > baseScore[baseBest]) baseBest = i;

  const target = pickThreatTarget(me);
  if (!target || available.length <= 1) return baseBest;

  const budgetMs = (window._aiThinkBudget && window._aiThinkBudget.L5) || 6000;
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  const now = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  const tBase = baselineSnapScore(target.idx);
  const myBase = baselineSnapScore(me.idx);

  // 只在"接近最优"的候选里用 depth-2 前瞻细分（target 作 chooser、我作 follower）
  let bestI = baseBest, bestKey = -Infinity;
  for (let i = 0; i < available.length; i++) {
    if (now() - t0 > budgetMs) break;
    if (baseScore[i] < baseScore[baseBest] - 1.5) continue;
    const remaining = available.filter((_, j) => j !== i);
    let bestRound2 = 0, targetBestRole = remaining[0] || available[i];
    for (const r2 of remaining) {
      const tV2 = snapshotProjectedScore(simulatePlayerSnapshot(G, target.idx, r2.name, true)) - tBase;
      if (tV2 > bestRound2) { bestRound2 = tV2; targetBestRole = r2; }
    }
    const myV2 = snapshotProjectedScore(simulatePlayerSnapshot(G, me.idx, targetBestRole.name, false)) - myBase;
    const key = baseScore[i] + 0.5 * (myV2 - bestRound2);
    if (key > bestKey) { bestKey = key; bestI = i; }
  }
  return bestI;
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
      let oppPick = -1;
      if (oppAvail.length) {
        const prevLvl = opp._aiLevel;
        if (prevLvl === 5) opp._aiLevel = 4; // 防止 L5 前瞻递归
        oppPick = aiPickRole(opp, oppAvail);
        opp._aiLevel = prevLvl;
      }
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
  // 普通档：L1 决策 + 抢高金币角色卡（不含"卡下家"等高级战术——那是困难档的范畴）
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
  // 入门：凭直觉发挥自身优势（不做卡位/前瞻等高级战术，只顺着自己的强项走）
  const has = name => available.find(r => r.name === name);
  const idxOf = name => available.indexOf(has(name));
  const goods = GOODS.map(g => me.goods[g]).reduce((a, b) => a + b, 0);
  let openSlots = 0;
  for (const pl of me.plantations) if (!pl.manned) openSlots++;
  for (const b of me.buildings) openSlots += (BLD_BY_ID[b.bid].men - b.men);
  let shipSpace = 0; for (const sh of G.ships) shipSpace += (sh.capacity - sh.count);
  let prod = 0; for (const g of GOODS) prod += G.productionCapacity(me, g);
  const hasOffice = G.isManned(me, 12);

  // 0) 全局规划：终盘抢下心仪的大紫块（按终局契合度选定、单张错过被抢）。即使入门也懂"该收的大分要收"。
  const plan = me._plan || updatePlan(me);
  if (plan.focus === "score" && plan.targetLV && has("Builder") && 12 - G.buildingUsedSpaces(me) >= 2) {
    if (me.money >= G.effectiveCostWithRoleBonus(me, BLD_BY_ID[plan.targetLV.id], true)) return idxOf("Builder");
  }

  // 1) 货多 + 船有空 → 船长，把产出换成分（生产多就往多运货靠）
  if (goods >= 3 && shipSpace > 0 && has("Captain")) return idxOf("Captain");
  // 2) 有高价货(咖啡/烟草)能卖 → 商人赚钱（有咖啡就往咖啡赚钱靠）
  if (has("Trader") && G.tradingHouse.length < 4) {
    for (const g of ["coffee", "tobacco"]) if (me.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g))) return idxOf("Trader");
  }
  // 3) 缺人手(空岗 + 船上有殖民者) → 市长
  if (openSlots >= 1 && G.colonistsOnShip >= 1 && has("Mayor")) return idxOf("Mayor");
  // 4) 产能高 → 工匠多产货
  if (prod >= 2 && has("Craftsman")) return idxOf("Craftsman");
  // 5) 攒够钱买得起像样建筑 → 建造（建筑能多就往多买建筑靠；不为买便宜小建筑而频繁建造）
  if (has("Builder") && me.money >= 5) {
    for (const b of BUILDINGS) {
      if (G.buildingStock[b.id] <= 0 || G.ownsBuilding(me, b.id)) continue;
      if (12 - G.buildingUsedSpaces(me) < b.size) continue;
      if (me.money < G.effectiveCostWithRoleBonus(me, b, true)) continue;
      const fits = b.type === "production" ? (b.good === "corn" || me.plantations.some(pl => pl.good === b.good)) : b.vp >= 2;
      if (fits) return idxOf("Builder"); // 有对应田的生产建筑 或 ≥2分的建筑才直觉去买
    }
  }
  // 6) 还有货没卖 → 商人
  if (goods > 0 && has("Trader") && G.tradingHouse.length < 4) {
    for (const g of GOODS) if (me.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g)) && GOOD_PRICE[g] >= 1) return idxOf("Trader");
  }
  // 7) 种植园少 → 拓殖，铺设产业
  if (me.plantations.length < 4 && has("Settler")) return idxOf("Settler");
  // 8) 拿金币
  if (has("Prospector")) return idxOf("Prospector");
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

// 评估一座建筑对此玩家的价值（编码 Alexfrog/jimc 策略：收入引擎早→得分建筑中→大紫晚）
function evalBuildingValue(p, b, phase) {
  let v = b.vp * 5;
  const id = b.id;
  // ① 生产建筑：必须喂得起；咖啡/烟草=收入引擎，早期"三重红利"最强
  if (b.type === "production") {
    const good = b.good;
    const ownedFields = p.plantations.filter(pl => pl.good === good).length;
    const poolFields = G.plantationPool.filter(g => g === good).length;
    let existingCap = 0;
    for (const bb of p.buildings) { const bd2 = BLD_BY_ID[bb.bid]; if (bd2.type === "production" && bd2.good === good) existingCap += bd2.men; }
    const feedNow = Math.max(0, Math.min(ownedFields - existingCap, b.men));
    const feedSoon = Math.max(0, Math.min(ownedFields + poolFields - existingCap, b.men));
    if (feedSoon <= 0) return v - 30; // 喂不起=死建筑，强烈不买
    v += feedNow * 12 + (feedSoon - feedNow) * 4;
    const income = (good === "coffee" || good === "tobacco"); // 高价收入货
    // 友邻反馈：AI 会买蔗糖厂卡人却不产糖(厂闲置=既资敌又浪费)。根因：当前一块该货田都没有时，
    // 仅靠"明牌池里有田"就买厂是纯投机——那些田常被先手抢光/翻走，等到自己拓殖时已没了，厂遂闲置。
    // 故：当前【0 块该货田】时压价，优先"有田才囤厂"；收入货(咖啡/烟草)值得提前布局，罚轻，蔗糖/靛蓝/玉米罚重。
    if (feedNow === 0 && p._specBuyPen !== 0) v -= income ? 3 : 10; // _specBuyPen=0 → A/B 关闭此罚
    if (phase === "early") v += income ? 22 : 10;  // 收入引擎早期最值（三重红利）
    else if (phase === "mid") v += income ? 10 : 4;
    else v -= 12;                                   // 后期生产建筑来不及发挥
    // 垄断/不撞右手（仅高价货）
    if (income) {
      const n = G.numPlayers;
      if (!G.anyOpponentProduces(p, good)) v += 8;                              // 独家高价货 → 稳定卖钱+卡船
      else if (G.playerProduces(G.players[(p.idx - 1 + n) % n], good)) v -= 6;  // 右手(先卖/先运)已做 → 别撞
    }
    // combo：已有公会大厅(19) → 每个生产建筑额外终局 VP（小型+1/大型+2），鼓励"建筑得分"流派囤产
    if (G.ownsBuilding(p, 19)) v += (b.men === 1 ? 1 : 2) * 5;
    return v;
  }
  // ② 紫色建筑：按文章的"位"与时机
  switch (id) {
    case 7:  v += phase === "early" ? 14 : phase === "mid" ? 16 : 6; break; // 小市场：全场最通用、便宜
    case 8:  v += phase === "early" ? 12 : 3; break;                        // 庄园：仅前几买
    case 9:  v += phase === "early" ? 12 : 2; break;                        // 建筑工地：早期且很少最优
    case 10: v += phase === "mid" ? 14 : phase === "early" ? 6 : 9; break;  // 小仓库：得分型，中期好(Wharf 低价替代)
    case 11: v += phase === "early" ? 2 : 4; break;                         // 济贫院：差，不建立收入源
    case 12: v += 5; break;                                                 // 办公室：很少好
    case 13: v += phase === "mid" ? 16 : 8; break;                          // 大市场
    case 14: v += 3; break;                                                 // 大仓库：避免(伪两倍效果)
    case 15: {                                                              // 工厂：多样性收入引擎(早中很强)。kinds 用"已产或有田"前瞻计数 + 高多样非线性奖励
      let kinds = 0;
      for (const g of GOODS) if (G.productionCapacity(p, g) > 0 || p.plantations.some(pl => pl.good === g)) kinds++;
      const fb = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 };
      v += kinds * 6 + fb[Math.min(5, kinds)] * 4 + (phase === "early" ? 16 : phase === "mid" ? 10 : -4);
      break;
    }
    case 16: v += 1; break;                                                 // 大学：烂建筑(文章判决)
    case 17: v += phase === "mid" ? 28 : phase === "early" ? 14 : 8; break; // 港口：得分型，中期峰值；后期勿替代大建筑
    case 18: v += phase === "mid" ? 22 : phase === "early" ? 8 : 6; break;  // 码头
    // —— 新建筑扩展（已实装效果的给策略分；待实装的暂仅基础分）——
    case 24: { // 引水渠：仅当拥有大靛蓝厂/大糖厂才有用
      const useful = G.ownsBuilding(p, 3) || G.ownsBuilding(p, 4);
      v += useful ? (phase === "late" ? 4 : 12) : 1; break;
    }
    case 25: v += phase === "early" ? 5 : 3; break;                          // 黑市：建造省钱(情境)
    case 26: { const vio = p.buildings.filter(b => { const t = BLD_BY_ID[b.bid].type; return t === "violet" || t === "large_violet"; }).length; v += vio >= 2 ? (phase === "late" ? 3 : 8) : 2; break; } // 森林屋：建筑流省建造费
    case 27: { let prod = 0; for (const g of GOODS) prod += G.productionCapacity(p, g); v += Math.min(14, prod * 3) + (phase === "early" ? 2 : 4); break; } // 储藏库
    case 28: v += phase === "early" ? 7 : phase === "mid" ? 5 : 1; break;     // 招待所：2 工人槽 + 客工灵活部署
    case 29: v += phase === "mid" ? 16 : phase === "early" ? 12 : 8; break;  // 贸易驿站：卖货灵活，稳定收入
    case 30: { const spaceLeft = 12 - G.buildingUsedSpaces(p); v += (phase === "early" ? 22 : phase === "mid" ? 12 : 2) * Math.min(1, spaceLeft / 3); break; } // 教堂：越早建越值(后面还会建)
    case 31: v += phase === "mid" ? 20 : phase === "early" ? 10 : 12; break; // 小码头：私人船得分
    case 32: v += phase === "mid" ? 22 : phase === "early" ? 12 : 12; break; // 灯塔：装船给金(类港口)
    case 33: v += phase === "early" ? 24 : phase === "mid" ? 16 : 6; break;  // 图书馆：角色特权翻倍——价值随后续选角色次数累积，越早买越值(强手共识)
    case 34: { let best = 0; for (const g of GOODS) if (g !== "corn") best = Math.max(best, G.productionCapacity(p, g)); v += best * 7 + (phase === "early" ? 22 : phase === "mid" ? 14 : -2); break; } // 专业工厂：单货收入引擎(类工厂)
    case 35: v += phase === "mid" ? 24 : phase === "early" ? 14 : 10; break; // 工会大厅：囤同货换VP(得分型)
    // —— 贵族扩展(38-44, 45 走大紫分支)：按效果估值 ——
    case 38: v += phase === "early" ? 4 : 2; break;                          // 地产办公室：情境性地块操作
    case 39: v += phase === "late" ? 2 : 6; break;                           // 礼拜堂：每工匠 +1金/贵族+1VP
    case 40: v += phase === "early" ? 5 : 2; break;                          // 狩猎小屋：情境(弃地/空格最多)
    case 41: v += phase === "early" ? 11 : phase === "mid" ? 7 : 2; break;   // 规划办公室：建造折扣(建筑流强)
    case 42: { const nb = G.nobleCount(p); v += nb * 4 + (phase === "mid" ? 4 : 1); break; } // 皇家供应商：每贵族弃货得VP
    case 43: v += phase === "early" ? 15 : phase === "mid" ? 10 : 3; break;  // 别墅：每市长+1贵族(引擎,贵族→终局VP+功能)
    case 44: { const nb = G.nobleCount(p); v += nb * 5 + (phase === "early" ? 8 : phase === "mid" ? 5 : -2); break; } // 珠宝匠：每贵族每工匠+1金
    // —— Tibs 自制扩展（真实规则估值）——
    case 46: v += phase === "early" ? 4 : phase === "mid" ? 2 : -2; break;    // 金矿：慢速金+占 2 工人，弱
    case 47: { const ci = p.plantations.some(pl => pl.good === "corn" || pl.good === "indigo") ? 6 : 1; v += ci + (phase === "late" ? -2 : 2); break; } // 水井：有玉米/靛蓝才好
    case 48: v += phase === "early" ? 10 : phase === "mid" ? 6 : 1; break;    // 寄宿屋(=济贫院)：新地自带殖民者
    case 49: v += phase === "early" ? 16 : phase === "mid" ? 12 : 4; break;   // 塔楼：每个角色特权(强被动)
    case 50: v += phase === "mid" ? 16 : phase === "early" ? 8 : 6; break;    // 海关站：选船长+VP+清船续货
    case 51: { let kinds = 0; for (const g of GOODS) if (G.productionCapacity(p, g) > 0 || p.plantations.some(pl => pl.good === g)) kinds++; v += kinds * 3 + (phase === "late" ? 4 : 6); break; } // 档案馆：货种多样得分
    case 52: v += Math.min(8, Math.max(0, p.money - 4)) * 2 + (phase === "late" ? -4 : 2); break; // 银行：有闲钱才值(投资→VP)
  }
  // ③ 大紫(19-23 + 扩展 36/37)：终盘最强（即时兑现）。快照估值(早期天然低=鼓励晚买正确)
  if (b.type === "large_violet") {
    let special = estLargeVioletSpecial(p, id) || 0;
    if (id === 36) { // 修道院：按当前种植园估成套数(每3张同类=1套)
      const cnt = {};
      for (const pl of p.plantations) cnt[pl.good] = (cnt[pl.good] || 0) + 1; // 官方：全部岛屿地块(含采石场/森林)成套
      let sets = 0; for (const k in cnt) sets += Math.floor(cnt[k] / 3);
      special = [0, 1, 3, 6, 10][Math.min(sets, 4)];
    } else if (id === 37) { // 雕像：固定 8VP 已计入 vp，无额外
      special = 0;
    }
    v += special * 5 + (phase === "late" ? 28 : phase === "mid" ? 14 : 0);
  }
  return v;
}

// ---- L6 私有启发式参数：默认值=共用启发式的手调常数；window._l6Heur 注入覆盖(仅 L6 生效) ----
// 这是"打破 L4/L5/L6 共用子决策启发式"的入口(AI_STRENGTH §7 的剩余方向)：
// L4/L5 永远走默认值；CMA-ES/(1+1)-ES 调参产物只改变宗师的行为。
const L6_HEUR_DEFAULTS = {
  pl_moneyLean: 7,    // 选地: money>=此值视为建筑流(多囤矿)
  pl_priceMult: 1.5,  // 选地: 货价基础权重
  pl_cornEarly: 6,    // 选地: 早期玉米加分
  pl_cornLate: 3,     // 选地: 中后期玉米加分
  pl_chain: 14,       // 选地: 有厂缺田补产业链
  pl_diverse: 2,      // 选地: 多样化
  pl_monoBase: 3,     // 选地: 垄断基础分(再加货价)
  pl_clash: 5,        // 选地: 与右手撞高价货减分
  bd_costMult: 3,     // 建造: 价格机会成本
  bd_chooser: 5,      // 建造: chooser 折扣加分
  bd_grabLate: 30,    // 建造: 心仪大紫 late 抢卡
  bd_grabMid: 16,     // 建造: 心仪大紫 mid 抢卡
  bd_saveGap: 4,      // 建造: 攒钱抢大紫的差额容忍
  bd_saveMediocre: 20,// 建造: "平庸建筑"分数线(低于则留钱)
};
function l6h(p, key) {
  if (p && p._aiLevel === 6 && typeof window !== "undefined" && window._l6Heur && window._l6Heur[key] != null) return window._l6Heur[key];
  return L6_HEUR_DEFAULTS[key];
}

function aiPickPlantation(p, options, isChooser) {
  const lvl = p._aiLevel || 3;
  // 群友·苦寒/仲达：以 spite 概率抢人类最依赖的那种货田（恶心人类的产业链）
  if (_spiteRoll(p)) {
    const human = G.players.find(x => x.isHuman);
    if (human) {
      const cnt = {}; for (const pl of human.plantations) if (pl.good && pl.good !== "quarry") cnt[pl.good] = (cnt[pl.good] || 0) + 1;
      let want = null, mx = 0; for (const g in cnt) if (cnt[g] > mx) { mx = cnt[g]; want = g; }
      if (want) { const oi = options.findIndex(o => o.kind === "plant" && o.good === want); if (oi >= 0) return oi; }
    }
  }
  // 群友·吾鱼：以 diverse 概率拿"自己还没产的货种"的田，凑齐 3+ 种产线
  if (_diverseRoll(p)) {
    const di = diversePlantPick(p, options);
    if (di != null) return di;
  }
  // 群友·Rafael：以 collect 概率给"已有厂的货"加田(喂厂成套)/深化已有货种
  if (_collectRoll(p)) {
    const ci = collectPlantPick(p, options);
    if (ci != null) return ci;
  }
  // 群友·二月：以 bigbuild 概率囤 1-2 个矿场（给大建筑打折）
  if (_bigbuildRoll(p)) {
    const bi = bigbuildPlantPick(p, options);
    if (bi != null) return bi;
  }
  // 进化/普通(L2,L3) 用基因选田(忠实于 DNA)；入门(L1,直觉发挥强项)与困难/专家(L4,L5)用带采石场/垄断意识的启发式。
  if (p._dna && (lvl === 2 || lvl === 3)) {
    const idx = dnaPickPlantation(p, options, isChooser);
    if (idx !== null && idx >= 0 && idx < options.length) return idx;
  }
  // chooser 拿采石场：建筑流（已有紫色建筑 / 钱多准备建造）权重更高，多囤矿减少未来建造花费
  let qCount = 0;
  for (const pl of p.plantations) if (pl.good === "quarry") qCount++;
  const violetOwned = p.buildings.filter(b => { const t = BLD_BY_ID[b.bid].type; return t === "violet" || t === "large_violet"; }).length;
  const buildingLean = violetOwned >= 1 || p.money >= l6h(p, "pl_moneyLean");
  const quarryCap = buildingLean ? 4 : (gamePhase() === "early" ? 2 : 1);
  if (isChooser && qCount < quarryCap && G.quarriesLeft > 0) {
    const qOpt = options.findIndex(o => o.kind === "quarry");
    if (qOpt >= 0) return qOpt;
  }
  // 否则在各 plant 选项里打分（软性偏好：补产业链 > 垄断 > 避免与右手撞高价货 > 多样化）
  const n = G.numPlayers;
  const upstream = G.players[(p.idx - 1 + n) % n]; // 顺时针里先于我行动者(右手，先卖/先运)
  const refMap = { indigo: [1, 3], sugar: [2, 4], tobacco: [5], coffee: [6] };
  const phase = gamePhase();
  let bestI = -1, bestS = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    if (o.kind !== "plant") continue;
    const g = o.good;
    let s = GOOD_PRICE[g] * l6h(p, "pl_priceMult");      // 基础：贵货种植园略高
    if (g === "corn") s += (phase === "early" ? l6h(p, "pl_cornEarly") : l6h(p, "pl_cornLate")); // 早期玉米强(不需厂、1人即产)
    const ref = refMap[g];
    let factCap = 0; if (ref) for (const bid of ref) { const bb = G.ownsBuilding(p, bid); if (bb) factCap += BLD_BY_ID[bid].men; }
    const myCount = p.plantations.filter(pp => pp.good === g).length;
    if (ref && myCount < factCap) s += l6h(p, "pl_chain"); // 有厂缺田 → 补全产业链(主因)
    if (myCount === 0 && g !== "corn") s += l6h(p, "pl_diverse"); // 多样化(利于贸易/运货、打破重复)
    // 垄断意识：全场没别人产这种 → 加分(独家卖钱+占船拖慢对手)，贵货更值
    if (!G.anyOpponentProduces(p, g)) s += l6h(p, "pl_monoBase") + GOOD_PRICE[g];
    // 不与右手做同种高价货：上家已做咖啡/烟草而我去撞 → 减分(他先卖/先运堵我)
    if ((g === "coffee" || g === "tobacco") && G.playerProduces(upstream, g)) s -= l6h(p, "pl_clash");
    if (s > bestS) { bestS = s; bestI = i; }
  }
  return bestI >= 0 ? bestI : 0;
}

function aiPickBuilding(p, options, isChooser) {
  // 群友·吾鱼：以 diverse 概率优先收购"多货→金"的建筑(工厂等)/补全产线货种
  if (_diverseRoll(p)) {
    const di = diverseBuildPick(p, options);
    if (di != null) return di;
  }
  // 群友·Rafael：以 collect 概率给"有田没厂"的货补对应生产建筑(成套，贵货优先)
  if (_collectRoll(p)) {
    const ci = collectBuildPick(p, options);
    if (ci != null) return ci;
  }
  // 群友·二月：第8回合后优先买"对自己加分最多"的 10 元大建筑
  if (_bigbuildRoll(p)) {
    const bi = bigbuildBuildPick(p, options);
    if (bi != null) return bi;
  }
  // 进化(L2)：忠实按建筑染色体决策（从左到右买第一个想买且买得起的）
  if (p._aiLevel === 2 && p._dna && typeof dnaPickBuilding === "function") {
    const idx = dnaPickBuilding(p, options, isChooser);
    if (idx !== null && idx >= 0 && idx < options.length) return idx;
    // 基因选"不买"。DNA 染色体只覆盖基础 23 建筑，看不见扩展建筑。
    // 基础局：保持 pass（忠于 VBA）。扩展局：若有可买的【扩展建筑(>=24)】，落到下方启发式补一手，
    // 让 L2 也能用上扩展建筑（不再完全无视扩展），但基础局行为不变。
    // 注：判“有无扩展建筑可买”用选项本身(id>=24)即可——独立模块下任一扩展(新建筑/贵族/Tibs)都覆盖到。
    if (!options.some(o => o.b.id >= 24)) return -1;
  }
  const phase = gamePhase();
  // 全局规划：心仪的大紫块（单张，错过被抢）。mid/late 且契合度高才进入"规划"。
  const tgt = bestLargeViolet(p);
  const tgtStrong = tgt && tgt.special >= 3 && (phase === "mid" || phase === "late");
  const scored = options.map((o, i) => {
    let score = evalBuildingValue(p, o.b, phase);
    score -= o.cost * l6h(p, "bd_costMult");      // 价格高减分（机会成本）
    if (isChooser) score += l6h(p, "bd_chooser"); // chooser 折扣略加分
    if (tgtStrong && o.b.id === tgt.id) score += (phase === "late" ? l6h(p, "bd_grabLate") : l6h(p, "bd_grabMid")); // 心仪大紫可买→抢下
    return { i, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // 攒钱抢大紫：心仪大紫还买不起但已接近（一两回合可凑齐），且当前最佳可买只是平庸小建筑 → 不买，留钱。
  if (tgtStrong && !options.some(o => o.b.id === tgt.id)) {
    const cost = G.effectiveCostWithRoleBonus(p, BLD_BY_ID[tgt.id], isChooser);
    if (p.money >= cost - l6h(p, "bd_saveGap") && scored[0].score < l6h(p, "bd_saveMediocre")) return -1;
  }
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

// 选角确认弹窗里的"本回合你将获得什么"预览——让玩家在落子前看清结果、不对就撤销。
// p = 选择者（人类）；roleName = 待确认的角色。返回一段 HTML。
function buildRolePreview(p, roleName) {
  const warn = s => `<div style="color:#e74c3c;font-weight:bold;margin:4px 0">⚠ ${s}</div>`;
  const ok = s => `<div style="color:#7fd77f;margin:4px 0">${s}</div>`;
  const note = s => `<div style="color:#bbb;font-size:12px;margin:3px 0">${s}</div>`;
  try {
    if (roleName === "Builder") {
      const space = 12 - G.buildingUsedSpaces(p);
      const opts = [];
      for (const b of BUILDINGS) {
        if (G.buildingStock[b.id] <= 0 || G.ownsBuilding(p, b.id) || space < b.size) continue;
        const cost = G.effectiveCostWithRoleBonus(p, b, true); // 你是选择者：享 -1 折扣
        if (p.money + G.blackMarketCapacity(p) < cost) continue;
        opts.push({ b, cost });
      }
      if (space <= 0) return warn("你的城区已满（12格），无法再建造——建议撤销改选别的角色。");
      if (opts.length === 0) return warn(`你只有 ${p.money} 金，买不起任何可建建筑（已含选择者 -1 折扣）——建议撤销。`);
      opts.sort((a, b) => a.cost - b.cost);
      const list = opts.map(o => `${BLD_BY_ID[o.b.id].cn}<span style="color:#f3c969">(${o.cost}金)</span>`).join("　");
      return ok(`你有 ${p.money} 金（选择者 -1 折扣），可建造 ${opts.length} 种：`) + note(list);
    }
    if (roleName === "Craftsman") {
      const lines = [];
      for (const g of GOODS) {
        const made = Math.min(G.productionCapacity(p, g), G.supply[g]);
        if (made > 0) lines.push(`${plantEmoji(g)}${GOOD_NAMES[g]}×${made}`);
      }
      if (lines.length === 0) return warn("你当前的种植园/加工厂产不出任何货（或供应区已耗尽）——建议撤销。");
      return ok(`预计你将生产：${lines.join("　")}`) + note("＋工匠特权：再额外拿 1 个「你本回合产过」的货（场上无人产出则没有）。实际产量受供应区余量与结算顺序影响。");
    }
    if (roleName === "Trader") {
      const hasOffice = G.isManned(p, 12), hasPost = G.isManned(p, 29);
      const houseFull = G.tradingHouse.length >= 4;
      const chooserBonus = G.isManned(p, 33) ? 2 : 1; // 图书馆翻倍
      const mkBonus = (G.isManned(p, 7) ? 1 : 0) + (G.isManned(p, 13) ? 2 : 0);
      const opts = [];
      if (!houseFull) for (const g of GOODS) if (p.goods[g] > 0 && (hasOffice || !G.tradingHouse.includes(g))) opts.push(`贸易站卖${GOOD_NAMES[g]}(+${GOOD_PRICE[g] + chooserBonus + mkBonus}金)`);
      if (hasPost) for (const g of GOODS) if (p.goods[g] > 0) opts.push(`驿站卖${GOOD_NAMES[g]}(+${GOOD_PRICE[g] + chooserBonus}金)`);
      if (opts.length === 0) return warn(houseFull ? "贸易站已满，且你没有自家驿站——本回合卖不了货，建议撤销。" : "你没有可卖的货——建议撤销。");
      return ok("你可出售（含选择者 +1 特权）：") + note(opts.join("　"));
    }
    if (roleName === "Mayor") {
      const m = getMayorPreview();
      if (!m) return note("拿殖民者。");
      if (m.chooserTotal === 0) return warn("船上与供应区都没有殖民者可拿——本回合市长几乎没收益，建议撤销。");
      return ok(`你将获得 ${m.chooserTotal} 名殖民者（船 +${m.chooserFromShip}，特权 +${m.chooserBonus}）。`);
    }
    if (roleName === "Settler") {
      const pool = G.plantationPool || [];
      if (pool.length === 0 && G.quarriesLeft <= 0) return warn("种植园池与采石场都空了——拿不到地，建议撤销。");
      const cnt = {};
      for (const g of pool) cnt[g] = (cnt[g] || 0) + 1;
      const list = Object.keys(cnt).map(g => `${plantEmoji(g)}${GOOD_NAMES[g]}×${cnt[g]}`).join("　") || "（无）";
      const quarry = G.quarriesLeft > 0 ? `；你可改拿 🪨采石场（剩${G.quarriesLeft}）` : "";
      return ok("你将拿 1 张种植园。") + note(`明牌池：${list}${quarry}`);
    }
    if (roleName === "Captain") {
      let myGoods = 0; for (const g of GOODS) myGoods += p.goods[g];
      const c = getCaptainPreview();
      if (myGoods === 0) return warn("你手上没有货可装船——本回合船长拿不到分，建议撤销。");
      return ok(`你持有 ${myGoods} 个货，将尽量装船得 VP（首次装船 +1VP 特权）。`) + (c ? note(c.ships.join("　")) : "");
    }
    if (roleName === "Prospector") {
      return ok("你将立即 +1 金。") + note("仅你执行，其他玩家本回合不行动。");
    }
    if (roleName === "Buccaneer") {
      return note("海盗：从 4 个行动里选 1 个执行（仅你）。");
    }
  } catch (e) { /* 预览失败不应阻断游戏 */ }
  return note(ROLE_BONUS[roleName] || "");
}

function humanPickRole(available, p) {
  return new Promise(outerResolve => {
    const attemptPick = () => {
      humanBoardSelect({
        type: "role",
        choices: available.map((r, i) => ({ key: i, role: r })),
        promptText: "选择角色 — 点击角色卡，选后可撤销",
        allowSkip: false,
      }).then(idx => {
        const r = available[idx];
        const rName = ROLE_NAME_CN[r.name];
        const coinStr = r.money ? `，含 +${r.money} 金奖励` : "";
        const preview = p ? buildRolePreview(p, r.name) : "";
        showModal(
          `确认选择「${rName}」？`,
          `<p style="color:#ccc;font-size:13px;margin:4px 0">${ROLE_BONUS[r.name]}${coinStr}</p>` +
          `<div style="border-top:1px solid #555;margin:8px 0 4px;padding-top:8px"><b style="color:#f3c969">本回合你将获得：</b></div>` +
          preview +
          `<p style="color:#999;font-size:12px;margin:8px 0 0">确认后该阶段立即开始；不对就点撤销重选。</p>`,
          [
            { label: "确认选择", confirm: true, fn: () => { hideModal(); outerResolve(idx); } },
            { label: "🔙 撤销重选", fn: () => { hideModal(); attemptPick(); } },
          ]
        );
      });
    };
    attemptPick();
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
  // 模态弹出时强制隐藏 tooltip（鼠标可能停在建筑上时弹出，tooltip 会挡）
  hideHoverTooltip();
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = body;
  const bb = document.getElementById("modal-buttons");
  bb.innerHTML = "";
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.textContent = b.label;
    btn.onclick = b.fn;
    if (b.primary) btn.classList.add("primary");
    if (b.confirm) btn.classList.add("confirm");
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
  return { corn: "🌽", indigo: "🟦", sugar: "⬜", tobacco: "🟤", coffee: "☕", quarry: "🪨", forest: "🌲" }[g] || "❔";
}

function render() {
  // 隐藏当前 tooltip：render() 会替换大量 DOM，旧的 mouseleave 可能永远不触发
  // 导致 tooltip 卡在屏幕上挡住选择 UI（如选种植园 / 选卖货种类）
  hideHoverTooltip();
  // 群友人格首次登场：日志 + toast 揭晓（给你"不能输给苦寒"的动力）
  if (G._hasPersona && !G._personaRevealed) {
    G._personaRevealed = true;
    for (const pp of G.players) if (pp._persona) {
      G.logEvent(`⚡ 特殊对手登场：${pp._persona.name} —— ${pp._persona.desc}`, "role");
      if (typeof showToast === "function") showToast(`<div class="t-title">⚡ 群友登场：${pp._persona.name}</div><div class="t-sub">${pp._persona.desc}</div>`, { kind: "role" });
    }
  }
  // Topbar
  const endLabel = G.endTriggered ? ' · ⚠ 末轮' : '';
  document.getElementById("game-info").textContent = `第 ${G.turnNumber} 回合 · 总督 👑 ${G.players[G.governor].name}${endLabel}`;
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
      ${GOODS.map(g => `<span class="rb-good good-${g}${G.supply[g] === 0 ? " rb-empty" : ""}" title="${GOOD_NAMES[g]}供应区剩 ${G.supply[g]}${G.supply[g] === 0 ? "（已耗尽，本回合无法生产/拿取该货，需装船或清贸易站回流）" : ""}">${plantEmoji(g)}${G.supply[g]}</span>`).join("")}
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
    // 部分角色显示即时状态，方便人类玩家决策
    let statLine = "";
    if (r.name === "Mayor") {
      const m = getMayorPreview();
      if (m) statLine = `<div class="role-stat">选你 +${m.chooserTotal}👷 (船${m.chooserFromShip}+特权${m.chooserBonus})</div>`;
    } else if (r.name === "Captain") {
      const c = getCaptainPreview();
      if (c) {
        const full = G.ships.filter(s => s.count >= s.capacity).length;
        const empty = G.ships.filter(s => !s.good).length;
        statLine = `<div class="role-stat">船 ${full}满 / ${empty}空</div>`;
      }
    } else if (r.name === "Trader") {
      const t = getTraderPreview();
      if (t) statLine = `<div class="role-stat">贸易站 ${t.used}/${t.cap}${t.full ? "·满" : ""}</div>`;
    }
    div.innerHTML = `
      <div class="role-name">${ROLE_NAME_CN[r.name]}</div>
      <div class="role-bonus">${ROLE_BONUS[r.name]}</div>
      ${statLine}
      ${r.money ? `<div class="role-coin">${r.money}</div>` : ""}
    `;
    div.dataset.tooltipHtml = buildRoleTooltip(r.name);
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
  for (const b of BUILDINGS) {
    if (G.buildingStock[b.id] <= 0) continue;
    tierBuildings[TIER_BY_BID[b.id] - 1].push(b);
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
      ${bldImgHtml(b)}
      <div class="badge">×${left}</div>
      <div class="info"><span>${b.cn}</span><span>${b.cost}💰 ${b.vp}⭐${costNote}</span></div>
    `;
    div.dataset.tooltipHtml = buildBuildingTooltip(b);
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
        <span class="player-name">${i === G.governor ? "👑 " : ""}${p.name}${p.isHuman ? " (你)" : (p._persona ? ` <span class="persona-badge" title="群友 · ${p._persona.desc}">⚡群友</span>` : " (AI)")}</span>
        <span class="player-stats">
          <span class="stat" data-stat="money">💰${p.money}</span>
          <span class="stat" data-stat="vp">⭐${totalVP}</span>
          <span class="stat" data-stat="colonists">👷${G.totalColonists(p) - G.nobleCount(p)}</span>${G.expansionNobles ? `<span class="stat" data-stat="nobles">🎩${G.nobleCount(p)}</span>` : ""}
        </span>
      </div>
      <div class="player-section">
        <h5>种植园 (${p.plantations.length}/12)</h5>
        <div class="plantation-grid">
          ${p.plantations.map(pl => `<div class="plantation plant-${pl.good}" title="${pl.manned ? '已上人' : '空岗'}">${pl.manned ? (pl.noble ? "🎩" : "👷") : ""}</div>`).join("")}
        </div>
      </div>
      <div class="player-section">
        <h5>建筑 (${G.buildingUsedSpaces(p)}/12)</h5>
        <div class="building-grid">
          ${p.buildings.map(b => {
            const bd = BLD_BY_ID[b.bid];
            const nb = b.nobles || 0;
            return `<div class="mini-building" data-tooltip-html="${buildBuildingTooltip(bd).replace(/"/g, "&quot;")}">
              ${bldImgHtml(bd)}
              <div class="men">${"🎩".repeat(nb)}${"👷".repeat(b.men - nb)}${"⚪".repeat(bd.men - b.men)}</div>
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
  setupBuildingTooltips();
}

// 全局可调用：强制隐藏当前 tooltip（render / showModal / 点击 / Esc 都会调）
function hideHoverTooltip() {
  const tip = document.getElementById("building-tooltip");
  if (tip) tip.classList.add("hidden");
}

function setupBuildingTooltips() {
  let tip = document.getElementById("building-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "building-tooltip";
    tip.className = "building-tooltip hidden";
    document.body.appendChild(tip);
    // 一次性全局监听：任何 click / mousedown / Esc / 跨大块移动都隐藏
    // （避免 render 替换 DOM 后 mouseleave 不触发导致挂屏）
    document.addEventListener("click", () => hideHoverTooltip(), true);
    document.addEventListener("mousedown", () => hideHoverTooltip(), true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideHoverTooltip();
    });
    // 视口外（鼠标移出窗口）也隐藏
    document.addEventListener("mouseleave", () => hideHoverTooltip());
  }
  document.querySelectorAll("[data-tooltip-html]").forEach(el => {
    el.onmouseenter = (e) => {
      tip.innerHTML = e.currentTarget.dataset.tooltipHtml;
      tip.classList.remove("hidden");
    };
    el.onmousemove = (e) => {
      const margin = 12;
      const tw = tip.offsetWidth || 320;
      const th = tip.offsetHeight || 140;
      let x = e.clientX + 16;
      let y = e.clientY + 16;
      if (x + tw + margin > window.innerWidth) x = e.clientX - tw - 16;
      if (y + th + margin > window.innerHeight) y = e.clientY - th - 16;
      tip.style.left = `${Math.max(margin, x)}px`;
      tip.style.top = `${Math.max(margin, y)}px`;
    };
    el.onmouseleave = () => tip.classList.add("hidden");
  });
}

// 显示玩家潜在 VP（含建筑+特殊）
Game.prototype.getDisplayVPs = function (p) {
  let vp = 0;
  for (const b of p.buildings) vp += BLD_BY_ID[b.bid].vp;
  vp += this.getSpecialVPs(p);
  return vp;
};

// ============================================================
// Tibs 节庆模块（Festival）：3 个竞速目标，各首位达成者得奖励
// 规则取自 mod 笔记本：种植3×X→3殖民者 / 一回合同产3种→3金 / 建造第3列指定建筑→3VP
// ============================================================
Game.prototype.setupFestival = function () {
  const goods = GOODS.slice();
  const plant = goods[Math.floor(Math.random() * goods.length)];
  const prod = goods.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  // 第 3 列建筑：tier3 紫色 + 烟草/咖啡厂；避开与种植目标同色的产建
  const col3 = BUILDINGS.filter(b => (TIER_BY_BID[b.id] === 3 && b.type === "violet") || b.id === 5 || b.id === 6);
  const pool = col3.filter(b => !((plant === "tobacco" && b.id === 5) || (plant === "coffee" && b.id === 6)));
  const cand = pool.length ? pool : col3;
  const bld = cand.length ? cand[Math.floor(Math.random() * cand.length)].id : 15;
  this.festival = { plant, prod, bld, plantWinner: null, prodWinner: null, bldWinner: null };
  this.logEvent(`🎉 节庆目标：①种植 3×${GOOD_NAMES[plant]}→+3殖民者 ②一回合同产 ${prod.map(g => GOOD_NAMES[g]).join("+")}→+3金 ③建造「${BLD_BY_ID[bld].cn}」→+3VP（各仅首位达成者得奖）`, "role");
};
// 在每个角色阶段结束后调用，结算尚未被领取的目标（按座位序定"首位"）
Game.prototype.checkFestival = function (roleName) {
  const f = this.festival; if (!f) return;
  if (f.plantWinner === null) {
    for (let i = 0; i < this.numPlayers; i++) {
      const p = this.players[i];
      if (p.plantations.filter(pl => pl.good === f.plant).length >= 3) {
        f.plantWinner = i; let got = 0;
        while (got < 3 && this.colonistsLeft > 0) { this.colonistsLeft--; p._unplacedMen = (p._unplacedMen || 0) + 1; got++; }
        this.logEvent(`🎉 ${p.name} 完成节庆①种植 3×${GOOD_NAMES[f.plant]}：+${got} 殖民者(岸边)`, "role");
        break;
      }
    }
  }
  if (f.prodWinner === null && roleName === "Craftsman" && this._lastCraftKinds) {
    for (let i = 0; i < this.numPlayers; i++) {
      const kinds = this._lastCraftKinds[i];
      if (kinds && f.prod.every(g => kinds.has(g))) {
        f.prodWinner = i; this.players[i].money += 3;
        this.logEvent(`🎉 ${this.players[i].name} 完成节庆②同产 ${f.prod.map(g => GOOD_NAMES[g]).join("+")}：+3 金`, "role");
        break;
      }
    }
  }
  if (f.bldWinner === null) {
    for (let i = 0; i < this.numPlayers; i++) {
      if (this.ownsBuilding(this.players[i], f.bld)) {
        f.bldWinner = i; const gain = Math.min(3, this.vpLeft);
        this.players[i].vp += gain; this.vpLeft -= gain;
        this.logEvent(`🎉 ${this.players[i].name} 完成节庆③建造「${BLD_BY_ID[f.bld].cn}」：+${gain} VP`, "role");
        break;
      }
    }
  }
};

Game.prototype.getSpecialVPs = function (p) {
  let v = 0;
  // Guild Hall (19)
  if (this.isManned(p, 19)) {
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (b.bid === 44) v += 2; // 扩展II：珠宝匠按大型生产建筑计 2VP
      else if (bd.type === "production") v += (bd.men === 1 ? 1 : 2);
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
  // Customs House (22) — 官方：按游戏中获得的全部 VP 筹码计（含教堂/工会/贵族建筑等来源）
  if (this.isManned(p, 22)) {
    v += Math.floor(p.vp / 4);
  }
  // City Hall (23)
  if (this.isManned(p, 23)) {
    for (const b of p.buildings) {
      const bd = BLD_BY_ID[b.bid];
      if (bd.type === "violet" || bd.type === "large_violet") v += 1;
    }
  }
  // 扩展II：贵族 — 每名贵族终局 1 VP；皇家花园(45) 镇守时每名贵族再 +1 VP
  if (this.expansionNobles) {
    const nb = this.nobleCount(p);
    v += nb;
    if (this.isManned(p, 45)) v += nb;
  }
  // 扩展：Statue(37) — 印刷 VP 即 8，已计入建筑分，这里不再加（避免双重计分）
  // 扩展：Cloister(36) 每 3 张同类种植园成套 → 1/2/3/4 套 = 1/3/6/10 VP（需镇守）
  if (this.isManned(p, 36)) {
    const cnt = {};
    for (const pl of p.plantations) cnt[pl.good] = (cnt[pl.good] || 0) + 1; // 官方：全部岛屿地块(含采石场/森林)成套
    let sets = 0;
    for (const k in cnt) sets += Math.floor(cnt[k] / 3);
    v += [0, 1, 3, 6, 10][Math.min(sets, 4)];
  }
  // Tibs 自制扩展终局分
  if (this.expansionTibs) {
    // 大教堂(53)：每个【其他玩家】拥有的大型建筑 +2 VP（无需对方镇守）
    if (this.isManned(p, 53)) {
      let n = 0;
      for (const op of this.players) { if (op === p) continue; n += op.buildings.filter(b => BLD_BY_ID[b.bid].type === "large_violet").length; }
      v += n * 2;
    }
    // 银行(52)：每枚投资 +1 VP（需镇守）。投资在建造/选角色时即时锁定，存 p._invest
    if (this.isManned(p, 52)) v += (p._invest || 0);
    // 档案馆(51)：船长阶段已即时结算 VP，终局不再加
  }
  return v;
};

// ============================================================
// 游戏结束
// ============================================================
// 单人闯关头衔评级（按终局总分）
const SOLO_TIERS = [
  { min: 0,  title: "学徒种植者", emoji: "🌱" },
  { min: 25, title: "殖民点工头", emoji: "⚒️" },
  { min: 35, title: "庄园主",     emoji: "🏛️" },
  { min: 45, title: "殖民官",     emoji: "🏅" },
  { min: 55, title: "总督",       emoji: "🎖️" },
  { min: 65, title: "总督大人",   emoji: "👑" },
];
function soloRank(total) {
  let r = SOLO_TIERS[0];
  for (const t of SOLO_TIERS) if (total >= t.min) r = t;
  return r;
}

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
  if (castOn()) { castFinale(scores); await sleep(2200); } // 终场颁奖词，停一拍再上结算面板
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
    if (G.isManned(p, 22)) specialDetail.push(`海关大楼:${Math.floor(p.vp/4)}`);
    if (G.expansionNobles && G.nobleCount(p) > 0) specialDetail.push(`贵族:${G.nobleCount(p)}${G.isManned(p, 45) ? "×2(皇家花园)" : ""}`);
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
  // 单人闯关：把总分换算成头衔评级
  const isSolo = G.numPlayers === 1;
  let soloBanner = "";
  if (isSolo) {
    const t = scores[0].total;
    const tier = soloRank(t);
    const next = SOLO_TIERS.find(x => x.min > t);
    const toNext = next ? `　还差 <b>${next.min - t}</b> 分晋级「${next.title}」` : `　已是最高头衔！`;
    soloBanner = `
      <div style="text-align:center; margin:10px 0 14px; padding:14px; background:linear-gradient(135deg,#3a2f1a,#2a3a24); border:2px solid #f3c969; border-radius:10px;">
        <div style="font-size:13px; color:#aaa">本局终局得分</div>
        <div style="font-size:40px; line-height:1.1; color:#f3c969; font-weight:bold">${t} <span style="font-size:16px;color:#cbb27a">VP</span></div>
        <div style="font-size:22px; margin-top:4px">${tier.emoji} <b style="color:#ffe9a8">${tier.title}</b></div>
        <div style="font-size:12px; color:#bbb; margin-top:4px">${toNext}</div>
      </div>`;
  }
  const winnerLine = isSolo
    ? `<p style="color:#aaa; font-size:12px; text-align:center">船运 ${scores[0].base} ＋ 建筑 ${scores[0].buildingVP} ＋ 特殊 ${scores[0].special}</p>`
    : `<p>胜利者：<b style="color:#f3c969">${scores[0].p.name}</b>（${scores[0].total} VP）</p>`;
  const body = `
    <p style="color:#aaa; font-size:13px">结束原因：${endReason} | 第 ${G.turnNumber} 回合</p>
    ${soloBanner}
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
    ${winnerLine}
  `;
  // 对局日志：终局写入
  if (typeof PRTrace !== "undefined") {
    PRTrace.finish(
      G,
      scores.map(s => ({ seat: s.p.idx, total: s.total, base: s.base, buildingVP: s.buildingVP, special: s.special })),
      scores[0].p.idx,
      endReason
    );
  }
  showModal(isSolo ? "🏝️ 单人闯关结算" : "🎉 游戏结束", body, [
    { label: isSolo ? "再挑战一次" : "再玩一局", fn: () => location.reload(), primary: true },
  ]);
}
