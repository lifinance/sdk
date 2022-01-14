# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
