import type {
  ChainId,
  ChainKey,
  ChainsRequest,
  ChainType,
  ConnectionsRequest,
  ConnectionsResponse,
  ContractCallsQuoteRequest,
  ExtendedChain,
  GasRecommendationRequest,
  GasRecommendationResponse,
  LiFiStep,
  RelayRequest,
  RelayResponseData,
  RelayStatusRequest,
  RelayStatusResponseData,
  RequestOptions,
  RoutesRequest,
  RoutesResponse,
  SignedLiFiStep,
  StatusResponse,
  Token,
  TokenAmount,
  TokenExtended,
  TokensExtendedResponse,
  TokensRequest,
  TokensResponse,
  ToolsRequest,
  ToolsResponse,
  TransactionAnalyticsRequest,
  TransactionAnalyticsResponse,
  WalletTokenExtended,
} from '@lifi/types'
import type {
  GetStatusRequestExtended,
  QuoteRequestFromAmount,
} from '../types/actions.js'
import type { SDKClient } from '../types/core.js'
import { getChains } from './getChains.js'
import { getConnections } from './getConnections.js'
import { getContractCallsQuote } from './getContractCallsQuote.js'
import { getGasRecommendation } from './getGasRecommendation.js'
import { getNameServiceAddress } from './getNameServiceAddress.js'
import { getQuote } from './getQuote.js'
import { getRelayedTransactionStatus } from './getRelayedTransactionStatus.js'
import { getRelayerQuote } from './getRelayerQuote.js'
import { getRoutes } from './getRoutes.js'
import { getStatus } from './getStatus.js'
import { getStepTransaction } from './getStepTransaction.js'
import { getToken } from './getToken.js'
import { getTokenBalance } from './getTokenBalance.js'
import { getTokenBalances } from './getTokenBalances.js'
import { getTokenBalancesByChain } from './getTokenBalancesByChain.js'
import { getTokens } from './getTokens.js'
import { getTools } from './getTools.js'
import { getTransactionHistory } from './getTransactionHistory.js'
import { getWalletBalances } from './getWalletBalances.js'
import { relayTransaction } from './relayTransaction.js'

