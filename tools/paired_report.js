// ============================================================
// tools/paired_report.js — 配对评测统计
// ============================================================
// join 两个配置在相同局号 g(=相同种子/牌序/座位)上的结果, 输出:
//   各自胜率、配对胜率差 ± SE、z 值、以及均分差。
// 配对差分消掉了"牌运"方差 → 同样局数下检出力远高于独立评测。
// (⚠ AI_STRENGTH §18: 非 CRN 旧模式下两臂胜负相关 ρ≈0, 配对 SE ≈ 独立 SE —— 所以现在同时
//   打印独立样本 SE 与 ρ, 一眼看出配对到底省了多少方差。配对 SE 公式对任何 ρ 都有效。)
//
// 用法: node tools/paired_report.js <A.jsonl> <B.jsonl> [labelA] [labelB] [选项…]
//   选项可出现在 argv 任意位置, 也可写成 --opt=值:
//   --expect N     确认性检查: 两文件各恰有 N 个不同 g、无重复 g 行、g 集合相同、每个 g 的
//                  seed/seat/lo 两边一致; 任一不满足 → 列出问题, exit 2, **不打印任何效应量**。
//                  (不加 --expect 时保持旧行为: 取 g 交集, 元数据不符的局丢弃并计数; 重复 g 会告警、保留最后一行。)
//   --strict       出现任何无效行即判 INVALID ARM。
//   --zcrit X      判定阈值 (默认 1.96)。
//   --favor A|B    指明哪一臂是候选 (符号约定不变: 所有差值都是 A−B)。给出后判定行改为
//                  ADOPT / NOT ADOPTED: ADOPT ⇔ 候选方向的 z_win ≥ zcrit 且 候选方向的 z_margin > −1.96
//                  (margin 不许显著变差; 缺 totals 无法检查 margin → NOT ADOPTED)。
//                  不给 --favor 时判定行与旧版逐字相同 (阈值取 --zcrit)。
//   --onesided     单侧检验 (须配合 --favor): p 值按单侧报告, 且不再把"候选显著更差"单独作为结论。
//                  注意它**不改变** zcrit —— α=0.05 单侧请显式写 --zcrit 1.645。
//
// 行格式 (eval_paired_worker 新契约): 正常行 {g,seed,seat,lo,win,hi,loAvg,totals};
//   无效行 {g,seed,seat,lo,error:"..."} 或 {g,seed,seat,lo,incomplete:true} (缺数值 win/hi 也算无效)。
//   有效性规则: 两文件无效行合计 > 1%·n (n = 配对局数) 或 --strict 下出现任一无效行 → 打印 INVALID ARM, exit 2;
//   否则丢弃任一侧无效的局, 并打印丢弃数。JSON 解析失败 / 缺整数 g 的行一律 exit 2。
//   侧车 meta (<X>.meta.jsonl 或 <X>.jsonl.meta.jsonl, eval_paired_worker/run_arm 写): §18.2 规定任一 L6 回退
//   (meta.l6.fb > 0) 或根并行断言失败 (meta.l6.rpBad > 0) 即整臂无效。--expect 下侧车必须存在且覆盖同一 g 集合,
//   否则 exit 2; 不加 --expect 时侧车存在则只打印计数。
//
// 端点: 胜率 (win, 平分按 1/k)、宗师得分 hi、margin = totals[seat] − max(totals[j], j≠seat)
//   ("对最强对手分差", 比胜负连续、方差小; 缺 totals 时跳过并注明)。
// 退出码: 0 正常; 1 用法错误/无可配对局; 2 数据检查未通过 / INVALID ARM。
'use strict';
const fs = require('fs');

const USAGE = 'usage: node tools/paired_report.js <A.jsonl> <B.jsonl> [labelA] [labelB] [--expect N] [--strict] [--zcrit X] [--favor A|B] [--onesided]';

