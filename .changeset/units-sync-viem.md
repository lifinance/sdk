---
"@lifi/sdk": patch
---

`parseUnits` and `formatUnits` are synced with viem 2.56.9: long fractions round exactly, `parseUnits` rejects input without a digit (`''`, `'-'`, `'.'`), and both reject a negative or fractional `decimals`.
