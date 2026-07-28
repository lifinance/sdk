---
"@lifi/sdk-provider-ethereum": patch
---

Skip the Permit2 flow for signers that have on-chain code, fixing transactions that failed in mobile wallet browsers (Rabby, Backpack, Trust) where the connected account is an EIP-7702 delegated EOA. Uniswap Permit2 branches on `owner.code.length` and verifies code-bearing accounts via EIP-1271, so the plain ECDSA signature we produce was rejected by the delegate implementation and the transaction reverted before reaching the LI.FI diamond. Such accounts now fall back to the standard approve + execute path. Also fixes `getAccountCode` conflating "account has no code" with "RPC call failed" — viem's `getCode` normalizes empty code to `undefined`, which was suppressing native EIP-2612 permits for every plain EOA.
