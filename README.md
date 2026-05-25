# 波多黎各 Puerto Rico — Web 版

基于 [Tony Mitton's Puerto Rico Evolver](https://boardgamegeek.com/filepage/15089/) 进化的 AI + Rio Grande 2002 原版规则的浏览器单机游戏。

## ✨ 特性

- **5 个难度等级**（实测胜率从弱到强）
  - L1 入门 (Beginner) — 只看自己面板
  - L2 进化 (DNA) — Excel 700+ 代进化的纯 DNA AI
  - L3 普通 (Normal) — 看邻座 + 流派
  - L4 困难 (Hard) — 看全场 + 智能覆盖
  - L5 专家 (Expert) — 针对领先者 + 1 轮角色前瞻（50ms 预算）
- **每个 CPU 可独立选难度**
- **支持 3 / 4 / 5 玩家**
- **完整 23 建筑** + 6 种货物 + 7 角色（Settler / Mayor / Builder / Craftsman / Trader / Captain / Prospector）
- **图片来自 Anniversary Edition PDF**
- **拿田 / 建筑动画**（FLIP 技术）
- **BGA 风格 UI**：4 行建筑供应区（按矿场折扣分级）

## 🎮 怎么玩

### 方式一：双击 `run.bat`（推荐）
脚本会自动检测 Python 或 Node.js，启动本地 HTTP 服务器，并打开浏览器。

### 方式二：手动启动
```cmd
cd puerto_rico_game
python -m http.server 8765
```
浏览器打开 [http://localhost:8765](http://localhost:8765)

### 方式三：直接双击 `index.html`
注意：浏览器对 `file://` 协议有限制，部分图片可能加载不全。

## 📋 游戏规则简介

每个回合，玩家依次选择一个角色，该角色的动作由所有玩家执行（但选择者额外得一份特权）：

| 角色 | 动作 | 特权 |
|---|---|---|
| 拓殖者 (Settler) | 拿 1 种植园 | 可拿采石场 |
| 市长 (Mayor) | 补殖民者 | +1 殖民者从供应区 |
| 建造师 (Builder) | 建 1 栋建筑 | -1 金币 |
| 工匠 (Craftsman) | 生产货物 | +1 货物 |
| 商人 (Trader) | 卖 1 货到贸易站 | +1 金币 |
| 船长 (Captain) | 装船运货 | +1 VP（首次）|
| 金矿主 (Prospector) | （无效果） | +1 金币 |

**结束条件**（任一触发）：
- 殖民者池不足以补满船
- 任一玩家建满 12 城市格
- VP 池用尽

详细规则见 [Universal Head v2 摘要](https://www.universalhead.com/games/getting-rules) 或 [BoardGameGeek](https://boardgamegeek.com/boardgame/3076/puerto-rico)。

## 🤖 AI 设计

| 等级 | 平均分（vs 入门）| 特点 |
|---|---|---|
| L1 入门 | 30 | 决策树：缺人→Mayor; 货≥4→Captain; 钱≥12→Builder |
| L2 进化 | 36 | Tony Mitton 进化器跑 700+ 代后的 top 玩家 DNA |
| L3 普通 | 42 | + 角色卡奖金意识 + 下家货物卡位 |
| L4 困难 | 43 | + 后期 Captain/Mayor 智能覆盖 |
| L5 专家 | 50 | + 保留紧急覆盖 + 单轮角色相位前瞻（最大化“我方投影 - 对手最佳投影”） |

## 📁 项目结构

```
puerto_rico_game/
├── index.html          ← 主入口
├── game.js             ← 完整游戏逻辑 + AI（~2500 行）
├── styles.css          ← BGA 风格 UI
├── ai_dna.json         ← Excel 提取的 50 个进化 DNA
├── run.bat             ← Windows 一键启动脚本
└── assets/
    └── buildings/      ← 23 张建筑卡图（Anniversary PDF）
```

## 🛠 系统要求

- **任意现代浏览器**（Chrome / Edge / Firefox）
- **Python 3** 或 **Node.js**（用于本地 HTTP 服务器，启动脚本自动检测）
- 推荐分辨率 1280×800+

## 📜 致谢

- **Andreas Seyfarth** — 原版游戏设计
- **Rio Grande Games** — 出版商
- **Tony Mitton** — VBA 进化器作者
- **Universal Head** — 玩家辅助 PDF
- **Anniversary Edition** — 建筑插画来源

## 📄 License

本项目仅供学习交流，所有原版游戏知识产权属于 Rio Grande Games / Andreas Seyfarth。


## 🧪 规则一致性测试

- 打开 `tests/rules.html` 可运行 20 局全 AI（G 类）规则守恒检查。
- 覆盖检查：
  - 殖民者总量守恒（3/4/5 人分别为 55/75/95）
  - 货物总量守恒（corn 10, indigo 11, sugar 11, tobacco 9, coffee 9）
  - 初始建筑库存总数为 23
