import type { LiFiStep, LiFiStepExtended, TypedData } from '@lifi/sdk'

const APPROVE_AGENT_PRIMARY_TYPE = 'HyperliquidTransaction:ApproveAgent'

export function isHyperliquidAgentStep(
  step: LiFiStepExtended | LiFiStep
): boolean {
  return !!step.typedData?.some(
    (p) => (p.primaryType as string) === APPROVE_AGENT_PRIMARY_TYPE
  )
}

export function isApproveAgentMessage(typedData: TypedData): boolean {
  return (typedData.primaryType as string) === APPROVE_AGENT_PRIMARY_TYPE
}

export function isHyperliquidOrderMessage(typedData: TypedData): boolean {
  return (
    (typedData.primaryType as string).startsWith('HyperliquidTransaction:') &&
    !isApproveAgentMessage(typedData)
  )
}
