export enum Chain {
  Arbitrum = 'ARB',
  Avalanche = 'AVAX',
  BinanceSmartChain = 'BSC',
  Bitcoin = 'BTC',
  BitcoinCash = 'BCH',
  Cosmos = 'GAIA',
  Dash = 'DASH',
  Dogecoin = 'DOGE',
  Ethereum = 'ETH',
  Kujira = 'KUJI',
  Litecoin = 'LTC',
  Maya = 'MAYA',
  Optimism = 'OP',
  Polkadot = 'DOT',
  Chainflip = 'FLIP',
  Polygon = 'MATIC',
  Radix = 'XRD',
  THORChain = 'THOR',
  Solana = 'SOL',
}

export type UTXOChain =
  | Chain.Bitcoin
  | Chain.BitcoinCash
  | Chain.Dash
  | Chain.Dogecoin
  | Chain.Litecoin

export type UTXOType = {
  hash: string
  index: number
  value: number
  txHex?: string
  witnessUtxo?: any
}

export type BlockchairApiParams<T> = T & {
  chain: Chain
  apiKey: string
}

export interface BlockchairMultipleBalancesResponse {
  [key: string]: number
}

export interface BlockchairVin {
  txid: string
  vout: number
  scriptSig: {
    asm: string
    hex: string
  }
  sequence: number
}

export interface BlockchairVout {
  value: number
  n: number
  scriptPubKey: {
    asm: string
    hex: string
    address: string
    type: string
    addresses: string[]
    reqSigs: number
  }
}

export interface BlockchairTransaction {
  block_id: number
  hash: string
  time: string
  balance_change: number
}

export interface BlockchairUtxo {
  block_id: number
  transaction_hash: string
  index: number
  value: number
}

export interface BlockchairAddressCoreData {
  type: string
  script_hex: string
  balance: number
  balance_usd: number
  received: number
  received_usd: number
  spent: number
  spent_usd: number
  output_count: number
  unspent_output_count: number
  first_seen_receiving: string
  last_seen_receiving: string
  first_seen_spending: null | string
  last_seen_spending: null | string
  transaction_count: number
  scripthash_type: null | string
}

export interface BlockchairInputOutputCommonData {
  block_id: number
  transaction_id: number
  index: number
  transaction_hash: string
  date: string
  time: string
  value: number
  value_usd: number
  recipient: string
  type: string
  script_hex: string
  is_from_coinbase: boolean
  is_spendable: boolean | null
  is_spent: boolean
  lifespan: number | null
  cdd: number | null
}
export interface BlockchairTransactionInputOutput
  extends BlockchairSpendingBlockData,
    BlockchairInputOutputCommonData {
  scripthash_type: null | string
}

export interface BlockchairSpendingBlockData {
  spending_block_id: number | null
  spending_transaction_id: number | null
  spending_index: number | null
  spending_transaction_hash: string | null
  spending_date: string | null
  spending_time: string | null
  spending_value_usd: number | null
  spending_sequence: number | null
  spending_signature_hex: string | null
  spending_witness: string | null
}

export interface BlockchairAddressResponse {
  [key: string]: {
    address: BlockchairAddressCoreData
    transactions: BlockchairTransaction[]
    utxo: BlockchairUtxo[]
  }
}

export interface BlockchairOutputsResponse
  extends BlockchairSpendingBlockData,
    BlockchairInputOutputCommonData {}

export interface BlockchairRawTransactionResponse {
  [key: string]: {
    raw_transaction: string
    decoded_raw_transaction: {
      txid: string
      hash: string
      version: number
      size: number
      vsize: number
      weight: number
      locktime: number
      vin: BlockchairVin[]
      vout: BlockchairVout[]
    }
  }
}

export interface BlockchairMultipleAddressesResponse {
  addresses: {
    [key: string]: BlockchairAddressCoreData
  }
  transactions: BlockchairTransaction[]
  utxo: BlockchairUtxo[]
  set: {
    address_count: number
    balance: number
    balance_usd: number
    received: number
    spent: number
    output_count: number
    unspent_output_count: number
    first_seen_receiving: string
    last_seen_receiving: string
    first_seen_spending: null | string
    last_seen_spending: null | string
    transaction_count: number
  }
}

export interface BlockchairResponse<T> {
  data: T
  context: {
    code: number
    source: string
    results: number
    state: number
    market_price_usd: number
    cache: {
      live: boolean
      duration: number
      since: string
      until: string
      time: any
    }
    api: {
      version: string
      last_major_update: string
      next_major_update: null | string
      documentation: string
      notice: string
    }
    servers: string
    time: number
    render_time: number
    full_time: number
    request_cost: number
  }
}

export interface BlockchairDashboardTransactionResponse {
  [key: string]: {
    transaction: {
      block_id: number
      id: number
      hash: string
      date: string
      time: string
      size: number
      weight: number
      version: number
      lock_time: number
      is_coinbase: boolean
      has_witness: boolean
      input_count: number
      output_count: number
      input_total: number
      input_total_usd: number
      output_total: number
      output_total_usd: number
      fee: number
      fee_usd: number
      fee_per_kb: number
      fee_per_kb_usd: number
      fee_per_kwu: number
      fee_per_kwu_usd: number
      cdd_total: number
      is_rbf: boolean
    }
    inputs: BlockchairTransactionInputOutput[]
    outputs: BlockchairTransactionInputOutput[]
  }
}
