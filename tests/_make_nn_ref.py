"""生成 nn_parity_test 用的参考数据：
  - 加载训好的权重
  - 对若干随机特征向量跑 PyTorch forward
  - 同时把 weights JSON 路径 / 网络 JSON 内容写下来
  - 输出到 tests/_nn_ref.json
"""

import json
import sys
import random
from pathlib import Path

import torch
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "train"))

from model import PolicyValueNet


def main():
    pt_path = ROOT / "train" / "exports" / "smoke.pt"
    json_path = ROOT / "train" / "exports" / "smoke.json"
    out_path = ROOT / "tests" / "_nn_ref.json"

    if not pt_path.exists():
        print("missing", pt_path)
        sys.exit(1)
    if not json_path.exists():
        print("missing", json_path, "; run train/export_weights.py first")
        sys.exit(1)

    blob = torch.load(pt_path, map_location="cpu")
    net = PolicyValueNet()
    net.load_state_dict(blob["state_dict"])
    net.eval()

    with open(json_path, "r", encoding="utf-8") as fh:
        network = json.load(fh)

    rng = np.random.default_rng(42)
    samples = []
    for _ in range(8):
        # 用 sim 实际样本格式（[0,1] 内）
        f = rng.random(446).astype(np.float32)
        # 留一些 0 模拟稀疏特征
        f[rng.choice(446, 100, replace=False)] = 0.0
        x = torch.from_numpy(f).unsqueeze(0)
        with torch.no_grad():
            pi_logits, v = net(x)
            pi = torch.softmax(pi_logits, dim=-1)[0].tolist()
            v = float(v.item())
        samples.append({"features": f.tolist(), "py_policy": pi, "py_value": v})

    ref = {
        "weights_path": str(json_path.relative_to(ROOT)).replace("\\", "/"),
        "network": network,
        "samples": samples,
    }
    out_path.write_text(json.dumps(ref, separators=(",", ":")))
    print(f"wrote {out_path} ({out_path.stat().st_size/1e6:.2f} MB)")
    print(f"  samples: {len(samples)}")


if __name__ == "__main__":
    main()
