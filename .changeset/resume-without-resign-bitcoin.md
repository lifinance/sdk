---
"@lifi/sdk-provider-bitcoin": patch
---

Mark a cancelled replacement as final so "Try again" signs a new transaction; any other failure after broadcast is re-checked instead. The sign task refuses to sign while the step has an open transaction.
