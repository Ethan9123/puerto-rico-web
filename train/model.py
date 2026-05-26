"""PolicyValueNet — AlphaZero-style 网络头：策略 + 价值。

输入：446 维特征（来自 sim_features.js extractRich）
输出：
  - policy: 7 维 softmax logits（7 个角色之一）
  - value: 1 维 tanh 输出，[-1, 1]，目标是 (我得 - 对手平均) / 50 截断

设计偏小（< 200K 参数），3 层 MLP + 两个 head。
"""

import torch
import torch.nn as nn


FEATURE_DIM = 446
N_ROLES = 7


class PolicyValueNet(nn.Module):
    def __init__(self, feature_dim: int = FEATURE_DIM, hidden: int = 256, n_roles: int = N_ROLES):
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(feature_dim, hidden),
            nn.ReLU(inplace=True),
            nn.Linear(hidden, hidden),
            nn.ReLU(inplace=True),
            nn.Linear(hidden, hidden // 2),
            nn.ReLU(inplace=True),
        )
        self.policy_head = nn.Linear(hidden // 2, n_roles)
        self.value_head = nn.Sequential(
            nn.Linear(hidden // 2, 1),
            nn.Tanh(),
        )

    def forward(self, x: torch.Tensor):
        h = self.trunk(x)
        policy_logits = self.policy_head(h)
        value = self.value_head(h).squeeze(-1)
        return policy_logits, value

    def num_params(self) -> int:
        return sum(p.numel() for p in self.parameters())


if __name__ == "__main__":
    net = PolicyValueNet()
    print(net)
    print(f"params: {net.num_params():,}")
    x = torch.randn(8, FEATURE_DIM)
    pi, v = net(x)
    print(f"policy logits: {pi.shape}, value: {v.shape}")
