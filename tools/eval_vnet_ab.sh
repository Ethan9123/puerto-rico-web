#!/usr/bin/env bash
# ============================================================
# tools/eval_vnet_ab.sh — Phase 2 三臂同种子配对评测（价值网叶评估 vs 现役完整 rollout）
# ============================================================
# 用法: bash tools/eval_vnet_ab.sh <name> <games> [procs=4] [multiplier=6] [vnet=mcts_value_vnet.json] [truncate=0] [rolloutFrac=0] [seedBase=20260611]
#   A: DEPLOY 现役 L6（alphaIters 400，完整 rollout）
#   B: 价值网叶评估，alphaIters = round(400 × multiplier)（等墙钟；倍率来自 tools/bench_search.js）
#   C: 价值网叶评估，alphaIters 400（同迭代；分离"估值更准"与"模拟更多"）
# 产物: data/paired/<name>-{A,B,C}-lo5.jsonl 与两份配对报告（B vs A, C vs A）
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
NAME=${1:?name}; GAMES=${2:?games}; PROCS=${3:-4}; MULT=${4:-6}; VNET=${5:-mcts_value_vnet.json}; TRUNC=${6:-0}; FRAC=${7:-0}; SEEDBASE=${8:-20260611}
[ -f "$VNET" ] || { echo "missing value net: $VNET"; exit 2; }
ITERS_B=$(node -e "console.log(Math.round(400*$MULT))")
budget() { echo "{\"L4\":50,\"L5\":100,\"hardIters\":60,\"hardMs\":1e9,\"expertIters\":400,\"expertMs\":1e9,\"alphaIters\":$1,\"alphaMs\":1e9}"; }
KNOBS_B="{\"_l6ValueNet\":true,\"_l6LeafTruncate\":$TRUNC,\"_l6RolloutFrac\":$FRAC,\"__MCTS_VALUE_VNET__\":\"$VNET\",\"_aiThinkBudget\":$(budget $ITERS_B)}"
KNOBS_C="{\"_l6ValueNet\":true,\"_l6LeafTruncate\":$TRUNC,\"_l6RolloutFrac\":$FRAC,\"__MCTS_VALUE_VNET__\":\"$VNET\",\"_aiThinkBudget\":$(budget 400)}"
echo "[ab] A=DEPLOY(400)  B=vnet(iters $ITERS_B, trunc $TRUNC, frac $FRAC)  C=vnet(400)  games=$GAMES procs=$PROCS seedBase=$SEEDBASE"
t0=$(date +%s)
bash tools/eval_paired_run.sh "$NAME-A" DEPLOY 5 "$GAMES" "$PROCS" "$SEEDBASE" || exit 1
echo "[ab] A done in $(( $(date +%s) - t0 ))s"
L6_KNOBS="$KNOBS_B" bash tools/eval_paired_run.sh "$NAME-B" DEPLOY 5 "$GAMES" "$PROCS" "$SEEDBASE" || exit 1
echo "[ab] B done in $(( $(date +%s) - t0 ))s"
L6_KNOBS="$KNOBS_C" bash tools/eval_paired_run.sh "$NAME-C" DEPLOY 5 "$GAMES" "$PROCS" "$SEEDBASE" || exit 1
echo "[ab] C done in $(( $(date +%s) - t0 ))s"
echo; echo "===== B (vnet, equal wall-clock ×$MULT) vs A (deploy) ====="
node tools/paired_report.js "data/paired/$NAME-B-lo5.jsonl" "data/paired/$NAME-A-lo5.jsonl" "B:vnet×$MULT" "A:deploy"
echo; echo "===== C (vnet, same 400 iters) vs A (deploy) ====="
node tools/paired_report.js "data/paired/$NAME-C-lo5.jsonl" "data/paired/$NAME-A-lo5.jsonl" "C:vnet@400" "A:deploy"
