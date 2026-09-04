#!/usr/bin/env bash
# 扩展局(Tibs+贵族) 同种子配对评测：A=补效果前(f4257c2 worktree)  B=补效果后(当前)
# 两臂串行共用 4 核；评测按迭代数定界，结果与 CPU 速度无关。
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
GAMES=${1:-480}; SEEDBASE=${2:-20260611}
# 输出文件名带 seedBase —— 否则复现轮会覆盖上一轮的数据（本次实测踩到）
export MODS='{"tibsBuildings":true,"nobles":true}'
run_arm () {           # $1=根目录  $2=输出前缀
  local root=$1 tag=$2 i s e
  for i in 0 1 2 3; do
    s=$(( i * GAMES / 4 )); e=$(( (i+1) * GAMES / 4 ))
    ( cd "$root" && node tools/eval_paired_worker.js DEPLOY 5 "$s" "$e" \
        "/home/user/puerto-rico-web/data/paired/${tag}-part$i.jsonl" "$SEEDBASE" \
        > "/home/user/puerto-rico-web/data/paired/${tag}-$i.log" 2>&1 ) &
  done
  wait
  cat "data/paired/${tag}-part"*.jsonl > "data/paired/${tag}-lo5.jsonl"
  echo "$tag done: $(wc -l < "data/paired/${tag}-lo5.jsonl") games"
}
run_arm /tmp/pr-base            "expA-before-$SEEDBASE"
run_arm /home/user/puerto-rico-web "expB-after-$SEEDBASE"
echo "===== B(补效果后) vs A(补效果前)，扩展局 ====="
node tools/paired_report.js "data/paired/expB-after-$SEEDBASE-lo5.jsonl" "data/paired/expA-before-$SEEDBASE-lo5.jsonl" "补效果后" "补效果前"
