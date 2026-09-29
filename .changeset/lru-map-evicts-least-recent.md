---
"@lifi/sdk": patch
---

`LruMap` now evicts the least recently used entry instead of the oldest one, and no longer grows past its size on iOS 18.
