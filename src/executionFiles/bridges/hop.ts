/* eslint-disable max-params */
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { Chain, Hop, HopBridge } from '@hop-protocol/sdk'
import { Token } from '@hop-protocol/sdk/dist/src/models'
import BigNumber from 'bignumber.js'
import { ethers, Signer } from 'ethers'

import {
  ChainId,
  ChainKey,
  CoinKey,
  getChainByKey,
  ParsedReceipt,
} from '../../types'
import { defaultReceiptParsing } from '../utils'

let hop: Hop | undefined = undefined

let bridges: { [k: string]: HopBridge } = {}
const hopChains: { [k: number]: Chain } = {
  [getChainByKey(ChainKey.ETH).id]: Chain.Ethereum,
  [getChainByKey(ChainKey.POL).id]: Chain.Polygon,
  [getChainByKey(ChainKey.DAI).id]: Chain.xDai,
  [getChainByKey(ChainKey.OPT).id]: Chain.Optimism,
  [getChainByKey(ChainKey.ARB).id]: Chain.Arbitrum,

  // Testnet; Hop SDK changes the underlying id of these chains according to the instance network
  //network 'goerli'
  [getChainByKey(ChainKey.GOR).id]: Chain.Ethereum,
  [getChainByKey(ChainKey.MUM).id]: Chain.Polygon,
}

const supportedTestnetChains: number[] = [ChainId.GOR, ChainId.MUM]

// get these from https://github.com/hop-protocol/hop/blob/develop/packages/sdk/src/models/Token.ts
const hopTokens: { [k: string]: string } = {
  USDC: Token.USDC,
  USDT: Token.USDT,
  MATIC: Token.MATIC,
  DAI: Token.DAI,
  ETH: Token.ETH,
}
const isInitialized = () => {
  if (hop === undefined)
    throw TypeError('Hop instance is undefined! Please initialize Hop')
}
const init = (signer: Signer, chainId: number, toChainId: number) => {
  const isChainTest = supportedTestnetChains.includes(chainId) ? true : false
  const isToChainTest = supportedTestnetChains.includes(toChainId)
    ? true
    : false
  // goerli <-> mumbai
  if (isChainTest && isToChainTest) {
    hop = new Hop('goerli')
  } else {
    hop = new Hop('mainnet')
  }
  bridges = {
    USDT: hop.connect(signer).bridge('USDT'),
    USDC: hop.connect(signer).bridge('USDC'),
    MATIC: hop.connect(signer).bridge('MATIC'),
    DAI: hop.connect(signer).bridge('DAI'),
    ETH: hop.connect(signer).bridge('ETH'),
  }
}

const getHopBridge = (bridgeCoin: CoinKey) => {
  isInitialized()
  if (!Object.keys(bridges).length) {
    throw Error(
      'No HopBridge available! Initialize Hop implementation first via init(signer: JsonRpcSigner, chainId: number, toChainId: number)'
    )
  }
  return bridges[bridgeCoin]
}

const setAllowanceAndCrossChains = async (
  bridgeCoin: CoinKey,
  amount: string,
  fromChainId: number,
  toChainId: number
) => {
  isInitialized()
  const bridge = getHopBridge(bridgeCoin)
  const hopFromChain = hopChains[fromChainId]
  const hopToChain = hopChains[toChainId]
  const tx = await bridge.approveAndSend(amount, hopFromChain, hopToChain)
  return tx
}

const waitForDestinationChainReceipt = (
  tx: string,
  coin: CoinKey,
  fromChainId: number,
  toChainId: number
): Promise<TransactionReceipt> => {
  return new Promise((resolve, reject) => {
    isInitialized()
    const hopFromChain = hopChains[fromChainId]
    const hopToChain = hopChains[toChainId]
    try {
      hop
        ?.watch(tx, hopTokens[coin], hopFromChain, hopToChain)
        .once('destinationTxReceipt', async (data: any) => {
          const receipt: TransactionReceipt = data.receipt
          if (receipt.status !== 1) reject(receipt)
          if (receipt.status === 1) resolve(receipt)
        })
    } catch (e) {
      reject(e)
      throw e
    }
  })
}

const parseTokenSwapEvent = (params: { receipt: TransactionReceipt }) => {
  const { receipt } = params

  const abiTokenSwap = [
    'event TokenSwap(address indexed buyer, uint256 tokensSold, uint256 tokensBought, uint128 soldId, uint128 boughtId)',
  ]
  const interfaceTokenSwap = new ethers.utils.Interface(abiTokenSwap)
  let result
  for (const log of receipt.logs) {
    try {
      const parsed = interfaceTokenSwap.parseLog(log)
      // only amount of swapped hToken not of actual starting token
      // const fromAmount = parsed.args.tokensSold as BigNumber
      // result.fromAmount = fromAmount.toString()
      const toAmount = parsed.args.tokensBought as BigNumber
      result = {
        toAmount: toAmount.toString(),
      }
    } catch (e) {
      // find right log by trying to parse them
    }
  }

  return result
}

const parseReceipt = (
  toAddress: string,
  toTokenAddress: string,
  tx: TransactionResponse,
  receipt: TransactionReceipt
): Promise<ParsedReceipt> => {
  let result = {
    fromAmount: '0',
    toAmount: '0',
    toTokenAddress: toTokenAddress,
    gasUsed: '0',
    gasPrice: '0',
    gasFee: '0',
  }

  // > TokenSwapEvent
  result = {
    ...result,
    ...parseTokenSwapEvent({ receipt }),
  }

  return defaultReceiptParsing({ result, tx, receipt, toAddress })
}

const hopExport = {
  init,
  setAllowanceAndCrossChains,
  waitForDestinationChainReceipt,
  parseReceipt,
}

export default hopExport
