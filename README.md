# Li.Finance - SDK

LiFi Any-to-Any Cross-Chain-Swap SDK
Please checkout the [SDK docs](https://docs.li.finance/official-documentation/sdk-docs/quick-start) and our [API reference](https://apidocs.li.finance/reference/how-to-transfer-tokens) for further information.

## Installation

```bash
yarn add @lifinance/sdk
```

or

```bash
npm install --save @lifinance/sdk
```

## Summary

This package allows accessing to LiFi API which finds the best cross-chain routes on different bridges. The routes can
then be executed via the SDK. Learn more about LiFi on (https://li.finance).

Check out the [Changelog](./CHANGELOG.md) to see what changed in the last releases.

## Extend the SDK

Install dependencies:

```bash
yarn
```

### Test

Test your code with Jest framework:

```bash
yarn test
```

### Build

Build production (distribution) files in your **dist** folder:

```bash
yarn build
```

### Publish

In order to update the package, commit all new changes first. Then run the following command:

```bash
yarn release
```

This will

* bump the version number according to the types of the last commits (i.e. if it is a major, minor or bug fix release)
* create a new git tag
* update the CHANGELOG.md

Next you need to push both, the code and the new version tag:

```bash
git push && git push --tags
```
