import axios from 'axios'
import { BigNumber, ethers } from 'ethers'
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'

import {
  CrossStep,
  findWrappedGasOnChain,
  LifiStep,
  ParsedReceipt,
} from '../../types'
import { sleep } from '../../utils/utils'
import { getRpcProvider } from '../../connectors'
import { defaultReceiptParsing } from '../utils'

const apiUrl = 'https://cbridge-prod2.celer.network/v1/'

enum TransferHistoryStatus {
  TRANSFER_UNKNOWN = 0,
  TRANSFER_SUBMITTING = 1,
  TRANSFER_FAILED = 2,
  TRANSFER_WAITING_FOR_SGN_CONFIRMATION = 3,
  TRANSFER_WAITING_FOR_FUND_RELEASE = 4,
  TRANSFER_COMPLETED = 5,
  TRANSFER_TO_BE_REFUNDED = 6,
  TRANSFER_REQUESTING_REFUND = 7,
  TRANSFER_REFUND_TO_BE_CONFIRMED = 8,
  TRANSFER_CONFIRMING_YOUR_REFUND = 9,
  TRANSFER_REFUNDED = 10,
}

enum XferStatus {
  UNKNOWN = 0,
  OK_TO_RELAY = 1,
  SUCCESS = 2,
  BAD_LIQUIDITY = 3,
  BAD_SLIPPAGE = 4,
  BAD_TOKEN = 5,
  REFUND_REQUESTED = 6,
  REFUND_DONE = 7,
  BAD_XFER_DISABLED = 8,
  BAD_DEST_CHAIN = 9,
}

type cChain = {
  id: number
  name: string
  icon: string
  block_delay: number
  gas_token_symbol: string
  explore_url: string
  rpc_url: string
  contract_addr: string
}

type cToken = {
  symbol: string
  address: string
  decimal: number
  xfer_disabled: boolean
}

type cTransferInfo = {
  chain?: cChain
  token?: cToken
  amount: string
}
type cTransferHistory = {
  transfer_id: string
  src_send_info?: cTransferInfo
  dst_received_info?: cTransferInfo
  ts: number
  src_block_tx_link: string
  dst_block_tx_link: string
  status: TransferHistoryStatus
  refund_reason: XferStatus
}

const getTransferHistory = async (userAddress: string) => {
  interface resultType {
    err: null
    current_size: string
    history: cTransferHistory[]
    next_page_token: string
  }

  const params = {
    addr: userAddress,
    page_size: 50,
    next_page_token: undefined,
  }
  const { data } = await axios.get<resultType>(apiUrl + 'transferHistory', {
    params,
  })

  return data.history
}

const waitForCompletion = async (
  step: CrossStep | LifiStep
): Promise<cTransferHistory> => {
  // check
  if (!step.estimate.data.initiator) {
    throw new Error('cBridges requires initiator to find transfer')
  }
  if (!step.estimate.data.transferId) {
    throw new Error('cBridge requires transferId to find transfer')
  }

  // loop
  while (true) {
    // get Details
    const history = await getTransferHistory(
      step.estimate.data.initiator
    ).catch(() => [])
    const details = history.find(
      (entry) => entry.transfer_id === step.estimate.data.transferId
    )

    // check Result
    if (
      details &&
      details.status === TransferHistoryStatus.TRANSFER_COMPLETED
    ) {
      return details
    }

    // Wait until next call
    await sleep(10 * 1000)
  }
}

const waitForDestinationChainReceipt = async (
  step: CrossStep | LifiStep
): Promise<{
  tx: ethers.providers.TransactionResponse
  receipt: ethers.providers.TransactionReceipt
}> => {
  const history = await waitForCompletion(step)

  try {
    const urlParts = history.dst_block_tx_link.split('/')
    const txHash = urlParts[urlParts.length - 1]
    const rpc = getRpcProvider(step.action.toChainId)
    const tx = await rpc.getTransaction(txHash)
    const receipt = await tx.wait()
    return {
      tx,
      receipt,
    }
  } catch (e) {
    // transaction may not be included in our RPC yet
    return waitForDestinationChainReceipt(step)
  }
}

const parseRelayEvent = (params: {
  tx: TransactionResponse
  receipt: TransactionReceipt
}) => {
  const { tx, receipt } = params

  const abiRelay = [
    'event Relay(bytes32 transferId, address sender, address receiver, ' +
      'address token, uint256 amount, uint64 srcChainId, bytes32 srcTransferId )',
  ]
  const interfaceRelay = new ethers.utils.Interface(abiRelay)
  let result
  for (const log of receipt.logs) {
    try {
      const parsed = interfaceRelay.parseLog(log)
      const amount = parsed.args.amount as BigNumber
      const token = (parsed.args.token as string).toLowerCase()
      const wrapped = findWrappedGasOnChain(tx.chainId)
      result = {
        toAmount: amount.toString(),
        toTokenAddress:
          wrapped.address === token ? ethers.constants.AddressZero : token,
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

  // > Relay
  result = {
    ...result,
    ...parseRelayEvent({ tx, receipt }),
  }

  return defaultReceiptParsing({ result, tx, receipt, toAddress })
}

const cbridge = {
  waitForDestinationChainReceipt,
  parseReceipt,
}

export default cbridge
