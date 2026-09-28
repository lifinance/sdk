---
"@lifi/sdk": patch
---

Stop the balance check's retry loop once its 10 s timeout rejects, so a late balance read can no longer change `step.action.fromAmount`.
