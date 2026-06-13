# Tibs 自制扩展（同人）

来源：你订阅的 Tabletop Simulator workshop mod **"Puerto Rico (Tibs Edition)"**。
规则**取自 mod 自带的笔记本(TabStates)+每张卡的 Description**（Tibs 本人撰写，权威），不是卡面缩写的猜测。
原始规则全文存 `docs_tibs_rules_raw.txt`。

**启用方式**：开局设置 → 扩展 → 选「＋Tibs 自制扩展」。它是官方扩展的超集（基础 + 新建筑 + 贵族 + Tibs 8 建筑 + 节庆）。
海盗角色另有独立勾选框。

> ⚠️ 默认关闭，且**不参与 AI 训练/评测**（`expansionTibs` 标志），不影响已调好的宗师 AI 与 `sim.js`。

## 8 个建筑（id 46–53，权威规则）

| 卡 | 造价/VP/工人 | 阶段 | 效果 |
|---|---|---|---|
| 金矿 Gold Mine | 1 / 1 / **2** | 工匠 | 满员(2人)时可把两名殖民者移回岸边 + 拿 1 金（仅 1 人时无效） |
| 水井 Well | 3 / 1 / 1 | 工匠 | 若你产了玉米或靛蓝，可多产 1 个（两者择一） |
| 寄宿屋 Boarding House | 4 / 2 / 1 | 拓殖 | =Tibs 改名的济贫院：拿到的明牌种植园/**采石场**自带 1 殖民者 |
| 塔楼 Tower | 4 / 2 / 1 | 被动 | **别人选的每个角色，你也获得其特权**（你当总督时除外）。已实装跨建造/市长/工匠/船长/金矿主 5 个特权 |
| 海关站 Customs Station | 8 / 3 / 1 | 船长 | 选船长 +1 VP；阶段末每艘满货船清空时，你各得回 1 个该船货（不腐坏） |
| 档案馆 Archive | 8 / 3 / 1 | 船长 | 阶段末每种货各留 1 桶，并立即按保留的货种数 +1 VP/种 |
| 银行 Bank | 8 / 4 / 1 | 投资 | 建造时可投入 ≤8 枚未花金币（锁定）；终局每枚投资 +1 VP |
| 大教堂 Cathedral（大紫） | 10 / 4 / 1 | 终局 | 每个【其他玩家】拥有的大型建筑 +2 VP。占 2 格 |

每张都做了 6 处接入（目录/阶段效果/终局计分/AI 买不买/AI 派工人/说明文案）+ 卡面 art。

## 模块

| 模块 | 状态 | 说明 |
|---|---|---|
| **节庆 Festival** | ✅ 已实装（随 tibs 启用） | 3 个竞速目标：①种 3×随机货种→首位+3 殖民者 ②一回合同产 3 种随机货→首位+3 金 ③建造随机第 3 列建筑→首位+3 VP。每阶段末结算。 |
| **海盗 Buccaneer** | ✅ 已实装（独立勾选） | 第 8 个角色，4 行动：劫掠(清空货船留 3)/洗劫(清贸易站+VP)/突袭(殖民者堆减到每人 1 留 3)/劫持(占无人角色拿金币并执行)。**仅人类可选**——AI 跳过、`buildSimState` 过滤掉它，所以**不冲击 7 角色 AI/值网**。奖励币机制(持币者不可再选)、不累积金币。 |
| **工人 Workers** | ⏸ 暂缓 | mod 里这是"jobs strip"机制（殖民者沿条带下移、按格给小奖励），但**每格的具体奖励在可提取的素材里没有**（规则文本对象未导出、Recruitment Office 板图无可读奖励）。要实装需你提供每格奖励表，或我按合理设计补（非原汁）。 |

## 关于"官方 vs 同人"

mod 笔记本澄清：很多"Tibs 建筑"其实是**官方建筑改了名**（Hospice→Boarding House、Office→Commercial Office、Commercial Harbor→Customs Station、Gardens→Royal Garden…）。
Buccaneer 是 **Puerto Rico 2020 第 3 扩展**（半官方，行动与卡面一致）。Festival 是 2019 promo 卡的非官方英译。
Gold Mine / Well / Tower / Bank / Archive / Cathedral 是 Tibs 自制（取自他的 BGG filepage）。

## 卡面美术

全部 53 个建筑统一为 Tibs Edition 插画风格（蓝=生产，黄=紫色功能），素材取自你本地 TTS 缓存。

## 复现工具（`tools/`）

`tts_inventory.js` / `tts_artmap.js`（清点+映射）、`tts_dump_text.js`（挖 mod 内嵌规则）、`tts_swap_all_art.js` / `tts_copy_tibs46.js`（换图/复制）、`tibs_smoke.js`（Tibs 局冒烟测试）。
