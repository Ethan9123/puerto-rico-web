// ============================================================
// sim_features.js — AlphaZero 训练用的丰富特征提取
// ============================================================
// 设计：
//  - 固定长度 Float32Array，无 NaN/Inf；所有数值归一化到 [0, 1] 或 [-1, 1]。
//  - 5 个玩家槽位（不足 5 人时未用槽位置 0），第一个槽 = perspectiveSeat。
//  - 镜像保证 NN 对任何位置的玩家一视同仁。
//
// 注意：sim.js 内已有一个 18 维 extractFeatures（用于线性 value 函数）。
// 本文件挂在 PRSim.extractRich，与原有保持兼容、不替换。
//
// 加载顺序：game.js → sim.js → sim_features.js（在 index.html 中）

(function (root) {
  "use strict";
  const A = (typeof BUILDINGS !== "undefined") ? { BUILDINGS, BLD_BY_ID, GOODS, GOOD_PRICE, ROLE_LIST } : root._PR_STATIC;
  if (!A) throw new Error("sim_features.js: BUILDINGS/GOODS static missing; load game.js first");
  const { BLD_BY_ID: BLD, GOODS: GOODS_, ROLE_LIST: ROLES_ } = A;

  // 静态尺寸（ROLE_LIST = 7，GOODS = 5）
  // 建筑布局固定为 23 个基础建筑（id 1..23），与运行时 BUILDINGS 数组无关：Game 构造会就地改写 BUILDINGS
  // （扩展局 24-53、Tibs 局移除 11、轮抽 splice），worker 侧的 _PR_STATIC 快照也可能不是 23 个；
  // 若按 BLDS.length/BLDS[i] 布局，扩展建筑会写越过 23 位宽的槽位串到相邻特征（训练分布只含基础 23 个）。
  const N_BUILDINGS = 23;
  const BASE_BLD_IDS = Array.from({ length: N_BUILDINGS }, (_, i) => i + 1);
  const N_ROLES = ROLES_.length;       // 7
  const N_GOODS = GOODS_.length;       // 5
  const MAX_PLAYERS = 5;
  const MAX_ROLE_CARDS = 8;            // 5p 局 8 张

  // ---- 单玩家特征布局（与 PER_PLAYER_DIM 同步）----
  // 0           : vp / 50
  // 1           : money / 15
  // 2           : shippingVP / 30
  // 3-7         : goods[5] / 5            (corn, indigo, sugar, tobacco, coffee)
  // 8-12        : plantations_count_per_good[5] / 10
  // 13-17       : plantations_manned_per_good[5] / 5
  // 18          : manned_quarries / 4
  // 19-41       : buildings_owned[23]     (binary)
  // 42-64       : buildings_manned[23]    (binary fully manned)
  // 65          : buildings_used_spaces / 12
  // 66          : total_colonists / 20
  // 67          : plantation_count_total / 12
  const PER_PLAYER_DIM = 68;

  // ---- 全局特征布局 ----
  // 0           : vpLeft / 120
  // 1           : colonistsLeft / 95
  // 2           : colonistsOnShip / 15
  // 3           : turnNumber / 25         (clamped)
  // 4-8         : supply[5] / 11
  // 9-31        : buildingStock[23] > 0   (binary, 是否还可买)
  // 32          : quarriesLeft / 8
  // 33-37       : plantationPool_per_good[5] / 5
  // 38          : plantationDeck_size / 30
  // 39-59       : ships[3] = {capacity/10, good_onehot[5], count/8} × 3 = 21 dims
  // 60-79       : tradingHouse counts per good [5] / 4 + 是否满 (1) + 空位数/4 (1)
  //               实际：5 (count per good) + 1 (used/4) + 1 (full binary) = 7;
  //               留 20 维放每个槽位（4 × 5 one-hot）使布局更密集表达——简化为：
  //               5 (count per good in TH) / 4
  //               1 used/4
  //               1 full binary
  //               (余下 13 槽填 0 留扩展)
  // 80-95       : roleCards[8] × 2 = 16   (每张: taken_binary, money / 8)
  // 96-98       : numPlayers one-hot (3, 4, 5)
  // 99-103      : my_seat_from_governor one-hot (0..4)
  // 104         : endTriggered binary
  // 105         : picksThisTurn / 5
  const GLOBAL_DIM = 106;

  const FEATURE_DIM_RICH = MAX_PLAYERS * PER_PLAYER_DIM + GLOBAL_DIM; // 5*68 + 106 = 446

  function _clamp01(x) {
    if (!isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function _writePlayer(out, base, p) {
    if (!p) return; // 未用槽位
    out[base + 0] = _clamp01((p.vp || 0) / 50);
    out[base + 1] = _clamp01((p.money || 0) / 15);
    out[base + 2] = _clamp01((p.shippingVP || 0) / 30);
    for (let g = 0; g < N_GOODS; g++) out[base + 3 + g] = _clamp01((p.goods[GOODS_[g]] || 0) / 5);
    // 种植园统计
    const cnt = { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };
    const mnd = { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };
    let quarryManned = 0, plantTotal = 0;
    for (const pl of p.plantations) {
      plantTotal++;
      if (pl.good === "quarry") { if (pl.manned) quarryManned++; continue; }
      cnt[pl.good]++;
      if (pl.manned) mnd[pl.good]++;
    }
    for (let g = 0; g < N_GOODS; g++) {
      out[base + 8 + g] = _clamp01(cnt[GOODS_[g]] / 10);
      out[base + 13 + g] = _clamp01(mnd[GOODS_[g]] / 5);
    }
    out[base + 18] = _clamp01(quarryManned / 4);
    // 建筑 owned / manned binary
    const owned = new Set();
    const manned = new Set();
    let usedSpaces = 0, totalCol = 0;
    for (const b of p.buildings) {
      owned.add(b.bid);
      const bd = BLD[b.bid];
      usedSpaces += bd.size;
      totalCol += b.men || 0;
      if ((b.men || 0) >= bd.men) manned.add(b.bid);
    }
    for (let i = 0; i < N_BUILDINGS; i++) {
      const bid = BASE_BLD_IDS[i];
      out[base + 19 + i] = owned.has(bid) ? 1 : 0;
      out[base + 42 + i] = manned.has(bid) ? 1 : 0;
    }
    out[base + 65] = _clamp01(usedSpaces / 12);
    // 殖民者总数：种植园上工 + 建筑上人 + unplaced
    for (const pl of p.plantations) if (pl.manned) totalCol++;
    totalCol += p.unplaced || 0;
    out[base + 66] = _clamp01(totalCol / 20);
    out[base + 67] = _clamp01(plantTotal / 12);
  }

  function _writeGlobal(out, base, st, perspectiveSeat) {
    const VP_TOTAL = { 3: 75, 4: 100, 5: 122 }[st.numPlayers] || 100;
    const COL_TOTAL = { 3: 55, 4: 75, 5: 95 }[st.numPlayers] || 75;
    out[base + 0] = _clamp01((st.vpLeft || 0) / 120);
    out[base + 1] = _clamp01((st.colonistsLeft || 0) / 95);
    out[base + 2] = _clamp01((st.colonistsOnShip || 0) / 15);
    out[base + 3] = _clamp01((st.turnNumber || 1) / 25);
    for (let g = 0; g < N_GOODS; g++) out[base + 4 + g] = _clamp01((st.supply?.[GOODS_[g]] || 0) / 11);
    for (let i = 0; i < N_BUILDINGS; i++) {
      const bid = BASE_BLD_IDS[i];
      out[base + 9 + i] = (st.buildingStock?.[bid] || 0) > 0 ? 1 : 0;
    }
    out[base + 32] = _clamp01((st.quarriesLeft || 0) / 8);
    // 种植园池
    const poolCnt = { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };
    for (const pl of (st.plantationPool || [])) {
      const k = (pl && pl.good) ? pl.good : pl; // 兼容 {good} 和裸字符串
      if (k && k !== "quarry" && poolCnt[k] !== undefined) poolCnt[k]++;
    }
    for (let g = 0; g < N_GOODS; g++) out[base + 33 + g] = _clamp01(poolCnt[GOODS_[g]] / 5);
    out[base + 38] = _clamp01((st.plantationDeck?.length || 0) / 30);
    // 船 ×3
    for (let i = 0; i < 3; i++) {
      const sh = st.ships[i] || { capacity: 0, good: null, count: 0 };
      const o = base + 39 + i * 7;
      out[o + 0] = _clamp01(sh.capacity / 10);
      for (let g = 0; g < N_GOODS; g++) out[o + 1 + g] = (sh.good === GOODS_[g]) ? 1 : 0;
      out[o + 6] = _clamp01((sh.count || 0) / 8);
    }
    // 贸易站统计
    const thCnt = { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };
    for (const g of (st.tradingHouse || [])) if (thCnt[g] !== undefined) thCnt[g]++;
    for (let g = 0; g < N_GOODS; g++) out[base + 60 + g] = _clamp01(thCnt[GOODS_[g]] / 4);
    out[base + 65] = _clamp01((st.tradingHouse?.length || 0) / 4);
    out[base + 66] = (st.tradingHouse?.length || 0) >= 4 ? 1 : 0;
    // 67-79 留作扩展，零
    // 角色卡 ×8（不足 8 张填 0）
    const rc = st.roleCards || [];
    for (let i = 0; i < MAX_ROLE_CARDS; i++) {
      const o = base + 80 + i * 2;
      if (i < rc.length) {
        out[o + 0] = rc[i].taken ? 1 : 0;
        out[o + 1] = _clamp01((rc[i].money || 0) / 8);
      } // else 0
    }
    // numPlayers one-hot (3,4,5)
    out[base + 96] = st.numPlayers === 3 ? 1 : 0;
    out[base + 97] = st.numPlayers === 4 ? 1 : 0;
    out[base + 98] = st.numPlayers === 5 ? 1 : 0;
    // 视角玩家座位（相对 governor）one-hot
    const seatFromGov = (((perspectiveSeat - st.governor) % st.numPlayers) + st.numPlayers) % st.numPlayers;
    for (let i = 0; i < 5; i++) out[base + 99 + i] = (i === seatFromGov) ? 1 : 0;
    out[base + 104] = st.endTriggered ? 1 : 0;
    out[base + 105] = _clamp01((st.picksThisTurn || 0) / 5);
  }

  /**
   * 提取 AlphaZero 训练用的丰富特征向量
   * @param {Object} st  sim 状态
   * @param {number} perspectiveSeat  视角玩家的座位 idx（不是从 governor 起算）
   * @returns {Float32Array} 长度 FEATURE_DIM_RICH（5 人槽 + global = 446）
   */
  function extractRich(st, perspectiveSeat) {
    if (!st || !st.players) throw new Error("extractRich: invalid state");
    if (perspectiveSeat < 0 || perspectiveSeat >= st.numPlayers) throw new Error(`extractRich: bad perspectiveSeat ${perspectiveSeat}`);
    const out = new Float32Array(FEATURE_DIM_RICH);
    // 5 个玩家槽位：从 perspectiveSeat 开始顺时针
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const seat = (perspectiveSeat + slot) % st.numPlayers;
      const p = slot < st.numPlayers ? st.players[seat] : null;
      _writePlayer(out, slot * PER_PLAYER_DIM, p);
    }
    _writeGlobal(out, MAX_PLAYERS * PER_PLAYER_DIM, st, perspectiveSeat);
    return out;
  }

  // 把动作（选了第几张角色卡）转成 7 维 policy target（独热）
  // 注意：在 5p 局有 8 张卡（多一张 Prospector），但角色种类仍是 7 个 ROLES_。
  // 用角色种类作为 policy index，避免被多 1 张 Prospector 错位。
  function roleNameToPolicyIdx(name) {
    const i = ROLES_.indexOf(name);
    if (i < 0) throw new Error("unknown role: " + name);
    return i; // 0..6
  }
  function policyOneHot(roleName) {
    const out = new Float32Array(N_ROLES);
    out[roleNameToPolicyIdx(roleName)] = 1;
    return out;
  }

  // 暴露 API
  const api = { extractRich, FEATURE_DIM_RICH, PER_PLAYER_DIM, GLOBAL_DIM, MAX_PLAYERS, N_BUILDINGS, N_ROLES, N_GOODS, roleNameToPolicyIdx, policyOneHot };
  if (typeof root.PRSim === "object") Object.assign(root.PRSim, api);
  else root.PRSim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
