import type { TypedDataDomain } from 'viem'

/**
 * Helper function to get the chain ID from a TypedDataDomain.
 * Extracts the chain ID from either the chainId field or the salt field.
 * The salt is expected to be a padded hex string representation of the chainId.
 */
export const getDomainChainId = (domain: TypedDataDomain): number | null => {
  if (domain.chainId) {
    return Number(domain.chainId)
  }
  if (!domain.salt) {
    return null
  }
  try {
    // Convert the hex salt to a number
    // The salt should be a padded 32-byte hex representation of the chainId
    const saltChainId = Number(domain.salt)
    return !Number.isNaN(saltChainId) ? saltChainId : null
  } catch {
    return null
  }
}
