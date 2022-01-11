import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'

import { ChainId, ParsedReceipt } from '../../types'
import { defaultReceiptParsing } from '../utils'

// Swapped event for actually swapped token, but then a fee is deducted
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

const parseSwappedEvent = (params: {
  tx: TransactionResponse
  receipt: TransactionReceipt
}) => {
  const { tx, receipt } = params

  const decoder = new ethers.utils.AbiCoder()
  const logs = receipt.logs.filter((log) => log.address === receipt.to)

  for (const log of logs) {
    try {
      const parsed = decoder.decode(
        swappedTypes,
        log.data
      ) as unknown as Swapped
      if (tx.chainId === ChainId.ETH) {
        // really no fees taken?
        return {
          fromAmount: parsed.srcAmount.toString(),
          toAmount: parsed.receivedAmount.toString(),
        }
      } else {
        // skip other chains, because swapped valued may be higher than the actual transferrerd value
        return {
          fromAmount: parsed.srcAmount.toString(),
        }
      }
    } catch (e) {
      // find right log by trying to parse them
    }
  }
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
    ...parseSwappedEvent({ tx, receipt }),
  }

  return defaultReceiptParsing({ result, tx, receipt, toAddress: tx.from })
}

export const paraswap = {
  parseReceipt,
}
