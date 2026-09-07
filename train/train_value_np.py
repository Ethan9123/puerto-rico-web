#!/usr/bin/env python3
"""train_value_np.py — Phase 2 小价值网训练器（仅依赖 numpy）

读取 tools/gen_value_data.js 写出的 PRV1 二进制分片，训练 446→H1→H2→4（ReLU, tanh 输出）
的价值网，目标为 sim.js reward() 尺度（0.8·胜份 + 0.2·clamp((my−second)/30)），
按座位输出 4 维向量（座位 0 视角 → valueVec[k] = 座位 k 的价值，与 sim_nn.evalLeafVecNN 一致）。

用法:
  python3 train/train_value_np.py data/value/mix-*.bin --arch 256,32 --epochs 20 --out mcts_value_vnet.json
  python3 train/train_value_np.py data/value/roll-*.bin --target rollout --eval-rollout-baseline
选项:
  --target outcome|rollout   outcome=终局 reward（默认）；rollout=分片里 k 次 rollout 均值（需 --rollouts 生成）
  --arch H1,H2               隐层宽度（默认 256,32）
  --epochs/--batch/--lr/--val-frac/--seed/--limit/--patience
  --eval-rollout-baseline    在验证集上报告 单次 rollout / k 次均值 作为 outcome 估计器的 MSE（需含 rollout 的分片）
  --out FILE                 导出 sim_nn 可读 JSON（value_only）；同时写 train/exports/vnet_ref.json 供 parity 测试
"""
import argparse
import glob
import json
import math
import os
import struct
import sys
import time

import numpy as np

HEADER = 32
MAGIC = 0x31565250


def read_shard(path):
    with open(path, "rb") as fh:
        b = fh.read()
    magic, ver, n, F, S, nG = struct.unpack_from("<IIIIII", b, 0)
    has_r = b[24]
    if magic != MAGIC:
        raise ValueError(f"not a PRV1 shard: {path}")
    off = HEADER
    feats = np.frombuffer(b, dtype=np.uint8, count=n * F, offset=off).reshape(n, F); off += n * F
    meta = np.frombuffer(b, dtype=np.uint8, count=n * 4, offset=off).reshape(n, 4); off += n * 4
    game_id = np.frombuffer(b, dtype="<u4", count=n, offset=off); off += n * 4
    scores = np.frombuffer(b, dtype=np.uint8, count=nG * S, offset=off).reshape(nG, S); off += nG * S
    seeds = np.frombuffer(b, dtype="<u4", count=nG, offset=off); off += nG * 4
    r1 = rm = None
    if has_r:
        r1 = np.frombuffer(b, dtype="<f4", count=n * S, offset=off).reshape(n, S); off += n * S * 4
        rm = np.frombuffer(b, dtype="<f4", count=n * S, offset=off).reshape(n, S); off += n * S * 4
    if off != len(b):
        raise ValueError(f"shard size mismatch {off} vs {len(b)}: {path}")
    return dict(n=n, F=F, S=S, nG=nG, feats=feats, meta=meta, game_id=game_id, scores=scores, seeds=seeds, r1=r1, rm=rm)


def reward_from_scores(scores):
    """scores: (nG, S) → (nG, S) reward per seat, 与 sim.js reward()/tools/value_shard.js 逐式一致"""
    sc = scores.astype(np.float64)
    best = sc.max(axis=1, keepdims=True)
    winners = (sc == best).sum(axis=1, keepdims=True)
    r = np.where(sc == best, 1.0 / winners, 0.0)
    # second = max over other seats, floored at 0 (sim.js: Math.max(...others, 0))
    S = sc.shape[1]
    second = np.zeros_like(sc)
    for p in range(S):
        others = np.delete(sc, p, axis=1)
        second[:, p] = np.maximum(others.max(axis=1), 0.0)
    margin = np.clip((sc - second) / 30.0, -1.0, 1.0)
    return 0.8 * r + 0.2 * margin


