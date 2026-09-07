// ============================================================
// tools/eval_pool_report.js — 参考池评级报告(读 eval_pool.js 的 JSONL 分片)
// ============================================================
// 输出(紧凑 markdown):
//   (a) CAND 对每种对手阵容及总体的胜率(公平份额 25%)与均分差(对最强对手 / 对手均分)
//   (b) 5 个智能体的 Plackett-Luce 评级: 用每局完整名次(并列 → 平均名次, 似然上按并列组
//       全排列等权展开)以 MM 算法(Hunter 2004)拟合, 默认 100 轮; 评级按 Elo 尺度 400·log10(γ_i/γ_锚)
//       报告(锚默认 L5=0, --anchor L3:1000 可换 1000-Elo 式); 95% CI 来自对"局"的 bootstrap(默认 200 次)。
//       正则: 每对智能体加 λ 局(默认 0.1)互胜的虚拟两人局, 保证小样本下评级有限。
//   (c) 头对头: CAND 名次高于各智能体的局份额(并列算 0.5)
//
// 用法: node tools/eval_pool_report.js <a.jsonl> [b.jsonl ...] [--boot 200] [--iters 100]
//         [--prior 0.1] [--seed 12345] [--anchor L5:0]
'use strict';
const fs = require('fs');

// ---- 参数 ----
const files = [];
const opt = { boot: 200, iters: 100, prior: 0.1, seed: 12345, anchor: 'L5', anchorVal: 0 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--boot') opt.boot = parseInt(argv[++i]);
  else if (a === '--iters') opt.iters = parseInt(argv[++i]);
  else if (a === '--prior') opt.prior = parseFloat(argv[++i]);
  else if (a === '--seed') opt.seed = parseInt(argv[++i]);
  else if (a === '--anchor') { const [n, v] = argv[++i].split(':'); opt.anchor = n; opt.anchorVal = v != null ? parseFloat(v) : 0; }
  else if (a.startsWith('--')) { console.error('unknown arg ' + a); process.exit(1); }
  else files.push(a);
}
if (!files.length) { console.error('usage: node tools/eval_pool_report.js <a.jsonl> [b.jsonl ...] [--boot 200] [--iters 100] [--prior 0.1] [--seed 12345] [--anchor L5:0]'); process.exit(1); }

// ---- 读取(按局号去重) ----
const byG = new Map();
let dup = 0;
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    const r = JSON.parse(s);
    if (byG.has(r.g)) dup++;
    byG.set(r.g, r);
  }
}
const rows = [...byG.values()].sort((a, b) => a.g - b.g);
if (!rows.length) { console.error('没有对局记录'); process.exit(1); }
const ci = r => r.seats.indexOf('CAND');

const AGENTS = ['L3', 'L4', 'L5', 'L6', 'CAND'];
for (const r of rows) for (const a of r.seats) if (!AGENTS.includes(a)) AGENTS.push(a);
const AIDX = Object.fromEntries(AGENTS.map((a, i) => [a, i]));
if (!(opt.anchor in AIDX)) { console.error('anchor 不在智能体列表: ' + opt.anchor); process.exit(1); }

const mean = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
const seOf = arr => { if (arr.length < 2) return NaN; const m = mean(arr); return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1) / arr.length); };
const fmt = (x, d = 1) => (isFinite(x) ? x.toFixed(d) : '-');
const pct = (x, d = 1) => fmt(x * 100, d);

// ================= (a) 胜率 × 阵容 =================
function winStats(rs) {
  const w = rs.map(r => r.win), mb = rs.map(r => r.marginBest), ma = rs.map(r => r.marginAvg);
  return { n: rs.length, win: mean(w), winSE: seOf(w), mb: mean(mb), ma: mean(ma) };
}
const comps = new Map();
for (const r of rows) { if (!comps.has(r.comp)) comps.set(r.comp, []); comps.get(r.comp).push(r); }

