#!/usr/bin/env bash
# ============================================================
# eval_paired_run.sh — 并行跑一个配置的配对评测分片
# ============================================================
# 用法: bash tools/eval_paired_run.sh <name> <nnPath|DEPLOY> <lo> <games> [procs=12] [seedBase=20260611] [alphaC]
# 产物: data/paired/<name>-lo<lo>.jsonl  (每局一行, 局号 g 即配对键)
set -o pipefail
cd "$(dirname "$0")/.." || exit 1

NAME=${1:?name}
NN=${2:?nnPath|DEPLOY}
LO=${3:?lo}
GAMES=${4:?games}
PROCS=${5:-12}
SEEDBASE=${6:-20260611}
ALPHAC=${7:-}
ENDBOOST=${8:-}
HEURJSON=${9:-}

mkdir -p data/paired logs
CHUNK=$(( (GAMES + PROCS - 1) / PROCS ))
pids=()
parts=()
for i in $(seq 0 $((PROCS-1))); do
  S=$((i * CHUNK)); E=$((S + CHUNK)); [ "$E" -gt "$GAMES" ] && E=$GAMES
  [ "$S" -ge "$E" ] && break
  P="data/paired/.${NAME}-lo${LO}-part$i.jsonl"
  parts+=("$P")
  node tools/eval_paired_worker.js "$NN" "$LO" "$S" "$E" "$P" "$SEEDBASE" $ALPHAC $ENDBOOST $HEURJSON > "logs/paired-${NAME}-lo${LO}-p$i.log" 2>&1 &
  pids+=($!)
done
echo "[eval_paired] $NAME lo=$LO games=$GAMES procs=${#pids[@]} 已启动"
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if [ "$fail" != "0" ]; then echo "[eval_paired] ERROR: 有 worker 失败, 见 logs/paired-${NAME}-lo${LO}-p*.log"; exit 1; fi
OUT="data/paired/${NAME}-lo${LO}.jsonl"
cat "${parts[@]}" > "$OUT"
rm -f "${parts[@]}"
echo "[eval_paired] DONE -> $OUT ($(wc -l < "$OUT" | tr -d ' ') 局)"