def load_all(paths, target, limit=None):
    X, Y, G, T, R1, RM = [], [], [], [], [], []
    base_game = 0
    for p in paths:
        d = read_shard(p)
        rew = reward_from_scores(d["scores"])            # (nG, S)
        y_outcome = rew[d["game_id"]]                     # (n, S)
        if target == "rollout":
            if d["rm"] is None:
                raise SystemExit(f"--target rollout 需要含 --rollouts 的分片: {p}")
            y = d["rm"].astype(np.float32)
        else:
            y = y_outcome.astype(np.float32)
        X.append(d["feats"]); Y.append(y); G.append(d["game_id"].astype(np.int64) + base_game); T.append(d["meta"][:, 1].astype(np.int32))
        if d["r1"] is not None:
            R1.append(d["r1"]); RM.append(d["rm"])
        base_game += d["nG"]
        print(f"[data] {p}: {d['n']} positions, {d['nG']} games, rollout={'yes' if d['rm'] is not None else 'no'}")
    X = np.concatenate(X); Y = np.concatenate(Y); G = np.concatenate(G); T = np.concatenate(T)
    R1 = np.concatenate(R1) if R1 and len(R1) == len(paths) else None
    RM = np.concatenate(RM) if RM and len(RM) == len(paths) else None
    Yo = None
    if target == "rollout":
        # outcome targets kept for the baseline comparison
        Yo_parts = []
        base_game = 0
        for p in paths:
            d = read_shard(p)
            Yo_parts.append(reward_from_scores(d["scores"])[d["game_id"]].astype(np.float32))
        Yo = np.concatenate(Yo_parts)
    if limit and limit < len(X):
        rng = np.random.default_rng(0)
        idx = np.sort(rng.choice(len(X), size=limit, replace=False))
        X, Y, G, T = X[idx], Y[idx], G[idx], T[idx]
        R1 = R1[idx] if R1 is not None else None; RM = RM[idx] if RM is not None else None; Yo = Yo[idx] if Yo is not None else None
    return X, Y, G, T, R1, RM, Yo


# ---------------- model ----------------
class MLP:
    def __init__(self, dims, seed=0):
        rng = np.random.default_rng(seed)
        self.W, self.b = [], []
        for i in range(len(dims) - 1):
            fan_in, fan_out = dims[i], dims[i + 1]
            scale = math.sqrt(2.0 / fan_in) if i < len(dims) - 2 else math.sqrt(1.0 / fan_in)
            self.W.append((rng.standard_normal((fan_in, fan_out)) * scale).astype(np.float32))
            self.b.append(np.zeros(fan_out, dtype=np.float32))
        self.dims = dims
        # Adam state
        self.m = [np.zeros_like(w) for w in self.W] + [np.zeros_like(b) for b in self.b]
        self.v = [np.zeros_like(w) for w in self.W] + [np.zeros_like(b) for b in self.b]
        self.t = 0

    def forward(self, x, cache=False):
        acts = [x]
        h = x
        L = len(self.W)
        for i in range(L):
            z = h @ self.W[i] + self.b[i]
            h = np.tanh(z) if i == L - 1 else np.maximum(z, 0.0)
            acts.append(h)
        return (h, acts) if cache else h

    def step(self, x, y, lr, wd=1e-5, beta1=0.9, beta2=0.999, eps=1e-8):
        out, acts = self.forward(x, cache=True)
        n = x.shape[0]
        loss = float(np.mean((out - y) ** 2))
        # backprop MSE (mean over batch and outputs)
        grad = (2.0 / (n * y.shape[1])) * (out - y)
        grad = grad * (1.0 - out ** 2)  # tanh'
        gW, gb = [None] * len(self.W), [None] * len(self.b)
        for i in range(len(self.W) - 1, -1, -1):
            a = acts[i]
            gW[i] = a.T @ grad + wd * self.W[i]
            gb[i] = grad.sum(axis=0)
            if i > 0:
                grad = (grad @ self.W[i].T) * (acts[i] > 0)
        self.t += 1
        params = self.W + self.b
        grads = gW + gb
        lr_t = lr * math.sqrt(1 - beta2 ** self.t) / (1 - beta1 ** self.t)
        for k, (p, g) in enumerate(zip(params, grads)):
            self.m[k] = beta1 * self.m[k] + (1 - beta1) * g
            self.v[k] = beta2 * self.v[k] + (1 - beta2) * (g * g)
            p -= (lr_t * self.m[k] / (np.sqrt(self.v[k]) + eps)).astype(np.float32)
        return loss


