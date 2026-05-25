export const safeStringifyBigInt = (value: unknown): string =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))

const formatSolanaErr = (err: unknown): string =>
  typeof err === 'object' && err !== null
    ? safeStringifyBigInt(err)
    : String(err)

/**
 * Carries the structured payload of a failed Solana RPC simulation or
 * confirmation so consumers can inspect `err` and `logs` directly from
 * the thrown `TransactionError`'s `cause`, without re-simulating.
 */
export class SolanaTransactionDetailsError extends Error {
  readonly err: unknown
  readonly logs: readonly string[] | null

  constructor(err: unknown, logs: readonly string[] | null = null) {
    super(formatSolanaErr(err))
    this.name = 'SolanaTransactionDetailsError'
    this.err = err
    this.logs = logs
  }
}
