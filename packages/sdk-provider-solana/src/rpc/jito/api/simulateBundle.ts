import type { Base64EncodedWireTransaction } from '@solana/kit'

type AccountConfig = {
  accountIndex: number
  addresses: string[]
}

type JitoAccountInfo = {
  executable: boolean
  owner: string
  lamports: number
  data: string
  rentEpoch: number
}

type SimulateBundleResponse = {
  context: {
    apiVersion: string
    slot: number
  }
  value: {
    summary: 'succeeded' | { failed: { error: unknown; tx_signature: string } }
    transactionResults: Array<{
      err: unknown
      logs: string[] | null
      unitsConsumed?: number
      returnData: {
        programId: string
        data: string
      } | null
      preExecutionAccounts: JitoAccountInfo[] | null
      postExecutionAccounts: JitoAccountInfo[] | null
    }>
  }
}

export type SimulateBundleApi = {
  /**
   * Simulates a Jito bundle - runs simulation on the bundle to check if it will succeed
   * @see https://www.quicknode.com/docs/solana/simulateBundle
   */
  simulateBundle(
    params: Readonly<{
      encodedTransactions: Array<Base64EncodedWireTransaction>
    }>,
    config?: Readonly<{
      /** Specifies the bank state for simulation */
      simulationBank?: string
      /** Skips signature verification during simulation */
      skipSigVerify?: boolean
      /** Replaces the recent blockhash in transactions */
      replaceRecentBlockhash?: boolean
      /** Specifies accounts to inspect before execution */
      preExecutionAccountsConfigs?: AccountConfig[]
      /** Specifies accounts to inspect after execution */
      postExecutionAccountsConfigs?: AccountConfig[]
    }>
  ): SimulateBundleResponse
}
