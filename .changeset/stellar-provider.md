---
"@lifi/sdk-provider-stellar": minor
"@lifi/sdk": minor
---

Add Stellar (STL) ecosystem support. Introduces the `@lifi/sdk-provider-stellar` package (address validation, Federation resolution, and SAC-based balance reads) and registers `ChainType.STL` in the SDK client's chain fetching so Stellar chains and RPC URLs load. Transaction execution is not yet implemented and will follow once backend transaction generation lands.
