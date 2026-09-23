---
'@lifi/sdk': patch
---

Keep concurrent `getTokens` and `getChains` requests from clients on different API bases apart. The dedupe ids now include `apiUrl`, so a client no longer receives another base's response when both ask the same query at the same time.
