// 把 Tibs Edition 中"web 游戏尚无"的对象卡面复制到 _tts_examine/ 供逐张审阅。
// 已知的 45 个建筑 + 标准角色跳过; 其余(自制建筑/角色/token/规则卡)全部 stage。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MOD = "C:\\Users\\kids1\\Documents\\My Games\\Tabletop Simulator\\Mods\\Workshop\\2377035497.json";
const CACHE = "C:\\Users\\kids1\\Documents\\My Games\\Tabletop Simulator\\Mods\\Images";
const OUT = path.join(ROOT, '_tts_examine');

// 已在 web 游戏里(45 建筑 + 标准角色) → 跳过
const KNOWN = new Set([
  "Small Indigo Plant","Large Indigo Plant","Small Sugar Mill","Large Sugar Mill","Coffee Roaster","Tobacco Barn",
  "Small Market","Construction Hut","Hacidena","Small Warehouse","Commercial Office","Large Market","Large Warehouse",
  "Factory","University","Harbor","Wharf","City Hall","Fortress","Guild Hall","Residence","Customs House",
  "Aqueduct","Black Market","Forest House","Storehouse","Guest House","Church","Trading Post","Small Wharf",
  "Lighthouse","Specialty Factory","Library","Union Hall","Cloister","Statue",
  "Land Office","Chapel","Hunting Lodge","Zoning Office","Royal Supplier","Villa","Jeweler","Royal Garden",
  "Governor","Builder","Craftsman","Mayor","Prospector","Settler","Trader","Captain",
]);

const j = JSON.parse(fs.readFileSync(MOD, 'utf8'));
const cache = fs.readdirSync(CACHE);
function urlHash(u) { const m = u.match(/([0-9A-F]{30,})\/?$/i); return m ? m[1] : null; }
function findCache(u) { const h = urlHash(u); if (!h) return null; return cache.find(f => f.toUpperCase().includes(h.toUpperCase())) || null; }

const seen = new Set();
const staged = [];
function walk(o) {
  if (!o || typeof o !== 'object') return;
  const nick = (o.Nickname || '').trim();
  if (nick && !KNOWN.has(nick) && !seen.has(nick)) {
    let face = null;
    if (o.CustomDeck) { const k = Object.keys(o.CustomDeck)[0]; if (k) face = o.CustomDeck[k].FaceURL; }
    if (!face && o.CustomImage) face = o.CustomImage.ImageURL;
    if (face) { const c = findCache(face); if (c) { seen.add(nick); staged.push({ nick, c }); } }
  }
  for (const key of ['ObjectStates', 'ContainedObjects']) if (Array.isArray(o[key])) for (const c of o[key]) walk(c);
  if (o.States) for (const k of Object.keys(o.States)) walk(o.States[k]);
}
walk(j);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const s of staged) {
  const ext = path.extname(s.c) || '.jpg';
  const fn = s.nick.replace(/[^a-zA-Z0-9]+/g, '_') + ext;
  fs.copyFileSync(path.join(CACHE, s.c), path.join(OUT, fn));
  console.log(`${s.nick}  ->  _tts_examine/${fn}`);
}
console.log(`\nstaged ${staged.length} 个待审阅对象 -> ${OUT}`);
