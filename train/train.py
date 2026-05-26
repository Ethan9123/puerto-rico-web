"""AlphaZero 训练循环：
  loss = CE(policy_logits, action) + MSE(value_pred, value_target)

用法：
  python train/train.py data/selfplay-v1.jsonl --epochs 30 --batch 256 --lr 1e-3
"""

import argparse
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim

from model import PolicyValueNet, FEATURE_DIM, N_ROLES
from load_data import make_loaders


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", nargs="+", help="JSONL files")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--policy-w", type=float, default=1.0, help="weight on policy loss")
    ap.add_argument("--value-w", type=float, default=1.0, help="weight on value loss")
    ap.add_argument("--out", default="train/exports/weights-v1.pt", help="output weights .pt")
    ap.add_argument("--device", default="cpu", help="cpu or cuda")
    args = ap.parse_args()

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    paths = [Path(p) for p in args.data]
    train_dl, val_dl, ds = make_loaders(paths, batch_size=args.batch, val_frac=args.val_frac)
    print(f"Dataset: {len(ds)} samples, train batches: {len(train_dl)}, val batches: {len(val_dl)}")

    device = torch.device(args.device)
    net = PolicyValueNet().to(device)
    print(f"Model params: {net.num_params():,}")

    opt = optim.Adam(net.parameters(), lr=args.lr, weight_decay=1e-5)
    ce = nn.CrossEntropyLoss()
    mse = nn.MSELoss()

    def step(X, A, V, training: bool):
        X = X.to(device); A = A.to(device); V = V.to(device)
        pi, v = net(X)
        loss_p = ce(pi, A)
        loss_v = mse(v, V)
        loss = args.policy_w * loss_p + args.value_w * loss_v
        if training:
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
        # 准确率：top-1 命中
        acc = (pi.argmax(dim=1) == A).float().mean().item()
        return loss.item(), loss_p.item(), loss_v.item(), acc

    best_val = float("inf")
    for ep in range(1, args.epochs + 1):
        t0 = time.time()
        net.train()
        agg = [0.0, 0.0, 0.0, 0.0]; cnt = 0
        for X, A, V in train_dl:
            l, lp, lv, a = step(X, A, V, training=True)
            agg[0] += l; agg[1] += lp; agg[2] += lv; agg[3] += a; cnt += 1
        tr = [v / max(1, cnt) for v in agg]

        net.eval()
        agg = [0.0, 0.0, 0.0, 0.0]; cnt = 0
        with torch.no_grad():
            for X, A, V in val_dl:
                l, lp, lv, a = step(X, A, V, training=False)
                agg[0] += l; agg[1] += lp; agg[2] += lv; agg[3] += a; cnt += 1
        vl = [v / max(1, cnt) for v in agg]

        improved = "*" if vl[0] < best_val else " "
        if vl[0] < best_val:
            best_val = vl[0]
            torch.save({
                "feature_dim": FEATURE_DIM,
                "n_roles": N_ROLES,
                "state_dict": net.state_dict(),
                "val_loss": vl[0],
                "epoch": ep,
            }, args.out)
        dt = time.time() - t0
        print(f"ep {ep:3d}{improved}  train: loss={tr[0]:.4f} (p={tr[1]:.4f} v={tr[2]:.4f}) acc={tr[3]*100:.1f}%  "
              f"val: loss={vl[0]:.4f} (p={vl[1]:.4f} v={vl[2]:.4f}) acc={vl[3]*100:.1f}%  ({dt:.1f}s)")

    print(f"Done. Best val_loss={best_val:.4f}. Weights saved to {args.out}")


if __name__ == "__main__":
    main()
