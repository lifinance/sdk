/* eslint-disable @typescript-eslint/no-empty-function */
import type {
  ChainId,
  ChainKey,
  ConnectionsRequest,
  ConnectionsResponse,
  ContractCallQuoteRequest,
  ExtendedChain,
  GasRecommendationRequest,
  GasRecommendationResponse,
  GetStatusRequest,
  LifiStep,
  PossibilitiesRequest,
  PossibilitiesResponse,
  QuoteRequest,
  RequestOptions,
  RoutesRequest,
  RoutesResponse,
  StaticToken,
  StatusResponse,
  Token,
  TokenAmount,
  TokensRequest,
  TokensResponse,
  ToolsRequest,
  ToolsResponse,
} from '@lifi/types'
import type { Hash, PublicClient } from 'viem'
import type {
  ApproveTokenRequest,
  RevokeApprovalRequest,
  TokenAllowance,
  TokenSpender,
} from './allowance'
import {
  getTokenAllowance,
  getTokenAllowanceMulticall,
  revokeTokenApproval,
  setTokenAllowance,
} from './allowance'
import * as balance from './balance'
import { getPublicClient } from './connectors'
import { RouteExecutionManager } from './execution/RouteExecutionManager'
import { checkPackageUpdates } from './helpers'
import ApiService from './services/ApiService'
import ChainsService from './services/ChainsService'
import { isToken } from './typeguards'
import type { Config, ConfigUpdate } from './types'
import { ValidationError } from './utils/errors'
import { name, version } from './version'

export class LiFi extends RouteExecutionManager {
  private chainsService: ChainsService

  constructor(configUpdate: ConfigUpdate) {
    super(configUpdate)

    this.chainsService = ChainsService.getInstance()

    this.chainsService.getChains().then((chains) => {
      this.configService.updateChains(chains)
    })

    checkPackageUpdates(name, version, configUpdate.disableVersionCheck)
  }

  /**
   * Get the current configuration of the SDK
   * @returns - The config object
   */
  getConfig = (): Config => {
    return this.configService.getConfig()
  }

  /**
   * Get the SDK configuration after all setup calls are finished
   * @returns - The config object
   */
  getConfigAsync = (): Promise<Config> => {
    return this.configService.getConfigAsync()
  }

  /**
   * Get an instance of a provider for a specific chain
   * @param chainId - Id of the chain the provider is for
   * @returns The public client for the given chain
   */
  getPublicClient = (chainId: number): Promise<PublicClient> => {
    return getPublicClient(chainId)
  }

  /**
   * Set a new confuration for the SDK
   * @param configUpdate - An object containing the configuration fields that should be updated.
   * @returns The renewed config object
   */
  setConfig = (configUpdate: Partial<ConfigUpdate>): Config => {
    return this.configService.updateConfig(configUpdate)
  }

  /**
   * Get a set of current possibilities based on a request that specifies which chains, exchanges and bridges are preferred or unwanted.
   * @param request - Object defining preferences regarding chain, exchanges and bridges
   * @param options
   * @returns Object listing current possibilities for any-to-any cross-chain-swaps based on the provided preferences.
   * @throws {LiFiError} Throws a LiFiError if request fails.
   * @deprecated We don't want to support this endpoint anymore in the future. /chains, /tools, /connections, and /tokens should be used instead
   */
  getPossibilities = async (
    request?: PossibilitiesRequest,
    options?: RequestOptions
  ): Promise<PossibilitiesResponse> => {
    return ApiService.getPossibilities(request, options)
  }

  /**
   * Fetch information about a Token
   * @param chain - Id or key of the chain that contains the token
   * @param token - Address or symbol of the token on the requested chain
   * @param options
   * @throws {LiFiError} - Throws a LiFiError if request fails
   */
  getToken = async (
    chain: ChainKey | ChainId,
    token: string,
    options?: RequestOptions
  ): Promise<Token> => {
    return ApiService.getToken(chain, token, options)
  }

