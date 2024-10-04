import type { BaseToken, ChainId } from '@lifi/types'
import type { Address } from 'viem'
import { multicall, readContract } from 'viem/actions'
import { isNativeTokenAddress } from '../../utils/isZeroAddress.js'
import { allowanceAbi } from './abi.js'
import { getPublicClient } from './publicClient.js'
import type {
  TokenAllowance,
  TokenSpender,
  TokenSpenderAllowance,
} from './types.js'
import { getMulticallAddress } from './utils.js'

export const getAllowance = async (
  chainId: ChainId,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint> => {
  const client = await getPublicClient(chainId)
  try {
    const approved = (await readContract(client, {
      address: tokenAddress as Address,
      abi: allowanceAbi,
      functionName: 'allowance',
      args: [ownerAddress, spenderAddress],
    })) as bigint
    return approved
  } catch (_e) {
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

  const results = await multicall(client, {
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

/**
 * Get the current allowance for a list of token/spender address pairs.
 * @param ownerAddress - The owner of the tokens
 * @param tokens - A list of token and spender address pairs
 * @returns Returns array of tokens and their allowance
 */
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
