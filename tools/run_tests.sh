#!/usr/bin/env bash
# 跑 tests/ 下的全部 *_test.js。
#
# 为什么用 glob 而不是手写清单：§15.5 记录过，此前各节引用的"全测试回归"是一份
# 手写的 11 项清单，而 tests/ 下实际有 20 个 *_test.js —— sim_test / factored_parity_test
# 等最贴近 sim.js 改动的用例从未被列进去。手写清单会漂移，glob 不会。
#
# 退出码约定：0=全绿（skip 不算失败）；1=有 FAIL。
# 单个用例：0=PASS；2 且输出含 "skipped"=SKIP（缺 torch 生成的本地参考件等）；
# 其余一律 FAIL —— 注意 rc=2 不能无条件当作 skip，worker_static_sync_test.js 的
# catch 分支也用 exit(2) 报真错。

cd "$(dirname "$0")/.." || exit 1
TIMEOUT="${TEST_TIMEOUT:-900}"
pass=0; skip=0; fail=0; failed=()

for f in tests/*_test.js; do
  name=$(basename "$f" .js)
  out=$(timeout "$TIMEOUT" node "$f" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    echo "PASS  $name"; pass=$((pass+1))
  elif [ $rc -eq 2 ] && printf '%s' "$out" | grep -qi 'skipped'; then
    echo "SKIP  $name — $(printf '%s' "$out" | grep -i -m1 'skipped' | cut -c1-100)"
    skip=$((skip+1))
  else
    echo "FAIL  $name (rc=$rc)"
    printf '%s\n' "$out" | tail -25 | sed 's/^/      /'
    fail=$((fail+1)); failed+=("$name")
  fi
done

echo "----"
echo "pass=$pass skip=$skip fail=$fail"
[ $fail -eq 0 ] || { echo "failed: ${failed[*]}"; exit 1; }
