// ============================================================
// tools/heur_parity.js — sim 子决策启发式 ↔ game.js 真实 AI 的逐决策对照（第三轮 Stage 4）
// ============================================================
// 为什么要有：L6 角色搜索的每一次 rollout、以及因子化(az)层的子决策续局，都靠 sim.js 的子决策启发式
// 去「扮演」所有玩家的建造/选田/装船/派工/卖货/工匠选货。它和 game.js 真实 AI 逐行对照有若干处分歧
// （AI_STRENGTH §18.1 #6）。Stage 5 的子决策搜索要在 sim 里预演真实对手，模型不忠实 = 搜错东西。
// 本工具在**真实对局**里、在每一个 AI 子决策的调用点，用 game.js simStateAtSubDecision 重建该点的 sim 状态，
// 分别以 st._fid 关/开跑 sim 启发式（azHeuristicAction；市长用 sim reallocate），与 game.js 实际走的一手比较。
//
// 对局设置与 tools/eval_paired_worker.js 逐项相同（4 人、1×L6 + 3×L5、DEPLOY 权重、带种子的 Math、
// 迭代数限定的预算、每局一行同格式 JSON）→ 本工具写出的对局行可以直接与 eval_paired_worker 的输出 cmp。
//
// 用法：
//   node tools/heur_parity.js [games=40] [seedBase=20261201] [rows.jsonl] [--g0 N] [--iters N] [--players N] [--report r.json] [--no-hooks]
//   node tools/heur_parity.js --merge r1.json r2.json ...      合并分片报告并打印总表
//   --no-hooks ：不装任何钩子，只写对局行（用于「钩子不扰动对局」的 cmp 证明）
//   --iters N  ：L5 expertIters 与 L6 alphaIters（默认 400，与 eval_paired_worker 相同；hardIters 固定 60）
//   --players N：人数（默认 4 = eval_paired_worker 口径，对局行可 cmp）。2/3/5 人局用于人数相关的保真检查——
//                game.js gamePhase 的殖民者分母在 1/2 人局与 sim COL_TOTAL 不同，4 人对照测不出（见 sim.js fidPhase）。
//                非 4 人时对局行多带 n 字段（4 人时行格式与旧版逐字节相同）。
//
// 钩子卫生（保证对局逐字节不变）：
//   * 所有钩子在原函数**返回之后**才运行，且只读 G（重建走 buildSimState 快照；sim 侧全部在拷贝上跑）；
//   * 钩子运行期间 Math.random 被切到一条独立的丢弃流，并计数（sim 在阶段收尾翻明牌时可能重洗弃牌堆，
//     那会消耗 st.rnd = Math.random —— 若不隔离就会扰动环境流）；
//   * 证明：同参数分别跑带钩子与 --no-hooks，两份对局行 cmp 必须一致（见 AI_STRENGTH §18 Stage 4）。
//
// 输出：每类（build / settle / captain / mayor / trade / craftbonus）× 座位类（L6 / L5）：
//   n、闸拒数（az 动作集合 ≠ game.js 选项集合 → 重建不可信，不计入分歧）、fid 关/开的分歧率、fid 开残差的原因标签。
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./_sandbox.js');

const KINDS = ['build', 'settle', 'captain', 'mayor', 'trade', 'craftbonus'];

