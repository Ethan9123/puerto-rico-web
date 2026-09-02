# AI 强度与天梯基准

本文档记录波多黎各 Web 版 AI 的实测强度、最强档(宗师/L6)对各档位的能力地图，以及
AlphaZero 全决策探索的结论。所有数字均可用 `tools/` 下脚本复现。

> TL;DR — **宗师(L6) 是可达的最强 AI**：头对头胜过所有其他档位，横扫 L1–L3
> (79–93%)，险胜 L4(55%)、微胜 L5(30% > 公平 25%)。**对近似同强的 L4/L5 难以达到
> 60% 胜率，这是 4 人对称局的结构性上限**，而非实现缺陷。
>
> 2026-06 更新：配对评测基线 vs 3×L5 = **35.4%**(480 局, §6)；重训/调参/子决策调优
> 六条路全部实测无增益(§7)，现役配置即角色选择架构下的最优。宗师实际机制 = **policy
> 先验 × 完整 rollout**(value 头未参与决策, §1 修正)。
>
> 2026-06 终局求解器：接入 L6 build 子决策在 iters=40 测得 +3.3pp(z=3.75)，但 iters=150 复核仅 +0.9pp(z=1.0)
> ——**增益随对弈变强而缩小**(强搜索改变终局局面分布)，未过部署级换挡线 → 改回 opt-in/默认关闭(§9)。captain
> 同范式边际 +0.6pp(z=1.64)亦不显著。**结论：终局精确求解在本架构/算力下非部署强度的确定增益**；唯一更大的未开发
> 方向是"贵族/扩展不盲的 value-NN 重训"(§10)。

---

## 1. 难度天梯（实现方法）

| 等级 | 名称 | 决策核心 |
|---|---|---|
| L1 | 入门 | 直觉式单步启发(缺人→Mayor、货多→Captain、钱够→Builder) |
| L2 | 进化 | Tony Mitton VBA 进化器 700+ 代的纯 DNA(50 条) |
| L3 | 普通 | + 角色奖金意识 + 下家货物卡位 |
| L4 | 困难 | + 全场卡位反制 + 软评分倾向 + depth-2 快照前瞻 |
| L5 | 专家 | **ISMCTS**(信息集决定化 + UCB1 + 启发式 rollout) 选角色 |
| L6 | 宗师 | **NN 先验制导 ISMCTS**：NN policy 先验 + PUCT(C=1.5) + 完整启发式 rollout 叶评估 选角色 |

> ⚠ **2026-06 代码审计修正**：宗师传 `truncate: 999`(game.js alphazeroPickRole)，rollout 必达终局
> → **NN 的 value 头从未参与决策**，叶评估始终是真实终局 reward。宗师强度 = policy 先验 ×
> 完整 rollout。此前文档"NN value 叶评估"的描述与代码不符；这也解释了为何历次"换更强
> value 网"的实验(§4 强价值/rank)都无效——value 头是死权重，**训练的有效杠杆只有 policy 头**。
> 反向验证：把叶评估真的换成 NN value(截断 6 步 + NN 估值)后，学习者在 sim 层 vs 3×纯
> ISMCTS@400 仅 2-5% 胜率(1920 局, 12 种子)——NN value 的精度远撑不起搜索，完整 rollout 才是地基。

L4/L5/L6 的**子决策**(选地/建造/贸易/船长/工匠)都用同一套强启发式；三档的差异**仅在选角色决策的搜索质量**上。

---

## 2. 宗师(L6) 能力地图 — 实测

`node tools/tier_winrate_top.js <N>`（1×宗师 vs 3×低档，座位轮转，alphaIters=400 /
expertIters=400，iter-bounded 可复现；方法学对齐既有 `tools/tier_winrate.js`）

| 宗师 vs 3× | 胜率(最可靠样本, 200局) | 跨样本范围(40/100/200局) | ≥60% |
|---|---|---|---|
| 专家 (L5) | **31%** | 28–42%(高方差) | ✗ |
| 困难 (L4) | **56%** | 55–63%(紧贴, 方差内) | ✗ |
| 普通 (L3) | ~80% | 79–88% | ✓ |
| 进化 (L2) | ~91% | 90–93% | ✓ |
| 入门 (L1) | ~92% | 91–93% | ✓ |

- 4 人局公平份额 = 25%。宗师对每一档的胜率与均分都 **> 公平**，即头对头是最强。
- 对 L1–L3 远超 60%；对 L4/L5(接近同强)落在 ~31–56%，对 L4 紧贴 60% 但方差内未稳定达成。
- **⚠ 高方差告警**：顶端档(L4/L5)对局方差极大——同一模型 vs L5 在 40/100/200 局分别得到
  30%/42%/31%。**≤40 局的天梯数字只能作趋势参考，部署级判定需 ≥200 局**(本表已用 200 局)。

---

## 3. 为什么对 L4/L5 难破 60%

1. **共用强启发式**：L4/L5/L6 的绝大多数决策走同一套手工调优的强启发式，差异只在选角色。
   所以三档强度接近，都贴着本游戏的**技巧天花板**。
2. **4 人对称局**：一个强者对三个同强者，期望胜率趋近公平 25%。把同强对手压到
   "稳定 60%" 需要碾压级优势，而非边际优势——这在对称多人局里近乎不可能。
