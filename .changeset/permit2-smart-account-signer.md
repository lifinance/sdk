---
"@lifi/sdk-provider-ethereum": patch
---

Fix `getAccountCode` conflating "account has no code" with "RPC call failed": viem's `getCode` normalizes empty code to `undefined`, so every plain EOA looked like a failed lookup and native EIP-2612 permits were suppressed for all of them. Re-enabling those permits changes the route that actually runs for permit-supporting tokens — the Permit2 proxy entrypoint moves from `callDiamondWithPermit2` to `callDiamondWithEIP2612Signature`, and the one-time `approve(permit2)` is no longer sent.

Skip the Permit2 flow for signers that have on-chain code, fixing transactions that failed in mobile wallet browsers (Rabby, Backpack, Trust) where the connected account is an EIP-7702 delegated EOA. Uniswap Permit2 branches on `owner.code.length` and verifies code-bearing accounts via EIP-1271, so the plain ECDSA signature we produce was rejected by the delegate implementation and the transaction reverted before reaching the LI.FI diamond. Those accounts now take the native EIP-2612 permit path when the source token supports it — verified token-side with `ecrecover`, where a 7702 signature is valid — and fall back to approve + execute otherwise.
