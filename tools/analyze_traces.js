// ============================================================
// tools/analyze_traces.js — 真人对局漏洞分析器
// ============================================================
// 读浏览器导出的 PRTrace JSON，把你每个决策点的局面快照回放给宗师，
// 找出「你选了 X、宗师会选 Y」的系统性分歧。重点看你【赢局】里的分歧——
// 那就是宗师被人类利用的候选漏洞点。
//
// 用法:
//   node tools/analyze_traces.js <traces.json> [iters=120] [nnPath=mcts_value_nn.json]
//   node tools/analyze_traces.js selftest        # 自检：用真实 buildSimState 快照验证机器能跑
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- 最小 DOM/沙箱（与 selfplay_dump.js 同款）----
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
  performance:{now:()=>Date.now()}, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, Promise, Symbol, RegExp, isNaN, parseInt, parseFloat, Infinity, NaN, Float32Array,
  fetch: async f => ({ ok:true, status:200, json: async ()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',f),'utf8')) }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'), sandbox, {filename:f});
for (const f of ['ai_dna.js','game.js','sim.js','sim_features.js','sim_nn.js']) load(f);
const PRSim = sandbox.PRSim;
const ROLE_LIST = sandbox.ROLE_LIST;
const ROLE_CN = sandbox.ROLE_NAME_CN || {};
const cn = n => ROLE_CN[n] || n;

const ARG1 = process.argv[2] || 'selftest';
const ITERS = parseInt(process.argv[3] || '120');
const NN_PATH = process.argv[4] || 'mcts_value_nn.json';

const VP_TOTAL = {1:50,2:65,3:75,4:100,5:122}, COL_TOTAL = {1:30,2:42,3:55,4:75,5:95};
function phaseOf(st){
  const cu = 1 - (st.colonistsLeft||0)/(COL_TOTAL[st.numPlayers]||75);
  const vu = 1 - (st.vpLeft||0)/(VP_TOTAL[st.numPlayers]||100);
  const pr = Math.max(cu, vu);
  return pr < 0.33 ? 'early' : pr < 0.66 ? 'mid' : 'late';
}

let NN_LOADED = false;
function botPick(state, iters) {
  if (typeof PRSim.ismctsPickRoleIdx !== 'function') return PRSim.legalRoleIdxs(state)[0];
  const opts = { maxIters: iters, budgetMs: 30000 };
  if (NN_LOADED) {
    opts.C = 1.5;
    opts.evalLeafFn = (s, p) => PRSim.evalLeafNN(s, p);
    opts.priorPolicyFn = (s, p) => {
      const o = PRSim.networkEval(s, p); if (!o) return null;
      const legal = PRSim.legalRoleIdxs(s);
      const legalNames = new Set(legal.map(i => s.roleCards[i].name));
      const dist = {}; let sum = 0;
      for (let k = 0; k < ROLE_LIST.length; k++) if (legalNames.has(ROLE_LIST[k])) { dist[ROLE_LIST[k]] = o.policy[k]; sum += o.policy[k]; }
      if (sum > 0) for (const k of Object.keys(dist)) dist[k] /= sum;
      return dist;
    };
  }
  return PRSim.ismctsPickRoleIdx(state, opts);
}

// 把一份序列化快照修好（JSON 丢了 rnd 函数；补回）后问宗师
function botPickFromSnapshot(state, iters) {
  if (!state || !state.players || !state.roleCards) return null;
  state.rnd = Math.random;                       // JSON 丢了函数，补回
  const idx = botPick(state, iters);
  if (idx == null || idx < 0 || !state.roleCards[idx]) return null;
  return state.roleCards[idx].name;
}

function analyze(games) {
  const buckets = { won: newAgg(), lost: newAgg() };
  let scannedDecisions = 0, replayed = 0;
  for (const g of games) {
    if (g.humanSeat == null || g.humanSeat < 0 || !g.result) continue;
    const bucket = g.result.humanWon ? buckets.won : buckets.lost;
    bucket.games++;
    for (const d of (g.decisions || [])) {
      scannedDecisions++;
      if (!d.state) continue;
      const human = d.chosen;
      const bot = botPickFromSnapshot(d.state, ITERS);
      if (!bot || !human) continue;
      replayed++;
      const ph = phaseOf(d.state);
      bucket.total++; bucket.byPhase[ph].total++;
      if (human === bot) { bucket.agree++; bucket.byPhase[ph].agree++; }
      else {
        const key = `${cn(human)} ←你选 / 宗师选→ ${cn(bot)}`;
        bucket.diverge[key] = (bucket.diverge[key] || 0) + 1;
        bucket.divByPhase[ph] = (bucket.divByPhase[ph] || 0) + 1;
      }
    }
  }
  return { buckets, scannedDecisions, replayed };
}
function newAgg(){ return { games:0, total:0, agree:0, diverge:{}, divByPhase:{}, byPhase:{ early:{total:0,agree:0}, mid:{total:0,agree:0}, late:{total:0,agree:0} } }; }

