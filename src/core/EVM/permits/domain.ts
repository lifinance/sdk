import type { Address, TypedDataDomain } from 'viem'

const PERMIT2_DOMAIN_NAME = 'Permit2'

export function permit2Domain(
  permit2Address: Address,
  chainId: number
): TypedDataDomain {
  return {
    name: PERMIT2_DOMAIN_NAME,
    chainId,
    verifyingContract: permit2Address,
  }
}
