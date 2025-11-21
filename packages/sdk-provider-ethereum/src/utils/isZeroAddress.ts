export const AddressZero = '0x0000000000000000000000000000000000000000'
export const AlternativeAddressZero =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export const isZeroAddress = (address: string): boolean => {
  if (address === AddressZero || address === AlternativeAddressZero) {
    return true
  }
  return false
}
