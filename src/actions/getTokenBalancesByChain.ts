import type {
  Token,
  TokenAmount,
  TokenAmountExtended,
  TokenExtended,
} from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { isToken } from '../typeguards.js'
import type { SDKClient } from '../types/core.js'

/**
 * This method queries the balances of tokens for a specific list of chains for a given wallet.
 * @param client - The SDK client.
 * @param walletAddress - A wallet address.
 * @param tokensByChain - A list of token objects organized by chain ids.
 * @returns A list of objects containing the tokens and the amounts on different chains organized by the chosen chains.
 * @throws {ValidationError} Throws a ValidationError if validation fails.
 * @throws {Error} Throws an Error if the SDK Provider for the wallet address is not found.
 */
export async function getTokenBalancesByChain(
  client: SDKClient,
  walletAddress: string,
  tokensByChain: { [chainId: number]: Token[] }
): Promise<{ [chainId: number]: TokenAmount[] }>
export async function getTokenBalancesByChain(
  client: SDKClient,
  walletAddress: string,
  tokensByChain: { [chainId: number]: TokenExtended[] }
): Promise<{ [chainId: number]: TokenAmountExtended[] }> {
  if (!walletAddress) {
    throw new ValidationError('Missing walletAddress.')
  }

  const tokenList = Object.values(tokensByChain).flat()
  const invalidTokens = tokenList.filter((token) => !isToken(token))
  if (invalidTokens.length) {
    throw new ValidationError('Invalid tokens passed.')
  }

  const provider = client.providers.find((provider) =>
    provider.isAddress(walletAddress)
  )
  if (!provider) {
    throw new Error(`SDK Token Provider for ${walletAddress} is not found.`)
  }

  const tokenAmountsByChain: {
    [chainId: number]: TokenAmount[] | TokenAmountExtended[]
  } = {}
  const tokenAmountsSettled = await Promise.allSettled(
    Object.keys(tokensByChain).map(async (chainIdStr) => {
      const chainId = Number.parseInt(chainIdStr, 10)
      const chain = await client.getChainById(chainId)
      if (provider.type === chain.chainType) {
        const tokenAmounts = await provider.getBalance(
          client,
          walletAddress,
          tokensByChain[chainId]
        )
        tokenAmountsByChain[chainId] = tokenAmounts
      } else {
        // if the provider is not the same as the chain type,
        // return the tokens as is
        tokenAmountsByChain[chainId] = tokensByChain[chainId]
      }
    })
  )
  if (client.config.debug) {
    for (const result of tokenAmountsSettled) {
      if (result.status === 'rejected') {
        console.warn("Couldn't fetch token balance.", result.reason)
      }
    }
  }
  return tokenAmountsByChain
}
