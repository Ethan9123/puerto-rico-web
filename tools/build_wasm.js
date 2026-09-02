#!/usr/bin/env node
// tools/build_wasm.js — 把 nn_wasm/ 的两个 cargo 产物(simd / scalar)以 base64 嵌入 nn_wasm/loader.js
// 模板，写出仓库根目录的 nn_wasm.js。通常由 tools/build_wasm.sh 调用（它先跑 cargo build）。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'nn_wasm');
const SIMD = process.argv[2] || path.join(DIR, 'target/simd/wasm32-unknown-unknown/release/nn_wasm.wasm');
const SCALAR = process.argv[3] || path.join(DIR, 'target/scalar/wasm32-unknown-unknown/release/nn_wasm.wasm');
const OUT = process.argv[4] || path.join(ROOT, 'nn_wasm.js');

function readWasm(p, label) {
  if (!fs.existsSync(p)) { console.error(`build_wasm: missing ${label} module: ${p}\n  run tools/build_wasm.sh (cargo build both variants first)`); process.exit(1); }
  const bytes = fs.readFileSync(p);
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0x6d736100) { console.error(`build_wasm: ${p} is not a wasm binary`); process.exit(1); }
  if (!WebAssembly.validate(bytes)) { console.error(`build_wasm: ${p} fails WebAssembly.validate in this Node`); process.exit(1); }
  return bytes;
}

// 粗略检测模块是否含 SIMD 指令：0xFD 前缀 opcode 在代码段出现。用来防止把两份产物装反。
function hasSimdOpcodes(bytes) {
  // 解析 section，找到 code section (id 10)，统计 0xFD 字节数（启发式即可）
  let i = 8;
  function leb() { let r = 0, s = 0, b; do { b = bytes[i++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; }
  while (i < bytes.length) {
    const id = bytes[i++]; const size = leb(); const start = i;
    if (id === 10) { let c = 0; for (let k = start; k < start + size; k++) if (bytes[k] === 0xfd) c++; return c > 8; }
    i = start + size;
  }
  return false;
}

const simd = readWasm(SIMD, 'simd');
const scalar = readWasm(SCALAR, 'scalar');
if (!hasSimdOpcodes(simd)) { console.error('build_wasm: simd module contains no SIMD opcodes — was it built with -C target-feature=+simd128 ?'); process.exit(1); }
if (hasSimdOpcodes(scalar)) { console.error('build_wasm: scalar module contains SIMD opcodes — build it WITHOUT +simd128'); process.exit(1); }

const tpl = fs.readFileSync(path.join(DIR, 'loader.js'), 'utf8');
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
const info = `simd ${simd.length} B (sha256 ${sha(simd)}), scalar ${scalar.length} B (sha256 ${sha(scalar)})`;
const out = tpl
  .replace('__BUILD_INFO__', info)
  .replace('__SIMD_B64__', simd.toString('base64'))
  .replace('__SCALAR_B64__', scalar.toString('base64'));
fs.writeFileSync(OUT, out);
console.log(`build_wasm: wrote ${path.relative(ROOT, OUT)} (${out.length} bytes; ${info})`);
