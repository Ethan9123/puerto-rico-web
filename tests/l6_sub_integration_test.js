// tests/l6_sub_integration_test.js — L6 子决策搜索接入 game.js（第三轮 Stage 5c；window._l6Sub，默认关）
//
// 钉住的性质：
//   (a) 同步路径 ≡ 池路径：一局真实对局（L6 + 3×L5，基础局）里，L6 的每个子决策都经浏览器同一条路径
//       l6SubPick → l6SubSearchPool → PRAIPool.subEval → K=3 个 FakeWorker（tools/_sandbox.js，真实 ai_worker.js + importScripts sim_sub.js）。
//       记下每次搜索的输入状态与每一批 (候选 × perm) 的 worker 值；对局结束后在主线程用同步 PRSub.subEvalBatch / PRSub.subSearch 重算：
//       每批值逐位相同（Object.is）、每次决策的 action/best/switched/gate/nRollouts 相同。
//   (c) 默认 δ：对局完成、至少发生一次切换、每个切换出来的动作在调用点的选项表里且语义合法
//       （建造：买得起/有库存/未拥有；选田：明牌仍在/采石场有剩；卖货：有货且贸易站可收；工匠：自己产出且供应有货；装船：候选之一）、
//       侧车记账（window.__evalGameMeta.sub）各类计数自洽；另起一个 eval_paired_worker（同步路径）检查行完整、meta 有切换、0 闸拒。
//   (b) δ = 1e9（等价 ∞：v 是 reward 差，|d| 远小于 1e9 → 门永不通过，其余计算与默认 δ 完全相同）：
//       EVAL_CRN=1 下整局对局行与 _l6Sub 关闭时**逐字节相同**（2 局，同步路径；另 1 局池路径 EVAL_RP_K=3），
//       且 meta 显示搜索确实跑了（searched>0、rollouts>0、switched=0）——证明接入零副作用、不多取一个环境随机数。
//
//   (e) 浏览器时序：worker 回复按 5/20/90/10/1200/40/15/30 ms 轮转延迟（乱序、有迟到）、maxMs=1000、L5 选角与 subEval 共用同一池：
//       ok 批逐位 == 同步、确有超时、除超时外 0 池错误、每次选角 K 个 worker 都回了根统计（迟到回复没被别的请求收下）。
//   (b) 另比逐局环境流取数（eval_paired_worker 侧车 envDraws）：行相同只抓得到「之后还有重洗」的多取。
//   (a) 另要求 ≥20 批的值随 r 变化（否则逐位比对对 perm 种子 / r 拼回顺序没有区分力）。
//
// 反向验证（均已手工做过，见 Stage 5c 报告）：
//   SUB_TEST_REVERSE=seed → 第 2 个 worker 的 perm 种子错位（permSeed(seed, r) → permSeed(seed, r+7919)）→ (a) 红；
//   在 game.js l6SubPick 里加一个多余的 Math.random() → (b) 红（δ=∞ 的行与关闭时不同）；
//   l6SubAzToGame 的 build 分支把 o.b.id === a 改成 !== → (c) 映射保真红。
//   PRAIPool.subEval 去掉「拿到回复后再对一次钟」（硬上限）→ (d) 硬上限红（修复轮）；
//   SUB_TEST_REVERSE=guard → 去掉 PRAIPool onmessage 的 m.id === slot.cur 守卫 → (e) 红（修复轮）；
//   多余的 Math.random() 只在 G.endTriggered 之后取（最后一次重洗之后）→ 行仍相同、(b) 环境流取数红（修复轮）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createSandbox, createFakeWorkerClass } = require('../tools/_sandbox.js');

