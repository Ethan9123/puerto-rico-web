#!/usr/bin/env bash
# 并行生成最佳响应数据: 12 worker × 160 局 @400 iters, 每 worker 不同 seedBase
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
TS() { date +"%H:%M:%S"; }

NPROC=${1:-12}
PERPROC=${2:-160}
ITERS=${3:-400}
SEEDOFF=${4:-0}
MERGED="data/sp-br.jsonl"

mkdir -p data logs
echo "[$(TS)] BR selfplay: procs=$NPROC games/proc=$PERPROC iters=$ITERS seedoff=$SEEDOFF"
pids=()
for i in $(seq 0 $((NPROC-1))); do
  node tools/selfplay_br.js "$PERPROC" "$ITERS" "data/sp-br-p$i.jsonl" mcts_value_nn.json $(( SEEDOFF + 1000000 * (i+1) )) > "logs/sp-br-p$i.log" 2>&1 &
  pids+=($!)
done
echo "[$(TS)] 已启动 ${#pids[@]} 个 worker; 进度见 logs/sp-br-p*.log"
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if [ "$fail" != "0" ]; then echo "[$(TS)] ERROR: 有 worker 失败"; exit 1; fi
cat data/sp-br-p*.jsonl > "$MERGED"
SAMPLES=$(wc -l < "$MERGED" | tr -d ' ')
echo "[$(TS)] DONE: 合并 $SAMPLES 样本 -> $MERGED ($(du -h "$MERGED" | cut -f1))"
rm -f data/sp-br-p*.jsonl
# 学习者总胜率统计
grep -h "学习者(NN宗师)胜率" logs/sp-br-p*.log | tail -12
