import { isDelegationDesignatorCode } from '../permits/isDelegationDesignatorCode.js'

/**
 * True iff the code is a smart-contract wallet (Safe, ERC-4337, ERC-7579,
 * custom). Plain EOAs and EIP-7702 delegated EOAs (which still pay their
 * own gas / can sign ECDSA) return false.
 */
export const isSmartContractWalletCode = (code?: string): boolean =>
  !!code && code !== '0x' && !isDelegationDesignatorCode(code)
