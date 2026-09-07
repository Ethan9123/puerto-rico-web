// ============================================================
// tests/worker_static_sync_test.js — AI worker 池的静态表同步 / 特征布局 / NN 按需加载
// ============================================================
// 覆盖：
//  ① sim_features 建筑布局固定 23 个基础 id：扩展/贵族/Tibs 局下主线程与 worker 的 extractRich 逐位一致；
//  ② 主线程每次 pick 下发 tables（BUILDINGS id 顺序 + 造价）→ worker 就地同步 _PR_STATIC，
//     新建筑+平衡 / 轮抽后 / 回到基础局 三种切换后 worker 的建造候选与主线程 sim 一致；
//  ③ init 不带 nnUrl 时 worker 不加载 NN；loadnn（URL 或去掉 _wasmForward 的权重对象副本）→ nnready nn=true，
//     之后 alpha pick 正常。
// 用法：node tests/worker_static_sync_test.js
'use strict';
const { loadEngine, createSandbox } = require('../tools/_sandbox.js');

let fails = 0, passes = 0;
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('  ✗ FAIL:', msg); } }

function makeWorker() {
  const out = [];
  const { sandbox: wsb, load, run } = createSandbox({ extraGlobals: { postMessage: (m) => out.push(m) } });
  wsb.self = wsb;
  wsb.importScripts = (...files) => { for (const f of files) load(f); };
  delete wsb.window;
  load('ai_worker.js');
  const send = async (msg) => { wsb.onmessage({ data: msg }); for (let w = 0; w < 400 && !out.length; w++) await new Promise(r => setTimeout(r, 25)); return out.shift(); };
  return { wsb, run, send, out };
}
const plain = (o) => JSON.parse(JSON.stringify(o)); // 模拟 structured clone（state / tables）

