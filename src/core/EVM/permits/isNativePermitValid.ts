import type { SignedTypedData, TypedData } from '@lifi/types'

/**
 * Checks if an existing native permit is valid for the given requirements
 */
export const isNativePermitValid = (
  permit: SignedTypedData,
  typedData: TypedData
): boolean => {
  // Only check native permits (EIP-2612)
  if (permit.primaryType !== 'Permit') {
    return false
  }

  // Check if the permit is for the correct chain
  if (
    Number(permit.domain.chainId) !== Number(typedData.domain.chainId) ||
    (permit.domain.salt && permit.domain.salt !== typedData.domain.salt)
  ) {
    return false
  }

  // Check if the permit message has the required fields
  const message = permit.message as any
  if (!message) {
    return false
  }

  // Check spender
  if (
    message.spender?.toLowerCase() !== typedData.message.spender?.toLowerCase()
  ) {
    return false
  }

  // Check owner
  if (message.owner?.toLowerCase() !== typedData.message.owner?.toLowerCase()) {
    return false
  }

  // Check amount (value field in native permits)
  const permitAmount = BigInt(message.value || 0)
  if (permitAmount < BigInt(typedData.message.value || 0)) {
    return false
  }

  // Check deadline (must have at least 5 minutes remaining)
  const deadlineTimestamp = parseInt(message.deadline || 0, 10)
  // Add 5 minutes bufferto the current timestamp
  const allowedTimestamp = Math.floor(Date.now() / 1000) + 5 * 60

  if (deadlineTimestamp <= allowedTimestamp) {
    return false
  }

  return true
}
