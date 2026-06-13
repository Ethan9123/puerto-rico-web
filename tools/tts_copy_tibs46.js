// 复制 Tibs 自制建筑 46-53 的卡面到 assets/buildings/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MOD = path.join("C:", "Users", "kids1", "Documents", "My Games", "Tabletop Simulator", "Mods", "Workshop", "2377035497.json");
const CACHE = path.join("C:", "Users", "kids1", "Documents", "My Games", "Tabletop Simulator", "Mods", "Images");
const DEST = path.join(ROOT, 'assets', 'buildings');
const MAP = {
  "Gold Mine": "46_gold_mine", "Well": "47_well", "Boarding House": "48_boarding_house",
  "Tower": "49_tower", "Customs Station": "50_customs_station", "Archive": "51_archive",
  "Bank": "52_bank", "Cathedral": "53_cathedral",
};
const j = JSON.parse(fs.readFileSync(MOD, 'utf8'));
const cache = fs.readdirSync(CACHE);
function urlHash(u) { const m = u.match(/([0-9A-F]{30,})\/?$/i); return m ? m[1] : null; }
function findCache(u) { const h = urlHash(u); if (!h) return null; return cache.find(f => f.toUpperCase().includes(h.toUpperCase())) || null; }
const want = new Map(Object.entries(MAP));
const got = {};
function walk(o) {
  if (!o || typeof o !== 'object') return;
  const nick = (o.Nickname || '').trim();
  if (want.has(nick) && !got[nick]) {
    let face = null;
    if (o.CustomDeck) { const k = Object.keys(o.CustomDeck)[0]; if (k) face = o.CustomDeck[k].FaceURL; }
    if (!face && o.CustomImage) face = o.CustomImage.ImageURL;
    if (face) { const c = findCache(face); if (c) got[nick] = c; }
  }
  for (const key of ['ObjectStates', 'ContainedObjects']) if (Array.isArray(o[key])) for (const c of o[key]) walk(c);
  if (o.States) for (const k of Object.keys(o.States)) walk(o.States[k]);
}
walk(j);
for (const [nick, base] of want) {
  const c = got[nick];
  if (!c) { console.log("MISS " + nick); continue; }
  const ext = path.extname(c) || '.jpg';
  fs.copyFileSync(path.join(CACHE, c), path.join(DEST, base + ext));
  console.log("OK   " + base + ext);
}
