// 从 TTS Tibs 缓存把指定 Nickname 的卡面复制到 assets/buildings/<dest>。
// 用法: node tools/tts_copy_art.js  (映射写在本文件 MAP 中)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MOD = "C:\\Users\\kids1\\Documents\\My Games\\Tabletop Simulator\\Mods\\Workshop\\2377035497.json";
const CACHE = "C:\\Users\\kids1\\Documents\\My Games\\Tabletop Simulator\\Mods\\Images";
const DEST = path.join(ROOT, 'assets', 'buildings');

// Tibs Nickname -> 目标文件名(扩展名随源)
const MAP = {
  "Land Office":    "38_land_office",
  "Chapel":         "39_chapel",
  "Hunting Lodge":  "40_hunting_lodge",
  "Zoning Office":  "41_zoning_office",
  "Royal Supplier": "42_royal_supplier",
  "Villa":          "43_villa",
  "Jeweler":        "44_jeweler",
  "Royal Garden":   "45_royal_garden",
};

const j = JSON.parse(fs.readFileSync(MOD, 'utf8'));
const cache = fs.readdirSync(CACHE);
function urlHash(u) { const m = u.match(/([0-9A-F]{30,})\/?$/i); return m ? m[1] : null; }
function findCache(u) { const h = urlHash(u); if (!h) return null; return cache.find(f => f.toUpperCase().includes(h.toUpperCase())) || null; }

const want = new Map(Object.entries(MAP));
const found = {};
function walk(o) {
  if (!o || typeof o !== 'object') return;
  const nick = (o.Nickname || '').trim();
  if (want.has(nick) && !found[nick]) {
    let face = null;
    if (o.CustomDeck) { const k = Object.keys(o.CustomDeck)[0]; if (k) face = o.CustomDeck[k].FaceURL; }
    if (!face && o.CustomImage) face = o.CustomImage.ImageURL;
    if (face) { const c = findCache(face); if (c) found[nick] = c; }
  }
  for (const key of ['ObjectStates', 'ContainedObjects']) if (Array.isArray(o[key])) for (const c of o[key]) walk(c);
  if (o.States) for (const k of Object.keys(o.States)) walk(o.States[k]);
}
walk(j);

fs.mkdirSync(DEST, { recursive: true });
const result = [];
for (const [nick, base] of want) {
  const src = found[nick];
  if (!src) { console.log(`MISS  ${nick} (未找到缓存)`); continue; }
  const ext = path.extname(src) || '.png';
  const destName = base + ext;
  fs.copyFileSync(path.join(CACHE, src), path.join(DEST, destName));
  result.push({ nick, destName });
  console.log(`OK    ${nick.padEnd(16)} -> assets/buildings/${destName}`);
}
console.log('\n// game.js NOBLE_BUILDINGS img 字段:');
for (const r of result) console.log(`  ${r.nick}: img:"${r.destName}"`);
