---
'@lifi/sdk-provider-ethereum': patch
---

Keep one wallet poll per call bundle with every viem version. Since viem 2.57.5 a wait for a call bundle shares its poll only when it passes the same `status` function. The SDK passed a new function on each call. Two waits for one bundle then polled the wallet twice, and the second wait could report a final `SignatureRejected` for a bundle that it did not start. Now all waits for one bundle pass the same function.
