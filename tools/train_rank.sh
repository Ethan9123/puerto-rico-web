#!/usr/bin/env bash
# ============================================================
# train_rank.sh — 用 rank（抢第一）目标重训宗师 value-NN 的全流水线
# ============================================================
# 阶段：并行自对弈 → 合并 → GPU 训练 → 导出 → 初步 A/B 评测
# 用法： bash tools/train_rank.sh
# 产物： mcts_value_nn_rank.json（候选网，A/B 赢了再替换 mcts_value_nn.json 部署）
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
TS() { date +"%H:%M:%S"; }

NPROC=12           # 并行 selfplay 进程数（12/24 核，留一半给你）
PERPROC=250        # 每进程局数 → 12*250 = 3000 局
ITERS=48           # 每决策 ISMCTS 迭代数（纯 ISMCTS，无 NN 引导 → 快 ~70x）
MERGED="data/sp-rank.jsonl"

mkdir -p data logs train/exports

echo "[$(TS)] ===== PHASE 1: 并行自对弈  procs=$NPROC  games/proc=$PERPROC  iters=$ITERS  纯ISMCTS  VALUE_MODE=rank ====="
pids=()
for i in $(seq 0 $((NPROC-1))); do
  VALUE_MODE=rank node tools/selfplay_dump.js "$PERPROC" "$ITERS" "data/sp-rank-p$i.jsonl" 4 > "logs/sp-rank-p$i.log" 2>&1 &
  pids+=($!)
done
echo "[$(TS)] 已启动 ${#pids[@]} 个 worker (pids: ${pids[*]})；进度见 logs/sp-rank-p*.log"
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if [ "$fail" != "0" ]; then echo "[$(TS)] ERROR: 有 worker 失败，见 logs/sp-rank-p*.log"; exit 1; fi

echo "[$(TS)] ===== PHASE 1 完成，合并数据 ====="
cat data/sp-rank-p*.jsonl > "$MERGED"
SAMPLES=$(wc -l < "$MERGED" | tr -d ' ')
echo "[$(TS)] 合并 $SAMPLES 样本 -> $MERGED ($(du -h "$MERGED" | cut -f1))"
rm -f data/sp-rank-p*.jsonl

echo "[$(TS)] ===== PHASE 2: GPU 训练 (30 epochs) ====="
( cd train && python train.py "../$MERGED" --epochs 30 --batch 256 --out exports/weights-rank.pt --device cuda ) || { echo "[$(TS)] 训练失败"; exit 1; }

echo "[$(TS)] ===== PHASE 3: 导出 mcts_value_nn_rank.json ====="
( cd train && python export_weights.py exports/weights-rank.pt ../mcts_value_nn_rank.json ) || { echo "[$(TS)] 导出失败"; exit 1; }

echo "[$(TS)] ===== PHASE 4: 初步评测 (30 局/趋势参考，部署判定请另跑 200 局) ====="
echo "---- 候选 rank 网 vs 3×[L5,L4] ----"
node tools/tier_winrate_top.js 30 5,4 mcts_value_nn_rank.json 2>&1 | tail -10
echo "---- baseline 现役 margin 网 vs 3×[L5,L4] ----"
node tools/tier_winrate_top.js 30 5,4 2>&1 | tail -10

echo "[$(TS)] ===== PIPELINE DONE ====="
