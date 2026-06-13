# 规则审计：实现 vs 波多黎各公认易错规则

针对波多黎各最常被玩错的 14 条规则，逐条核对 `game.js`/`sim.js` 实现（多 agent 并行审计 + 对抗式复核，权威来源见文末）。

## 结论：实现忠实，无实际可玩 bug

**11/14 条直接正确；3 条被标记的经独立复核全是误报或纯防御性（不影响对局）。**

### ✅ 已验证正确（11 条）

| 规则 | 正确实现 |
|---|---|
| **采石场折扣上限**（最经典） | `effectiveCost`：每个有人采石场 −1，封顶 = `TIER_BY_BID`（建筑列号 1–4）；建造师特权另 −1；不低于 0 ✓ |
| 船长强制装船 | 能装必装、尽量多装、每船一种货 ✓ |
| 船长留货 | 阶段末留 1 桶 + 小仓库(1 种全部)/大仓库(2 种) ✓ |
| 工匠生产前提 | 玉米只需种植园；其它需种植园+生产建筑都有人；选择者 +1 已产货种 ✓ |
| 拓殖采石场 | 仅选择者可拿（或建筑工地）✓ |
| 工厂奖励 | 1/2/3/5 金（2/3/4/5 种）✓ |
| 建筑不可重复 | `ownsBuilding` 拦截 ✓ |
| 贸易站 | 不能卖同种（除非办公室）；满 4 在商人阶段末清空 ✓ |
| 市长补船/分配 | 补充数=全场空建筑槽(最少=玩家数)；从市长逐个轮流取；市长另 +1 ✓ |
| 官邸/城堡/公会大厅终局分 | 已用岛格阶梯 / 每 3 殖民者 / 小1大2 生产建筑 ✓ |
| 金矿主 | 仅选择者 +1 金 ✓ |

### ⚠ 3 条被标记 → 复核后均非真 bug

1. **终局触发（被标 P0 高）→ 误报。** 权威触发在 `doMayor`（补船时 `colonistsLeft < refill` → 终局，game.js:1812 / sim.js:410），与官方"市长阶段无法补满船即终局"完全一致。审计 agent 漏看了这处，只盯着 `checkEndCondition` 里那条 `colonistsLeft<=0 && colonistsOnShip<=0` —— 它是**冗余安全网**，永远在 `doMayor` 之后才可能成立，**不改变终局时机**。已加注释说明，未改逻辑。回归实测 3 种模式终局均正常触发。

2. **塔楼·金矿主特权 sim 未实现 → 非基础 bug。** sim.js 不模拟任何 Tibs 建筑效果（已知的、有意的近似）；且 AI 训练/评测**从不用 Tibs**，故对 AI 实测强度零影响。单独补一个 Tibs 效果而不补其余反而不一致，故不改。

3. **船长选择者 +1VP 缺 `loaded>0` 显式判断 → 纯防御性。** 该奖励在"每次装船"循环体内，`loaded>0` 恒成立，原本就只在实际装货时给。已加 `&& loaded>0`（game.js + sim.js）照字面对齐规则、防未来重构，行为不变。

## 改动

仅两处行为中性改动：船长选择者奖励显式加 `loaded>0`（game.js/sim.js）；`checkEndCondition` 加注释指明 doMayor 是权威触发。回归：none/nobles/tibs 各 3 局完成、终局正常。

**Sources**: [Wikipedia](https://en.wikipedia.org/wiki/Puerto_Rico_(board_game)) · [UltraBoardGames Roles](https://www.ultraboardgames.com/puerto-rico/roles.php) · [BGG Common Rules Mistakes](https://boardgamegeek.com/thread/25515/common-rules-mistakes)
