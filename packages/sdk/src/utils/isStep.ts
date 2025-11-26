import type { Action, Estimate, LiFiStep } from '@lifi/types'
import { isToken } from './isToken.js'

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
