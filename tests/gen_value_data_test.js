// tests/gen_value_data_test.js — Phase 2 数据分片：生成 → 读回 → 头/范围/量化无损/标签派生/确定性
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readShard, rewardFromScores } = require('../tools/value_shard.js');
const { loadEngine } = require('../tools/_sandbox.js');
const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prv-'));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

function gen(out, extra) {
  return execFileSync('node', [path.join(ROOT, 'tools/gen_value_data.js'), '--games', '6', '--out', out, '--seedBase', '777', '--mix', 'heur:0.6,hard:0.3,expert:0.1', '--eps', '0.2', '--hardIters', '8', '--expertIters', '8', '--progress', '100', ...(extra || [])], { cwd: ROOT, encoding: 'utf8' });
}
const outA = path.join(tmp, 'a.bin'), outB = path.join(tmp, 'b.bin'), outR = path.join(tmp, 'r.bin');
gen(outA); gen(outB); gen(outR, ['--rollouts', '2']);

const d = readShard(outA);
ok(d.version === 1 && d.featDim === 446 && d.seats === 4, `header: version=${d.version} featDim=${d.featDim} seats=${d.seats}`);
ok(d.nGames === 6 && d.n > 6 * 30, `counts: nGames=${d.nGames} n=${d.n}`);
ok(d.gameId.every(g => g < d.nGames), 'gameId range');
ok(Array.from(d.meta).every((v, i) => (i % 4 === 0 ? v < 4 : i % 4 === 2 ? v <= 1 : i % 4 === 3 ? v <= 3 : true)), 'meta ranges');
const kinds = new Set(); for (let i = 0; i < d.n; i++) kinds.add(d.meta[i * 4 + 3]);
ok(kinds.has(0) && kinds.has(3), `agent kinds seen: ${Array.from(kinds).join(',')} (need heur=0 and eps=3)`);
ok(d.scores.length === 24 && Array.from(d.scores).every(s => s > 0 && s < 200), 'scores plausible');
ok(d.gameSeed.length === 6 && d.gameSeed[0] === 777 >>> 0, `seeds: first=${d.gameSeed[0]}`);
// 确定性：同参数两次生成逐字节一致
ok(fs.readFileSync(outA).equals(fs.readFileSync(outB)), 'deterministic regeneration (byte-identical)');
// rollout 分片
const r = readShard(outR);
ok(r.hasRollout && r.rollout1.length === r.n * 4 && r.rolloutMean.length === r.n * 4, 'rollout arrays present');
ok(Array.from(r.rolloutMean).every(v => v >= -0.2 - 1e-6 && v <= 1 + 1e-6), 'rollout reward range [-0.2, 1]');
// 标签派生 = sim.js reward()：在真实终局状态上对比 rewardFromScores(finalScore 向量) 与 S.reward
const { PRSim: S } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js'] });
{
  let checked = 0, worst = 0;
  for (let g = 0; g < 12; g++) {
    const st = S.newState(4, [5, 5, 5, 5]);
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 400) { const ch = S.currentChooser(st); const legal = S.legalRoleIdxs(st); if (ch < 0 || !legal.length) break; S.applyRole(st, S.heuristicPickRole(st, ch, legal)); }
    if (!S.isTerminal(st)) continue;
    const sc = st.players.map(S.finalScore);
    for (let p = 0; p < 4; p++) { worst = Math.max(worst, Math.abs(rewardFromScores(sc, p) - S.reward(st, p))); checked++; }
  }
  console.log(`rewardFromScores vs sim.js reward: ${checked} comparisons, max |diff| = ${worst.toExponential(2)}`);
  ok(checked >= 40 && worst < 1e-12, 'reward derivation matches sim.js reward()');
}
// 量化无损：extractRich 特征均为 k/D(D≤120) → round(x*255)/255 与原值之差 < 1/510
{
  let worst = 0;
  const st = S.newState(4, [5, 5, 5, 5]);
  for (let i = 0; i < 40; i++) {
    const ch = S.currentChooser(st); const legal = S.legalRoleIdxs(st); if (ch < 0 || !legal.length) break;
    const f = S.extractRich(st, 0);
    for (let j = 0; j < f.length; j++) { const q = Math.round(f[j] * 255) / 255; worst = Math.max(worst, Math.abs(q - f[j])); ok(f[j] >= 0 && f[j] <= 1, `feature ${j} in [0,1]`); }
    S.applyRole(st, S.heuristicPickRole(st, ch, legal));
  }
  console.log(`quantization max |round(x*255)/255 - x| = ${worst.toExponential(3)} (limit ${(1 / 510).toExponential(3)})`);
  ok(worst < 1 / 510 + 1e-9, 'uint8 quantization lossless bound');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\nGEN VALUE DATA TEST FAILED: ${fails}` : `\nGEN VALUE DATA TEST OK (n=${d.n} positions from ${d.nGames} games)`);
process.exit(fails ? 1 : 0);
