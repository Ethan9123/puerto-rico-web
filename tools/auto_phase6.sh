#!/usr/bin/env bash
# 一站式：等 self-play 完成 → 训练 → 导出 → 评估 L6 vs L5
# 全部输出写到 data/auto_phase6.log，不阻塞 shell
set -euo pipefail

LOG="data/auto_phase6.log"
mkdir -p data train/exports

echo "=== [auto_phase6] 开始 $(date) ===" >> "$LOG"

# 1) 等 self-play 完成（看进程 / 文件大小不再增长）
echo "[1/4] 等待 self-play (data/selfplay-v1.jsonl)..." >> "$LOG"
LAST_LINES=0
STABLE_COUNT=0
while true; do
  if [[ ! -f data/selfplay-v1.jsonl ]]; then sleep 30; continue; fi
  LINES=$(wc -l < data/selfplay-v1.jsonl)
  if [[ "$LINES" == "$LAST_LINES" ]]; then
    STABLE_COUNT=$((STABLE_COUNT + 1))
    if [[ "$STABLE_COUNT" -ge 3 ]]; then break; fi
  else
    STABLE_COUNT=0
  fi
  LAST_LINES="$LINES"
  sleep 30
done
echo "[1/4] self-play 完成: $LINES 样本" >> "$LOG"

# 2) 训练
echo "[2/4] PyTorch 训练 30 epoch..." >> "$LOG"
cd train && python train.py ../data/selfplay-v1.jsonl --epochs 30 --batch 256 --out exports/weights-v1.pt >> "../$LOG" 2>&1
cd ..
echo "[2/4] 训练完成" >> "$LOG"

# 3) 导出 JSON
echo "[3/4] 导出 JSON..." >> "$LOG"
cd train && python export_weights.py exports/weights-v1.pt exports/weights-v1.json >> "../$LOG" 2>&1
cd ..
cp train/exports/weights-v1.json mcts_value_nn.json
echo "[3/4] mcts_value_nn.json 已就绪 ($(ls -lh mcts_value_nn.json | awk '{print $5}'))" >> "$LOG"

# 4) 评估 L6 vs L5（12 局，每步 800ms ≈ 10 分钟）
echo "[4/4] L6 vs L5 评估..." >> "$LOG"
node tools/eval_l6.js 800 12 mcts_value_nn.json >> "$LOG" 2>&1

echo "=== [auto_phase6] 完成 $(date) ===" >> "$LOG"