const REV = process.env.SUB_TEST_REVERSE || '';
const K = 3;
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('  ok', m); };
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------- (a) + (c)：进程内一局，池路径 ----------------
let FW = createFakeWorkerClass({ forceJS: true, mathSeed: 11 });
if (REV === 'seed') {
  const Base = FW; let made = 0;
  FW = class extends Base {
    constructor(u) { super(u); this._n = made++; }
    // 第 2 个 worker 的 perm 种子错位：permSeed(seed, r) 换成 permSeed(seed, r+7919)（clone 只拷已知字段，
    // 往 state 里塞私有字段改不了 decisionSeed——第一版反向验证就是这样空过的）
    postMessage(m) { if (m && m.type === 'subeval' && this._n === 1) { m = Object.assign({}, m, { rs: m.rs.map(r => r + 7919) }); } super.postMessage(m); }
  };
}
const M = {}; for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
let mr = mulberry32(20260923); M.random = () => mr();
const { sandbox: sb, load, run } = createSandbox({
  beforeLoad: s => {
    s.Math = M;
    s.Worker = FW;
    s.navigator.hardwareConcurrency = K + 1;
    s.location = Object.assign({}, s.location, { href: 'http://localhost/', origin: 'http://localhost', host: 'localhost', hostname: 'localhost', protocol: 'http:' });
    s._nnForceJS = true;
  },
});
for (const f of ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_sub.js']) load(f);
const S = sb.PRSim, X = sb.PRSub;
const Pool = run('PRAIPool');

function bitEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Array.isArray(a[i]) || !Array.isArray(b[i]) || a[i].length !== b[i].length) return false;
    for (let k = 0; k < a[i].length; k++) if (!Object.is(a[i][k], b[i][k])) return false;
  }
  return true;
}

