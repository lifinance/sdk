import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { BigNumber, ethers } from 'ethers'

import { ParsedReceipt } from '../../types'

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

const parseReceipt = async (
  tx: TransactionResponse,
  receipt: TransactionReceipt
): Promise<ParsedReceipt> => {
  const result = {
    fromAmount: '0',
    toAmount: '0',
    gasUsed: '0',
    gasPrice: '0',
    gasFee: '0',
  }
  const decoder = new ethers.utils.AbiCoder()

  // gas
  result.gasUsed = receipt.gasUsed.toString()
  result.gasPrice = tx.gasPrice?.toString() || '0'
  result.gasFee = receipt.gasUsed.mul(result.gasPrice).toString()

  // log
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

export const uniswap = {
  parseReceipt,
}
