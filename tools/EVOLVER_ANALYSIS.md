# PuertoRicoEvolver(.xls) 溯源与 DNA 池更新分析

本仓库 L2「进化」AI 的 DNA(`ai_dna.json`)源自 Tony Mitton 的 **PuertoRicoEvolver** —— 一个用
Excel/VBA 实现的波多黎各引擎 + 遗传进化器(`Author=Tony Mitton`, 2003 作; 存在一个 2010 年的
汉化版)。本文记录从该 `.xls` 提取/比对/更新 DNA 的方法与一次实测结论, 便于日后拿到新版进化器
文件时一键复现。

## 1. DNA 编码(519 字符)

VBA `Manipulate_DNA.Save_DNA` 把每个个体存成固定切片(与 `ai_dna.js` 的注释逐位对齐):

| 段 | 长度 | 工作表列(0-indexed) |
|---|---|---|
| triggers(阶段触发器) | 12 | 0 |
| role Early/Mid/Late | 46×3 | 2,4,6 |
| manning Early/Mid/Late | 89×3 | 8,10,12 |
| building Early/Mid/Late | 25×3 | 14,16,18 |
| plantation Early/Mid/Late | 9×3 | 20,22,24 |
| Games / Score / Name(`Pos.id.Gen`) | — | 26 / 28 / 30 |

`P1..P5` 工作表 = 每个座位(位置)的进化种群(按 Score 降序)。`avg = Score / Games`。

## 2. 溯源结论

- 该文件的 `P1..P5` 池里, **仓库 `ai_dna.json` 的全部 50 条 DNA 都能逐字匹配**(仓库取了 G345–G584)。
  → 这个 `.xls` 就是仓库 L2 AI 的来源。
- 文件后续又进化到 **gen 616**(比仓库新 ~32 代), 但 **收敛/同质化**了: 少数血脉(`P2.779`、
  `P1.1743`)经迁移占据多个位置池, 60 个槽位只剩 ~36 条不同基因。

## 3. 实测: 更晚的代能让 L2 更强吗?

全部用 `tools/ab_dna.js`(位置对齐, 座位轮转)在本仓库引擎里实战对照(L2 vs L2):

- **整族替换会变弱**: 用文件 gen616 池整体替换仓库池, NEW 组胜率掉到 **39%**(公平 50%)、
  人均 **−3 VP**。原因是丢了仓库里位置专精的 P1/P3/P4 基因(尤其 `P4.1853` 强很多)。
- **定向挖掘发现一个真改进(P2)**: 用 `tools/mine`(见 git 历史)对固定的仓库 L2 基准逐基因评测,
  只有 **P2** 有料 —— 文件 P2 池里迁移来的 `P1.1743` 血脉, 在 seat P2 对固定对手:

  | seat P2(vs 固定 OLD 对手, 400 局) | mean VP | 胜率(公平 25%) |
  |---|---|---|
  | 文件 `P1.1743.G482` | **37.80** | **39.8%** |
  | 仓库 best `P2.779.G558` | 32.62 | 18.0% |

  仓库 P2 本是短板(18% < 25%)。换上后 **+5.18 VP / +21.8pp**。

- **净效果(只换 P2, 1200 局)**: seat P2 **Δ +3.54 VP**; P1/P3/P4 **Δ≈0**(无回归);
  整局胜率 51.3%(±2.8, 整局层面不显著, 因只动 1/5 个位置)。
  → **严格安全的小改进**: 补强最弱的 P2, 别处不退步。

## 4. 已落地的改动

`ai_dna.json` / `ai_dna_data.js` 的 **P2 top-5** 换成上面 5 条 `P1.1743` 基因(原仓库 P2 保留在
其后, 仅作存档; 实际对局只用每个位置的 top-5)。这些条目的 `avg` 字段记的是 **对仓库 L2 基准实测的
人均 VP**(`src` 字段标注血脉来源), 比进化器内部噪声 avg 更有意义。P1/P3/P4/P5 未改。

## 5. 复现

```bash
pip install xlrd
# 1) 提取并与现有池比对溯源
python tools/extract_evolver_dna.py <evolver.xls> --compare ai_dna.json
# 2) 抽一个候选池
python tools/extract_evolver_dna.py <evolver.xls> --top 12 --out /tmp/cand.json
# 3) 位置对齐 A/B(候选 vs 现有)
node tools/ab_dna.js 1200 /tmp/cand.json
```

> 结论一句话: 进化器跑更多代主要带来**收敛**而非更强; 真正的增益来自**跨位置迁移**把某条强血脉
> 送进了原本薄弱的位置池(本例 P2)。整族照搬有害, 定向择优才安全。
