#!/usr/bin/env bash
# ============================================================
# L6 算力缩放探针：alphaIters ∈ {100, 1600} vs 现役 400，基础局，同种子配对
# ============================================================
# 用法: bash tools/run_scaling_probe.sh [games=160] [seedBase=20260611] [chunk=10]
#
# 动机（§16）：部署的浏览器 L6 每决策 ~21.8k 迭代（K 个 worker × 8 s），而本文档所有
# 强度结论都在 alphaIters=400 下测得——此前从未测过 L6 是否仍随迭代数变强。
# 400 臂免费：data/paired/vnet1-A-lo5.jsonl（480 局，seed 20260611，DEPLOY，lo=5，基础局，
# 首 2 行已与确定性基线逐字节核对）。这里只跑 100 与 1600 两臂，对手 3×L5 固定 expertIters=400。
#
# 可续跑：按 chunk 分片落盘，重启后已写满的片跳过（同 run_expansion_ab.sh）。
# ⚠ 运行期间不得改 sim.js —— 各臂从工作目录实跑。
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
GAMES=${1:-160}; SEEDBASE=${2:-20260611}; CHUNK=${3:-10}
JOBS=$(nproc 2>/dev/null || echo 4)
unset MODS   # 基础局

budget () {  # $1 = alphaIters；其余与 eval_paired_worker 默认预算逐字段一致
  printf '{"_aiThinkBudget":{"L4":50,"L5":100,"hardIters":60,"hardMs":1000000000,"expertIters":400,"expertMs":1000000000,"alphaIters":%d,"alphaMs":1000000000}}' "$1"
}

run_arm () {                       # $1=alphaIters  $2=输出 tag
  local iters=$1 tag=$2 s e out pend=0 skip=0
  export L6_KNOBS; L6_KNOBS=$(budget "$iters")
  for (( s=0; s<GAMES; s+=CHUNK )); do
    e=$(( s + CHUNK )); (( e > GAMES )) && e=$GAMES
    out="$ROOT/data/paired/${tag}-g${s}.jsonl"
    if [ -f "$out" ] && [ "$(wc -l < "$out")" -eq $(( e - s )) ]; then skip=$((skip+1)); continue; fi
    rm -f "$out"
    while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n 2>/dev/null || sleep 1; done
    ( node tools/eval_paired_worker.js DEPLOY 5 "$s" "$e" "$out" "$SEEDBASE" \
        > "$ROOT/data/paired/${tag}-g${s}.log" 2>&1 ) &
    pend=$((pend+1))
  done
  wait
  echo "[$tag] 本次跑了 $pend 片，跳过已完成 $skip 片"
  local merged="$ROOT/data/paired/${tag}-lo5.jsonl"; : > "$merged"
  for (( s=0; s<GAMES; s+=CHUNK )); do cat "$ROOT/data/paired/${tag}-g${s}.jsonl" >> "$merged" 2>/dev/null; done
  echo "[$tag] 合计 $(wc -l < "$merged") 局"
}

run_arm 100  "scale-i100-$SEEDBASE"
run_arm 1600 "scale-i1600-$SEEDBASE"
run_arm 6400 "scale-i6400-$SEEDBASE"   # 预注册比较：6400 vs 400（§17）

echo; echo "===== 各臂 vs 现役 alphaIters=400（vnet1-A-lo5.jsonl 前 $GAMES 局），seed=$SEEDBASE ====="
head -n "$GAMES" data/paired/vnet1-A-lo5.jsonl > "data/paired/scale-i400-$SEEDBASE-lo5.jsonl"
for it in 100 1600 6400; do
  echo "--- alphaIters=$it vs 400 ---"
  node tools/paired_report.js "data/paired/scale-i${it}-$SEEDBASE-lo5.jsonl" "data/paired/scale-i400-$SEEDBASE-lo5.jsonl" "iters=$it" "iters=400"
done
