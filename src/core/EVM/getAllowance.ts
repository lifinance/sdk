import type { BaseToken, ChainId } from '@lifi/types'
import type { Address, Client } from 'viem'
import { multicall, readContract } from 'viem/actions'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import { allowanceAbi } from './abi.js'
import { getActionWithFallback } from './getActionWithFallback.js'
import { getPublicClient } from './publicClient.js'
import type {
  TokenAllowance,
  TokenSpender,
  TokenSpenderAllowance,
} from './types.js'
import { getMulticallAddress } from './utils.js'

export const getAllowance = async (
  client: Client,
  tokenAddress: Address,
  ownerAddress: Address,
  spenderAddress: Address
): Promise<bigint> => {
  try {
    const approved = await getActionWithFallback(
      client,
      readContract,
      'readContract',
      {
        address: tokenAddress as Address,
        abi: allowanceAbi,
        functionName: 'allowance' as const,
        args: [ownerAddress, spenderAddress] as const,
      }
    )
    return approved
  } catch (_e) {
    return 0n
  }
}

export const getAllowanceMulticall = async (
  client: Client,
  chainId: ChainId,
  tokens: TokenSpender[],
  ownerAddress: Address
): Promise<TokenSpenderAllowance[]> => {
  if (!tokens.length) {
    return []
  }
  const multicallAddress = await getMulticallAddress(chainId)
  if (!multicallAddress) {
    throw new Error(`No multicall address configured for chainId ${chainId}.`)
  }

  const contracts = tokens.map((token) => ({
    address: token.token.address as Address,
    abi: allowanceAbi,
    functionName: 'allowance',
    args: [ownerAddress, token.spenderAddress],
  }))

  const results = await getActionWithFallback(client, multicall, 'multicall', {
    contracts,
    multicallAddress: multicallAddress as Address,
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

/**
 * Get the current allowance for a certain token.
 * @param token - The token that should be checked
 * @param ownerAddress - The owner of the token
 * @param spenderAddress - The spender address that has to be approved
 * @returns Returns allowance
 */
export const getTokenAllowance = async (
  token: BaseToken,
  ownerAddress: Address,
  spenderAddress: Address
): Promise<bigint | undefined> => {
  // native token don't need approval
  if (isZeroAddress(token.address)) {
    return
  }

  const client = await getPublicClient(token.chainId)

  const approved = await getAllowance(
    client,
    token.address as Address,
    ownerAddress,
    spenderAddress
  )
  return approved
}

/**
 * Get the current allowance for a list of token/spender address pairs.
 * @param ownerAddress - The owner of the tokens
 * @param tokens - A list of token and spender address pairs
 * @returns Returns array of tokens and their allowance
 */
export const getTokenAllowanceMulticall = async (
  ownerAddress: Address,
  tokens: TokenSpender[]
): Promise<TokenAllowance[]> => {
  // filter out native tokens
  const filteredTokens = tokens.filter(
    ({ token }) => !isZeroAddress(token.address)
  )

  // group by chain
  const tokenDataByChain: { [chainId: number]: TokenSpender[] } = {}
  for (const data of filteredTokens) {
    if (!tokenDataByChain[data.token.chainId]) {
      tokenDataByChain[data.token.chainId] = []
    }
    tokenDataByChain[data.token.chainId].push(data)
  }

  const chainKeys = Object.keys(tokenDataByChain).map(Number.parseInt)

  const allowances = (
    await Promise.all(
      chainKeys.map(async (chainId) => {
        const client = await getPublicClient(chainId)
        // get allowances for current chain and token list
        return getAllowanceMulticall(
          client,
          chainId,
          tokenDataByChain[chainId],
          ownerAddress
        )
      })
    )
  ).flat()

  return allowances
}
