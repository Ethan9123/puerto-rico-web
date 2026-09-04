#!/usr/bin/env bash
# A 臂扩展跑完后自动接上 B 臂扩展（两臂共用 4 核，串行避免争抢）
cd "$(dirname "$0")/.." || exit 1
while pgrep -f 'eval_paired_worker.js DEPLOY 5 [0-9]* [0-9]* data/paired/vnet1-A-ext' > /dev/null; do sleep 20; done
cat data/paired/vnet1-A-ext-part*.jsonl > data/paired/vnet1-A-ext-lo5.jsonl
echo "A-ext done: $(wc -l < data/paired/vnet1-A-ext-lo5.jsonl) games"
exec bash tools/run_lambda_B_ext.sh
