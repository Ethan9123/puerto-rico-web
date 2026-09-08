// tests/budget_binding_test.js
// 钉住 AI_STRENGTH §16.2 的那个 bug 形态：**思考预算被迭代数封顶，时间白白扔掉**。
//
// 默认档 deep 此前是 alphaIters=800 / alphaMs=5000。按 ~1.0 ms/迭代，800 次约 0.82 s 就停，
// 而它被允许用 5 s —— 80%+ 的已分配思考时间没用上，而 §16 实测搜索在这个区间**未饱和**。
//
// 本测试断言两件事：
//   ① 搜索确实能被时间约束（预算翻倍 → 迭代数显著增加），即 min(iters, ms) 的两条腿都活着；
//   ② game.js 的 normal/deep/extreme 三档，alphaIters 都不会先于 alphaMs 触发。
// ②用的是静态下界，不依赖本机速度：只要 alphaIters 大于「在该 ms 内最快可能跑完的迭代数」，
// 迭代数就不可能成为约束。取 200 µs/迭代作为乐观下界——本机实测 ~1000–1350 µs/迭代，
// 即留了 5–6 倍余量，足以覆盖比本容器快得多的机器；再激进（如 20 µs）就不是「乐观」而是失真了。
// `fast` 档不在断言范围内：它是「看 AI 互打」用的，0.1 s、故意让迭代数封顶。
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('../tools/_sandbox.js');
const { PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js'] });

let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok ' + m); else { fails++; console.log('FAIL ' + m); } };

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function midgame(seed, plies) {
  const st = S.newState(4, [5, 5, 5, 5]); st.rnd = mulberry32(seed);
  for (let k = 0; k < plies; k++) {
    const ch = S.currentChooser(st); const legal = S.legalRoleIdxs(st);
    if (ch < 0 || !legal.length || S.isTerminal(st)) break;
    S.applyRole(st, S.heuristicPickRole(st, ch, legal));
  }
  return st;
}

// ---- ① 时间预算真的能约束搜索（且迭代上限高时不抢先触发）----
{
  const run = (ms) => {
    let tot = 0;
    for (let i = 0; i < 3; i++) {
      const r = S.ismctsPickRoleIdx(midgame(900 + i, 6), { maxIters: 60000, budgetMs: ms, returnStats: true });
      tot += r.iters;
    }
    return tot;
  };
  const lo = run(150), hi = run(600);
  ok(lo > 0 && hi > 0, `① 两档都跑出了迭代（150ms=${lo}, 600ms=${hi}）`);
  ok(hi > lo * 1.8, `① 预算 ×4 应让迭代数显著增加：150ms=${lo} → 600ms=${hi}（比值 ${(hi / lo).toFixed(2)}×，须 >1.8）`);
  ok(lo < 60000 * 3, '① 未触及 maxIters 上限（说明确实是时间在约束）');
}

// ---- ② 迭代上限不得先于时间预算触发（就是 §16.2 那个 bug）----
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const m = src.match(/const budgetMap = \{([\s\S]*?)\n  \};/);
  ok(!!m, '② 找得到 game.js 的 budgetMap');
  const FASTEST_US_PER_ITER = 200;  // 乐观下界；本机实测 ~1000–1350 µs/迭代
  for (const preset of ['normal', 'deep', 'extreme']) {
    const row = m[1].match(new RegExp(preset + ':\\s*\\{([^}]*)\\}'));
    ok(!!row, `② 找得到 ${preset} 档`);
    const num = (k) => { const r = row[1].match(new RegExp(k + ':\\s*(\\d+)')); return r ? parseInt(r[1]) : null; };
    for (const [it, ms] of [['alphaIters', 'alphaMs'], ['expertIters', 'expertMs']]) {
      const iters = num(it), budget = num(ms);
      const ceiling = Math.ceil(budget * 1000 / FASTEST_US_PER_ITER);   // 该时长内最快可能的迭代数
      ok(iters >= ceiling,
        `② ${preset}.${it}=${iters} 须 ≥ ${ceiling}（=${ms} ${budget}ms ÷ ${FASTEST_US_PER_ITER}µs），` +
        `否则迭代数会先于时间预算触发，思考时间被白白扔掉（§16.2）`);
    }
  }
}

console.log(fails ? `\nBUDGET BINDING TEST FAILED: ${fails}` : '\nBUDGET BINDING TEST OK');
process.exit(fails ? 1 : 0);
