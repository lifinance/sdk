---
"@lifi/sdk-provider-ethereum": patch
---

Fix `getAccountCode` treating a code-less account as a failed RPC lookup (viem's `getCode` returns `undefined` for both), suppressing native EIP-2612 permits for every plain EOA. Permit-supporting tokens now route through `callDiamondWithEIP2612Signature` rather than `callDiamondWithPermit2`, skipping the `approve(permit2)`.

Fix Permit2 reverting for EIP-7702 delegated accounts. Permit2 verifies code-bearing signers via EIP-1271, where acceptance is implementation-specific, so the signer is now probed with a read-only `isValidSignature` call — only accounts that reject it fall back to approve + execute.
