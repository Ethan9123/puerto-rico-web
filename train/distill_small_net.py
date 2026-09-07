#!/usr/bin/env python3
"""distill_small_net.py — Phase 2.5：把部署大网蒸馏成小合并网（policy + value 双头）

动机（AI_STRENGTH §13）：换上价值网叶评估后，每次搜索迭代 272 µs 里价值网只占 ~8 µs，
而**大网 policy 先验前向占 ~112 µs（41%）**——`sim.js:939` 每扩展一个新节点算一次先验，
`sim.js:963` 每次迭代恰好扩展一个节点，所以大网每迭代跑一次。大网 655,744 MACs 是小网的 10 倍。

本脚本训练 446→H1→H2→{policy 7, value 4} 的小合并网，**同时**提供先验与叶价值：
  - policy 头：KL 蒸馏自大网（软标签，保住 L6 强于 L5 的唯一来源）
  - value 头：直接学 sim.js reward() 尺度的终局回报（与 train_value_np.py 同口径）
导出用 export_weights.py 的既有命名约定（最后一个 trunk relu 必须叫 "trunk.5"），
因此产物是 mcts_value_nn.json 的**直接替换，运行时零改动**。

用法:
  python3 train/distill_small_net.py 'data/value/heur-*.bin' 'data/value/mix-*.bin' \
      --teacher mcts_value_nn.json --arch 128,64 --epochs 12 --out mcts_value_nn_small.json
"""
import argparse
import glob
import json
import math
import os
import time

import numpy as np

from train_value_np import read_shard, reward_from_scores, sig6


# ---------------- 教师网（复刻 sim_nn.js _forward 的控制流）----------------
def load_teacher(path):
    with open(path) as fh:
        net = json.load(fh)
    prog = []
    for L in net["layers"]:
        e = {"type": L.get("type"), "name": L.get("name", ""), "head": L.get("head")}
        if L.get("type") == "linear":
            e["W"] = np.asarray(L["W"], dtype=np.float32).T   # JSON 是 [out][in] → 转成 [in][out]
            e["b"] = np.asarray(L["b"], dtype=np.float32)
        prog.append(e)
    return net, prog


def teacher_forward(prog, X):
    """返回 (policy_logits [n,7], value_vec [n,4])；控制流与 sim_nn.js:89-112 一致。"""
    cur = X
    trunk_out = None
    policy = None
    value = None
    for L in prog:
        if L["head"] == "policy":
            src = trunk_out if trunk_out is not None else cur
            policy = src @ L["W"] + L["b"]
            continue
        if L["head"] == "value":
            src = trunk_out if trunk_out is not None else cur
            cur = src @ L["W"] + L["b"]
            continue
        if L["type"] == "linear":
            cur = cur @ L["W"] + L["b"]
        elif L["type"] == "relu":
            cur = np.maximum(cur, 0.0)
        elif L["type"] == "tanh":
            cur = np.tanh(cur)
            value = cur
            continue
        if L["type"] == "relu" and L["name"].startswith("trunk.5"):
            trunk_out = cur
    return policy, value


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


