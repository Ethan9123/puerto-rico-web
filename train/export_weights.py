"""把训好的 PyTorch 权重导出为 JSON，让 JS 端能加载。

格式：
  {
    "feature_dim": 446,
    "n_roles": 7,
    "layers": [
      { "name": "trunk.0", "type": "linear", "in": 446, "out": 256, "W": [[...]], "b": [...] },
      { "name": "trunk.0_relu", "type": "relu" },
      ...
      { "name": "policy_head", "type": "linear", "in": 128, "out": 7, "W": ..., "b": ... },
      { "name": "value_head.0", "type": "linear", "in": 128, "out": 1, "W": ..., "b": ... },
      { "name": "value_head.0_tanh", "type": "tanh" }
    ]
  }

用法:
  python train/export_weights.py train/exports/weights-v1.pt train/exports/weights-v1.json
"""

import argparse
import json
from pathlib import Path

import torch

from model import PolicyValueNet, FEATURE_DIM, N_ROLES


def linear_layer(name, W, b):
    return {
        "name": name,
        "type": "linear",
        "in": W.shape[1],
        "out": W.shape[0],
        # JS row-major：W[out_i][in_j]，所以保留 (out, in) 形状
        "W": W.tolist(),
        "b": b.tolist(),
    }


def export(pt_path: Path, json_path: Path):
    blob = torch.load(pt_path, map_location="cpu")
    net = PolicyValueNet()
    net.load_state_dict(blob["state_dict"])
    net.eval()

    # 因为 model 是 nn.Sequential 的 trunk + policy_head + value_head(Sequential)，
    # 手动按已知拓扑展开。
    layers = []
    sd = net.state_dict()
    # trunk: Linear(446,256)+ReLU, Linear(256,256)+ReLU, Linear(256,128)+ReLU
    for i, sub in enumerate(net.trunk):
        if isinstance(sub, torch.nn.Linear):
            layers.append(linear_layer(f"trunk.{i}", sub.weight.detach().numpy(), sub.bias.detach().numpy()))
        elif isinstance(sub, torch.nn.ReLU):
            layers.append({"name": f"trunk.{i}_relu", "type": "relu"})
    # policy head: Linear(128,7) → softmax 在 JS 里做
    ph = net.policy_head
    layers.append({"name": "policy_head", "type": "linear",
                   "in": ph.in_features, "out": ph.out_features,
                   "W": ph.weight.detach().numpy().tolist(),
                   "b": ph.bias.detach().numpy().tolist(),
                   "head": "policy"})
    # value head: Linear(128,1) → Tanh
    for i, sub in enumerate(net.value_head):
        if isinstance(sub, torch.nn.Linear):
            layers.append({"name": f"value_head.{i}", "type": "linear",
                           "in": sub.in_features, "out": sub.out_features,
                           "W": sub.weight.detach().numpy().tolist(),
                           "b": sub.bias.detach().numpy().tolist(),
                           "head": "value"})
        elif isinstance(sub, torch.nn.Tanh):
            layers.append({"name": f"value_head.{i}_tanh", "type": "tanh"})

    out_blob = {
        "feature_dim": FEATURE_DIM,
        "n_roles": N_ROLES,
        "val_loss": float(blob.get("val_loss", 0.0)),
        "epoch": int(blob.get("epoch", 0)),
        "layers": layers,
    }
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(out_blob, fh, separators=(",", ":"))
    sz_mb = json_path.stat().st_size / 1e6
    print(f"Exported {pt_path} -> {json_path} ({sz_mb:.2f} MB)")
    print(f"Layers: {len(layers)}")
    for layer in layers:
        if layer["type"] == "linear":
            print(f"  {layer['name']:24s} linear  {layer['in']:4d} → {layer['out']:4d}  "
                  f"params={layer['in']*layer['out']+layer['out']:,}")
        else:
            print(f"  {layer['name']:24s} {layer['type']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pt", type=Path)
    ap.add_argument("json", type=Path)
    args = ap.parse_args()
    export(args.pt, args.json)


if __name__ == "__main__":
    main()
