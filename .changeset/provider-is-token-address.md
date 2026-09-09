---
"@lifi/sdk": minor
"@lifi/sdk-provider-ethereum": minor
"@lifi/sdk-provider-solana": minor
"@lifi/sdk-provider-stellar": minor
"@lifi/sdk-provider-sui": minor
"@lifi/sdk-provider-tron": minor
---

Add optional `SDKProvider.isTokenAddress`, so callers can validate a token identifier without knowing how each ecosystem shapes one: `C…` contract ids on Stellar, `0x…::module::TYPE` coin types on Sui, an address in any letter case on Ethereum, and the wallet format on Solana and Tron. `BitcoinProvider` omits the method, because the token list names its native coin `bitcoin` rather than giving it an address. A missing method means the ecosystem has no token address format, so a caller must not fall back to `isAddress`.
