---
"@lifi/sdk-provider-solana": patch
---

Jito bundles now confirm by the signatures of their transactions (`getSignatureStatuses`) on every read RPC. Only the RPCs that send a bundle need Jito support. The SDK no longer reads the `sendBundle` answer, so a sender that answers with the transaction signatures instead of a bundle ID no longer makes the step fail with `RpcUnavailable` (1027). The bundle confirmation errors now say "Solana RPC" instead of "Jito RPC".