function report(name, a) {
  if (a.total === 0) { console.log(`\n【${name}】无可回放决策`); return; }
  const rate = (a.agree / a.total * 100).toFixed(1);
  console.log(`\n【${name}】 ${a.games} 局 · ${a.total} 个选角色决策 · 你与宗师一致 ${a.agree}/${a.total} = ${rate}%`);
  console.log(`  分歧率越高 = 你越偏离宗师的下法（赢局里的分歧 = 候选打法/漏洞）`);
  console.log('  按阶段一致率:');
  for (const ph of ['early','mid','late']) {
    const b = a.byPhase[ph]; if (!b.total) continue;
    console.log(`    ${ph.padEnd(5)}: ${(b.agree/b.total*100).toFixed(0)}% 一致 (${b.total} 决策, ${a.divByPhase[ph]||0} 分歧)`);
  }
  const top = Object.entries(a.diverge).sort((x,y)=>y[1]-x[1]).slice(0,8);
  if (top.length) {
    console.log('  最常见分歧 (你的选择 ←→ 宗师的选择):');
    for (const [k,v] of top) console.log(`    ×${v}  ${k}`);
  }
}

(async () => {
  try { await PRSim.loadNetwork(NN_PATH); NN_LOADED = PRSim.isLoaded && PRSim.isLoaded(); }
  catch (e) { console.warn(`NN 未加载(${NN_PATH})，回退纯 ISMCTS:`, e.message); }
  console.log(`分析器就绪: iters=${ITERS} NN=${NN_LOADED ? NN_PATH : '(纯ISMCTS)'}`);

  let games;
  if (ARG1 === 'selftest') {
    // 自检：在 vm 上下文内用真实 Game+buildSimState 造几条假“真人决策”，验证回放管线
    // （Game 是 class，是词法绑定不挂在 sandbox 上，所以必须在 context 内生成并序列化跨界）
    const snapsJson = vm.runInContext(`JSON.stringify((function(){
      const out=[];
      for(let i=0;i<3;i++){ const G=new Game(4,'T'); G.players.forEach(function(p){p.isHuman=false;}); const s=buildSimState(G); const legal=PRSim.legalRoleIdxs(s); out.push({turn:1,seat:s.governor,chosen:s.roleCards[legal[0]].name,state:s}); }
      return out;
    })())`, sandbox);
    const decisions = JSON.parse(snapsJson);
    games = [{ humanSeat: 0, numPlayers: 4, result: { humanWon: true }, decisions }];
    console.log(`selftest: 用 ${decisions.length} 个真实 buildSimState 快照回放…`);
  } else {
    const raw = JSON.parse(fs.readFileSync(ARG1, 'utf8'));
    games = Array.isArray(raw) ? raw : (raw.games || []);
    console.log(`读入 ${games.length} 局 (${ARG1})`);
  }

  const t0 = Date.now();
  const { buckets, scannedDecisions, replayed } = analyze(games);
  console.log(`\n回放完成: 扫描 ${scannedDecisions} 个真人决策, 成功回放 ${replayed} 个 (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  report('赢局 (重点)', buckets.won);
  report('输局 (对照)', buckets.lost);
  if (buckets.won.total > 0 && buckets.lost.total > 0) {
    const wr = buckets.won.agree/buckets.won.total, lr = buckets.lost.agree/buckets.lost.total;
    console.log(`\n[读法] 赢局一致率 ${(wr*100).toFixed(0)}% vs 输局 ${(lr*100).toFixed(0)}%。`);
    console.log(wr < lr - 0.05
      ? '  → 你赢的时候更偏离宗师 = 你的“反常规”选角色就是 exploit，宗师选角色策略可被利用。'
      : '  → 赢/输时偏离差不多 = 漏洞多半不在“选角色”，而在子决策(派工/建造/船长)，下一步该搜子决策。');
  }
  console.log('\n提示: 只有 selftest 是开局态(必然高一致)；真实数据请用 PRTrace.export() 导出后传入。');
})().catch(e => { console.error('ERROR:', e && e.stack || e); process.exit(1); });
