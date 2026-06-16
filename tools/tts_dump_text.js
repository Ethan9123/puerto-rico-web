// 挖 TTS mod 内一切文本: 顶层 TabStates(笔记本/规则页)、所有对象 Description/GMNotes/Nickname、LuaScript。
// 用法: node tools/tts_dump_text.js "<mod.json>"
'use strict';
const fs = require('fs');
const file = process.argv[2] || "C:\\Users\\kids1\\Documents\\My Games\\Tabletop Simulator\\Mods\\Workshop\\2377035497.json";
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

console.log("##### SaveName:", j.SaveName, "#####\n");

// 顶层笔记本/规则页
if (j.TabStates) {
  console.log("===== TabStates (笔记本/规则页) =====");
  for (const k of Object.keys(j.TabStates)) {
    const t = j.TabStates[k];
    console.log(`--- Tab "${t.title || k}" ---`);
    console.log((t.body || '').trim());
    console.log();
  }
}
// 顶层 Lua / Notes
if (j.LuaScript && j.LuaScript.trim()) { console.log("===== 顶层 LuaScript (前 4000 字) =====\n" + j.LuaScript.slice(0, 4000) + "\n"); }
if (j.GMNotes && j.GMNotes.trim()) { console.log("===== 顶层 GMNotes =====\n" + j.GMNotes + "\n"); }
if (j.Note && j.Note.trim()) { console.log("===== 顶层 Note =====\n" + j.Note + "\n"); }

// 所有对象的描述/GM注记
console.log("===== 对象 Description / GMNotes (非空) =====");
const seen = new Set();
function walk(o) {
  if (!o || typeof o !== 'object') return;
  const nick = (o.Nickname || '').trim();
  const desc = (o.Description || '').trim();
  const gm = (o.GMNotes || '').trim();
  const lua = (o.LuaScript || '').trim();
  const key = nick + '|' + desc + '|' + gm;
  if ((desc || gm || lua) && !seen.has(key)) {
    seen.add(key);
    console.log(`[${nick || '(无名)'}]`);
    if (desc) console.log("  Desc: " + desc.replace(/\n/g, '\n        '));
    if (gm) console.log("  GM:   " + gm.replace(/\n/g, '\n        '));
    if (lua) console.log("  Lua:  " + lua.slice(0, 500).replace(/\n/g, ' '));
  }
  for (const k of ['ObjectStates', 'ContainedObjects']) if (Array.isArray(o[k])) for (const c of o[k]) walk(c);
  if (o.States) for (const k of Object.keys(o.States)) walk(o.States[k]);
}
walk(j);
