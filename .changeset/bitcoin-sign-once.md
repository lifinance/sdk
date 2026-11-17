---
"@lifi/sdk-provider-bitcoin": patch
---

The SDK now asks the wallet only once to sign a PSBT. Before, bigmi retried the request after an error without a numeric code, for example a wallet cancel. A wallet client with the default `retryCount` then showed the prompt up to 4 times.
