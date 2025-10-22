import type {
  GetWalletBalanceExtendedResponse,
  RequestOptions,
  Token,
  TokenAmount,
  TokenAmountExtended,
  TokenExtended,
  WalletTokenExtended,
} from '@lifi/types'
import type { SDKClient, SDKProvider } from '../core/types.js'
import { ValidationError } from '../errors/errors.js'
import { request } from '../request.js'
import { isToken } from '../typeguards.js'

/**
 * Returns the balances of a specific token a wallet holds across all aggregated chains.
 * @param walletAddress - A wallet address.
 * @param token - A Token object.
 * @returns An object containing the token and the amounts on different chains.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
 */
export const getTokenBalance = async (
  client: SDKClient,
  walletAddress: string,
  token: Token
): Promise<TokenAmount | null> => {
  const tokenAmounts = await getTokenBalances(client, walletAddress, [token])
  return tokenAmounts.length ? tokenAmounts[0] : null
}

/**
 * Returns the balances for a list tokens a wallet holds across all aggregated chains.
 * @param client - The SDK client
 * @param walletAddress - A wallet address.
 * @param tokens - A list of Token (or TokenExtended) objects.
 * @returns A list of objects containing the tokens and the amounts on different chains.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
 */
export async function getTokenBalances(
  client: SDKClient,
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]>
export async function getTokenBalances(
  client: SDKClient,
  walletAddress: string,
  tokens: TokenExtended[]
): Promise<TokenAmountExtended[]> {
  // split by chain
  const tokensByChain = tokens.reduce(
    (tokens, token) => {
      if (!tokens[token.chainId]) {
        tokens[token.chainId] = []
      }
      tokens[token.chainId].push(token)
      return tokens
    },
    {} as { [chainId: number]: Token[] | TokenExtended[] }
  )

  const tokenAmountsByChain = await getTokenBalancesByChain(
    client,
    walletAddress,
    tokensByChain
  )
  return Object.values(tokenAmountsByChain).flat()
}

/**
 * This method queries the balances of tokens for a specific list of chains for a given wallet.
 * @param client - The SDK client
 * @param walletAddress - A wallet address.
 * @param tokensByChain - A list of token objects organized by chain ids.
 * @returns A list of objects containing the tokens and the amounts on different chains organized by the chosen chains.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
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

  const config = client.config
  const tokenList = Object.values(tokensByChain).flat()
  const invalidTokens = tokenList.filter((token) => !isToken(token))
  if (invalidTokens.length) {
    throw new ValidationError('Invalid tokens passed.')
  }

  const provider = client.providers.find((provider: SDKProvider) =>
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
  if (config.debug) {
    for (const result of tokenAmountsSettled) {
      if (result.status === 'rejected') {
        console.warn("Couldn't fetch token balance.", result.reason)
      }
    }
  }
  return tokenAmountsByChain
}

/**
 * Returns the balances of tokens a wallet holds across EVM chains.
 * @param client - The SDK client
 * @param walletAddress - A wallet address.
 * @param options - Optional request options.
 * @returns An object containing the tokens and the amounts organized by chain ids.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
 */
export const getWalletBalances = async (
  client: SDKClient,
  walletAddress: string,
  options?: RequestOptions
): Promise<Record<number, WalletTokenExtended[]>> => {
  if (!walletAddress) {
    throw new ValidationError('Missing walletAddress.')
  }

  const response = await request<GetWalletBalanceExtendedResponse>(
    client.config,
    `${client.config.apiUrl}/wallets/${walletAddress}/balances?extended=true`,
    {
      signal: options?.signal,
    }
  )

  return (response?.balances || {}) as Record<number, WalletTokenExtended[]>
}