async function inProcess() {
  // 记录器：主线程 subSearchSteps（搜索的输入）、PRAIPool.subEval（每批 worker 值）、l6SubSearchPool（池路径的决策）、
  // l6SubPick（返回值合法性，用调用点传入的 ctx 独立核对——不复用 l6SubAzToGame）
  sb.__rec = { decs: [], illegal: [], mismap: [], switches: 0, calls: 0, lastRes: null };
  run(`(() => {
    const R = __rec;
    let cur = null;
    const _steps = PRSub.subSearchSteps;
    PRSub.subSearchSteps = function (st, opts) {
      const c = PRSim.clone(st); if (st._fid) c._fid = true;
      cur = { st: c, opts: Object.assign({}, opts), batches: [], res: null };
      return _steps.apply(this, arguments);
    };
    const _sub = PRAIPool.subEval;
    PRAIPool.subEval = async function (st, dec, actions, rs, o) {
      const r = await _sub.apply(this, arguments);
      if (cur) cur.batches.push({ dec: JSON.parse(JSON.stringify(dec)), actions: actions.slice(), rs: rs.slice(), r });
      return r;
    };
    const _pool = l6SubSearchPool;
    l6SubSearchPool = async function () { const res = await _pool.apply(this, arguments); R.lastRes = res; if (cur) { cur.res = res; R.decs.push(cur); cur = null; } return res; };
    const _pick = l6SubPick;
    // 独立的 az 编码（字面常数 PASS=-1、采石场=-2，不读 PRSim.AZ_*、不调 game.js 的映射函数）
    const enc = (kind, ret, ctx) => {
      if (kind === 'build') return ret === -1 ? -1 : ctx.options[ret].b.id;
      if (kind === 'settle') { const o = ctx.options[ret]; return o.kind === 'quarry' ? -2 : GOODS.indexOf(o.good); }
      if (kind === 'trade') return ret === L6_SUB_PASS ? -1 : (ret.dest === 'post' ? 10 : 0) + GOODS.indexOf(ret.g);
      if (kind === 'craftbonus') return GOODS.indexOf(ret);
      if (kind === 'captain') return (ret.ship === 'wharf' ? 3 : ret.ship) * 10 + GOODS.indexOf(ret.good);
    };
    l6SubPick = async function (kind, p, ctx, h) {
      R.lastRes = null;
      const ret = await _pick.apply(this, arguments);
      R.calls++;
      if (ret === null) return ret;
      R.switches++;
      // 映射保真：返回的 game 选项编码回去必须恰是搜索切换到的 az 动作
      let e = null; try { e = enc(kind, ret, ctx); } catch (err) {}
      if (!(R.lastRes && R.lastRes.switched && e === R.lastRes.action)) R.mismap.push({ kind, e, want: R.lastRes && R.lastRes.action });
      let legal = false;
      if (kind === 'build') {
        if (ret === -1) legal = true;
        else if (Number.isInteger(ret) && ctx.options[ret]) { const o = ctx.options[ret]; legal = o.cost <= p.money && G.buildingStock[o.b.id] > 0 && !p.buildings.some(b => b.bid === o.b.id); }
      } else if (kind === 'settle') {
        const o = Number.isInteger(ret) ? ctx.options[ret] : null;
        legal = !!o && (o.kind === 'quarry' ? G.quarriesLeft > 0 : G.plantationPool[o.idx] === o.good) && p.plantations.length < 12;
      } else if (kind === 'trade') {
        if (ret === L6_SUB_PASS) legal = true;
        else legal = ctx.opts.indexOf(ret) >= 0 && p.goods[ret.g] > 0 && (ret.dest !== 'house' || (G.tradingHouse.length < 4 && (G.isManned(p, 12) || !G.tradingHouse.includes(ret.g))));
      } else if (kind === 'craftbonus') {
        legal = ctx.available.indexOf(ret) >= 0 && ctx.ownKinds.has(ret) && G.supply[ret] > 0;
      } else if (kind === 'captain') {
        legal = ctx.candidates.indexOf(ret) >= 0 && p.goods[ret.good] > 0;
      }
      if (!legal) R.illegal.push({ kind, ret: JSON.stringify(ret) });
      return ret;
    };
  })()`);
  const out = await run(`(async () => {
    render=function(){}; flyToDest=function(){}; showToast=function(){};
    window._allAIMode = true; window._fastSpectator = true;
    window._aiThinkBudget = { L4:50, L5:100, hardIters:30, hardMs:1e9, expertIters:30, expertMs:1e9, alphaIters:30, alphaMs:1e9 };
    window._aiWorkersK = ${K}; window._aiPoolTimeoutMs = 600000;
    saveGame = function(){}; kvSync = function(){}; clearSave = function(){}; prDeviceId = function(){ return 'test'; };
    // 角色搜索走同步路径（本测试只关心子决策的池路径；worker 不必加载 NN）
    ismctsPickRoleAsync = async function (p, a, t) { return ismctsPickRole(p, a, t); };
    alphazeroPickRoleAsync = async function (p, a) { return alphazeroPickRole(p, a); };
    await loadAIDNA();
    const nnOk = await loadAlphaZeroNN();
    if (!nnOk) throw new Error('NN not loaded');
    const up = await PRAIPool.ensure();
    if (!up || PRAIPool.K !== ${K}) throw new Error('pool not up: K=' + PRAIPool.K);
    window._l6Sub = { kinds: ['build', 'settle', 'trade', 'craftbonus', 'captain'], maxMs: null };   // 无 sync：必须走池
    const meta = {}; window.__evalGameMeta = meta;
    G = new Game(4, 'AI', {});
    G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = i === 1 ? 6 : 5; });
    await runMainLoop();
    return JSON.stringify({ over: !!G.gameOver, meta });
  })()`);
  return JSON.parse(out);
}

