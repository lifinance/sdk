<div align="center">

[![license](https://img.shields.io/badge/license-Apache%202-blue)](/LICENSE.md)
[![npm latest package](https://img.shields.io/npm/v/@lifi/sdk/latest.svg)](https://www.npmjs.com/package/@lifi/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@lifi/sdk.svg)](https://www.npmjs.com/package/@lifi/sdk)
[![Follow on Twitter](https://img.shields.io/twitter/follow/lifiprotocol.svg?label=follow+LI.FI)](https://twitter.com/lifiprotocol)

</div>

# LI.FI - SDK

LI.FI Any-to-Any Cross-Chain-Swap SDK  
Please checkout the [SDK docs](https://docs.li.fi/integrate-li.fi-js-sdk/install-li.fi-sdk) and our [API reference](https://apidocs.li.fi) for further information.

## Installation

```bash
yarn add @lifi/sdk
```

or

```bash
npm install --save @lifi/sdk
```

## Summary

This package allows accessing to LI.FI API which finds the best cross-chain routes on different bridges. The routes can
then be executed via the SDK. Learn more about LI.FI on (https://li.fi).

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
