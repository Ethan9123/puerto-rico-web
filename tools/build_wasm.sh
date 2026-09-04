#!/usr/bin/env sh
# tools/build_wasm.sh — 重新构建 nn_wasm.js（Rust → wasm ×2 → base64 内嵌）
# 依赖：rustup target add wasm32-unknown-unknown；不需要 wasm-opt / wabt。
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT/nn_wasm"
echo "[build_wasm] simd128 variant"
RUSTFLAGS='-C target-feature=+simd128' cargo build --release --target wasm32-unknown-unknown --target-dir target/simd
echo "[build_wasm] scalar variant"
RUSTFLAGS='' cargo build --release --target wasm32-unknown-unknown --target-dir target/scalar
cd "$ROOT"
node tools/build_wasm.js
node --check nn_wasm.js
