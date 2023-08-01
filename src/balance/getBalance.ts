import type { ChainId, Token, TokenAmount } from '@lifi/types'
import type { Address } from 'viem'
import { getMulticallAddress, getPublicClient } from '../connectors'
import { MulticallBatchSize } from '../constants'
import { balanceOfAbi, getEthBalanceAbi } from '../types'
import { isZeroAddress } from '../utils/utils'

export const getBalance = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  if (tokens.length === 0) {
    return []
  }
  const { chainId } = tokens[0]
  tokens.forEach((token) => {
    if (token.chainId !== chainId) {
      console.warn(`Requested tokens have to be on the same chain.`)
      return []
    }
  })

  const multicallAddress = await getMulticallAddress(chainId)

  if (multicallAddress && tokens.length > 1) {
    return getBalanceMulticall(chainId, tokens, walletAddress, multicallAddress)
  } else {
    return getBalanceDefault(chainId, tokens, walletAddress)
  }
}

const getBalanceMulticall = async (
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
  const blockNumber = await client.getBlockNumber()
  const results = await client.multicall({
    contracts,
    multicallAddress: multicallAddress as Address,
    blockNumber,
    batchSize: MulticallBatchSize,
  })

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

const getBalanceDefault = async (
  chainId: ChainId,
  tokens: Token[],
  walletAddress: string
): Promise<TokenAmount[]> => {
  const client = await getPublicClient(chainId)
  const blockNumber = await client.getBlockNumber()
  const queue: Promise<bigint>[] = tokens.map((token) => {
    if (isZeroAddress(token.address)) {
      return client.getBalance({
        address: walletAddress as Address,
      })
    }
    return client.readContract({
      address: token.address as Address,
      abi: balanceOfAbi,
      functionName: 'balanceOf',
      args: [walletAddress],
    }) as Promise<bigint>
  })

  const results = await Promise.allSettled(queue)

  const tokenAmounts: TokenAmount[] = tokens.map((token, index) => {
    const result = results[index]
    if (result.status === 'rejected') {
      console.warn(result.reason)
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
