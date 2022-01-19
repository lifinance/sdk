/* eslint-disable max-params */
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import axios from 'axios'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'

import { ChainId, ParsedReceipt } from '../../types'
import { loadTransaction, repeatUntilDone } from '../../utils'
import { defaultReceiptParsing } from '../utils'

const hopChains: { [k: number]: string } = {
  [ChainId.ETH]: 'ethereum',
  [ChainId.POL]: 'polygon',
  [ChainId.DAI]: 'xdai',
  [ChainId.OPT]: 'optimism',
  [ChainId.ARB]: 'arbitrum',

  // Testnet; Hop SDK changes the underlying id of these chains according to the instance network
  //network 'goerli'
  [ChainId.GOR]: 'ethereum',
  [ChainId.MUM]: 'polygon',
}

const getSubgraphUrl = (chainId: ChainId): string => {
  const chain = hopChains[chainId]

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

const waitForDestinationChainReceipt = async (
  tx: string,
  fromChainId: ChainId,
  toChainId: ChainId
): Promise<TransactionReceipt> => {
  const transferId = await repeatUntilDone<string>(() =>
    getTransferIdOnSourceChain(fromChainId, tx)
  )

  const dstTxHash = await repeatUntilDone<string>(() =>
    getTxHashOnReceivingChain(toChainId, transferId)
  )

  const receipt = await loadTransaction(toChainId, dstTxHash)

  return receipt
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
