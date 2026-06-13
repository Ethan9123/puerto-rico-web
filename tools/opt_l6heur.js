// ============================================================
// tools/opt_l6heur.js — L6 私有启发式参数 (1+1)-ES 调优
// ============================================================
// AI_STRENGTH §7 的剩余方向: 打破 L4/L5/L6 共用子决策启发式。
// game.js 已把 aiPickPlantation/aiPickBuilding 的 14 个常数参数化(window._l6Heur,
// 仅 L6 生效)。本脚本在固定种子集上做 (1+1)-ES:
//   - 每代: 变异当前 best → 候选 JSON → eval_paired_run.sh 跑 240 局(与基线同种子)
//   - 与基线(data/paired/deploy-lo5.jsonl 的 g<240 子集)配对, diff>0 且 z>=1 则接受
//   - σ 自适应(成功×1.2 失败×0.9)
// 注意: 固定种子集会过拟合 → 最终 best 必须用全新种子 480 局 holdout(z>1.96)才可部署:
//   bash tools/eval_paired_run.sh hold-best DEPLOY 5 480 8 30200612 1.5 1 data/opt/best.json
//   bash tools/eval_paired_run.sh hold-base DEPLOY 5 480 8 30200612
//   node tools/paired_report.js data/paired/hold-best-lo5.jsonl data/paired/hold-base-lo5.jsonl
//
// 用法: node tools/opt_l6heur.js [候选数=16] [每候选局数=240] [procs=8]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const N_CAND = parseInt(process.argv[2] || '16');
const GAMES = parseInt(process.argv[3] || '240');
const PROCS = parseInt(process.argv[4] || '8');
const BASELINE = path.join(ROOT, 'data', 'paired', 'deploy-lo5.jsonl'); // 480 局, seedBase 20260611, C=1.5, 无增压
const OPT_DIR = path.join(ROOT, 'data', 'opt');
fs.mkdirSync(OPT_DIR, { recursive: true });

const DEFAULTS = {
  pl_moneyLean: 7, pl_priceMult: 1.5, pl_cornEarly: 6, pl_cornLate: 3,
  pl_chain: 14, pl_diverse: 2, pl_monoBase: 3, pl_clash: 5,
  bd_costMult: 3, bd_chooser: 5, bd_grabLate: 30, bd_grabMid: 16,
  bd_saveGap: 4, bd_saveMediocre: 20,
};
const KEYS = Object.keys(DEFAULTS);

// 基线子集 g<GAMES
const baseRows = new Map();
for (const line of fs.readFileSync(BASELINE, 'utf8').split('\n')) {
  const s = line.trim(); if (!s) continue;
  const r = JSON.parse(s);
  if (r.g < GAMES) baseRows.set(r.g, r);
}
if (baseRows.size < GAMES) { console.error(`基线只有 ${baseRows.size} 局 < ${GAMES}`); process.exit(1); }

// 简单可复现 RNG
let _s = 20260612;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function mutate(base, sigma) {
  const out = { ...base };
  let changed = 0;
  for (const k of KEYS) {
    if (rnd() < 0.5) continue;
    const def = DEFAULTS[k];
    let v = out[k] * Math.exp(sigma * gauss());
    v = Math.max(0.2 * def, Math.min(4 * def, v));
    out[k] = Math.round(v * 100) / 100;
    if (out[k] !== base[k]) changed++;
  }
  if (!changed) { const k = KEYS[Math.floor(rnd() * KEYS.length)]; out[k] = Math.round(out[k] * Math.exp(sigma * gauss()) * 100) / 100; }
  return out;
}

