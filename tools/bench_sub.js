#!/usr/bin/env node
// tools/bench_sub.js — 第三轮 Stage 5a：子决策 rollout 搜索（sim_sub.js）的吞吐与切换率基准
//
// 做法：纯启发式 sim 自对弈（4 人，azDecision/azHeuristicAction 驱动），收集所有**子决策**点
// （build / settle / trade / craftbonus / captain），每类最多取 --per-kind 个多候选局面（均匀抽样），
// 按默认设置跑 PRSub.subSearch，报告每类：
//   单候选占比、平均候选数、每次 subSearch 的 ms（均值 / p50 / p90 / max）、每次 rollout 数、
//   rollouts/s、c*≠h 比例、切换率（通过门）、门的平均差值。
// 说明：
//   * 这是**描述性**基准，不是 census（census 在 5b，用 L6 真实对局的子决策、seedBase 20261123 g100–159）。
//     这里的局面来自启发式自对弈，所以切换率只说明「模型认为启发式在这些局面上可改进的频率」，
//     不等于真实收益（§13.9 的前瞻在模型里也「赢」，真实对局 −11.8pp）。
//   * 默认种子 20260923 与 census / 评测种子不相交。
//   * 计时受机器负载影响（同机有别的重进程时偏慢），报告里打印 loadavg。
//
// 用法：node tools/bench_sub.js [--games 8] [--seed 20260923] [--per-kind 40] [--fid] [--bsel 160] [--gate 48] [--json out.json]
'use strict';
const os = require('os');
const fs = require('fs');
const { loadEngine } = require('./_sandbox.js');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const GAMES = +arg('games', 8), SEED = +arg('seed', 20260923), PER_KIND = +arg('per-kind', 40);
const FID = flag('fid'), BSEL = +arg('bsel', 160), GATE = +arg('gate', 48), JSON_OUT = arg('json', null);

const { sandbox, PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_sub.js'] });
const X = sandbox.PRSub;
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const KINDS = ['build', 'settle', 'trade', 'craftbonus', 'captain'];
const pool = {}, singles = {}, totals = {};
for (const k of KINDS) { pool[k] = []; singles[k] = 0; totals[k] = 0; }
for (let g = 0; g < GAMES; g++) {
  const st = S.newState(4, [5, 5, 5, 5], mulberry32(SEED + g));
  for (let guard = 0; guard < 5000; guard++) {
    const d = S.azDecision(st); if (!d) break;
    if (d.type !== 'role') {
      totals[d.type]++;
      if (d.actions.length > 1) pool[d.type].push({ st: S.clone(st), g, turn: st.turnNumber, n: d.actions.length });
      else singles[d.type]++;
    }
    S.azApply(st, S.azHeuristicAction(st, d));
  }
}
// 每类均匀抽样 PER_KIND 个；按类交错执行，让负载波动平均分摊到各类
const picked = {};
for (const k of KINDS) {
  const L = pool[k], m = Math.min(PER_KIND, L.length);
  picked[k] = []; for (let i = 0; i < m; i++) picked[k].push(L[Math.floor(i * L.length / m)]);
}
const res = {}; for (const k of KINDS) res[k] = [];
const maxLen = Math.max(...KINDS.map(k => picked[k].length));
const opts = { bSel: BSEL, gateN: GATE, fid: FID };
const tAll = Date.now();
for (let i = 0; i < maxLen; i++) for (const k of KINDS) {
  const s = picked[k][i]; if (!s) continue;
  const t0 = process.hrtime.bigint();
  const r = X.subSearch(s.st, opts);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  res[k].push({ ms, n: r.nRollouts, nCand: r.nCand, differ: r.best !== r.h, switched: r.switched, gate: r.gate, turn: s.turn, err: r.error || null });
}
const wall = (Date.now() - tAll) / 1000;

const q = (a, p) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const f = (x, d = 1) => (isFinite(x) ? x.toFixed(d) : '—');
const summary = {};
console.log(`bench_sub: games=${GAMES} seed=${SEED} per-kind≤${PER_KIND} bSel=${BSEL} gateN=${GATE} fid=${FID}  loadavg=${os.loadavg().map(x => x.toFixed(2)).join('/')}  cpus=${os.cpus().length}`);
console.log('kind        all  single%  multi  run  nCand   ms/search: mean   p50   p90   max   roll/search  roll/s   c*≠h%  switch%  gate.mean(sw)');
let allMs = 0, allN = 0, allRuns = 0, allSw = 0, allRuns2 = 0;
for (const k of KINDS) {
  const R = res[k];
  const ms = R.map(r => r.ms), n = R.map(r => r.n);
  const sumMs = ms.reduce((a, b) => a + b, 0), sumN = n.reduce((a, b) => a + b, 0);
  const sw = R.filter(r => r.switched), df = R.filter(r => r.differ);
  const row = {
    all: totals[k], singlePct: totals[k] ? 100 * singles[k] / totals[k] : NaN, multi: pool[k].length, run: R.length,
    nCand: mean(R.map(r => r.nCand)), msMean: mean(ms), msP50: q(ms, 0.5), msP90: q(ms, 0.9), msMax: Math.max(...ms, 0),
    rollPerSearch: mean(n), rollPerSec: sumMs > 0 ? sumN / (sumMs / 1000) : NaN,
    differPct: R.length ? 100 * df.length / R.length : NaN, switchPct: R.length ? 100 * sw.length / R.length : NaN,
    gateMeanSwitched: mean(sw.map(r => r.gate.mean)), errors: R.filter(r => r.err).length,
  };
  summary[k] = row;
  allMs += sumMs; allN += sumN; allRuns += R.length; allSw += sw.length;
  allRuns2 += R.length;
  console.log(`${k.padEnd(11)} ${String(row.all).padStart(4)}  ${f(row.singlePct).padStart(6)}  ${String(row.multi).padStart(5)}  ${String(row.run).padStart(3)}  ${f(row.nCand).padStart(5)}   ${f(row.msMean).padStart(15)} ${f(row.msP50).padStart(5)} ${f(row.msP90).padStart(5)} ${f(row.msMax).padStart(5)}   ${f(row.rollPerSearch).padStart(11)}  ${f(row.rollPerSec, 0).padStart(6)}   ${f(row.differPct).padStart(5)}  ${f(row.switchPct).padStart(6)}  ${f(row.gateMeanSwitched, 3).padStart(8)}${row.errors ? '  errors=' + row.errors : ''}`);
}
console.log(`ALL: ${allRuns} searches, ${allN} rollouts, ${f(allMs / Math.max(1, allRuns))} ms/search, ${f(allN / (allMs / 1000), 0)} rollouts/s, switch ${f(100 * allSw / Math.max(1, allRuns))}%  (wall ${wall.toFixed(1)} s)`);
// 每局子决策数（全部类型，含单候选）→ 若对每个 L6 多候选子决策都搜，估每局 L6 花费（4 人局 L6 占 1/4）
const perGameMulti = KINDS.reduce((a, k) => a + pool[k].length, 0) / GAMES;
console.log(`multi-candidate sub-decisions per game (all 4 seats): ${f(perGameMulti)} → one seat ≈ ${f(perGameMulti / 4)} → ≈ ${f(perGameMulti / 4 * allMs / Math.max(1, allRuns) / 1000, 2)} s/game single-threaded at these settings`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ games: GAMES, seed: SEED, perKind: PER_KIND, bSel: BSEL, gateN: GATE, fid: FID, loadavg: os.loadavg(), summary, perGameMulti }, null, 1));
