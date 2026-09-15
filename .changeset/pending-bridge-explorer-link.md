---
'@lifi/sdk': patch
---

Give a pending bridge a link to follow. While waiting for the destination, the status poll only forwarded `bridgeExplorerLink`, which most bridges do not provide, so the receiving action had nothing to open for the whole wait. It now falls back to `lifiExplorerLink`, which every recorded transfer carries and which shows both legs.
