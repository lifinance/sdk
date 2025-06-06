# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [3.7.9](https://github.com/lifinance/sdk/compare/v3.7.7...v3.7.9) (2025-06-06)


### Bug Fixes

* increase timeout for batch transactions ([#266](https://github.com/lifinance/sdk/issues/266)) ([5fa974d](https://github.com/lifinance/sdk/commit/5fa974d64a7118550ff3ff1d41d9a2e8990a3691))

### [3.7.8](https://github.com/lifinance/sdk/compare/v3.7.7...v3.7.8) (2025-06-06)


### Bug Fixes

* increase timeout ([ae19b37](https://github.com/lifinance/sdk/commit/ae19b37123b6c51eadd8dac16bd60f512f6c8405))

### [3.7.7](https://github.com/lifinance/sdk/compare/v3.7.6...v3.7.7) (2025-05-30)

### [3.7.6](https://github.com/lifinance/sdk/compare/v3.7.5...v3.7.6) (2025-05-30)


### Bug Fixes

* add support for token 2022 programs ([#264](https://github.com/lifinance/sdk/issues/264)) ([584439f](https://github.com/lifinance/sdk/commit/584439fe6c924e11148ce32dbf0de42a86cdfa33))

### [3.7.5](https://github.com/lifinance/sdk/compare/v3.7.4...v3.7.5) (2025-05-29)


### Bug Fixes

* error handling should include nested error causes ([e54fc73](https://github.com/lifinance/sdk/commit/e54fc73b08f54e43e9162a83fddca265a801aadb))

### [3.7.4](https://github.com/lifinance/sdk/compare/v3.7.3...v3.7.4) (2025-05-29)


### Bug Fixes

* error class names can't be minified correctly ([65662d3](https://github.com/lifinance/sdk/commit/65662d3de0e0cb319631a9eae9615f18f0495ddd))

### [3.7.3](https://github.com/lifinance/sdk/compare/v3.7.2...v3.7.3) (2025-05-28)


### Bug Fixes

* add public client fallback for wallet client failures on EVM RPC calls ([#261](https://github.com/lifinance/sdk/issues/261)) ([df917b2](https://github.com/lifinance/sdk/commit/df917b2b4b0e307a27ae74ebc7c921104fbb13e1))
* improve 7702 upgrade rejection error handling ([#263](https://github.com/lifinance/sdk/issues/263)) ([3adf253](https://github.com/lifinance/sdk/commit/3adf2530bd93c4ff648efb6de7a3d71e1e20820c))

### [3.7.2](https://github.com/lifinance/sdk/compare/v3.7.1...v3.7.2) (2025-05-21)


### Bug Fixes

* ensure safe access to error cause when handling wallet upgrade rejections ([#260](https://github.com/lifinance/sdk/issues/260)) ([426bd15](https://github.com/lifinance/sdk/commit/426bd1589676b3d388813171932e8de368d4668c))

### [3.7.1](https://github.com/lifinance/sdk/compare/v3.7.0...v3.7.1) (2025-05-20)


### Bug Fixes

* handle wallet 7702 upgrade rejections more gracefully ([#259](https://github.com/lifinance/sdk/issues/259)) ([f1df53a](https://github.com/lifinance/sdk/commit/f1df53a8e42ec581a416b3d111214702817dc200))

## [3.7.0](https://github.com/lifinance/sdk/compare/v3.6.16...v3.7.0) (2025-05-15)


### Features

* add Sui support ([#257](https://github.com/lifinance/sdk/issues/257)) ([882a0a5](https://github.com/lifinance/sdk/commit/882a0a5b89cc6755b874ee7620cb5bf91ecdcea7))
* remove Bigmi viem dependencies ([#252](https://github.com/lifinance/sdk/issues/252)) ([998d595](https://github.com/lifinance/sdk/commit/998d59571cc350d9bf58ef1ea9b939f4854df3ac))

### [3.6.16](https://github.com/lifinance/sdk/compare/v3.6.15...v3.6.16) (2025-05-14)


### Bug Fixes

* refine allowance checks for direct transfers ([dbcd640](https://github.com/lifinance/sdk/commit/dbcd640bb5b195c7b582c1b6921378cb470f2918))

### [3.6.15](https://github.com/lifinance/sdk/compare/v3.6.14...v3.6.15) (2025-05-14)


### Bug Fixes

* skip allowance check for direct transfers ([#258](https://github.com/lifinance/sdk/issues/258)) ([2ecf469](https://github.com/lifinance/sdk/commit/2ecf469dad360a66cc962c9948821bd1da13c687))

### [3.6.14](https://github.com/lifinance/sdk/compare/v3.6.13...v3.6.14) (2025-05-12)


### Bug Fixes

* add timeout for getCapabilities call ([#256](https://github.com/lifinance/sdk/issues/256)) ([ee07c25](https://github.com/lifinance/sdk/commit/ee07c254a2bf9e640d66f07990d876450707b306))

### [3.6.13](https://github.com/lifinance/sdk/compare/v3.6.12...v3.6.13) (2025-05-06)


### Bug Fixes

* add new error codes ([#250](https://github.com/lifinance/sdk/issues/250)) ([907bba7](https://github.com/lifinance/sdk/commit/907bba76f45e410c44de2d76ac6f92c5cef00de5))

### [3.6.12](https://github.com/lifinance/sdk/compare/v3.6.11...v3.6.12) (2025-05-05)


### Bug Fixes

* disable message signing for custom steps ([#253](https://github.com/lifinance/sdk/issues/253)) ([6a90712](https://github.com/lifinance/sdk/commit/6a90712b6b7289fd8eac71cd62b101fdf4386d2c))

### [3.6.11](https://github.com/lifinance/sdk/compare/v3.6.10...v3.6.11) (2025-04-29)


### Bug Fixes

* let the wallet estimate the gas in case of failure ([123860e](https://github.com/lifinance/sdk/commit/123860ebc44b5b35a2c8b65b3f4939d758252486))

### [3.6.10](https://github.com/lifinance/sdk/compare/v3.6.9...v3.6.10) (2025-04-29)


### Bug Fixes

* take old gas estimate if we failed to provide a new one ([#251](https://github.com/lifinance/sdk/issues/251)) ([d4c17c1](https://github.com/lifinance/sdk/commit/d4c17c1d58177494e8d606f07220b6459e0fa930))

### [3.6.9](https://github.com/lifinance/sdk/compare/v3.6.8...v3.6.9) (2025-04-28)


### Bug Fixes

* **viem:** make EIP-5792 stable ([310a4cc](https://github.com/lifinance/sdk/commit/310a4cc2b613044f68df9d89f478b5fc5644b006))

### [3.6.8](https://github.com/lifinance/sdk/compare/v3.6.7...v3.6.8) (2025-04-15)


### Bug Fixes

* add more timestamps for processes ([#248](https://github.com/lifinance/sdk/issues/248)) ([90a7715](https://github.com/lifinance/sdk/commit/90a77159e55556c08b7cb9ba3c04cc0465522383))
* bump EIP-5792 specs ([#249](https://github.com/lifinance/sdk/issues/249)) ([3742296](https://github.com/lifinance/sdk/commit/3742296f35d72996dc497a4f51d3242fe77cdc60))

### [3.6.7](https://github.com/lifinance/sdk/compare/v3.6.6...v3.6.7) (2025-04-07)


### Bug Fixes

* improve error handling for transaction rejection in Safe ([#246](https://github.com/lifinance/sdk/issues/246)) ([e22f7ab](https://github.com/lifinance/sdk/commit/e22f7ab5e7015bc881504f7c1388ce20290e440d))
* sync to latest EIP-5792 spec ([#247](https://github.com/lifinance/sdk/issues/247)) ([fa5578f](https://github.com/lifinance/sdk/commit/fa5578f66e9256b831cacd75393fb20e8d875191))

### [3.6.6](https://github.com/lifinance/sdk/compare/v3.6.5...v3.6.6) (2025-04-04)


### Bug Fixes

* add flag to disable message signing ([#245](https://github.com/lifinance/sdk/issues/245)) ([c379b84](https://github.com/lifinance/sdk/commit/c379b845f9fdab7e7295c779b2425dbe67f5708a))

### [3.6.5](https://github.com/lifinance/sdk/compare/v3.6.4...v3.6.5) (2025-04-01)


### Bug Fixes

* improve replaced transactions handling ([#244](https://github.com/lifinance/sdk/issues/244)) ([d5e7829](https://github.com/lifinance/sdk/commit/d5e78299f7041370bd0f27d74ac8304c93ec75e7))

### [3.6.4](https://github.com/lifinance/sdk/compare/v3.6.3...v3.6.4) (2025-04-01)


### Bug Fixes

* update sendCalls to support EIP-5792 with backward compatibility ([#243](https://github.com/lifinance/sdk/issues/243)) ([95f6575](https://github.com/lifinance/sdk/commit/95f6575c13036d8c4187c3fabd5a195689670be3))

### [3.6.3](https://github.com/lifinance/sdk/compare/v3.6.2...v3.6.3) (2025-04-01)


### Bug Fixes

* allow order permit type ([6c6efd4](https://github.com/lifinance/sdk/commit/6c6efd4412357cc6e21f87c18385e4398152c13a))
* make permit message serializable ([23ed44d](https://github.com/lifinance/sdk/commit/23ed44d110e33e0578c7a6873b6fe6e595e24052))

### [3.6.2](https://github.com/lifinance/sdk/compare/v3.6.1...v3.6.2) (2025-03-13)


### Bug Fixes

* update permit handling with standardized EIP-712 typed data ([#238](https://github.com/lifinance/sdk/issues/238)) ([57bbd8e](https://github.com/lifinance/sdk/commit/57bbd8e9bcdbd620ae509867beac9f2dff764a2e))

### [3.6.1](https://github.com/lifinance/sdk/compare/v3.6.0...v3.6.1) (2025-03-11)


### Bug Fixes

* **execution:** add started and done timestamps ([#237](https://github.com/lifinance/sdk/issues/237)) ([4b28dc7](https://github.com/lifinance/sdk/commit/4b28dc7fb939cc12b5c9f67a5e6e63c15ade9429))

## [3.6.0](https://github.com/lifinance/sdk/compare/v3.5.4...v3.6.0) (2025-03-10)


### Features

* add Permit (ERC-2612), Permit2 and Wallet Call API (EIP-5792) support ([#224](https://github.com/lifinance/sdk/issues/224)) ([3278265](https://github.com/lifinance/sdk/commit/32782656dbc92bb0891e96fad3e426ed2294cac9))


### Bug Fixes

* improve bitcoin public client handling ([#235](https://github.com/lifinance/sdk/issues/235)) ([06a2d80](https://github.com/lifinance/sdk/commit/06a2d804cce77de171bd4da08dda793516e4ef51))
* **status-manager:** set startedAt for started processes ([#236](https://github.com/lifinance/sdk/issues/236)) ([edac285](https://github.com/lifinance/sdk/commit/edac285a22692092fc35c3778cc2243e19fbf186))

### [3.5.4](https://github.com/lifinance/sdk/compare/v3.5.3...v3.5.4) (2025-02-16)

### [3.5.3](https://github.com/lifinance/sdk/compare/v3.5.2...v3.5.3) (2025-02-04)


### Bug Fixes

* fixed evm address compare check ([#234](https://github.com/lifinance/sdk/issues/234)) ([6cccf2d](https://github.com/lifinance/sdk/commit/6cccf2d3b60c66e426f0469336a6c461a3c5e69e))

### [3.5.2](https://github.com/lifinance/sdk/compare/v3.5.1...v3.5.2) (2025-01-14)


### Bug Fixes

* preserve transaction hash when creating new process ([#232](https://github.com/lifinance/sdk/issues/232)) ([7e8c829](https://github.com/lifinance/sdk/commit/7e8c829af53ba9e9333333df54b3a67e44702c4c))

### [3.5.1](https://github.com/lifinance/sdk/compare/v3.5.0...v3.5.1) (2025-01-09)


### Bug Fixes

* add bugs field to published package.json ([67c6685](https://github.com/lifinance/sdk/commit/67c668576ceb0999d73c63be9a8bc753b7ebcc46))

## [3.5.0](https://github.com/lifinance/sdk/compare/v3.4.4...v3.5.0) (2025-01-02)


### Features

* improve transaction execution for smart account clients ([#222](https://github.com/lifinance/sdk/issues/222)) ([2580dbe](https://github.com/lifinance/sdk/commit/2580dbe6ce6e8a9634c22c84dd75de27b4a23f2f))

### [3.4.4](https://github.com/lifinance/sdk/compare/v3.4.3...v3.4.4) (2024-12-20)

### [3.4.3](https://github.com/lifinance/sdk/compare/v3.4.2...v3.4.3) (2024-12-13)

### [3.4.2](https://github.com/lifinance/sdk/compare/v3.4.1...v3.4.2) (2024-12-05)

### [3.4.1](https://github.com/lifinance/sdk/compare/v3.4.0...v3.4.1) (2024-10-31)


### Bug Fixes

* export more provider types ([24a0e80](https://github.com/lifinance/sdk/commit/24a0e8008fc05a74b6ad613e01d919e7cd768494))

## [3.4.0](https://github.com/lifinance/sdk/compare/v3.3.1...v3.4.0) (2024-10-28)


### Features

* add support for multiple Solana RPCs ([#220](https://github.com/lifinance/sdk/issues/220)) ([08b7faa](https://github.com/lifinance/sdk/commit/08b7faa5733b818cdfdc5693580f6018300e5c22))

### [3.3.1](https://github.com/lifinance/sdk/compare/v3.3.0...v3.3.1) (2024-10-23)


### Bug Fixes

* remove console.log ([99a0c1c](https://github.com/lifinance/sdk/commit/99a0c1c566bbb2ac9f750b4700882b9fec3ce448))

## [3.3.0](https://github.com/lifinance/sdk/compare/v3.2.3...v3.3.0) (2024-10-18)


### Features

* add Bitcoin/UTXO support ([#218](https://github.com/lifinance/sdk/issues/218)) ([379c342](https://github.com/lifinance/sdk/commit/379c342eb4e5a2f65ae02fa2a2037e31a92a1e6e))

### [3.2.3](https://github.com/lifinance/sdk/compare/v3.2.2...v3.2.3) (2024-09-17)


### Bug Fixes

* add process chain id ([#217](https://github.com/lifinance/sdk/issues/217)) ([16c95dc](https://github.com/lifinance/sdk/commit/16c95dcb9323d5eeae707090412200f5eb9b80e5))

### [3.2.2](https://github.com/lifinance/sdk/compare/v3.2.1...v3.2.2) (2024-09-16)


### Bug Fixes

* getContractCallsQuote validation ([#216](https://github.com/lifinance/sdk/issues/216)) ([7cf5027](https://github.com/lifinance/sdk/commit/7cf5027dc4b2f107278009e08181fa3fef6bc1d2))

### [3.2.1](https://github.com/lifinance/sdk/compare/v3.2.0...v3.2.1) (2024-09-12)

## [3.2.0](https://github.com/lifinance/sdk/compare/v3.1.5...v3.2.0) (2024-09-10)


### Features

* replace wallet and public clients with base client ([#215](https://github.com/lifinance/sdk/issues/215)) ([76122c6](https://github.com/lifinance/sdk/commit/76122c6993130a8d2273ff37bda3ee2344fd965a))

### [3.1.5](https://github.com/lifinance/sdk/compare/v3.1.3...v3.1.5) (2024-08-09)


### Bug Fixes

* add process chain id ([#217](https://github.com/lifinance/sdk/issues/217)) ([16c95dc](https://github.com/lifinance/sdk/commit/16c95dcb9323d5eeae707090412200f5eb9b80e5))

### [3.2.2](https://github.com/lifinance/sdk/compare/v3.2.1...v3.2.2) (2024-09-16)

### Bug Fixes

- getContractCallsQuote validation ([#216](https://github.com/lifinance/sdk/issues/216)) ([7cf5027](https://github.com/lifinance/sdk/commit/7cf5027dc4b2f107278009e08181fa3fef6bc1d2))

### [3.2.1](https://github.com/lifinance/sdk/compare/v3.2.0...v3.2.1) (2024-09-12)

## [3.2.0](https://github.com/lifinance/sdk/compare/v3.1.5...v3.2.0) (2024-09-10)

### Features

- replace wallet and public clients with base client ([#215](https://github.com/lifinance/sdk/issues/215)) ([76122c6](https://github.com/lifinance/sdk/commit/76122c6993130a8d2273ff37bda3ee2344fd965a))

### [3.1.5](https://github.com/lifinance/sdk/compare/v3.1.3...v3.1.5) (2024-08-09)

### Bug Fixes

- add fallback for wallet client account address ([#213](https://github.com/lifinance/sdk/issues/213)) ([a1ea259](https://github.com/lifinance/sdk/commit/a1ea259b95a79fbce56e36bc077e87c53a2e4766))

### [3.1.4](https://github.com/lifinance/sdk/compare/v3.1.3...v3.1.4) (2024-08-09)

### [3.1.3](https://github.com/lifinance/sdk/compare/v3.1.2...v3.1.3) (2024-07-24)

### Bug Fixes

- should not send execution object to the API ([714a128](https://github.com/lifinance/sdk/commit/714a12851ff5845b394fbae4656168a817f3fdcc))

### [3.1.2](https://github.com/lifinance/sdk/compare/v3.1.1...v3.1.2) (2024-07-22)

### Bug Fixes

- remove response message prop name from http error message ([#202](https://github.com/lifinance/sdk/issues/202)) ([6ddd1ad](https://github.com/lifinance/sdk/commit/6ddd1ad150ea5209d52d1dca52666e8ec1ed4ef4))

### [3.1.1](https://github.com/lifinance/sdk/compare/v3.1.0...v3.1.1) (2024-07-22)

### Bug Fixes

- better handle blockheight exceeded error ([2eb6158](https://github.com/lifinance/sdk/commit/2eb61587bf9453c85c22e5650a1b6ffed8f772c0))
- reduce http transport batch size ([b89343a](https://github.com/lifinance/sdk/commit/b89343ab332bd9a549890820281e91a7fa144bc8))

## [3.1.0](https://github.com/lifinance/sdk/compare/v3.1.0-beta.0...v3.1.0) (2024-07-19)

### Features

- deprecate execution options ([f4c9fff](https://github.com/lifinance/sdk/commit/f4c9fffedfcbced4c72007d7472e6da7f3f88d0f))

### [3.0.1](https://github.com/lifinance/sdk/compare/v3.0.0...v3.0.1) (2024-07-15)

### Bug Fixes

- filter existing RPC urls ([#196](https://github.com/lifinance/sdk/issues/196)) ([1432f87](https://github.com/lifinance/sdk/commit/1432f8770524b63ee88fc73521a1986082b267e4))
- improve transaction receipt polling ([#195](https://github.com/lifinance/sdk/issues/195)) ([90c23da](https://github.com/lifinance/sdk/commit/90c23da661d20853b261cf4e301d40975662b0b6))

## [3.0.0](https://github.com/lifinance/sdk/compare/v3.0.0-beta.2...v3.0.0) (2024-06-26)

## [2.5.0](https://github.com/lifinance/sdk/compare/v2.4.3...v2.5.0) (2023-11-01)

### Features

- upgrade to msw v2 ([f1cde15](https://github.com/lifinance/sdk/commit/f1cde15326cf10e9ae4c39b08603fb181fdbacd2))

### Bug Fixes

- improve error handling during LiFi initialization ([#171](https://github.com/lifinance/sdk/issues/171)) ([0756631](https://github.com/lifinance/sdk/commit/075663180b50383a8672bb987dd841fd4ac3c43b))

### [2.4.3](https://github.com/lifinance/sdk/compare/v2.4.1...v2.4.3) (2023-10-03)

### Bug Fixes

- wallet analytics API request changes ([#167](https://github.com/lifinance/sdk/issues/167)) ([e4a145d](https://github.com/lifinance/sdk/commit/e4a145de96ef986b8ea52134cfb095d4a5fc5f44))

### [2.4.2](https://github.com/lifinance/sdk/compare/v2.4.1...v2.4.2) (2023-10-03)

### Bug Fixes

- wallet analytics API request changes ([#167](https://github.com/lifinance/sdk/issues/167)) ([e4a145d](https://github.com/lifinance/sdk/commit/e4a145de96ef986b8ea52134cfb095d4a5fc5f44))

### [2.4.1](https://github.com/lifinance/sdk/compare/v2.4.0...v2.4.1) (2023-09-25)

### Bug Fixes

- publish workflow ([c005f0a](https://github.com/lifinance/sdk/commit/c005f0a56a4df56ceceef90b4a220964094b1056))
- type fix for transaction history response ([#166](https://github.com/lifinance/sdk/issues/166)) ([ee954b8](https://github.com/lifinance/sdk/commit/ee954b875f8a865b9504dd714f5dceb36b862d73))

## [2.4.0](https://github.com/lifinance/sdk/compare/v2.3.1...v2.4.0) (2023-09-20)

### Features

- add multi-contract calls API endpoint ([#164](https://github.com/lifinance/sdk/issues/164)) ([bb721cb](https://github.com/lifinance/sdk/commit/bb721cb658714e8a8acf55aa854e72a07880b252))

### [2.3.1](https://github.com/lifinance/sdk/compare/v2.3.0...v2.3.1) (2023-09-04)

### Bug Fixes

- remove updateTransactionRequestHook from allowance read call ([#162](https://github.com/lifinance/sdk/issues/162)) ([79ea63b](https://github.com/lifinance/sdk/commit/79ea63b4745ec6ea54c7d7b1c6841bed93b224a2))

## [2.3.0](https://github.com/lifinance/sdk/compare/v2.2.3...v2.3.0) (2023-08-17)

### Features

- allow to pass api key to all requests ([#159](https://github.com/lifinance/sdk/issues/159)) ([e9dc0fe](https://github.com/lifinance/sdk/commit/e9dc0fee146a76805cec7ab3bcf48b02a2c3febe))

### [2.2.3](https://github.com/lifinance/sdk/compare/v2.2.2...v2.2.3) (2023-08-04)

### Bug Fixes

- **getConnections:** get connections endpoint error ([#160](https://github.com/lifinance/sdk/issues/160)) ([53ad776](https://github.com/lifinance/sdk/commit/53ad7761c0e95101f4bf0a8b16f55d4187ce2a45))

### [2.2.2](https://github.com/lifinance/sdk/compare/v2.2.1...v2.2.2) (2023-08-01)

### Bug Fixes

- integrator string is not applied in quote requests ([f76dbe6](https://github.com/lifinance/sdk/commit/f76dbe6d29e0bda6d578c9092f0b2d40e8ac1231))

### [2.2.1](https://github.com/lifinance/sdk/compare/v2.2.0...v2.2.1) (2023-07-24)

### Bug Fixes

- fixed types for multisig config ([#156](https://github.com/lifinance/sdk/issues/156)) ([9a28de6](https://github.com/lifinance/sdk/commit/9a28de61026ab6804ee87932d609bf9897fff391))
- parsing params in available connections api request ([#155](https://github.com/lifinance/sdk/issues/155)) ([177723a](https://github.com/lifinance/sdk/commit/177723a4eaa8007c4f3e5348bb4e60977392b786))

## [2.2.0](https://github.com/lifinance/sdk/compare/v2.1.1...v2.2.0) (2023-07-11)

### Features

- multisig wallets support ([#150](https://github.com/lifinance/sdk/issues/150)) ([3825d99](https://github.com/lifinance/sdk/commit/3825d99de85032b6b4334552b1311ecefeca8001))

### Bug Fixes

- deprecate possibilities endpoint ([80e6e98](https://github.com/lifinance/sdk/commit/80e6e98630edde2eb33f591d50cc746ed78fb6de))

### [2.1.3-beta.0](https://github.com/lifinance/sdk/compare/v2.1.1...v2.1.3-beta.0) (2023-07-04)

### [2.1.2](https://github.com/lifinance/sdk/compare/v2.1.2-beta.1...v2.1.2) (2023-07-04)

### [2.1.2-beta.1](https://github.com/lifinance/sdk/compare/v2.1.2-beta.0...v2.1.2-beta.1) (2023-07-04)

### [2.1.2-beta.0](https://github.com/lifinance/sdk/compare/v2.1.1...v2.1.2-beta.0) (2023-07-04)

### [2.1.1](https://github.com/lifinance/sdk/compare/v2.1.0...v2.1.1) (2023-07-03)

### Bug Fixes

- added gasLimit as BigNumber ([#151](https://github.com/lifinance/sdk/issues/151)) ([42dab98](https://github.com/lifinance/sdk/commit/42dab98f3a6574c8212c2f4af920eda1c8e5e4fd))
- convert to BigNumberish gas values ([#152](https://github.com/lifinance/sdk/issues/152)) ([a8cc17d](https://github.com/lifinance/sdk/commit/a8cc17d0d39a42c959a329b3c7dea28c3c9d9749))

## [2.1.0](https://github.com/lifinance/sdk/compare/v2.0.0...v2.1.0) (2023-06-27)

### Features

- adding node example to sdk ([#146](https://github.com/lifinance/sdk/issues/146)) ([8b3e9df](https://github.com/lifinance/sdk/commit/8b3e9df5817976e554b53923df0152802764c2dc))

### Bug Fixes

- add custom gas limit for approvals ([#148](https://github.com/lifinance/sdk/issues/148)) ([dead0ce](https://github.com/lifinance/sdk/commit/dead0ceba1de4875ee0f14049cfef258b367986b))
- prevent division by zero ([51ab537](https://github.com/lifinance/sdk/commit/51ab537492f3d36a8d1ce12c162d2680f2ead17c))
- update status types ([#149](https://github.com/lifinance/sdk/issues/149)) ([18bde05](https://github.com/lifinance/sdk/commit/18bde05741305b106f0cf4aeb47944f8a9d19cc7))

### [2.0.1](https://github.com/lifinance/sdk/compare/v2.0.0...v2.0.1) (2023-06-16)

### Bug Fixes

- prevent division by zero ([43340f0](https://github.com/lifinance/sdk/commit/43340f0dcd0df912e6a40a1a1edbdf0a1b71015d))

## [2.0.0](https://github.com/lifinance/sdk/compare/v2.0.0-beta.16...v2.0.0) (2023-06-15)

## [2.0.0-beta.16](https://github.com/lifinance/sdk/compare/v2.0.0-beta.15...v2.0.0-beta.16) (2023-06-12)

### Bug Fixes

- estimate gas price from signer LF-2417 ([#143](https://github.com/lifinance/sdk/issues/143)) ([a71152d](https://github.com/lifinance/sdk/commit/a71152d4a0e7901307dbf911d6c9b5c5c94d63b8))

## [2.0.0-beta.15](https://github.com/lifinance/sdk/compare/v2.0.0-beta.14...v2.0.0-beta.15) (2023-05-25)

### Bug Fixes

- tests configuration ([e734b6e](https://github.com/lifinance/sdk/commit/e734b6e024686a6545ed46ca2e316fc6169d955a))

## [2.0.0-beta.14](https://github.com/lifinance/sdk/compare/v2.0.0-beta.13...v2.0.0-beta.14) (2023-05-25)

### Bug Fixes

- increment gas on retry if out of gas ([#137](https://github.com/lifinance/sdk/issues/137)) ([c65fb0d](https://github.com/lifinance/sdk/commit/c65fb0d64196de90bc4b6f8b43d1b2923c7e7ed6))

## [2.0.0-beta.13](https://github.com/lifinance/sdk/compare/v2.0.0-beta.12...v2.0.0-beta.13) (2023-05-11)

### Bug Fixes

- add insufficient funds error ([#141](https://github.com/lifinance/sdk/issues/141)) ([e179453](https://github.com/lifinance/sdk/commit/e179453a4740b3bf48db1de559cf6551bc276210))

## [2.0.0-beta.12](https://github.com/lifinance/sdk/compare/v2.0.0-beta.11...v2.0.0-beta.12) (2023-05-11)

### ⚠ BREAKING CHANGES

- types and names cleanup (#136)

### Features

- types and names cleanup ([#136](https://github.com/lifinance/sdk/issues/136)) ([91c510a](https://github.com/lifinance/sdk/commit/91c510a708704a18ae4767446f390c4a95f2e0f7))

### Bug Fixes

- add missing config while updating transaction request ([#135](https://github.com/lifinance/sdk/issues/135)) ([e783d3c](https://github.com/lifinance/sdk/commit/e783d3c7d3d101bc6eb014e8be7264d97e58f862))
- moved getconnections method inside the lifi class ([#140](https://github.com/lifinance/sdk/issues/140)) ([ce7b6e6](https://github.com/lifinance/sdk/commit/ce7b6e6fba1141f2a7ed6f686ef70d4c3251621b))

## [2.0.0-beta.11](https://github.com/lifinance/sdk/compare/v2.0.0-beta.10...v2.0.0-beta.11) (2023-04-27)

### Bug Fixes

- add tenderly for readable error messages ([#134](https://github.com/lifinance/sdk/issues/134)) ([0246a2c](https://github.com/lifinance/sdk/commit/0246a2c246fb6aa98b9ce85611d75b577e0d909a))
- remove acceptSlippageUpdateHook (use acceptExchangeRateUpdateHook) ([22eabed](https://github.com/lifinance/sdk/commit/22eabedc04ade1dae359eca3809275e1324c97a7))
- unable to configure provider for chain on first load ([9c3590e](https://github.com/lifinance/sdk/commit/9c3590e623b0b0ab671fbe043762af2621717099))

## [2.0.0-beta.10](https://github.com/lifinance/sdk/compare/v2.0.0-beta.9...v2.0.0-beta.10) (2023-04-25)

### Bug Fixes

- don't trigger chain switch if all actions are done from source chain [LF-1131] ([#133](https://github.com/lifinance/sdk/issues/133)) ([e6d2076](https://github.com/lifinance/sdk/commit/e6d20763a7077978da61915dc579f3e8c6894204))

## [2.0.0-beta.9](https://github.com/lifinance/sdk/compare/v2.0.0-beta.8...v2.0.0-beta.9) (2023-04-21)

### Features

- add callbacks to support custom transaction config ([#128](https://github.com/lifinance/sdk/issues/128)) ([122f6b2](https://github.com/lifinance/sdk/commit/122f6b25d29e73ffe494f0c7fca28052956a9b28))

### Bug Fixes

- return contextual transaction error message ([#127](https://github.com/lifinance/sdk/issues/127)) ([4af19be](https://github.com/lifinance/sdk/commit/4af19be58d8afa1ce6f1c7b9bd5c5bcf054270f1))
- update step types ([de1434a](https://github.com/lifinance/sdk/commit/de1434a1ad825ee801dda3852bd8a8663c5c90dd))

## [2.0.0-beta.8](https://github.com/lifinance/sdk/compare/v2.0.0-beta.7...v2.0.0-beta.8) (2023-04-11)

### Bug Fixes

- update step types tests ([a2a75bd](https://github.com/lifinance/sdk/commit/a2a75bdda59f82da3732ebbe02d536b534c4902f))

## [2.0.0-beta.7](https://github.com/lifinance/sdk/compare/v2.0.0-beta.6...v2.0.0-beta.7) (2023-04-11)

### Features

- adding getConnections endpoint to SDK ([#130](https://github.com/lifinance/sdk/issues/130)) ([20f8464](https://github.com/lifinance/sdk/commit/20f84640df445224351f4c1817eb8e7e9f66c909))

### Bug Fixes

- errors in getStatus caused by the change of lifi/types ([#131](https://github.com/lifinance/sdk/issues/131)) ([f1eae4a](https://github.com/lifinance/sdk/commit/f1eae4acc86484632c904ac72eb8ff1048daf814))
- skip tracking headers in non-lifi api calls ([#126](https://github.com/lifinance/sdk/issues/126)) ([8a02690](https://github.com/lifinance/sdk/commit/8a026907dd75c2a9cafe8e1adb6c8914c8ff6867))
- typos ([#129](https://github.com/lifinance/sdk/issues/129)) ([a676806](https://github.com/lifinance/sdk/commit/a676806924968cea13ae8d7f0ac6a1bad735472d))
- update step types ([#132](https://github.com/lifinance/sdk/issues/132)) ([be473a5](https://github.com/lifinance/sdk/commit/be473a5e38d840a748356515b9080eb05a44325d))

## [2.0.0-beta.6](https://github.com/lifinance/sdk/compare/v2.0.0-beta.5...v2.0.0-beta.6) (2023-03-21)

## [2.0.0-beta.5](https://github.com/lifinance/sdk/compare/v2.0.0-beta.4...v2.0.0-beta.5) (2023-03-17)

### Features

- adding widget + sdk version in header ([#125](https://github.com/lifinance/sdk/issues/125)) ([3516717](https://github.com/lifinance/sdk/commit/35167179c0130194a4800842f1afd8376aefa699))
- allow user tracking by passing userId in header ([#123](https://github.com/lifinance/sdk/issues/123)) ([d5b2d84](https://github.com/lifinance/sdk/commit/d5b2d845e9b7aa22ea3c287183e4e3118a328fe5))

## [2.0.0-beta.4](https://github.com/lifinance/sdk/compare/v2.0.0-beta.3...v2.0.0-beta.4) (2023-03-13)

## [2.0.0-beta.3](https://github.com/lifinance/sdk/compare/v2.0.0-beta.2...v2.0.0-beta.3) (2023-03-09)

### Bug Fixes

- filter undefined config props ([326d7bb](https://github.com/lifinance/sdk/commit/326d7bbb84c6aa99f4abac978134e10da2dad532))

## [2.0.0-beta.2](https://github.com/lifinance/sdk/compare/v2.0.0-beta.1...v2.0.0-beta.2) (2023-03-08)

### Bug Fixes

- add missing types for gas recommendation ([3d2a044](https://github.com/lifinance/sdk/commit/3d2a044fadb1dff7213baea5e946c7541a121f74))

## [2.0.0-beta.1](https://github.com/lifinance/sdk/compare/v2.0.0-beta.0...v2.0.0-beta.1) (2023-03-08)

### Bug Fixes

- check package updates URL ([7a3db8c](https://github.com/lifinance/sdk/commit/7a3db8cc068051c77d1402276cc1724fcb4b98a0))

## [2.0.0-beta.0](https://github.com/lifinance/sdk/compare/v1.7.2...v2.0.0-beta.0) (2023-03-08)

### Features

- add gas recommendation endpoint ([#122](https://github.com/lifinance/sdk/issues/122)) ([ea31d1e](https://github.com/lifinance/sdk/commit/ea31d1e9989fc0e3fa1ba04f3fdf97d0601fa366))
- move to yarn 3 ([3f39a7a](https://github.com/lifinance/sdk/commit/3f39a7adf3054c8df1d84d34ef5b3866251b4c6f))
- remove axios and move to native fetch ([#113](https://github.com/lifinance/sdk/issues/113)) ([7783122](https://github.com/lifinance/sdk/commit/7783122d931461d2951cf84619b210677ff427ae))

### Bug Fixes

- add handling for replacement fee too low ([#112](https://github.com/lifinance/sdk/issues/112)) ([b09c874](https://github.com/lifinance/sdk/commit/b09c8741cb79f0e10685d648e0472dbb249218e4))
- configured as step as lifi-step ([22962b1](https://github.com/lifinance/sdk/commit/22962b18409a01a89ccb34d17ee8091249587f1f))
- error handling ([bb73fc9](https://github.com/lifinance/sdk/commit/bb73fc93bde151e936e68de88bf9b5de79fe2aa5))
- return large numbers as string ([cc927e0](https://github.com/lifinance/sdk/commit/cc927e0a033c29adf01ee4d3c6c39e30642a494f))
- review comments ([260335b](https://github.com/lifinance/sdk/commit/260335bc79303b8ce9acdaf0d0cb1db00bf953bb))

### [1.7.2](https://github.com/lifinance/sdk/compare/v1.7.1...v1.7.2) (2022-12-13)

### [1.7.1](https://github.com/lifinance/sdk/compare/v1.7.0...v1.7.1) (2022-12-12)

### Bug Fixes

- lock axios version ([a079ae1](https://github.com/lifinance/sdk/commit/a079ae17ab06e32e733bb1896d3d9844d09e5bd4))

## [1.7.0](https://github.com/lifinance/sdk/compare/v1.6.4...v1.7.0) (2022-11-23)

### Features

- add acceptExchangeRateUpdateHook and return gas info during route execution ([#111](https://github.com/lifinance/sdk/issues/111)) ([65c4cb1](https://github.com/lifinance/sdk/commit/65c4cb1c68fc0e7b60f1c19a42105772998cdb16))

### [1.6.4](https://github.com/lifinance/sdk/compare/v1.6.3...v1.6.4) (2022-11-16)

### [1.6.3](https://github.com/lifinance/sdk/compare/v1.6.2...v1.6.3) (2022-10-26)

### Bug Fixes

- getChains types ([06f969b](https://github.com/lifinance/sdk/commit/06f969b18ce778cb66e8f14993cc8a215a1213e8))

### [1.6.2](https://github.com/lifinance/sdk/compare/v1.6.1...v1.6.2) (2022-10-26)

### [1.6.1](https://github.com/lifinance/sdk/compare/v1.6.0...v1.6.1) (2022-10-24)

## [1.6.0](https://github.com/lifinance/sdk/compare/v1.5.0...v1.6.0) (2022-09-14)

### Features

- add bridgeExplorerLink to receiving chain process ([#110](https://github.com/lifinance/sdk/issues/110)) ([b9891a5](https://github.com/lifinance/sdk/commit/b9891a5b463412bbd29b88b91c2135bec9ef79fc))

## [1.5.0](https://github.com/lifinance/sdk/compare/v1.4.1...v1.5.0) (2022-09-06)

### Features

- add an option to start or resume execution in background ([#103](https://github.com/lifinance/sdk/issues/103)) ([c452559](https://github.com/lifinance/sdk/commit/c45255991ebcf494715c094db77f6c7599080c5d)), closes [#106](https://github.com/lifinance/sdk/issues/106) [#104](https://github.com/lifinance/sdk/issues/104)

### [1.4.1](https://github.com/lifinance/sdk/compare/v1.4.0...v1.4.1) (2022-09-06)

## [1.4.0](https://github.com/lifinance/sdk/compare/v1.3.1...v1.4.0) (2022-09-05)

### Features

- skip step tx generation if tx data already provided ([#100](https://github.com/lifinance/sdk/issues/100)) ([280de4a](https://github.com/lifinance/sdk/commit/280de4a3d96b8077893e0bc1e0ed944f4772c5fb))

### [1.3.1](https://github.com/lifinance/sdk/compare/v1.3.0...v1.3.1) (2022-09-05)

### Bug Fixes

- pass default options right for quote requests ([#109](https://github.com/lifinance/sdk/issues/109)) ([776c5a3](https://github.com/lifinance/sdk/commit/776c5a33f0ac7e6525659878cf7323244f055e77))

## [1.3.0](https://github.com/lifinance/sdk/compare/v1.2.2...v1.3.0) (2022-09-05)

### Features

- add TransactionRejected error ([#104](https://github.com/lifinance/sdk/issues/104)) ([2c180fd](https://github.com/lifinance/sdk/commit/2c180fd0cedbdf3acbf77326d69eb2a328c59170))
- **config:** set default integrator string ([#107](https://github.com/lifinance/sdk/issues/107)) ([f8ef3bf](https://github.com/lifinance/sdk/commit/f8ef3bfeff8bf0e6d5d9eec172bb7d7d86ec123f))

### Bug Fixes

- duplicates for LifiErrorCodes ([#106](https://github.com/lifinance/sdk/issues/106)) ([d63a80b](https://github.com/lifinance/sdk/commit/d63a80b2106d7f18d51e9f30b49dc896f5a30019))

### [1.2.2](https://github.com/lifinance/sdk/compare/v1.2.1...v1.2.2) (2022-08-24)

### [1.2.1](https://github.com/lifinance/sdk/compare/v1.2.0...v1.2.1) (2022-08-22)

## [1.2.0](https://github.com/lifinance/sdk/compare/v1.1.6...v1.2.0) (2022-08-22)

### Features

- add version check ([#102](https://github.com/lifinance/sdk/issues/102)) ([dbc0fc5](https://github.com/lifinance/sdk/commit/dbc0fc5805a2d6c9b3da8547d44c3e93f1a3b8ed))

### [1.1.6](https://github.com/lifinance/sdk/compare/v1.1.5...v1.1.6) (2022-08-19)

### [1.1.5](https://github.com/lifinance/sdk/compare/v1.1.4...v1.1.5) (2022-08-19)

### [1.1.4](https://github.com/lifinance/sdk/compare/v1.1.3...v1.1.4) (2022-08-19)

### [1.1.3](https://github.com/lifinance/sdk/compare/v1.1.2...v1.1.3) (2022-08-06)

### Bug Fixes

- cleanup after failure ([#99](https://github.com/lifinance/sdk/issues/99)) ([04501d6](https://github.com/lifinance/sdk/commit/04501d6a1600cd0354cd2cd83b54cde9e2915deb))

### [1.1.2](https://github.com/lifinance/sdk/compare/v1.1.1...v1.1.2) (2022-08-04)

### Bug Fixes

- contract call endpoint ([#98](https://github.com/lifinance/sdk/issues/98)) ([d21ccc9](https://github.com/lifinance/sdk/commit/d21ccc974caf4632a1f2c9c38c52def89332e284))

### [1.1.1](https://github.com/lifinance/sdk/compare/v1.1.0...v1.1.1) (2022-08-03)

### Bug Fixes

- statusmanager reference issue ([#96](https://github.com/lifinance/sdk/issues/96)) ([0e4fe27](https://github.com/lifinance/sdk/commit/0e4fe27c58d4911347cd45163657aa3d8be9066e))

## [1.1.0](https://github.com/lifinance/sdk/compare/v1.0.2...v1.1.0) (2022-08-02)

### Features

- add fee parameter and getContractCallQuote endpoint ([#92](https://github.com/lifinance/sdk/issues/92)) ([56695d6](https://github.com/lifinance/sdk/commit/56695d6026e99951a4518e45d1a4965f7546d204))
- add gasinformation to execution object ([#91](https://github.com/lifinance/sdk/issues/91)) ([f3a13b4](https://github.com/lifinance/sdk/commit/f3a13b4458db4c5dea245ae56f205a58b6cd00ed))
- expose get getRpcProvider ([#89](https://github.com/lifinance/sdk/issues/89)) ([750b675](https://github.com/lifinance/sdk/commit/750b675a6dbca0ae18361ee150f292a9ec820dfd))
- increase gasLimit or gasPrice on restart if necessary ([#90](https://github.com/lifinance/sdk/issues/90)) ([6f947d3](https://github.com/lifinance/sdk/commit/6f947d3b0b326f821fcee448636b65a10ee4f38a))

### Bug Fixes

- build error ([#94](https://github.com/lifinance/sdk/issues/94)) ([810028e](https://github.com/lifinance/sdk/commit/810028e0d2fb7d09dd5b9d5829faab983df5ae5a))
- failing tests ([#93](https://github.com/lifinance/sdk/issues/93)) ([318ec7b](https://github.com/lifinance/sdk/commit/318ec7ba3bbe21dbcad38baba09ef9fcc38469bd))
- update execution state ([#88](https://github.com/lifinance/sdk/issues/88)) ([d974263](https://github.com/lifinance/sdk/commit/d9742636f5aeb77a3b4c1db5eecc6c6625812430))

### [1.0.2](https://github.com/lifinance/sdk/compare/v1.0.1...v1.0.2) (2022-07-15)

### [1.0.1](https://github.com/lifinance/sdk/compare/v1.0.0...v1.0.1) (2022-07-14)

### Bug Fixes

- adjust approval messages ([f445021](https://github.com/lifinance/sdk/commit/f445021761bda2e4fd1d7eab90f0a04be4827280))
- handle more multicall failure cases ([#86](https://github.com/lifinance/sdk/issues/86)) ([f7acaca](https://github.com/lifinance/sdk/commit/f7acaca2ab48f58844ec331cb207fa6592488fb1))
- publishing script ([8c2f12a](https://github.com/lifinance/sdk/commit/8c2f12a7ee091547980f7622ba34fde8d548f606))

## [1.0.0](https://github.com/lifinance/sdk/compare/v1.0.0-beta.14...v1.0.0) (2022-07-12)

### ⚠ BREAKING CHANGES

- move to a new @lifi scope (#85)

### Features

- add func to check for correct native token ([#84](https://github.com/lifinance/sdk/issues/84)) ([865bc14](https://github.com/lifinance/sdk/commit/865bc14594902c7b94c30f5a910b7897b1133bd5))
- move to a new [@lifi](https://github.com/lifi) scope ([#85](https://github.com/lifinance/sdk/issues/85)) ([b58c5a1](https://github.com/lifinance/sdk/commit/b58c5a10e2c47fff3e1c43ae15516514b90b9197))
- new error messages ([#83](https://github.com/lifinance/sdk/issues/83)) ([ccebe17](https://github.com/lifinance/sdk/commit/ccebe170d32001377eb7b632afd76729252a8994))

## [1.0.0-beta.14](https://github.com/lifinance/sdk/compare/v1.0.0-beta.13...v1.0.0-beta.14) (2022-07-06)

### Features

- add more error logging ([#82](https://github.com/lifinance/sdk/issues/82)) ([edb4f85](https://github.com/lifinance/sdk/commit/edb4f851111bf905a266d831aae591f8a86518d0))
- use new substates from api ([#81](https://github.com/lifinance/sdk/issues/81)) ([4ad51a2](https://github.com/lifinance/sdk/commit/4ad51a2a8c946a99e5a4b6c5663f856f2f7fd497))

## [1.0.0-beta.13](https://github.com/lifinance/sdk/compare/v1.0.0-beta.12...v1.0.0-beta.13) (2022-07-05)

### Bug Fixes

- wait for replaced transaction ([#80](https://github.com/lifinance/sdk/issues/80)) ([6d29b2e](https://github.com/lifinance/sdk/commit/6d29b2e587f76355fb1d8c07e6334160d7aaccb6))

## [1.0.0-beta.12](https://github.com/lifinance/sdk/compare/v1.0.0-beta.11...v1.0.0-beta.12) (2022-06-29)

### Features

- better resume of failed transactions ([#78](https://github.com/lifinance/sdk/issues/78)) ([1558c47](https://github.com/lifinance/sdk/commit/1558c4768c39b8d9e42c2b6e92d78236c7d29669))
- handle slippage errors ([#79](https://github.com/lifinance/sdk/issues/79)) ([b672ed9](https://github.com/lifinance/sdk/commit/b672ed905db146a87cce62fa8045d8a476da0cfb))

## [1.0.0-beta.11](https://github.com/lifinance/sdk/compare/v1.0.0-beta.10...v1.0.0-beta.11) (2022-06-08)

## [1.0.0-beta.10](https://github.com/lifinance/sdk/compare/v1.0.0-beta.9...v1.0.0-beta.10) (2022-06-07)

### Bug Fixes

- fix dist folder ([868bcc9](https://github.com/lifinance/sdk/commit/868bcc9628c8ae02809cb65fd0ffc1d2ec254666))

## [1.0.0-beta.9](https://github.com/lifinance/sdk/compare/v1.0.0-beta.8...v1.0.0-beta.9) (2022-06-07)

### Bug Fixes

- updated e2e + added tsc compilation on push ([#77](https://github.com/lifinance/sdk/issues/77)) ([7d99cd1](https://github.com/lifinance/sdk/commit/7d99cd11a705cf30d48903dea2c158aa16ae7a7e))

## [1.0.0-beta.8](https://github.com/lifinance/sdk/compare/v1.0.0-beta.7...v1.0.0-beta.8) (2022-06-02)

### Features

- use tryBlockAndAggregate to fetch balances ([#76](https://github.com/lifinance/sdk/issues/76)) ([5f01961](https://github.com/lifinance/sdk/commit/5f019619c11269c197a777c323eb18de11a403dd))

## [1.0.0-beta.7](https://github.com/lifinance/sdk/compare/v1.0.0-beta.6...v1.0.0-beta.7) (2022-06-01)

### Features

- improve balance error messages ([#74](https://github.com/lifinance/sdk/issues/74)) ([b249732](https://github.com/lifinance/sdk/commit/b249732cfef182158106de52fec24948e2a5dbe3))

### Bug Fixes

- added toolDetails + workaround for non EVM chains testing ([#70](https://github.com/lifinance/sdk/issues/70)) ([f972477](https://github.com/lifinance/sdk/commit/f972477573d5f969c7294b3054b96c1357e42893))
- fix yarn.lock ([abdef57](https://github.com/lifinance/sdk/commit/abdef57b6ee1d444602cdcd6e34b61c3e66d86ab))
- log error if provider can not be configured ([#75](https://github.com/lifinance/sdk/issues/75)) ([85e22e9](https://github.com/lifinance/sdk/commit/85e22e96427b08381eefe263a079a5b1057988df))
- **utils:** only allow one status poll loop per tx ([#69](https://github.com/lifinance/sdk/issues/69)) ([0cc7e2b](https://github.com/lifinance/sdk/commit/0cc7e2b73222614262e7fd263112407791d62a4b))

## [1.0.0-beta.6](https://github.com/lifinance/sdk/compare/v1.0.0-beta.5...v1.0.0-beta.6) (2022-05-17)

### Features

- expose error codes ([e151051](https://github.com/lifinance/sdk/commit/e151051e96d57c99606bc447d4391e9f7bc8a266))

## [1.0.0-beta.5](https://github.com/lifinance/sdk/compare/v1.0.0-beta.4...v1.0.0-beta.5) (2022-05-17)

### Bug Fixes

- add missing toAddress param ([#68](https://github.com/lifinance/sdk/issues/68)) ([c9318ed](https://github.com/lifinance/sdk/commit/c9318edef9b5ec2b2c86b7e2f8f1645ae597437e))

## [1.0.0-beta.4](https://github.com/lifinance/sdk/compare/v1.0.0-beta.3...v1.0.0-beta.4) (2022-05-13)

### Bug Fixes

- fix types for requests cancellation ([36d7b55](https://github.com/lifinance/sdk/commit/36d7b5561d2cc2c1b47eba2ac75f07554dfca118))

## [1.0.0-beta.3](https://github.com/lifinance/sdk/compare/v1.0.0-beta.2...v1.0.0-beta.3) (2022-05-13)

### Features

- add getTokens endpoint ([#65](https://github.com/lifinance/sdk/issues/65)) ([5d9319c](https://github.com/lifinance/sdk/commit/5d9319c3ee749a6b5a81847440a3e803ffe40ee8))
- add requests cancellation ([#67](https://github.com/lifinance/sdk/issues/67)) ([32d0595](https://github.com/lifinance/sdk/commit/32d059590e0c03844245138f9f2aa9e76d7b6166))

### Bug Fixes

- remove duplicated getRoutes logic ([#66](https://github.com/lifinance/sdk/issues/66)) ([52bb994](https://github.com/lifinance/sdk/commit/52bb994ea1f6d5be90755f4dea4e1f5198557a95))

## [1.0.0-beta.2](https://github.com/lifinance/sdk/compare/v1.0.0-beta.1...v1.0.0-beta.2) (2022-05-06)

### ⚠ BREAKING CHANGES

- refine error messages and codes (#64)

### Features

- refine error messages and codes ([#64](https://github.com/lifinance/sdk/issues/64)) ([543bd28](https://github.com/lifinance/sdk/commit/543bd28b7d41c8daee3a82ca95cde1fce56f8db9))

## [1.0.0-beta.1](https://github.com/lifinance/sdk/compare/v1.0.0-beta.0...v1.0.0-beta.1) (2022-05-06)

### ⚠ BREAKING CHANGES

- deep clone incoming routes to prevent side effects (#62)
- improve status management (#63)

### Features

- add retry logic to jest ([#59](https://github.com/lifinance/sdk/issues/59)) ([c62ac37](https://github.com/lifinance/sdk/commit/c62ac370504e6bf652c24c75888d1fc44d394683))
- added getTools ([#61](https://github.com/lifinance/sdk/issues/61)) ([82e8ddd](https://github.com/lifinance/sdk/commit/82e8ddd6becbbbb197bc8f68376f12cfc6426ec1))
- improve status management ([#63](https://github.com/lifinance/sdk/issues/63)) ([e22ab60](https://github.com/lifinance/sdk/commit/e22ab6077f2b4e4fd88ca6519154d6c74e7480e7))

### Bug Fixes

- deep clone incoming routes to prevent side effects ([#62](https://github.com/lifinance/sdk/issues/62)) ([6040757](https://github.com/lifinance/sdk/commit/6040757f96a77ef8d370abc92ea0128c555a6696)), closes [#61](https://github.com/lifinance/sdk/issues/61) [#63](https://github.com/lifinance/sdk/issues/63)
- fix optimism balance loading ([#57](https://github.com/lifinance/sdk/issues/57)) ([219c3a9](https://github.com/lifinance/sdk/commit/219c3a903e7568f4df9d058d9b83f6d99744766b))
- fix undefined route error ([#58](https://github.com/lifinance/sdk/issues/58)) ([8cb120e](https://github.com/lifinance/sdk/commit/8cb120eb509ae12afdc9cea933081b2f4c1cdc5f))

## [1.0.0-beta.0](https://github.com/lifinance/sdk/compare/v0.5.3...v1.0.0-beta.0) (2022-04-13)

### ⚠ BREAKING CHANGES

- use object pattern for public methods with many params (#56)
- load available chains from the backend (#53)

### Features

- load available chains from the backend ([#53](https://github.com/lifinance/sdk/issues/53)) ([67cff83](https://github.com/lifinance/sdk/commit/67cff834aa7643234ec43626489059869e018787))
- use /status for swap execution handling ([#55](https://github.com/lifinance/sdk/issues/55)) ([0e4821c](https://github.com/lifinance/sdk/commit/0e4821c3784d87e0e4ac725eea14b3f14fe8b03c))
- use object pattern for public methods with many params ([#56](https://github.com/lifinance/sdk/issues/56)) ([b167240](https://github.com/lifinance/sdk/commit/b167240602b13d3733e5e4de5271411b5fdbd4b2))

### Bug Fixes

- handle status result 'FAILED' correctly ([#54](https://github.com/lifinance/sdk/issues/54)) ([a2113a4](https://github.com/lifinance/sdk/commit/a2113a42dc05c3cc9666a6f73bc64fe0b083372b))
- route undefined bug ([#52](https://github.com/lifinance/sdk/issues/52)) ([f0bd05e](https://github.com/lifinance/sdk/commit/f0bd05e8e8454ee570ed908b9584d24dcfadc10e))

### [0.5.4](https://github.com/lifinance/sdk/compare/v0.5.3...v0.5.4) (2022-04-04)

### [0.5.3](https://github.com/lifinance/sdk/compare/v0.5.2...v0.5.3) (2022-04-04)

### [0.5.2](https://github.com/lifinance/sdk/compare/v0.5.1...v0.5.2) (2022-04-04)

### Features

- adjust status handling to new behaviour ([#50](https://github.com/lifinance/sdk/issues/50)) ([3d3c540](https://github.com/lifinance/sdk/commit/3d3c5403da8392d3e9e62271c0b84c71042b73c4))

### Bug Fixes

- continue status calls after failure ([#49](https://github.com/lifinance/sdk/issues/49)) ([3db0a62](https://github.com/lifinance/sdk/commit/3db0a626cc6eb8449c11ed5b3091a748f9c38094))

### [0.5.1](https://github.com/lifinance/sdk/compare/v0.5.0...v0.5.1) (2022-03-24)

## [0.5.0](https://github.com/lifinance/sdk/compare/v0.4.11...v0.5.0) (2022-03-24)

### [0.4.11](https://github.com/lifinance/sdk/compare/v0.4.10...v0.4.11) (2022-03-24)

### Features

- add infinite approval to execution settings ([#47](https://github.com/lifinance/sdk/issues/47)) ([e2b3995](https://github.com/lifinance/sdk/commit/e2b39950a8e3d06998ce492ffd6bfcc2b36c35de))
- add token approval methods ([#48](https://github.com/lifinance/sdk/issues/48)) ([1f3b64d](https://github.com/lifinance/sdk/commit/1f3b64d8e545a0eb4ca33e94065b6b99dd02b0e3))

### [0.4.10](https://github.com/lifinance/sdk/compare/v0.4.9...v0.4.10) (2022-03-20)

### Features

- add chains endpoint to SDK ([#46](https://github.com/lifinance/sdk/issues/46)) ([4b500d7](https://github.com/lifinance/sdk/commit/4b500d738303e1c67f54c929447157a1fab26f8a))

### [0.4.9](https://github.com/lifinance/sdk/compare/v0.4.8...v0.4.9) (2022-03-15)

### Bug Fixes

- store received token in execution object ([#45](https://github.com/lifinance/sdk/issues/45)) ([8115ccd](https://github.com/lifinance/sdk/commit/8115ccde4123c420d7e3f96b1e3e2b67c4773e68))

### [0.4.8](https://github.com/lifinance/sdk/compare/v0.4.7...v0.4.8) (2022-03-07)

### Features

- randomly select RPCs to prevent quota issues ([#44](https://github.com/lifinance/sdk/issues/44)) ([4346282](https://github.com/lifinance/sdk/commit/4346282ccd82072cba0e8ba1101f1b55b5bbd8f4))

### [0.4.7](https://github.com/lifinance/sdk/compare/v0.4.6...v0.4.7) (2022-02-24)

### Features

- use common bridge executor for all known BridgeTools ([#43](https://github.com/lifinance/sdk/issues/43)) ([77626b3](https://github.com/lifinance/sdk/commit/77626b35c617a594f7f1924fc6860c35b9fafa8c))

### [0.4.6](https://github.com/lifinance/sdk/compare/v0.4.5-beta.2...v0.4.6) (2022-02-24)

### Bug Fixes

- handle tokens with 0xeee... zero
  addresses ([#41](https://github.com/lifinance/sdk/issues/41)) ([130df5](https://github.com/lifinance/sdk/commit/130df5a3c60e4e5848e7893035c19bec6a9e8365))

### Features

- use common bridge executor for bridge
  calls ([#42](https://github.com/lifinance/sdk/issues/40)) ([2c8865](https://github.com/lifinance/sdk/commit/2c88651532af66a31108489dd455a2fece54436b))
- **Hop:** use common bridge executor for hop
  transfers ([#40](https://github.com/lifinance/sdk/issues/40)) ([b65519](https://github.com/lifinance/sdk/commit/b655190a481a29b1b09b09e97c1c9edd1d25fd92))

### [0.4.5](https://github.com/lifinance/sdk/compare/v0.4.4...v0.4.5) (2022-02-10)

### [0.4.4](https://github.com/lifinance/sdk/compare/v0.4.2...v0.4.4) (2022-02-09)

### Bug Fixes

- check chain before sending
  transactions ([#33](https://github.com/lifinance/sdk/issues/33)) ([6b92a77](https://github.com/lifinance/sdk/commit/6b92a7740d00427244c48df2a4c30f255e2a89ec))
- fix type changes ([59b9981](https://github.com/lifinance/sdk/commit/59b9981d7b71704bcb137ecc2de4af09f3f819a8))
- **nxtp:** wait for subgraph setup before calling
  waitFor ([62c7f73](https://github.com/lifinance/sdk/commit/62c7f73fe186c6ebd70fdbb38c84863abb71fc52))
- show better connext error
  message ([#32](https://github.com/lifinance/sdk/issues/32)) ([e3f9998](https://github.com/lifinance/sdk/commit/e3f9998c12a16b99e2b3d3b638b47016d90a85fe))

### [0.4.3](https://github.com/lifinance/sdk/compare/v0.4.2...v0.4.3) (2022-01-29)

### [0.4.2](https://github.com/lifinance/sdk/compare/v0.4.1...v0.4.2) (2022-01-28)

### Features

- add new API endpoints to
  SDK ([#30](https://github.com/lifinance/sdk/issues/30)) ([89ace22](https://github.com/lifinance/sdk/commit/89ace22ed6f7a76900ebdffb85b4393ba687770c))
- improve handling of wallet & backend
  errors ([#22](https://github.com/lifinance/sdk/issues/22)) ([05e94d6](https://github.com/lifinance/sdk/commit/05e94d617ac22928bbc3265d3a75579e7e5a833d))
- use v1 LiFi
  endpoints ([#29](https://github.com/lifinance/sdk/issues/29)) ([c271425](https://github.com/lifinance/sdk/commit/c2714252a9be2df0ea1e1a30b7f01be3839bb563))

### Bug Fixes

- **Hop:** check subgraphs for success confirmation instead of using hop
  sdk ([#24](https://github.com/lifinance/sdk/issues/24)) ([ce95623](https://github.com/lifinance/sdk/commit/ce956233f19c16ba017606207715f5ab61143032))
- **nxtp:** improve nxtp timeout
  handling ([#23](https://github.com/lifinance/sdk/issues/23)) ([fa12dec](https://github.com/lifinance/sdk/commit/fa12dec9834d236ae8a621866b3813d19a56107e))
- **nxtp:** use transactionId returned by the backend (
  LF-78) ([121c103](https://github.com/lifinance/sdk/commit/121c1032a989a137d8d473af233e362e0d80ff3b))
- resolve eslint
  issues ([#27](https://github.com/lifinance/sdk/issues/27)) ([5b307ce](https://github.com/lifinance/sdk/commit/5b307ce749c6f9e87513155778421eb6323b148a))
- type in
  hook ([#28](https://github.com/lifinance/sdk/issues/28)) ([9e72a39](https://github.com/lifinance/sdk/commit/9e72a3917a9fa6441b859dc6492b73dd9568df92))

### [0.4.1](https://github.com/lifinance/sdk/compare/v0.4.0...v0.4.1) (2022-01-14)

## [0.4.0](https://github.com/lifinance/sdk/compare/v0.3.3...v0.4.0) (2022-01-14)

### ⚠ BREAKING CHANGES

- interface of external status management methods changed

### Bug Fixes

- **nxtp:** handle cancelled
  transfers ([#18](https://github.com/lifinance/sdk/issues/18)) ([02cd6de](https://github.com/lifinance/sdk/commit/02cd6deb499e5b6b08ee111dcefe2ebda81da548))
- **scripts:** make install script OS
  agnostic ([6792a8f](https://github.com/lifinance/sdk/commit/6792a8fceb4246ed77b18ef58481fa56a6bca92c))

- refactor status
  handling ([#5](https://github.com/lifinance/sdk/issues/5)) ([aa924d8](https://github.com/lifinance/sdk/commit/aa924d80a3b151b8ca750a311436fb10aa4f8f7a))

### [0.3.4](https://github.com/lifinance/sdk/compare/v0.3.3...v0.3.4) (2022-01-12)

### Bug Fixes

- **nxtp:** handle cancelled
  transfers ([#18](https://github.com/lifinance/sdk/issues/18)) ([02cd6de](https://github.com/lifinance/sdk/commit/02cd6deb499e5b6b08ee111dcefe2ebda81da548))
- **scripts:** make install script OS
  agnostic ([6792a8f](https://github.com/lifinance/sdk/commit/6792a8fceb4246ed77b18ef58481fa56a6bca92c))

### [0.3.3](https://github.com/lifinance/sdk/compare/v0.2.3...v0.3.3) (2022-01-04)

### Bug Fixes

- **nxtp:** wait until balance rpc contains block number larger than claim block
  number ([#14](https://github.com/lifinance/sdk/issues/14)) ([5146af0](https://github.com/lifinance/sdk/commit/5146af0a2596f202eec74ffc0af89905264ab66c))

### [0.2.3](https://github.com/lifinance/sdk/compare/v0.2.2...v0.2.3) (2021-12-30)

### Features

- **bal:** add local balance checks to avoid impossible
  transactions ([2a8e0b2](https://github.com/lifinance/sdk/commit/2a8e0b2fd25622cdb9f253e610e25fc0cde9d3f7))
- **balance:** update multicall contract usage in balance
  util ([#9](https://github.com/lifinance/sdk/issues/9)) ([74b1d8f](https://github.com/lifinance/sdk/commit/74b1d8fe4c2a4da505584db65826c015608ebebe))
- **dex:** parse exchange
  transactions ([97cba56](https://github.com/lifinance/sdk/commit/97cba56fdd97c6f7998e9da8b8346832ee5d25eb))

### [0.2.2](https://github.com/lifinance/sdk/compare/v0.2.1...v0.2.2) (2021-12-28)

### Bug Fixes

- **paraswap:** improve receipt
  parsing ([ee604a5](https://github.com/lifinance/sdk/commit/ee604a5e7fe4ae1e5c433441b7cb8fb0fd4e241d))

### [0.2.1](https://github.com/lifinance/sdk/compare/v0.2.0...v0.2.1) (2021-12-16)

## [0.2.0](https://github.com/lifinance/sdk/compare/v0.1.1...v0.2.0) (2021-12-16)

### Features

- **config:** allow to edit the underlying
  config ([#2](https://github.com/lifinance/sdk/issues/2)) ([3c04ead](https://github.com/lifinance/sdk/commit/3c04ead754097ae9d39071b87fe9f7174dee50e4))

### Bug Fixes

- **balance:** split large token lists into
  chunks ([#7](https://github.com/lifinance/sdk/issues/7)) ([d19f837](https://github.com/lifinance/sdk/commit/d19f837b2df88427444ea954016ed61a1cc2e0f8))

### [0.1.1](https://github.com/lifinance/sdk/compare/v0.1.0...v0.1.1) (2021-12-13)

### Features

- **balances:** handle empty token
  lists ([b0a4837](https://github.com/lifinance/sdk/commit/b0a48376b70b92266eff368437b56ac26a715c39))
- **nxtp:** handle encryption/decryption via
  hooks ([#4](https://github.com/lifinance/sdk/issues/4)) ([4e4f27d](https://github.com/lifinance/sdk/commit/4e4f27de798f2ccb9b04def0a518afdebb26cf43))

## [0.1.0](https://github.com/lifinance/sdk/compare/v0.0.2...v0.1.0) (2021-12-10)

- **Token:** refactor token and coin
  usage ([#1](https://github.com/lifinance/sdk/issues/1)) ([5ee4d86](https://github.com/lifinance/sdk/commit/5ee4d86ac037f74de0981139f8275031be58c82b))
