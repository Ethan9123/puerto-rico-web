#!/usr/bin/env bash
# ============================================================
# tools/run_arm.sh — 单臂配对评测的可续跑运行器（确认性评测用）
# ============================================================
# 一个"臂"= 一组固定配置（引擎提交 + NN + lo + 旋钮 + 种子 + 局号区间）跑出的每局一行结果。
# 本脚本把 [G0, G0+GAMES) 切成 CHUNK 局一片，用 JOBS 个并发 worker 跑完，可在任意时刻被杀、
# 容器重启后原样重跑同一条命令续跑；全部分片完成后合并出 merged.jsonl 供 paired_report.js 使用。
#
# 用法（全部走环境变量）:
#   TAG=vnetX-B GAMES=2000 L6_KNOBS='{"_l6ValueNet":true}' bash tools/run_arm.sh
#   TAG=vnetX-B GAMES=2000 L6_KNOBS='{"_l6ValueNet":true}' STATUS=1 bash tools/run_arm.sh   # 只看进度
#   node tools/paired_report.js data/paired/vnetX-B/merged.jsonl data/paired/vnetX-A/merged.jsonl vnetX-B vnetX-A --expect 2000 --favor A
#     （--favor 指位置：A = 第 1 个文件 = 候选 vnetX-B；差值一律是 第1个 − 第2个）
#
# 输入（环境变量）:
#   TAG            必填。臂名，只能含 [A-Za-z0-9._-]。
#   GAMES          必填。局数。
#   G0=0           起始局号（局号 g 即配对键；种子 = SEED + g·1000003，座位 = g%4，由 worker 决定）。
#   SEED=20260611  seedBase。
#   CHUNK=10       每片局数。
#   JOBS=$(nproc)  最多并发片数。
#   ENGINE_ROOT    引擎所在 checkout（默认 = 本脚本所在仓库根）。确认性评测建议用
#                  `git worktree add ../pr-engine <commit>` 钉住提交，避免跑的过程中有人改 sim.js/game.js。
#   LO=5  NN=DEPLOY  L6_KNOBS  MODS   原样传给 eval_paired_worker.js（NN 为相对路径时相对 ENGINE_ROOT 解析；
#                  NN≠DEPLOY 时文件必须存在——否则 game.js 静默退回 L5——其内容哈希记入清单）。
#   EVAL_CRN=1     公共随机数（逐决策 AI 随机流），只接受 0/1；0 → 不向 worker 导出该变量。
#   EVAL_RP_K      可选，设了才导出。
#   MAX_S_PER_GAME=150  单片硬超时 = CHUNK·MAX_S_PER_GAME·2 秒，超时 SIGKILL。
#   STATUS=1       只打印状态（清单是否一致、是否有运行器、各片完成/待跑/失败计数），什么都不跑、不写。
#   ALLOW_DIRTY=1  允许 ENGINE_ROOT 有未提交改动（清单里记 engineClean:false）。
#   L6_SOLVER / L6_SOLVER_CAP 若非空则拒绝运行：worker 会读它们但清单不记录 → 不可复现。
#                  请改写进 L6_KNOBS（{"_l6Solver":true,"_l6SolverCap":X} 与之等价）。
#
# 输出目录: <本脚本所在仓库根>/data/paired/<TAG>/
#   c-<s>-<e>.jsonl       分片结果（传给 worker 的是绝对路径）；worker 新契约：写 .tmp → fsync → rename，
#   c-<s>-<e>.jsonl.meta.jsonl  侧车（同样原子落盘，先于 .done），
#   c-<s>-<e>.jsonl.done  {"rows":N,"gStart":s,"gEnd":e,"sha256":"<最终 jsonl 的 hex>"}，最后写。
#   c-<s>-<e>.log         该片 worker 的 stdout/stderr（每次尝试追加，带分隔头）。
#   c-<s>-<e>.attempts    每次"本启动周期内观察到的失败退出"一行: "<boot_id> <rc> <UTC 时间>"。
#   c-<s>-<e>.failed      attempts 满 3 行即创建；FAILED 片不再自动重跑（查日志后删 .failed 与 .attempts 重试）。
#   c-<s>-<e>.pid         运行中分片的 "<boot_id> <pid>"（孤儿检测用，正常结束即删）。
#   manifest.json         {tag, engineRoot, engineCommit, engineClean, lo, nn, seed, games, g0, chunk,
#                          knobs, mods, crn, rpK, nnSha256, knobFiles}（knobs/mods = L6_KNOBS/MODS 原字符串或 null；
#                          rpK 同理；nnSha256 = NN 文件内容哈希（DEPLOY 时 null：部署网已被 engineCommit 覆盖）；
#                          knobFiles = L6_KNOBS 里指向现存文件的字符串值（如 __MCTS_VALUE_VNET__）→ 内容哈希，或 null。
#                          后两项补上 gitignore 的网络文件被覆盖而 engineCommit/engineClean 看不见的洞）。
#   merged.jsonl / merged.meta.jsonl   全部完成后按 g 顺序拼接（缺失的侧车跳过）。
#   runner.lock           "<boot_id> <pid>"，臂级互斥锁。
#
# 分片状态:
#   COMPLETE ⇔ c-s-e.jsonl 与 .done 都在、.done 的 rows == e−s（gStart/gEnd 若有也须一致）、
#              且 sha256sum(c-s-e.jsonl) == .done 的 sha256。（行内是 error/incomplete 也算完成——
#              每局恰好一行是契约；无效行由 paired_report 的有效性规则裁决。）
#   FAILED   ⇔ c-s-e.failed 存在（且不 COMPLETE）。
#   PENDING  其余。每次（重新）启动一片前先删掉该片残留的 jsonl/.tmp/.done/.meta.jsonl*。
#
# 尝试计数: 本进程启动的分片退出时 rc≠0 或没产出 COMPLETE 片 → .attempts 追加一行；满 3 行 → .failed。
#   未满 3 行的失败片排到队尾，本次运行内自动重试。
#   被容器重启杀掉的分片永远不会被观察到退出 → 不计数（有意为之：重启不是分片的错）。
#   运行器自己收到 INT/TERM/HUP 时会 TERM 掉运行中的分片（10 s 后 KILL），这些退出同样不计数。
#
# 清单: 首次运行写 manifest.json；以后每次运行都重算全部字段并逐一比较，任一不同 → 打印哪几个字段、
#   exit 2，不跑任何东西（换配置请换 TAG）。engineClean 为 false 时拒绝启动（exit 2），除非 ALLOW_DIRTY=1。
#   没有 manifest.json 但目录里已有 c-* / merged.jsonl（清单被删过）→ exit 2（否则会把新配置写进清单、混跑两种配置）。
#   运行中每次启动新分片前、以及每片结束时复查引擎 HEAD（清单记为干净时还复查工作树）；一旦漂移就停止派发，
#   漂移后才结束的片一律作废（删 .done，不计 attempts——worker 会在运行中读盘：首个 L6 决策懒加载 NN、
#   EVAL_RP_K 池 worker 构造时读 ai_worker.js/sim.js，所以"启动时已读进内存"不成立），等在跑的片结束后 exit 2。
#
# 锁: runner.lock 已存在且 boot_id 相同、pid 存活且确是写锁的那个进程（命令行含 run_arm，或进程启动时刻不晚于
#   锁文件 mtime——防 pid 复用，又不误放经符号链接/改名调用的运行器）→ exit 4 "already running"；
#   否则（上个启动周期留下的、或同周期但进程已死）直接替换。检查+占用在 flock 保护下原子完成。退出时（trap）删除。
#   另：同启动周期内若有存活的孤儿 worker（运行器被 kill -9 后留下的，见 .pid），也 exit 4，避免两个进程写同一片。
#
# 盲化: 本脚本与 worker 都只打印计数，从不打印胜率（确认性评测期间不做中期窥视）。
#
# 退出码: 0 全部完成并已合并（打印 "COMPLETE <rows> rows"）；1 用法/环境错误；
#   2 清单不一致 / 引擎不干净 / 运行中引擎漂移；3 还有 PENDING 或 FAILED 片；4 已有运行器（或孤儿 worker）。
#   STATUS=1: 0 全部完成；3 未完成；2 清单与当前环境不一致或清单缺失而已有分片（状态照常打印）。
set -u -o pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P) || exit 1
MAX_ATTEMPTS=3