3. **旁证**：项目原有天梯基准 `tools/tier_winrate.js` 只校验**相邻**档位
   ([2,1]/[3,2]/[4,3]) 的 ≥60%，从不测 [5,4] 或 [6,5]——因为顶端相邻档太接近，本就到不了 60%。

---

## 4. AlphaZero 全决策探索结论

为追求"更强模型架构"，实现了完整的全决策 Gumbel AlphaZero(因子化决策 + 统一动作编码
+ value 向量 ResNet + Gumbel/sequential-halving 搜索，见 `sim_az.js`/`train/`/`tools/selfplay_az.js`)。
结论是**它在本游戏触及"持平天花板"，无法稳定胜过强启发式**：

| 实验(AZ, role+build 搜索, 128 sims, 24 局 vs 启发式) | 胜率 | 均分 |
|---|---|---|
| 默认 AZ-NN value | 25.0% | 21.4 / 21.7 |
| 换强价值(已部署 55% value-NN 当叶评估) | 25.0% | 21.5 / 21.6 |

- **价值信号不是瓶颈**：把已验证强的 55% value-NN 接入搜索叶评估，结果与默认一字不差。
- **自对弈训练反而退化**：干净的 concentrate gen-1(103k 样本、无崩溃)训练后掉到
  20.8% vs 启发式、0% vs L5——低于其 25% 的 seed。缺锚定的自对弈让模型变差，而非收敛提升。
- **三重确认**：全决策 / 集中 role+build / 强价值，三种配置都收敛到持平。
  根因是结构性的——AZ 只搜部分决策，其余与对手共用同一强启发式 → 4 人对称局回归 25% 公平份额。
- **推论**：搜索建造决策会收敛到启发式自身的选择，说明**启发式建造已近最优**。

> 启示：在"AI 与对手共用同一强启发式"的对称多人局里，AlphaZero 式自对弈难以超越该启发式；
> 真正的增益来自**让启发式本身更强**(已做：估终局特殊 VP、Factory 非线性、combo 感知)，
> 而非从零自对弈。

---

## 5. 迷你联赛(多样化对手池)自对弈 — 负结果

研究背书的反停滞方向(PSRO / league training / population-based self-play): 既有
`selfplay_dump.js` 让 4 座位全是同质 NN-ISMCTS → 策略单一陷局部最优。`selfplay_league.js`
让学习者对阵多样化对手池 {ismcts≈L5, lowsim≈L4, heur≈L3, rand弱}, 同管线(`train/train.py`)
训练候选 value 模型, 与部署 55% 模型做**同种子 200 局配对 A/B**(数据量刻意匹配 → 多样性是唯一变量)。

| vs 3× (200局) | 候选 league | 现役 55% |
|---|---|---|
| 专家 L5 | 28.2% | 31.2% |
| 困难 L4 | 58.2% | 55.7% |

- **统计上平局**(差异在 ±7% 方差内, 互有胜负) → 多样化训练**无提升**, 保留现役 55%。
- **为何无效(分布匹配)**: 真正要打赢的评测是 vs **3×强对手**; 部署模型的同质强自对弈训练分布
  恰好匹配这个"全强"评测; 而联赛池偏向较弱/多样对手, 把价值网络优化到了**另一个对手分布**上,
  在"全强"评测里反而不占优。研究的"多样性破局部最优"适用于**开放式**(对抗未知对手降低可利用性);
  本目标狭窄已知(打赢强档), 同质强自对弈已近最优。
- 这是继 AlphaZero / 强价值之后**第三个被排除的方向**——共同指向同一结论: 本游戏在此算力下,
  增益来自更强的启发式, 而非更花哨的自对弈/网络。

---

## 6. 同种子配对评测(复式赛制) — 新方法学标准

§2 的高方差告警有了根治方案：`tools/eval_paired_*` 把 `Math.random` 换成按局重置种子的
PRNG → 波多黎各唯一的环境随机性(种植园牌堆/governor)在 A/B 两配置间完全一致，配对差分
消掉"牌运"方差。**480 局配对的 SE ≈ ±2.7pp**(独立评测同精度需 ~2000 局)；已验证逐位确定性
(同参数两次运行结果一致)。今后部署判定一律用本工具，胜率配对差 z>1.96 才换。

```bash
bash tools/eval_paired_run.sh <名字> <NN路径|DEPLOY> 5 480 8 [seedBase] [alphaC] [endBoost]
node tools/paired_report.js data/paired/<A>-lo5.jsonl data/paired/<B>-lo5.jsonl
```

**基线(480 局配对)：现役网 vs 3×L5 = 35.4%**。

---

## 7. 2026-06 提升宗师战役 — 全部杠杆的配对实测

| 杠杆 | 配置 | vs 现役配对差 | z | 判定 |
|---|---|---|---|---|
| 重训 policy(BR 数据) | sp-br 67k + vv 79k | **−3.9pp** | −1.40 | 不显著(趋差) |
| 重训 policy(BR+全存量) | +league+v5+v4 (417k) | **−6.0pp** | −2.13 | 显著更差 |
| 重训 policy(纯存量合并) | vv+league+v5+v4 (350k) | **−10.2pp** | −3.87 | 显著更差 |
| PUCT 常数 | C=1.0 / 2.0 / 2.5 | −0.9 / −3.0 / −4.8pp | ≤1.75 | C=1.5 已是甜点 |
| 终局增压 | 收官决策 iters×2 | +0.2pp(分差+0.27, z=1.9) | 0.30 | 不显著, 留钩子未启用 |
| **L6 私有启发式调优** | (1+1)-ES 16 候选 × 240 局, 调选地/建造 14 个常数 | 最优 **+0.8pp** | 0.46 | 16/16 全拒, σ 收敛回默认 |

