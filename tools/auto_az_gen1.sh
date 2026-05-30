#!/usr/bin/env bash
set -uo pipefail
LOG="data/az_gen1.log"
echo "=== az gen1 (hybrid: NN策略+rollout价值) start $(date) ===" > "$LOG"
# 1) gen1 自对弈: hybrid 强引导
node tools/selfplay_az.js 800 data/az-gen1.jsonl 4 hybrid mcts_value_az.json 32 >> "$LOG" 2>&1
echo "--- gen1 self-play done $(date) ---" >> "$LOG"
# 2) 训练(gen1 + gen0 锚定) 18 epoch
cd train
python train_az.py ../data/az-gen1.jsonl ../data/az-gen0.jsonl --epochs 18 --batch 512 --out exports/az-gen1.pt >> "../$LOG" 2>&1
python export_az.py exports/az-gen1.pt ../mcts_value_az.json >> "../$LOG" 2>&1
cd ..
echo "--- gen1 train+export done $(date) ---" >> "$LOG"
# 3) eval vs heuristic + vs L5
echo "=== eval gen1 vs heuristic ===" >> "$LOG"
node tools/eval_az.js 24 heuristic mcts_value_az.json 64 >> "$LOG" 2>&1
echo "=== eval gen1 vs L5 ===" >> "$LOG"
node tools/eval_az.js 20 l5 mcts_value_az.json 64 >> "$LOG" 2>&1
echo "=== az gen1 done $(date) ===" >> "$LOG"
