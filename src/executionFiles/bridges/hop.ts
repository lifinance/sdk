/* eslint-disable max-params */
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import axios from 'axios'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import { Token } from '@hop-protocol/sdk/dist/src/models'
import { Chain, Hop, HopBridge } from '@hop-protocol/sdk'

import { ChainId, CoinKey, ParsedReceipt } from '../../types'
import { loadTransaction, repeatUntilDone } from '../../utils'
import { defaultReceiptParsing } from '../utils'

const hopChains: { [k: number]: Chain } = {
  [ChainId.ETH]: Chain.Ethereum,
  [ChainId.POL]: Chain.Polygon,
  [ChainId.DAI]: Chain.Gnosis,
  [ChainId.OPT]: Chain.Optimism,
  [ChainId.ARB]: Chain.Arbitrum,

  // Testnet; Hop SDK changes the underlying id of these chains according to the instance network
  //network 'goerli'
  [ChainId.GOR]: Chain.Ethereum,
  [ChainId.MUM]: Chain.Polygon,
}

const hopChainsSlugs: { [k: number]: string } = {
  [ChainId.ETH]: 'mainnet',
  [ChainId.POL]: 'polygon',
  [ChainId.DAI]: 'xdai',
  [ChainId.OPT]: 'optimism',
  [ChainId.ARB]: 'arbitrum',
  [ChainId.GOR]: 'mainnet',
  [ChainId.MUM]: 'polygon',
}

const hopTokens: { [k: string]: string } = {
  USDC: Token.USDC,
  USDT: Token.USDT,
  MATIC: Token.MATIC,
  DAI: Token.DAI,
  ETH: Token.ETH,
}

const getSubgraphUrl = (chainId: ChainId): string => {
  const chain = hopChainsSlugs[chainId]

  if (!chain) {
    throw new Error(`Unsupported chainId passed: ${chainId}`)
  }

  return `https://api.thegraph.com/subgraphs/name/hop-protocol/hop-${chain}`
}

const getTransferIdOnSourceChain = async (
  chainId: ChainId,
  txHash: string
): Promise<string> => {
  const url = getSubgraphUrl(chainId)
  const transfersQuery = `
  query ($txHash: String) {
    transfers: transferSents(where: { transactionHash: $txHash } subgraphError: allow) {
      transferId
    }
  }`

  const result = await axios.post<{
    data: { transfers: { transferId: string }[] }
  }>(url, {
    query: transfersQuery,
    variables: { txHash },
  })

  return result.data.data.transfers[0]?.transferId
}

const getTxHashOnReceivingChain = async (
  chainId: ChainId,
  transferId: string
): Promise<string> => {
  const url = getSubgraphUrl(chainId)
  const withdrawsQuery = `
  query ($transferId: ID) {
    withdraws: withdrawalBondeds(where: {transferId: $transferId} subgraphError: allow) {
      transaction {
        hash
      }
    }
  }`

  const result = await axios.post<{
    data: {
      withdraws: { transaction: { hash: string } }[]
    }
  }>(url, {
    query: withdrawsQuery,
    variables: { transferId },
  })

  return result.data.data.withdraws[0]?.transaction.hash
}

const getEthReceiptFromHopSDK = (
  tx: string,
  token: CoinKey,
  fromChainId: ChainId,
  toChainId: ChainId
): Promise<TransactionReceipt> => {
  let hop: Hop
  if (fromChainId === ChainId.GOR) {
    hop = new Hop('goerli')
  } else {
    hop = new Hop('mainnet')
  }

  const hopToChain = hopChains[toChainId]

  return new Promise((resolve, reject) => {
    hop
      ?.watch(tx, hopTokens[token], Chain.Ethereum, hopToChain)
      .once('destinationTxReceipt', async (data: any) => {
        const receipt: TransactionReceipt = data.receipt

        if (receipt.status !== 1) reject('Invalid receipt status')
        if (receipt.status === 1) resolve(receipt)
      })
  })
}

const waitForDestinationChainReceipt = async (
  tx: string,
  token: CoinKey,
  fromChainId: ChainId,
  toChainId: ChainId
): Promise<TransactionReceipt> => {
  if (fromChainId === ChainId.ETH || fromChainId === ChainId.GOR) {
    // case L1->L2:
    // Let's document what we know: On ETH we have `transferId === transactionId`. That allows us to skip the `getTransferIdOnSourceChain` call.
    // However, transfers from ETH do not appear in the L2 subgraphs (yet?).
    // Neither with `withdrawalBondeds` (that's how it usually works), nor with `transferFromL1Completeds` (which sounds exaclty like what we need)
    // For those reasons we will use the Hop SDK for this scenario.
    return getEthReceiptFromHopSDK(tx, token, fromChainId, toChainId)
  } else {
    // case L2->L2 & L2->L1
    const transferId = await repeatUntilDone<string>(() =>
      getTransferIdOnSourceChain(fromChainId, tx)
    )

    const dstTxHash = await repeatUntilDone<string>(() =>
      getTxHashOnReceivingChain(toChainId, transferId)
    )

    const receipt = await loadTransaction(toChainId, dstTxHash)

    return receipt
  }
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
  waitForDestinationChainReceipt,
  parseReceipt,
}

export default hopExport
