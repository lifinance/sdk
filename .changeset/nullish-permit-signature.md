---
"@lifi/sdk-provider-ethereum": patch
---

Handle wallets that resolve `signTypedData` with a nullish or empty signature instead of rejecting (#424). The EIP-2612 native permit flow now falls back to the Permit2/standard approval path instead of crashing later with `TypeError: Cannot read properties of null (reading 'slice')`, and the other signing flows (API permits, relayed intents, Permit2 messages) throw a descriptive `SignatureRejected` error. Permit lookups also ignore stored entries without a usable signature.
