/* eslint-disable max-params */
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { BigNumber, ethers } from 'ethers'

import { ParsedReceipt } from '../../types'

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

const parseReceipt = (
  tx: TransactionResponse,
  receipt: TransactionReceipt
): ParsedReceipt => {
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
  const log = receipt.logs.find((log) => log.address === receipt.to)
  if (log) {
    const parsed = decoder.decode(swappedTypes, log.data) as unknown as Swapped
    result.fromAmount = parsed.spentAmount.toString()
    result.toAmount = parsed.returnAmount.toString()
  }

  return result
}

export const oneinch = {
  parseReceipt,
}
