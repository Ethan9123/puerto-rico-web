// tests/worker_vnet_test.js — Phase 2：ai_worker.js 价值网协议（沙盒模拟 Worker 全局）
//   ① init（不带 nnUrl）→ ready.nn=false；loadnn{nnUrl} → nnready.nn=true, vnet=false
//   ② _l6ValueNet 旋钮已透传但 vnet 未加载 → alpha pick 回 error（不静默退化）
//   ③ loadnn{vnetUrl:对象} → nnready.vnet=true；alpha pick（truncate 0）→ result，且确定性
//   ④ loadnn 失败路径（坏 URL）→ nnready.vnet=false 带 message
'use strict';
const { loadEngine, createSandbox } = require('../tools/_sandbox.js');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fails = 0; const check = (c, m) => { if (!c) { fails++; console.log('  FAIL:', m); } };
function randVNet(seed) {
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const dims = [446, 32, 16, 4]; const layers = [];
  for (let i = 0; i + 1 < dims.length; i++) {
    const inn = dims[i], out = dims[i + 1]; const W = []; for (let o = 0; o < out; o++) { const row = []; for (let j = 0; j < inn; j++) row.push(rnd() * 0.1); W.push(row); }
    const last = i + 2 === dims.length; layers.push(Object.assign({ name: 'v.' + i, type: 'linear', in: inn, out, W, b: new Array(out).fill(0) }, last ? { head: 'value' } : {}));
    layers.push(last ? { name: 'v.t', type: 'tanh' } : { name: 'v.r' + i, type: 'relu' });
  }
  return { feature_dim: 446, value_only: true, value_dim: 4, n_roles: 7, layers };
}
async function waitFor(out, n) { for (let w = 0; w < 400 && out.length < n; w++) await new Promise(r => setTimeout(r, 25)); return out.shift(); }

(async () => {
  const { PRSim: S, run } = loadEngine({ files: ['game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });
  const out = [];
  const { sandbox: wsb, load } = createSandbox({ extraGlobals: { postMessage: (m) => out.push(m) } });
  wsb.self = wsb; wsb.importScripts = (...files) => { for (const f of files) load(f); }; delete wsb.window;
  load('ai_worker.js');
  const staticData = run('({ BUILDINGS, BLD_BY_ID, GOODS, GOOD_PRICE, ROLE_LIST })');
  // ① init without nn
  wsb.onmessage({ data: { type: 'init', staticData, nnUrl: null, knobs: {} } });
  const ready = await waitFor(out, 1);
  check(ready && ready.type === 'ready' && ready.nn === false, '① ready without nn: ' + JSON.stringify(ready));
  wsb.onmessage({ data: { type: 'loadnn', nnUrl: 'mcts_value_nn.json' } });
  const nr = await waitFor(out, 1);
  check(nr && nr.type === 'nnready' && nr.nn === true && nr.vnet === false, '① nnready nn=true vnet=false: ' + JSON.stringify(nr));
  // mid state
  const st = S.newState(4, [5, 5, 5, 5]); st.rnd = mulberry32(9);
  for (let k = 0; k < 8; k++) { const ch = S.currentChooser(st); const legal = S.legalRoleIdxs(st); if (ch < 0 || !legal.length) break; S.applyRole(st, S.heuristicPickRole(st, ch, legal)); }
  const plain = JSON.parse(JSON.stringify(Object.assign({}, st, { rnd: undefined })));
  const pick = (id, knobs, extra) => wsb.onmessage({ data: Object.assign({ type: 'pick', id, state: JSON.parse(JSON.stringify(plain)), mode: 'alpha', opts: { maxIters: 30, budgetMs: 1e9, C: 1.5, truncate: 0, rolloutFrac: 0 }, seed: 777, knobs }, extra || {}) });
  // ② vnet knob set, vnet not loaded → error
  pick('needs-vnet', { _l6ValueNet: true, _l6LeafTruncate: 0 });
  const e1 = out.shift();
  check(e1 && e1.type === 'error' && e1.id === 'needs-vnet' && /value net/.test(e1.message || ''), '② alpha pick without vnet → error: ' + JSON.stringify(e1));
  // alpha pick with knob off still works (big net rollout path)
  pick('no-vnet', { _l6ValueNet: false });
  const r0 = out.shift();
  check(r0 && r0.type === 'result' && r0.iters === 30, '② alpha pick without knob → result');
  // ③ load vnet object → vnet=true → pick ok + deterministic
  wsb.onmessage({ data: { type: 'loadnn', vnetUrl: randVNet(1) } });
  const nr2 = await waitFor(out, 1);
  check(nr2 && nr2.type === 'nnready' && nr2.nn === true && nr2.vnet === true, '③ nnready vnet=true: ' + JSON.stringify(nr2));
  check(wsb.PRSim.valueNetLoaded(), '③ worker PRSim.valueNetLoaded');
  pick('v1', { _l6ValueNet: true, _l6LeafTruncate: 0 });
  const r1 = out.shift();
  check(r1 && r1.type === 'result' && r1.id === 'v1' && S.legalRoleIdxs(st).includes(r1.idx) && r1.iters === 30, '③ alpha pick with vnet → result: ' + JSON.stringify(r1 && { type: r1.type, message: r1.message }));
  pick('v2', { _l6ValueNet: true, _l6LeafTruncate: 0 });
  const r2 = out.shift();
  check(r2 && r2.idx === r1.idx && JSON.stringify(r2.stats) === JSON.stringify(r1.stats), '③ deterministic under seed');
  check(wsb._l6ValueNet === true, '③ knob applied to worker global');
  // rolloutFrac passes via opts (search runs, result legal)
  wsb.onmessage({ data: { type: 'pick', id: 'frac', state: JSON.parse(JSON.stringify(plain)), mode: 'alpha', opts: { maxIters: 30, budgetMs: 1e9, C: 1.5, truncate: 0, rolloutFrac: 0.5 }, seed: 5, knobs: { _l6ValueNet: true } } });
  const r3 = out.shift();
  check(r3 && r3.type === 'result' && S.legalRoleIdxs(st).includes(r3.idx), '③ rolloutFrac pick → result');
  // ④ bad vnet url on a fresh worker
  {
    const out2 = []; const { sandbox: w2, load: l2 } = createSandbox({ extraGlobals: { postMessage: (m) => out2.push(m) } });
    w2.self = w2; w2.importScripts = (...files) => { for (const f of files) l2(f); }; delete w2.window; l2('ai_worker.js');
    w2.onmessage({ data: { type: 'init', staticData, nnUrl: null } }); await waitFor(out2, 1);
    w2.onmessage({ data: { type: 'loadnn', vnetUrl: 'no/such/vnet.json' } });
    const bad = await waitFor(out2, 1);
    check(bad && bad.type === 'nnready' && bad.vnet === false && typeof bad.message === 'string', '④ bad vnet url → vnet=false with message: ' + JSON.stringify(bad));
  }
  console.log(fails ? `\nWORKER VNET TEST FAILED: ${fails}` : '\nWORKER VNET TEST OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