  /**
   * Get a quote for a token transfer
   * @param request - The configuration of the requested quote
   * @param options
   * @throws {LiFiError} - Throws a LiFiError if request fails
   */
  getQuote = async (
    request: QuoteRequest,
    options?: RequestOptions
  ): Promise<LifiStep> => {
    return ApiService.getQuote(request, options)
  }

  /**
   * Get a quote for a destination contract call
   * @param request - The configuration of the requested destination call
   * @param options
   * @throws {LiFiError} - Throws a LiFiError if request fails
   * @returns - Returns step.
   */
  getContractCallQuote = async (
    request: ContractCallQuoteRequest,
    options?: RequestOptions
  ): Promise<LifiStep> => {
    return ApiService.getContractCallQuote(request, options)
  }

  /**
   * Check the status of a transfer. For cross chain transfers, the "bridge" parameter is required.
   * @param request - Configuration of the requested status
   * @param options - Rrquest options.
   * @throws {LiFiError} - Throws a LiFiError if request fails
   * @returns Returns status response.
   */
  getStatus = async (
    request: GetStatusRequest,
    options?: RequestOptions
  ): Promise<StatusResponse> => {
    return ApiService.getStatus(request, options)
  }

  /**
   * Get the available tools to bridge and swap tokens.
   * @param request - The configuration of the requested tools
   * @param options
   * @returns The tools that are available on the requested chains
   */
  getTools = async (
    request?: ToolsRequest,
    options?: RequestOptions
  ): Promise<ToolsResponse> => {
    return ApiService.getTools(request || {}, options)
  }

  /**
   * Get all known tokens.
   * @param request - The configuration of the requested tokens
   * @param options
   * @returns The tokens that are available on the requested chains
   */
  getTokens = async (
    request?: TokensRequest,
    options?: RequestOptions
  ): Promise<TokensResponse> => {
    return ApiService.getTokens(request || {}, options)
  }

  /**
   * Get all available chains
   * @returns A list of all available chains
   * @throws {LiFiError} Throws a LiFiError if request fails.
   */
  getChains = async (): Promise<ExtendedChain[]> => {
    return this.chainsService.getChains()
  }

  /**
   * Get a set of routes for a request that describes a transfer of tokens.
   * @param request - A description of the transfer.
   * @param options
   * @returns The resulting routes that can be used to realize the described transfer of tokens.
   * @throws {LiFiError} Throws a LiFiError if request fails.
   */
  getRoutes = async (
    request: RoutesRequest,
    options?: RequestOptions
  ): Promise<RoutesResponse> => {
    return ApiService.getRoutes(request, options)
  }

  /**
   * Get the transaction data for a single step of a route
   * @param step - The step object.
   * @param options
   * @returns The step populated with the transaction data.
   * @throws {LiFiError} Throws a LiFiError if request fails.
   */
  getStepTransaction = async (
    step: LifiStep,
    options?: RequestOptions
  ): Promise<LifiStep> => {
    return ApiService.getStepTransaction(step, options)
  }

  /**
   * Get gas recommendation for a certain chain
   * @param request - Configuration of the requested recommendation.
   * @param options
   * @throws {LiFiError} Throws a LiFiError if request fails.
   */
  getGasRecommendation = async (
    request: GasRecommendationRequest,
    options?: RequestOptions
  ): Promise<GasRecommendationResponse> => {
    return ApiService.getGasRecommendation(request, options)
  }

