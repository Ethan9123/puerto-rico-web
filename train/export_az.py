"""把训好的 ResNet AlphaZero 网络导出为 JSON，供 JS 端 azForward 加载。

格式:
  { arch:"resnet", feature_dim, action_dim, n_value, hidden,
    stem:{W,b}, blocks:[{l1:{W,b}, l2:{W,b}}, ...],
    policy_head:{W,b}, value_head:{W,b}, val_loss, epoch }

用法: python train/export_az.py train/exports/az.pt train/exports/az.json
"""

import argparse
import json
from pathlib import Path

import torch

from model_az import PolicyValueResNet, FEATURE_DIM, ACTION_DIM, N_VALUE


def lin(m):
    return {"W": m.weight.detach().cpu().numpy().tolist(),
            "b": m.bias.detach().cpu().numpy().tolist()}


def export(pt_path: Path, json_path: Path, hidden: int = 256, blocks: int = 5):
    blob = torch.load(pt_path, map_location="cpu")
    hidden = blob.get("hidden", hidden)
    blocks = blob.get("blocks", blocks)
    net = PolicyValueResNet(hidden=hidden, blocks=blocks)
    net.load_state_dict(blob["state_dict"])
    net.eval()

    out = {
        "arch": "resnet",
        "feature_dim": FEATURE_DIM,
        "action_dim": ACTION_DIM,
        "n_value": N_VALUE,
        "hidden": hidden,
        "stem": lin(net.stem),
        "blocks": [{"l1": lin(b.l1), "l2": lin(b.l2)} for b in net.blocks],
        "policy_head": lin(net.policy_head),
        "value_head": lin(net.value_head),
        "val_loss": float(blob.get("val_loss", 0.0)),
        "epoch": int(blob.get("epoch", 0)),
    }
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    sz = json_path.stat().st_size / 1e6
    print(f"Exported {pt_path} -> {json_path} ({sz:.2f} MB)  blocks={blocks} hidden={hidden} params={net.num_params():,}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pt", type=Path)
    ap.add_argument("json", type=Path)
    args = ap.parse_args()
    export(args.pt, args.json)


if __name__ == "__main__":
    main()