log() { echo "[run_arm] $*"; }
die() { local rc=$1; shift; echo "[run_arm] ERROR: $*" >&2; exit "$rc"; }

if (( BASH_VERSINFO[0] < 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] < 1) )); then
  die 1 "需要 bash ≥ 5.1（wait -n -p），当前 $BASH_VERSION"
fi
for c in node git sha256sum timeout; do command -v "$c" >/dev/null 2>&1 || die 1 "缺少命令 $c"; done

# ---------- 输入 ----------
TAG=${TAG:-}
GAMES=${GAMES:-}
G0=${G0:-0}
SEED=${SEED:-20260611}
CHUNK=${CHUNK:-10}
JOBS=${JOBS:-$(nproc 2>/dev/null || echo 4)}
ENGINE_ROOT=${ENGINE_ROOT:-$REPO_ROOT}
LO=${LO:-5}
NN=${NN:-DEPLOY}
EVAL_CRN=${EVAL_CRN:-1}
EVAL_RP_K=${EVAL_RP_K:-}
MAX_S_PER_GAME=${MAX_S_PER_GAME:-150}
STATUS=${STATUS:-0}
ALLOW_DIRTY=${ALLOW_DIRTY:-0}
KNOBS_STR=${L6_KNOBS:-}
MODS_STR=${MODS:-}

