---
"@lifi/sdk": patch
---

`parseUnits` rounds long fractions exactly, and `parseUnits` and `formatUnits` throw on a negative or fractional `decimals` instead of giving a wrong amount. An input with no digit, such as `''`, still parses as `0n`.