// ---------------- (e)：迟到回复 / 超时 / 与角色搜索共用池 ----------------
// (a)(c) 里 FakeWorker 的回复在微任务里到达、角色搜索改成了同步 → subEval 从不超时、也从不和 pickRoleParallel 抢 worker，
// 浏览器路径依赖的两条性质在那里是空洞的：① 超时后迟到的回复不能被下一次请求（下一批 subeval 或一次选角）收下
// （onmessage 的 m.id === slot.cur 守卫 + 超时后清 slot.cur/resolve）；② 超时 → 启发式，不影响之后的请求。
// 这里：回复按固定序列延迟（5/20/90/10/1200/40/15/30 ms 轮转，1200 > 上限 1000 → 必然超时并留下迟到回复，且乱序到达；
// 其余延迟让多数批能在上限内完成 → ok 批足够多，不随机器负载掉到门槛附近）、_l6Sub.maxMs = 1000、L5 选角走同一个池（只把 L6 选角改同步：worker 不必加载 NN）。
// 断言：每个 ok 批与同步 subEvalBatch 逐位相同；至少一次超时；除超时外 0 个池错误（迟到回复被错收会表现为形状错或错值）；
// 选角每次 K 个 worker 全部回了带根统计的 result（迟到的 subeval 回复被选角收下会变成无 stats 的「result」）。
// 时序依赖墙钟 → 计数不固定，只断言下限；正确性断言与时序无关。
async function staleCase() {
  const DELAYS = [5, 20, 90, 10, 1200, 40, 15, 30];
  const Base = createFakeWorkerClass({ forceJS: true, mathSeed: 11 });
  let made = 0;
  class SlowFW extends Base {
    constructor(u) {
      super(u); const n = made++; let hnd = null, c = 0;
      Object.defineProperty(this, 'onmessage', {
        get() { return hnd; },
        set(fn) {
          hnd = typeof fn !== 'function' ? fn : (ev) => {
            const m = ev && ev.data;
            if (m && (m.type === 'result' || m.type === 'error') && m.id != null) { const d = DELAYS[(n + c++) % DELAYS.length]; setTimeout(() => fn(ev), d); }
            else fn(ev);
          };
        },
      });
    }
  }
  const M2 = {}; for (const k of Object.getOwnPropertyNames(Math)) M2[k] = Math[k];
  let mr2 = mulberry32(20260924); M2.random = () => mr2();
  const E = createSandbox({
    beforeLoad: s => {
      s.Math = M2; s.Worker = SlowFW; s.navigator.hardwareConcurrency = K + 1;
      s.location = Object.assign({}, s.location, { href: 'http://localhost/', origin: 'http://localhost', host: 'localhost', hostname: 'localhost', protocol: 'http:' });
      s._nnForceJS = true;
    },
  });
  for (const f of ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_sub.js']) {
    if (f === 'game.js' && REV === 'guard') {
      // 反向验证：去掉 onmessage 的请求 id 守卫（迟到回复会被当前请求收下）
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const bad = src.replace('m.id === slot.cur && slot.resolve', 'slot.resolve');
      if (bad === src) throw new Error('guard mutation did not apply');
      E.run(bad, f);
    } else E.load(f);
  }
  E.sandbox.__rec = { b: [], picks: 0, pickErr: 0, pickBad: 0 };
  E.run(`(() => {
    const R = __rec; let curSt = null;
    const _steps = PRSub.subSearchSteps;
    PRSub.subSearchSteps = function (st, opts) { curSt = PRSim.clone(st); if (st._fid) curSt._fid = true; return _steps.apply(this, arguments); };
    const _sub = PRAIPool.subEval;
    PRAIPool.subEval = async function (st, dec, actions, rs, o) { const r = await _sub.apply(this, arguments); R.b.push({ st: curSt, dec: JSON.parse(JSON.stringify(dec)), actions: actions.slice(), rs: rs.slice(), r }); return r; };
    const _pp = PRAIPool.pickRoleParallel;
    PRAIPool.pickRoleParallel = async function () {
      R.picks++;
      let out;
      try { out = await _pp.apply(this, arguments); } catch (e) { R.pickErr++; throw e; }
      const ls = PRAIPool.lastStats;
      if (!(ls && ls.ok && ls.K === ls.poolK && ls.replies.every(x => Array.isArray(x) && x.length > 0))) R.pickBad++;
      return out;
    };
  })()`);
  const out = await E.run(`(async () => {
    render=function(){}; flyToDest=function(){}; showToast=function(){};
    window._allAIMode = true; window._fastSpectator = true;
    window._aiThinkBudget = { L4:50, L5:100, hardIters:30, hardMs:1e9, expertIters:30, expertMs:1e9, alphaIters:30, alphaMs:1e9 };
    window._aiWorkersK = ${K}; window._aiPoolTimeoutMs = 600000;
    saveGame = function(){}; kvSync = function(){}; clearSave = function(){}; prDeviceId = function(){ return 'test'; };
    alphazeroPickRoleAsync = async function (p, a) { return alphazeroPickRole(p, a); };   // L6 选角同步；L5 选角走池（与 subEval 交错）
    await loadAIDNA();
    if (!(await loadAlphaZeroNN())) throw new Error('NN not loaded');
    if (!(await PRAIPool.ensure()) || PRAIPool.K !== ${K}) throw new Error('pool not up');
    window._l6Sub = { kinds: ['build', 'settle', 'trade', 'craftbonus', 'captain'], maxMs: 1000 };
    const meta = {}; window.__evalGameMeta = meta;
    G = new Game(4, 'AI', {});
    G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = i === 1 ? 6 : 5; });
    await runMainLoop();
    return JSON.stringify({ over: !!G.gameOver, meta });
  })()`);
  const g = JSON.parse(out), R = E.sandbox.__rec, XE = E.sandbox.PRSub;
  let okB = 0, eq = 0, tmo = 0, fail = 0; const bad = [], errs = [];
  for (const b of R.b) {
    if (!b.r || !b.r.ok) { if (b.r && b.r.timeout) tmo++; else { fail++; errs.push(b.r && b.r.error); } continue; }
    okB++;
    if (bitEq(b.r.values, XE.subEvalBatch(b.st, b.dec, b.actions, b.rs, { fid: true }))) eq++;
    else bad.push({ kind: b.dec.type, A: b.actions.length, R: b.rs.length });
  }
  for (const s of E.run('PRAIPool')._slots) { try { s.w.terminate(); } catch (e) {} }
  const sub = g.meta.sub || {};
  let st = 0; for (const k of Object.keys(sub)) st += sub[k].timeouts;
  return { over: g.over, batches: R.b.length, okB, eq, tmo, fail, bad: bad.slice(0, 3), errs: errs.slice(0, 3), picks: R.picks, pickErr: R.pickErr, pickBad: R.pickBad, subTimeouts: st };
}