**结论：现役配置守擂成功。** 四条重要负结果：
1. **旧数据掺得越多 policy 头越差**(−3.9→−6.0→−10.2pp 单调)。val_loss/acc 提升只是拟合了
   自己的分布；现役网的 79k 自洽数据(weights-vv)就是目前最好的 policy 来源。"更多数据
   治过拟合"对 value 头成立、对 policy 头**反向**。
2. **最佳响应(BR)数据也无增益**：1×NN宗师 vs 3×纯ISMCTS@400 的评测分布数据(67k, 
   `tools/selfplay_br.js`)训出的 policy 不优于自洽自对弈。注意 br 候选**均分更高(+1.4)
   但胜率更低**——它学会刷分、没学会抢第一(只有配对评测能暴露这点)。
3. **搜索超参已在最优**：C 扫描单峰、1.5 即峰值；终局加倍预算只磨分差不翻胜负。
4. **打破共用启发式也没用**：把选地/建造的 14 个手调常数提取成 L6 私有参数(`window._l6Heur`,
   仅 `_aiLevel===6` 生效, L4/L5 零影响)，跑 (1+1)-ES 自动调优。16 个候选无一显著胜出，
   σ 从 0.25 自适应收缩到 0.08 → 收敛回默认值。**这些手调常数对 L6 也已是局部最优。**
   这条结果尤其关键：它把"打破共用启发式"这个原本被寄予希望的方向也证伪了——至少对
   *子决策打分常数*这一层是如此。(注: 240 局 SE≈±2pp, 本搜索只能检出 >4pp 改进; 不排除存在
   ≤3pp 的微小增益, 但与前面所有方向一致地平, 先验极低。)

与 §4/§5 合并后的全景：AlphaZero 自对弈、强价值、联赛多样性、BR 重训、超参扫描、**L6 私有
启发式调优六条路全部排除**(连同更早的探索共八条)。在"L4/L5/L6 共用子决策启发式"的架构下，
宗师对 L5 的 ~35% 已贴近该架构天花板。剩余**未被证伪**的方向是一个量级更大的工程：
**终局精确求解器**(收官决策树小, 可穷举 maxⁿ 绕开所有启发式) —— 见 §9, **已验证有正收益**。

附带产出：`sim_nn.js` 载入后释放嵌套权重(每进程省 ~100MB)；`window._alphaC`/
`window._alphaEndBoost`/`window._l6Heur` 调参钩子；`tools/opt_l6heur.js`(断点续跑 ES 调优器)、
`tools/fallback_probe.js`(验证评测局搜索真实性)。

---

## 9. 终局精确求解器 — 战役首个正收益(sim 层已证)

八条负结果后唯一未证伪的方向。先用 `tools/endgame_probe.js` 实测可行性(**此前预判"不可行"被推翻**)：

| endTriggered 后(178/200 局测到) | 中位 | 范围 |
|---|---|---|
| 剩余决策数 | 6 | 1–14 |
| 剩余角色阶段 | 3 | 1–3 |
| 树大小 Σlog10(分支) | **10^4.1** | 10^?–10^7.8 |

→ 中位 ~10⁴ 节点, **完整 maxⁿ 精确求解可行**(最坏 10^7.8 用节点 cap 回退启发式)。

`sim_solve.js`(additive, 不改已验证的 sim.js)用因子化层 `azDecision/azApply/clone` 走树到终局,
maxⁿ 回溯(每决策点 chooser 选自己终局 VP 最大)。gate: `endTriggered` + cap 1.5e5(miss 回退启发式)。

**sim 层配对验证**(`tools/eval_solver_sim.js`, 400 局, 座位 s「启发式+终局精确」vs 同座位纯启发式, 同种子)：

| | 座位胜率 | 配对差 | z |
|---|---|---|---|
| TEST(终局精确) vs CTRL(纯启发式) | 28.7% vs 27.0% | **+1.7pp ± 0.6** | **2.73 ✅显著** |

**这是整个战役第一个统计显著的正收益** —— 证明终局启发式确实留有 VP, 精确求解能拿回。
求解器仅 ~1.1 次/局(只在 endTrigger 后触发), 成本低。

分歧诊断(`tools/solver_disagree.js`, 哪种子决策最该被精确替换)：
`build` 74%(587 决策) > `craftbonus` 62% > `captain` 55% > `role` 46%(694 决策) > `trade` 30%。
→ 终局**建造**启发式最常次优, 其次角色。budgetMiss 29%(cap 1.5e5 解不动 1/3 局, 提 cap 可救但更慢)。

**真实评测结果(role-only 接入)**：把求解器接入 L6 **角色决策**(`window._l6Solver`, game.js
alphazeroPickRole, endTriggered 时用精确最优角色), 真实 vs 3×L5 480 局同种子配对：

| | 胜率 | 配对差 | z | 结果不同局数 |
|---|---|---|---|---|
| 求解器ON vs 基线OFF | 35.2% vs 35.4% | **−0.2pp** | −0.71 | **仅 6/480** |

