export type UTXOTransaction = {
  blockhash?: string
  blocktime?: number
  confirmations?: number
  hash: string
  hex: string
  in_active_chain?: boolean
  locktime: number
  size: number
  time?: number
  txid: string
  version: number
  vsize: number
  weight: number
  vin: {
    scriptSig: {
      asm: string
      hex: string
    }
    sequence: number
    txid: string
    txinwitness: string[]
    vout: number
  }[]
  vout: {
    n: 0
    scriptPubKey:
      | {
          address: string
          asm: string
          desc: string
          hex: string
          type: string
        }
      | {
          asm: string
          desc: string
          hex: string
          type: string
        }
    value: number
  }[]
}
