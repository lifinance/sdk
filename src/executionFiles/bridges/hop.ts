import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import axios from 'axios'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'

import { ChainId, CoinKey, ParsedReceipt } from '../../types'
import { loadBlock, loadTransaction, repeatUntilDone } from '../../utils/utils'
import { defaultReceiptParsing } from '../utils'

const waitForDestinationChainReceipt = async (
  txHash: string,
  token: CoinKey,
  fromChainId: ChainId,
  toChainId: ChainId
): Promise<TransactionReceipt> => {
  if (fromChainId === ChainId.ETH || fromChainId === ChainId.GOR) {
    // case L1->L2:
    return waitForDestinationChainReceiptL1toL2(
      txHash,
      token,
      fromChainId,
      toChainId
    )
  } else {
    // case L2->L2 & L2->L1
    return waitForDestinationChainReceiptL2toX(
      txHash,
      token,
      fromChainId,
      toChainId
    )
  }
}

//// L1 to L2

type TransactionData = {
  recipent: string
  amount: string
  timestamp: string
  deadline: string
}
const waitForDestinationChainReceiptL1toL2 = async (
  txHash: string,
  token: CoinKey,
  fromChainId: ChainId,
  toChainId: ChainId
) => {
  // get sending params
  const transferData = await repeatUntilDone<TransactionData>(() =>
    getTransactionSentL1toL2Data(txHash, fromChainId)
  )

  // find receiving transfer
  const dstTxHash = await repeatUntilDone<string>(() =>
    getTxHashOnReceivingChainL1toL2(
      toChainId,
      transferData.recipent,
      transferData.amount,
      token,
      transferData.timestamp,
      transferData.deadline
    )
  )

  return loadTransaction(toChainId, dstTxHash)
}

const getTransactionSentL1toL2Data = async (
  txHash: string,
  fromChainId: ChainId
): Promise<TransactionData | undefined> => {
  try {
    const receipt = await loadTransaction(fromChainId, txHash)
    const parsed = parseTransferSentL1toL2Event(receipt)
    const block = await loadBlock(fromChainId, receipt.blockNumber)

    return {
      ...parsed,
      timestamp: block.timestamp.toString(),
    }
  } catch (e) {
    return undefined
  }
}

const parseTransferSentL1toL2Event = (receipt: TransactionReceipt) => {
  const abiTokenSent = [
    'event TransferSentToL2(uint256 indexed chainId, address indexed recipient, uint256 amount, ' +
      'uint256 amountOutMin, uint256 deadline, address indexed relayer, uint256 relayerFee)',
  ]
  const interfaceTokenSent = new ethers.utils.Interface(abiTokenSent)
  for (const log of receipt.logs) {
    try {
      const parsed = interfaceTokenSent.parseLog(log)
      return {
        recipent: parsed.args['recipient'],
        amount: parsed.args['amount'].toString(),
        amountOutMin: parsed.args['amountOutMin'].toString(),
        deadline: parsed.args['deadline'].toString(),
      }
    } catch (e) {
      // find right log by trying to parse them
    }
  }

  throw new Error('Unable to parse transaction.')
}

const getTxHashOnReceivingChainL1toL2 = async (
  toChainId: ChainId,
  recipent: string,
  amount: string,
  token: CoinKey,
  timestamp: string,
  deadline: string
) => {
  const events = await getTxOnReceivingChainL1toL2(toChainId, recipent)

  // The user may have made multiple transfers using hop, find the first matching one
  const event = events.find((evt) => {
    return (
      evt.amount === amount &&
      evt.token === token &&
      evt.timestamp > timestamp && // has to happen after the transfer has started
      evt.timestamp < deadline // has to happen before the configured deadline
    )
  })
  return event?.transactionHash
}

type TransferFromL1Completed = {
  timestamp: string
  amount: string
  transactionHash: string
  token: string
}
const getTxOnReceivingChainL1toL2 = async (
  chainId: ChainId,
  recipient: string
): Promise<TransferFromL1Completed[]> => {
  const url = getSubgraphUrl(chainId)
  const withdrawsQuery = `
  query ($recipient: ID) {
    transferFromL1Completeds: transferFromL1Completeds(where: {recipient: $recipient} subgraphError: allow) {
      timestamp
      amount
      transactionHash
      token
    }
  }`

  const result = await axios.post<{
    data: {
      transferFromL1Completeds: TransferFromL1Completed[]
    }
  }>(url, {
    query: withdrawsQuery,
    variables: {
      recipient: recipient.toLowerCase(),
    },
  })

  return result.data.data.transferFromL1Completeds
}

//// L2 to X

const waitForDestinationChainReceiptL2toX = async (
  txHash: string,
  token: CoinKey,
  fromChainId: ChainId,
  toChainId: ChainId
) => {
  const transferId = await repeatUntilDone<string>(() =>
    getTransferIdOnSourceChain(fromChainId, txHash)
  )

  const dstTxHash = await repeatUntilDone<string>(() =>
    getTxHashOnReceivingChain(toChainId, transferId)
  )

  return loadTransaction(toChainId, dstTxHash)
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

//// Other

const getSubgraphUrl = (chainId: ChainId): string => {
  const hopChainsSlugs: { [k: number]: string } = {
    [ChainId.ETH]: 'mainnet',
    [ChainId.POL]: 'polygon',
    [ChainId.DAI]: 'xdai',
    [ChainId.OPT]: 'optimism',
    [ChainId.ARB]: 'arbitrum',

    // Testnets
    [ChainId.GOR]: 'mainnet',
    [ChainId.MUM]: 'polygon',
  }
  const chain = hopChainsSlugs[chainId]

  if (!chain) {
    throw new Error(`Unsupported chainId passed: ${chainId}`)
  }

  return `https://api.thegraph.com/subgraphs/name/hop-protocol/hop-${chain}`
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

const hop = {
  waitForDestinationChainReceipt,
  parseReceipt,
}

export default hop
