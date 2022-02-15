import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'

import { ParsedReceipt } from '../../types'
import { defaultReceiptParsing } from '../utils'

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
  parseReceipt,
}

export default hop
