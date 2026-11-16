---
"@lifi/sdk": minor
---

Update `@lifi/types` to 19.1.0.

`@lifi/sdk` re-exports `@lifi/types`. This release therefore removes the deprecated chains from `ChainId` and `ChainKey`: Moonbeam (`MOO`, 1284), Boba (`BOB`, 288), BOB (`BOC`, 60808), opBNB (`OPB`, 204), Lens (`LNS`, 232), Blast (`BLS`, 81457), Fusion (`FSN`, 32659), Gravity (`GRA`, 1625) and Lisk (`LSK`, 1135). It also removes `CoinKey.GLMR`, `CoinKey.FSN`, `CoinKey.USDB`, `CoinKey.GHO`, `CoinKey.WGHO` and `CoinKey.WG`. If your TypeScript code names one of these members, remove that code.

The release also adds the `EstimateHop` type and the optional `Estimate.hops` field.
