import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { BigNumber, ethers } from 'ethers'

import { ParsedReceipt } from '../../types'
import { defaultReceiptParsing } from '../utils'

const swappedTypes: Array<ethers.utils.ParamType> = [
  // ethers.utils.ParamType.from({
  //   "indexed": true,
  //   "internalType": "address",
  //   "name": "sender",
  //   "type": "address"
  // }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'amount0In',
    type: 'uint256',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'amount1In',
    type: 'uint256',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'amount0Out',
    type: 'uint256',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'amount1Out',
    type: 'uint256',
  }),
  // ethers.utils.ParamType.from({
  //   "indexed": true,
  //   "internalType": "address",
  //   "name": "to",
  //   "type": "address"
  // }),
]
interface Swapped {
  sender: string
  amount0In: BigNumber
  amount1In: BigNumber
  amount0Out: BigNumber
  amount1Out: BigNumber
  to: string
}

const parseSwappedEvent = (params: { receipt: TransactionReceipt }) => {
  const { receipt } = params

  const result = {
    fromAmount: '0',
    toAmount: '0',
  }

  const decoder = new ethers.utils.AbiCoder()
  receipt.logs.forEach((log) => {
    try {
      const parsed = decoder.decode(
        swappedTypes,
        log.data
      ) as unknown as Swapped
      if (result.fromAmount === '0') {
        result.fromAmount = parsed.amount0In.isZero()
          ? parsed.amount1In.toString()
          : parsed.amount0In.toString()
      }
      result.toAmount = parsed.amount0Out.isZero()
        ? parsed.amount1Out.toString()
        : parsed.amount0Out.toString()
    } catch {
      // ignore, only matching will be parsed
    }
  })

  return result
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

export const uniswap = {
  parseReceipt,
}
