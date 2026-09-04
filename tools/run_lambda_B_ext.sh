#!/usr/bin/env bash
# Phase 6 收尾：λ=0.5 混合叶评估臂的样本扩展（局号 480-959，seedBase 20260611）
# 与 §13.10 实验 2 的 480 局使用完全相同的旋钮，可与 lambda-B-lo5.jsonl 直接合并。
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
export L6_KNOBS='{"_l6ValueNet":true,"_l6LeafTruncate":0,"_l6RolloutFrac":0.5,"__MCTS_VALUE_VNET__":"mcts_value_vnet.json","_aiThinkBudget":{"L4":50,"L5":100,"hardIters":60,"hardMs":1e9,"expertIters":400,"expertMs":1e9,"alphaIters":691,"alphaMs":1e9}}'
for i in 0 1 2 3; do
  s=$((480 + i * 120)); e=$((s + 120))
  node tools/eval_paired_worker.js DEPLOY 5 "$s" "$e" "data/paired/lambda-B-ext-part$i.jsonl" 20260611 \
    > "data/paired/lambda-B-ext-$i.log" 2>&1 &
done
wait
cat data/paired/lambda-B-ext-part*.jsonl > data/paired/lambda-B-ext-lo5.jsonl
wc -l data/paired/lambda-B-ext-lo5.jsonl
