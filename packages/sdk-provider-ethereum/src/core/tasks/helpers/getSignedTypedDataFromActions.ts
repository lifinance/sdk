import type {
  LiFiStepExtended,
  SignedTypedData,
  StatusManager,
} from '@lifi/sdk'

export function getSignedTypedDataFromActions(
  step: LiFiStepExtended,
  statusManager: StatusManager
): SignedTypedData[] {
  const permit = statusManager.findAction(step, 'PERMIT')?.signedTypedData ?? []
  const nativePermit =
    statusManager.findAction(step, 'NATIVE_PERMIT')?.signedTypedData ?? []
  return [...permit, ...nativePermit]
}
