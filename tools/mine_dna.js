// tools/mine_dna.js — 在候选 DNA 池里挖"对固定仓库 L2 基准更强"的个体(按位置)。
//
// 对每个位置 Pk: 让候选基因坐 seat k、其余 3 座位用现有 ai_dna.json(L2)作固定对手,
// 跑 K 局, 量它的人均 VP 与胜率; 与仓库自家 top-5 在同一基准下比较。
// 用来回答"候选池里有没有任何个体真比现有的强"(整族 A/B 看不出单点增益时用)。
//
// 注意: 4 人局只有 seat 0..3 → 仅评测 P1..P4; P5 需 5 人局, 此脚本不覆盖。
// 用法: node tools/mine_dna.js <CANDIDATE_POOL_JSON> [K=120]
const fs = require('fs'), path = require('path');
// 共享 Node 沙盒（tools/_sandbox.js）替代原先各工具自带的 makeEl()/vm 样板
const { loadEngine } = require('./_sandbox.js');
const ROOT = path.join(__dirname, '..');
// OLD 池/候选池/局数在引擎加载前注入沙盒全局(与旧样板一致, 供下方 src 直接引用)
const { sandbox, run } = loadEngine({
  files: ['ai_dna.js', 'game.js', 'sim.js'],
  beforeLoad: sb => {
    sb.OLD_POOL = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai_dna.json'), 'utf8'));
    sb.CAND = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    sb.K = parseInt(process.argv[3] || '120');
  },
});
const src = `(async () => {
  render=function(){};flyToDest=function(){};showToast=function(){};
  window._allAIMode=true;window._fastSpectator=true;
  window._aiThinkBudget={L4:1,L5:1,hardIters:1,hardMs:1,expertIters:1,expertMs:1};
  await loadAIDNA();
  const N=4;
  function pick(pool,pos){const a=pool[pos];const k=Math.min(5,a.length);return a[Math.floor(Math.random()*k)];}
  async function evalG(seatIdx,dna,K){let vp=0,wins=0,ok=0;
    for(let g=0;g<K;g++){let t;
      try{G=new Game(N,'AI');G.players.forEach((p,i)=>{p.isHuman=false;p._aiLevel=2;
        const e=(i===seatIdx)?{dna}:pick(OLD_POOL,'P'+(i+1));p._dna=splitDNA(joinDNA(e.dna));});
        await runMainLoop();t=G.players.map(p=>p.vp+p.buildings.reduce((s,b)=>s+BLD_BY_ID[b.bid].vp,0)+G.getSpecialVPs(p));
      }catch(e){continue}
      let wi=0;for(let i=1;i<N;i++)if(t[i]>t[wi])wi=i;vp+=t[seatIdx];if(wi===seatIdx)wins++;ok++;}
    return {meanVP:vp/Math.max(1,ok),winRate:wins/Math.max(1,ok)};}
  const rows=[];
  for(let pos=1;pos<=4;pos++){const P='P'+pos,seatIdx=pos-1;
    let rb=-1,rn='';for(const e of OLD_POOL[P].slice(0,5)){const r=await evalG(seatIdx,e.dna,K);if(r.meanVP>rb){rb=r.meanVP;rn=e.name;}}
    let fb=-1,fn='',beat=0,fc=0;for(const e of (CAND[P]||[]).slice(0,8)){const r=await evalG(seatIdx,e.dna,K);fc++;if(r.meanVP>rb)beat++;if(r.meanVP>fb){fb=r.meanVP;fn=e.name;}}
    rows.push({P,rb,rn,fb,fn,beat,fc});}
  return rows;
})()`;
run(src).then(rows => {
  console.log(`K=${sandbox.K} games/genome vs fixed repo-L2 opponents (P1..P4; P5 needs 5p games)\n`);
  console.log('pos | repo best VP (name)          | cand best VP (name)          | cand beating repo-best');
  for (const r of rows) console.log(`${r.P}  | ${r.rb.toFixed(1)} ${('('+r.rn+')').padEnd(24)} | ${r.fb.toFixed(1)} ${('('+r.fn+')').padEnd(24)} | ${r.beat}/${r.fc}`);
}).catch(e => { console.error('ERR', e); process.exit(1); });
