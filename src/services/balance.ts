import { ChainType, type Token, type TokenAmount } from '@lifi/types'
import { config } from '../config.js'
import { ValidationError } from '../errors/errors.js'
import { isToken } from '../typeguards.js'

/**
 * Returns the balances of a specific token a wallet holds across all aggregated chains.
 * @param walletAddress - A wallet address.
 * @param token - A Token object.
 * @returns An object containing the token and the amounts on different chains.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
 */
export const getTokenBalance = async (
  walletAddress: string,
  token: Token
): Promise<TokenAmount | null> => {
  const tokenAmounts = await getTokenBalances(walletAddress, [token])
  return tokenAmounts.length ? tokenAmounts[0] : null
}

/**
 * Returns the balances for a list tokens a wallet holds  across all aggregated chains.
 * @param walletAddress - A wallet address.
 * @param tokens - A list of Token objects.
 * @returns A list of objects containing the tokens and the amounts on different chains.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
 */
export const getTokenBalances = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  // split by chain
  const tokensByChain = tokens.reduce(
    (tokens, token) => {
      if (!tokens[token.chainId]) {
        tokens[token.chainId] = []
      }
      tokens[token.chainId].push(token)
      return tokens
    },
    {} as { [chainId: number]: Token[] }
  )

  const tokenAmountsByChain = await getTokenBalancesByChain(
    walletAddress,
    tokensByChain
  )
  return Object.values(tokenAmountsByChain).flat()
}

/**
 * This method queries the balances of tokens for a specific list of chains for a given wallet.
 * @param walletAddress - A wallet address.
 * @param tokensByChain - A list of token objects organized by chain ids.
 * @returns A list of objects containing the tokens and the amounts on different chains organized by the chosen chains.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
 */
export const getTokenBalancesByChain = async (
  walletAddress: string,
  tokensByChain: { [chainId: number]: Token[] }
): Promise<{ [chainId: number]: TokenAmount[] }> => {
  if (!walletAddress) {
    throw new ValidationError('Missing walletAddress.')
  }

  const tokenList = Object.values(tokensByChain).flat()
  const invalidTokens = tokenList.filter((token) => !isToken(token))
  if (invalidTokens.length) {
    throw new ValidationError('Invalid tokens passed.')
  }

  const tokenAmountsByChain: { [chainId: number]: TokenAmount[] } = {}
  const tokenAmountsSettled = await Promise.allSettled(
    Object.keys(tokensByChain).map(async (chainIdStr) => {
      const chainId = Number.parseInt(chainIdStr)
      const chain = await config.getChainById(chainId)
      const tokenAddress = tokensByChain[chainId][0].address
      const provider = config
        .get()
        .providers.find((provider) =>
          chain.chainType === ChainType.UTXO
            ? provider.isAddress(walletAddress)
            : provider.isAddress(tokenAddress)
        )
      if (!provider) {
        throw new Error(
          `SDK Token Provider for ${chain.chainType} is not found.`
        )
      }
      const tokenAmounts = await provider.getBalance(
        walletAddress,
        tokensByChain[chainId]
      )
      tokenAmountsByChain[chainId] = tokenAmounts
    })
  )
  if (config.get().debug) {
    for (const result of tokenAmountsSettled) {
      if (result.status === 'rejected') {
        console.warn("Couldn't fetch token balance.", result.reason)
      }
    }
  }
  return tokenAmountsByChain
}
