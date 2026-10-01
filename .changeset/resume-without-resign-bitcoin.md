---
"@lifi/sdk-provider-bitcoin": patch
---

Mark a cancelled replacement as final so "Try again" signs a new transaction; any other failure after broadcast is re-checked instead. The sign task refuses to sign while the step has an open transaction. The signed transaction (`txHex`, `txHash`, `signedAt`) is now stored before it is sent, so a reload during the send resumes it instead of signing again. A first send that every node refuses for a reason all nodes share (and that no node knows by txid) clears it, so "Try again" signs anew; any other send failure is re-checked, and the stored transaction is resent on a resume (a reload or "Try again") only within two minutes of signing.