// ---------- argv ----------
function usageDie(msg) { if (msg) console.error(msg); console.error(USAGE); process.exit(1); }
const opt = { expect: null, strict: false, zcrit: 1.96, favor: null, onesided: false };
const pos = [];
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (!a.startsWith('--') || a === '--') { pos.push(a); continue; }
    let val = null;
    const eq = a.indexOf('=');
    if (eq > 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
    const takeVal = () => {
      if (val !== null) return val;
      if (i + 1 >= argv.length) usageDie(`${a} 需要一个参数`);
      return argv[++i];
    };
    const noVal = () => { if (val !== null) usageDie(`${a} 不接受参数`); };
    switch (a) {
      case '--expect': { const v = takeVal(); if (!/^\d+$/.test(v) || +v < 1) usageDie(`--expect 需要正整数, 得到 "${v}"`); opt.expect = +v; break; }
      case '--strict': noVal(); opt.strict = true; break;
      case '--zcrit': { const v = takeVal(); const x = Number(v); if (!(x > 0) || !isFinite(x)) usageDie(`--zcrit 需要正数, 得到 "${v}"`); opt.zcrit = x; break; }
      case '--favor': { const v = String(takeVal()).toUpperCase(); if (v !== 'A' && v !== 'B') usageDie(`--favor 只能是 A 或 B, 得到 "${v}"`); opt.favor = v; break; }
      case '--onesided': noVal(); opt.onesided = true; break;
      default: usageDie(`未知选项 ${a}`);
    }
  }
}
const fileA = pos[0], fileB = pos[1];
if (!fileA || !fileB || pos.length > 4) usageDie();
if (opt.onesided && !opt.favor) usageDie('--onesided 需要 --favor A|B 指明候选方向 (单侧检验必须预先声明方向)');
const labelA = pos[2] || fileA, labelB = pos[3] || fileB;

// ---------- 读取 ----------
// 返回 { m: Map(g→row, 重复时保留最后一行=旧行为), dups: Map(g→出现次数), bad: [描述], nLines }
function readRows(f) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { usageDie(`读不了 ${f}: ${e.message}`); }
  const m = new Map(), dups = new Map(), bad = [];
  let nLines = 0;
  text.split('\n').forEach((line, i) => {
    const s = line.trim(); if (!s) return;
    nLines++;
    let r;
    try { r = JSON.parse(s); } catch (e) { bad.push(`第 ${i + 1} 行 JSON 解析失败`); return; }
    if (!r || typeof r !== 'object' || !Number.isInteger(r.g)) { bad.push(`第 ${i + 1} 行缺少整数 g`); return; }
    if (m.has(r.g)) dups.set(r.g, (dups.get(r.g) || 1) + 1);
    m.set(r.g, r);
  });
  return { m, dups, bad, nLines };
}
// 无效行分类: 'error' | 'incomplete' | 'malformed' | null(有效)
function invalidKind(r) {
  if (r.error !== undefined && r.error !== null) return 'error';
  if (r.incomplete === true) return 'incomplete';
  if (typeof r.win !== 'number' || !isFinite(r.win) || typeof r.hi !== 'number' || !isFinite(r.hi)) return 'malformed';
  return null;
}
const fmtList = (arr, k = 10) => arr.slice(0, k).join(', ') + (arr.length > k ? ` …(共 ${arr.length})` : '');
const metaSame = (a, b) => a.seed === b.seed && a.seat === b.seat && a.lo === b.lo;

const RA = readRows(fileA), RB = readRows(fileB);
const A = RA.m, B = RB.m;

