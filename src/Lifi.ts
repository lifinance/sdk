/* eslint-disable @typescript-eslint/no-empty-function */
import {
  Chain,
  ChainId,
  ChainKey,
  GetStatusRequest,
  PossibilitiesRequest,
  PossibilitiesResponse,
  QuoteRequest,
  RequestOptions,
  Route,
  RoutesRequest,
  RoutesResponse,
  StatusResponse,
  Step,
  Token,
  TokenAmount,
  TokensRequest,
  TokensResponse,
  ToolsRequest,
  ToolsResponse,
} from '@lifinance/types'
import { Signer } from 'ethers'
import {
  approveToken,
  ApproveTokenRequest,
  bulkGetTokenApproval,
  getTokenApproval,
  RevokeApprovalRequest,
  revokeTokenApproval,
} from './allowance'
import balances from './balances'
import { StatusManager } from './execution/StatusManager'
import { StepExecutor } from './execution/StepExecutor'
import ApiService from './services/ApiService'
import ChainsService from './services/ChainsService'
import ConfigService from './services/ConfigService'
import { isToken } from './typeguards'
import {
  ActiveRouteDictionary,
  Config,
  ConfigUpdate,
  ExecutionData,
  ExecutionSettings,
  RevokeTokenData,
} from './types'
import { ValidationError } from './utils/errors'
import { deepClone } from './utils/utils'

export default class LIFI {
  private activeRouteDictionary: ActiveRouteDictionary = {}
  private configService: ConfigService
  private chainsService: ChainsService