[ -n "$TAG" ] || die 1 "TAG 必填"
[[ $TAG =~ ^[A-Za-z0-9_-][A-Za-z0-9._-]*$ ]] || die 1 "TAG 只能含 [A-Za-z0-9._-] 且不以 . 开头: '$TAG'"
[ -n "$GAMES" ] || die 1 "GAMES 必填"
isint() { [[ $1 =~ ^[0-9]+$ ]]; }
for v in GAMES G0 SEED CHUNK JOBS LO MAX_S_PER_GAME; do isint "${!v}" || die 1 "$v 必须是非负整数: '${!v}'"; done
# 去掉前导零（防八进制）
GAMES=$((10#$GAMES)); G0=$((10#$G0)); SEED=$((10#$SEED)); CHUNK=$((10#$CHUNK)); JOBS=$((10#$JOBS)); LO=$((10#$LO)); MAX_S_PER_GAME=$((10#$MAX_S_PER_GAME))
(( GAMES >= 1 && CHUNK >= 1 && JOBS >= 1 && MAX_S_PER_GAME >= 1 )) || die 1 "GAMES/CHUNK/JOBS/MAX_S_PER_GAME 必须 ≥ 1"
[[ $EVAL_CRN == 0 || $EVAL_CRN == 1 ]] || die 1 "EVAL_CRN 只接受 0 或 1: '$EVAL_CRN'"
[ -n "$NN" ] || die 1 "NN 不能为空"
[ -z "${L6_SOLVER:-}" ] && [ -z "${L6_SOLVER_CAP:-}" ] || die 1 "L6_SOLVER/L6_SOLVER_CAP 不会被记进清单 → 请改用 L6_KNOBS '{\"_l6Solver\":true,\"_l6SolverCap\":X}'"
for v in KNOBS_STR MODS_STR; do
  if [ -n "${!v}" ]; then
    node -e 'JSON.parse(process.argv[1])' "${!v}" 2>/dev/null || die 1 "${v%_STR} 不是合法 JSON: ${!v}"
  fi
done
ENGINE_ROOT=$(cd "$ENGINE_ROOT" 2>/dev/null && pwd -P) || die 1 "ENGINE_ROOT 不存在: ${ENGINE_ROOT}"
WORKER="$ENGINE_ROOT/tools/eval_paired_worker.js"
[ -f "$WORKER" ] || die 1 "找不到 $WORKER"

BOOT_ID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null) || BOOT_ID=""
[ -n "$BOOT_ID" ] || die 1 "读不到 /proc/sys/kernel/random/boot_id"
DIR="$REPO_ROOT/data/paired/$TAG"
MANIFEST="$DIR/manifest.json"
LOCK="$DIR/runner.lock"
TMO=$(( CHUNK * MAX_S_PER_GAME * 2 ))

# ---------- 分片表 ----------
CHUNKS=()                       # "s e"，按 g 升序
for (( s = G0; s < G0 + GAMES; s += CHUNK )); do
  e=$(( s + CHUNK )); (( e > G0 + GAMES )) && e=$(( G0 + GAMES ))
  CHUNKS+=("$s $e")
done

# ---------- 引擎指纹 + 清单 ----------
git_head()  { git -C "$ENGINE_ROOT" rev-parse HEAD 2>/dev/null; }
git_dirty() { # 输出非空 = 脏（git 出错也当脏）
  local p
  p=$(git --no-optional-locks -C "$ENGINE_ROOT" status --porcelain --untracked-files=no 2>/dev/null) || { echo "git status 失败"; return; }
  printf '%s' "$p"
}
ENGINE_COMMIT=$(git_head) || ENGINE_COMMIT=""
if [ -n "$ENGINE_COMMIT" ] && [ -z "$(git_dirty)" ]; then ENGINE_CLEAN=true; else ENGINE_CLEAN=false; fi

CUR_MANIFEST=$(
  RA_TAG="$TAG" RA_ROOT="$ENGINE_ROOT" RA_COMMIT="$ENGINE_COMMIT" RA_CLEAN="$ENGINE_CLEAN" RA_LO="$LO" RA_NN="$NN" \
  RA_SEED="$SEED" RA_GAMES="$GAMES" RA_G0="$G0" RA_CHUNK="$CHUNK" RA_KNOBS="$KNOBS_STR" RA_MODS="$MODS_STR" \
  RA_CRN="$EVAL_CRN" RA_RPK="$EVAL_RP_K" node -e '
    const fs = require("fs"), path = require("path"), crypto = require("crypto");
    const e = process.env, orNull = s => (s === undefined || s === "" ? null : s);
    // 与 tools/_sandbox.js 的 fetch shim 同一解析规则：存在的绝对路径原样用，否则相对引擎根
    const resolve = u => (path.isAbsolute(u) && fs.existsSync(u)) ? u : path.join(e.RA_ROOT, u.replace(/^\/+/, ""));
    const sha = f => { try { return fs.statSync(f).isFile() ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : null; } catch (_) { return null; } };
    let nnSha256 = null;
    if (e.RA_NN !== "DEPLOY") {
      nnSha256 = sha(resolve(e.RA_NN));
      if (!nnSha256) {
        console.error(`[run_arm] ERROR: NN 文件不存在: ${e.RA_NN}（解析为 ${resolve(e.RA_NN)}）—— game.js 会静默退回 L5，整臂白跑`);
        process.exit(3);
      }
    }
    let knobFiles = null;   // L6_KNOBS 里指向现存文件的字符串值（如 __MCTS_VALUE_VNET__）→ 内容哈希
    const k = e.RA_KNOBS ? JSON.parse(e.RA_KNOBS) : null;
    if (k && typeof k === "object" && !Array.isArray(k)) {
      for (const key of Object.keys(k).sort()) {
        const v = k[key];
        if (typeof v === "string" && v) { const h = sha(resolve(v)); if (h) (knobFiles || (knobFiles = {}))[key] = h; }
      }
    }
    process.stdout.write(JSON.stringify({
      tag: e.RA_TAG, engineRoot: e.RA_ROOT, engineCommit: orNull(e.RA_COMMIT), engineClean: e.RA_CLEAN === "true",
      lo: +e.RA_LO, nn: e.RA_NN, seed: +e.RA_SEED, games: +e.RA_GAMES, g0: +e.RA_G0, chunk: +e.RA_CHUNK,
      knobs: orNull(e.RA_KNOBS), mods: orNull(e.RA_MODS), crn: +e.RA_CRN, rpK: orNull(e.RA_RPK),
      nnSha256, knobFiles,
    }, null, 2) + "\n");') || die 1 "生成清单失败"

# 与磁盘上的清单逐字段比较：一致 → 0；不一致 → 打印差异并返回 2；清单损坏 → 2
manifest_diff() {
  node -e '
    const fs = require("fs");
    let old; try { old = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (err) { console.log("  manifest.json 无法解析: " + err.message); process.exit(2); }
    const cur = JSON.parse(process.argv[2]);
    const keys = [...new Set([...Object.keys(old), ...Object.keys(cur)])];
    const bad = keys.filter(k => JSON.stringify(old[k]) !== JSON.stringify(cur[k]));
    for (const k of bad) console.log(`  ${k}: manifest=${JSON.stringify(old[k])}  now=${JSON.stringify(cur[k])}`);
    process.exit(bad.length ? 2 : 0);' "$MANIFEST" "$CUR_MANIFEST"
}

# ---------- 分片状态 ----------
RE_ROWS='"rows"[[:space:]]*:[[:space:]]*([0-9]+)'
RE_SHA='"sha256"[[:space:]]*:[[:space:]]*"([0-9a-fA-F]{64})"'
RE_GS='"gStart"[[:space:]]*:[[:space:]]*([0-9]+)'
RE_GE='"gEnd"[[:space:]]*:[[:space:]]*([0-9]+)'
is_complete() {  # $1=s $2=e
  local f="$DIR/c-$1-$2.jsonl" d="$DIR/c-$1-$2.jsonl.done" t sha act
  [ -f "$f" ] && [ -f "$d" ] || return 1
  t=$(<"$d") || return 1
  [[ $t =~ $RE_ROWS ]] || return 1; (( 10#${BASH_REMATCH[1]} == $2 - $1 )) || return 1
  [[ $t =~ $RE_SHA ]] || return 1; sha=${BASH_REMATCH[1],,}
  if [[ $t =~ $RE_GS ]]; then (( 10#${BASH_REMATCH[1]} == $1 )) || return 1; fi
  if [[ $t =~ $RE_GE ]]; then (( 10#${BASH_REMATCH[1]} == $2 )) || return 1; fi
  act=$(sha256sum < "$f") || return 1
  [ "${act%% *}" = "$sha" ]
}
chunk_state() {  # 设全局 CS = COMPLETE|FAILED|PENDING
  if is_complete "$1" "$2"; then CS=COMPLETE
  elif [ -e "$DIR/c-$1-$2.failed" ]; then CS=FAILED
  else CS=PENDING; fi
}
n_attempts() { local a=(); [ -f "$DIR/c-$1-$2.attempts" ] && mapfile -t a < "$DIR/c-$1-$2.attempts"; echo "${#a[@]}"; }

# 进程 $1 的启动时刻（epoch 秒）是否 ≤ $2。读不到 → 1。
proc_started_by() {
  local st a btime hz
  st=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
  st=${st##*) }; read -r -a a <<< "$st"          # a[0] = 字段 3（state）→ 字段 22 starttime = a[19]
  btime=$(awk '$1 == "btime" { print $2 }' /proc/stat 2>/dev/null); hz=$(getconf CLK_TCK 2>/dev/null)
  [[ ${a[19]:-} =~ ^[0-9]+$ && $btime =~ ^[0-9]+$ && $hz =~ ^[1-9][0-9]*$ ]] || return 1
  (( btime + a[19] / hz <= $2 ))
}
# pid 是否存活且确是记录它的那个进程（防 pid 复用）：命令行含给定子串，或其启动时刻不晚于记录文件 $3 的
# mtime(+2 s)——后者覆盖换名/经符号链接调用的运行器（复用的 pid 必然在原进程死后、即写记录之后才启动）。
# 僵尸算死（本容器的 PID 1 不及时收养孤儿，被强杀的运行器留下的 worker 结束后会以 Z 状态挂很久，
# kill -0 仍成功）；读不到 /proc 时按存活处理（保守）。
pid_alive_as() {
  local pid=$1 pat=$2 rec=${3:-} st cmd m
  kill -0 "$pid" 2>/dev/null || return 1
  if st=$(cat "/proc/$pid/stat" 2>/dev/null); then
    st=${st##*) }; [ "${st%% *}" = Z ] && return 1
  fi
  cmd=$(tr '\0' ' ' 2>/dev/null < "/proc/$pid/cmdline") || return 0
  [[ -n $cmd && $cmd == *"$pat"* ]] && return 0
  [ -n "$rec" ] && m=$(stat -c %Y "$rec" 2>/dev/null) && proc_started_by "$pid" $(( m + 2 ))
}
lock_owner_alive() {  # 若锁被本启动周期内一个活着的 run_arm 持有 → 输出其 pid 并返回 0
  local b p
  [ -f "$LOCK" ] || return 1
  { read -r b p || [ -n "${b:-}" ]; } 2>/dev/null < "$LOCK" || return 1
  [ "$b" = "$BOOT_ID" ] && [[ ${p:-} =~ ^[0-9]+$ ]] && [ "$p" != "$$" ] && pid_alive_as "$p" run_arm "$LOCK" || return 1
  echo "$p"
}
live_orphans() {  # 输出本启动周期内仍存活的分片 worker "c-s-e:pid"
  local f b p
  for f in "$DIR"/c-*.pid; do
    [ -f "$f" ] || continue
    { read -r b p || [ -n "${b:-}" ]; } 2>/dev/null < "$f" || continue
    if [ "$b" = "$BOOT_ID" ] && [[ ${p:-} =~ ^[0-9]+$ ]] && pid_alive_as "$p" eval_paired_worker "$f"; then
      f=${f##*/}; echo "${f%.pid}:$p"
    fi
  done
}

# 统计并打印计数（不打印任何胜率）；设全局 N_COMPLETE N_PENDING N_FAILED
summarize() {
  local c s e failed=() retried=()
  N_COMPLETE=0; N_PENDING=0; N_FAILED=0
  for c in "${CHUNKS[@]}"; do
    read -r s e <<< "$c"; chunk_state "$s" "$e"
    case $CS in
      COMPLETE) N_COMPLETE=$((N_COMPLETE + 1)) ;;
      FAILED)   N_FAILED=$((N_FAILED + 1)); failed+=("c-$s-$e") ;;
      *)        N_PENDING=$((N_PENDING + 1)); local na; na=$(n_attempts "$s" "$e"); (( na > 0 )) && retried+=("c-$s-$e×$na") ;;
    esac
  done
  log "$TAG: chunks complete $N_COMPLETE / pending $N_PENDING / failed $N_FAILED (共 ${#CHUNKS[@]} 片, $GAMES 局, g∈[$G0,$((G0 + GAMES))))"
  (( ${#failed[@]} )) && log "  FAILED: ${failed[*]:0:10}$( (( ${#failed[@]} > 10 )) && echo " …")  → 查 c-*.log；重试: rm c-s-e.failed c-s-e.attempts"
  (( ${#retried[@]} )) && log "  PENDING 且已有失败尝试: ${retried[*]:0:10}$( (( ${#retried[@]} > 10 )) && echo " …")"
  return 0
}

# 目录里已有分片/合并产物（没有 manifest 时 = 清单被删过，无法知道这些结果是哪个配置跑的）
has_prior_output() { compgen -G "$DIR/c-*" > /dev/null || [ -e "$DIR/merged.jsonl" ]; }

# ---------- STATUS=1: 只读 ----------
if [ "$STATUS" = 1 ]; then
  log "STATUS  tag=$TAG  dir=$DIR"
  mrc=0
  if [ ! -f "$MANIFEST" ] && has_prior_output; then
    mrc=2; log "  manifest: 不存在但目录里已有分片文件 → 续跑会被拒绝 (exit 2)"
  elif [ ! -f "$MANIFEST" ]; then
    log "  manifest: 不存在（该臂尚未启动）"
  elif diffs=$(manifest_diff); then
    log "  manifest: 与当前环境一致"
  else
    mrc=2; log "  manifest: MISMATCH（此配置下续跑会被拒绝, exit 2）:"; echo "$diffs"
  fi
  if owner=$(lock_owner_alive); then log "  runner: 运行中 (pid $owner)"; else log "  runner: 未运行"; fi
  running=$( [ -d "$DIR" ] && live_orphans | wc -l || echo 0 )
  log "  在跑分片 worker: $running"
  summarize
  (( mrc )) && exit 2
  (( N_COMPLETE == ${#CHUNKS[@]} )) && exit 0
  exit 3
fi

# ---------- 启动前检查 ----------
if [ "$ENGINE_CLEAN" != true ]; then
  if [ "$ALLOW_DIRTY" = 1 ]; then
    log "警告: 引擎 $ENGINE_ROOT 不干净/非 git（ALLOW_DIRTY=1，清单记 engineClean:false）"
  else
    [ -n "$ENGINE_COMMIT" ] || die 2 "ENGINE_ROOT 不是 git checkout: $ENGINE_ROOT（ALLOW_DIRTY=1 可强行运行）"
    echo "[run_arm] ERROR: 引擎工作树有未提交改动 → 结果无法归属到某个提交。拒绝启动（ALLOW_DIRTY=1 可强行运行）:" >&2
    git_dirty | head -20 >&2; echo >&2
    exit 2
  fi
fi
mkdir -p "$DIR" || die 1 "无法创建 $DIR"

# ---------- 锁 ----------
LOCK_HELD=0
declare -A RUN=()               # pid → "s e"
SHUTTING_DOWN=0
cleanup() {
  local pid
  for pid in "${!RUN[@]}"; do kill -TERM "$pid" 2>/dev/null; done
  rm -f "$DIR/manifest.json.tmp.$$" "$DIR/merged.jsonl.tmp.$$" "$DIR/merged.meta.jsonl.tmp.$$" "$LOCK.tmp.$$"
  if (( LOCK_HELD )); then
    local b="" p=""; { read -r b p; } 2>/dev/null < "$LOCK"
    [ "${b:-}" = "$BOOT_ID" ] && [ "${p:-}" = "$$" ] && rm -f "$LOCK"
  fi
}
trap cleanup EXIT
on_signal() {  # $1=名字 $2=编号
  SHUTTING_DOWN=1
  trap '' INT TERM HUP
  log "收到 SIG$1 → 终止 ${#RUN[@]} 个运行中分片（不计入 attempts）"
  local pid i
  for pid in "${!RUN[@]}"; do kill -TERM "$pid" 2>/dev/null; done
  for (( i = 0; i < 100; i++ )); do
    local alive=0; for pid in "${!RUN[@]}"; do kill -0 "$pid" 2>/dev/null && alive=1; done
    (( alive )) || break; sleep 0.1
  done
  for pid in "${!RUN[@]}"; do kill -KILL "$pid" 2>/dev/null; done
  wait 2>/dev/null
  for pid in "${!RUN[@]}"; do read -r s e <<< "${RUN[$pid]}"; rm -f "$DIR/c-$s-$e.pid"; done
  RUN=()
  exit $(( 128 + $2 ))
}
trap 'on_signal INT 2' INT
trap 'on_signal TERM 15' TERM
trap 'on_signal HUP 1' HUP

take_lock() {
  local owner have_flock=0
  if command -v flock >/dev/null 2>&1; then
    exec 9> "$DIR/.runner.lock.guard" || die 1 "无法打开 guard 锁"
    flock -w 30 9 || die 4 "30 s 内拿不到 guard 锁（另一个运行器正在检查锁?）"
    have_flock=1
  fi
  if owner=$(lock_owner_alive); then
    (( have_flock )) && exec 9>&-
    echo "[run_arm] already running: $TAG 已被 pid $owner 持有（$LOCK）" >&2
    exit 4
  fi
  [ -f "$LOCK" ] && log "替换过期锁: $(tr '\n' ' ' < "$LOCK")"
  echo "$BOOT_ID $$" > "$LOCK.tmp.$$" && mv -f "$LOCK.tmp.$$" "$LOCK" || die 1 "写锁失败"
  LOCK_HELD=1
  (( have_flock )) && exec 9>&-
  return 0
}
take_lock

orphans=$(live_orphans)
if [ -n "$orphans" ]; then
  echo "[run_arm] already running: 发现本启动周期内仍存活的孤儿 worker（上个运行器被强杀?）: $(echo $orphans)" >&2
  echo "[run_arm] 等它们结束或 kill 掉后再续跑。" >&2
  exit 4
fi
rm -f "$DIR"/c-*.pid

# ---------- 清单 ----------
if [ -f "$MANIFEST" ]; then
  if ! diffs=$(manifest_diff); then
    echo "[run_arm] ERROR: manifest 不一致（换配置请换 TAG），不运行任何分片:" >&2
    echo "$diffs" >&2
    exit 2
  fi
else
  if has_prior_output; then
    die 2 "$DIR 已有分片/合并文件却没有 manifest.json（被删了?）→ 无法确认它们是哪个配置跑的，拒绝续跑。换 TAG，或清空该目录后重跑。"
  fi
  printf '%s\n' "$CUR_MANIFEST" > "$DIR/manifest.json.tmp.$$" && mv -f "$DIR/manifest.json.tmp.$$" "$MANIFEST" || die 1 "写清单失败"
  log "写入 $MANIFEST"
fi

# ---------- worker 环境 ----------
if [ -n "$KNOBS_STR" ]; then export L6_KNOBS="$KNOBS_STR"; else unset L6_KNOBS; fi
if [ -n "$MODS_STR" ]; then export MODS="$MODS_STR"; else unset MODS; fi
if [ "$EVAL_CRN" = 1 ]; then export EVAL_CRN=1; else unset EVAL_CRN; fi
if [ -n "$EVAL_RP_K" ]; then export EVAL_RP_K; else unset EVAL_RP_K; fi

DRIFT=""
check_drift() {  # 引擎在运行中变了 → 设 DRIFT 并返回 0
  local h d
  h=$(git_head) || h=""
  if [ "$h" != "$ENGINE_COMMIT" ]; then DRIFT="引擎 HEAD ${ENGINE_COMMIT:-none} → ${h:-none}"; return 0; fi
  if [ "$ENGINE_CLEAN" = true ]; then
    d=$(git_dirty)
    if [ -n "$d" ]; then DRIFT="引擎工作树变脏: $(printf '%s' "$d" | head -3 | tr '\n' ' ')"; return 0; fi
  fi
  return 1
}

launch_chunk() {  # $1=s $2=e
  local s=$1 e=$2 b="$DIR/c-$1-$2" pid
  rm -f -- "$b.jsonl" "$b.jsonl.tmp" "$b.jsonl.done" "$b.jsonl.done.tmp" "$b".jsonl.meta.jsonl* "$b".meta.jsonl*
  printf '\n=== %s launch boot=%s attempt#%d: timeout -s KILL %d node %s %s %s %s %s %s %s ===\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BOOT_ID" "$(( $(n_attempts "$s" "$e") + 1 ))" "$TMO" "$WORKER" "$NN" "$LO" "$s" "$e" "$b.jsonl" "$SEED" >> "$b.log"
  ( cd "$ENGINE_ROOT" && exec timeout --signal=KILL "$TMO" node "$WORKER" "$NN" "$LO" "$s" "$e" "$b.jsonl" "$SEED" ) >> "$b.log" 2>&1 < /dev/null &
  pid=$!
  RUN[$pid]="$s $e"
  echo "$BOOT_ID $pid" > "$b.pid"
}

QUEUE=()
N_LAUNCHED=0; N_OK=0; N_BAD=0
finish_chunk() {  # $1=pid $2=rc
  local pid=$1 rc=$2 s e b n rc_note
  read -r s e <<< "${RUN[$pid]}"; unset "RUN[$pid]"
  b="$DIR/c-$s-$e"; rm -f "$b.pid"
  (( SHUTTING_DOWN )) && return 0
  # 该片运行期间引擎漂移过 → 它可能读到了新代码（worker 启动时加载引擎、首个 L6 决策才懒加载 NN、
  # EVAL_RP_K 池 worker 构造时再读 ai_worker.js/sim.js）→ 作废（删 .done → PENDING），不计 attempts。
  if [ -n "$DRIFT" ] || check_drift; then
    rm -f -- "$b.jsonl.done"
    log "✗ c-$s-$e rc=$rc 结束时引擎已漂移（$DRIFT）→ 作废该片结果（不计 attempts），恢复引擎后续跑会重跑它"
    return 0
  fi
  if (( rc == 0 )) && is_complete "$s" "$e"; then
    N_OK=$((N_OK + 1)); log "✓ c-$s-$e"; return 0
  fi
  N_BAD=$((N_BAD + 1))
  (( rc == 137 || rc == 124 )) && rc_note=" (超时 ${TMO}s 或被 KILL)" || rc_note=""
  echo "$BOOT_ID $rc $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$b.attempts"
  n=$(n_attempts "$s" "$e")
  if is_complete "$s" "$e"; then
    log "! c-$s-$e rc=$rc 但分片已 COMPLETE（记 attempt $n，不重跑）"; return 0
  fi
  if (( n >= MAX_ATTEMPTS )); then
    : > "$b.failed"; log "✗ c-$s-$e rc=$rc$rc_note → FAILED（$n 次尝试，见 $b.log）"
  else
    log "✗ c-$s-$e rc=$rc$rc_note（尝试 $n/$MAX_ATTEMPTS）→ 排队重试"; QUEUE+=("$s $e")
  fi
}
reap() {  # 等任一分片结束
  local pid="" rc
  wait -n -p pid 2>/dev/null; rc=$?     # 2>/dev/null: 吞掉 bash 对被 KILL 的后台作业打印的 "Killed …" 提示
  if [ -n "$pid" ] && [ -n "${RUN[$pid]+x}" ]; then finish_chunk "$pid" "$rc"; fi
  # 安全网：已退出但没被 wait -n 报告的
  for pid in "${!RUN[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then wait "$pid" 2>/dev/null; rc=$?; finish_chunk "$pid" "$rc"; fi
  done
}

# ---------- 主循环 ----------
for c in "${CHUNKS[@]}"; do
  read -r s e <<< "$c"; chunk_state "$s" "$e"
  [ "$CS" = PENDING ] && QUEUE+=("$s $e")
done
log "$TAG: ${#CHUNKS[@]} 片, 待跑 ${#QUEUE[@]}；JOBS=$JOBS  单片超时 ${TMO}s  engine=$ENGINE_ROOT@${ENGINE_COMMIT:0:12}$( [ "$ENGINE_CLEAN" = true ] || echo ' (dirty)')"
qi=0
while (( qi < ${#QUEUE[@]} )) || (( ${#RUN[@]} > 0 )); do
  while [ -z "$DRIFT" ] && (( qi < ${#QUEUE[@]} && ${#RUN[@]} < JOBS )); do
    if check_drift; then log "✗ $DRIFT → 停止派发新分片，等待在跑的 ${#RUN[@]} 片结束"; break; fi
    read -r s e <<< "${QUEUE[qi]}"; qi=$((qi + 1))
    launch_chunk "$s" "$e"; N_LAUNCHED=$((N_LAUNCHED + 1))
  done
  if [ -n "$DRIFT" ] && (( ${#RUN[@]} == 0 )); then break; fi
  (( ${#RUN[@]} > 0 )) && reap
done

log "本次启动 $N_LAUNCHED 次（成功 $N_OK，失败 $N_BAD）"
summarize
if [ -n "$DRIFT" ]; then
  echo "[run_arm] ERROR: $DRIFT — 结果无法归属到清单里的提交；恢复引擎或换 TAG" >&2
  exit 2
fi
(( N_COMPLETE == ${#CHUNKS[@]} )) || exit 3

# ---------- 合并 ----------
tmp="$DIR/merged.jsonl.tmp.$$"; : > "$tmp" || die 1 "写 $tmp 失败"
mtmp="$DIR/merged.meta.jsonl.tmp.$$"; : > "$mtmp" || die 1 "写 $mtmp 失败"
nomsg=0
for c in "${CHUNKS[@]}"; do
  read -r s e <<< "$c"
  cat "$DIR/c-$s-$e.jsonl" >> "$tmp" || die 3 "合并 c-$s-$e 失败"
  if [ -f "$DIR/c-$s-$e.jsonl.meta.jsonl" ]; then cat "$DIR/c-$s-$e.jsonl.meta.jsonl" >> "$mtmp"
  elif [ -f "$DIR/c-$s-$e.meta.jsonl" ]; then cat "$DIR/c-$s-$e.meta.jsonl" >> "$mtmp"
  else nomsg=$((nomsg + 1)); fi
done
rows=$(wc -l < "$tmp")
if (( rows != GAMES )); then
  echo "[run_arm] ERROR: 合并后 $rows 行 ≠ GAMES=$GAMES（分片缺行尾换行?），未写 merged.jsonl" >&2
  exit 3
fi
mv -f "$tmp" "$DIR/merged.jsonl" && mv -f "$mtmp" "$DIR/merged.meta.jsonl" || die 1 "写合并文件失败"
(( nomsg )) && log "merged.meta.jsonl: $nomsg 片缺侧车，已跳过"
log "→ $DIR/merged.jsonl"
echo "COMPLETE $rows rows"
exit 0
