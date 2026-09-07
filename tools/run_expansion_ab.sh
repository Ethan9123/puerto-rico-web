#!/usr/bin/env bash
# ============================================================
# 扩展局(Tibs+贵族) 同种子配对评测：A=补效果前(worktree)  B=补效果后(当前工作目录)
# ============================================================
# 用法: bash tools/run_expansion_ab.sh [games=480] [seedBase=20260611] [chunk=20]
#
# **可续跑**：按 chunk 局细分片，每片单独落盘；重启后已写满的片直接跳过。
# 容器在本项目里已重启 5 次、每次都打断 ~2 小时的评测，此前是整轮作废重来。
# 现在最坏只损失"正在跑的那几片"（≤ chunk × 并发数 局）。
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
GAMES=${1:-480}; SEEDBASE=${2:-20260611}; CHUNK=${3:-20}
JOBS=$(nproc 2>/dev/null || echo 4)
export MODS='{"tibsBuildings":true,"nobles":true}'
BASE_WT=${BASE_WT:-/tmp/pr-base}
[ -d "$BASE_WT" ] || { echo "缺少基线 worktree: $BASE_WT"; exit 2; }

run_arm () {                       # $1=引擎根目录  $2=输出 tag
  local root=$1 tag=$2 s e out pend=0 skip=0
  local pids=()
  for (( s=0; s<GAMES; s+=CHUNK )); do
    e=$(( s + CHUNK )); (( e > GAMES )) && e=$GAMES
    out="$ROOT/data/paired/${tag}-g${s}.jsonl"
    # 已写满 → 跳过（续跑的关键）
    if [ -f "$out" ] && [ "$(wc -l < "$out")" -eq $(( e - s )) ]; then skip=$((skip+1)); continue; fi
    rm -f "$out"                   # 半截文件重来，避免行数对不上
    while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n 2>/dev/null || sleep 1; done
    ( cd "$root" && node tools/eval_paired_worker.js DEPLOY 5 "$s" "$e" "$out" "$SEEDBASE" \
        > "$ROOT/data/paired/${tag}-g${s}.log" 2>&1 ) &
    pend=$((pend+1))
  done
  wait
  echo "[$tag] 本次跑了 $pend 片，跳过已完成 $skip 片"
  # 按局号顺序合并
  local merged="$ROOT/data/paired/${tag}-lo5.jsonl"; : > "$merged"
  for (( s=0; s<GAMES; s+=CHUNK )); do cat "$ROOT/data/paired/${tag}-g${s}.jsonl" >> "$merged" 2>/dev/null; done
  echo "[$tag] 合计 $(wc -l < "$merged") 局"
}

run_arm "$BASE_WT" "expA-before-$SEEDBASE"
run_arm "$ROOT"    "expB-after-$SEEDBASE"

echo; echo "===== B(补效果后) vs A(补效果前)，扩展局 seed=$SEEDBASE ====="
node tools/paired_report.js \
  "data/paired/expB-after-$SEEDBASE-lo5.jsonl" \
  "data/paired/expA-before-$SEEDBASE-lo5.jsonl" "补效果后" "补效果前"
