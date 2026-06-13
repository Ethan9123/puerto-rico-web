// 提取 TTS mod 每个具名对象的 Nickname → FaceURL, 并解析为本地缓存文件名。
// TTS 缓存命名: URL 去掉协议/标点 + 末段 hash + .png。这里按缓存目录实际匹配。
// 用法: node tools/tts_artmap.js "<mod.json>" "<TTS Images cache dir>"
'use strict';
const fs = require('fs');
const file = process.argv[2];
const cacheDir = process.argv[3];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const cache = cacheDir && fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];

// TTS 把 URL 的字母数字保留、其余去掉 → 文件名(无扩展)。用 URL 尾部 hash 段匹配缓存。
function urlHash(u) { const m = u.match(/([0-9A-F]{30,})\/?$/i); return m ? m[1] : null; }
function findCache(u) {
  const h = urlHash(u); if (!h) return null;
  return cache.find(f => f.toUpperCase().includes(h.toUpperCase())) || null;
}

const rows = [];
function walk(o) {
  if (!o || typeof o !== 'object') return;
  const nick = (o.Nickname || '').trim();
  let face = null;
  if (o.CustomDeck) { const k = Object.keys(o.CustomDeck)[0]; if (k) face = o.CustomDeck[k].FaceURL; }
  if (!face && o.CustomImage && o.CustomImage.ImageURL) face = o.CustomImage.ImageURL;
  if (!face && o.CustomMesh && o.CustomMesh.DiffuseURL) face = o.CustomMesh.DiffuseURL;
  if (nick && face) rows.push({ nick, face, cache: findCache(face) });
  for (const key of ['ObjectStates', 'ContainedObjects']) if (Array.isArray(o[key])) for (const c of o[key]) walk(c);
  if (o.States) for (const k of Object.keys(o.States)) walk(o.States[k]);
}
walk(j);

console.log(`# ${j.SaveName} — ${rows.length} 具名带图对象 (缓存命中 ${rows.filter(r => r.cache).length})`);
const seen = new Set();
for (const r of rows) {
  if (seen.has(r.nick)) continue; seen.add(r.nick);
  console.log(`${r.nick}\t${r.cache || '(未缓存)'}\t${r.face.slice(0, 70)}`);
}