// ---------- 结构检查 ----------
const problems = [];
for (const [tag, R] of [['A', RA], ['B', RB]]) {
  for (const b of R.bad) problems.push(`${tag}: ${b}`);
}
if (opt.expect != null) {
  for (const [tag, R] of [['A', RA], ['B', RB]]) {
    if (R.m.size !== opt.expect) problems.push(`${tag}: 不同 g 数 = ${R.m.size}, 期望 ${opt.expect}`);
    if (R.dups.size) problems.push(`${tag}: ${R.dups.size} 个 g 有重复行: ${fmtList([...R.dups].map(([g, c]) => `g=${g}×${c}`))}`);
  }
  const onlyA = [...A.keys()].filter(g => !B.has(g)).sort((x, y) => x - y);
  const onlyB = [...B.keys()].filter(g => !A.has(g)).sort((x, y) => x - y);
  if (onlyA.length) problems.push(`g 集合不同: 仅在 A 中 ${onlyA.length} 个: ${fmtList(onlyA)}`);
  if (onlyB.length) problems.push(`g 集合不同: 仅在 B 中 ${onlyB.length} 个: ${fmtList(onlyB)}`);
  const bad = [];
  for (const [g, a] of A) { const b = B.get(g); if (b && !metaSame(a, b)) bad.push(g); }
  bad.sort((x, y) => x - y);
  if (bad.length) problems.push(`${bad.length} 个 g 的 seed/seat/lo 两边不一致: ${fmtList(bad.map(g => `g=${g}`))}`);
}
if (problems.length) {
  console.log(`=== 配对评测报告: 数据检查未通过${opt.expect != null ? ` (--expect ${opt.expect})` : ''} → 不报告效应量 ===`);
  console.log(`  A = ${labelA}`);
  console.log(`  B = ${labelB}`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(2);
}
const warnings = [];
for (const [tag, R] of [['A', RA], ['B', RB]]) {
  if (R.dups.size) warnings.push(`${tag} 有 ${R.dups.size} 个 g 出现重复行 (保留最后一行): ${fmtList([...R.dups].map(([g, c]) => `g=${g}×${c}`))}`);
}

// ---------- 侧车 meta: L6 回退 / 根并行断言 (§18.2 有效性) ----------
function metaPathOf(f) {
  const c = [f.replace(/\.jsonl$/, '') + '.meta.jsonl', f + '.meta.jsonl'];
  return c.find(p => p !== f && fs.existsSync(p)) || null;
}
const metaNotes = [];
for (const [tag, f, M] of [['A', fileA, A], ['B', fileB, B]]) {
  const mp = metaPathOf(f);
  if (!mp) { if (opt.expect != null) problems.push(`${tag}: 缺侧车 meta（${f} 旁无 .meta.jsonl）→ 无法核对 L6 回退`); continue; }
  const rows = fs.readFileSync(mp, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } });
  const seen = new Set(); const fb = [], rpBad = []; let broken = 0;
  for (const r of rows) {
    if (!r || !Number.isInteger(r.g)) { broken++; continue; }
    seen.add(r.g);
    if (r.l6 && r.l6.fb > 0) fb.push(r.g);
    if (r.l6 && r.l6.rpBad > 0) rpBad.push(r.g);
  }
  const missing = [...M.keys()].filter(g => !seen.has(g));
  const note = `${tag} meta: ${seen.size} 局, L6 回退 ${fb.length} 局, rpBad ${rpBad.length} 局${broken ? `, 坏行 ${broken}` : ''}${missing.length ? `, 缺 ${missing.length} 局` : ''}`;
  metaNotes.push(note);
  if (opt.expect != null) {
    if (broken) problems.push(`${tag}: meta 有 ${broken} 行无法解析`);
    if (missing.length) problems.push(`${tag}: meta 缺 ${missing.length} 局: ${fmtList(missing.sort((x, y) => x - y))}`);
    if (fb.length) problems.push(`${tag}: INVALID ARM — ${fb.length} 局有 L6 回退: ${fmtList(fb.sort((x, y) => x - y))}`);
    if (rpBad.length) problems.push(`${tag}: INVALID ARM — ${rpBad.length} 局根并行断言失败: ${fmtList(rpBad.sort((x, y) => x - y))}`);
  }
}
if (problems.length) {
  console.log(`=== 配对评测报告: 有效性检查未通过 (--expect ${opt.expect}) → 不报告效应量 ===`);
  console.log(`  A = ${labelA}`);
  console.log(`  B = ${labelB}`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(2);
}

// ---------- 配对 + 有效性 ----------
const gsAll = [...A.keys()].filter(g => B.has(g)).sort((x, y) => x - y);
if (!gsAll.length) { console.error('没有可配对的局号'); process.exit(1); }
let mismatch = 0;
const gs = [];
for (const g of gsAll) { if (metaSame(A.get(g), B.get(g))) gs.push(g); else mismatch++; }
const n0 = gs.length;

function countInvalid(M) {
  const c = { error: 0, incomplete: 0, malformed: 0, total: 0 };
  for (const r of M.values()) { const k = invalidKind(r); if (k) { c[k]++; c.total++; } }
  return c;
}
const invA = countInvalid(A), invB = countInvalid(B);
const invDesc = c => c.total ? `${c.total} (error ${c.error}, incomplete ${c.incomplete}${c.malformed ? `, malformed ${c.malformed}` : ''})` : '0';
const invTotal = invA.total + invB.total;
const invLimit = 0.01 * n0;
if (invTotal > invLimit || (opt.strict && invTotal > 0)) {
  console.log(`=== INVALID ARM → 不报告效应量 ===`);
  console.log(`  A = ${labelA}   无效行 ${invDesc(invA)}`);
  console.log(`  B = ${labelB}   无效行 ${invDesc(invB)}`);
  console.log(`  无效行合计 ${invTotal}, ${opt.strict ? '--strict 下不允许任何无效行' : `超过 1%·n = ${invLimit.toFixed(2)} (n=${n0} 配对局)`}`);
  process.exit(2);
}
const pairs = [];
let dropped = 0;
for (const g of gs) {
  const a = A.get(g), b = B.get(g);
  if (invalidKind(a) || invalidKind(b)) { dropped++; continue; }
  pairs.push([a, b]);
}
const n = pairs.length;
if (n < 2) { console.log(`有效配对局数 n=${n} < 2, 无法估计方差`); process.exit(2); }

// ---------- 统计 ----------
const mean = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
const se = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1) / arr.length); };
const svar = arr => { const m = mean(arr); return arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1); };
function pearson(x, y) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}
// 标准正态 CDF (Abramowitz–Stegun 7.1.26, |误差| < 1.5e-7)
function phi(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
const fmtRho = r => (isFinite(r) ? r.toFixed(2) : 'n/a');
const sgn = (x, d) => (x >= 0 ? '+' : '') + x.toFixed(d);

const winA = pairs.map(([a]) => a.win), winB = pairs.map(([, b]) => b.win);
const hiA = pairs.map(([a]) => a.hi), hiB = pairs.map(([, b]) => b.hi);
const diffs = pairs.map(([a, b]) => a.win - b.win);
const scoreDiffs = pairs.map(([a, b]) => a.hi - b.hi);
const dMean = mean(diffs), dSE = se(diffs);
const sMean = mean(scoreDiffs), sSE = se(scoreDiffs);
// SE=0 且均值≠0（每局差值都相同, 如全部 +1）时 z=±∞, 而不是旧版的 0（那会把最极端的结果判成"不显著"）
const zOf = (m, s) => (s > 0 ? m / s : m === 0 ? 0 : Math.sign(m) * Infinity);
const z = zOf(dMean, dSE);
const nDiff = diffs.filter(d => d !== 0).length;
const indSE = Math.sqrt(svar(winA) / n + svar(winB) / n);
const rhoWin = pearson(winA, winB);

// margin = 己分 − 最强对手分 (需要 totals)
function margin(r) {
  const t = r.totals;
  if (!Array.isArray(t) || !Number.isInteger(r.seat) || r.seat < 0 || r.seat >= t.length || t.length < 2) return null;
  if (!t.every(x => typeof x === 'number' && isFinite(x))) return null;
  let best = -Infinity;
  for (let j = 0; j < t.length; j++) if (j !== r.seat && t[j] > best) best = t[j];
  return t[r.seat] - best;
}
let noTotals = 0;
const mA = [], mB = [];
let sameTotals = 0;
for (const [a, b] of pairs) {
  const x = margin(a), y = margin(b);
  if (x === null || y === null) { noTotals++; continue; }
  mA.push(x); mB.push(y);
  if (a.totals.length === b.totals.length && a.totals.every((v, i) => v === b.totals[i])) sameTotals++;
}
const marginOK = noTotals === 0;
let mMean = NaN, mSE = NaN, zM = NaN, rhoMargin = NaN;
if (marginOK) {
  const md = mA.map((x, i) => x - mB[i]);
  mMean = mean(md); mSE = se(md); zM = zOf(mMean, mSE);
  rhoMargin = pearson(mA, mB);
}

// ---------- 输出 (前 6 行与旧版格式一致) ----------
const hdrExtra = (mismatch ? `, ${mismatch} 局元数据不匹配被丢弃` : '') + (dropped ? `, ${dropped} 局因无效行被丢弃` : '');
console.log(`=== 配对评测报告 (n=${n} 局配对成功${hdrExtra}) ===`);
console.log(`  A = ${labelA}`);
console.log(`  B = ${labelB}`);
console.log(`  胜率:  A ${(mean(winA) * 100).toFixed(1)}%   B ${(mean(winB) * 100).toFixed(1)}%`);
console.log(`  配对胜率差 (A-B): ${(dMean * 100).toFixed(1)}pp ± ${(dSE * 100).toFixed(1)}pp (SE)   z=${z.toFixed(2)}   结果不同的局数=${nDiff}/${n}`);
console.log(`  宗师均分:  A ${mean(hiA).toFixed(1)}   B ${mean(hiB).toFixed(1)}   配对分差 ${sMean >= 0 ? '+' : ''}${sMean.toFixed(2)} ± ${sSE.toFixed(2)}`);
// 新增行
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const m of metaNotes) console.log(`  · ${m}`);
const unpaired = (A.size - gsAll.length) + (B.size - gsAll.length);
console.log(`  数据: A ${A.size} 局 / B ${B.size} 局, 交集 ${gsAll.length}${unpaired ? ` (${unpaired} 局未配对被忽略)` : ''}${opt.expect != null ? ` [--expect ${opt.expect} ✓]` : ''}; ` +
  `无效行 A ${invDesc(invA)} / B ${invDesc(invB)} → 丢弃 ${dropped} 局 (上限 1%·n=${invLimit.toFixed(2)}${opt.strict ? ', --strict' : ''})`);
