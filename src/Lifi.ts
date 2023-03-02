/* eslint-disable @typescript-eslint/no-empty-function */
import { FallbackProvider } from '@ethersproject/providers'
import {
  ChainId,
  ChainKey,
  ContractCallQuoteRequest,
  ExtendedChain,
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
} from '@lifi/types'
import { Signer } from 'ethers'
import {
  approveToken,
  ApproveTokenRequest,
  bulkGetTokenApproval,
  getTokenApproval,
  RevokeApprovalRequest,
  revokeTokenApproval,
} from './allowance'
import * as balance from './balance'
import { getRpcProvider } from './connectors'
import { StatusManager } from './execution/StatusManager'
import { StepExecutor } from './execution/StepExecutor'
import { checkPackageUpdates } from './helpers'
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
import { handlePreRestart } from './utils/preRestart'
import { name, version } from './version'

export default class LIFI {
  private activeRouteDictionary: ActiveRouteDictionary = {}
  private configService: ConfigService
  private chainsService: ChainsService

  constructor(configUpdate?: ConfigUpdate) {
    this.configService = ConfigService.getInstance()

    if (configUpdate) {
      // Update API urls before we request chains
      this.configService.updateConfig(configUpdate)
    }

    this.chainsService = ChainsService.getInstance()

    this.chainsService.getChains().then((chains) => {
      this.configService.updateChains(chains)
    })

    checkPackageUpdates(name, version, configUpdate?.disableVersionCheck)
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
   * Get an instance of a provider for a specific cahin
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
   * Get a quote for a destination contract call
   * @param {ContractCallQuoteRequest} request - The configuration of the requested destination call
   * @throws {LifiError} - Throws a LifiError if request fails
   */
  getContractCallQuote = async (
    request: ContractCallQuoteRequest,
    options?: RequestOptions
  ): Promise<Step> => {
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

    const { executionData } = this.activeRouteDictionary[route.id]

    for (const executor of executionData.executors) {
      executor.setInteraction({
        allowInteraction: false,
        allowUpdates: false,
        stopExecution: true,
      })
    }
    delete this.activeRouteDictionary[route.id]
    return route
  }

  /**
   * Executes a route until a user interaction is necessary (signing transactions, etc.) and then halts until the route is resumed.
   * @param {Route} route - A route that is currently in execution.
   * @deprecated use updateRouteExecution instead.
   */
  moveExecutionToBackground = (route: Route): void => {
    const { executionData } = this.activeRouteDictionary[route.id]

    if (!executionData) {
      return
    }
    for (const executor of executionData.executors) {
      executor.setInteraction({ allowInteraction: false, allowUpdates: true })
    }
    executionData.settings = {
      ...executionData.settings,
      executeInBackground: true,
    }
  }

  /**
   * Updates route execution to background or foreground state.
   * @param {Route} route - A route that is currently in execution.
   * @param {boolean} settings - An object with execution settings.
   */
  updateRouteExecution = (
    route: Route,
    settings: Pick<ExecutionSettings, 'executeInBackground'>
  ): void => {
    const { executionData } = this.activeRouteDictionary[route.id]
    if (!executionData) {
      return
    }
    for (const executor of executionData.executors) {
      executor.setInteraction({
        allowInteraction: !settings.executeInBackground,
        allowUpdates: true,
      })
    }
    // Update active route settings so we know what the current state of execution is
    executionData.settings = {
      ...executionData.settings,
      ...settings,
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
    // Deep clone to prevent side effects
    const clonedRoute = structuredClone<Route>(route)

    // Check if route is already running
    if (this.activeRouteDictionary[clonedRoute.id]) {
      // TODO: maybe inform user why nothing happens?
      return this.activeRouteDictionary[clonedRoute.id].executionPromise
    }

    const promiseRoute = this.executeSteps(signer, clonedRoute, settings)

    this.activeRouteDictionary[clonedRoute.id] = {
      ...this.activeRouteDictionary[clonedRoute.id],
      executionPromise: promiseRoute,
    }

    return promiseRoute
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
    // Deep clone to prevent side effects
    const clonedRoute = structuredClone<Route>(route)

    const { executionData, executionPromise } =
      this.activeRouteDictionary[clonedRoute.id]

    if (executionData) {
      const executionHalted = executionData.executors.some(
        (executor) => executor.executionStopped
      )
      if (!executionHalted) {
        // Check if we want to resume route execution in the background
        this.updateRouteExecution(route, {
          executeInBackground: settings?.executeInBackground,
        })
        return executionPromise
      }
    }
    handlePreRestart(clonedRoute)

    const newExecutionPromise = this.executeSteps(signer, clonedRoute, settings)

    this.activeRouteDictionary[clonedRoute.id] = {
      ...this.activeRouteDictionary[clonedRoute.id],
      executionPromise: newExecutionPromise,
    }

    return newExecutionPromise
  }

  private executeSteps = async (
    signer: Signer,
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    const config = this.configService.getConfig()

    const updatedExecutionData: ExecutionData = {
      route,
      executors: [],
      settings: { ...config.defaultExecutionSettings, ...settings },
    }

    this.activeRouteDictionary[route.id].executionData = {
      ...updatedExecutionData,
    }

    const { executionData } = this.activeRouteDictionary[route.id]

    const statusManager = new StatusManager(
      route,
      executionData.settings,
      (route: Route) => {
        if (this.activeRouteDictionary[route.id]) {
          executionData.route = route
        }
      }
    )

    // Loop over steps and execute them
    for (let index = 0; index < route.steps.length; index++) {
      const { executionData } = this.activeRouteDictionary[route.id]
      // Check if execution has stopped in the meantime
      if (!executionData) {
        break
      }

      const step = route.steps[index]
      const previousStep = route.steps[index - 1]
      // Check if the step is already done
      //
      if (step.execution?.status === 'DONE') {
        continue
      }

      // Update amount using output of previous execution. In the future this should be handled by calling `updateRoute`
      if (previousStep?.execution?.toAmount) {
        step.action.fromAmount = previousStep.execution.toAmount
      }

      try {
        const stepExecutor = new StepExecutor(
          statusManager,
          executionData.settings
        )
        executionData.executors.push(stepExecutor)

        // Check if we want to execute this step in the background
        this.updateRouteExecution(route, executionData.settings)

        const executedStep = await stepExecutor.executeStep(signer, step)

        // We may reach this point if user interaction isn't allowed. We want to stop execution until we resume it
        if (executedStep.execution?.status !== 'DONE') {
          this.stopExecution(route)
        }

        // Execution stopped during the current step, we don't want to continue to the next step so we return already
        if (stepExecutor.executionStopped) {
          return route
        }
      } catch (e) {
        this.stopExecution(route)
        throw e
      }
    }

    // Clean up after the execution
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
    this.activeRouteDictionary[route.id].executionData.settings = {
      ...config.defaultExecutionSettings,
      ...settings,
    }
  }

  /**
   * Get the list of active routes.
   * @return {Route[]} A list of routes.
   */
  getActiveRoutes = (): Route[] => {
    return Object.values(this.activeRouteDictionary).map(
      (dict) => dict.executionData.route
    )
  }

  /**
   * Return the current route information for given route. The route has to be active.
   * @param {Route} route - A route object.
   * @return {Route} The updated route.
   */
  getActiveRoute = (route: Route): Route | undefined => {
    return this.activeRouteDictionary[route.id]?.executionData.route
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
          (token as Token).address
        }" on chainId "${(token as Token).chainId}"`
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
   * @param {string} walletAddress - A walletaddress.
   * @param {{ [chainId: number]: Token[] }} tokensByChain - A list of Token objects organized by chain ids.
   * @return {Promise<{ [chainId: number]: TokenAmount[] }>} A list of objects containing the tokens and the amounts on different chains organized by the chosen chains.
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
    const invalidTokens = tokenList.filter((token) => !isToken(token))
    if (invalidTokens.length) {
      throw new ValidationError(
        `Invalid token passed: address "${invalidTokens[0].address}" on chainId "${invalidTokens[0].chainId}"`
      )
    }

    return balance.getTokenBalancesForChains(walletAddress, tokensByChain)
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