→ **role-only 接入无增益, 维持默认关闭**。只有 6 局结果改变, 因为(1)endTriggered 后 L6 只剩
~2-3 个角色决策且常被逼着选, (2)sim 层的 +1.7pp 来自控制一个座位**全部终局子决策**(build 分歧 74%),
而 role 决策分歧只 46% 且很少翻盘。**价值在子决策(build/captain), 不在 role。**

**build 子决策接入 — 弱强度下显著、强强度下缩小(保持默认关闭)**：把求解器接入 L6 终局**建造**决策
(`game.js solverPickBuilding`)。在 build 决策点用 `buildSimState(G)` + 重建 builder 因子化游标
(`az={phase:"builder",chooser,ord,oi}`) → `solveEndgame` → 映射回 game.js 建筑选项。安全闸: 重建可建集合
须与 `doBuilder` 逐 id 一致否则回退启发式; 仅基础局; 超预算(cap 2e6)回退。

1×L6 vs 3×L5 同种子配对(`tools/eval_solverbuild.js`):

| iters | 局数 | 座位胜率 ON vs OFF | 配对差 | z | 求解触发 |
|---|---|---|---|---|---|
| 40  | 350 | 59.6% vs 56.3% | **+3.3pp ± 0.9** | **3.75 ✅** | 0.43/局 |
| 150 | 110 | 43.2% vs 42.3% | +0.9pp ± 0.9 | 1.00 ✗ | 0.27/局 |

- **关键教训(自我证伪)**：起初据"机制与 iters 无关(L5/L6 搜索只选角色, build 走同一启发式)"在 iters=40 的
  强结果上默认开启; 但 iters=150 复核**证伪了该论证**——更强的角色搜索改变了**终局局面分布**, 求解器触发率
  0.43→0.27/局、每次修正也更小, 增益缩到 +0.9pp(不显著)。即"启发式不变 ≠ 增益不变", 因为启发式被应用的状态变了。
- 部署级证据未过 z>1.96 → **改回默认关闭**(`window._l6SolverBuild` opt-in; cap `_l6SolverBuildCap` 默认 2e6)。
  能力与工具链保留; 日后若做 properly-powered 高-iters(≥150, ≥400 局)测试过线再考虑开启。
  build 仍是最高分歧子决策、弱强度下唯一显著者——但**不是部署强度下的确定增益**。

**captain 子决策接入 — 已实现, 边际增益不显著(保持默认关闭)**: 同范式接入 captain(`game.js solverPickCaptain`,
从 `doCaptain` 循环态重建 captain 游标 `{phase,chooser,ord,oi,progressed,chooserBonusUsed}`; 关键洞察: 精确
maxⁿ 求解**不需要** `cphase`——它只供启发式 `rankCaptain`)。已验证 sim `captainCands` 与 `doCaptain` 候选逐口径
一致(one-good-per-ship / load-maximum / wharf)。在 build-solver(评测时两臂均强制开启)之上的**边际**同种子配对 A/B
(`tools/eval_solvercaptain.js`, 350 局, 1×L6 vs 3×L5):

| | 座位胜率 | 配对差 | z |
|---|---|---|---|
| build+captain vs build-only | 60.2% vs 59.6% | **+0.6pp ± 0.3** | **1.64 ✗不显著** |

- captain 求解 ~0.43 次/局、重建与候选校验正常; 趋势小正(+0.6pp/+0.16 分)但**未过 z>1.96**。
- **解读**: build-solver 已捕获终局**主要**红利(+3.3pp), captain 在其上的边际很小——与"build 分歧 74% ≫ captain 55%"
  的诊断一致。保持 **默认关闭**(`window._l6SolverCaptain` opt-in); 不做 run-until-significant(违背 §6 预设样本量原则)。

**仍未尽**: settle 子决策(分歧更低, 预期增益更小), 以及一个量级更大的方向——重训对贵族/扩展不盲的 NN(§10)。
工具链(`sim_solve.js`/`tools/eval_solver_sim.js`/`tools/eval_solverbuild.js`/`tools/eval_solvercaptain.js`/`tools/solver_disagree.js`)已就位。

---

## 8. 复现

```bash
# 宗师 vs 各低档天梯(最强档能力地图; 顶端档高方差, 用 ≥200 局)
node tools/tier_winrate_top.js 200 5,4       # 部署模型 vs L5/L4(可靠)
node tools/tier_winrate_top.js 200 5,4 mcts_value_nn_league.json  # A/B 候选(需先训练导出)

# 迷你联赛数据生成 + 训练候选(负结果复现)
node tools/selfplay_league.js 2400 80 data/selfplay-league.jsonl mcts_value_nn.json
# (cd train && python train.py ../data/selfplay-league.jsonl --epochs 30 --batch 256 --out exports/weights-league.pt && python export_weights.py exports/weights-league.pt ../mcts_value_nn_league.json)

# 宗师 vs 各低档天梯(快速趋势参考, 注意 ≤40 局方差大)
node tools/tier_winrate_top.js 40            # 全部: vs L5..L1

# 相邻档位天梯(项目原有 ≥60% 校验)
node tools/tier_winrate.js 60

# AlphaZero 搜索 vs NPC（持平天花板复现）
node tools/eval_az.js     24 heuristic mcts_value_az.json 128 role,build   # 默认 AZ value
node tools/eval_az_sv.js  24 heuristic mcts_value_az.json 128 role,build   # 换 55% 强价值
```