# ---------------- 学生网（双头）----------------
class TwoHeadNet:
    def __init__(self, dims, n_policy=7, n_value=4, seed=0):
        rng = np.random.default_rng(seed)
        self.dims = dims                      # [446, H1, H2]
        self.W, self.b = [], []
        for i in range(len(dims) - 1):
            fan_in, fan_out = dims[i], dims[i + 1]
            self.W.append((rng.standard_normal((fan_in, fan_out)) * math.sqrt(2.0 / fan_in)).astype(np.float32))
            self.b.append(np.zeros(fan_out, dtype=np.float32))
        h = dims[-1]
        self.Wp = (rng.standard_normal((h, n_policy)) * math.sqrt(1.0 / h)).astype(np.float32)
        self.bp = np.zeros(n_policy, dtype=np.float32)
        self.Wv = (rng.standard_normal((h, n_value)) * math.sqrt(1.0 / h)).astype(np.float32)
        self.bv = np.zeros(n_value, dtype=np.float32)
        self._params = self.W + self.b + [self.Wp, self.bp, self.Wv, self.bv]
        self.m = [np.zeros_like(p) for p in self._params]
        self.v = [np.zeros_like(p) for p in self._params]
        self.t = 0

    def params(self):
        return self.W + self.b + [self.Wp, self.bp, self.Wv, self.bv]

    def forward(self, x, cache=False):
        acts = [x]
        h = x
        for i in range(len(self.W)):
            h = np.maximum(h @ self.W[i] + self.b[i], 0.0)
            acts.append(h)
        logits = h @ self.Wp + self.bp
        val = np.tanh(h @ self.Wv + self.bv)
        return (logits, val, acts) if cache else (logits, val)

    def step(self, x, y_v, t_p, lr, value_w=1.0, policy_w=1.0, wd=1e-5, b1=0.9, b2=0.999, eps=1e-8):
        logits, val, acts = self.forward(x, cache=True)
        n = x.shape[0]
        h = acts[-1]
        # ---- losses ----
        sm = softmax(logits)
        # KL(teacher || student) = sum t*(log t - log s)；对 logits 的梯度 = softmax(s) - t
        with np.errstate(divide="ignore", invalid="ignore"):
            kl = float(np.sum(t_p * (np.log(np.clip(t_p, 1e-9, None)) - np.log(np.clip(sm, 1e-9, None)))) / n)
        vmse = float(np.mean((val - y_v) ** 2))
        # ---- grads ----
        g_logits = policy_w * (sm - t_p) / n
        g_val = value_w * (2.0 / (n * y_v.shape[1])) * (val - y_v) * (1.0 - val ** 2)
        gWp, gbp = h.T @ g_logits + wd * self.Wp, g_logits.sum(axis=0)
        gWv, gbv = h.T @ g_val + wd * self.Wv, g_val.sum(axis=0)
        gh = g_logits @ self.Wp.T + g_val @ self.Wv.T
        gW, gb = [None] * len(self.W), [None] * len(self.b)
        grad = gh * (acts[-1] > 0)
        for i in range(len(self.W) - 1, -1, -1):
            gW[i] = acts[i].T @ grad + wd * self.W[i]
            gb[i] = grad.sum(axis=0)
            if i > 0:
                grad = (grad @ self.W[i].T) * (acts[i] > 0)
        grads = gW + gb + [gWp, gbp, gWv, gbv]
        # ---- Adam ----
        self.t += 1
        lr_t = lr * math.sqrt(1 - b2 ** self.t) / (1 - b1 ** self.t)
        for k, (p, g) in enumerate(zip(self.params(), grads)):
            self.m[k] = b1 * self.m[k] + (1 - b1) * g
            self.v[k] = b2 * self.v[k] + (1 - b2) * (g * g)
            p -= (lr_t * self.m[k] / (np.sqrt(self.v[k]) + eps)).astype(np.float32)
        return vmse, kl


