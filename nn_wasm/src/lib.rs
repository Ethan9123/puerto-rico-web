// ============================================================
// nn_wasm — sim_nn.js 前向传播的 WebAssembly 内核（Rust, no_std, 零依赖）
// ============================================================
// 导出（均为 C ABI，指针为 wasm 线性内存内的字节偏移）：
//   dense(x, w, b, out, in_dim, out_dim, act)
//       out[o] = act( b[o] + Σ_i W[o*in_dim + i] * x[i] )   W 行主序 f32
//       act: 0=none 1=relu 2=tanh
//   activate(src, dst, n, act)   dst[i] = act(src[i])（src 可与 dst 相同）
//   abi_version() -> 1
//   memory（由 wasm-ld 默认导出；JS 端用 memory.grow 自行划分权重/暂存区）
//
// 同一份源码编译两份：带 -C target-feature=+simd128 走 f32x4 内核，不带则走
// 4 路独立累加的标量内核（cfg 分支）。重新构建见 nn_wasm/README.md / tools/build_wasm.sh。
#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[inline(always)]
fn relu(v: f32) -> f32 { if v > 0.0 { v } else { 0.0 } }

// 不依赖 libm 的 tanh：f64 计算，tanh(x) = 1 - 2/(exp(2x)+1)，
// exp 用 2^k·exp(r) 区间缩减 + 9 阶泰勒（|r| ≤ ln2/2 → 相对误差 ~1e-12）。
// 输出以 f32 存储，整体误差远小于 1e-6。
#[inline]
fn exp64(x: f64) -> f64 {
    const LN2: f64 = 0.693_147_180_559_945_3;
    const INV_LN2: f64 = 1.442_695_040_888_963_4;
    let kf = (x * INV_LN2 + if x >= 0.0 { 0.5 } else { -0.5 }) as i32 as f64;
    let r = x - kf * LN2;
    // 泰勒级数 Σ r^n/n!，n=0..9（Horner）
    let p = 1.0 + r * (1.0 + r * (0.5 + r * (1.0 / 6.0 + r * (1.0 / 24.0 + r * (1.0 / 120.0
        + r * (1.0 / 720.0 + r * (1.0 / 5040.0 + r * (1.0 / 40320.0 + r * (1.0 / 362880.0)))))))));
    let k = kf as i64;
    let scale = f64::from_bits(((k + 1023) as u64) << 52);
    p * scale
}

#[inline]
fn tanh32(x: f32) -> f32 {
    let xd = x as f64;
    if xd > 20.0 { return 1.0; }
    if xd < -20.0 { return -1.0; }
    if xd.abs() < 1e-4 { return (xd - xd * xd * xd / 3.0) as f32; }
    let e = exp64(2.0 * xd);
    (1.0 - 2.0 / (e + 1.0)) as f32
}

#[inline(always)]
fn apply(v: f32, act: u32) -> f32 {
    match act { 1 => relu(v), 2 => tanh32(v), _ => v }
}

#[no_mangle]
pub extern "C" fn abi_version() -> u32 { 1 }

#[no_mangle]
pub unsafe extern "C" fn activate(src: *const f32, dst: *mut f32, n: u32, act: u32) {
    for i in 0..n as usize {
        *dst.add(i) = apply(*src.add(i), act);
    }
}

