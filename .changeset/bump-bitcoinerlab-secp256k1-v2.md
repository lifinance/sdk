---
'@lifi/sdk-provider-bitcoin': patch
---

Bump `@bitcoinerlab/secp256k1` from 1.2.0 to 2.0.0.

v2.0.0 moves to `@noble/curves` 2.3.0 and raises its own Node floor to 20.19; its API
surface is unchanged. This package uses it in one place, passed to `bitcoinjs-lib`'s
`initEccLib` for Taproot signing. It still passes that function's BIP340/341 verification
vectors for `isXOnlyPoint` and `xOnlyPointAddTweak`, so P2TR behavior is unchanged.
