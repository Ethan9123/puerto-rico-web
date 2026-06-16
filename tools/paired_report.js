// ============================================================
// tools/paired_report.js — 配对评测统计
// ============================================================
// join 两个配置在相同局号 g(=相同种子/牌序/座位)上的结果, 输出:
//   各自胜率、配对胜率差 ± SE、z 值、以及均分差。
// 配对差分消掉了"牌运"方差 → 同样局数下检出力远高于独立评测。
//
// 用法: node tools/paired_report.js <A.jsonl> <B.jsonl> [labelA] [labelB]
'use strict';
const fs = require('fs');

const fileA = process.argv[2], fileB = process.argv[3];
const labelA = process.argv[4] || fileA, labelB = process.argv[5] || fileB;
if (!fileA || !fileB) { console.error('usage: node tools/paired_report.js <A.jsonl> <B.jsonl> [labelA] [labelB]'); process.exit(1); }

function readRows(f) {
  const m = new Map();
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    const r = JSON.parse(s);
    m.set(r.g, r);
  }
  return m;
}
const A = readRows(fileA), B = readRows(fileB);
const gs = [...A.keys()].filter(g => B.has(g)).sort((x, y) => x - y);
if (!gs.length) { console.error('没有可配对的局号'); process.exit(1); }

let mismatch = 0;
const diffs = [], scoreDiffs = [];
let wA = 0, wB = 0, hiA = 0, hiB = 0;
for (const g of gs) {
  const a = A.get(g), b = B.get(g);
  if (a.seed !== b.seed || a.seat !== b.seat || a.lo !== b.lo) { mismatch++; continue; }
  wA += a.win; wB += b.win;
  hiA += a.hi; hiB += b.hi;
  diffs.push(a.win - b.win);
  scoreDiffs.push(a.hi - b.hi);
}
const n = diffs.length;
const mean = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
const se = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1) / arr.length); };

const dMean = mean(diffs), dSE = se(diffs);
const sMean = mean(scoreDiffs), sSE = se(scoreDiffs);
const z = dSE > 0 ? dMean / dSE : 0;
const nDiff = diffs.filter(d => d !== 0).length;

console.log(`=== 配对评测报告 (n=${n} 局配对成功${mismatch ? `, ${mismatch} 局元数据不匹配被丢弃` : ''}) ===`);
console.log(`  A = ${labelA}`);
console.log(`  B = ${labelB}`);
console.log(`  胜率:  A ${(wA / n * 100).toFixed(1)}%   B ${(wB / n * 100).toFixed(1)}%`);
console.log(`  配对胜率差 (A-B): ${(dMean * 100).toFixed(1)}pp ± ${(dSE * 100).toFixed(1)}pp (SE)   z=${z.toFixed(2)}   结果不同的局数=${nDiff}/${n}`);
console.log(`  宗师均分:  A ${(hiA / n).toFixed(1)}   B ${(hiB / n).toFixed(1)}   配对分差 ${sMean >= 0 ? '+' : ''}${sMean.toFixed(2)} ± ${sSE.toFixed(2)}`);
const verdict = Math.abs(z) < 1.96 ? '差异不显著 (|z|<1.96)' : (z > 0 ? `A 显著更强 (z=${z.toFixed(2)})` : `B 显著更强 (z=${z.toFixed(2)})`);
console.log(`  [判定] ${verdict}`);
