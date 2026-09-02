# nn_wasm — WebAssembly 前向内核

`sim_nn.js` 的 dense/activation 内核（Rust `#![no_std]`，零依赖），编译产物以 base64
内嵌在仓库根目录的 `nn_wasm.js` 里（SIMD 与标量两份），运行时无需任何构建步骤。

## 重新构建

需要 `rustup target add wasm32-unknown-unknown`（无需 wasm-opt / wabt）。

```sh
tools/build_wasm.sh          # cargo build 两个变体 → node tools/build_wasm.js → 写出 nn_wasm.js
```

等价手工步骤：

```sh
cd nn_wasm
RUSTFLAGS='-C target-feature=+simd128' cargo build --release --target wasm32-unknown-unknown --target-dir target/simd
RUSTFLAGS=''                            cargo build --release --target wasm32-unknown-unknown --target-dir target/scalar
node ../tools/build_wasm.js  # 读取上面两个 .wasm，生成 ../nn_wasm.js
```

## 导出 API（C ABI）

- `dense(x, w, b, out, in_dim, out_dim, act)` — `out = act(W·x + b)`，W 行主序 f32，act 0=none 1=relu 2=tanh
- `activate(src, dst, n, act)` — 逐元素激活（src 可等于 dst）
- `abi_version()` — 当前为 1
- `memory` — JS 端通过 `memory.grow()` 自行划分权重与暂存区

验证：`node tests/nn_wasm_parity_test.js`；基准：`node tools/bench_nn.js`。
