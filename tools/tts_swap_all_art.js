// Phase 1: 把 web 游戏全部建筑(1-37)卡面换成 TTS Tibs 风格。
// 每个 slug → Tibs Nickname → 缓存 .jpg → 复制到 assets/buildings/<slug>.jpg。
// 无 Tibs 对应者(如 Hospice)把现有 .png 复制成 .jpg 保留原图。
// 之后对 game.js 做 img .png→.jpg。38-45 已是 .jpg(贵族, 上一步已接)。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MOD = "C:\\Users\\kids1\\Documents\\My Games\\Tabletop Simulator\\Mods\\Workshop\\2377035497.json";
const CACHE = "C:\\Users\\kids1\\Documents\\My Games\\Tabletop Simulator\\Mods\\Images";
const DEST = path.join(ROOT, 'assets', 'buildings');

// slug(现有文件名去扩展) -> Tibs Nickname。null = 无对应, 保留原 png。
const MAP = {
  "01_small_indigo": "Small Indigo Plant", "02_small_sugar": "Small Sugar Mill",
  "03_large_indigo": "Large Indigo Plant", "04_large_sugar": "Large Sugar Mill",
  "05_tobacco_storage": "Tobacco Barn", "06_coffee_roaster": "Coffee Roaster",
  "07_small_market": "Small Market", "08_hacienda": "Hacidena",
  "09_construction_hut": "Construction Hut", "10_small_warehouse": "Small Warehouse",
  "11_hospice": null, "12_office": "Commercial Office",
  "13_large_market": "Large Market", "14_large_warehouse": "Large Warehouse",
  "15_factory": "Factory", "16_university": "University", "17_harbour": "Harbor",
  "18_wharf": "Wharf", "19_guild_hall": "Guild Hall", "20_residence": "Residence",
  "21_fortress": "Fortress", "22_customs_house": "Customs House", "23_city_hall": "City Hall",
  "24_aqueduct": "Aqueduct", "25_black_market": "Black Market", "26_forest_house": "Forest House",
  "27_storehouse": "Storehouse", "28_guesthouse": "Guest House", "29_trading_post": "Trading Post",
  "30_church": "Church", "31_small_wharf": "Small Wharf", "32_lighthouse": "Lighthouse",
  "33_library": "Library", "34_specialty_factory": "Specialty Factory", "35_union_hall": "Union Hall",
  "36_cloister": "Cloister", "37_statue": "Statue",
};

const j = JSON.parse(fs.readFileSync(MOD, 'utf8'));
const cache = fs.readdirSync(CACHE);
function urlHash(u) { const m = u.match(/([0-9A-F]{30,})\/?$/i); return m ? m[1] : null; }
function findCache(u) { const h = urlHash(u); if (!h) return null; return cache.find(f => f.toUpperCase().includes(h.toUpperCase())) || null; }

const nicks = new Map(); // nick -> cacheFile
function walk(o) {
  if (!o || typeof o !== 'object') return;
  const nick = (o.Nickname || '').trim();
  if (nick && !nicks.has(nick)) {
    let face = null;
    if (o.CustomDeck) { const k = Object.keys(o.CustomDeck)[0]; if (k) face = o.CustomDeck[k].FaceURL; }
    if (!face && o.CustomImage) face = o.CustomImage.ImageURL;
    if (face) { const c = findCache(face); if (c) nicks.set(nick, c); }
  }
  for (const key of ['ObjectStates', 'ContainedObjects']) if (Array.isArray(o[key])) for (const c of o[key]) walk(c);
  if (o.States) for (const k of Object.keys(o.States)) walk(o.States[k]);
}
walk(j);

let swapped = 0, kept = 0, miss = 0;
for (const [slug, nick] of Object.entries(MAP)) {
  const destJpg = path.join(DEST, slug + '.jpg');
  if (nick === null) { // 保留原图: png -> jpg 复制
    const srcPng = path.join(DEST, slug + '.png');
    if (fs.existsSync(srcPng)) { fs.copyFileSync(srcPng, destJpg); kept++; console.log(`KEEP  ${slug} (无 Tibs 对应, 原图转存 jpg)`); }
    continue;
  }
  const cf = nicks.get(nick);
  if (!cf) { miss++; console.log(`MISS  ${slug} <- "${nick}" (缓存未命中)`); continue; }
  fs.copyFileSync(path.join(CACHE, cf), destJpg);
  swapped++;
}
console.log(`\n换图完成: Tibs 替换 ${swapped}, 保留 ${kept}, 未命中 ${miss}`);