---

## 10. 扩展局 AI 状态（2026-06）

此前 AI(L1–L6)只在**基础游戏**调优/训练。加入扩展后做了诊断+修复。

**诊断（三层）：**
- `sim.js`(L5/L6 角色搜索引擎)：**建模 New Buildings(24-37)** 效果，但**完全不建模贵族机制(38-45)**（0 处引用，buildSimState 也不传贵族状态）。
- value 网特征：仅 23 基础建筑（对所有扩展建筑盲）。但 L6 用完整 rollout，value 头本就是死权重（§1），故此盲区影响小。
- `evalBuildingValue`(买不买)：有 24-35(New Buildings) case，**缺 38-45(贵族)** → AI 只按建筑印刷 VP 买贵族建筑，不识其效果。

**实测天梯崩坏**（`tools/exp_ladder.js`，每组 40 局，公平 25%）：
| | 修复前 | 修复后 |
|---|---|---|
| nobles L6 vs 3×L4 | 23.8%(勉强) | **37.5%(碾压✓)** |
| nobles L5 vs 3×L4 | 17.5%(L5<L4!) | 21.3% |
| newbuildings sim | **每船长阶段崩溃**→L5/L6 退化启发式 | 崩溃 0，MCTS 恢复 |

**修复：**
1. `sim.js rankCaptain`：小码头(`smallwharf`)候选未特判 → `ships['smallwharf']` undefined 崩溃。加 `|| c.ship==='smallwharf'`。
2. `evalBuildingValue`：加贵族建筑 38-44 效果估值（别墅/珠宝匠按 `nobleCount`、规划办建造折扣等）；`estLargeVioletSpecial` 加皇家花园(45)=`nobleCount`。

**3. 贵族机制移植进 sim.js（标量 nobleCount）**：上面的 evalBuildingValue 修好了"买不买"，但
`sim.js`（L5/L6 角色搜索引擎）仍对贵族盲 → L5 深搜跑在"贵族不存在"的错模型上反不如 L4。
移植了**标量 nobleCount**（不做 per-building 贵族追踪，够角色搜索用）：buildSimState 传
nobleCount/noblesLeft/noblesOnShip；sim `specialVPs` 加每贵族 +1VP + 皇家花园(45)；`doMayor`
建模贵族积累（每市长 1 贵族给选择者 + 别墅43）→ MCTS 能算"选市长→贵族→终局VP"；珠宝匠(44) 每贵族 +1金。
全部 gate 在 `expansionNobles`，非贵族局零影响（实测 none/newbuildings 不变）。

**最终天梯（nobles，90 局/组，SE≈±4.5%）：**
| | 移植前 | 移植后 |
|---|---|---|
| L5 vs 3×L4 | 21%(L5<L4) | **29.4%(L5≥L4 ✓)** |
| L6 vs 3×L4 | 37.5%* | 23.7% |
| L6 vs 3×L5 | — | 23.1% |

**结论**：移植后 L4/L5/L6 在 nobles 收敛到**近持平（都 ~24-29% vs 彼此，贴公平 25%）——与基础局
同一结构天花板**（§2/§3：顶端三档难分高下）。\*移植前 L6=37.5% 其实是**假象**：L6 深搜在"一致但
错误"的贵族盲 sim 上恰好占了便宜、而 L5 反被坑；移植后三档都正确规划→回归结构持平。L5≥L4 的目标达成，
天梯非严格单调（L1-3 < L4≈L5≈L6）。**要让 L6 在 nobles 严格碾压 L5，需贵族训练的 NN**（现役 NN
base 训练、对贵族盲，是 L6 在 nobles 不占优的根因；与 §1"value 头死权重"同源）——属大工程，未做。

New Buildings 因 sim 已建模 + 崩溃已修，L5/L6 正常。Tibs 模式 AI 用启发式（海盗为人类专属，见 TIBS_EXPANSION.md）。
鲁棒性矩阵（`tools/exp_matrix.js`，4 模式 × 6 难度）：**24/24 格全过**（无崩溃/正常结束/分数合理）。
L2(纯DNA) 经修也会在贵族/Tibs 局用扩展建筑。

## 11. 死厂修复（产业链完成奖励）— 2026-06

**友邻反馈**：AI 买蔗糖厂卡玩家、之后却不拿蔗糖田/不产糖→厂闲置（既资敌又浪费）。

**诊断**（`tools/sugar_diag.js` / `tools/goods_diag.js`，4×同档）：死厂（拥有加工厂但产能=0）是**全货问题**，不止蔗糖——
靛蓝5% / 蔗糖10% / 烟草6% / 咖啡13%。关键信号：死厂局**圣胡安散工=0.0**（工人没闲置、全放别处了），
拆解后 77%（L4）属"已半拥有该链但没补满"。**根因**：`aiReallocate`（工人分配，~1935行）贪心按边际收益放人，
但"完成一条产业链"（放这枚就立即出货）原本只值 `prodUnit`（靛蓝6/蔗糖8/烟草10/咖啡12），**低于激活被动紫建**
（港口17=12/工厂15=10/码头18=10/大市场13=8，见同函数 `violetManValue`）→ 工人紧张时先激活紫建、晾着加工厂→产能0。

