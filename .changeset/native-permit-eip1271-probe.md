---
"@lifi/sdk-provider-ethereum": patch
---

Fix native EIP-2612 permits failing for EIP-7702 delegated accounts. Tokens whose `permit` verifies through a `SignatureChecker` — Circle's USDC among them — branch on `owner.code.length` just as Permit2 does, so a code-bearing owner is verified via EIP-1271 and strict delegates reject the bare ECDSA signature with `EIP2612: invalid signature`. Code-bearing accounts are now probed with the same `isValidSignature` check already used for Permit2, rather than passed on the grounds that they can sign ECDSA.
