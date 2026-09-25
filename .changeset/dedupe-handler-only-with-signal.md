---
'@lifi/sdk': patch
---

`withDedupe` adds its own handler to a shared request only once a caller with a signal joins. A request shared only by callers without a signal is still reported as an unhandled rejection when it fails and no caller handles it, as it was before `signal` support.