def batches(X, Y, bs, rng, shuffle=True):
    n = len(X)
    idx = rng.permutation(n) if shuffle else np.arange(n)
    for s in range(0, n, bs):
        j = idx[s:s + bs]
        yield X[j].astype(np.float32) / 255.0, Y[j]


def evaluate(model, X, Y, bs=8192):
    se = 0.0; cnt = 0; preds = []
    for xb, yb in batches(X, Y, bs, np.random.default_rng(0), shuffle=False):
        out = model.forward(xb)
        se += float(((out - yb) ** 2).sum()); cnt += out.size; preds.append(out)
    return se / cnt, np.concatenate(preds)


def calibration(pred, y, label):
    """按预测值分桶，比较预测均值与实际均值（座位 0 输出）"""
    p0, y0 = pred[:, 0], y[:, 0]
    edges = np.linspace(-0.2, 1.0, 13)
    print(f"[calib] {label}: bucket(pred)  n     mean_pred  mean_actual")
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p0 >= lo) & (p0 < hi)
        if m.sum() == 0:
            continue
        print(f"         [{lo:+.2f},{hi:+.2f})  {m.sum():7d}  {p0[m].mean():+.3f}     {y0[m].mean():+.3f}")


def sig6(x):
    return float(f"{x:.6g}")