function evalCand(name, heurPath) {
  execFileSync('bash', ['tools/eval_paired_run.sh', name, 'DEPLOY', '5', String(GAMES), String(PROCS), '20260611', '1.5', '1', heurPath],
    { cwd: ROOT, stdio: 'pipe', timeout: 3 * 3600 * 1000 });
  const rows = fs.readFileSync(path.join(ROOT, 'data', 'paired', `${name}-lo5.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  const diffs = [];
  let wc = 0, wb = 0;
  for (const r of rows) {
    const b = baseRows.get(r.g);
    if (!b || b.seed !== r.seed || b.seat !== r.seat) continue;
    diffs.push(r.win - b.win);
    wc += r.win; wb += b.win;
  }
  const n = diffs.length;
  const m = diffs.reduce((s, x) => s + x, 0) / n;
  const se = Math.sqrt(diffs.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1) / n);
  return { n, winCand: wc / n, winBase: wb / n, diff: m, se, z: se > 0 ? m / se : 0 };
}

(async () => {
  let best = { ...DEFAULTS };
  let bestScore = 0; // 相对基线的配对 diff(基线自身=0)
  let sigma = 0.25;
  const t0 = Date.now();
  // ---- 断点续跑: checkpoint.jsonl 每候选一行 {k,accepted,diff,z,sigmaAfter,best} ----
  // 崩溃后重启会 replay 已记录候选的 mutate()(精确推进确定性 RNG)+accept/reject 决策,
  // 跳过昂贵的 evalCand → 续跑从下一个未评测候选开始。
  const ckptPath = path.join(OPT_DIR, 'checkpoint.jsonl');
  const done = new Map();
  if (fs.existsSync(ckptPath)) {
    for (const line of fs.readFileSync(ckptPath, 'utf8').split('\n')) {
      const s = line.trim(); if (!s) continue;
      const c = JSON.parse(s); done.set(c.k, c);
    }
  }
  console.log(`(1+1)-ES: ${N_CAND} 候选 × ${GAMES} 局配对(固定种子) σ0=${sigma}${done.size ? `  [续跑: 已完成 ${done.size} 候选]` : ''}`);
  console.log(`基线: 现役默认参数 (${baseRows.size} 局已缓存)\n`);
  const ckptFd = fs.openSync(ckptPath, 'a');

  for (let k = 1; k <= N_CAND; k++) {
    const cand = mutate(best, sigma); // 必须每代都调用以推进 RNG(续跑一致性)
    const prev = done.get(k);
    if (prev) { // 已评测过 → replay 决策, 跳过 evalCand
      if (prev.accepted) { best = prev.best; bestScore = prev.diff; sigma = Math.min(0.5, sigma * 1.2); }
      else { sigma = Math.max(0.08, sigma * 0.9); }
      console.log(`[${k}/${N_CAND}] (续跑) diff=${(prev.diff * 100).toFixed(1)}pp z=${prev.z.toFixed(2)} ${prev.accepted ? '✅接受' : '✗拒绝'} σ=${sigma.toFixed(2)}`);
      continue;
    }
    const candPath = path.join(OPT_DIR, `cand-${k}.json`);
    fs.writeFileSync(candPath, JSON.stringify(cand, null, 1));
    const tk = Date.now();
    let r;
    try { r = evalCand(`opt${k}`, candPath); }
    catch (e) { console.log(`[${k}/${N_CAND}] 评测失败: ${e.message}`); process.exit(1); } // 崩溃即停, 重启可续
    const accepted = r.diff > bestScore && r.z >= 1.0;
    const mins = ((Date.now() - tk) / 60000).toFixed(0);
    const delta = KEYS.filter(key => cand[key] !== best[key]).map(key => `${key}:${best[key]}→${cand[key]}`).join(' ');
    console.log(`[${k}/${N_CAND}] diff=${(r.diff * 100).toFixed(1)}pp±${(r.se * 100).toFixed(1)} z=${r.z.toFixed(2)} cand=${(r.winCand * 100).toFixed(1)}% ${accepted ? '✅接受' : '✗拒绝'} σ=${sigma.toFixed(2)} ${mins}min`);
    console.log(`     变异: ${delta || '(无)'}`);
    if (accepted) {
      best = cand; bestScore = r.diff;
      fs.writeFileSync(path.join(OPT_DIR, 'best.json'), JSON.stringify(best, null, 1));
      sigma = Math.min(0.5, sigma * 1.2);
    } else {
      sigma = Math.max(0.08, sigma * 0.9);
    }
    fs.writeSync(ckptFd, JSON.stringify({ k, accepted, diff: r.diff, z: r.z, sigmaAfter: sigma, best }) + '\n');
  }
  fs.closeSync(ckptFd);
  console.log(`\n=== 完成 (${((Date.now() - t0) / 3600000).toFixed(1)}h) ===`);
  if (bestScore > 0) {
    console.log(`best diff=${(bestScore * 100).toFixed(1)}pp (固定种子, 有过拟合风险)`);
    console.log(`参数: ${JSON.stringify(best)}`);
    console.log(`\n下一步 holdout(全新种子, 部署判定):`);
    console.log(`  bash tools/eval_paired_run.sh hold-best DEPLOY 5 480 8 30200612 1.5 1 data/opt/best.json`);
    console.log(`  bash tools/eval_paired_run.sh hold-base DEPLOY 5 480 8 30200612`);
    console.log(`  node tools/paired_report.js data/paired/hold-best-lo5.jsonl data/paired/hold-base-lo5.jsonl`);
  } else {
    console.log(`没有候选胜过默认参数 → 共用启发式的手调常数对 L6 也已近最优(又一条负结果)。`);
  }
})();
