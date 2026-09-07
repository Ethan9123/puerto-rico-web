// ============================================================
// tools/value_shard.js — 价值网训练数据分片（二进制，struct-of-arrays）读写
// ============================================================
// 由 tools/gen_value_data.js 写、train/train_value_np.py（numpy np.frombuffer）与测试读。
// 布局（小端）：
//   头 32 字节: magic 'PRV1' | u32 version=1 | u32 n | u32 featDim=446 | u32 seats=4 | u32 nGames | u8 hasRollout | u8×3 pad
//   feats     n × featDim  u8      extractRich(st, 0) 量化: round(x*255)（特征全在 [0,1] 且为 k/D, D≤120 → 无损）
//   meta      n × 4        u8      [chooser, min(turn,255), endTriggered, agentKind(0=heur,1=hard,2=expert,3=eps-random)]
//   gameId    n            u32     分片内局号 0..nGames-1
//   scores    nGames × 4   u8      finalScore 每座位（训练时按 sim.js reward() 公式派生目标）
//   gameSeed  nGames       u32     每局种子（可复现）
//   rollout1  n × 4        f32     (hasRollout) 第 1 次启发式 rollout 的 reward 向量
//   rolloutMean n × 4      f32     (hasRollout) k 次 rollout 的 reward 均值
'use strict';
const fs = require('fs');

const MAGIC = 0x31565250; // 'PRV1' little-endian
const HEADER = 32;

function writeShard(path, d) {
  const n = d.n, F = d.featDim, S = d.seats, nG = d.nGames, hasR = d.rolloutMean ? 1 : 0;
  const parts = [];
  const h = Buffer.alloc(HEADER);
  h.writeUInt32LE(MAGIC, 0); h.writeUInt32LE(1, 4); h.writeUInt32LE(n, 8); h.writeUInt32LE(F, 12);
  h.writeUInt32LE(S, 16); h.writeUInt32LE(nG, 20); h.writeUInt8(hasR, 24);
  parts.push(h);
  parts.push(Buffer.from(d.feats.buffer, d.feats.byteOffset, n * F));
  parts.push(Buffer.from(d.meta.buffer, d.meta.byteOffset, n * 4));
  parts.push(Buffer.from(d.gameId.buffer, d.gameId.byteOffset, n * 4));
  parts.push(Buffer.from(d.scores.buffer, d.scores.byteOffset, nG * S));
  parts.push(Buffer.from(d.gameSeed.buffer, d.gameSeed.byteOffset, nG * 4));
  if (hasR) {
    parts.push(Buffer.from(d.rollout1.buffer, d.rollout1.byteOffset, n * S * 4));
    parts.push(Buffer.from(d.rolloutMean.buffer, d.rolloutMean.byteOffset, n * S * 4));
  }
  fs.writeFileSync(path, Buffer.concat(parts));
}

function readShard(path) {
  const b = fs.readFileSync(path);
  if (b.length < HEADER || b.readUInt32LE(0) !== MAGIC) throw new Error('not a PRV1 shard: ' + path);
  const version = b.readUInt32LE(4), n = b.readUInt32LE(8), F = b.readUInt32LE(12), S = b.readUInt32LE(16), nG = b.readUInt32LE(20), hasR = b.readUInt8(24);
  let off = HEADER;
  const take = (bytes) => { const s = b.subarray(off, off + bytes); off += bytes; return s; };
  const u8 = (bytes) => new Uint8Array(take(bytes));
  const u32 = (count) => { const s = take(count * 4); const out = new Uint32Array(count); for (let i = 0; i < count; i++) out[i] = s.readUInt32LE(i * 4); return out; };
  const f32 = (count) => { const s = take(count * 4); const out = new Float32Array(count); for (let i = 0; i < count; i++) out[i] = s.readFloatLE(i * 4); return out; };
  const d = { version, n, featDim: F, seats: S, nGames: nG, hasRollout: !!hasR };
  d.feats = u8(n * F); d.meta = u8(n * 4); d.gameId = u32(n); d.scores = u8(nG * S); d.gameSeed = u32(nG);
  if (hasR) { d.rollout1 = f32(n * S); d.rolloutMean = f32(n * S); }
  if (off !== b.length) throw new Error(`shard size mismatch: read ${off} of ${b.length} bytes`);
  return d;
}

// sim.js reward() 的复刻（训练目标派生；与 numpy 端 train_value_np.py 逐式对齐）
function rewardFromScores(scores, persp) {
  const my = scores[persp];
  let best = -Infinity; for (const s of scores) if (s > best) best = s;
  let winners = 0; for (const s of scores) if (s === best) winners++;
  const r = (my === best) ? (1 / winners) : 0;
  let second = 0; for (let i = 0; i < scores.length; i++) if (i !== persp && scores[i] > second) second = scores[i];
  const margin = Math.max(-1, Math.min(1, (my - second) / 30));
  return 0.8 * r + 0.2 * margin;
}

module.exports = { writeShard, readShard, rewardFromScores, HEADER, MAGIC };
