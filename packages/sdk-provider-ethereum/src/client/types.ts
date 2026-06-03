export interface SafeInfo {
  threshold: number
  owners: string[]
}

export interface SafeMultisigTransaction {
  safeTxHash: string
  nonce: number
  isExecuted: boolean
  transactionHash?: string
  isSuccessful?: boolean
  confirmations?: Array<{ signature?: string }>
}

export interface SafeMultisigTransactionList {
  count: number
  results: SafeMultisigTransaction[]
}
