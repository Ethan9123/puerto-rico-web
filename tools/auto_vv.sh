#!/usr/bin/env bash
# 一站式 value-向量实验：等 selfplay-vv → 训练 → 导出 → eval vs L5
set -euo pipefail
LOG="data/auto_vv.log"
echo "=== [auto_vv] 开始 $(date) ===" >> "$LOG"

# 1) 等 self-play (selfplay-vv.jsonl 行数稳定)
echo "[1/4] 等待 self-play..." >> "$LOG"
LAST=0; STABLE=0
while true; do
  if [[ ! -f data/selfplay-vv.jsonl ]]; then sleep 30; continue; fi
  N=$(wc -l < data/selfplay-vv.jsonl)
  if [[ "$N" == "$LAST" ]] && [[ "$N" -gt 1000 ]]; then
    STABLE=$((STABLE+1)); [[ "$STABLE" -ge 3 ]] && break
  else STABLE=0; fi
  LAST="$N"; sleep 30
done
echo "[1/4] self-play 完成: $N 样本" >> "$LOG"

# 2) 训练（仅用新 vv 数据：老数据无 vv，混入会把辅助 value 头拉向 0）
echo "[2/4] 训练 value 向量模型 (仅 vv 数据)..." >> "$LOG"
cd train && python train.py ../data/selfplay-vv.jsonl --epochs 50 --batch 256 --lr 5e-4 --out exports/weights-vv.pt >> "../$LOG" 2>&1
cd ..
echo "[2/4] 训练完成" >> "$LOG"

# 3) 导出 + 部署
echo "[3/4] 导出..." >> "$LOG"
cd train && python export_weights.py exports/weights-vv.pt exports/weights-vv.json >> "../$LOG" 2>&1
cd ..
cp train/exports/weights-vv.json mcts_value_nn.json
echo "[3/4] mcts_value_nn.json 已更新 (value 向量模型)" >> "$LOG"

# 4) eval vs L5 (20 局, hybrid full-rollout)
echo "[4/4] eval L6(value-vec) vs L5..." >> "$LOG"
node tools/eval_l6.js 800 20 mcts_value_nn.json >> "$LOG" 2>&1
echo "=== [auto_vv] 完成 $(date) ===" >> "$LOG"
