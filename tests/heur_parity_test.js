// tests/heur_parity_test.js — 真实对局里 sim 子决策启发式(fid 开) ↔ game.js 真实 AI 的逐决策一致性（第三轮 Stage 4）
//
// 用 tools/heur_parity.js 的同一套钩子，跑少量真实对局（4 人 1×L6 + 3×L5，DEPLOY 权重，seedBase 20261201 g0..5；
// 角色搜索预算压到 30 次迭代——子决策启发式与角色搜索预算无关，只影响走到哪些局面，换来 <1 分钟的运行时间）：
//   ① 每类子决策（build/settle/captain/mayor/trade/craftbonus）L6 座位的 fid 开残差分歧 ≤1%（预注册门槛）；
//      L5 座位同样断言 ≤1%（基础局里 L5 与 L6 走同一套默认启发式——DNA 只作用于 L2/L3、群友人格在纯 AI 局零触发）
//   ② 安全闸拒绝率 ≤2%——**逐类 × 座位类**断言（az 重建的动作集合 ≠ game.js 选项集合 → 该点的 sim 模型不可信）；
//      只断言合计会让样本少的类（trade/craftbonus 只占 5-8%）在 ~25% 闸拒时仍混过去。
//      ① 同时要求 m = n − 闸拒 > 0：全被闸拒的格子不能以 0/0 = 0% 算通过。
//   ③ 非空洞：build 与 mayor 的 fid 关分歧 >0（对照有区分力），且六类都有样本
//   ④ 钩子不扰动对局：同参数带钩子 / 不带钩子的对局行逐字节相同；钩子无异常
//   ⑤ 漂移哨兵：这组固定种子上 fid 开残差合计恰为 0（比 1% 门槛敏感得多，理由见 ⑤ 处注释）
//   ⑥ 2 人局（6 局，1×L6 + 1×L5）：①②⑤ 同样断言。game.js gamePhase 的殖民者分母在 2 人局与 sim COL_TOTAL
//      不同（42 vs 40），4 人局对照对此是盲的；fid 路径改用 fidPhase 前，2 人局 L6 build 残差 6.4%。
// **角色分工**：① 的 1% 是预注册的验收线；**回归保护靠 ⑤**（6 局样本上稀有规则回退只造成 <1% 的残差，① 抓不到）。
//   将来若有合理的模型改动在这组种子上留下个位数残差，应在同一改动里说明原因并调整 ⑤，而不是放宽 ①。
// 反向验证（手工，结果记在 AI_STRENGTH §18.4）：把 sim.js pickPlantation 的 fid 采石场上限恢复成旧的 2
//   → ⑤ 变红（1/160 的 L5 settle 残差；① 的 1% 门槛在 6 局上抓不到，故加 ⑤）；
//   把 sim.js FID_COL_TOTAL 改回 COL_TOTAL 的 {1:29, 2:40} → ⑥ 的 2 人局 ①⑤ 变红（4 人局全绿）。
'use strict';
const { runParity, printTable, KINDS } = require('../tools/heur_parity.js');

const GAMES = parseInt(process.env.HP_GAMES || '6');
const ITERS = parseInt(process.env.HP_ITERS || '30');
const GAMES2P = parseInt(process.env.HP_GAMES2P || '6');
const SEED = 20261201;

(async () => {
  const t0 = Date.now();
  const a = await runParity({ games: GAMES, g0: 0, seedBase: SEED, iters: ITERS, hooks: true, lo: 5 });
  const b = await runParity({ games: GAMES, g0: 0, seedBase: SEED, iters: ITERS, hooks: false, lo: 5 });
  const p2 = await runParity({ games: GAMES2P, g0: 0, seedBase: SEED, iters: ITERS, hooks: true, lo: 5, players: 2 });
  let fails = 0;
  const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('  ok', m); };
  // ①②③⑤：逐类 × 座位类；tag 区分 4 人 / 2 人两组
  function checkParity(R, tag) {
    console.log(`---- ${tag} ----`);
    console.log(printTable(R));
    let totN = 0, totGate = 0, totDOn = 0;
    for (const k of KINDS) {
      const cells = R.kinds[k] || {};
      let nk = 0;
      for (const c of ['L6', 'L5']) {
        const x = cells[c]; if (!x) continue;
        nk += x.n; totN += x.n; totGate += x.gate; totDOn += x.dOn;
        const m = x.n - x.gate;
        const rate = m ? x.dOn / m : 0;
        ok(m > 0 && rate <= 0.01, `① ${tag} ${k} ${c}: fid 开残差 ${x.dOn}/${m} = ${(100 * rate).toFixed(2)}% ≤ 1%` + (x.dOn ? ' 例 ' + JSON.stringify(x.ex[0]) : ''));
        ok(x.gate / x.n <= 0.02, `② ${tag} ${k} ${c}: 安全闸拒绝 ${x.gate}/${x.n} = ${(100 * x.gate / x.n).toFixed(2)}% ≤ 2%`);
      }
      ok(nk > 0, `③ ${tag} ${k}: 有样本 n=${nk}`);
    }
    // ⑤ 漂移哨兵：固定种子集上 fid 开残差**恰为 0**（所有类、所有座位合计）。
    //   为什么在 1% 门槛之外还要这一条：1% 是预注册的验收线，但在 6 局的样本上它**抓不到**稀有规则的回退——
    //   实测把采石场 fid 上限改回旧的 2，只在 L5 座位造成 1/160 = 0.63% 的 settle 残差（该规则约每 6 局触发一次），
    //   1% 断言照样全绿。当前实现在这组种子上逐决策完全一致，任何残差都意味着 sim 与 game.js 又分叉了。
    ok(totDOn === 0, `⑤ ${tag} 漂移哨兵：fid 开残差合计 ${totDOn} === 0`);
    ok(totN > 0 && totGate / totN <= 0.02, `② ${tag} 合计安全闸拒绝率 ${totGate}/${totN} = ${(100 * totGate / Math.max(1, totN)).toFixed(2)}% ≤ 2%`);
    ok(R.hookErr === 0, `④ ${tag} 钩子无异常（hookErr=${R.hookErr}${R.hookErrEx && R.hookErrEx[0] ? ' ' + R.hookErrEx[0] : ''}）`);
  }
  const R = a.R;
  checkParity(R, '4p');
  const offB = ((R.kinds.build || {}).L6 || {}).dOff + ((R.kinds.build || {}).L5 || {}).dOff;
  const offM = ((R.kinds.mayor || {}).L6 || {}).dOff + ((R.kinds.mayor || {}).L5 || {}).dOff;
  ok(offB > 0 && offM > 0, `③ 非空洞：fid 关分歧 build=${offB} mayor=${offM}`);
  ok(a.rows.length === GAMES && a.rows.join('\n') === b.rows.join('\n') && !a.rows.some(r => /error|incomplete/.test(r)),
    `④ 带钩子 / 不带钩子的对局行逐字节相同（${a.rows.length} 局；钩子内 Math.random 调用 ${R.hookRand} 次均走隔离流）`);
  // ⑥ 2 人局
  checkParity(p2.R, '2p');
  ok(p2.rows.length === GAMES2P && !p2.rows.some(r => /error|incomplete/.test(r)), `⑥ 2p 对局完整（${p2.rows.length} 局）`);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (fails) { console.log(`heur_parity_test: ${fails} FAIL`); process.exit(1); }
  console.log('heur_parity_test: all ok');
})().catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
