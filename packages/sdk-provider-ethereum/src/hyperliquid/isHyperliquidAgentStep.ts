import type { LiFiStep, LiFiStepExtended, TypedData } from '@lifi/sdk'

export function isHyperliquidAgentStep(
  step: LiFiStepExtended | LiFiStep
): boolean {
  return (
    step.tool === 'hyperliquidSpotProtocol' &&
    !!step.typedData?.some(
      (p) => p.primaryType === 'HyperliquidTransaction:ApproveAgent'
    )
  )
}

export function isApproveAgentMessage(typedData: TypedData): boolean {
  return typedData.primaryType === 'HyperliquidTransaction:ApproveAgent'
}

export function isHyperliquidOrderMessage(typedData: TypedData): boolean {
  return typedData.primaryType === 'Agent' && typedData.message.connectionId
}
