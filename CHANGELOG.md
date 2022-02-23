# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.4.6-beta.0](https://github.com/lifinance/sdk/compare/v0.4.5...v0.4.6-beta.0) (2022-02-23)


### Features

* **Hop:** use common bridge executor for hop transfers ([#40](https://github.com/lifinance/sdk/issues/40)) ([b655190](https://github.com/lifinance/sdk/commit/b655190a481a29b1b09b09e97c1c9edd1d25fd92))
* use common bridge executor for bridge calls ([#42](https://github.com/lifinance/sdk/issues/42)) ([2c88651](https://github.com/lifinance/sdk/commit/2c88651532af66a31108489dd455a2fece54436b))


### Bug Fixes

* handle tokens with 0xeee... zero addresses ([#41](https://github.com/lifinance/sdk/issues/41)) ([130df5a](https://github.com/lifinance/sdk/commit/130df5a3c60e4e5848e7893035c19bec6a9e8365))

### [0.4.5](https://github.com/lifinance/sdk/compare/v0.4.4...v0.4.5) (2022-02-10)

### [0.4.4](https://github.com/lifinance/sdk/compare/v0.4.2...v0.4.4) (2022-02-09)


### Bug Fixes

* check chain before sending transactions ([#33](https://github.com/lifinance/sdk/issues/33)) ([6b92a77](https://github.com/lifinance/sdk/commit/6b92a7740d00427244c48df2a4c30f255e2a89ec))
* fix type changes ([59b9981](https://github.com/lifinance/sdk/commit/59b9981d7b71704bcb137ecc2de4af09f3f819a8))
* **nxtp:** wait for subgraph setup before calling waitFor ([62c7f73](https://github.com/lifinance/sdk/commit/62c7f73fe186c6ebd70fdbb38c84863abb71fc52))
* show better connext error message ([#32](https://github.com/lifinance/sdk/issues/32)) ([e3f9998](https://github.com/lifinance/sdk/commit/e3f9998c12a16b99e2b3d3b638b47016d90a85fe))

### [0.4.3](https://github.com/lifinance/sdk/compare/v0.4.2...v0.4.3) (2022-01-29)

### [0.4.2](https://github.com/lifinance/sdk/compare/v0.4.1...v0.4.2) (2022-01-28)


### Features

* add new API endpoints to SDK ([#30](https://github.com/lifinance/sdk/issues/30)) ([89ace22](https://github.com/lifinance/sdk/commit/89ace22ed6f7a76900ebdffb85b4393ba687770c))
* improve handling of wallet & backend errors ([#22](https://github.com/lifinance/sdk/issues/22)) ([05e94d6](https://github.com/lifinance/sdk/commit/05e94d617ac22928bbc3265d3a75579e7e5a833d))
* use v1 LiFi endpoints ([#29](https://github.com/lifinance/sdk/issues/29)) ([c271425](https://github.com/lifinance/sdk/commit/c2714252a9be2df0ea1e1a30b7f01be3839bb563))


### Bug Fixes

* **Hop:** check subgraphs for success confirmation instead of using hop sdk ([#24](https://github.com/lifinance/sdk/issues/24)) ([ce95623](https://github.com/lifinance/sdk/commit/ce956233f19c16ba017606207715f5ab61143032))
* **nxtp:** improve nxtp timeout handling ([#23](https://github.com/lifinance/sdk/issues/23)) ([fa12dec](https://github.com/lifinance/sdk/commit/fa12dec9834d236ae8a621866b3813d19a56107e))
* **nxtp:** use transactionId returned by the backend (LF-78) ([121c103](https://github.com/lifinance/sdk/commit/121c1032a989a137d8d473af233e362e0d80ff3b))
* resolve eslint issues ([#27](https://github.com/lifinance/sdk/issues/27)) ([5b307ce](https://github.com/lifinance/sdk/commit/5b307ce749c6f9e87513155778421eb6323b148a))
* type in hook ([#28](https://github.com/lifinance/sdk/issues/28)) ([9e72a39](https://github.com/lifinance/sdk/commit/9e72a3917a9fa6441b859dc6492b73dd9568df92))

### [0.4.1](https://github.com/lifinance/sdk/compare/v0.4.0...v0.4.1) (2022-01-14)

## [0.4.0](https://github.com/lifinance/sdk/compare/v0.3.3...v0.4.0) (2022-01-14)


### ⚠ BREAKING CHANGES

* interface of external status management methods changed

### Bug Fixes

* **nxtp:** handle cancelled transfers ([#18](https://github.com/lifinance/sdk/issues/18)) ([02cd6de](https://github.com/lifinance/sdk/commit/02cd6deb499e5b6b08ee111dcefe2ebda81da548))
* **scripts:** make install script OS agnostic ([6792a8f](https://github.com/lifinance/sdk/commit/6792a8fceb4246ed77b18ef58481fa56a6bca92c))


* refactor status handling ([#5](https://github.com/lifinance/sdk/issues/5)) ([aa924d8](https://github.com/lifinance/sdk/commit/aa924d80a3b151b8ca750a311436fb10aa4f8f7a))

### [0.3.4](https://github.com/lifinance/sdk/compare/v0.3.3...v0.3.4) (2022-01-12)


### Bug Fixes

* **nxtp:** handle cancelled transfers ([#18](https://github.com/lifinance/sdk/issues/18)) ([02cd6de](https://github.com/lifinance/sdk/commit/02cd6deb499e5b6b08ee111dcefe2ebda81da548))
* **scripts:** make install script OS agnostic ([6792a8f](https://github.com/lifinance/sdk/commit/6792a8fceb4246ed77b18ef58481fa56a6bca92c))

### [0.3.3](https://github.com/lifinance/sdk/compare/v0.2.3...v0.3.3) (2022-01-04)


### Bug Fixes

* **nxtp:** wait until balance rpc contains block number larger than claim block number ([#14](https://github.com/lifinance/sdk/issues/14)) ([5146af0](https://github.com/lifinance/sdk/commit/5146af0a2596f202eec74ffc0af89905264ab66c))

### [0.2.3](https://github.com/lifinance/sdk/compare/v0.2.2...v0.2.3) (2021-12-30)


### Features

* **bal:** add local balance checks to avoid impossible transactions ([2a8e0b2](https://github.com/lifinance/sdk/commit/2a8e0b2fd25622cdb9f253e610e25fc0cde9d3f7))
* **balance:** update multicall contract usage in balance util ([#9](https://github.com/lifinance/sdk/issues/9)) ([74b1d8f](https://github.com/lifinance/sdk/commit/74b1d8fe4c2a4da505584db65826c015608ebebe))
* **dex:** parse exchange transactions ([97cba56](https://github.com/lifinance/sdk/commit/97cba56fdd97c6f7998e9da8b8346832ee5d25eb))

### [0.2.2](https://github.com/lifinance/sdk/compare/v0.2.1...v0.2.2) (2021-12-28)


### Bug Fixes

* **paraswap:** improve receipt parsing ([ee604a5](https://github.com/lifinance/sdk/commit/ee604a5e7fe4ae1e5c433441b7cb8fb0fd4e241d))

### [0.2.1](https://github.com/lifinance/sdk/compare/v0.2.0...v0.2.1) (2021-12-16)

## [0.2.0](https://github.com/lifinance/sdk/compare/v0.1.1...v0.2.0) (2021-12-16)


### Features

* **config:** allow to edit the underlying config ([#2](https://github.com/lifinance/sdk/issues/2)) ([3c04ead](https://github.com/lifinance/sdk/commit/3c04ead754097ae9d39071b87fe9f7174dee50e4))


### Bug Fixes

* **balance:** split large token lists into chunks ([#7](https://github.com/lifinance/sdk/issues/7)) ([d19f837](https://github.com/lifinance/sdk/commit/d19f837b2df88427444ea954016ed61a1cc2e0f8))

### [0.1.1](https://github.com/lifinance/sdk/compare/v0.1.0...v0.1.1) (2021-12-13)


### Features

* **balances:** handle empty token lists ([b0a4837](https://github.com/lifinance/sdk/commit/b0a48376b70b92266eff368437b56ac26a715c39))
* **nxtp:** handle encryption/decryption via hooks ([#4](https://github.com/lifinance/sdk/issues/4)) ([4e4f27d](https://github.com/lifinance/sdk/commit/4e4f27de798f2ccb9b04def0a518afdebb26cf43))

## [0.1.0](https://github.com/lifinance/sdk/compare/v0.0.2...v0.1.0) (2021-12-10)


* **Token:** refactor token and coin usage ([#1](https://github.com/lifinance/sdk/issues/1)) ([5ee4d86](https://github.com/lifinance/sdk/commit/5ee4d86ac037f74de0981139f8275031be58c82b))
