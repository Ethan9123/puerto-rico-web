"""读 az 自对弈 JSONL → torch 张量。

每行: {f:[452], pi:[[gidx,prob]...], legal:[gidx...], v:[4], n}
返回: X[N,452], PI[N,69](稠密策略目标), MASK[N,69](合法掩码), V[N,4], NP[N]
"""
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader

ACTION_DIM = 69
FEATURE_DIM = 452
N_VALUE = 4


class AZDataset(Dataset):
    def __init__(self, paths: Iterable[Path]):
        F, PI, MASK, V, NP = [], [], [], [], []
        for p in paths:
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    d = json.loads(line)
                    F.append(d["f"])
                    pi = np.zeros(ACTION_DIM, dtype=np.float32)
                    for gi, pr in d["pi"]:
                        pi[gi] = pr
                    s = pi.sum()
                    if s > 0:
                        pi /= s  # 归一化(稀疏存了4位小数, 重新归一)
                    PI.append(pi)
                    m = np.zeros(ACTION_DIM, dtype=np.float32)
                    for gi in d["legal"]:
                        m[gi] = 1.0
                    MASK.append(m)
                    V.append(d["v"])
                    NP.append(d["n"])
        self.X = torch.tensor(np.asarray(F, dtype=np.float32))
        self.PI = torch.tensor(np.asarray(PI, dtype=np.float32))
        self.MASK = torch.tensor(np.asarray(MASK, dtype=np.float32))
        self.V = torch.tensor(np.asarray(V, dtype=np.float32))
        self.NP = torch.tensor(np.asarray(NP, dtype=np.int64))
        assert self.X.shape[1] == FEATURE_DIM, f"feature dim {self.X.shape}"

    def __len__(self):
        return self.X.shape[0]

    def __getitem__(self, i):
        return self.X[i], self.PI[i], self.MASK[i], self.V[i], self.NP[i]


def make_loaders(paths, batch_size=512, val_frac=0.1, pin_memory=False, seed=42):
    ds = AZDataset(paths)
    n = len(ds)
    g = torch.Generator().manual_seed(seed)
    idx = torch.randperm(n, generator=g)
    nval = max(1, int(n * val_frac))
    vidx, tidx = idx[:nval], idx[nval:]

    class Sub(Dataset):
        def __init__(s, base, sel): s.b = base; s.s = sel
        def __len__(s): return s.s.numel()
        def __getitem__(s, i): return s.b[s.s[i].item()]

    tl = DataLoader(Sub(ds, tidx), batch_size=batch_size, shuffle=True, num_workers=0, pin_memory=pin_memory)
    vl = DataLoader(Sub(ds, vidx), batch_size=batch_size, shuffle=False, num_workers=0, pin_memory=pin_memory)
    return tl, vl, ds


if __name__ == "__main__":
    import sys
    paths = [Path(p) for p in sys.argv[1:]]
    tl, vl, ds = make_loaders(paths, batch_size=256)
    print(f"loaded {len(ds)} samples")
    for X, PI, MASK, V, NP in tl:
        print(f"X={tuple(X.shape)} PI={tuple(PI.shape)} MASK={tuple(MASK.shape)} V={tuple(V.shape)}")
        print(f"  PI row sum (should ~1): {PI.sum(1)[:5].tolist()}")
        print(f"  MASK legal counts: {MASK.sum(1)[:5].tolist()}")
        print(f"  V range: [{V.min():.2f},{V.max():.2f}]  NP: {NP[:5].tolist()}")
        break
