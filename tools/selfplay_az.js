// ============================================================
// tools/selfplay_az.js — 全决策 AlphaZero 自对弈数据生成
// ============================================================
// 用因子化引擎打全决策自对弈，每个决策点记录:
//   f   : azFeatures(452)
//   pi  : 策略目标(稀疏 [[globalActionIdx, prob], ...])
//   legal: 合法动作全局索引(供训练掩码)
//   v   : value 向量(终局回填, chooser 视角座次序, 长 4)
//   n   : 玩家数
//
// 模式:
//   heuristic (gen0 引导): 动作=启发式; pi=该动作 one-hot — 行为克隆, 快速冷启动
//   nn        (gen N)    : 动作=azGumbelSearch(NN制导); pi=搜索改进策略 — 真正提升
//
// 用法:
//   node tools/selfplay_az.js [GAMES] [OUT] [NUM_PLAYERS] [MODE] [NN_PATH] [NUMSIMS]
//   node tools/selfplay_az.js 3000 data/az-gen0.jsonl 4 heuristic
//   node tools/selfplay_az.js 1500 data/az-gen1.jsonl 4 nn mcts_value_az.json 64
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() {
  const el = { _c:[], innerHTML:'', textContent:'', style:{}, className:'', dataset:{},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}}, value:'', checked:false,
    appendChild(c){this._c.push(c);return c;}, removeChild(){}, remove(){}, addEventListener(){}, removeEventListener(){},
    setAttribute(){}, getAttribute(){return null;}, insertAdjacentHTML(){}, querySelector(){return null;},
    querySelectorAll(){return [];}, getBoundingClientRect(){return{left:0,top:0,width:0,height:0};}, cloneNode(){return makeEl();}, closest(){return null;}, focus(){}, click(){}, onclick:null };
  return el;
}
const _els = {};
const sandbox = {
  document:{ getElementById:id=>(_els[id]||(_els[id]=makeEl())), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl(), body:makeEl(), documentElement:makeEl(), addEventListener(){} },
  console, setTimeout, clearTimeout, requestAnimationFrame:fn=>setTimeout(fn,0),
  performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, module:{exports:{}}, Float32Array,
  fetch: async f => ({ ok:true, status:200, json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')) }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js','sim_az.js']) load(f);
const S = sandbox.PRSim;

const GAMES = parseInt(process.argv[2] || '2000');
const OUT = process.argv[3] || path.join(__dirname, '..', 'data', `az-${Date.now()}.jsonl`);
const NP = parseInt(process.argv[4] || '4');
const MODE = process.argv[5] || 'heuristic';
const NN_PATH = process.argv[6] || null;
const NUMSIMS = parseInt(process.argv[7] || '64');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const fd = fs.openSync(OUT, 'w');

(async () => {
  if (MODE === 'nn') {
    if (!NN_PATH) { console.error('nn mode needs NN_PATH'); process.exit(1); }
    await S.azLoadNetwork(NN_PATH);
  }
  console.log(`SelfPlay AZ: games=${GAMES} out=${OUT} np=${NP} mode=${MODE} ${MODE==='nn'?'sims='+NUMSIMS:''}`);
  console.log(`  feature_dim=${S.AZ_FEATURE_DIM} action_dim=${S.AZ_ACTION_DIM}`);

  let totalSamples = 0, totalGames = 0, startMs = Date.now(), tick = 0;
  for (let g = 0; g < GAMES; g++) {
    let seed = (g * 2654435761) >>> 0;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const st = S.newState(NP, new Array(NP).fill(5), rng);
    const samples = []; // {f, pi(sparse), legal, chooser}
    let steps = 0;
    while (!S.isTerminal(st) && steps++ < 600) {
      const dec = S.azDecision(st);
      if (!dec) break;
      const f = S.azFeatures(st, dec);
      let action, piSparse;
      if (MODE === 'nn') {
        const res = S.azGumbelSearch(st, { numSims: NUMSIMS, numConsidered: Math.min(16, dec.actions.length), rng });
        action = res.action;
        piSparse = [];
        for (const a of dec.actions) { const gi = S.azActionToGlobal(dec.type, a); const p = res.policyTarget[gi]; if (p > 1e-6) piSparse.push([gi, Math.round(p * 10000) / 10000]); }
      } else {
        action = S.azHeuristicAction(st, dec);
        piSparse = [[S.azActionToGlobal(dec.type, action), 1]]; // 行为克隆 one-hot
      }
      const legal = dec.actions.map(a => S.azActionToGlobal(dec.type, a));
      const fr = new Array(f.length); for (let i = 0; i < f.length; i++) fr[i] = Math.round(f[i] * 10000) / 10000;
      samples.push({ f: fr, pi: piSparse, legal, chooser: dec.chooser });
      S.azApply(st, action);
    }
    // 终局回填 value 向量(chooser 视角座次序)
    const sc = st.players.map(p => S.finalScore(p));
    for (const s of samples) {
      const v = [0, 0, 0, 0];
      for (let k = 0; k < NP; k++) {
        const me = (s.chooser + k) % NP;
        let opp = 0, c = 0; for (let j = 0; j < NP; j++) if (j !== me) { opp += sc[j]; c++; }
        v[k] = Math.max(-1, Math.min(1, Math.round(((sc[me] - opp / c) / 50) * 10000) / 10000));
      }
      fs.writeSync(fd, JSON.stringify({ f: s.f, pi: s.pi, legal: s.legal, v, n: NP }) + '\n');
      totalSamples++;
    }
    totalGames++;
    if (g >= tick) {
      const el = (Date.now() - startMs) / 1000;
      console.log(`  game ${g + 1}/${GAMES} samples=${totalSamples} elapsed=${el.toFixed(1)}s eta=${(el/(g+1)*(GAMES-g-1)).toFixed(0)}s ${(totalSamples/Math.max(1,el)).toFixed(1)}/s`);
      tick = Math.max(g + 1, Math.floor(g + GAMES / 20));
    }
  }
  fs.closeSync(fd);
  const total = (Date.now() - startMs) / 1000;
  console.log(`Done: ${totalGames} games, ${totalSamples} samples in ${total.toFixed(1)}s (${(totalSamples/total).toFixed(1)}/s)`);
  console.log(`Size: ${(fs.statSync(OUT).size/1e6).toFixed(2)} MB`);
})().catch(e => { console.error(e); process.exit(1); });
