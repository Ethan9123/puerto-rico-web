#!/usr/bin/env bash
# ============================================================
# tools/fetch_human_wins.sh — 从后端取回"真人胜局"训练 JSONL
# ============================================================
# 分页拼接 /dump 的输出到一个本地 JSONL，可直接喂 train/。
#
# 用法:
#   tools/fetch_human_wins.sh <BASE_URL> <DUMP_TOKEN> [OUT_PATH]
# 示例:
#   tools/fetch_human_wins.sh https://puerto-rico-web.example.workers.dev s3cr3t data/human-wins.jsonl
#   python train/train.py data/human-wins.jsonl
set -euo pipefail

BASE="${1:?用法: fetch_human_wins.sh <BASE_URL> <DUMP_TOKEN> [OUT_PATH]}"
TOKEN="${2:?需要 DUMP_TOKEN（即 wrangler secret put DUMP_TOKEN 设的值）}"
OUT="${3:-data/human-wins.jsonl}"

mkdir -p "$(dirname "$OUT")"
: > "$OUT"

cursor=""
pages=0
while :; do
  url="${BASE%/}/dump?token=${TOKEN}&limit=100"
  [ -n "$cursor" ] && url="${url}&cursor=${cursor}"
  hdr="$(mktemp)"
  curl -fsS -D "$hdr" "$url" >> "$OUT"
  # 读取分页游标（响应头 X-Next-Cursor）；没有则结束
  cursor="$(awk 'tolower($1)=="x-next-cursor:"{print $2}' "$hdr" | tr -d '\r')"
  rm -f "$hdr"
  pages=$((pages + 1))
  [ -z "$cursor" ] && break
done

samples="$(wc -l < "$OUT" | tr -d ' ')"
echo "拉取完成：${pages} 页 → ${OUT}（${samples} 个训练样本）"
echo "下一步：python train/train.py ${OUT}"
