---
"@lifi/sdk": patch
---

`parseUnits` and `formatUnits` are synced with viem 2.56.9: long fractions round exactly, and a negative or fractional `decimals` throws instead of giving a wrong amount. An input with no digit, such as `''`, still parses as `0n`.
