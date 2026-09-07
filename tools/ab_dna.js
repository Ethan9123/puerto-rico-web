// tools/ab_dna.js — A/B 对照两套 DNA 池(都作为 L2)的实战强度, 位置对齐。
//
// 用途: 验证"换一套 DNA 是否让 L2 更强", 例如把 extract_evolver_dna.py 从新版进化器
//       抽出的池子和现有 ai_dna.json 对打。每局 4 人, 2 座位用 OLD 池、2 座位用 NEW 池,
//       6 种座位组合轮转(每个位置各被 OLD/NEW 占用一半), 消除位置偏置。
//       报告: NEW 组整局胜率(公平=50%) + 每个位置的人均 VP 差(NEW-OLD)。
//
// 用法:
//   node tools/ab_dna.js [NGAMES] [NEW_POOL_JSON]
//   node tools/ab_dna.js 1200 /tmp/candidate_pool.json     # OLD=ai_dna.json, NEW=候选池
//   node tools/ab_dna.js 800                               # NEW 缺省=ai_dna.json(自对照≈50%)
const fs = require('fs'), path = require('path');
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
const ROOT = path.join(__dirname, '..');

// OLD/NEW 池与局数在引擎加载前注入沙盒全局(与旧样板一致, 供下方 src 直接引用)
const { run } = loadEngine({
  files: ['ai_dna.js', 'game.js', 'sim.js'],
  beforeLoad: sb => {
    sb.OLD_POOL = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai_dna.json'), 'utf8'));
    sb.NEW_POOL = JSON.parse(fs.readFileSync(process.argv[3] || path.join(ROOT, 'ai_dna.json'), 'utf8'));
    sb.NGAMES = parseInt(process.argv[2] || '800');
  },
});

const src = `(async () => {
  render = function () {}; flyToDest = function () {}; showToast = function () {};
  window._allAIMode = true; window._fastSpectator = true;
  window._aiThinkBudget = { L4:1, L5:1, hardIters:1, hardMs:1, expertIters:1, expertMs:1 };
  await loadAIDNA();
  const N = 4, PATTERNS = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];   // 哪两个座位用 NEW
  function pick(pool, pos) { const a = pool[pos]; const k = Math.min(5, a.length); return a[Math.floor(Math.random()*k)]; }
  const seat = {}; for (let i = 0; i < N; i++) seat[i] = { new:{n:0,vp:0}, old:{n:0,vp:0} };
  let newWins = 0, oldWins = 0, done = 0, err = 0;
  for (let g = 0; g < NGAMES; g++) {
    const newSeats = new Set(PATTERNS[g % PATTERNS.length]);
    let totals;
    try {
      G = new Game(N, 'AI');
      G.players.forEach((p, i) => { p.isHuman = false; p._aiLevel = 2;
        const e = pick(newSeats.has(i) ? NEW_POOL : OLD_POOL, 'P'+(i+1));
        p._dna = splitDNA(joinDNA(e.dna)); });
      await runMainLoop();
      totals = G.players.map(p => p.vp + p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0) + G.getSpecialVPs(p));
    } catch (e) { err++; continue; }
    let wi = 0; for (let i = 1; i < N; i++) if (totals[i] > totals[wi]) wi = i;
    for (let i = 0; i < N; i++) { const grp = newSeats.has(i)?'new':'old'; seat[i][grp].n++; seat[i][grp].vp += totals[i]; }
    if (newSeats.has(wi)) newWins++; else oldWins++;
    done++;
  }
  let dsum = 0; const perSeat = [];
  for (let i = 0; i < N; i++) { const s = seat[i]; const mn = s.new.vp/Math.max(1,s.new.n), mo = s.old.vp/Math.max(1,s.old.n);
    perSeat.push({ seat:i, newVP:mn, oldVP:mo, d:mn-mo }); dsum += (mn-mo); }
  return { done, err, newWins, oldWins, perSeat, dVP: dsum/N };
})()`;
run(src).then(r => {
  const tot = r.newWins + r.oldWins, wr = 100*r.newWins/tot;
  const ci = 100 * 1.96 * Math.sqrt((wr/100)*(1-wr/100)/tot);
  console.log(`games=${r.done} (err=${r.err})  NEW=${process.argv[3]||'ai_dna.json'}`);
  console.log(`NEW-group win rate: ${r.newWins}/${tot} = ${wr.toFixed(1)}%  (fair=50%, 95%CI ±${ci.toFixed(1)})`);
  console.log(`position-controlled mean VP delta (NEW-OLD), avg over seats: ${r.dVP>=0?'+':''}${r.dVP.toFixed(2)}`);
  for (const s of r.perSeat) console.log(`  seat ${s.seat} (P${s.seat+1}): NEW ${s.newVP.toFixed(1)}  OLD ${s.oldVP.toFixed(1)}  Δ=${s.d>=0?'+':''}${s.d.toFixed(2)}`);
}).catch(e => { console.error('ERR', e); process.exit(1); });