// ================= (b) Plackett-Luce (MM) =================
// 每局 → 若干加权严格排序(并列组全排列等权展开)
function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i]].concat(p));
  }
  return out;
}
function gameOrderings(r) {
  const seatIdx = r.seats.map((_, i) => i);
  const groupsMap = new Map();
  for (const i of seatIdx) { const s = r.scores[i]; if (!groupsMap.has(s)) groupsMap.set(s, []); groupsMap.get(s).push(AIDX[r.seats[i]]); }
  const groups = [...groupsMap.entries()].sort((a, b) => b[0] - a[0]).map(e => e[1]);
  let orderings = [[]], weight = 1;
  for (const g of groups) {
    const perms = permutations(g); weight /= perms.length;
    const next = [];
    for (const o of orderings) for (const p of perms) next.push(o.concat(p));
    orderings = next;
  }
  return orderings.map(o => ({ o, w: weight }));
}
const GAME_ORDS = rows.map(gameOrderings);
// 正则虚拟局: 每对智能体各 λ 局互胜(两人排序)
const PRIOR_ORDS = [];
for (let i = 0; i < AGENTS.length; i++) for (let j = i + 1; j < AGENTS.length; j++) { PRIOR_ORDS.push({ o: [i, j], w: opt.prior }); PRIOR_ORDS.push({ o: [j, i], w: opt.prior }); }

function fitPL(ordLists, iters) {
  const K = AGENTS.length;
  const gamma = new Float64Array(K).fill(1);
  const win = new Float64Array(K), den = new Float64Array(K);
  const all = [];
  for (const lst of ordLists) for (const x of lst) all.push(x);
  for (const x of PRIOR_ORDS) all.push(x);
  for (const { o, w } of all) for (let k = 0; k < o.length - 1; k++) win[o[k]] += w; // 最后一名无"被选中"事件
  for (let it = 0; it < iters; it++) {
    den.fill(0);
    for (const { o, w } of all) {
      // 阶段 k: 从剩余集合 {o[k..]} 中选出 o[k]; 从尾部累加 γ 和
      let tail = 0;
      const m = o.length;
      const tails = new Float64Array(m);
      for (let k = m - 1; k >= 0; k--) { tail += gamma[o[k]]; tails[k] = tail; }
      for (let k = 0; k < m - 1; k++) {
        const inv = w / tails[k];
        for (let j = k; j < m; j++) den[o[j]] += inv;
      }
    }
    let logSum = 0;
    for (let i = 0; i < K; i++) { gamma[i] = den[i] > 0 ? win[i] / den[i] : gamma[i]; logSum += Math.log(gamma[i]); }
    const norm = Math.exp(logSum / K); // 几何均值归一(不改变似然)
    for (let i = 0; i < K; i++) gamma[i] /= norm;
  }
  return gamma;
}
const ELO = 400 / Math.LN10;
const toRating = g => AGENTS.map((_, i) => opt.anchorVal + ELO * (Math.log(g[i]) - Math.log(g[AIDX[opt.anchor]])));
const ratingPt = toRating(fitPL(GAME_ORDS, opt.iters));

// bootstrap over games (seeded, deterministic)
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(opt.seed >>> 0);
const bootR = AGENTS.map(() => []);
const dCand = { L6: [], L5: [] };
for (let b = 0; b < opt.boot; b++) {
  const sample = [];
  for (let i = 0; i < rows.length; i++) sample.push(GAME_ORDS[Math.floor(rnd() * rows.length)]);
  const rt = toRating(fitPL(sample, opt.iters));
  rt.forEach((v, i) => bootR[i].push(v));
  for (const a of Object.keys(dCand)) if (a in AIDX) dCand[a].push(rt[AIDX.CAND] - rt[AIDX[a]]);
}
const q = (arr, p) => { if (!arr.length) return NaN; const s = arr.slice().sort((x, y) => x - y); const k = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1)))); return s[k]; };

