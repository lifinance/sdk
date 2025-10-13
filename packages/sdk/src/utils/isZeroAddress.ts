import { AddressZero, AlternativeAddressZero } from '../constants.js'

export const isZeroAddress = (address: string): boolean => {
  if (address === AddressZero || address === AlternativeAddressZero) {
    return true
  }
  return false
}