**修复**（两处，均带玩家级 A/B 钩子 `_chainDone`/`_specBuyPen`，默认开）：
1. `aiReallocate`：对"立即增产"（对侧已有【有人】在等、放这枚就真出货）的放置 +`CHAIN_DONE=5`，压过紫建激活。
   **货无关**→四货一并覆盖。"仅起链"（对侧只有空位没上人）维持原值；"无对侧产能"=0。
2. `evalBuildingValue`：当前【0 块该货田】时投机买厂压价（非收入货 −10、咖啡/烟草 −3），减少"买来用不上"的卡位囤厂。

**效果**：死厂率 靛蓝5→3% / 蔗糖10→7% / 烟草6→4% / 咖啡13→2%。配对 A/B（`tools/eval_chain_ab.js`，240局L4，
同种子）：NEW vs OLD **+2.1pp**（29.9% vs 27.8%，z=0.84 不显著但**不退步**；NEW 胜率↑而均分略↓→产货转化为"赢"非"刷分"）。

**CHAIN_DONE 取值**：扫参 5/7/9 在**同种子下决策完全相同**（阈值/argmax 效应——一旦≥5 足以把蔗糖/烟草/咖啡完成
抬过被动紫建，再加大不改变任何 argmax）→ **5 即最优**（最小够用值，且不越过"靛蓝完成11<港口12"那条经验略负的线）。
蔗糖残留 7% 属**结构性**（大蔗糖厂需3田 + 蔗糖田相对稀缺 + 后期正确地让位于咖啡/强力大紫），不值得更大奖励去追。

**对抗审计**（`chain-fix-analysis` workflow，12 agent，find→对抗核验→综合）：9 条边界发现，**6 条经核验为假阳性**
（玉米兜底强制放置、大厂完成判定、两侧无人起链、多槽叠加、采石场、森林——均误读代码路径）。剩 3 条：BOUNDARY_005
（强力大紫激活值可压过完成奖励）属**设计正确取舍**（仅延迟一回合、下轮必补，非永久死厂），不改；BOUNDARY_006
（specBuyPen 二元触发）真实但**故意保留**——它减少投机囤厂正合友邻"少卡人"诉求；BOUNDARY_009（agent 判为"真 bug"：
`existingCap` 第4427行用模板 `bd2.men` 而非实例 `bb.men`）经**亲自复核为假阳性**——买决策应数"已拥有的厂容量"
（含空厂，因为你会上人），用模板正确；改成实例会导致"已有空厂却再买冗余厂"。**教训重申：agent 报 bug 必亲验**（见 §10 Aqueduct）。

**"又卡人又利己"结论**：当前无显式卡人启发式（仅解说台 flavor）；L4="全盘卡位ISMCTS"/L5/L6 经搜索**隐式**卡人且算自身收益。
正解 = **抢了就真用上**（本次修复即此机制）——纯为卡而抢用不上的东西在波多黎各几乎总亏（花钱花回合换0产出，对手绕过）。
若要给中低档（L3）加**刻意**卡位，唯一自洽低风险方案=等分 tie-break、且仅对"我有该货产能/我垄占该货"的选项加卡位权
（复用 `aiPickPlantation` 已算好的 `factCap`/`anyOpponentProduces`），从根上杜绝"卡人亏己"的死厂变种。L4+ 不动（搜索已足够）。

## 12. Phase 1 基建（2026-09）— 解堵工具链、Web Worker、WASM SIMD、参考池评测

**起因：重新审视"结构性天花板"（§3/§4/§7）。** 三条证据说明该结论证据不足：
1. 提交 503a695 记录**真人对宗师胜率约 80%**——接近技巧上限的 AI 不会被真人八成打赢；vs 3×L5 克隆的对称评测看不到这个差距。
2. 本机实测（Node 22，4 核）：现役 NN 一次前向 **1.3 ms**，比一次完整启发式 rollout 到终局（1.1–1.7 ms）还慢。§1 "NN value 叶评估仅 2–5%" 是等迭代对比，NN 叶评估版每决策 2546 ms vs 完整 rollout 版 732 ms（3.5×），价值网从未在等墙钟下被公平测试。
3. §4 的 AZ 结论来自 gen-1 自对弈 + 24 局评测（SE≈±9pp）+ 行为克隆种子网；部署网 policy 头亦为硬标签行为克隆（train.py），而非搜索分布蒸馏。"数据越多 policy 越差"是 BC 混合 off-policy 分布的已知行为。

另：搜索只覆盖选角色（约 62/180 决策），子决策对 L1–L6 是同一套启发式；§9 已测终局建造 74% 非最优。数据生成几乎免费：启发式自对弈 **330 局/秒/核**（因子化全决策 285 局/秒，180 决策/局）。

**Phase 1 交付（本节全部数字可用下方命令复现）：**

