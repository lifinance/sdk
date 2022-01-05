import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { BigNumber, ethers } from 'ethers'

import { ParsedReceipt } from '../../types'
import { defaultReceiptParsing } from '../utils'

// const SUPPORTED_CHAINS = [1, 56, 137]
const baseURL = 'https://api.1inch.exchange/v3.0/'

const swappedTypes: Array<ethers.utils.ParamType> = [
  ethers.utils.ParamType.from({
    indexed: false,
    name: 'sender',
    type: 'address',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'contract IERC20',
    name: 'srcToken',
    type: 'address',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'contract IERC20',
    name: 'dstToken',
    type: 'address',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'address',
    name: 'dstReceiver',
    type: 'address',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'spentAmount',
    type: 'uint256',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'returnAmount',
    type: 'uint256',
  }),
]
interface Swapped {
  dstReceiver: string
  dstToken: string
  returnAmount: BigNumber
  sender: string
  spentAmount: BigNumber
  srcToken: string
}

const parseSwappedEvent = (params: { receipt: TransactionReceipt }) => {
  const { receipt } = params

  const log = receipt.logs.find((log) => log.address === receipt.to)
  try {
    if (log) {
      const decoder = new ethers.utils.AbiCoder()
      const parsed = decoder.decode(
        swappedTypes,
        log.data
      ) as unknown as Swapped
      return {
        fromAmount: parsed.spentAmount.toString(),
        toAmount: parsed.returnAmount.toString(),
      }
    }
  } catch (e) {}
}

const parseReceipt = async (
  tx: TransactionResponse,
  receipt: TransactionReceipt
): Promise<ParsedReceipt> => {
  let result = {
    fromAmount: '0',
    toAmount: '0',
    gasUsed: '0',
    gasPrice: '0',
    gasFee: '0',
  }

  // value (if native token is sent)
  result.fromAmount = tx.value.toString()

  // swapped event
  result = {
    ...result,
    ...parseSwappedEvent({ receipt }),
  }

  return defaultReceiptParsing({ result, tx, receipt, toAddress: tx.from })
}

export const oneinch = {
  parseReceipt,
}
