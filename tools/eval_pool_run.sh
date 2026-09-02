#!/usr/bin/env bash
# ============================================================
# eval_pool_run.sh — 并行跑参考池评级(候选 vs L3/L4/L5/L6 多样化对手池)并出报告
# ============================================================
# 用法: bash tools/eval_pool_run.sh <name> <games> [procs=4] [seedBase=20260611] [nnPath|DEPLOY] [worker 额外参数...]
#   额外参数原样透传给 tools/eval_pool.js, 例如: --knob _alphaC=2 --knob _l6Heur=@h.json --fast
#   nnPath=DEPLOY(或省略) → CAND 与 L6 完全相同(自检: 两者评级应相等)
# 分片: 第 i 个进程跑 g % procs == i 的局(交错分片, 各进程种子/座位/阵容均衡)
# 产物: data/pool/<name>.jsonl (每局一行) + data/pool/<name>-report.md
# 耗时参考: 满预算(alphaIters=400) 单进程约 17s/局(4 核机实测) → 400 局 / 4 进程 ≈ 30 分钟
set -o pipefail
cd "$(dirname "$0")/.." || exit 1

NAME=${1:?name}
GAMES=${2:?games}
PROCS=${3:-4}
SEEDBASE=${4:-20260611}
NN=${5:-DEPLOY}
shift $(( $# < 5 ? $# : 5 ))
EXTRA=("$@")
NNARG=()
[ "$NN" != "DEPLOY" ] && NNARG=(--nn "$NN")

mkdir -p data/pool logs
pids=()
parts=()
for i in $(seq 0 $((PROCS-1))); do
  P="data/pool/.${NAME}-part$i.jsonl"
  parts+=("$P")
  node tools/eval_pool.js --games "$GAMES" --shard "$i/$PROCS" --seedBase "$SEEDBASE" --out "$P" "${NNARG[@]}" "${EXTRA[@]}" > "logs/pool-${NAME}-p$i.log" 2>&1 &
  pids+=($!)
done
echo "[eval_pool] $NAME games=$GAMES procs=${#pids[@]} nn=$NN extra=[${EXTRA[*]}] 已启动"
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if [ "$fail" != "0" ]; then echo "[eval_pool] ERROR: 有 worker 失败, 见 logs/pool-${NAME}-p*.log"; exit 1; fi
OUT="data/pool/${NAME}.jsonl"
cat "${parts[@]}" | sort -t: -k2 -n > "$OUT"   # 行首为 {"g":<n>, 按局号排序
rm -f "${parts[@]}"
echo "[eval_pool] DONE -> $OUT ($(wc -l < "$OUT" | tr -d ' ') 局)"
node tools/eval_pool_report.js "$OUT" | tee "data/pool/${NAME}-report.md"
