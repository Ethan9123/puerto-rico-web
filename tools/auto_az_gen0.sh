#!/usr/bin/env bash
set -euo pipefail
LOG="data/az_gen0.log"
echo "=== az gen0 train $(date) ===" > "$LOG"
cd train
python train_az.py ../data/az-gen0.jsonl --epochs 25 --batch 512 --out exports/az-gen0.pt >> "../$LOG" 2>&1
python export_az.py exports/az-gen0.pt ../mcts_value_az.json >> "../$LOG" 2>&1
cd ..
echo "=== az gen0 done $(date) ===" >> "$LOG"
