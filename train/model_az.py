"""全决策 AlphaZero 网络：ResNet 主干 + policy 头(统一动作词表) + value 向量头。

输入: AZ_FEATURE_DIM = 452 (446 局面特征 + 6 维决策类型 one-hot)
策略: AZ_ACTION_DIM = 69 (统一动作词表; 推理时按 legalMask 掩码)
价值: N_VALUE = 4 (Multiplayer AlphaZero, 每玩家一个; value[0]=当前决策者视角)

非空间问题用 dense 残差块(无 BN, 与 AlphaZero 非空间变体一致)。
"""

import torch
import torch.nn as nn

FEATURE_DIM = 452
ACTION_DIM = 69
N_VALUE = 4


class ResBlock(nn.Module):
    """dense 残差块: x -> relu(L2(relu(L1(x))) + x)"""
    def __init__(self, h: int):
        super().__init__()
        self.l1 = nn.Linear(h, h)
        self.l2 = nn.Linear(h, h)

    def forward(self, x):
        r = x
        x = torch.relu(self.l1(x))
        x = self.l2(x)
        return torch.relu(x + r)


class PolicyValueResNet(nn.Module):
    def __init__(self, feature_dim: int = FEATURE_DIM, hidden: int = 256,
                 blocks: int = 5, action_dim: int = ACTION_DIM, n_value: int = N_VALUE):
        super().__init__()
        self.stem = nn.Linear(feature_dim, hidden)
        self.blocks = nn.ModuleList([ResBlock(hidden) for _ in range(blocks)])
        self.policy_head = nn.Linear(hidden, action_dim)
        self.value_head = nn.Linear(hidden, n_value)

    def forward(self, x):
        h = torch.relu(self.stem(x))
        for b in self.blocks:
            h = b(h)
        policy_logits = self.policy_head(h)
        value = torch.tanh(self.value_head(h))
        return policy_logits, value

    def num_params(self):
        return sum(p.numel() for p in self.parameters())


if __name__ == "__main__":
    net = PolicyValueResNet()
    print(f"PolicyValueResNet: feature={FEATURE_DIM} action={ACTION_DIM} value={N_VALUE}")
    print(f"hidden=256 blocks=5  params={net.num_params():,}")
    x = torch.randn(2, FEATURE_DIM)
    p, v = net(x)
    print(f"policy out: {tuple(p.shape)}  value out: {tuple(v.shape)}")