// per-agent summary: games / avg rank / win%
const agentStat = AGENTS.map(a => {
  let n = 0, rankSum = 0, wins = 0;
  for (const r of rows) { const i = r.seats.indexOf(a); if (i < 0) continue; n++; rankSum += r.ranks[i]; wins += (r.winners.includes(i) ? 1 / r.winners.length : 0); }
  return { n, avgRank: n ? rankSum / n : NaN, win: n ? wins / n : NaN };
});

// ================= (c) 头对头 =================
const h2h = AGENTS.filter(a => a !== 'CAND').map(a => {
  const v = [];
  for (const r of rows) { const j = r.seats.indexOf(a); if (j < 0) continue; const c = ci(r); v.push(r.ranks[c] < r.ranks[j] ? 1 : r.ranks[c] > r.ranks[j] ? 0 : 0.5); }
  return { a, n: v.length, above: v.length ? mean(v) : NaN, se: seOf(v) };
});

// ================= 输出 =================
const out = [];
out.push(`## 参考池评级报告 — ${rows.length} 局 (${files.length} 个分片${dup ? `, ${dup} 条重复局号已去重` : ''})`);
out.push('');
out.push('### (a) CAND 胜率 × 对手阵容 (公平份额 25%)');
out.push('| 对手阵容 | n | CAND 胜率 | ±SE | 分差 vs 最强对手 | 分差 vs 对手均分 |');
out.push('|---|---|---|---|---|---|');
for (const [comp, rs] of [...comps.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
  const s = winStats(rs);
  out.push(`| ${comp} | ${s.n} | ${pct(s.win)}% | ${pct(s.winSE)}pp | ${s.mb >= 0 ? '+' : ''}${fmt(s.mb, 2)} | ${s.ma >= 0 ? '+' : ''}${fmt(s.ma, 2)} |`);
}
{ const s = winStats(rows); out.push(`| **总体** | ${s.n} | **${pct(s.win)}%** | ${pct(s.winSE)}pp | ${s.mb >= 0 ? '+' : ''}${fmt(s.mb, 2)} | ${s.ma >= 0 ? '+' : ''}${fmt(s.ma, 2)} |`); }
out.push('');
out.push(`### (b) Plackett-Luce 评级 (MM ${opt.iters} 轮, 锚 ${opt.anchor}=${opt.anchorVal}, Elo 尺度 400·log10 γ, bootstrap ${opt.boot}× 95% CI, 先验 λ=${opt.prior})`);
out.push('| 智能体 | 评级 | 95% CI | 局数 | 平均名次 | 胜率 |');
out.push('|---|---|---|---|---|---|');
AGENTS.map((a, i) => ({ a, i, r: ratingPt[i] })).sort((x, y) => y.r - x.r).forEach(({ a, i, r }) => {
  const st = agentStat[i];
  out.push(`| ${a === 'CAND' ? '**CAND**' : a} | ${fmt(r, 0)} | [${fmt(q(bootR[i], 0.025), 0)}, ${fmt(q(bootR[i], 0.975), 0)}] | ${st.n} | ${fmt(st.avgRank, 2)} | ${pct(st.win)}% |`);
});
const dl = a => (a in AIDX) ? `Δ(CAND−${a}) = ${fmt(ratingPt[AIDX.CAND] - ratingPt[AIDX[a]], 0)} [${fmt(q(dCand[a], 0.025), 0)}, ${fmt(q(dCand[a], 0.975), 0)}]` : '';
out.push('');
out.push(`${dl('L6')}   ${dl('L5')}   (CI 不含 0 → 显著)`);
out.push('');
out.push('### (c) 头对头: CAND 名次高于对方的局份额 (并列 0.5)');
out.push('| CAND vs | n | 高于对方 | ±SE |');
out.push('|---|---|---|---|');
for (const h of h2h) out.push(`| ${h.a} | ${h.n} | ${pct(h.above)}% | ${pct(h.se)}pp |`);
console.log(out.join('\n'));
