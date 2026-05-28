"""PolicyValueNet — AlphaZero-style 网络头：策略 + 价值。

输入：446 维特征（来自 sim_features.js extractRich）
输出：
  - policy: 7 维 softmax logits（7 个角色之一）
  - value: 1 维 tanh 输出，[-1, 1]，目标是 (我得 - 对手平均) / 50 截断

v2 架构（用于第一代 NN 不能超 L5 后重训）：
  - 4 层 MLP（更宽）+ Dropout 防过拟合
  - 446 → 512 → 512 → 256 → 128 → [policy(7), value(1)]
  - ~657K 参数（约 v1 三倍）
  - Dropout 0.3 / 0.3 / 0.2 / 0 (从输入到 head 逐渐减弱)
  - 推理时 Dropout 自动 disabled (model.eval())
  - 导出时 Dropout 不写入 JSON (无参数，sim_nn.js 不感知)
"""

import torch
import torch.nn as nn


FEATURE_DIM = 446
N_ROLES = 7
N_VALUE = 4  # Multiplayer AlphaZero: value 是向量，每个玩家一个（perspective-ordered）。
            # 推理只用 index 0（视角玩家），其余作为辅助多任务信号帮 trunk 学更好表征。
            # 固定 4（训练数据均 4 人局）；3/5 人局推理时仍只读 [0]，多余输出无害。


class PolicyValueNet(nn.Module):
    def __init__(self, feature_dim: int = FEATURE_DIM, n_roles: int = N_ROLES,
                 n_value: int = N_VALUE,
                 hidden_dims=(512, 512, 256, 128), dropout=(0.3, 0.3, 0.2, 0.0)):
        super().__init__()
        assert len(hidden_dims) == len(dropout), "hidden_dims/dropout length mismatch"
        layers = []
        prev = feature_dim
        for h, d in zip(hidden_dims, dropout):
            layers.append(nn.Linear(prev, h))
            layers.append(nn.ReLU(inplace=True))
            if d > 0:
                layers.append(nn.Dropout(d))
            prev = h
        self.trunk = nn.Sequential(*layers)
        self.policy_head = nn.Linear(prev, n_roles)
        # 价值向量头：n_value 个输出（每玩家一个，[-1,1]）
        self.value_head = nn.Sequential(
            nn.Linear(prev, n_value),
            nn.Tanh(),
        )

    def forward(self, x: torch.Tensor):
        h = self.trunk(x)
        policy_logits = self.policy_head(h)
        value = self.value_head(h)  # [batch, n_value]，不再 squeeze
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
