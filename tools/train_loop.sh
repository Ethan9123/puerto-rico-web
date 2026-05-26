#!/usr/bin/env bash
# AlphaZero 训练主循环 —— iterative self-play + train + evaluate + promote
#
# 用法：
#   bash tools/train_loop.sh [GENERATIONS] [GAMES_PER_GEN] [MCTS_ITERS]
# 例：
#   bash tools/train_loop.sh 5 2000 80
#
# 流程（每代）：
#   1. 用当前 best NN（如果有）+ ISMCTS 跑 GAMES_PER_GEN 局自对弈
#   2. 训练 NN（最近 3 代数据合并）30 epoch
#   3. 导出 JSON 权重
#   4. （TODO）跑评估对决 NN_new vs NN_best
#   5. 如果 NN_new 胜率 > 55% → 提升为新 best
#
# 状态文件：train/state.json 记录 best_version + 历史

set -euo pipefail

GENS=${1:-5}
GAMES=${2:-2000}
ITERS=${3:-80}
DATA_DIR="data"
EXPORTS="train/exports"

mkdir -p "$DATA_DIR" "$EXPORTS"

echo "=========================================="
echo " AlphaZero 训练循环"
echo " 代数        : $GENS"
echo " 每代局数    : $GAMES"
echo " MCTS 迭代   : $ITERS"
echo "=========================================="

START_GEN=1
if [[ -f "$EXPORTS/best.txt" ]]; then
  LAST_BEST=$(cat "$EXPORTS/best.txt")
  echo "[resume] 上次 best: $LAST_BEST"
  START_GEN=$(echo "$LAST_BEST" | grep -oE '[0-9]+' | head -1)
  START_GEN=$((START_GEN + 1))
fi

for ((gen = START_GEN; gen < START_GEN + GENS; gen++)); do
  echo ""
  echo "============================================================"
  echo " Generation $gen"
  echo "============================================================"

  # 1) 自对弈
  DATA_FILE="$DATA_DIR/selfplay-v${gen}.jsonl"
  if [[ -f "$DATA_FILE" ]]; then
    echo "[gen $gen] skip self-play (data exists: $DATA_FILE)"
  else
    echo "[gen $gen] self-play → $DATA_FILE"
    node tools/selfplay_dump.js "$GAMES" "$ITERS" "$DATA_FILE" 4
  fi

  # 2) 训练（合并最近 3 代数据）
  LATEST_PT="$EXPORTS/weights-v${gen}.pt"
  LATEST_JSON="$EXPORTS/weights-v${gen}.json"
  DATA_FILES=()
  for ((k = gen; k > gen - 3 && k > 0; k--)); do
    [[ -f "$DATA_DIR/selfplay-v${k}.jsonl" ]] && DATA_FILES+=("$DATA_DIR/selfplay-v${k}.jsonl")
  done
  echo "[gen $gen] train on: ${DATA_FILES[*]}"
  ( cd train && python train.py "${DATA_FILES[@]/#/../}" --epochs 30 --batch 256 --out "exports/weights-v${gen}.pt" )

  # 3) 导出 JSON
  ( cd train && python export_weights.py "exports/weights-v${gen}.pt" "exports/weights-v${gen}.json" )

  # 4) 评估 vs best（TODO：用 tests/l6_test.js 改造为 NN_new vs NN_best）
  # 暂时简化：直接提升为 best（不评估），用户可手动复制 weights-v{N}.json → mcts_value_nn.json
  echo "[gen $gen] (评估暂未实现) 自动提升为 best"
  echo "weights-v${gen}.json" > "$EXPORTS/best.txt"
done

echo ""
echo "Done. Latest best: $(cat $EXPORTS/best.txt)"
echo "把 $EXPORTS/$(cat $EXPORTS/best.txt) 复制到 mcts_value_nn.json 来在游戏中使用"
