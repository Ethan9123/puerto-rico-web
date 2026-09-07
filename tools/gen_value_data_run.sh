#!/usr/bin/env bash
# ============================================================
# tools/gen_value_data_run.sh — 多进程并行生成价值网训练分片
# ============================================================
# 用法: bash tools/gen_value_data_run.sh <name> <totalGames> [procs=4] [seedBase=20260901] [extra gen args...]
# 例:   bash tools/gen_value_data_run.sh mix 40000 4 20260901 --mix heur:0.7,hard:0.2,expert:0.1 --eps 0.1
#       bash tools/gen_value_data_run.sh roll 6000 4 20261001 --mix heur:0.7,hard:0.2,expert:0.1 --eps 0.1 --rollouts 4
# 产物: data/value/<name>-<i>.bin（i=0..procs-1，局号按 g % procs 交错分片，种子全局一致）
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
NAME=${1:?name}; GAMES=${2:?totalGames}; PROCS=${3:-4}; SEEDBASE=${4:-20260901}
shift 4 2>/dev/null || shift $#
mkdir -p data/value
pids=()
for ((i=0; i<PROCS; i++)); do
  node tools/gen_value_data.js --games "$GAMES" --out "data/value/$NAME-$i.bin" --seedBase "$SEEDBASE" --shard "$i/$PROCS" "$@" > "data/value/$NAME-$i.log" 2>&1 &
  pids+=($!)
done
rc=0
for p in "${pids[@]}"; do wait "$p" || rc=1; done
for ((i=0; i<PROCS; i++)); do tail -1 "data/value/$NAME-$i.log"; done
ls -la data/value/$NAME-*.bin
exit $rc
