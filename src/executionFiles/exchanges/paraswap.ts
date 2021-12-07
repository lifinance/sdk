/* eslint-disable max-params */
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'

import { ParsedReceipt } from '../../types'

// event Swapped(
//   bytes16 uuid,
//   address initiator,
//   address indexed beneficiary,
//   address indexed srcToken,
//   address indexed destToken,
//   uint256 srcAmount,
//   uint256 receivedAmount,
//   uint256 expectedAmount
// )
const swappedTypes: Array<ethers.utils.ParamType> = [
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'bytes16',
    name: 'uuid',
    type: 'bytes16',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'address',
    name: 'initiator',
    type: 'address',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'srcAmount',
    type: 'uint256',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'receivedAmount',
    type: 'uint256',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'expectedAmount',
    type: 'uint256',
  }),
]
interface Swapped {
  initiator: string
  srcAmount: BigNumber
  receivedAmount: BigNumber
  expectedAmount: BigNumber
  referrer: string
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

  // gas
  result.gasUsed = receipt.gasUsed.toString()
  result.gasPrice = tx.gasPrice?.toString() || '0'
  result.gasFee = receipt.gasUsed.mul(result.gasPrice).toString()

  // log
  const decoder = new ethers.utils.AbiCoder()
  receipt.logs
    .filter((log) => log.address === receipt.to)
    .forEach((log) => {
      try {
        const parsed = decoder.decode(
          swappedTypes,
          log.data
        ) as unknown as Swapped
        result.fromAmount = parsed.srcAmount.toString()
        result.toAmount = parsed.receivedAmount.toString()
      } catch (e) {
        // find right log by trying to parse them
      }
    })

  return result
}

export const paraswap = {
  parseReceipt,
}
