"""读 JSONL → torch Tensor。

每行 JSON: {"f": [446 floats], "a": int 0-6, "v": float -1..1, "n": int 3-5}
"""

import json
from pathlib import Path
from typing import Iterable, Tuple

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader


VVDIM = 4  # value 向量维度（每玩家一个，perspective-ordered）


class SelfPlayDataset(Dataset):
    def __init__(self, paths: Iterable[Path]):
        feats, actions, values = [], [], []
        for p in paths:
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    d = json.loads(line)
                    feats.append(d["f"])
                    actions.append(d["a"])
                    # value 目标：优先用向量 vv（4 维）；旧数据只有标量 v 时
                    # 退化为 [v, 0, 0, 0]（仅 index 0 有意义，其余 mask 不会用）
                    if "vv" in d:
                        vv = d["vv"]
                        if len(vv) < VVDIM:
                            vv = vv + [0.0] * (VVDIM - len(vv))
                        values.append(vv[:VVDIM])
                    else:
                        values.append([d["v"]] + [0.0] * (VVDIM - 1))
        self.X = torch.tensor(np.asarray(feats, dtype=np.float32))
        self.A = torch.tensor(actions, dtype=torch.long)
        self.V = torch.tensor(np.asarray(values, dtype=np.float32))  # [N, VVDIM]
        assert self.X.dim() == 2 and self.X.shape[1] == 446, f"feature dim mismatch: {self.X.shape}"
        assert self.A.shape[0] == self.X.shape[0]
        assert self.V.shape[0] == self.X.shape[0]
        assert self.V.shape[1] == VVDIM, f"value dim mismatch: {self.V.shape}"

    def __len__(self) -> int:
        return self.X.shape[0]

    def __getitem__(self, idx) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        return self.X[idx], self.A[idx], self.V[idx]


def split_train_val(ds: SelfPlayDataset, val_frac: float = 0.1, seed: int = 42) -> Tuple[Dataset, Dataset]:
    n = len(ds)
    g = torch.Generator().manual_seed(seed)
    idx = torch.randperm(n, generator=g)
    n_val = max(1, int(n * val_frac))
    val_idx, train_idx = idx[:n_val], idx[n_val:]

    class _Sub(Dataset):
        def __init__(self, base: SelfPlayDataset, sel: torch.Tensor):
            self.b = base
            self.sel = sel

        def __len__(self):
            return self.sel.numel()

        def __getitem__(self, i):
            return self.b[self.sel[i].item()]

    return _Sub(ds, train_idx), _Sub(ds, val_idx)


def make_loaders(paths: Iterable[Path], batch_size: int = 256, val_frac: float = 0.1, pin_memory: bool = False):
    ds = SelfPlayDataset(paths)
    train, val = split_train_val(ds, val_frac=val_frac)
    return (
        DataLoader(train, batch_size=batch_size, shuffle=True, num_workers=0, pin_memory=pin_memory),
        DataLoader(val, batch_size=batch_size, shuffle=False, num_workers=0, pin_memory=pin_memory),
        ds,
    )


if __name__ == "__main__":
    import sys
    paths = [Path(p) for p in sys.argv[1:]] or [Path("data/selfplay-smoke.jsonl")]
    train_dl, val_dl, ds = make_loaders(paths, batch_size=64)
    print(f"loaded {len(ds)} samples from {len(paths)} files")
    for X, A, V in train_dl:
        print(f"batch: X={tuple(X.shape)}, A={tuple(A.shape)}, V={tuple(V.shape)}")
        print(f"  X stats : min={X.min():.3f} max={X.max():.3f} mean={X.mean():.3f}")
        print(f"  A counts: {[(A == i).sum().item() for i in range(7)]}")
        print(f"  V stats : min={V.min():.3f} max={V.max():.3f} mean={V.mean():.3f}")
        break
