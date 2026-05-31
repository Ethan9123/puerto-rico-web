# 波多黎各 Puerto Rico — Web 版

> 浏览器单机游戏。基于 [Tony Mitton 的 Puerto Rico Evolver Excel (BGG #8766)](https://boardgamegeek.com/filepage/8766/pr-030205zip) 进化了 700+ 代的 AI + Rio Grande 2002 原版规则。

🌐 **语言 / Language**：**中文** · [English](README.en.md) · [Français](README.fr.md) · [Español](README.es.md)

---

## 🌐 在线游玩

### 🌍 海外/翻墙用户首选
**👉 [https://ethan9123.github.io/puerto-rico-web/](https://ethan9123.github.io/puerto-rico-web/) 👈** （GitHub Pages）

### 🇨🇳 国内朋友推荐：微信发离线包（双击即玩）

GitHub Pages / Vercel / Cloudflare 在国内**都不稳**（边缘 IP 被 GFW 干扰，每个 ISP / 时段不同）。腾讯 EdgeOne 的中国大陆节点**默认域名只有 3 小时预览**，长期访问要 ICP 备案（1-3 周）。

**真正 100% 国内可用 + 0 成本 + 0 备案 + 0 安装**：

```
1. 拿到离线包 puerto-rico-web-{date}.zip (~6.8 MB)
2. 微信 → 文件传输助手 → 拖入 zip → 转发给朋友
3. 朋友：解压 → 直接双击 index.html → 浏览器立即开玩
```

完全离线、永久可用、不走 GFW、不需要网络、**不需要本地服务器**。所有 AI（含进化 DNA 与宗师神经网络）、所有建筑、所有规则都内嵌在本地。包里是纯网页文件（无 .exe / .bat / 安装程序），若杀软误报可放心恢复并加入信任（详见包内 `使用说明.txt`）。

### 🎲 在线尝试（可能不稳）

如果不想搞离线分发，国内朋友可以按顺序试：

| 链接 | 备注 |
|---|---|
| https://puerto-rico-web.vercel.app/ | Vercel，部分 ISP/时段可用 |
| https://puerto-rico-web.kids1995eva.workers.dev/ | Cloudflare Workers，国际节点 |
| https://ethan9123.github.io/puerto-rico-web/ | GitHub Pages，多数被墙 |

哪个能开用哪个；都不行就走上面的"微信发离线包"。

👉 国内访问完整原理分析见 **[CN-ACCESS.md](CN-ACCESS.md)**

---

## ✨ 特性

### 🎮 完整游戏
- **3 / 4 / 5 玩家** 全部支持，自动按官方规则调整初始金币、殖民者池、VP 池、船舱容量、角色卡数量
- **完整 23 栋建筑** + 6 种货物 + 7 个角色（拓殖者 / 市长 / 建造师 / 工匠 / 商人 / 船长 / 金矿主）
- **官方规则严格实现**：起始种植园按总督顺位发放、随机首任总督、12 格 / VP 池 / 殖民者池末轮触发、Captain 满船卸货、Craftsman 特权仅限本回合产出过的种类、Mayor 选择者特权 +1 等
- **建筑插画来自 [BGG 42234 — Anniversary Edition 插画版 (Greg May)](https://boardgamegeek.com/filepage/42234/base-game-and-expansion-buildings-illustrated)**

### 🤖 6 个 AI 难度等级（每个 CPU 可独立选）

| 等级 | 名称 | 特点 |
|---|---|---|
| **L1** | 入门 (Beginner) | 凭直觉发挥强项的简单决策：缺人→Mayor、货多→Captain、钱够→Builder |
| **L2** | 进化 (DNA) | Tony Mitton VBA 进化器 700+ 代的纯 DNA AI（5 座位池 × 各 10 条，共 50 条 DNA） |
| **L3** | 普通 (Normal) | + 角色卡奖金意识 + 下家货物卡位 |
| **L4** | 困难 (Hard) | + **全场卡位反制**（抢 Captain / Builder / Trader / Craftsman / Mayor）+ 软评分策略倾向 + depth-2 快照前瞻 |
| **L5** | 专家 (Expert) | **ISMCTS 蒙特卡洛树搜索**：信息集决定化 + UCB1 + 启发式 rollout，逐步深想 |
| **L6** | 宗师 (Grandmaster) | **AlphaZero**：自对弈训练的神经网络制导 MCTS（NN policy/value + PUCT），最强 |

> 📊 **实测强度与天梯基准** 见 [AI_STRENGTH.md](AI_STRENGTH.md)：宗师头对头胜过所有其他档位
> (横扫 L1–L3，险胜 L4/L5)，以及为何对近似同强的顶端档难破 60%(4 人对称局的结构性上限)、
> AlphaZero 全决策探索的结论。

### 🧠 可调 AI 思考时间

设置界面选「AI 思考时间」（作用于专家 L5 / 宗师 L6 的搜索预算）：
- 🚀 **快速** (0.1s) — 看 AI 互打用
- ⚖️ **普通** (1.5s)
- 🧠 **深度** (6s · 默认) — 2 轮 lookahead
- 💎 **极限** (10s) — PvAI 强烈推荐

困难 / 专家 / 宗师 AI 会**实时分析人类的威胁**（货物数、可买大紫数、最佳卖价、产能、空岗），并主动抢卡反制。

### 🎨 玩法体验细节

- **建筑 / 角色 hover tooltip**：所有建筑显示成本、VP、工人槽、采石场折扣上限、详细效果；角色显示行动 / 特权 / 时机提示
- **市长卡即时殖民者预览**：「选你 +3 (船 2 + 特权 1)」直接显示在卡上，不需要 hover
- **船长卡 / 商人卡即时状态**：「船 1 满 / 2 空」、「贸易站 3/4」
- **AI 动作右上角浮窗 toast**：CPU 选了什么、装船多少、卖了什么、生产了什么 — 一目了然
- **你的被动收益绿色提示**：市长阶段「你 +N 殖民者」、工匠阶段「你 +X 🌽 +Y 🟦」、船长阶段「你本轮船运 +X VP」
- **末轮 ⚠ 提示**：殖民者 / VP / 12 格任一触发时，顶部立刻显示「· ⚠ 末轮」+ 浮窗告警「本回合所有玩家选完后结束」
- **拿田 / 建筑 FLIP 飞行动画**
- **BGA 风格 UI**：建筑市场分 4 行（按采石场折扣 1/2/3/4 金币分级）

---

## 📋 游戏规则简介

每个回合，总督开始顺时针每人选 1 个角色。该角色的动作所有玩家执行（按顺时针），但**选择者额外得一份特权**。未被选的角色卡每回合 +1 金币奖励。

| 角色 | 动作 | 特权 |
|---|---|---|
| 🌾 拓殖者 (Settler) | 拿 1 块种植园 | 可改拿采石场 |
| 👷 市长 (Mayor) | 船上殖民者按顺时针每人 1 个，直到船空 | +1 殖民者从供应区 |
| 🏗 建造师 (Builder) | 建 1 栋建筑 | -1 金币折扣 |
| 🏭 工匠 (Craftsman) | 全场按产能生产 | +1 个本回合已产出的货物 |
| 💰 商人 (Trader) | 卖 1 货到贸易站 | +1 金币 |
| 🚢 船长 (Captain) | 顺序装船（强制装），1 货 = 1 VP | +1 VP（本阶段一次性） |
| ⛏ 金矿主 (Prospector) | 无 | +1 金币（仅选择者） |

**游戏结束**（三条件任一触发 → 本回合所有人选完后结束）：
- 殖民者池不足以补满船
- 任一玩家建满 12 城市格（大紫建筑占 2 格）
- VP 池用尽

**计分**：VP 筹码 + 建筑分 + 大紫建筑特殊分（需有人镇守）；平手比金币 + 货物。

详细规则见 [Universal Head v2 摘要](https://www.universalhead.com/games/getting-rules) 或 [BoardGameGeek](https://boardgamegeek.com/boardgame/3076/puerto-rico)。

---

## 💻 本地运行（可选）

如果想离线玩 / 改代码：

### 方式一：直接双击 `index.html`（推荐）
DNA 策略与宗师神经网络权重都已内嵌为 `<script>`，无需联网、无需服务器，双击即玩。

### 方式二：本地 HTTP 服务器（改代码时方便热刷新）
```bash
cd puerto-rico-web
python -m http.server 8765
# 或
npx http-server -p 8765 -c-1
```
浏览器打开 [http://localhost:8765](http://localhost:8765)

---

## 📁 项目结构

```
puerto-rico-web/
├── index.html              ← 主入口
├── game.js                 ← 完整游戏逻辑 + 6 级 AI
├── styles.css              ← BGA 风格 UI
├── ai_dna.json             ← Excel 提取的进化 DNA（5 座位池 × 各 10 条）
├── ai_dna.js               ← DNA 解码器（进化 L2）
├── sim.js                  ← 无头规则引擎 + ISMCTS（专家 L5）
├── sim_features.js         ← 446 维特征提取（宗师 L6）
├── sim_nn.js               ← 神经网络前向推理（宗师 L6）
├── mcts_value_nn.json      ← AlphaZero 权重（线上 fetch；离线包内嵌）
├── run.bat / pack.bat      ← Windows 启动 / 打包脚本（可选，已非必需）
├── LICENSE                 ← MIT
├── NOTICE.md               ← 知识产权说明
├── tests/                  ← 守恒检查 + 端到端自对弈 + 场景断言
├── tools/                  ← 胜率 / 阶梯标定 / 训练评估脚本
└── assets/
    └── buildings/          ← 23 张建筑插画（来自 BGG 42234）
```

---

## 🛠 系统要求

- **任意现代浏览器**（Chrome / Edge / Firefox / Safari）
- 直接双击 `index.html` 即可离线运行，**无需** Python / Node.js（仅改代码热刷新时才需本地服务器）
- 推荐分辨率 **1280×800+**

---

## 🧪 自动化测试

- **轻量规则守恒**：打开 `tests/rules.html`
- **完整端到端检查**：打开 `tests/full.html`，约 5-10 分钟跑完：
  - 3/4/5 人各 **20 局全 L5 AI** 完整对局
  - 每局输出 `result ...` 行
  - 断言游戏正确结束（殖民者耗尽 / VP 耗尽 / 12 城市格触发之一）
  - 殖民者总量守恒（3/4/5p 分别 55 / 75 / 95）
  - 货物总量守恒（玉米 10、靛蓝 11、蔗糖 11、烟草 9、咖啡 9）
  - 每位玩家最终 VP > 0
  - **混合等级**（L1~L6 同桌）平均分顺序单调：L6 > L5 > L4 > L3 > L2 > L1
  - 23 栋建筑至少被建造一次
  - 7 个角色至少被选择一次
  - 无 JS console error
- **专项单元测试**：
  - `random_governor`：40 局至少 3 个不同的首任总督座位
  - `starting_plant_order`：起始种植园按总督顺位分发
  - `captain_default_ship`：船长候选默认按「同货叠装 > 最大空船」排序
  - `craftsman_no_production` / `craftsman_bonus_only_produced`：工匠特权仅限本回合产出过的种类
  - `end_trigger_full_round`：末轮触发后所有玩家仍完整选完角色才结束
  - `toast`：浮窗 stack + auto-dismiss

---

## 🚢 船长阶段默认选船优先级（实现说明）

当同一种货可装入多个候选船位时，默认优先级：
1. **已装同种货的船**（继续叠装，避免分散）
2. **空船里剩余容量最大的船**
3. 其余候选按**剩余容量降序**

人类玩家点击确认前候选列表会把最佳选项放在第一位；AI 也用同样优先级。

---

## 📜 致谢与来源

| 贡献 | 来源 |
|---|---|
| **原版游戏设计** | Andreas Seyfarth |
| **出版商** | Rio Grande Games |
| **VBA 进化器（AI DNA 来源）** | [Tony Mitton — BGG #8766](https://boardgamegeek.com/filepage/8766/pr-030205zip) |
| **建筑插画** | [Greg May — Anniversary Edition Buildings, BGG #42234](https://boardgamegeek.com/filepage/42234/base-game-and-expansion-buildings-illustrated) |
| **规则参考** | [Universal Head 玩家辅助 PDF](https://www.universalhead.com/games/getting-rules), [BGG 规则页](https://boardgamegeek.com/boardgame/3076/puerto-rico) |

---

## 📄 License & Attribution

- **代码**采用 **MIT License**，见 [`LICENSE`](LICENSE)
- 本项目是**粉丝非商业重制**，**Puerto Rico** 相关游戏 IP（名称、机制、规则表达等）归 **Andreas Seyfarth / Rio Grande Games** 所有
- `assets/buildings/` 建筑插画版权归 Rio Grande Games / 原插画师；仅用于教育 / 个人游玩演示，**不随 MIT 一并授权**
- 项目与 Andreas Seyfarth、Rio Grande Games **无官方关联或背书**
- 详见 [`NOTICE.md`](NOTICE.md)
