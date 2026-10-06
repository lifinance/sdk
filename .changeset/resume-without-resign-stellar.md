---
"@lifi/sdk-provider-stellar": patch
---

Mark a FAILED result, and a rejected submission that the network confirms it never applied, as final so "Try again" signs a new transaction; any other failure after signing is re-checked instead. The sign task refuses to sign while the step has an open transaction. It checks the action again after the wallet returns: if a stopped run's transaction merged into it while the prompt was open, the step fails with `TransactionConflict` and the new signature is neither stored nor submitted.
