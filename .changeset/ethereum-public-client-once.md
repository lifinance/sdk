---
'@lifi/sdk-provider-ethereum': patch
---

Concurrent first calls for a chain now share one public client instead of each building one. With `fallbackTransportConfig.rank` set, each extra client also ran its own transport ranking loop that never stopped.
