---
"@lifi/sdk-provider-sui": patch
---

Resume a signed or executed transaction instead of signing again. Signing and execution are split (same `signer.signTransaction` call), the signed bytes are stored in `txHex` before execution, and the digest is stored right after it, also for a failed execution. Stored bytes are re-executed only within two minutes of signing. A stored zkLogin signature cannot be verified offline, so such a route is never resent or declared dropped and stays unknown (the user deletes the route).
