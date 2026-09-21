import type { SignedTypedData, TypedData } from '@lifi/sdk'
import { isValidSignature } from '../../../utils/isValidSignature.js'

/** Whether `signedTypedData` already holds a signature for this exact entry. */
export function isTypedDataAlreadySigned(
  signedTypedData: SignedTypedData[],
  typedData: TypedData
): boolean {
  // `Permit` stays with `isNativePermitValid`, which also checks the deadline,
  // the amount and the salt. Equality alone would drop those checks.
  if (typedData.primaryType === 'Permit') {
    return false
  }

  return signedTypedData.some(
    (signed) =>
      signed.primaryType === typedData.primaryType &&
      isValidSignature(signed.signature) &&
      isSameValue(signed.domain, typedData.domain) &&
      isSameValue(signed.message, typedData.message)
  )
}

/**
 * `domain` and `message` are decoded JSON, so compare them structurally: a
 * round trip through the API rebuilds the objects, and `JSON.stringify` both
 * depends on key order and throws on a `bigint`. Scalars compare by string
 * form, because `1`, `1n` and `'1'` are one EIP-712 value.
 */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => isSameValue(item, b[index]))
    )
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && isSameValue(a[key], b[key]))
    )
  }
  if (a == null || b == null) {
    return false
  }
  return String(a) === String(b)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