// ---------------- SIMD 内核 (simd128) ----------------
#[cfg(target_feature = "simd128")]
#[no_mangle]
pub unsafe extern "C" fn dense(x: *const f32, w: *const f32, b: *const f32, out: *mut f32,
                               in_dim: u32, out_dim: u32, act: u32) {
    use core::arch::wasm32::*;
    let n = in_dim as usize;
    let m = out_dim as usize;
    let n8 = n & !7usize;
    let n4 = n & !3usize;
    let mut o = 0usize;
    // 4 行一组：共享 x 的加载，每行 2 个独立累加器 → 8 条相互独立的依赖链
    while o + 4 <= m {
        let w0 = w.add(o * n);
        let w1 = w0.add(n);
        let w2 = w1.add(n);
        let w3 = w2.add(n);
        let (mut a0, mut a1, mut a2, mut a3) = (f32x4_splat(0.0), f32x4_splat(0.0), f32x4_splat(0.0), f32x4_splat(0.0));
        let (mut c0, mut c1, mut c2, mut c3) = (f32x4_splat(0.0), f32x4_splat(0.0), f32x4_splat(0.0), f32x4_splat(0.0));
        let mut j = 0usize;
        while j < n8 {
            let xa = v128_load(x.add(j) as *const v128);
            let xb = v128_load(x.add(j + 4) as *const v128);
            a0 = f32x4_add(a0, f32x4_mul(v128_load(w0.add(j) as *const v128), xa));
            c0 = f32x4_add(c0, f32x4_mul(v128_load(w0.add(j + 4) as *const v128), xb));
            a1 = f32x4_add(a1, f32x4_mul(v128_load(w1.add(j) as *const v128), xa));
            c1 = f32x4_add(c1, f32x4_mul(v128_load(w1.add(j + 4) as *const v128), xb));
            a2 = f32x4_add(a2, f32x4_mul(v128_load(w2.add(j) as *const v128), xa));
            c2 = f32x4_add(c2, f32x4_mul(v128_load(w2.add(j + 4) as *const v128), xb));
            a3 = f32x4_add(a3, f32x4_mul(v128_load(w3.add(j) as *const v128), xa));
            c3 = f32x4_add(c3, f32x4_mul(v128_load(w3.add(j + 4) as *const v128), xb));
            j += 8;
        }
        if j < n4 {
            let xa = v128_load(x.add(j) as *const v128);
            a0 = f32x4_add(a0, f32x4_mul(v128_load(w0.add(j) as *const v128), xa));
            a1 = f32x4_add(a1, f32x4_mul(v128_load(w1.add(j) as *const v128), xa));
            a2 = f32x4_add(a2, f32x4_mul(v128_load(w2.add(j) as *const v128), xa));
            a3 = f32x4_add(a3, f32x4_mul(v128_load(w3.add(j) as *const v128), xa));
            j += 4;
        }
        a0 = f32x4_add(a0, c0); a1 = f32x4_add(a1, c1); a2 = f32x4_add(a2, c2); a3 = f32x4_add(a3, c3);
        let mut s0 = f32x4_extract_lane::<0>(a0) + f32x4_extract_lane::<1>(a0) + f32x4_extract_lane::<2>(a0) + f32x4_extract_lane::<3>(a0);
        let mut s1 = f32x4_extract_lane::<0>(a1) + f32x4_extract_lane::<1>(a1) + f32x4_extract_lane::<2>(a1) + f32x4_extract_lane::<3>(a1);
        let mut s2 = f32x4_extract_lane::<0>(a2) + f32x4_extract_lane::<1>(a2) + f32x4_extract_lane::<2>(a2) + f32x4_extract_lane::<3>(a2);
        let mut s3 = f32x4_extract_lane::<0>(a3) + f32x4_extract_lane::<1>(a3) + f32x4_extract_lane::<2>(a3) + f32x4_extract_lane::<3>(a3);
        while j < n {
            let xj = *x.add(j);
            s0 += *w0.add(j) * xj; s1 += *w1.add(j) * xj; s2 += *w2.add(j) * xj; s3 += *w3.add(j) * xj;
            j += 1;
        }
        *out.add(o) = apply(s0 + *b.add(o), act);
        *out.add(o + 1) = apply(s1 + *b.add(o + 1), act);
        *out.add(o + 2) = apply(s2 + *b.add(o + 2), act);
        *out.add(o + 3) = apply(s3 + *b.add(o + 3), act);
        o += 4;
    }
    // 余下不足 4 行：单行处理
    while o < m {
        let w0 = w.add(o * n);
        let mut a0 = f32x4_splat(0.0);
        let mut j = 0usize;
        while j < n4 {
            a0 = f32x4_add(a0, f32x4_mul(v128_load(w0.add(j) as *const v128), v128_load(x.add(j) as *const v128)));
            j += 4;
        }
        let mut s0 = f32x4_extract_lane::<0>(a0) + f32x4_extract_lane::<1>(a0) + f32x4_extract_lane::<2>(a0) + f32x4_extract_lane::<3>(a0);
        while j < n { s0 += *w0.add(j) * *x.add(j); j += 1; }
        *out.add(o) = apply(s0 + *b.add(o), act);
        o += 1;
    }
}

// ---------------- 标量内核 (无 simd128) ----------------
#[cfg(not(target_feature = "simd128"))]
#[no_mangle]
pub unsafe extern "C" fn dense(x: *const f32, w: *const f32, b: *const f32, out: *mut f32,
                               in_dim: u32, out_dim: u32, act: u32) {
    let n = in_dim as usize;
    let m = out_dim as usize;
    let n4 = n & !3usize;
    for o in 0..m {
        let w0 = w.add(o * n);
        let (mut s0, mut s1, mut s2, mut s3) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
        let mut j = 0usize;
        while j < n4 {
            s0 += *w0.add(j) * *x.add(j);
            s1 += *w0.add(j + 1) * *x.add(j + 1);
            s2 += *w0.add(j + 2) * *x.add(j + 2);
            s3 += *w0.add(j + 3) * *x.add(j + 3);
            j += 4;
        }
        let mut s = (s0 + s1) + (s2 + s3);
        while j < n { s += *w0.add(j) * *x.add(j); j += 1; }
        *out.add(o) = apply(s + *b.add(o), act);
    }
}
