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

  # 1) 自对弈（gen>=2 用上代 best NN 做 PUCT 制导）
  DATA_FILE="$DATA_DIR/selfplay-v${gen}.jsonl"
  if [[ -f "$DATA_FILE" ]]; then
    echo "[gen $gen] skip self-play (data exists: $DATA_FILE)"
  else
    NN_ARG=""
    if [[ -f "mcts_value_nn.json" ]] && [[ "$gen" -gt 1 ]]; then
      echo "[gen $gen] self-play with NN guidance (mcts_value_nn.json)"
      NN_ARG="mcts_value_nn.json"
    else
      echo "[gen $gen] self-play (pure ISMCTS, no NN)"
    fi
    node tools/selfplay_dump.js "$GAMES" "$ITERS" "$DATA_FILE" 4 ${NN_ARG}
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

  # 4) 评估 NN_new vs L5 (原版 ISMCTS)：12 局 800ms/步
  # 把 NN_new 暂时挂到 mcts_value_nn.json，跑 eval，再恢复原来的 best
  echo "[gen $gen] eval NN_new vs L5 (12 games, 800ms)..."
  PREV_BEST=""
  if [[ -f "mcts_value_nn.json" ]]; then
    cp mcts_value_nn.json mcts_value_nn.json.bak
    PREV_BEST=$(readlink -f mcts_value_nn.json.bak || echo "mcts_value_nn.json.bak")
  fi
  cp "$EXPORTS/weights-v${gen}.json" mcts_value_nn.json
  WINRATE=$(node tools/eval_l6.js 800 12 "mcts_value_nn.json" 2>&1 | grep -oE 'L6 winrate: [0-9.]+%' | grep -oE '[0-9.]+' | head -1)
  WINRATE=${WINRATE:-0}
  echo "[gen $gen] NN_new winrate vs L5: ${WINRATE}%"
  # 决策：胜率 ≥ 30% 即视为不弱于 L5（公平线 25%），≥ 40% 强于 L5
  PROMOTE=$(awk "BEGIN {print (${WINRATE} >= 30) ? 1 : 0}")
  if [[ "$PROMOTE" == "1" ]]; then
    echo "[gen $gen] PROMOTE → new best: weights-v${gen}.json (winrate ${WINRATE}%)"
    echo "weights-v${gen}.json" > "$EXPORTS/best.txt"
    rm -f mcts_value_nn.json.bak
  else
    echo "[gen $gen] REJECT (winrate ${WINRATE}% < 30%), keep previous best"
    if [[ -n "$PREV_BEST" ]] && [[ -f "mcts_value_nn.json.bak" ]]; then
      mv mcts_value_nn.json.bak mcts_value_nn.json
    fi
  fi
done

echo ""
echo "Done. Latest best: $(cat $EXPORTS/best.txt 2>/dev/null || echo none)"
echo "mcts_value_nn.json 已就绪可在游戏中使用 (选 L6 宗师)"
