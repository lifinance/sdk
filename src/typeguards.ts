import type {
  Action,
  Estimate,
  LiFiStep,
  RouteOptions,
  RoutesRequest,
  StaticToken,
} from '@lifi/types'

export const isRoutesRequest = (
  routesRequest: RoutesRequest
): routesRequest is RoutesRequest => {
  const {
    fromChainId,
    fromAmount,
    fromTokenAddress,
    toChainId,
    toTokenAddress,
    options,
  } = routesRequest

  return (
    typeof fromChainId === 'number' &&
    typeof fromAmount === 'string' &&
    fromAmount !== '' &&
    typeof fromTokenAddress === 'string' &&
    fromTokenAddress !== '' &&
    typeof toChainId === 'number' &&
    typeof toTokenAddress === 'string' &&
    toTokenAddress !== '' &&
    (!options || isRoutesOptions(options))
  )
}

const isRoutesOptions = (
  routeOptions: RouteOptions
): routeOptions is RouteOptions =>
  !routeOptions?.slippage || typeof routeOptions.slippage === 'number'

export const isStep = (step: LiFiStep): step is LiFiStep => {
  const { id, type, tool, action, estimate } = step

  return (
    typeof id === 'string' &&
    ['swap', 'cross', 'lifi'].includes(type) &&
    typeof tool === 'string' &&
    isAction(action) &&
    isEstimate(estimate)
  )
}

const isAction = (action: Action): action is Action => {
  const { fromChainId, fromAmount, fromToken, toChainId, toToken } = action

  return (
    typeof fromChainId === 'number' &&
    typeof fromAmount === 'string' &&
    fromAmount !== '' &&
    isToken(fromToken) &&
    typeof toChainId === 'number' &&
    isToken(toToken)
  )
}

const isEstimate = (estimate: Estimate): estimate is Estimate => {
  const { fromAmount, toAmount, toAmountMin, approvalAddress } = estimate

  return (
    typeof fromAmount === 'string' &&
    fromAmount !== '' &&
    typeof toAmount === 'string' &&
    toAmount !== '' &&
    typeof toAmountMin === 'string' &&
    toAmountMin !== '' &&
    (typeof approvalAddress === 'string' || approvalAddress === null)
  )
}

export const isToken = (token: StaticToken): token is StaticToken => {
  const { address, decimals, chainId } = token

  return (
    typeof address === 'string' &&
    typeof decimals === 'number' &&
    typeof chainId === 'number'
  )
}