  constructor(configUpdate?: ConfigUpdate) {
    this.configService = ConfigService.getInstance()

    if (configUpdate) {
      this.configService.updateConfig(configUpdate) // update API urls before we request chains
    }

    this.chainsService = ChainsService.getInstance()

    this.chainsService.getChains().then((chains) => {
      this.configService.updateChains(chains)
    })
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
   * Set a new confuration for the SDK
   * @param {ConfigUpdate} configUpdate - An object containing the configuration fields that should be updated.
   * @return {Config} The renewed config object
   */
  setConfig = (configUpdate: ConfigUpdate): Config => {
    return this.configService.updateConfig(configUpdate)
  }

  /**
   * Get a set of current possibilities based on a request that specifies which chains, exchanges and bridges are preferred or unwanted.
   * @param {PossibilitiesRequest} request - Object defining preferences regarding chain, exchanges and bridges
   * @return {Promise<PossibilitiesResponse>} Object listing current possibilities for any-to-any cross-chain-swaps based on the provided preferences.
   * @throws {LifiError} Throws a LifiError if request fails.
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
  ): Promise<Step> => {
    return ApiService.getQuote(request, options)
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
  getChains = async (): Promise<Chain[]> => {
    return this.chainsService.getChains()
  }

  /**
   * Get a set of routes for a request that describes a transfer of tokens.
   * @param {RoutesRequest} routesRequest - A description of the transfer.
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
   * @param {Step} step - The step object.
   * @return {Promise<Step>} The step populated with the transaction data.
   * @throws {LifiError} Throws a LifiError if request fails.
   */
  getStepTransaction = async (
    step: Step,
    options?: RequestOptions
  ): Promise<Step> => {
    return ApiService.getStepTransaction(step, options)
  }

  /**
   * Stops the execution of an active route.
   * @param {Route} route - A route that is currently in execution.
   * @return {Route} The stopped route.
   */
  stopExecution = (route: Route): Route => {
    if (!this.activeRouteDictionary[route.id]) {
      return route
    }
    for (const executor of this.activeRouteDictionary[route.id].executors) {
      executor.stopStepExecution({ allowUpdates: false })
    }
    delete this.activeRouteDictionary[route.id]
    return route
  }

  /**
   * Executes a route until a user interaction is necessary (signing transactions, etc.) and then halts until the route is resumed.
   * @param {Route} route - A route that is currently in execution.
   */
  moveExecutionToBackground = (route: Route): void => {
    if (!this.activeRouteDictionary[route.id]) {
      return
    }
    for (const executor of this.activeRouteDictionary[route.id].executors) {
      executor.stopStepExecution({ allowUpdates: true })
    }
  }

  /**
   * Execute a route.
   * @param {Signer} signer - The signer required to send the transactions.
   * @param {Route} route - The route that should be executed. Cannot be an active route.
   * @param {ExecutionSettings} settings - An object containing settings and callbacks.
   * @return {Promise<Route>} The executed route.
   * @throws {LifiError} Throws a LifiError if the execution fails.
   */
  executeRoute = async (
    signer: Signer,
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    const clonedRoute = deepClone<Route>(route) // deep clone to prevent side effects

    // check if route is already running
    if (this.activeRouteDictionary[clonedRoute.id]) {
      // TODO: maybe inform user why nothing happens?
      return clonedRoute
    }

    return this.executeSteps(signer, clonedRoute, settings)
  }

  /**
   * Resume the execution of a route that has been stopped or had an error while executing.
   * @param {Signer} signer - The signer required to send the transactions.
   * @param {Route} route - The route that is to be executed. Cannot be an active route.
   * @param {ExecutionSettings} settings - An object containing settings and callbacks.
   * @return {Promise<Route>} The executed route.
   * @throws {LifiError} Throws a LifiError if the execution fails.
   */
  resumeRoute = async (
    signer: Signer,
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    const clonedRoute = deepClone<Route>(route) // deep clone to prevent side effects

    const activeRoute = this.activeRouteDictionary[clonedRoute.id]
    if (activeRoute) {
      const executionHalted = activeRoute.executors.some(
        (executor) => executor.executionStopped
      )
      if (!executionHalted) {
        return clonedRoute
      }
    }

    return this.executeSteps(signer, clonedRoute, settings)
  }

  private executeSteps = async (
    signer: Signer,
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    const config = this.configService.getConfig()
    const execData: ExecutionData = {
      route,
      executors: [],
      settings: { ...config.defaultExecutionSettings, ...settings },
    }
    this.activeRouteDictionary[route.id] = execData

    const statusManager = new StatusManager(
      route,
      this.activeRouteDictionary[route.id].settings,
      (route: Route) => (this.activeRouteDictionary[route.id].route = route)
    )

    // loop over steps and execute them
    for (let index = 0; index < route.steps.length; index++) {
      //check if execution has stopped in meantime
      if (!this.activeRouteDictionary[route.id]) {
        break
      }

      const step = route.steps[index]
      const previousStep = index !== 0 ? route.steps[index - 1] : undefined
      // check if step already done
      if (step.execution && step.execution.status === 'DONE') {
        continue
      }

      // update amount using output of previous execution. In the future this should be handled by calling `updateRoute`
      if (
        previousStep &&
        previousStep.execution &&
        previousStep.execution.toAmount
      ) {
        step.action.fromAmount = previousStep.execution.toAmount
      }

      let stepExecutor: StepExecutor
      try {
        stepExecutor = new StepExecutor(
          statusManager,
          this.activeRouteDictionary[route.id].settings
        )
        this.activeRouteDictionary[route.id].executors.push(stepExecutor)
        await stepExecutor.executeStep(signer, step)
      } catch (e) {
        this.stopExecution(route)
        throw e
      }

      // execution stopped during the current step, we don't want to continue to the next step so we return already
      if (stepExecutor.executionStopped) {
        return route
      }
    }

    //clean up after execution
    delete this.activeRouteDictionary[route.id]
    return route
  }

  /**
   * Update the ExecutionSettings for an active route.
   * @param {ExecutionSettings} settings - An object with execution settings.
   * @param {Route} route - The active route that gets the new execution settings.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  updateExecutionSettings = (
    settings: ExecutionSettings,
    route: Route
  ): void => {
    if (!this.activeRouteDictionary[route.id]) {
      throw new ValidationError(
        "Can't set ExecutionSettings for the inactive route."
      )
    }

    const config = this.configService.getConfig()
    this.activeRouteDictionary[route.id].settings = {
      ...config.defaultExecutionSettings,
      ...settings,
    }
  }

  /**
   * Get the list of active routes.
   * @return {Route[]} A list of routes.
   */
  getActiveRoutes = (): Route[] => {
    return Object.values(this.activeRouteDictionary).map((dict) => dict.route)
  }

  /**
   * Return the current route information for given route. The route has to be active.
   * @param {Route} route - A route object.
   * @return {Route} The updated route.
   */
  getActiveRoute = (route: Route): Route | undefined => {
    return this.activeRouteDictionary[route.id].route
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
      throw new ValidationError('Invalid token passed.')
    }

    return balances.getTokenBalance(walletAddress, token)
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
    tokens: Token[]
  ): Promise<TokenAmount[]> => {
    if (!walletAddress) {
      throw new ValidationError('Missing walletAddress.')
    }

    if (tokens.filter((token) => !isToken(token)).length) {
      throw new ValidationError('Invalid token passed.')
    }

    return balances.getTokenBalances(walletAddress, tokens)
  }

  /**
   * This method queries the balances of tokens for a specific list of chains for a given wallet.
   * @param {string} walletAddress - A walletaddress.
   * @param {{ [chainId: number]: Token[] }} tokensByChain - A list of Token objects organized by chain ids.
   * @return {Promise<{ [chainId: number]: TokenAmount[] }} A list of objects containing the tokens and the amounts on different chains organized by the chosen chains.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  getTokenBalancesForChains = async (
    walletAddress: string,
    tokensByChain: { [chainId: number]: Token[] }
  ): Promise<{ [chainId: number]: TokenAmount[] }> => {
    if (!walletAddress) {
      throw new ValidationError('Missing walletAddress.')
    }

    const tokenList = Object.values(tokensByChain).flat()
    if (tokenList.filter((token) => !isToken(token)).length) {
      throw new ValidationError('Invalid token passed.')
    }

    return balances.getTokenBalancesForChains(walletAddress, tokensByChain)
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
}