// ---------------- (b) + (c)：子进程 eval_paired_worker ----------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'l6sub-'));
const BUDGET = { L4: 50, L5: 100, hardIters: 60, hardMs: 1e9, expertIters: 40, expertMs: 1e9, alphaIters: 40, alphaMs: 1e9 };
const ALL = ['build', 'settle', 'trade', 'craftbonus', 'captain'];
function evalRun(tag, knobs, g0, g1, extraEnv) {
  const out = path.join(TMP, tag + '.jsonl');
  execFileSync('node', [path.join(ROOT, 'tools/eval_paired_worker.js'), 'DEPLOY', '5', String(g0), String(g1), out, '20261123'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
    env: Object.assign({}, process.env, { EVAL_CRN: '1', L6_KNOBS: JSON.stringify(knobs) }, extraEnv || {}),
  });
  const rows = fs.readFileSync(out, 'utf8');
  const meta = fs.readFileSync(out + '.meta.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  return { rows, meta };
}
function subTotals(meta) {
  const t = { decisions: 0, searched: 0, switched: 0, rollouts: 0, timeouts: 0, rejects: 0, single: 0, poolFail: 0, ms: 0 };
  for (const m of meta) for (const k of Object.keys((m.extra && m.extra.sub) || {})) for (const f of Object.keys(t)) t[f] += m.extra.sub[k][f] || 0;
  return t;
}

(async () => {
  const t0 = Date.now();
  // ---- (a) (c) 进程内 ----
  const g = await inProcess();
  const R = sb.__rec;
  ok(g.over, '(c) 进程内池路径对局完成');
  const searched = R.decs.length;
  ok(searched >= 5, `(a) 池路径实际搜索的决策数 ${searched}（须 ≥5，非空洞）`);
  let batchEq = 0, batchN = 0, decEq = 0, badEx = null, rVary = 0;
  for (const d of R.decs) {
    for (const b of d.batches) {
      batchN++;
      const want = X.subEvalBatch(d.st, b.dec, b.actions, b.rs, { fid: true });
      if (b.r && b.r.ok && bitEq(b.r.values, want)) batchEq++;
      else if (!badEx) badEx = { kind: b.dec.type, actions: b.actions.length, rs: b.rs.length };
      // 值随 r 变化的批：只有这些批能区分「perm 种子 / r 的拼回顺序」错没错（值与 r 无关的批——如终局前、
      // 牌堆顺序已无影响——换什么 r 映射都照样逐位相同；审查实测两种不同的变异都恰好剩 37/71 相符）
      if (want.some(row => row.some(v => !Object.is(v, row[0])))) rVary++;
    }
    const s = X.subSearch(d.st, d.opts);
    const p = d.res;
    if (p && s.action === p.action && s.best === p.best && s.switched === p.switched && s.nRollouts === p.nRollouts
      && Object.is(s.gate.mean, p.gate.mean) && Object.is(s.gate.se, p.gate.se) && s.gate.n === p.gate.n && !p.timedOut && !p.poolFail) decEq++;
  }
  ok(batchN > 0 && batchEq === batchN, `(a) 每批 (候选 × perm) 的 worker 值 == 主线程同步 subEvalBatch（逐位）：${batchEq}/${batchN}` + (badEx ? ' 首个不符 ' + JSON.stringify(badEx) : ''));
  ok(rVary >= 20, `(a) 值随 r 变化的批 ${rVary}/${batchN}（须 ≥20：逐位比对对 perm 种子 / r 拼回顺序有区分力，非空洞）`);
  ok(decEq === searched, `(a) 每次决策（action/best/switched/gate/nRollouts）池路径 == 同步 subSearch：${decEq}/${searched}`);
  const kindsSeen = new Set(R.decs.map(d => d.batches.length ? d.batches[0].dec.type : null));
  ok(kindsSeen.size >= 3, `(a) 覆盖的子决策种类 ${[...kindsSeen].join(',')}（须 ≥3）`);
  ok(R.switches >= 1, `(c) 默认 δ 下至少一次切换（${R.switches} 次 / ${R.calls} 次调用）`);
  ok(R.mismap.length === 0, `(c) 每个切换的 game 选项编码回 az == 搜索切换到的动作（不符 ${R.mismap.length}）` + (R.mismap.length ? ' ' + JSON.stringify(R.mismap.slice(0, 3)) : ''));
  ok(R.illegal.length === 0, `(c) 每个切换出的动作都在选项表里且语义合法（非法 ${R.illegal.length}）` + (R.illegal.length ? ' ' + JSON.stringify(R.illegal.slice(0, 3)) : ''));
  {
    const sub = g.meta.sub || {};
    let dec = 0, sea = 0, sw = 0, ro = 0, rej = 0, sgl = 0, tmo = 0, pf = 0, msSum = 0;
    for (const k of Object.keys(sub)) { const x = sub[k]; dec += x.decisions; sea += x.searched; sw += x.switched; ro += x.rollouts; rej += x.rejects; sgl += x.single; tmo += x.timeouts; pf += x.poolFail; msSum += x.ms; }
    ok(dec > 0 && dec === sea + sgl + rej && sea === searched && sw === R.switches && ro > 0 && tmo === 0 && pf === 0,
      `(c) 侧车记账自洽：decisions ${dec} = searched ${sea} + single ${sgl} + rejects ${rej}；switched ${sw}；rollouts ${ro}；timeouts ${tmo}；poolFail ${pf}`);
    console.log(`  [time] FakeWorker K=${K} 池路径：${searched} 次搜索，平均 ${(msSum / Math.max(1, sea)).toFixed(0)} ms/次，${(msSum / Math.max(1, ro)).toFixed(2)} ms/rollout（FakeWorker 串行；真实浏览器并非简单 ÷K，见 game.js l6SubPick 注释的实测）`);
  }
  // (d) 截止 / 池失败 → 启发式；档位上限
  {
    const d = R.decs.find(x => x.batches.length >= 2) || R.decs[0];
    sb.__d = d;
    const r = JSON.parse(await run(`(async () => {
      const d = __d, out = {};
      const pre0 = PRSub.subSearchSteps(d.st, d.opts);
      const a = await l6SubSearchPool(d.st, pre0, l6SubNow());                  // 已到期：一批都不发
      out.expired = { timedOut: a.timedOut, h: a.action === pre0.h, n: a.nRollouts };
      const pre1 = PRSub.subSearchSteps(d.st, d.opts);
      const _se = PRAIPool.subEval;
      PRAIPool.subEval = async function () { return { ok: false, error: 'injected' }; };
      const b = await l6SubSearchPool(d.st, pre1, null);
      PRAIPool.subEval = _se;
      out.poolFail = { poolFail: b.poolFail, h: b.action === pre1.h };
      // 硬上限：截止 = 现在 + 50 ms。发批时还剩 ~50 ms → 真的挂上 50 ms 计时器；FakeWorker 在微任务里串行算完并回复
      // （~100 次 rollout ≫ 50 ms；微任务总在计时器之前）→ 计时器还没机会触发，全部回复就已到齐，但此时已过截止
      // → 必须按超时处理（原实现在这里收下一个截止之后才完成的结果 = 浏览器里主线程忙时的软上限）
      const big = d.batches.slice().sort((x, y) => y.actions.length * y.rs.length - x.actions.length * x.rs.length)[0];
      const tl = l6SubNow();
      const late = await PRAIPool.subEval(d.st, big.dec, big.actions, big.rs, { fid: true, deadline: tl + 50 });
      out.late = { ok: late.ok, timeout: !!late.timeout, el: l6SubNow() - tl, n: big.actions.length * big.rs.length, flag: !!(PRAIPool.lastSubStats && PRAIPool.lastSubStats.late) };
      const saveB = window._aiThinkBudget, saveS = window._l6Sub;
      window._l6Sub = { kinds: ['build'] };
      const cap = (b) => { window._aiThinkBudget = b; return l6SubCapMs(); };
      out.caps = [cap({ subMs: 0 }), cap({ subMs: 600 }), cap({ alphaMs: 600 }), cap({ alphaMs: 2500 }), cap({ alphaMs: 6000 }), cap({ alphaMs: 12000 })];
      window._l6Sub = { kinds: ['build'], maxMs: null }; out.capNull = cap({ subMs: 600 });
      window._aiThinkBudget = saveB; window._l6Sub = saveS;
      return JSON.stringify(out);
    })()`));
    ok(r.expired.timedOut && r.expired.h && r.expired.n === 0, `(d) 截止已到：不发批、timedOut、返回 h（${JSON.stringify(r.expired)}）`);
    ok(r.poolFail.poolFail && r.poolFail.h, `(d) 池求值失败 → poolFail、返回 h（${JSON.stringify(r.poolFail)}）`);
    ok(!r.late.ok && r.late.timeout && r.late.flag && r.late.el > 50, `(d) 硬上限：回复在截止之后才到齐（计时器未及触发）→ 按超时处理、不采用（${JSON.stringify(r.late)}）`);
    ok(JSON.stringify(r.caps) === JSON.stringify([0, 600, 0, 300, 600, 1200]) && r.capNull === null, `(d) 每次子决策上限：subMs 优先、旧存档按 alphaMs 落档、maxMs:null 不限时（${JSON.stringify(r.caps)} / ${r.capNull}）`);
  }
  for (const s of Pool._slots) { try { s.w.terminate(); } catch (e) {} }
  console.log(`  [time] 进程内部分 ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // ---- (e) 迟到回复 / 超时 / 与选角共用池 ----
  if (REV !== 'seed') {
    const te = Date.now();
    const e = await staleCase();
    ok(e.over, '(e) 延迟回复 + maxMs=1000 的对局完成');
    ok(e.okB >= 10 && e.eq === e.okB, `(e) 每个 ok 批与同步 subEvalBatch 逐位相同：${e.eq}/${e.okB}（须 ≥10 批）` + (e.bad.length ? ' 不符 ' + JSON.stringify(e.bad) : ''));
    ok(e.tmo >= 1 && e.subTimeouts >= 1, `(e) 确实发生超时（批 ${e.tmo}，决策 ${e.subTimeouts}）`);
    ok(e.fail === 0, `(e) 除超时外 0 个池错误（迟到回复未被后续请求收下）：${e.fail}` + (e.errs.length ? ' ' + JSON.stringify(e.errs) : ''));
    ok(e.picks >= 10 && e.pickErr === 0 && e.pickBad === 0, `(e) L5 选角走同一池 ${e.picks} 次：抛错 ${e.pickErr}、有 worker 缺根统计 ${e.pickBad}`);
    console.log(`  [time] (e) ${((Date.now() - te) / 1000).toFixed(0)} s：${JSON.stringify({ batches: e.batches, ok: e.okB, timeout: e.tmo })}`);
  }
  if (REV === 'guard') { console.log(fails ? `\nL6 SUB INTEGRATION TEST FAILED: ${fails}` : '\nL6 SUB INTEGRATION TEST OK'); process.exit(fails ? 1 : 0); }

  if (REV === 'seed') { console.log(fails ? `\nL6 SUB INTEGRATION TEST FAILED: ${fails}` : '\nL6 SUB INTEGRATION TEST OK'); process.exit(fails ? 1 : 0); }

  // ---- (b) δ = ∞ 与关闭逐字节相同（同步路径 2 局 + 池路径 1 局）；(c) 默认 δ 的子进程行 ----
  const off = evalRun('off', { _aiThinkBudget: BUDGET }, 0, 2);
  const inf = evalRun('inf', { _aiThinkBudget: BUDGET, _l6Sub: { kinds: ALL, delta: 1e9 } }, 0, 2);
  const ti = subTotals(inf.meta);
  ok(off.rows.split('\n').filter(Boolean).length === 2 && !/error|incomplete/.test(off.rows), '(b) 关闭臂 2 局完整');
  ok(inf.rows === off.rows, '(b) δ=∞ 同步路径：对局行与 _l6Sub 关闭逐字节相同（2 局）');
  // 行相同只能抓到「之后还有弃牌堆重洗」的多取（CRN 下开局后只有 flipPlantations 读环境流）；逐局环境流取数相同抓任何多取
  const ed = (r) => r.meta.map(m => m.envDraws);
  ok(ed(off).every(x => x > 0) && JSON.stringify(ed(inf)) === JSON.stringify(ed(off)), `(b) δ=∞ 同步路径：逐局环境流取数与关闭相同 ${JSON.stringify(ed(inf))} vs ${JSON.stringify(ed(off))}`);
  ok(ti.searched > 0 && ti.rollouts > 0 && ti.switched === 0 && ti.rejects === 0, `(b) δ=∞ 搜索确实跑了且从不切换：${JSON.stringify(ti)}`);
  const offK = evalRun('offK', { _aiThinkBudget: BUDGET }, 2, 3, { EVAL_RP_K: String(K) });
  const infK = evalRun('infK', { _aiThinkBudget: BUDGET, _l6Sub: { kinds: ALL, delta: 1e9 } }, 2, 3, { EVAL_RP_K: String(K) });
  const tk = subTotals(infK.meta);
  ok(infK.rows === offK.rows && !/error|incomplete/.test(offK.rows), '(b) δ=∞ 池路径（EVAL_RP_K=3）：对局行与关闭逐字节相同（1 局）');
  ok(ed(offK).every(x => x > 0) && JSON.stringify(ed(infK)) === JSON.stringify(ed(offK)), `(b) δ=∞ 池路径：逐局环境流取数与关闭相同 ${JSON.stringify(ed(infK))} vs ${JSON.stringify(ed(offK))}`);
  ok(tk.searched > 0 && tk.switched === 0 && tk.poolFail === 0 && tk.timeouts === 0 && !(infK.meta[0].l6.rpBad > 0), `(b) 池路径 δ=∞ 搜索跑了、未切换、无池失败/回退：${JSON.stringify(tk)}`);
  const on = evalRun('on', { _aiThinkBudget: BUDGET, _l6Sub: { kinds: ALL } }, 0, 1);
  const to = subTotals(on.meta);
  ok(!/error|incomplete/.test(on.rows) && on.rows.split('\n').filter(Boolean).length === 1, '(c) 默认 δ 同步路径（eval_paired_worker）对局完整');
  ok(to.switched >= 1 && to.rejects === 0 && to.decisions === to.searched + to.single + to.rejects, `(c) 默认 δ 侧车：有切换、0 闸拒、计数自洽：${JSON.stringify(to)}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log(`  [time] 合计 ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(fails ? `\nL6 SUB INTEGRATION TEST FAILED: ${fails}` : '\nL6 SUB INTEGRATION TEST OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
