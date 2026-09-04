// tests/mod_guard_test.js — AI 高级决策层的模块守卫
//   回归的 bug：守卫内联检查 G.expansionFestival / G.expansionNewBuildings，
//   而这两个属性从未被赋值(恒 undefined) → 节庆局静默绕过守卫，
//   终局精确求解器在 sim.js 零建模 festival 的情况下接管建造决策。
//   节庆目标③「首位建成指定建筑 +3VP」正作用于该决策 → 求解器自信地优化错目标。
//   ① 每个模块单独开启时守卫都必须触发
//   ② 无模块的基础局必须放行（不能因修 bug 而把基础局也关掉）
//   ③ 静态检查：守卫只能引用构造函数真正赋值过的属性名
'use strict';
const fs = require('fs');
const { loadEngine } = require('../tools/_sandbox.js');
const { run } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'nn_wasm.js', 'sim_nn.js'] });
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

// ① 各模块单开 → 守卫触发
const mods = [
  ['newBuildings', 'expansion'],
  ['nobles',       'expansionNobles'],
  ['tibsBuildings','expansionTibs'],
  ['festival',     'moduleFestival'],   // ← 本次修复的那条
];
for (const [modKey, prop] of mods) {
  const r = run(`(function(){
    G = new Game(4, ['A','B','C','D'], { ${modKey}: true });
    return JSON.stringify({ prop: !!G.${prop}, guard: aiUnmodeledMods() });
  })()`);
  const { prop: set, guard } = JSON.parse(r);
  ok(set,   `① mods.${modKey} 应把 G.${prop} 置真（实际 ${set}）`);
  ok(guard, `① ${modKey} 开启时 aiUnmodeledMods() 必须为 true（实际 ${guard}）`);
  console.log(`① ${modKey.padEnd(14)} → G.${prop}=${set}  guard=${guard}`);
}

// ② 基础局放行
{
  const guard = run(`(function(){ G = new Game(4, ['A','B','C','D'], {}); return aiUnmodeledMods(); })()`);
  ok(guard === false, `② 无模块的基础局必须放行（实际 ${guard}）`);
  console.log(`② base game → guard=${guard}`);
}

// ③ 静态检查：守卫引用的属性必须在 game.js 里被真正赋值过
{
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'game.js'), 'utf8');
  const body = src.match(/function aiUnmodeledMods\(\)\s*\{([\s\S]*?)\n\}/);
  ok(!!body, '③ 找得到 aiUnmodeledMods 函数体');
  const props = [...(body ? body[1] : '').matchAll(/G\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
  ok(props.length > 0, '③ 守卫至少引用一个属性');
  for (const pr of props) {
    const assigned = new RegExp(`this\\.${pr}\\s*=[^=]`).test(src) || new RegExp(`G\\.${pr}\\s*=[^=]`).test(src);
    ok(assigned, `③ G.${pr} 在 game.js 中从未被赋值 —— 这正是本次回归的 bug 形态`);
  }
  console.log(`③ 守卫引用属性 [${props.join(', ')}] 全部有赋值点`);
}

console.log(fails ? `\nMOD GUARD TEST FAILED: ${fails}` : '\nMOD GUARD TEST OK');
process.exit(fails ? 1 : 0);
