---
'@lifi/sdk-provider-stellar': patch
---

Reject prepared Stellar envelopes whose time bounds have already expired before opening the wallet. Check the final transaction payload after request hooks, including fee-bump inner transactions, so resuming can fetch a fresh envelope without signing stale data.
