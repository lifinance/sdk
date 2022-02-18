import ERC20 from '@connext/nxtp-contracts/artifacts/contracts/interfaces/IERC20Minimal.sol/IERC20Minimal.json'
import { IERC20Minimal } from '@connext/nxtp-contracts/typechain'
import BigNumber from 'bignumber.js'
import { constants, Contract, ContractTransaction, Signer } from 'ethers'
import { TransactionReceipt, Block } from '@ethersproject/providers'
import { Token } from '@lifinance/types'

import { ChainId, Step } from '../types'
import { getRpcProvider } from '../connectors'

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
  if (step.action.toAddress && step.action.fromAddress) return step

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

export const getApproved = async (
  signer: Signer,
  tokenAddress: string,
  contractAddress: string
): Promise<BigNumber> => {
  const signerAddress = await signer.getAddress()
  const erc20 = new Contract(tokenAddress, ERC20.abi, signer) as IERC20Minimal

  try {
    const approved = await erc20.allowance(signerAddress, contractAddress)
    return new BigNumber(approved.toString())
  } catch (e) {
    return new BigNumber(0)
  }
}

export const setApproval = (
  signer: Signer,
  tokenAddress: string,
  contractAddress: string,
  amount: string
): Promise<ContractTransaction> => {
  const erc20 = new Contract(tokenAddress, ERC20.abi, signer) as IERC20Minimal

  return erc20.approve(contractAddress, amount)
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
  while (floated.lt(1 / 10 ** decimalPlaces)) decimalPlaces++
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
    if (!result) await sleep(timeout)
  }

  return result
}

/**
 * Loads a transaction using the rpc for the given chain id
 * @param chainId The chain id where the transaction should be loaded from
 * @param txHash The hash of the transaction
 * @returns TransactionReceipt
 */
export const loadTransaction = async (
  chainId: ChainId,
  txHash: string
): Promise<TransactionReceipt> => {
  const rpc = getRpcProvider(chainId)
  const tx = await rpc.getTransaction(txHash)
  return tx.wait()
}

export const loadBlock = async (
  chainId: ChainId,
  blockNumber: number
): Promise<Block> => {
  const rpc = getRpcProvider(chainId)
  return rpc.getBlock(blockNumber)
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
