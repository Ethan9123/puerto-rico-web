"""生成 az ResNet parity 参考: 随机初始化网络 -> 导出 JSON + PyTorch forward 参考。"""
import json, sys
from pathlib import Path
import torch
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "train"))
from model_az import PolicyValueResNet, FEATURE_DIM
import export_az

HIDDEN, BLOCKS = 128, 3
torch.manual_seed(123)
net = PolicyValueResNet(hidden=HIDDEN, blocks=BLOCKS)
net.eval()

pt = ROOT / "train" / "exports" / "az_smoke.pt"
pt.parent.mkdir(parents=True, exist_ok=True)
torch.save({"state_dict": net.state_dict(), "hidden": HIDDEN, "blocks": BLOCKS, "val_loss": 0.0}, pt)
export_az.export(pt, ROOT / "train" / "exports" / "az_smoke.json", hidden=HIDDEN, blocks=BLOCKS)

rng = np.random.default_rng(7)
samples = []
for _ in range(8):
    f = rng.standard_normal(FEATURE_DIM).astype(np.float32)
    with torch.no_grad():
        pl, v = net(torch.from_numpy(f).unsqueeze(0))
    samples.append({"features": f.tolist(), "py_logits": pl[0].tolist(), "py_value": v[0].tolist()})
json.dump({"samples": samples}, open(ROOT / "tests" / "_az_ref.json", "w"), separators=(",", ":"))
print(f"wrote _az_ref.json ({len(samples)} samples)")