export type Actions = {
  /**
   * Get all available chains
   * @param params - The configuration of the requested chains
   * @param options - Request options
   * @returns A list of all available chains
   */
  getChains: (
    params?: ChainsRequest,
    options?: RequestOptions
  ) => Promise<ExtendedChain[]>

  /**
   * Get connections between chains
   * @param params - The configuration of the requested connections
   * @param options - Request options
   * @returns A list of connections
   */
  getConnections: (
    params: ConnectionsRequest,
    options?: RequestOptions
  ) => Promise<ConnectionsResponse>

  /**
   * Get a quote for contract calls
   * @param params - The configuration of the requested contract calls quote
   * @param options - Request options
   * @returns Quote for contract calls
   */
  getContractCallsQuote: (
    params: ContractCallsQuoteRequest,
    options?: RequestOptions
  ) => Promise<LiFiStep>

  /**
   * Get gas recommendation for a chain
   * @param params - The configuration of the requested gas recommendation
   * @param options - Request options
   * @returns Gas recommendation
   */
  getGasRecommendation: (
    params: GasRecommendationRequest,
    options?: RequestOptions
  ) => Promise<GasRecommendationResponse>

  /**
   * Get the address of a name service
   * @param name - The name to resolve
   * @param chainType - The chain type to resolve the name on
   * @returns The address of the name service
   */
  getNameServiceAddress: (
    name: string,
    chainType?: ChainType
  ) => Promise<string | undefined>

  /**
   * Get a quote for a token transfer
   * @param params - The configuration of the requested quote
   * @param options - Request options
   * @returns Quote for a token transfer
   */
  getQuote: (
    params: Parameters<typeof getQuote>[1],
    options?: RequestOptions
  ) => Promise<LiFiStep>

  /**
   * Get the status of a relayed transaction
   * @param params - The configuration of the requested relay status
   * @param options - Request options
   * @returns Status of the relayed transaction
   */
  getRelayedTransactionStatus: (
    params: RelayStatusRequest,
    options?: RequestOptions
  ) => Promise<RelayStatusResponseData>

  /**
   * Get a quote from a relayer
   * @param params - The configuration of the requested relayer quote
   * @param options - Request options
   * @returns Quote from a relayer
   */
  getRelayerQuote: (
    params: QuoteRequestFromAmount,
    options?: RequestOptions
  ) => Promise<LiFiStep>

  /**
   * Get a set of routes for a request that describes a transfer of tokens
   * @param params - A description of the transfer
   * @param options - Request options
   * @returns The resulting routes that can be used to realize the described transfer
   */
  getRoutes: (
    params: RoutesRequest,
    options?: RequestOptions
  ) => Promise<RoutesResponse>

  /**
   * Get the status of a transaction
   * @param params - The configuration of the requested status
   * @param options - Request options
   * @returns Status of the transaction
   */
  getStatus: (
    params: GetStatusRequestExtended,
    options?: RequestOptions
  ) => Promise<StatusResponse>

  /**
   * Get a step transaction
   * @param params - The configuration of the requested step transaction
   * @param options - Request options
   * @returns Step transaction
   */
  getStepTransaction: (
    params: LiFiStep | SignedLiFiStep,
    options?: RequestOptions
  ) => Promise<LiFiStep>

  /**
   * Get a specific token
   * @param chain - Id or key of the chain that contains the token
   * @param token - Address or symbol of the token on the requested chain
   * @param options - Request options
   * @returns Token information
   */
  getToken: (
    chain: ChainKey | ChainId,
    token: string,
    options?: RequestOptions
  ) => Promise<TokenExtended>

  /**
   * Get token balance for a specific token
   * @param walletAddress - A wallet address
   * @param token - A Token object
   * @returns Token balance
   */
  getTokenBalance: (
    walletAddress: string,
    token: Token
  ) => Promise<TokenAmount | null>

  /**
   * Get token balances for multiple tokens
   * @param walletAddress - A wallet address
   * @param tokens - A list of Token objects
   * @returns Token balances
   */
  getTokenBalances: (
    walletAddress: string,
    tokens: Token[]
  ) => Promise<TokenAmount[]>

  /**
   * Get token balances by chain
   * @param walletAddress - A wallet address
   * @param tokensByChain - A list of token objects organized by chain ids
   * @returns Token balances by chain
   */
  getTokenBalancesByChain: (
    walletAddress: string,
    tokensByChain: { [chainId: number]: Token[] }
  ) => Promise<{
    [chainId: number]: TokenAmount[]
  }>

  /**
   * Get all available tokens
   * @param params - The configuration of the requested tokens
   * @param options - Request options
   * @returns A list of all available tokens
   */
  getTokens: {
    (
      params?: TokensRequest & { extended?: false | undefined },
      options?: RequestOptions
    ): Promise<TokensResponse>
    (
      params: TokensRequest & { extended: true },
      options?: RequestOptions
    ): Promise<TokensExtendedResponse>
  }

  /**
   * Get all available tools (bridges and exchanges)
   * @param params - The configuration of the requested tools
   * @param options - Request options
   * @returns A list of all available tools
   */
  getTools: (
    params?: ToolsRequest,
    options?: RequestOptions
  ) => Promise<ToolsResponse>

  /**
   * Get transaction history
   * @param params - The configuration of the requested transaction history
   * @param options - Request options
   * @returns Transaction history
   */
  getTransactionHistory: (
    params: TransactionAnalyticsRequest,
    options?: RequestOptions
  ) => Promise<TransactionAnalyticsResponse>

  /**
   * Get wallet balances
   * @param params - The configuration of the requested wallet balances
   * @param options - Request options
   * @returns Wallet balances
   */
  getWalletBalances: (
    walletAddress: string,
    options?: RequestOptions
  ) => Promise<Record<number, WalletTokenExtended[]>>

  /**
   * Relay a transaction through the relayer service
   * @param params - The configuration for the relay request
   * @param options - Request options
   * @returns Task ID and transaction link for the relayed transaction
   */
  relayTransaction: (
    params: RelayRequest,
    options?: RequestOptions
  ) => Promise<RelayResponseData>
}

export function actions(client: SDKClient): Actions {
  return {
    getChains: (params, options) => getChains(client, params, options),
    getConnections: (params, options) =>
      getConnections(client, params, options),
    getContractCallsQuote: (params, options) =>
      getContractCallsQuote(client, params, options),
    getGasRecommendation: (params, options) =>
      getGasRecommendation(client, params, options),
    getNameServiceAddress: (name, chainType) =>
      getNameServiceAddress(client, name, chainType),
    getTokens: (params, options) => getTokens(client, params as any, options),
    getTools: (params, options) => getTools(client, params, options),
    getQuote: (params, options) => getQuote(client, params, options),
    getRelayedTransactionStatus: (params, options) =>
      getRelayedTransactionStatus(client, params, options),
    getRelayerQuote: (params, options) =>
      getRelayerQuote(client, params, options),
    getRoutes: (params, options) => getRoutes(client, params, options),
    getStatus: (params, options) => getStatus(client, params, options),
    getStepTransaction: (params, options) =>
      getStepTransaction(client, params, options),
    getToken: (chain, token, options) =>
      getToken(client, chain, token, options),
    getTokenBalance: (walletAddress, token) =>
      getTokenBalance(client, walletAddress, token),
    getTokenBalances: (walletAddress, tokens) =>
      getTokenBalances(client, walletAddress, tokens),
    getTokenBalancesByChain: (walletAddress, tokensByChain) =>
      getTokenBalancesByChain(client, walletAddress, tokensByChain),
    getTransactionHistory: (params, options) =>
      getTransactionHistory(client, params, options),
    getWalletBalances: (walletAddress, options) =>
      getWalletBalances(client, walletAddress, options),
    relayTransaction: (params, options) =>
      relayTransaction(client, params, options),
  }
}
