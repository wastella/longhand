"""Layers for the tiny transformer. The student writes these."""

import torch


def softmax(x: torch.Tensor, dim: int) -> torch.Tensor:
    exps = torch.exp(x)
    return exps / exps.sum(dim=dim, keepdim=True)


def cross_entropy(logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
    raise NotImplementedError


def causal_attention(q: torch.Tensor, k: torch.Tensor, v: torch.Tensor) -> torch.Tensor:
    raise NotImplementedError
