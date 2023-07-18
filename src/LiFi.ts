/* eslint-disable @typescript-eslint/no-empty-function */
import { FallbackProvider } from '@ethersproject/providers'
import {
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
import { Signer } from 'ethers'
import {
  ApproveTokenRequest,
  RevokeApprovalRequest,
  approveToken,
  bulkGetTokenApproval,
  getTokenApproval,
  revokeTokenApproval,
} from './allowance'
import * as balance from './balance'
import { getRpcProvider } from './connectors'
import { RouteExecutionManager } from './execution/RouteExecutionManager'
import { checkPackageUpdates } from './helpers'
import ApiService from './services/ApiService'
import ChainsService from './services/ChainsService'
import { isToken } from './typeguards'
import { Config, ConfigUpdate, RevokeTokenData } from './types'
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
   * @return {Config} - The config object
   */
  getConfig = (): Config => {
    return this.configService.getConfig()
  }

  /**
   * Get the SDK configuration after all setup calls are finished
   * @return {Promise<Config>} - The config object
   */
  getConfigAsync = (): Promise<Config> => {
    return this.configService.getConfigAsync()
  }

  /**
   * Get an instance of a provider for a specific chain
   * @param {number} chainId - Id of the chain the provider is for
   * @param {boolean} archive - Whether to use an archive provider that is based on a default rpc or not. defaults to false
   * @return {FallbackProvider} The provider for the given chain
   */
  getRpcProvider = (
    chainId: number,
    archive = false
  ): Promise<FallbackProvider> => {
    return getRpcProvider(chainId, archive)
  }

  /**
   * Set a new confuration for the SDK
   * @param {ConfigUpdate} configUpdate - An object containing the configuration fields that should be updated.
   * @return {Config} The renewed config object
   */
  setConfig = (configUpdate: Partial<ConfigUpdate>): Config => {
    return this.configService.updateConfig(configUpdate)
  }

  /**
   * Get a set of current possibilities based on a request that specifies which chains, exchanges and bridges are preferred or unwanted.
   * @param {PossibilitiesRequest} request - Object defining preferences regarding chain, exchanges and bridges
   * @return {Promise<PossibilitiesResponse>} Object listing current possibilities for any-to-any cross-chain-swaps based on the provided preferences.
   * @throws {LifiError} Throws a LifiError if request fails.
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
   * @param {ChainKey | ChainId} chain - Id or key of the chain that contains the token
   * @param {string} token - Address or symbol of the token on the requested chain
   * @throws {LifiError} - Throws a LifiError if request fails
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
   * @param {QuoteRequest} request - The configuration of the requested quote
   * @throws {LifiError} - Throws a LifiError if request fails
   */
  getQuote = async (
    request: QuoteRequest,
    options?: RequestOptions
  ): Promise<LifiStep> => {
    return ApiService.getQuote(request, options)
  }

  /**
   * Get a quote for a destination contract call
   * @param {ContractCallQuoteRequest} request - The configuration of the requested destination call
   * @throws {LifiError} - Throws a LifiError if request fails
   */
  getContractCallQuote = async (
    request: ContractCallQuoteRequest,
    options?: RequestOptions
  ): Promise<LifiStep> => {
    return ApiService.getContractCallQuote(request, options)
  }

  /**
   * Check the status of a transfer. For cross chain transfers, the "bridge" parameter is required.
   * @param {GetStatusRequest} request - Configuration of the requested status
   * @throws {LifiError} - Throws a LifiError if request fails
   */
  getStatus = async (
    request: GetStatusRequest,
    options?: RequestOptions
  ): Promise<StatusResponse> => {
    return ApiService.getStatus(request, options)
  }

  /**
   * Get the available tools to bridge and swap tokens.
   * @param {ToolsRequest?} request - The configuration of the requested tools
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
   * @param {TokensRequest?} request - The configuration of the requested tokens
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
   * @return {Promise<Chain[]>} A list of all available chains
   * @throws {LifiError} Throws a LifiError if request fails.
   */
  getChains = async (): Promise<ExtendedChain[]> => {
    return this.chainsService.getChains()
  }

  /**
   * Get a set of routes for a request that describes a transfer of tokens.
   * @param {RoutesRequest} request - A description of the transfer.
   * @return {Promise<RoutesResponse>} The resulting routes that can be used to realize the described transfer of tokens.
   * @throws {LifiError} Throws a LifiError if request fails.
   */
  getRoutes = async (
    request: RoutesRequest,
    options?: RequestOptions
  ): Promise<RoutesResponse> => {
    return ApiService.getRoutes(request, options)
  }

  /**
   * Get the transaction data for a single step of a route
   * @param {LifiStep} step - The step object.
   * @return {Promise<LifiStep>} The step populated with the transaction data.
   * @throws {LifiError} Throws a LifiError if request fails.
   */
  getStepTransaction = async (
    step: LifiStep,
    options?: RequestOptions
  ): Promise<LifiStep> => {
    return ApiService.getStepTransaction(step, options)
  }

  /**
   * Get gas recommendation for a certain chain
   * @param {GasRecommendationRequest} request - Configuration of the requested recommendation.
   * @throws {LifiError} Throws a LifiError if request fails.
   */
  getGasRecommendation = async (
    request: GasRecommendationRequest,
    options?: RequestOptions
  ): Promise<GasRecommendationResponse> => {
    return ApiService.getGasRecommendation(request, options)
  }

  /**
   * Returns the balances of a specific token a wallet holds across all aggregated chains.
   * @param {string} walletAddress - A wallet address.
   * @param {Token} token - A Token object.
   * @return {Promise<TokenAmount | null>} An object containing the token and the amounts on different chains.
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
   * @param {string} walletAddress - A wallet address.
   * @param {Token[]} tokens - A list of Token objects.
   * @return {Promise<TokenAmount[]>} A list of objects containing the tokens and the amounts on different chains.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  getTokenBalances = async (
    walletAddress: string,
    tokens: Token[],
    hideZeroBalance?: boolean
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

    const tokenResponse = await balance.getTokenBalances(walletAddress, tokens)

    if (hideZeroBalance) {
      return tokenResponse.filter(
        (tokenAmount: TokenAmount) => tokenAmount.amount !== '0'
      )
    }

    return tokenResponse
  }

  /**
   * This method queries the balances of tokens for a specific list of chains for a given wallet.
   * @param {string} walletAddress - A walletaddress.
   * @param {{ [chainId: number]: Token[] }} tokensByChain - A list of Token objects organized by chain ids.
   * @return {Promise<{ [chainId: number]: TokenAmount[] }>} A list of objects containing the tokens and the amounts on different chains organized by the chosen chains.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  getTokenBalancesForChains = async (
    walletAddress: string,
    tokensByChain: { [chainId: number]: Token[] },
    hideZeroBalance?: boolean
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

    const response = await balance.getTokenBalancesForChains(
      walletAddress,
      tokensByChain
    )

    if (hideZeroBalance) {
      const filteredResponse: { [chainId: number]: TokenAmount[] } = {}
      for (const chainId in response) {
        const typedChainId = Number(chainId)
        filteredResponse[typedChainId] = response[typedChainId].filter(
          (tokenAmount: TokenAmount) => tokenAmount.amount !== '0'
        )
      }

      return filteredResponse
    }

    return response
  }

  /**
   * Get the current approval for a certain token.
   * @param signer - The signer owning the token
   * @param token - The token that should be checked
   * @param approvalAddress - The address that has be approved
   */
  getTokenApproval = async (
    signer: Signer,
    token: Token,
    approvalAddress: string
  ): Promise<string | undefined> => {
    return getTokenApproval(signer, token, approvalAddress)
  }

  /**
   * Get the current approval for a list of token / approval address pairs.
   * @param signer - The signer owning the tokens
   * @param tokenData - A list of token and approval address pairs
   */
  bulkGetTokenApproval = async (
    signer: Signer,
    tokenData: RevokeTokenData[]
  ): Promise<{ token: Token; approval: string | undefined }[]> => {
    return bulkGetTokenApproval(signer, tokenData)
  }

  /**
   * Set approval for a certain token and amount.
   * @param { ApproveTokenRequest } request - The approval request
   */
  approveToken = (request: ApproveTokenRequest): Promise<void> => {
    return approveToken(request)
  }

  /**
   * Revoke approval for a certain token.
   * @param { RevokeApprovalRequest } request - The revoke request
   */
  revokeTokenApproval = (request: RevokeApprovalRequest): Promise<void> => {
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