// ---------------- 报告合并 / 打印 ----------------
function emptyCell() { return { n: 0, gate: 0, dOff: 0, dOn: 0, tagsOn: {}, tagsOff: {}, ex: [] }; }
function mergeInto(A, B) {
  for (const k of Object.keys(B.kinds)) for (const c of Object.keys(B.kinds[k])) {
    const a = ((A.kinds[k] = A.kinds[k] || {})[c] = A.kinds[k][c] || emptyCell()), b = B.kinds[k][c];
    a.n += b.n; a.gate += b.gate; a.dOff += b.dOff; a.dOn += b.dOn;
    for (const t in b.tagsOn) a.tagsOn[t] = (a.tagsOn[t] || 0) + b.tagsOn[t];
    for (const t in b.tagsOff) a.tagsOff[t] = (a.tagsOff[t] || 0) + b.tagsOff[t];
    for (const e of b.ex) if (a.ex.length < 12) a.ex.push(e);
  }
  A.games += B.games; A.hookRand += B.hookRand; A.hookErr += B.hookErr;
  for (const e of B.hookErrEx || []) if ((A.hookErrEx = A.hookErrEx || []).length < 5) A.hookErrEx.push(e);
  A.personas = (A.personas || 0) + (B.personas || 0);
  return A;
}
const pct = (x, n) => n ? (100 * x / n).toFixed(2) + '%' : '—';
function printTable(R) {
  const lines = [];
  lines.push(`games=${R.games} hookRandCalls=${R.hookRand} hookErrors=${R.hookErr} personaSeats=${R.personas || 0}`);
  lines.push('kind        seat   n      gateNull(rate)     dis fid-off   dis fid-on   residual tags (fid-on) || fid-off tags');
  for (const k of KINDS) {
    const cells = R.kinds[k] || {};
    for (const c of ['L6', 'L5']) {
      const x = cells[c]; if (!x) continue;
      const m = x.n - x.gate;
      const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t}:${v}`).join(' ');
      const tags = (fmt(x.tagsOn) || '-') + ' || ' + (fmt(x.tagsOff) || '-');
      lines.push(`${k.padEnd(11)} ${c.padEnd(5)} ${String(x.n).padEnd(6)} ${String(x.gate).padStart(4)} (${pct(x.gate, x.n).padStart(6)})    ${String(x.dOff).padStart(4)}=${pct(x.dOff, m).padStart(7)}   ${String(x.dOn).padStart(4)}=${pct(x.dOn, m).padStart(7)}   ${tags}`);
    }
  }
  return lines.join('\n');
}

// ---------------- 沙盒内主体（序列化后送进 vm；只用沙盒全局）----------------
function sandboxMain(CFG) {
  return (async () => {
    render = function () {}; flyToDest = function () {}; showToast = function () {};
    window._allAIMode = true; window._fastSpectator = true;
    window._aiThinkBudget = { L4: 50, L5: 100, hardIters: 60, hardMs: 1e9, expertIters: CFG.iters, expertMs: 1e9, alphaIters: CFG.iters, alphaMs: 1e9 };
    await loadAIDNA();
    const nnOk = await loadAlphaZeroNN();
    if (!nnOk || !(PRSim.isLoaded && PRSim.isLoaded())) throw new Error('NN 未加载 → L6 会回退 L5, 测量无意义');

    const R = { games: 0, hookRand: 0, hookErr: 0, hookErrEx: [], personas: 0, kinds: {} };
    const cell = (k, p) => { const c = p._aiLevel === 6 ? 'L6' : 'L5'; const K = (R.kinds[k] = R.kinds[k] || {}); return (K[c] = K[c] || { n: 0, gate: 0, dOff: 0, dOn: 0, tagsOn: {}, tagsOff: {}, ex: [] }); };
    const bump = (o, t) => { o[t] = (o[t] || 0) + 1; };
    // 一次比较：game = game.js 实际动作；off/on = sim 启发式（fid 关/开）；tag(sim) → 原因标签
    function record(k, p, game, off, on, tag, detail) {
      const c = cell(k, p); c.n++;
      if (off !== game) { c.dOff++; bump(c.tagsOff, tag(off)); }
      if (on !== game) {
        c.dOn++; bump(c.tagsOn, tag(on));
        if (c.ex.length < 12) c.ex.push(Object.assign({ g: curG, turn: G.turnNumber, seat: p.idx, lvl: p._aiLevel, game, off, on, phase: gamePhase() }, detail ? detail() : {}));
      }
    }
    function gateNull(k, p) { const c = cell(k, p); c.n++; c.gate++; }
    function hook(fn) {
      __hookEnter();
      try { fn(); } catch (e) { R.hookErr++; if (R.hookErrEx.length < 5) R.hookErrEx.push(String((e && e.stack) || e).slice(0, 400)); }
      finally { R.hookRand += __hookExit(); }
    }
    const heur = (st, dec) => PRSim.azHeuristicAction(st, dec);
    const fidClone = (st) => { const c = PRSim.clone(st); c._fid = true; return c; };

    let curG = -1, phaseStart = null;
    const settleLen0 = {};
    if (CFG.hooks) {
      // 角色阶段起点的 gamePhase()：旧 sim 的 doBuilder/doCaptain 在阶段开头固定一次阶段 → fid 关的忠实建模
      const _runRolePhase = runRolePhase;
      runRolePhase = async function (roleName) { phaseStart = gamePhase(); return _runRolePhase.apply(this, arguments); };

      // ---- 建造 ----
      const _aiPickBuilding = aiPickBuilding;
      aiPickBuilding = function (p, options, isChooser) {
        const r = _aiPickBuilding.apply(this, arguments);
        hook(() => {
          const game = r < 0 ? PRSim.AZ_PASS : options[r].b.id;
          const rb = simStateAtSubDecision('build', p, { options });
          if (!rb) return gateNull('build', p);
          const sOff = PRSim.clone(rb.st); sOff.az._bphase = phaseStart;
          const off = heur(sOff, rb.dec), on = heur(fidClone(rb.st), rb.dec);
          const tag = (s) => (game < 0 ? 'gPASS' : 'gB') + '/' + (s < 0 ? 'sPASS' : 'sB');
          record('build', p, game, off, on, tag, () => ({ money: p.money, opts: options.map(o => o.b.id).join(',') }));
        });
        return r;
      };

      // ---- 拓殖（选田/采石场）----
      const _doSettler = doSettler;
      doSettler = async function (i) { settleLen0[i] = G.players[i].plantations.length; return _doSettler.apply(this, arguments); };
      const _aiPickPlantation = aiPickPlantation;
      aiPickPlantation = function (p, options, isChooser) {
        const r = _aiPickPlantation.apply(this, arguments);
        hook(() => {
          const o = options[r];
          const game = o.kind === 'quarry' ? PRSim.AZ_QUARRY : GOODS.indexOf(o.good);
          const rb = simStateAtSubDecision('settle', p, { options, isChooser });
          if (!rb) return gateNull('settle', p);
          // fid 关的 sim 在**选完之后**才抽庄园 → 其决策时刻看不到这张暗牌：把它退回牌堆顶再评估
          const sOff = PRSim.clone(rb.st);
          const drew = p.plantations.length - (settleLen0[p.idx] != null ? settleLen0[p.idx] : p.plantations.length);
          // 同时撤掉「庄园已抽」游标 az.hac（重建时置为 oi）：牌已退回，fid 关续跑时应在选完后照旧抽
          if (drew === 1) { const sp = sOff.players[p.idx]; sOff.plantationDeck.push(sp.plantations.pop().good); delete sOff.az.hac; }
          const off = heur(sOff, rb.dec), on = heur(fidClone(rb.st), rb.dec);
          const Q = PRSim.AZ_QUARRY;
          const tag = (s) => (game === Q ? 'gQ' : 'gP') + '/' + (s === Q ? 'sQ' : 'sP') + (drew === 1 ? '+hac' : '');
          record('settle', p, game, off, on, tag, () => ({ isChooser, pool: options.map(x => x.kind === 'quarry' ? 'Q' : x.good).join(',') }));
        });
        return r;
      };

      // ---- 装船（借 solverPickCaptain 调用点拿 doCaptain 循环态；默认直接返回 null）----
      let capCtx = null;
      const _solverPickCaptain = solverPickCaptain;
      solverPickCaptain = function (p, candidates, chooserIdx, order, passProgressed, chooserBonusUsedSet) {
        capCtx = { p, candidates, chooserIdx, order, passProgressed, chooserBonusUsedSet };
        return _solverPickCaptain.apply(this, arguments);
      };
      const _rankCaptainForAI = rankCaptainForAI;
      rankCaptainForAI = function (candidates) {
        const res = _rankCaptainForAI.apply(this, arguments);
        const c = capCtx; capCtx = null;
        if (c && c.candidates === candidates) hook(() => {
          const p = c.p;
          const game = captainCandCode(res[0]);
          const rb = simStateAtSubDecision('captain', p, { candidates, chooserIdx: c.chooserIdx, order: c.order, passProgressed: c.passProgressed, chooserBonusUsedSet: c.chooserBonusUsedSet, cphase: phaseStart });
          if (!rb) return gateNull('captain', p);
          const off = heur(PRSim.clone(rb.st), rb.dec), on = heur(fidClone(rb.st), rb.dec);
          const tag = (s) => (Math.floor(game / 10) === Math.floor(s / 10) ? 'sameShip' : 'ship') + '/' + (game % 10 === s % 10 ? 'sameGood' : 'good') + (phaseStart !== gamePhase() ? '+phaseMoved' : '');
          record('captain', p, game, off, on, tag, () => ({ phaseStart, cands: candidates.map(captainCandCode).join(',') }));
        });
        return res;
      };

      // ---- 市长派工：调用前深拷贝，比较最终上岗格局 ----
      const _aiReallocate = aiReallocate;
      aiReallocate = function (p) {
        const before = JSON.parse(JSON.stringify({ plantations: p.plantations, buildings: p.buildings, u: p._unplacedMen || 0, un: p._unplacedNobles || 0, vp: p.vp, money: p.money, goods: p.goods }));
        const r = _aiReallocate.apply(this, arguments);
        hook(() => {
          const mk = () => ({ idx: p.idx, money: before.money, vp: before.vp, shippingVP: 0, goods: Object.assign({}, before.goods),
            plantations: before.plantations.map(pl => ({ good: pl.good, manned: !!pl.manned, noble: !!pl.noble })),
            buildings: before.buildings.map(b => ({ bid: b.bid, men: b.men, nobles: b.nobles || 0 })), unplaced: before.u, unplacedNobles: before.un });
          const sig = (pls, bs, u) => pls.map(x => x.manned ? 1 : 0).join('') + '|' + bs.map(b => b.men).join(',') + '|' + u;
          const sOff = mk(); PRSim._internal.reallocate(sOff, false);
          const sOn = mk(); PRSim._internal.reallocate(sOn, true);
          const game = sig(p.plantations, p.buildings, p._unplacedMen || 0);
          const tag = (s) => {
            const [gp, gb, gu] = game.split('|'), [sp, sb, su] = s.split('|');
            return (gp !== sp ? 'plant' : '') + (gb !== sb ? 'bld' : '') + (gu !== su ? 'shore' : '');
          };
          record('mayor', p, game, sig(sOff.plantations, sOff.buildings, sOff.unplaced), sig(sOn.plantations, sOn.buildings, sOn.unplaced), tag,
            () => ({ before: sig(before.plantations, before.buildings, before.u), u: before.u, bids: before.buildings.map(b => b.bid).join(','), goods: before.plantations.map(x => x.good[0] + x.good[1]).join(',') }));
        });
        return r;
      };

      // ---- 卖货 ----
      const _aiPickTrade = aiPickTrade;
      aiPickTrade = function (p, opts) {
        const res = _aiPickTrade.apply(this, arguments);
        hook(() => {
          const card = G.roleCards.find(x => x.name === 'Trader');
          const isChooser = !!card && card.takenBy === p.idx;
          const game = (res.dest === 'post' ? 10 : 0) + GOODS.indexOf(res.g);
          const rb = simStateAtSubDecision('trade', p, { opts, isChooser });
          if (!rb) return gateNull('trade', p);
          const off = heur(PRSim.clone(rb.st), rb.dec), on = heur(fidClone(rb.st), rb.dec);
          record('trade', p, game, off, on, (s) => s === PRSim.AZ_PASS ? 'sPASS' : 'good');
        });
        return res;
      };

      // ---- 工匠特权选货 ----
      const _aiPickCraftBonus = aiPickCraftBonus;
      aiPickCraftBonus = function (chooser, available, ownKinds) {
        const res = _aiPickCraftBonus.apply(this, arguments);
        hook(() => {
          const game = GOODS.indexOf(res);
          const rb = simStateAtSubDecision('craftbonus', chooser, { available, ownKinds });
          if (!rb) return gateNull('craftbonus', chooser);
          const off = heur(PRSim.clone(rb.st), rb.dec), on = heur(fidClone(rb.st), rb.dec);
          record('craftbonus', chooser, game, off, on, () => 'good');
        });
        return res;
      };
    }

    const N = CFG.players || 4;
    for (let g = CFG.g0; g < CFG.g0 + CFG.games; g++) {
      const seed = (CFG.seedBase + g * 1000003) >>> 0;
      const seat = g % N;
      curG = g;
      let row;
      try {
        __setSeed(seed);
        const levels = new Array(N).fill(CFG.lo); levels[seat] = 6;
        G = new Game(N, 'AI', {});
        G.players.forEach((p, i) => { p.isHuman = false; loadDNA(p, i); p._aiLevel = levels[i]; });
        R.personas += G.players.filter(p => p._persona).length;
        await runMainLoop();
        if (!G.gameOver) row = { g, seed, seat, lo: CFG.lo, incomplete: true };
        else {
          const totals = G.players.map(p => p.vp + p.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].vp, 0) + G.getSpecialVPs(p));
          const best = Math.max(...totals);
          const winnerCount = totals.filter(t => t === best).length;
          const win = totals[seat] === best ? 1 / winnerCount : 0;
          let loSum = 0; for (let i = 0; i < N; i++) if (i !== seat) loSum += totals[i];
          row = { g, seed, seat, lo: CFG.lo, win, hi: totals[seat], loAvg: Math.round(loSum / (N - 1) * 100) / 100, totals };
          if (N !== 4) row.n = N;
        }
      } catch (e) {
        row = { g, seed, seat, lo: CFG.lo, error: String((e && e.message) || e).slice(0, 300) };
      }
      __writeRow(JSON.stringify(row));
      R.games++;
      __progress('[heur_parity] game ' + g + ' done');
    }
    return JSON.stringify(R);
  })();
}

// ---------------- CLI ----------------
function parseArgs(argv) {
  const pos = [], o = { g0: 0, iters: 400, report: null, hooks: true, merge: null, lo: 5, players: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--g0') o.g0 = parseInt(argv[++i]);
    else if (a === '--iters') o.iters = parseInt(argv[++i]);
    else if (a === '--players') o.players = parseInt(argv[++i]);
    else if (a === '--report') o.report = argv[++i];
    else if (a === '--no-hooks') o.hooks = false;
    else if (a === '--merge') { o.merge = argv.slice(i + 1); break; }
    else pos.push(a);
  }
  o.games = parseInt(pos[0] || '40');
  o.seedBase = parseInt(pos[1] || '20261201');
  o.out = pos[2] || null;
  return o;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 供测试复用：跑一段对局，返回 { R, rows }
async function runParity(o) {
  let _rng = Math.random, _saved = null, hookCalls = 0;
  const MathSeeded = {};
  for (const k of Object.getOwnPropertyNames(Math)) MathSeeded[k] = Math[k];
  MathSeeded.random = () => _rng();
  const rows = [];
  const { run } = loadEngine({
    files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js', 'sim_solve.js'],
    beforeLoad: sb => {
      sb.Math = MathSeeded;
      sb.__setSeed = s => { _rng = mulberry32(s >>> 0); };
      sb.__writeRow = json => { rows.push(json); };
      // 钩子期间：环境流暂存，换成独立丢弃流并计数；退出时恢复（返回本次钩子内的调用次数）
      const hookStream = mulberry32(0xC0FFEE);
      sb.__hookEnter = () => { _saved = _rng; hookCalls = 0; _rng = () => { hookCalls++; return hookStream(); }; };
      sb.__hookExit = () => { _rng = _saved; _saved = null; return hookCalls; };
      sb.__progress = msg => { if (o.verbose) console.log(msg); };
    },
  });
  const CFG = { games: o.games, g0: o.g0, seedBase: o.seedBase, iters: o.iters, hooks: o.hooks, lo: o.lo, players: o.players || 4 };
  const raw = await run(`(${sandboxMain.toString()})(${JSON.stringify(CFG)})`);
  return { R: JSON.parse(raw), rows };
}

module.exports = { runParity, mergeInto, printTable, KINDS };

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  if (o.merge) {
    let R = { games: 0, hookRand: 0, hookErr: 0, kinds: {} };
    for (const f of o.merge) R = mergeInto(R, JSON.parse(fs.readFileSync(f, 'utf8')));
    console.log(printTable(R));
    process.exit(0);
  }
  o.verbose = true;
  const t0 = Date.now();
  runParity(o).then(({ R, rows }) => {
    if (o.out) { fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true }); fs.writeFileSync(o.out, rows.map(r => r + '\n').join('')); }
    if (o.report) fs.writeFileSync(o.report, JSON.stringify(R, null, 1));
    if (o.hooks) console.log(printTable(R));
    console.log(`[heur_parity] g=[${o.g0},${o.g0 + o.games}) seedBase=${o.seedBase} iters=${o.iters} players=${o.players} hooks=${o.hooks ? 1 : 0} rows=${rows.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }).catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
}
