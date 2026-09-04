#!/usr/bin/env bash
# ============================================================
# tools/eval_vnetbuild_ab.sh — Phase 3a：价值网 1-ply 建造前瞻的同种子配对评测
# ============================================================
# 用法: bash tools/eval_vnetbuild_ab.sh <name> <games> [procs=4] [vnet=mcts_value_vnet.json] [samples=1] [seedBase=20260611]
#   A: 现役 L6（build 走启发式）
#   B: 同样的 L6，但 build 子决策改用价值网 1-ply 前瞻（_l6VnetBuild）
# 两臂角色搜索预算完全相同（alphaIters 400）→ 差异只来自 build 决策，无需等墙钟换算
# （前瞻 ~0.3-0.6 ms/次建造，相对每次角色搜索 ~450 ms 可忽略）。
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
NAME=${1:?name}; GAMES=${2:?games}; PROCS=${3:-4}; VNET=${4:-mcts_value_vnet.json}; SAMPLES=${5:-1}; SEEDBASE=${6:-20260611}
[ -f "$VNET" ] || { echo "missing value net: $VNET"; exit 2; }
KNOBS_B="{\"_l6VnetBuild\":true,\"_l6VnetBuildSamples\":$SAMPLES,\"__MCTS_VALUE_VNET__\":\"$VNET\"}"
echo "[ab] A=deploy(build 启发式)  B=vnet 建造前瞻(samples=$SAMPLES)  games=$GAMES procs=$PROCS"
t0=$(date +%s)
bash tools/eval_paired_run.sh "$NAME-A" DEPLOY 5 "$GAMES" "$PROCS" "$SEEDBASE" || exit 1
echo "[ab] A done in $(( $(date +%s) - t0 ))s"
L6_KNOBS="$KNOBS_B" bash tools/eval_paired_run.sh "$NAME-B" DEPLOY 5 "$GAMES" "$PROCS" "$SEEDBASE" || exit 1
echo "[ab] B done in $(( $(date +%s) - t0 ))s"
echo; echo "===== B (vnet build lookahead) vs A (deploy) ====="
node tools/paired_report.js "data/paired/$NAME-B-lo5.jsonl" "data/paired/$NAME-A-lo5.jsonl" "B:vnetbuild" "A:deploy"