  /**
   * Returns the balances of a specific token a wallet holds across all aggregated chains.
   * @param walletAddress - A wallet address.
   * @param token - A Token object.
   * @returns An object containing the token and the amounts on different chains.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  getTokenBalance = async (
    walletAddress: string,
    token: Token
  ): Promise<TokenAmount | null> => {
    if (!walletAddress) {
      throw new ValidationError('Missing walletAddress.')
    }

    if (!isToken(token)) {
      throw new ValidationError(
        `Invalid token passed: address "${
          (token as StaticToken).address
        }" on chainId "${(token as StaticToken).chainId}"`
      )
    }

    return balance.getTokenBalance(walletAddress, token)
  }

  /**
   * Returns the balances for a list tokens a wallet holds  across all aggregated chains.
   * @param walletAddress - A wallet address.
   * @param tokens - A list of Token objects.
   * @returns A list of objects containing the tokens and the amounts on different chains.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  getTokenBalances = async (
    walletAddress: string,
    tokens: Token[]
  ): Promise<TokenAmount[]> => {
    if (!walletAddress) {
      throw new ValidationError('Missing walletAddress.')
    }

    const invalidTokens = tokens.filter((token) => !isToken(token))
    if (invalidTokens.length) {
      throw new ValidationError(
        `Invalid token passed: address "${invalidTokens[0].address}" on chainId "${invalidTokens[0].chainId}"`
      )
    }

    return balance.getTokenBalances(walletAddress, tokens)
  }

  /**
   * This method queries the balances of tokens for a specific list of chains for a given wallet.
   * @param walletAddress - A walletaddress.
   * @param tokensByChain - A list of Token objects organized by chain ids.
   * @returns A list of objects containing the tokens and the amounts on different chains organized by the chosen chains.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  getTokenBalancesByChain = async (
    walletAddress: string,
    tokensByChain: { [chainId: number]: Token[] }
  ): Promise<{ [chainId: number]: TokenAmount[] }> => {
    if (!walletAddress) {
      throw new ValidationError('Missing walletAddress.')
    }

    const tokenList = Object.values(tokensByChain).flat()
    const invalidTokens = tokenList.filter((token) => !isToken(token))
    if (invalidTokens.length) {
      throw new ValidationError(
        `Invalid token passed: address "${invalidTokens[0].address}" on chainId "${invalidTokens[0].chainId}"`
      )
    }

    return balance.getTokenBalancesByChain(walletAddress, tokensByChain)
  }

  /**
   * Get the current allowance for a certain token.
   * @param token - The token that should be checked
   * @param ownerAddress - The owner of the token
   * @param spenderAddress - The spender address that has to be approved
   * @returns Returns allowance
   */
  getTokenAllowance = async (
    token: Token,
    ownerAddress: string,
    spenderAddress: string
  ): Promise<bigint | undefined> => {
    return getTokenAllowance(token, ownerAddress, spenderAddress)
  }

  /**
   * Get the current allowance for a list of token/spender address pairs.
   * @param ownerAddress - The owner of the tokens
   * @param tokens - A list of token and spender address pairs
   * @returns Returns array of tokens and their allowance
   */
  getTokenAllowanceMulticall = async (
    ownerAddress: string,
    tokens: TokenSpender[]
  ): Promise<TokenAllowance[]> => {
    return getTokenAllowanceMulticall(ownerAddress, tokens)
  }

  /**
   * Set approval for a certain token and amount.
   * @param request - The approval request
   * @returns Returns Hash or nothing
   */
  setTokenApproval = (
    request: ApproveTokenRequest
  ): Promise<Hash | undefined> => {
    return setTokenAllowance(request)
  }

  /**
   * Revoke approval for a certain token.
   * @param request - The revoke request
   * @returns Returns Hash or nothing
   */
  revokeTokenApproval = (
    request: RevokeApprovalRequest
  ): Promise<Hash | undefined> => {
    return revokeTokenApproval(request)
  }

  /**
   * Get all the available connections for swap/bridging tokens
   * @param connectionRequest ConnectionsRequest
   * @returns ConnectionsResponse
   */
  getConnections = async (
    connectionRequest: ConnectionsRequest
  ): Promise<ConnectionsResponse> => {
    const connections = await ApiService.getAvailableConnections(
      connectionRequest
    )

    return connections
  }
}