| 项 | 改动 | 实测 |
|---|---|---|
| Node 工具链解堵 | `game.js` `pagehide`/`visibilitychange` 注册加守卫；44 份复制的 vm 沙箱样板合并为 `tools/_sandbox.js`（净 −434 行），tests/ 与 tools/ 全部迁移 | 全部测试脚本恢复可运行；`eval_paired_worker` 同种子输出迁移前后逐字节一致 |
| 贵族钳制移除 | `aiPickRole` 里 `expansionNobles && lvl>=4 → 3` 是 06-11 加、06-14 移植贵族后未删 | HEAD 上 2 局 nobles 天梯仅 0.19 s（无搜索）→ §10 "移植后 L4≈L5≈L6" 实为 L3 打 L3。移除后 L4–L6 真正搜索（天梯见下） |
| 因子化层 2 人局 | `azFinishRole` 用 `picksPerRound(n)`（2p=6）而非 `numPlayers` | 2p 因子化对局每轮 6 次选角 |
| `load_data.py` | 跳过 PR #56 的 `k:"sub"`（452 维）行 | 不再断言崩溃 |
| **Web Worker 根并行 ISMCTS** | `ai_worker.js` + `game.js` `PRAIPool`：K=min(4, 核数−1) 个 worker，各自独立种子跑同预算搜索，主线程按角色合并 N/Q 后用 `PRSim.selectRootRole`（从 `ismctsPickRoleIdx` 抽出的纯函数，保持 argmax + 近平局温度采样语义）。worker 只加载 sim 系列（`_PR_STATIC` 由主线程投递），每次 pick 携带当前 BUILDINGS/成本表（扩展/平衡模式/轮抽后一致）；NN 惰性加载（L4/L5 局不下载 5 MB）。回退：`file://`、`?aiworker=0`、`window._aiNoWorker`、worker 出错/超时 → 原同步路径 | Chromium 实测（4 人全宗师，fast 档）：主线程最大卡顿 **6026 ms → 140–178 ms**；pool=3，一次宗师决策合并 **21,824** 次迭代（≈3× 单线程）。`sim_features.js` 建筑槽固定为 23 个基础 id（此前按运行时 BUILDINGS 长度，扩展局主线程/worker 特征错位） |
| **WASM SIMD 推理** | `nn_wasm/`（Rust `#![no_std]`，f32x4 kernel，另编译 scalar 版）→ `nn_wasm.js`（19 KB，内嵌两版 base64）；`sim_nn.js` 自动选 wasm-simd → wasm → js | 部署网前向 **1478 → 112 µs（13×）**；scalar 回退 303 µs；parity 最大差 1.9e-6（f32 累加）。NN 成本从 ≈1 次 rollout 变为 ≈1/10 次 rollout，Phase 2 价值网叶评估的前提成立 |
| 参考池评测 | `tools/eval_pool.js`：候选每局与 {L3,L4,L5,L6} 中 3 个混桌、座位轮转、同种子；`eval_pool_report.js`：Plackett-Luce 评分（MM）+ 200 次 bootstrap 95% CI + 逐对胜出率 | 满预算 17 s/局（单进程）；合成 3000 局校验真值 Elo(−240/−120/0/+120/0) 拟合 −253/−128/0/118/−6 |
| 配对评测样本量 | `eval_paired_run.sh` 默认 480 → **2000 局**（SE ±2.7 → ±1.3pp），参数位置不变 | — |
| 文档 | `RECORDING.md` 补 v2 子决策 schema、`DUMP_TOKEN` 必须设置（`/dump` `/stats` 现对外开放）；README 强度表述改为 §6 的 480 局配对数 | — |

**Node 工具链 bit-identity**：`PRAIPool` 在无 `Worker` 全局时不可用，`ismctsPickRoleIdx` 默认返回值/RNG 消耗顺序未变；`eval_paired_worker` 迁移前后、以及 wasm 后端下的同种子 2 局输出均逐字节一致（wasm 与 js 后端不保证跨后端 bit-exact，需要时 `root._nnForceJS=true`）。

**贵族天梯（钳制移除后，`node tools/exp_ladder.js nobles 40 "6,4;5,4;6,5"`，iter-bounded：alphaIters/expertIters=400、hardIters=60，公平 25%，40 局 SE≈±7pp，单进程 26 分钟）：**

| nobles | §10 "移植后"（实为 L3 打 L3） | 钳制移除后 |
|---|---|---|
| 1×宗师 vs 3×困难 | 23.7% | **83.8%** |
| 1×专家 vs 3×困难 | 29.4% | **80.0%** |
| 1×宗师 vs 3×专家 | 23.1% | 24.6% |

→ 贵族局的 L5/L6 此前实际是 L3 强度；搜索开启后对 L4 从持平变为 4:1 碾压。宗师 vs 专家仍持平，与基础局（§2）同一结构：两档共用子决策启发式，差异只在角色搜索。§10 "L4≈L5≈L6 收敛到近持平"的结论作废。

**复现：**
```bash
node tools/bench_nn.js                    # js vs wasm-simd µs/forward
node tests/nn_wasm_parity_test.js         # 后端 parity
node tests/worker_merge_test.js           # 根统计合并 == 单机 argmax
node tests/worker_static_sync_test.js     # 扩展/平衡模式下主线程与 worker 表/特征一致
bash tools/eval_pool_run.sh <name> 400 4  # 参考池评分（data/pool/<name>-report.md）
bash tools/build_wasm.sh                  # 重建 nn_wasm.js（需 rustup target wasm32-unknown-unknown）
```

**下一步（Phase 2）**：用启发式/L5 混合自对弈生成百万级局面，训 NNUE 尺寸小价值网（446→256→32→4，按座次向量、rank/win 目标），叶评估改 (1−λ)·V + λ·截断 rollout，**等墙钟**对比；再用因子化层把搜索扩到建造/选地/装船（§9 分歧 74% 的建造为先）。

