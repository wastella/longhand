import torch

from minilm.layers import causal_attention, cross_entropy, softmax


def test_softmax_is_stable_for_large_inputs():
    x = torch.tensor([[1000.0, 1001.0, 1002.0]])
    out = softmax(x, dim=-1)
    assert torch.isfinite(out).all()
    assert torch.allclose(out.sum(dim=-1), torch.ones(1))


def test_cross_entropy_matches_by_hand():
    logits = torch.tensor([[2.0, 0.0, 0.0]])
    targets = torch.tensor([0])
    expected = -torch.log(torch.exp(torch.tensor(2.0)) / (torch.exp(torch.tensor(2.0)) + 2))
    assert torch.allclose(cross_entropy(logits, targets), expected)


def test_causal_attention_ignores_the_future():
    torch.manual_seed(0)
    q, k, v = (torch.randn(1, 4, 8) for _ in range(3))
    first = causal_attention(q, k, v)[:, 0]
    v[:, 1:] = 0
    assert torch.allclose(causal_attention(q, k, v)[:, 0], first)
