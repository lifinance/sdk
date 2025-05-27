import type { ChainId, Token, TokenAmount } from '@lifi/types'
import type { Address } from 'viem'
import {
  getBalance,
  getBlockNumber,
  multicall,
  readContract,
} from 'viem/actions'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import { balanceOfAbi, getEthBalanceAbi } from './abi.js'
import { getPublicClient } from './publicClient.js'
import { getMulticallAddress } from './utils.js'

export const getEVMBalance = async (
  walletAddress: Address,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  if (tokens.length === 0) {
    return []
  }
  const { chainId } = tokens[0]
  for (const token of tokens) {
    if (token.chainId !== chainId) {
      console.warn('Requested tokens have to be on the same chain.')
    }
  }

  const multicallAddress = await getMulticallAddress(chainId)

  if (multicallAddress && tokens.length > 1) {
    return getEVMBalanceMulticall(
      chainId,
      tokens,
      walletAddress,
      multicallAddress
    )
  }
  return getEVMBalanceDefault(chainId, tokens, walletAddress)
}

const getEVMBalanceMulticall = async (
  chainId: ChainId,
  tokens: Token[],
  walletAddress: string,
  multicallAddress: string
): Promise<TokenAmount[]> => {
  const client = await getPublicClient(chainId)

  const contracts = tokens.map((token) => {
    if (isZeroAddress(token.address)) {
      return {
        address: multicallAddress as Address,
        abi: getEthBalanceAbi,
        functionName: 'getEthBalance',
        args: [walletAddress],
      }
    }
    return {
      address: token.address as Address,
      abi: balanceOfAbi,
      functionName: 'balanceOf',
      args: [walletAddress],
    }
  })

  const [blockNumber, results] = await Promise.all([
    getBlockNumber(client),
    multicall(client, {
      contracts,
      multicallAddress: multicallAddress as Address,
    }),
  ])

  if (!results.length) {
    return []
  }

  return tokens.map((token, i: number) => {
    return {
      ...token,
      amount: results[i].result as bigint,
      blockNumber,
    }
  })
}

const getEVMBalanceDefault = async (
  chainId: ChainId,
  tokens: Token[],
  walletAddress: Address
): Promise<TokenAmount[]> => {
  const client = await getPublicClient(chainId)

  const queue: Promise<bigint>[] = tokens.map((token) => {
    if (isZeroAddress(token.address)) {
      return getBalance(client, {
        address: walletAddress as Address,
      })
    }
    return readContract(client, {
      address: token.address as Address,
      abi: balanceOfAbi,
      functionName: 'balanceOf',
      args: [walletAddress],
    }) as Promise<bigint>
  })

  const [blockNumber, results] = await Promise.all([
    getBlockNumber(client),
    Promise.allSettled(queue),
  ])

  const tokenAmounts: TokenAmount[] = tokens.map((token, index) => {
    const result = results[index]
    if (result.status === 'rejected') {
      return {
        ...token,
        blockNumber,
      }
    }
    return {
      ...token,
      amount: result.value,
      blockNumber,
    }
  })
  return tokenAmounts
}
