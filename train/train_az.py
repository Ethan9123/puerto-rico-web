"""训练全决策 AlphaZero ResNet。
  policy loss = KL/交叉熵(掩码 log_softmax 预测, 搜索策略目标)
  value loss  = MSE(预测 value 向量, 终局 value 向量)

用法: python train/train_az.py data/az-gen0.jsonl [more...] --epochs 20 --batch 512 --out exports/az.pt
"""
import argparse, time
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim

from model_az import PolicyValueResNet, FEATURE_DIM, ACTION_DIM, N_VALUE
from load_data_az import make_loaders

NEG = -1e9


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", nargs="+")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", type=int, default=256)
    ap.add_argument("--blocks", type=int, default=5)
    ap.add_argument("--value-w", type=float, default=1.0)
    ap.add_argument("--out", default="train/exports/az.pt")
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    dev = torch.device("cuda:0") if (args.device == "auto" and torch.cuda.is_available()) else torch.device(args.device if args.device != "auto" else "cpu")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    tl, vl, ds = make_loaders([Path(p) for p in args.data], batch_size=args.batch, pin_memory=(dev.type == "cuda"))
    print(f"Dataset: {len(ds)} samples | device={dev} | train batches={len(tl)} val={len(vl)}", flush=True)
    if dev.type == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(dev)}", flush=True); torch.backends.cudnn.benchmark = True

    net = PolicyValueResNet(hidden=args.hidden, blocks=args.blocks).to(dev)
    print(f"Model params: {net.num_params():,}", flush=True)
    opt = optim.Adam(net.parameters(), lr=args.lr, weight_decay=1e-5)
    mse = nn.MSELoss()

    def step(X, PI, MASK, V, NP, train):
        X = X.to(dev, non_blocking=True); PI = PI.to(dev, non_blocking=True)
        MASK = MASK.to(dev, non_blocking=True); V = V.to(dev, non_blocking=True); NP = NP.to(dev, non_blocking=True)
        logits, vpred = net(X)
        # 掩码 log_softmax: 非法位置 -1e9
        masked = logits + (MASK - 1.0) * 1e9
        logp = torch.log_softmax(masked, dim=1)
        ploss = -(PI * logp).sum(1).mean()  # 交叉熵(target 已归一)
        # value: 只在前 NP 个分量上算(超出玩家数的分量不监督)
        vmask = (torch.arange(N_VALUE, device=dev).unsqueeze(0) < NP.unsqueeze(1)).float()
        vloss = ((vpred - V) ** 2 * vmask).sum() / vmask.sum().clamp(min=1)
        loss = ploss + args.value_w * vloss
        if train:
            opt.zero_grad(set_to_none=True); loss.backward(); opt.step()
        # 策略 top-1 命中率(预测最大 legal vs target 最大)
        pred_a = masked.argmax(1); tgt_a = PI.argmax(1)
        acc = (pred_a == tgt_a).float().mean().item()
        return loss.item(), ploss.item(), vloss.item(), acc

    best = float("inf")
    for ep in range(1, args.epochs + 1):
        t0 = time.time(); net.train(); agg = [0, 0, 0, 0]; cnt = 0
        for b in tl:
            r = step(*b, True); agg = [agg[i] + r[i] for i in range(4)]; cnt += 1
        tr = [x / max(1, cnt) for x in agg]
        net.eval(); agg = [0, 0, 0, 0]; cnt = 0
        with torch.no_grad():
            for b in vl:
                r = step(*b, False); agg = [agg[i] + r[i] for i in range(4)]; cnt += 1
        va = [x / max(1, cnt) for x in agg]
        mark = "*" if va[0] < best else " "
        if va[0] < best:
            best = va[0]
            torch.save({"state_dict": net.state_dict(), "hidden": args.hidden, "blocks": args.blocks, "val_loss": va[0], "epoch": ep}, args.out)
        print(f"ep {ep:3d}{mark} train loss={tr[0]:.4f}(p={tr[1]:.4f} v={tr[2]:.4f}) acc={tr[3]*100:.1f}% | val loss={va[0]:.4f}(p={va[1]:.4f} v={va[2]:.4f}) acc={va[3]*100:.1f}% ({time.time()-t0:.1f}s)", flush=True)
    print(f"Done. Best val_loss={best:.4f} → {args.out}", flush=True)


if __name__ == "__main__":
    main()
