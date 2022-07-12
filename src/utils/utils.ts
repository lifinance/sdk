import { TransactionReceipt } from '@ethersproject/providers'
import { Token } from '@lifi/types'
import BigNumber from 'bignumber.js'
import { constants, Signer } from 'ethers'

import { getRpcProvider } from '../connectors'
import { ChainId, Step } from '../types'

export const deepClone = <T>(src: T): T => {
  return JSON.parse(JSON.stringify(src))
}

export const sleep = (mills: number): Promise<undefined> => {
  return new Promise((resolve) => {
    setTimeout(resolve, mills)
  })
}

export const personalizeStep = async (
  signer: Signer,
  step: Step
): Promise<Step> => {
  if (step.action.toAddress && step.action.fromAddress) {
    return step
  }

  const address = await signer.getAddress()
  const fromAddress = step.action.fromAddress || address
  const toAddress = step.action.toAddress || address

  return {
    ...step,
    action: {
      ...step.action,
      fromAddress,
      toAddress,
    },
  }
}

export const splitListIntoChunks = <T>(list: T[], chunkSize: number): T[][] =>
  list.reduce((resultList: T[][], item, index) => {
    const chunkIndex = Math.floor(index / chunkSize)

    if (!resultList[chunkIndex]) {
      resultList[chunkIndex] = [] // start a new chunk
    }

    resultList[chunkIndex].push(item)

    return resultList
  }, [])

export const formatTokenAmountOnly = (
  token: Token,
  amount: string | BigNumber | undefined
) => {
  if (!amount) {
    return '0.0'
  }

  let floated
  if (typeof amount === 'string') {
    if (amount === '0') {
      return '0.0'
    }

    floated = new BigNumber(amount).shiftedBy(-token.decimals)
  } else {
    floated = amount

    if (floated.isZero()) {
      return '0.0'
    }
  }

  // show at least 4 decimal places and at least two non-zero digests
  let decimalPlaces = 3
  while (floated.lt(1 / 10 ** decimalPlaces)) {
    decimalPlaces++
  }
  return floated.toFixed(decimalPlaces + 1, 1)
}

/**
 * Repeatedly calls a given asynchronous function until it resolves with a value
 * @param toRepeat The function that should be repeated
 * @param timeout The timeout in milliseconds between retries, defaults to 5000
 * @returns The result of the toRepeat function
 */
export const repeatUntilDone = async <T>(
  toRepeat: () => Promise<T | undefined>,
  timeout = 5000
): Promise<T> => {
  let result: T | undefined

  while (!result) {
    result = await toRepeat()
    if (!result) {
      await sleep(timeout)
    }
  }

  return result
}

/**
 * Loads a transaction receipt using the rpc for the given chain id
 * @param chainId The chain id where the transaction should be loaded from
 * @param txHash The hash of the transaction
 * @returns TransactionReceipt
 */
export const loadTransactionReceipt = async (
  chainId: ChainId,
  txHash: string
): Promise<TransactionReceipt> => {
  const rpc = await getRpcProvider(chainId)
  const tx = await rpc.getTransaction(txHash)
  return tx.wait()
}

export const isZeroAddress = (address: string): boolean => {
  if (
    address === constants.AddressZero ||
    address === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  ) {
    return true
  }
  return false
}
