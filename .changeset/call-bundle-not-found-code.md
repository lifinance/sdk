---
"@lifi/sdk": minor
---

`LiFiErrorCode` has a new code, `CallBundleNotFound` (1028). A step fails with this code when the wallet has no record of an EIP-5792 bundle. The SDK uses it only when it cannot prove that the wallet did not send the bundle. The outcome stays unknown: the action keeps the bundle id, and a resume waits for the bundle again and does not sign.