def export_small(net, path, meta):
    """按 export_weights.py 的约定导出：最后一个 trunk relu 必须叫 trunk.5（sim_nn.js 靠它切 trunkOut）"""
    layers = []
    n_trunk = len(net.W)
    for i in range(n_trunk):
        W = net.W[i].T  # [out][in]
        layers.append({"name": f"trunk.{2 * i}", "type": "linear", "in": int(W.shape[1]), "out": int(W.shape[0]),
                       "W": [[sig6(v) for v in row] for row in W.tolist()], "b": [sig6(v) for v in net.b[i].tolist()]})
        last = (i == n_trunk - 1)
        layers.append({"name": "trunk.5" if last else f"trunk.{2 * i + 1}_relu", "type": "relu"})
    Wp = net.Wp.T
    layers.append({"name": "policy_head", "type": "linear", "head": "policy", "in": int(Wp.shape[1]), "out": int(Wp.shape[0]),
                   "W": [[sig6(v) for v in row] for row in Wp.tolist()], "b": [sig6(v) for v in net.bp.tolist()]})
    Wv = net.Wv.T
    layers.append({"name": "value_head.0", "type": "linear", "head": "value", "in": int(Wv.shape[1]), "out": int(Wv.shape[0]),
                   "W": [[sig6(v) for v in row] for row in Wv.tolist()], "b": [sig6(v) for v in net.bv.tolist()]})
    layers.append({"name": "value_head.1_tanh", "type": "tanh"})
    out = {"feature_dim": int(net.dims[0]), "n_roles": 7, "arch": "-".join(str(d) for d in net.dims) + "-{7,4}", "layers": layers}
    out.update(meta)
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shards", nargs="+")
    ap.add_argument("--teacher", default="mcts_value_nn.json")
    ap.add_argument("--arch", default="128,64")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=2048)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--val-frac", type=float, default=0.05)
    ap.add_argument("--policy-w", type=float, default=1.0)
    ap.add_argument("--value-w", type=float, default=1.0)
    ap.add_argument("--patience", type=int, default=3)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="mcts_value_nn_small.json")
    ap.add_argument("--ref-out", default="train/exports/small_ref.json")
    a = ap.parse_args()

    paths = []
    for p in a.shards:
        paths.extend(sorted(glob.glob(p)) or [p])

    # ---- 数据 ----
    X, Yv, G, T = [], [], [], []
    base_game = 0
    for p in paths:
        d = read_shard(p)
        rew = reward_from_scores(d["scores"])
        X.append(d["feats"]); Yv.append(rew[d["game_id"]].astype(np.float32))
        G.append(d["game_id"].astype(np.int64) + base_game); T.append(d["meta"][:, 1].astype(np.int32))
        base_game += d["nG"]   # train_value_np.read_shard 的键名是 nG
        print(f"[data] {p}: {d['n']} positions")
    X = np.concatenate(X); Yv = np.concatenate(Yv); G = np.concatenate(G); T = np.concatenate(T)
    if a.limit and a.limit < len(X):
        rng0 = np.random.default_rng(0)
        idx = np.sort(rng0.choice(len(X), size=a.limit, replace=False))
        X, Yv, G, T = X[idx], Yv[idx], G[idx], T[idx]
    n = len(X)

    # ---- 教师软标签（只推理，不重新生成对局）----
    tnet, prog = load_teacher(a.teacher)
    print(f"[teacher] {a.teacher}: {len(tnet['layers'])} layers, feature_dim={tnet['feature_dim']}")
    t0 = time.time()
    Tp = np.empty((n, 7), dtype=np.float32)
    BS = 16384
    for s in range(0, n, BS):
        xb = X[s:s + BS].astype(np.float32) / 255.0
        pl, _ = teacher_forward(prog, xb)
        Tp[s:s + BS] = softmax(pl)
        if (s // BS) % 20 == 0:
            print(f"[teacher] {s + len(xb)}/{n} ({(s + len(xb)) / max(1e-9, time.time() - t0):.0f} pos/s)", flush=True)
    print(f"[teacher] soft labels done in {time.time() - t0:.0f}s; entropy={float(-(Tp * np.log(np.clip(Tp, 1e-9, None))).sum(1).mean()):.3f}")

    # ---- 按局划分验证集 ----
    rng = np.random.default_rng(a.seed)
    games = np.unique(G)
    val_games = set(rng.choice(games, size=max(1, int(len(games) * a.val_frac)), replace=False).tolist())
    is_val = np.fromiter((g in val_games for g in G), dtype=bool, count=n)
    Xtr, Ytr, Ptr = X[~is_val], Yv[~is_val], Tp[~is_val]
    Xva, Yva, Pva = X[is_val], Yv[is_val], Tp[is_val]
    print(f"[data] total {n} from {len(games)} games; train {len(Xtr)} / val {len(Xva)}")

    dims = [X.shape[1]] + [int(h) for h in a.arch.split(",")]
    student = TwoHeadNet(dims, seed=a.seed)
    nparams = sum(p.size for p in student.params())
    tmacs = sum(L["W"].size for L in prog if L["type"] == "linear")
    smacs = sum(w.size for w in student.W) + student.Wp.size + student.Wv.size
    print(f"[model] student dims={dims}+{{7,4}} params={nparams} MACs={smacs} (teacher {tmacs}, {tmacs / smacs:.1f}x)")

    def evaluate():
        vmse = 0.0; kl = 0.0; agree = 0; cnt = 0
        for s in range(0, len(Xva), 8192):
            xb = Xva[s:s + 8192].astype(np.float32) / 255.0
            lg, val = student.forward(xb)
            sm = softmax(lg)
            tb = Pva[s:s + 8192]
            vmse += float(((val - Yva[s:s + 8192]) ** 2).sum())
            kl += float(np.sum(tb * (np.log(np.clip(tb, 1e-9, None)) - np.log(np.clip(sm, 1e-9, None)))))
            agree += int((sm.argmax(1) == tb.argmax(1)).sum())
            cnt += len(xb)
        return vmse / (cnt * Yva.shape[1]), kl / cnt, agree / cnt

    best = (float("inf"), None); bad = 0; lr = a.lr
    for ep in range(1, a.epochs + 1):
        t1 = time.time(); tv = 0.0; tk = 0.0; nb = 0
        order = rng.permutation(len(Xtr))
        for s in range(0, len(order), a.batch):
            j = order[s:s + a.batch]
            vm, kl = student.step(Xtr[j].astype(np.float32) / 255.0, Ytr[j], Ptr[j], lr,
                                  value_w=a.value_w, policy_w=a.policy_w)
            tv += vm; tk += kl; nb += 1
        vmse, vkl, vagree = evaluate()
        score = a.value_w * vmse + a.policy_w * vkl
        print(f"[epoch {ep:2d}] train v_mse={tv / nb:.5f} kl={tk / nb:.4f} | val v_mse={vmse:.5f} kl={vkl:.4f} top1_agree={vagree:.3f} lr={lr:.2e} {time.time() - t1:.0f}s", flush=True)
        if score < best[0] - 1e-6:
            best = (score, [p.copy() for p in student.params()]); bad = 0
        else:
            bad += 1; lr *= 0.5
            if bad >= a.patience:
                print("[train] early stop"); break
    for p, bp in zip(student.params(), best[1]):
        p[...] = bp
    vmse, vkl, vagree = evaluate()
    print(f"[final] val v_mse={vmse:.5f} policy_kl={vkl:.4f} top1_agree={vagree:.3f}")
    Tva = T[is_val]
    for lo, hi in [(0, 4), (4, 8), (8, 12), (12, 16), (16, 255)]:
        m = (Tva >= lo) & (Tva < hi)
        if m.sum():
            xb = Xva[m].astype(np.float32) / 255.0
            lg, val = student.forward(xb)
            sm = softmax(lg); tb = Pva[m]
            print(f"[turn {lo:2d}-{hi:3d}] n={m.sum():7d} v_mse={float(np.mean((val - Yva[m]) ** 2)):.5f} top1_agree={float((sm.argmax(1) == tb.argmax(1)).mean()):.3f}")

    size = export_small(student, a.out, {"val_mse": float(vmse), "policy_kl": float(vkl), "top1_agree": float(vagree),
                                         "teacher": os.path.basename(a.teacher), "train_positions": int(len(Xtr))})
    print(f"[export] {a.out} ({size / 1024:.1f} KB)")
    os.makedirs(os.path.dirname(a.ref_out) or ".", exist_ok=True)
    ridx = np.linspace(0, len(Xva) - 1, num=min(20, len(Xva))).astype(int)
    xr = Xva[ridx]
    lg, val = student.forward(xr.astype(np.float32) / 255.0)
    with open(a.ref_out, "w") as fh:
        json.dump({"feature_dim": int(dims[0]),
                   "samples": [{"f_u8": xr[i].tolist(), "policy_logits": [float(v) for v in lg[i]], "value_vec": [float(v) for v in val[i]]}
                               for i in range(len(ridx))]}, fh)
    print(f"[export] parity reference → {a.ref_out}")


if __name__ == "__main__":
    main()
