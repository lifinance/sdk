import type { EIP1193RequestFn } from 'viem'

export type UTXOWalletSchema = readonly [
  {
    Method: 'signPsbt'
    Parameters: SignPsbtParameters
    ReturnType: SignPsbtReturnType
  },
]

export type SignPsbtParameters = {
  /** The PSBT encoded as a hexadecimal string */
  psbt: string
  /**
   * Array of objects specifying details about the inputs to be signed
   */
  inputsToSign: {
    /**
     * The SigHash type to use for signing (e.g., SIGHASH_ALL).
     * If not specified, a default value is used.
     */
    sigHash?: number
    /** The Bitcoin address associated with the input that will be signed */
    address: string
    /** An array of indexes in the PSBT corresponding to the inputs that need to be signed */
    signingIndexes: number[]
  }[]
  /**
   * Whether to finalize the PSBT after signing.
   * If `true`, the PSBT will be completed and ready for broadcasting.
   * If `false` or omitted, the PSBT remains partially signed.
   * Some wallets does not support it.
   */
  finalize?: boolean
}

export type SignPsbtReturnType = string

export type UTXOWalletProvider = {
  request: EIP1193RequestFn<UTXOWalletSchema>
}

export type BtcAccount = {
  address: string
  addressType: 'p2tr' | 'p2wpkh' | 'p2wsh' | 'p2sh' | 'p2pkh'
  publicKey: string
  purpose: 'payment' | 'ordinals'
}
