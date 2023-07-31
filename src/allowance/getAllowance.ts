import type { ChainId, Token } from '@lifi/types'
import type { Address } from 'viem'
import { getContract } from 'viem'
import { getMulticallAddress, getPublicClient } from '../connectors'
import { MulticallBatchSize } from '../constants'
import { allowanceAbi } from '../types'
import { isNativeTokenAddress } from '../utils/utils'
import type {
  TokenAllowance,
  TokenSpender,
  TokenSpenderAllowance,
} from './types'

export const getAllowance = async (
  chainId: ChainId,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint> => {
  const client = await getPublicClient(chainId)
  const contract = getContract({
    address: tokenAddress as Address,
    abi: allowanceAbi,
    publicClient: client,
  })

  try {
    const approved = (await contract.read.allowance([
      ownerAddress,
      spenderAddress,
    ])) as bigint
    return approved
  } catch (e) {
    return 0n
  }
}

export const getAllowanceMulticall = async (
  chainId: ChainId,
  tokens: TokenSpender[],
  ownerAddress: string
): Promise<TokenSpenderAllowance[]> => {
  if (!tokens.length) {
    return []
  }
  const multicallAddress = await getMulticallAddress(chainId)
  if (!multicallAddress) {
    throw new Error(`No multicall address configured for chainId ${chainId}.`)
  }

  const client = await getPublicClient(chainId)

  const contracts = tokens.map((token) => ({
    address: token.token.address as Address,
    abi: allowanceAbi,
    functionName: 'allowance',
    args: [ownerAddress, token.spenderAddress],
  }))

  const results = await client.multicall({
    contracts,
    multicallAddress: multicallAddress as Address,
    batchSize: MulticallBatchSize,
  })

  if (!results.length) {
    throw new Error(
      `Couldn't load allowance from chainId ${chainId} using multicall.`
    )
  }

  return tokens.map(({ token, spenderAddress }, i: number) => ({
    token,
    spenderAddress,
    allowance: results[i].result as bigint,
  }))
}

export const getTokenAllowance = async (
  token: Token,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint | undefined> => {
  // native token don't need approval
  if (isNativeTokenAddress(token.address)) {
    return
  }

  const approved = await getAllowance(
    token.chainId,
    token.address,
    ownerAddress,
    spenderAddress
  )
  return approved
}

export const getTokenAllowanceMulticall = async (
  ownerAddress: string,
  tokens: TokenSpender[]
): Promise<TokenAllowance[]> => {
  // filter out native tokens
  const filteredTokens = tokens.filter(
    ({ token }) => !isNativeTokenAddress(token.address)
  )

  // group by chain
  const tokenDataByChain: { [chainId: number]: TokenSpender[] } = {}
  filteredTokens.forEach((data) => {
    if (!tokenDataByChain[data.token.chainId]) {
      tokenDataByChain[data.token.chainId] = []
    }
    tokenDataByChain[data.token.chainId].push(data)
  })

  const chainKeys = Object.keys(tokenDataByChain).map(Number.parseInt)

  const allowances = (
    await Promise.all(
      chainKeys.map(async (chainId) => {
        // get allowances for current chain and token list
        return getAllowanceMulticall(
          chainId,
          tokenDataByChain[chainId],
          ownerAddress
        )
      })
    )
  ).flat()

  return allowances
}
