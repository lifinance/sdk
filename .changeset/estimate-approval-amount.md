---
"@lifi/sdk-provider-ethereum": minor
---

Honor an optional `estimate.approvalAmount` from the API: outside the Permit2 flow, it sets both the allowance a step requires on `approvalAddress` and the amount approved. Steps without it keep using `fromAmount`.
