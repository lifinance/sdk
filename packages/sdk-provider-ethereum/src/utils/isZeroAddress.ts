import { zeroAddress } from 'viem'

export const AlternativeAddressZero =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export const isZeroAddress = (address: string): boolean => {
  // Addresses can come checksummed, e.g. 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE.
  const lowercaseAddress = address.toLowerCase()
  return (
    lowercaseAddress === zeroAddress ||
    lowercaseAddress === AlternativeAddressZero
  )
}
