import { zeroAddress } from 'viem'

export const AlternativeAddressZero =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export const isZeroAddress = (address: string): boolean => {
  // Addresses can come checksummed, e.g. 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE.
  // `?.` because JavaScript callers can pass a token without an address.
  const lowercaseAddress = address?.toLowerCase()
  return (
    lowercaseAddress === zeroAddress ||
    lowercaseAddress === AlternativeAddressZero
  )
}