def export_json(model, path, meta):
    dims = model.dims
    layers = []
    L = len(model.W)
    for i in range(L):
        W = model.W[i].T  # [out][in]
        lay = {"name": f"v.{2 * i}", "type": "linear", "in": int(dims[i]), "out": int(dims[i + 1]),
               "W": [[sig6(v) for v in row] for row in W.tolist()], "b": [sig6(v) for v in model.b[i].tolist()]}
        if i == L - 1:
            lay["head"] = "value"
        layers.append(lay)
        layers.append({"name": f"v.{2 * i + 1}_tanh", "type": "tanh"} if i == L - 1 else {"name": f"v.{2 * i + 1}_relu", "type": "relu"})
    net = {"feature_dim": int(dims[0]), "value_only": True, "value_dim": int(dims[-1]), "n_roles": 7,
           "arch": "-".join(str(d) for d in dims), "layers": layers}
    net.update(meta)
    with open(path, "w") as fh:
        json.dump(net, fh, separators=(",", ":"))
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shards", nargs="+")
    ap.add_argument("--target", choices=["outcome", "rollout"], default="outcome")
    ap.add_argument("--arch", default="256,32")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--val-frac", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--patience", type=int, default=3)
    ap.add_argument("--out", default=None)
    ap.add_argument("--ref-out", default="train/exports/vnet_ref.json")
    ap.add_argument("--eval-rollout-baseline", action="store_true")
    a = ap.parse_args()

    paths = []
    for p in a.shards:
        paths.extend(sorted(glob.glob(p)) or [p])
    X, Y, G, T, R1, RM, Yo = load_all(paths, a.target, a.limit)
    n = len(X)
    # 按局划分验证集（同一局的局面不跨集合）
    rng = np.random.default_rng(a.seed)
    games = np.unique(G)
    val_games = set(rng.choice(games, size=max(1, int(len(games) * a.val_frac)), replace=False).tolist())
    is_val = np.fromiter((g in val_games for g in G), dtype=bool, count=n)
    Xtr, Ytr, Xva, Yva = X[~is_val], Y[~is_val], X[is_val], Y[is_val]
    print(f"[data] total {n} positions from {len(games)} games; train {len(Xtr)} / val {len(Xva)}; target={a.target}")
    print(f"[data] target stats: mean={Y.mean():.4f} std={Y.std():.4f}; seat-0 win-share≈{(Y[:,0] > 0.5).mean():.3f}")

    if a.eval_rollout_baseline:
        if R1 is None or Yo is None and a.target == "outcome":
            # outcome target: compare rollouts to outcome
            if R1 is None:
                print("[baseline] 分片不含 rollout，跳过基线")
            else:
                yo = Y
                print(f"[baseline] MSE(单次 rollout → outcome) = {np.mean((R1 - yo) ** 2):.5f}")
                print(f"[baseline] MSE(k 次 rollout 均值 → outcome) = {np.mean((RM - yo) ** 2):.5f}")
        else:
            yo = Yo if Yo is not None else Y
            print(f"[baseline] MSE(单次 rollout → outcome) = {np.mean((R1 - yo) ** 2):.5f}")
            print(f"[baseline] MSE(k 次 rollout 均值 → outcome) = {np.mean((RM - yo) ** 2):.5f}")
            print(f"[baseline] MSE(outcome 常数均值 → outcome) = {np.mean((yo.mean(axis=0) - yo) ** 2):.5f}")

    dims = [X.shape[1]] + [int(h) for h in a.arch.split(",")] + [Y.shape[1]]
    model = MLP(dims, seed=a.seed)
    nparams = sum(w.size for w in model.W) + sum(b.size for b in model.b)
    print(f"[model] dims={dims} params={nparams}")

    best = (float("inf"), None); bad = 0; lr = a.lr
    for ep in range(1, a.epochs + 1):
        t0 = time.time(); tl = 0.0; nb = 0
        for xb, yb in batches(Xtr, Ytr, a.batch, rng):
            tl += model.step(xb, yb, lr); nb += 1
        val_mse, pred = evaluate(model, Xva, Yva)
        print(f"[epoch {ep:2d}] train_mse={tl / max(1, nb):.5f} val_mse={val_mse:.5f} lr={lr:.2e} {time.time() - t0:.1f}s")
        if val_mse < best[0] - 1e-6:
            best = (val_mse, [w.copy() for w in model.W], [b.copy() for b in model.b]); bad = 0
        else:
            bad += 1
            lr *= 0.5
            if bad >= a.patience:
                print("[train] early stop"); break
    model.W, model.b = best[1], best[2]
    val_mse, pred = evaluate(model, Xva, Yva)
    print(f"[final] best val_mse={val_mse:.5f}")
    calibration(pred, Yva, "val")
    # 按回合分桶的 MSE（分布偏移诊断）
    Tva = T[is_val]
    for lo, hi in [(0, 4), (4, 8), (8, 12), (12, 16), (16, 255)]:
        m = (Tva >= lo) & (Tva < hi)
        if m.sum():
            print(f"[turn {lo:2d}-{hi:3d}] n={m.sum():7d} mse={np.mean((pred[m] - Yva[m]) ** 2):.5f}")
    if a.eval_rollout_baseline and R1 is not None:
        r1v, rmv = R1[is_val], RM[is_val]
        yo = (Yo if Yo is not None else Y)[is_val]
        print(f"[baseline/val] net→outcome {np.mean((pred - yo) ** 2):.5f} | rollout1→outcome {np.mean((r1v - yo) ** 2):.5f} | rolloutMean→outcome {np.mean((rmv - yo) ** 2):.5f}")

    if a.out:
        size = export_json(model, a.out, {"val_mse": float(val_mse), "train_positions": int(len(Xtr)), "target": a.target,
                                          "shards": [os.path.basename(p) for p in paths]})
        print(f"[export] {a.out} ({size / 1024:.1f} KB)")
        os.makedirs(os.path.dirname(a.ref_out) or ".", exist_ok=True)
        ref_idx = np.linspace(0, len(Xva) - 1, num=min(20, len(Xva))).astype(int)
        xr = Xva[ref_idx]
        yr = model.forward(xr.astype(np.float32) / 255.0)
        with open(a.ref_out, "w") as fh:
            json.dump({"feature_dim": int(dims[0]), "samples": [{"f_u8": xr[i].tolist(), "out": [float(v) for v in yr[i]]} for i in range(len(ref_idx))]}, fh)
        print(f"[export] parity reference → {a.ref_out} ({len(ref_idx)} samples)")


if __name__ == "__main__":
    main()
