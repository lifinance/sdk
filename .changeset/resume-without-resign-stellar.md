---
"@lifi/sdk-provider-stellar": patch
---

Mark a FAILED result, and a rejected submission that the network confirms it never applied, as final so "Try again" signs a new transaction; any other failure after signing is re-checked instead. The check that the network never applied a rejected submission gives each RPC 10 seconds to answer; a node that does not answer in time gives no information, as a failed request does, so a hung node cannot hold the route. The sign task refuses to sign while the step has an open transaction. It checks the action again after the wallet returns: if a stopped run's transaction merged into it while the prompt was open, the step fails with `TransactionConflict` and the new signature is neither stored nor submitted.
