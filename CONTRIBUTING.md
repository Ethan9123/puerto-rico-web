# 贡献指南 Contributing

本项目是纯静态前端（无构建、无服务器）的波多黎各 Web 版。下面是提交代码与开 PR 的约定，方便人类协作者与 AI 代理（Claude / Codex）产出风格一致、可被快速审阅的改动。

---

## 分支 Branch

- 从最新 `main` 切分支。
- 命名用 `<前缀>/<短横线描述>`，例如 `claude/...`、`codex/fix-captain-ranking`、`feat/spectator-commentary`。
- **只在自己的功能分支上开发**，不要直接推 `main`（`main` 一推送即触发 GitHub Pages 部署）。

## 提交信息 Commit message

- 首行一句话讲清「做了什么 / 为什么」（中英文均可，与本仓库保持中文为主）。
- 正文用要点列出关键改动，**精确到文件名、函数名、关键数值**。
- 用 `add`（全新功能）/ `update`（增强）/ `fix`（修 bug）区分性质。
- 不要把模型标识、密钥等写进提交信息或代码。

## Pull Request 模板

PR 描述固定三段式（沿用 Codex 在本仓库的清晰结构，中文版）：

```markdown
## 动机 / Motivation
- 为什么做这个改动（目标、要解决的问题）。

## 改动 / Description
- 改了什么，精确到 `文件名`、`函数名`、关键数值 / 代码片段。
- 每条一个要点。

## 验证 / Testing
- 跑了哪些检查、结果如何（带确切的命令与预期输出行）。
- 没跑某项时如实说明（例如「本环境无浏览器，未做视觉实测」）。
```

约定：
- **新 PR 默认开为 draft**，等作者确认后再合并 / 标 ready（自动化代理尤其遵守此项）。
- 合并 `main` 用 **merge commit**（与历史一致，提交标题如 `Merge PR #NN: ...`）。
- 描述里如实标注未覆盖的验证项，不要夸大。

## 验证 Testing

无浏览器环境下用 Node 无头桩验证（无需安装依赖）：

```bash
node --check game.js                 # 语法检查（改完任何 .js 都先跑）
node tests/scenarios.js              # AI 行为断言（建筑/派工/船长/垄断/卡位…）
node tests/node_harness.js 3 0 5     # 守恒 + 终局不变量（perConfig=3 局, mixed=0, iters=5）
node tools/tier_winrate.js 40        # 相邻档位 1 高 vs 3 低 胜率（可选，较慢）
```

合并前应满足：
- `node --check` 通过；`scenarios.js` 全 PASS。
- `node_harness.js` 报告 **invariant problems: 0**（殖民者 / 货物 / 终局守恒）。
- 未改动 AI 决策逻辑时，强度阶梯应保持单调（L6 > L5 > L4 > L3 > L2 > L1，按均分）。

## 观战 / 测试模式开关（重要约定）

观战增强（拿取动画、解说台等）**只在真人观战时启用**，无头测试 / 训练必须完全跳过：

- 真人观战全 AI 对战：`window._allAIMode === true` 且 `window._fastSpectator` 不为真。
- 无头测试 / 训练：同时设 `window._allAIMode = true` 与 `window._fastSpectator = true`。

新增任何会拖慢或依赖 DOM 的观战逻辑时，请用 `!window._fastSpectator` 作门，并确保 `tests/` 与 `tools/` 里设置了 `_fastSpectator = true`，否则自对弈会因节奏停顿而超时。

## 离线 / 数据内嵌约定

- DNA 与宗师 NN 权重通过内嵌 `<script>`（`ai_dna_data.js` / 离线包内的 `mcts_value_nn_data.js`）加载，使双击 `index.html`（`file://`）也能离线运行；缺内嵌时回退到 `fetch`。线上保持懒加载，不增加网页首屏体积。
- 资源路径用相对路径；不要在玩家可见文件中硬编码外部 URL（解说 / 文档链接除外）。

## 代码风格

- 原生 JS / CSS / HTML，无框架、无构建步骤。
- 默认不写注释；仅当「为什么」不显而易见（隐藏约束、坑、反直觉行为）时才加一行简短说明。
- 不为不可能发生的情况加防御代码；只在系统边界（用户输入、外部数据）做校验。
