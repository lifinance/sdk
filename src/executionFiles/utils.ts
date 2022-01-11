import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { ethers } from 'ethers'
import { ChainId, ParsedReceipt } from '..'
import { getRpcProvider } from '../connectors'

export const defaultReceiptParsing = async (params: {
  result: ParsedReceipt
  tx: TransactionResponse
  receipt: TransactionReceipt
  toAddress: string
}) => {
  let result = params.result
  const { tx, receipt, toAddress } = params

  // transferred ERC20 in
  const ercFrom = getTransferredTokenBalance({
    receipt,
    fromAddress: toAddress,
  })
  if (ercFrom?.toAmount) {
    result.fromAmount = ercFrom.toAmount
  }

  // transferred ERC20 out
  result = {
    ...result,
    ...getTransferredTokenBalance({ receipt, toAddress }),
  }

  // transferred Native Token
  if (result.toAmount === '0') {
    result = {
      ...result,
      ...(await getTransferredNativeTokenBalance({ tx, receipt, toAddress })),
    }
  }

  // gas
  result = {
    ...result,
    ...getUsedGas({ tx, receipt }),
  }
  return result
}

export const getUsedGas = (params: {
  tx: TransactionResponse
  receipt: TransactionReceipt
}) => {
  const { tx, receipt } = params

  const gasUsed = receipt.gasUsed.toString()
  const gasPrice = tx.gasPrice?.toString() || '0'
  const gasFee = receipt.gasUsed.mul(gasPrice).toString()

  return {
    gasFee,
    gasPrice,
    gasUsed,
  }
}

export const getTransferredNativeTokenBalance = async (params: {
  tx: TransactionResponse
  receipt: TransactionReceipt
  toAddress: string
}) => {
  const { tx, receipt, toAddress } = params

  if (tx.chainId === ChainId.POL && toAddress) {
    const result = getTransferredNativeTokenBalanceFromLog({
      receipt,
      toAddress,
    })
    if (result) {
      return result
    }
  }

  return getTransferredNativeTokenBalanceFromChain({ tx, receipt, toAddress })
}

export const getTransferredNativeTokenBalanceFromChain = async (params: {
  tx: TransactionResponse
  receipt: TransactionReceipt
  toAddress: string
}) => {
  const { tx, receipt, toAddress } = params

  // try to load gas balance differences
  try {
    const provider = getRpcProvider(tx.chainId, true)
    const providerBlockNumber = await provider.getBlockNumber()
    if (tx.blockNumber && providerBlockNumber) {
      const balanceBefore = await provider.getBalance(
        toAddress,
        tx.blockNumber - providerBlockNumber - 1
      )
      const balanceAfter = await provider.getBalance(
        toAddress,
        tx.blockNumber - providerBlockNumber
      )
      const balanceDiff = balanceAfter.sub(balanceBefore)

      if (balanceDiff.isZero()) {
        return
      }

      let amount = '0'
      if (tx.from === toAddress) {
        // substract gas payed for transaction
        const gas = getUsedGas({ tx, receipt })
        const diffWithoutGas = balanceDiff.add(gas.gasFee)
        amount = diffWithoutGas.toString()
      } else {
        amount = balanceDiff.toString()
      }

      return {
        toTokenAddress: ethers.constants.AddressZero,
        fromAddress: tx.from.toLowerCase(),
        toAddress: toAddress,
        toAmount: amount,
      }
    }
  } catch (e) {}
}

export const getTransferredNativeTokenBalanceFromLog = (params: {
  receipt: TransactionReceipt
  toAddress: string
}) => {
  const { receipt, toAddress } = params

  const abi = [
    `event LogTransfer(
          address indexed token,
          address indexed from,
          address indexed to,
          uint256 amount,
          uint256 input1,
          uint256 input2,
          uint256 output1,
          uint256 output2
    )`,
  ]
  const interfaceGas = new ethers.utils.Interface(abi)
  for (const log of receipt.logs) {
    try {
      const parsed = interfaceGas.parseLog(log)
      const result = {
        tokenAddress: log.address.toLowerCase(),
        fromAddress: parsed.args['from'].toLowerCase(),
        toAddress: parsed.args['to'].toLowerCase(),
        toAmount: parsed.args['value'].toString(),
      }

      if (toAddress && result.toAddress !== toAddress.toLowerCase()) {
        continue
      }

      return result
    } catch (e) {
      // find right log by trying to parse them
    }
  }
}

export const getTransferredTokenBalance = (params: {
  receipt: TransactionReceipt
  fromAddress?: string
  toAddress?: string
  tokenAddress?: string
}) => {
  const { receipt, fromAddress, toAddress, tokenAddress } = params

  const abiTransfer = [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]
  const interfaceTransfer = new ethers.utils.Interface(abiTransfer)

  const results = receipt.logs.map((log) => {
    try {
      const parsed = interfaceTransfer.parseLog(log)
      const result = {
        toTokenAddress: log.address.toLowerCase(),
        fromAddress: parsed.args['from'].toLowerCase(),
        toAddress: parsed.args['to'].toLowerCase(),
        toAmount: parsed.args['value'].toString(),
      }

      if (fromAddress && result.fromAddress !== fromAddress.toLowerCase()) {
        return
      }

      if (toAddress && result.toAddress !== toAddress.toLowerCase()) {
        return
      }

      if (
        tokenAddress &&
        result.toTokenAddress !== tokenAddress.toLowerCase()
      ) {
        return
      }

      return result
    } catch (e) {
      // find right log by trying to parse them
    }
  })

  const cleandedResults = results.filter((result) => result !== undefined)
  if (cleandedResults.length) {
    if (fromAddress) {
      // return first token moved to user
      return cleandedResults[0]
    } else {
      // return last token moved to user
      return cleandedResults[cleandedResults.length - 1]
    }
  }
}
