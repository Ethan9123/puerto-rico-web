#!/usr/bin/env bash
# ============================================================
# tools/auto_az_conc.sh — 集中搜索(role+build) AlphaZero 迭代
# ============================================================
# 关键: 自对弈崩溃必须 ABORT, 绝不能用残缺/崩溃数据训练(否则模型退化)。
# 每代: 自对弈(只在 role+build 上搜索, 集中预算) → 训练 → 导出 → eval vs 启发式 + vs L5。
# 种子 NN = mcts_value_az.json (调用前应放入干净的全决策 gen 模型)。
#
# 用法: bash tools/auto_az_conc.sh [GENS] [GAMES] [SIMS] [EVAL_SIMS]
set -uo pipefail
GENS=${1:-3}; GAMES=${2:-900}; SIMS=${3:-128}; ES=${4:-128}; TYPES="role,build"
LOG="data/az_conc.log"
MIN_SAMPLES=50000   # 干净的 900 局应 ~100k 样本; 低于此判定崩溃, ABORT

abort() { echo "[ABORT] $1" | tee -a "$LOG"; echo "=== az conc iter ABORTED $(date) ===" >> "$LOG"; exit 1; }

echo "=== az conc iter start $(date) GENS=$GENS GAMES=$GAMES SIMS=$SIMS TYPES=$TYPES ===" > "$LOG"
for ((gen=1; gen<=GENS; gen++)); do
  OUT="data/az-conc-gen${gen}.jsonl"
  echo "--- conc gen $gen self-play ($(date)) ---" >> "$LOG"
  node tools/selfplay_az.js "$GAMES" "$OUT" 4 hybrid mcts_value_az.json "$SIMS" "$TYPES" >> "$LOG" 2>&1
  rc=$?
  [[ $rc -ne 0 ]] && abort "gen $gen self-play exited rc=$rc (likely crash) — refusing to train on partial data"
  # 完整性闸: 样本行数必须够多, 否则视为崩溃残缺
  lines=$(wc -l < "$OUT" 2>/dev/null || echo 0)
  echo "  gen $gen self-play OK: $lines samples" >> "$LOG"
  [[ "$lines" -lt "$MIN_SAMPLES" ]] && abort "gen $gen only $lines samples (<$MIN_SAMPLES) — partial/crash, not training"

  DATA="../data/az-conc-gen${gen}.jsonl"
  [[ $gen -ge 2 ]] && DATA="$DATA ../data/az-conc-gen$((gen-1)).jsonl"
  echo "--- conc gen $gen train ($(date)) ---" >> "$LOG"
  ( cd train && python train_az.py $DATA --epochs 15 --batch 512 --out exports/az-conc-gen${gen}.pt >> "../$LOG" 2>&1 )
  [[ $? -ne 0 ]] && abort "gen $gen training failed"
  ( cd train && python export_az.py exports/az-conc-gen${gen}.pt ../mcts_value_az.json >> "../$LOG" 2>&1 )
  [[ $? -ne 0 ]] && abort "gen $gen export failed"

  echo "=== conc gen $gen EVAL vs heuristic ===" >> "$LOG"
  node tools/eval_az.js 24 heuristic mcts_value_az.json "$ES" "$TYPES" >> "$LOG" 2>&1
  echo "=== conc gen $gen EVAL vs L5 ===" >> "$LOG"
  node tools/eval_az.js 20 l5 mcts_value_az.json "$ES" "$TYPES" >> "$LOG" 2>&1
done
echo "=== az conc iter done $(date) ===" >> "$LOG"
