// 训练 MCTS 叶子价值函数（逻辑回归）：自对弈采集 (状态特征, 是否最终获胜) → 梯度下降 →
// 输出 mcts_value.json。最后用"价值制导 MCTS vs 原版 MCTS"对打验证是否更强。
// 用法: node tools/train_value.js [gamesPerN] [valIters] [valGames]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const makeEl = () => ({ innerHTML:'', style:{}, classList:{add(){},remove(){}}, value:'', checked:false,
  appendChild(){}, addEventListener(){}, querySelector:()=>null, querySelectorAll:()=>[], insertAdjacentHTML(){},
  getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}), cloneNode(){return makeEl();} });
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), addEventListener(){} },
  console, setTimeout, performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','game.js'),'utf8'), sandbox, {filename:'game.js'});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sim.js'),'utf8'), sandbox, {filename:'sim.js'});
const S = sandbox.PRSim;

const GAMES_PER_N = parseInt(process.argv[2] || '600');
const VAL_ITERS = parseInt(process.argv[3] || '120');
const VAL_GAMES = parseInt(process.argv[4] || '24');

// ---------- ① 自对弈采集数据（启发式策略，快） ----------
function genData(n, games) {
  const X = [], Y = [];
  for (let g = 0; g < games; g++) {
    let st = S.newState(n, new Array(n).fill(5));
    const samples = [];
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 400) {
      const ch = S.currentChooser(st);
      if (ch < 0) break;
      const legal = S.legalRoleIdxs(st);
      if (!legal.length) break;
      samples.push({ f: S.extractFeatures(st, ch), ch });
      S.applyRole(st, S.heuristicPickRole(st, ch, legal));
    }
    if (!st.gameOver) continue;
    const scores = st.players.map(S.finalScore);
    const best = Math.max(...scores);
    for (const s of samples) { X.push(s.f); Y.push(scores[s.ch] === best ? 1 : 0); }
  }
  return { X, Y };
}

console.log(`采集自对弈数据 (3/4/5 人各 ${GAMES_PER_N} 局)...`);
let X = [], Y = [];
for (const n of [3, 4, 5]) { const d = genData(n, GAMES_PER_N); X = X.concat(d.X); Y = Y.concat(d.Y); }
const DIM = S.FEATURE_DIM;
console.log(`  样本数 ${X.length}, 维度 ${DIM}, 正例率 ${(Y.reduce((a,b)=>a+b,0)/Y.length*100).toFixed(1)}%`);

// ---------- ② 训练逻辑回归（批梯度下降 + L2） ----------
function sigmoid(z){ return 1/(1+Math.exp(-z)); }
function train(X, Y, dim, epochs, lr, l2) {
  const W = new Array(dim).fill(0);
  const N = X.length;
  for (let e = 0; e < epochs; e++) {
    const grad = new Array(dim).fill(0);
    let loss = 0;
    for (let i = 0; i < N; i++) {
      const xi = X[i]; let z = 0; for (let j = 0; j < dim; j++) z += W[j]*xi[j];
      const p = sigmoid(z); const err = p - Y[i];
      for (let j = 0; j < dim; j++) grad[j] += err * xi[j];
      loss += -(Y[i]*Math.log(p+1e-9) + (1-Y[i])*Math.log(1-p+1e-9));
    }
    for (let j = 0; j < dim; j++) W[j] -= lr * (grad[j]/N + l2*W[j]);
    if (e % 100 === 0 || e === epochs-1) console.log(`  epoch ${e} loss=${(loss/N).toFixed(4)}`);
  }
  return W;
}
console.log('训练价值函数...');
const W = train(X, Y, DIM, 400, 0.3, 1e-4);

const out = { dim: DIM, weights: W, note: 'logistic value: P(win)=sigmoid(W·features); features from PRSim.extractFeatures' };
fs.writeFileSync(path.join(__dirname,'..','mcts_value.json'), JSON.stringify(out, null, 2));
console.log('已写出 mcts_value.json');

// ---------- ③ 验证：价值制导 MCTS vs 原版 MCTS（等迭代数对打） ----------
function headToHead(n, games, iters, W) {
  let vWins = 0, vScore = 0, oScore = 0, played = 0;
  for (let g = 0; g < games; g++) {
    const seat = g % n;
    let st = S.newState(n, new Array(n).fill(5));
    let guard = 0;
    while (!S.isTerminal(st) && guard++ < 400) {
      const ch = S.currentChooser(st);
      if (ch < 0) break;
      const legal = S.legalRoleIdxs(st);
      if (!legal.length) break;
      const opts = (ch === seat)
        ? { maxIters: iters, budgetMs: 1e9, valueW: W, truncate: 6 }   // 价值制导
        : { maxIters: iters, budgetMs: 1e9 };                          // 原版(全 rollout)
      S.applyRole(st, S.ismctsPickRoleIdx(st, opts));
    }
    if (!st.gameOver) continue;
    played++;
    const scores = st.players.map(S.finalScore);
    const best = Math.max(...scores);
    if (scores[seat] === best) vWins++;
    for (let i = 0; i < n; i++) { if (i === seat) vScore += scores[i]; else oScore += scores[i]/(n-1); }
  }
  return { played, winrate: vWins/played, vAvg: vScore/played, oAvg: oScore/played };
}
console.log(`\n验证：价值制导MCTS vs 3×原版MCTS (${VAL_ITERS} 迭代, ${VAL_GAMES} 局)...`);
const r = headToHead(4, VAL_GAMES, VAL_ITERS, W);
console.log(`  胜率 ${(r.winrate*100).toFixed(0)}% (公平=25%) | 均分 价值制导=${r.vAvg.toFixed(1)} 原版=${r.oAvg.toFixed(1)}`);
console.log(r.winrate > 0.25 && r.vAvg > r.oAvg ? '\n训练 OK: 价值制导 MCTS 强于原版 MCTS' : '\n价值制导未超过原版(可加大数据/迭代或调参)');
