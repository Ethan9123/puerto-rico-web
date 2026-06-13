// 解析 TTS 波多黎各 mod JSON, 清点内容: 牌堆/卡名/描述/图片URL → 看有哪些 expansion 素材。
// 用法: node tools/tts_inventory.js "<mod.json路径>"
'use strict';
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('need mod json path'); process.exit(1); }
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

const decks = [];   // {name, cards:[{nick,desc}], faceURLs:[]}
const tiles = [];   // standalone custom tiles/objects with nicknames
const urls = new Set();

function collectURLs(o) {
  if (!o || typeof o !== 'object') return;
  if (o.CustomDeck) for (const k of Object.keys(o.CustomDeck)) {
    const d = o.CustomDeck[k];
    if (d.FaceURL) urls.add(d.FaceURL);
    if (d.BackURL) urls.add(d.BackURL);
  }
  if (o.CustomImage && o.CustomImage.ImageURL) urls.add(o.CustomImage.ImageURL);
  if (o.CustomMesh) { if (o.CustomMesh.DiffuseURL) urls.add(o.CustomMesh.DiffuseURL); }
}

function walk(o, depth) {
  if (!o || typeof o !== 'object') return;
  collectURLs(o);
  const name = o.Name || '';
  const nick = (o.Nickname || '').trim();
  const desc = (o.Description || '').trim();
  if (name === 'Deck' || name === 'DeckCustom') {
    const cards = (o.ContainedObjects || []).map(c => ({ nick: (c.Nickname || '').trim(), desc: (c.Description || '').trim() }));
    decks.push({ deckNick: nick, count: cards.length, cards });
  } else if (nick && (name.includes('Card') || name.includes('Tile') || name.includes('Token') || name === 'Custom_Model')) {
    tiles.push({ name, nick, desc });
  }
  for (const k of ['ObjectStates', 'ContainedObjects']) if (Array.isArray(o[k])) for (const c of o[k]) walk(c, depth + 1);
  if (o.States) for (const k of Object.keys(o.States)) walk(o.States[k], depth + 1);
}
walk(j, 0);

console.log(`\n##### ${j.SaveName || file} #####`);
console.log(`牌堆数=${decks.length}  独立卡/块=${tiles.length}  图片URL=${urls.size}`);
for (const d of decks) {
  console.log(`\n[牌堆] "${d.deckNick}"  (${d.count} 张)`);
  const seen = new Set();
  for (const c of d.cards) {
    if (!c.nick || seen.has(c.nick)) continue; seen.add(c.nick);
    console.log(`   - ${c.nick}${c.desc ? '  ::  ' + c.desc.replace(/\s+/g, ' ').slice(0, 120) : ''}`);
  }
}
const tnames = [...new Set(tiles.filter(t => t.nick).map(t => t.nick))];
if (tnames.length) { console.log(`\n[独立对象 nicknames]`); for (const n of tnames.slice(0, 80)) console.log('   * ' + n); }
console.log(`\n[图片URL 样本]`);
for (const u of [...urls].slice(0, 12)) console.log('   ' + u);