(async () => {
  const main = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js'] });
  const M = main.run('({ Game, BUILDINGS, BLD_BY_ID, BASE_BUILDINGS, GOODS, GOOD_PRICE, ROLE_LIST, buildSimState, PRSim, PRAIPool })');
  // PRAIPool._init 发送的 staticData（基础 23 个）+ pickRoleParallel 每次下发的 tables
  const staticData = () => plain({ BUILDINGS: M.BASE_BUILDINGS.slice(), BLD_BY_ID: M.BLD_BY_ID, GOODS: M.GOODS, GOOD_PRICE: M.GOOD_PRICE, ROLE_LIST: M.ROLE_LIST });
  const tables = () => plain(M.PRAIPool._tables());
  const W = makeWorker();
  const ready = await W.send({ type: 'init', staticData: staticData(), knobs: {} });
  check(ready && ready.type === 'ready' && ready.nn === false, 'init without nnUrl → ready nn=false: ' + JSON.stringify(ready));
  check(W.wsb.PRSim.N_BUILDINGS === 23 && M.PRSim.N_BUILDINGS === 23, 'N_BUILDINGS fixed at 23 on both sides');

  // ---- ① 特征布局：贵族 / Tibs / 新建筑 局 ----
  console.log('① extractRich parity under expansions');
  const buildOpts = () => ({ maxIters: 5, budgetMs: 1e9, C: 1.5, truncate: 8 });
  async function pickSync(G) { // 一次 pick 即触发 worker 的 syncTables
    const st = M.buildSimState(G);
    const r = await W.send({ type: 'pick', id: 'sync', state: plain(Object.assign({}, st, { rnd: undefined })), mode: 'hard', opts: buildOpts(), seed: 7, knobs: {}, tables: tables() });
    check(r && r.type === 'result', 'pick ok: ' + JSON.stringify(r && { type: r.type, message: r.message }));
    return st;
  }
  function featParity(G, edits, label) {
    const st = M.buildSimState(G); delete st.rnd;
    edits(st);
    const stW = plain(st);
    let diffs = 0, first = null;
    for (let seat = 0; seat < st.numPlayers; seat++) {
      const a = M.PRSim.extractRich(st, seat), b = W.wsb.PRSim.extractRich(stW, seat);
      check(a.length === b.length && a.length === M.PRSim.FEATURE_DIM_RICH, label + ': dim');
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diffs++; if (first == null) first = `${seat}@${i}:${a[i]}vs${b[i]}`; }
    }
    check(diffs === 0, `${label}: extractRich identical main vs worker (diffs=${diffs} first=${first})`);
    return st;
  }
  {
    const G = new M.Game(4, 'p', { nobles: true });
    check(M.BUILDINGS.length === 31, 'nobles game has 31 buildings in BUILDINGS');
    await pickSync(G);
    const st = featParity(G, (st) => { st.players[3].buildings = [{ bid: 44, men: 1 }, { bid: 45, men: 1 }, { bid: 7, men: 0 }]; }, 'nobles');
    // 贵族建筑不占基础 23 位槽：槽 3(视角 0) 的 owned 位只有 bid 7
    const f = M.PRSim.extractRich(st, 0), base = 3 * 68;
    let ownedBits = []; for (let i = 0; i < 23; i++) if (f[base + 19 + i]) ownedBits.push(i + 1);
    check(ownedBits.join(',') === '7', 'noble buildings do not alias into base slots (owned=' + ownedBits + ')');
    check(f[base + 42 + 6] === 0 && f[base + 42 + 7] === 0 && f[4 * 68] === 0 && f[4 * 68 + 1] === 0, 'no overflow into manned bits / slot 4');
  }
  {
    const G = new M.Game(4, 'p', { tibsBuildings: true });
    check(!M.BUILDINGS.some(b => b.id === 11) && M.BUILDINGS.length > 23, 'tibs game drops Hospice(11)');
    await pickSync(G);
    const st = featParity(G, (st) => { st.players[0].buildings = [{ bid: 12, men: 1 }, { bid: 23, men: 1 }, { bid: 48, men: 1 }]; }, 'tibs');
    const f = M.PRSim.extractRich(st, 0);
    check(f[19 + 11] === 1 && f[19 + 22] === 1 && f[42 + 11] === 1 && f[42 + 22] === 1, 'tibs: bid 12/23 land on fixed slots 11/22 (no shift after removing 11)');
  }
  {
    const G = new M.Game(4, 'p', { newBuildings: true });
    await pickSync(G);
    featParity(G, (st) => { st.players[0].buildings = [{ bid: 24, men: 0 }, { bid: 1, men: 0 }]; }, 'newBuildings');
    const st = M.buildSimState(G); st.players[0].buildings = [{ bid: 24, men: 0 }, { bid: 1, men: 0 }];
    check(M.PRSim.extractRich(st, 0)[42] === 0, 'bid 24 does not alias to manned bit of bid 1');
  }

  // ---- ② tables 同步：worker 的建造候选 == 主线程 sim ----
  console.log('② static tables sync per pick');
  const ids = (arr) => arr.map(b => b.id).join(',');
  function buildActions(PR, st0, money) {
    const st = plain(st0); st.az = { phase: 'builder', chooser: 0, ord: [1], oi: 0 }; st.players[1].money = money; st.rnd = () => 0.5;
    const d = PR.azDecision(st); return JSON.stringify(d && d.actions);
  }
  async function compare(G, label) {
    const st = await pickSync(G); delete st.rnd;
    const S = W.run('self._PR_STATIC');
    check(ids(S.BUILDINGS) === ids(M.BUILDINGS), `${label}: worker BUILDINGS ids == main (${ids(S.BUILDINGS)})`);
    check(S.BLD_BY_ID[15].cost === M.BLD_BY_ID[15].cost && S.BLD_BY_ID[16].cost === M.BLD_BY_ID[16].cost, `${label}: costs 15/16 = ${S.BLD_BY_ID[15].cost}/${S.BLD_BY_ID[16].cost}`);
    for (const money of [7, 20]) check(buildActions(M.PRSim, st, money) === buildActions(W.wsb.PRSim, st, money), `${label}: build actions identical at money=${money}`);
  }
  await compare(new M.Game(3, 'P', { newBuildings: true, balance: true }), 'newBuildings+balance');
  check(W.run('self._PR_STATIC.BLD_BY_ID[15].cost') === 8, 'balance: Factory cost 8 in worker');
  {
    // 轮抽：主线程 splice 掉未选中的扩展建筑
    main.run('G = new Game(3, "P", { newBuildings: true })');
    main.run('G.buildingStock = {}; for (let i = BUILDINGS.length - 1; i >= 0; i--) if (BUILDINGS[i].id > 23 && BUILDINGS[i].id !== 24) BUILDINGS.splice(i, 1); BUILDINGS.forEach(b => G.buildingStock[b.id] = b.qty);');
    check(M.BUILDINGS.length === 24, 'post-draft main has 24 buildings');
    await compare(main.run('G'), 'post-draft');
  }
  await compare(main.run('G = new Game(3, "P", {}); G'), 'back to base');
  check(W.run('self._PR_STATIC.BUILDINGS.length') === 23 && W.run('self._PR_STATIC.BLD_BY_ID[15].cost') === 7, 'base: 23 buildings, Factory cost 7 in worker');
  // sim.js 闭包绑定的 BUILDINGS_ 与 _PR_STATIC.BUILDINGS 是同一对象（就地同步才有效）
  {
    const stB = M.buildSimState(main.run('G')); delete stB.rnd;
    const st = plain(stB); st.az = { phase: 'builder', chooser: 0, ord: [1], oi: 0 }; st.players[1].money = 20; st.rnd = () => 0.5;
    const acts = W.wsb.PRSim.azDecision(st).actions;
    check(!acts.some(a => a > 23), 'worker never proposes expansion buildings in a base game (' + JSON.stringify(acts) + ')');
  }

  // ---- ③ NN 按需加载 ----
  console.log('③ lazy NN load (loadnn)');
  {
    const r0 = await W.send({ type: 'pick', id: 'noNN', state: plain(Object.assign({}, M.buildSimState(main.run('G')), { rnd: undefined })), mode: 'alpha', opts: { maxIters: 5, budgetMs: 1e9, C: 1.5, truncate: 999 }, seed: 1, knobs: {}, tables: tables() });
    check(r0 && r0.type === 'error' && /NN/.test(r0.message), 'alpha pick before loadnn → error (' + (r0 && r0.message) + ')');
    const nr = await W.send({ type: 'loadnn', nnUrl: 'mcts_value_nn.json' });
    check(nr && nr.type === 'nnready' && nr.nn === true, 'loadnn(url) → nnready nn=true: ' + JSON.stringify(nr));
    const nr2 = await W.send({ type: 'loadnn', nnUrl: 'mcts_value_nn.json' });
    check(nr2 && nr2.nn === true, 'loadnn idempotent');
    const r1 = await W.send({ type: 'pick', id: 'alpha', state: plain(Object.assign({}, M.buildSimState(main.run('G')), { rnd: undefined })), mode: 'alpha', opts: { maxIters: 5, budgetMs: 1e9, C: 1.5, truncate: 999 }, seed: 1, knobs: {}, tables: tables() });
    check(r1 && r1.type === 'result' && r1.iters === 5, 'alpha pick after loadnn ok');
    // 主线程已加载的权重对象（_prep 后 W=null/_Wf=Float64Array，可能带 _wasmForward 函数）→ 去掉 _wasmForward 的副本可 clone 并在 worker 中加载
    const net = await M.PRSim.loadNetwork('mcts_value_nn.json');
    net._wasmForward = net._wasmForward || function fake() {}; // 无 nn_wasm 时也模拟主线程挂上的函数
    let cloneErr = null; try { structuredClone(net); } catch (e) { cloneErr = e; }
    check(cloneErr && /clone/i.test(cloneErr.message), 'live net object with _wasmForward is not cloneable (' + (cloneErr && cloneErr.name) + ')');
    const copy = Object.assign({}, net); delete copy._wasmForward;
    let copyClone = null; try { copyClone = structuredClone(copy); } catch (e) { cloneErr = e; }
    check(!!copyClone, 'stripped copy is structured-cloneable');
    const W2 = makeWorker();
    await W2.send({ type: 'init', staticData: staticData(), knobs: {} });
    const nr3 = await W2.send({ type: 'loadnn', nnUrl: copyClone });
    check(nr3 && nr3.nn === true, 'loadnn(prepped weights object copy) → nn=true: ' + JSON.stringify(nr3));
    const st = M.buildSimState(main.run('G')); delete st.rnd;
    const a = W.wsb.PRSim.networkEval(plain(st), 0), b = W2.wsb.PRSim.networkEval(plain(st), 0);
    check(a && b && Math.abs(a.value - b.value) < 1e-9, 'url-loaded and object-loaded worker nets agree');
    const nr4 = await W2.send({ type: 'loadnn', nnUrl: 'does_not_exist.json' });
    check(nr4 && nr4.nn === true, 'loadnn after success stays true (idempotent)');
    const W3 = makeWorker();
    await W3.send({ type: 'init', staticData: staticData(), knobs: {} });
    const nr5 = await W3.send({ type: 'loadnn', nnUrl: 'does_not_exist.json' });
    check(nr5 && nr5.nn === false && typeof nr5.message === 'string', 'loadnn failure reports message: ' + JSON.stringify(nr5));
  }

  console.log(`\n${fails === 0 ? 'WORKER STATIC SYNC OK' : 'WORKER STATIC SYNC FAILED'}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
