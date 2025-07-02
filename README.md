<div align="center">

[![license](https://img.shields.io/github/license/lifinance/sdk)](/LICENSE)
[![npm latest package](https://img.shields.io/npm/v/@lifi/sdk/latest.svg)](https://www.npmjs.com/package/@lifi/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@lifi/sdk.svg)](https://www.npmjs.com/package/@lifi/sdk)
[![Follow on Twitter](https://img.shields.io/twitter/follow/lifiprotocol.svg?label=follow+LI.FI)](https://twitter.com/lifiprotocol)

</div>

<h1 align="center">LI.FI SDK</h1>

[**LI.FI SDK**](https://docs.li.fi/sdk/overview) provides a powerful toolkit for developers to enable seamless cross-chain and on-chain swaps and bridging within their applications. Our JavaScript/TypeScript SDK can be implemented in front-end or back-end environments, allowing you to build robust UX/UI around our advanced bridge and swap functionalities. LI.FI SDK efficiently manages all communications between our smart routing API and smart contracts and ensures optimal performance, security, and scalability for your cross-chain and on-chain needs.

[**LI.FI SDK**](https://docs.li.fi/sdk/overview) features include:

- All ecosystems, chains, bridges, exchanges, and solvers that [LI.FI](https://docs.li.fi/introduction/chains) supports
- Complete functionality covering full-cycle from obtaining routes/quotes to executing transactions
- Easy tracking of the route and quote execution through the robust event and hooks handling
- Highly customizable settings to tailor the SDK to your specific needs including configuration of RPCs and options to allow or deny certain chains, tokens, bridges, exchanges, solvers
- Supports widely adopted industry standards, including [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792), [ERC-2612](https://eips.ethereum.org/EIPS/eip-2612), [EIP-712](https://eips.ethereum.org/EIPS/eip-712), and [Permit2](https://github.com/Uniswap/permit2)
- SDK ecosystem providers are based on industry-standard libraries ([Viem](https://viem.sh/), [Wallet Standard](https://github.com/wallet-standard/wallet-standard), [Bigmi](https://github.com/lifinance/bigmi))
- Support for arbitrary contract calls on the destination chain
- Designed for optimal performance with tree-shaking and dead-code elimination, ensuring minimal bundle sizes and faster page load times in front-end environments
- Compatibility tested with Node.js and popular front-end tools like Vite

## Installation

```bash
pnpm add @lifi/sdk
```

or

```bash
npm install --save @lifi/sdk
```

## Quick Start

### Set up the SDK

Firstly, create SDK config with your integrator string.

```ts
import { createConfig } from '@lifi/sdk'

createConfig({
  integrator: 'Your dApp/company name',
})
```

### Request a Quote

Now you can interact with the SDK and for example request a quote.

```ts
import { ChainId, getQuote } from '@lifi/sdk'

const quote = await getQuote({
  fromAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  fromChain: ChainId.ARB,
  toChain: ChainId.OPT,
  fromToken: '0x0000000000000000000000000000000000000000',
  toToken: '0x0000000000000000000000000000000000000000',
  fromAmount: '1000000000000000000',
})
```

## Examples

See [examples](/examples) folder in this repository.

## Documentation

Please checkout the [SDK documentation](https://docs.li.fi/sdk/overview) and our [API reference](https://docs.li.fi/api-reference/introduction) for further information.

## Changelog

The [changelog](/CHANGELOG.md) is regularly updated to reflect what's changed in each new release.