## 13. Phase 2（2026-09）— 独立小价值网作叶评估：数据、训练、等墙钟配对评测

**动机**：宗师叶评估是完整启发式 rollout（每迭代 1655 µs）；去掉 rollout 只用 NN，每迭代降到 ~330 µs（其中两次大网前向各 ~150 µs）。一个 446→256→32→4 的小价值网在 WASM 里只要 14.5 µs。若小网能以 rollout 1/5 的成本给出不差于 rollout 的估值，同样墙钟时间就有 5× 的模拟量。

**设计要点**（与 §1 "value 头死权重"教训对应）：
- 目标尺度 = `sim.js reward()`（0.8·胜份 + 0.2·clamp((my−second)/30) ∈ [−0.2,1]），与 rollout 回报同尺度 → 可用 `rolloutFrac` 混合，不再混两种尺度。旧 `relAdv`（margin/rank/vsbest）标签不再使用。
- 训练局面 = 角色决策边界（`applyRole` 执行整个角色阶段，树中所有状态与叶都在边界上），特征 `extractRich(st, 0)`（座位 0 视角 → `valueVec[k]` = 座位 k），与 `evalLeafVecNN` 完全一致。
- 特征全在 [0,1] 且为 k/D（D≤120）→ uint8 量化无损（446 B/局面）；分片 PRV1 格式存终局分数，任何目标训练时派生。
- 独立网（`VNET`）不动 policy 先验；`_forward`/wasm `createForward` 接受 value_only 网。
- **默认关**：`window._l6ValueNet/_l6LeafTruncate/_l6RolloutFrac` 未设时所有路径逐字节不变（`eval_paired_worker DEPLOY 5 0 2` 输出与 §12 记录一致）。

**数据生成**（`tools/gen_value_data.js`，本机 4 核）：

| 集 | 阵容 | 局数 | 局面 | 耗时 |
|---|---|---|---|---|
| heur | 全启发式 + ε=0.1 随机 | 40,000 | 2,467,488 | ~2 分钟（348 局/秒/核，21k 局面/秒） |
| mix | heur 0.7 / hard@60 0.2 / expert@100 0.1 + ε=0.1 | 20,000 | （待填） | ~2 局/秒/核 |
| roll | 同 mix + 每局面 4 次 rollout 均值 | 4,000 | （待填） | — |

**训练**（`train/train_value_np.py`，仅 numpy，2 线程 ≈ 13 s/epoch @2.3M）：

| 网 | 数据 | val MSE | 备注 |
|---|---|---|---|
| 目标方差 | heur | 0.154 | 单局终局回报的固有噪声上界 |
| 446-256-32-4 | heur 2.3M | **0.111** | 早停于 epoch 2；校准表各桶预测/实际均值差 <0.03；按回合 MSE：0–4 回合 0.150 → 16+ 回合 0.055 |
| 446-128-64-4 | heur 2.3M | （待填） | |
| 446-256-32-4 | heur+mix | （待填） | |
| rollout 基线 | roll 验证集 | 单次 rollout→outcome（待填）/ 4 次均值→outcome（待填）| 网是否比 rollout 更准 |

**每迭代耗时与等墙钟倍率**（`tools/bench_search.js`，待在空闲 CPU 上重测）：rollout 1655 µs；大网价值头 t0 ~436 µs（×3.7）；vnet t0 ~326 µs（×5.0）；vnet t2 ~420 µs（×3.9）；vnet t0 + rolloutFrac 0.25 ~631 µs（×2.6）。剩余成本主要是扩展时的大网 policy 先验前向（~150 µs）+ 引擎（clone/applyRole）。

**配对评测**（`tools/eval_vnet_ab.sh`，同种子，1×L6 vs 3×L5，iter-bounded）：

| 臂 | 配置 | 胜率 | 配对差 vs A | z |
|---|---|---|---|---|
| A | 现役（完整 rollout，alphaIters 400） | （待填） | — | — |
| B | vnet 叶评估，等墙钟 alphaIters = 400×倍率 | （待填） | （待填） | （待填） |
| C | vnet 叶评估，同迭代 400 | （待填） | （待填） | （待填） |

**判定**：（待填）。部署规则不变：z>1.96 才切默认。

**复现**：
```bash
bash tools/gen_value_data_run.sh heur 40000 4 20261101 --mix heur:1 --eps 0.1
bash tools/gen_value_data_run.sh mix 20000 4 20260901 --mix heur:0.7,hard:0.2,expert:0.1 --eps 0.1
bash tools/gen_value_data_run.sh roll 4000 4 20261001 --mix heur:0.7,hard:0.2,expert:0.1 --eps 0.1 --rollouts 4
python3 train/train_value_np.py 'data/value/heur-*.bin' 'data/value/mix-*.bin' --arch 256,32 --out mcts_value_vnet.json
python3 train/train_value_np.py 'data/value/roll-*.bin' --eval-rollout-baseline --epochs 0
node tools/bench_search.js 300 20 mcts_value_vnet.json
bash tools/eval_vnet_ab.sh vnet1 480 4 <倍率>
node tests/vnet_parity_test.js && node tests/sim_rolloutfrac_test.js && node tests/worker_vnet_test.js && node tests/gen_value_data_test.js
```
