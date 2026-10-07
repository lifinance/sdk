---
"@lifi/sdk-provider-bitcoin": patch
---

Require `@bigmi/core` 0.9.3, which fixes `waitForTransaction`. A wait whose block budget ran out no longer stops the shared block watcher, so a resumed Bitcoin route, and every later wait on the same client, can no longer wait forever. Finished waits release their observers and timers. A transaction that a lagging node still reports as unconfirmed is no longer reported as its own replacement, and a replacement is always compared with the awaited transaction, so a fee bump of a cancel is still reported as cancelled.