const effMult = dSE > 0 ? (indSE / dSE) ** 2 : NaN;
console.log(`  独立样本 SE (对照): ±${(indSE * 100).toFixed(1)}pp   配对/独立 SE 比 ${dSE > 0 && indSE > 0 ? (dSE / indSE).toFixed(2) : 'n/a'}` +
  ` (等效样本 ×${isFinite(effMult) ? effMult.toFixed(2) : 'n/a'})   ρ(win)=${fmtRho(rhoWin)}`);
if (marginOK) {
  console.log(`  对最强对手分差 margin:  A ${sgn(mean(mA), 2)}   B ${sgn(mean(mB), 2)}   配对差 (A-B) ${sgn(mMean, 2)} ± ${mSE.toFixed(2)}   z=${zM.toFixed(2)}   ρ(margin)=${fmtRho(rhoMargin)}`);
  console.log(`  两臂终局总分完全相同的局数: ${sameTotals}/${n}`);
} else {
  console.log(`  对最强对手分差 margin: 跳过 —— ${noTotals}/${n} 局缺 totals (旧格式行), 该端点不可用`);
  console.log(`  两臂终局总分完全相同的局数: n/a (缺 totals)`);
}

// ---------- 判定 ----------
const zc = opt.zcrit;
const zcTxt = String(+zc.toFixed(3));
if (!opt.favor) {
  const verdict = Math.abs(z) < zc ? `差异不显著 (|z|<${zcTxt})` : (z > 0 ? `A 显著更强 (z=${z.toFixed(2)})` : `B 显著更强 (z=${z.toFixed(2)})`);
  console.log(`  [判定] ${verdict}`);
} else {
  const cand = opt.favor, candLabel = cand === 'A' ? labelA : labelB;
  const sign = cand === 'A' ? 1 : -1;
  const zW = sign * z, zMg = sign * zM;
  const pTxt = opt.onesided ? `单侧 p=${(1 - phi(zW)).toPrecision(2)}` : `双侧 p=${(2 * (1 - phi(Math.abs(zW)))).toPrecision(2)}`;
  const reasons = [];
  if (!(zW >= zc)) reasons.push(`候选方向 z_win=${sgn(zW, 2)} < zcrit ${zcTxt}` + (!opt.onesided && zW <= -zc ? ' (双侧: 候选显著更差)' : ''));
  if (!marginOK) reasons.push('margin 端点不可用 (缺 totals), 无法确认 margin 未显著变差');
  else if (!(zMg > -1.96)) reasons.push(`候选方向 z_margin=${sgn(zMg, 2)} ≤ −1.96 (margin 显著变差)`);
  const mTxt = marginOK ? `z_margin=${sgn(zMg, 2)}` : 'z_margin=n/a';
  if (!reasons.length) {
    console.log(`  [判定] ADOPT — 候选 ${cand} (${candLabel}): z_win=${sgn(zW, 2)} ≥ ${zcTxt} (${pTxt}), ${mTxt} > −1.96`);
  } else {
    console.log(`  [判定] NOT ADOPTED — 候选 ${cand} (${candLabel}), ${pTxt}: ${reasons.join('; ')}`);
  }
}
