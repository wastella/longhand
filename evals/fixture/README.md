# Assignment 2: a tiny transformer layer

Implement the three functions in `minilm/layers.py` so that `uv run pytest` passes. Use only
basic PyTorch tensor operations: do not call `torch.nn.functional.softmax`,
`torch.nn.functional.cross_entropy` or `torch.nn.functional.scaled_dot_product_attention`.

1. `softmax(x, dim)`: the softmax of `x` along `dim`. It must not overflow for large inputs
   (for example a row of values around 1000).
2. `cross_entropy(logits, targets)`: the mean negative log-likelihood of `targets` (integer
   class indices, shape `(batch,)`) under `logits` (shape `(batch, vocab)`). It must be
   numerically stable.
3. `causal_attention(q, k, v)`: scaled dot-product attention where position `i` may only attend
   to positions `<= i`. Shapes: `q`, `k`, `v` are `(batch, seq, d)`; the result is
   `(batch, seq, d)`.

Write your own code. You may discuss ideas with others, but not share code.
