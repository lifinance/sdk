import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  rpc,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

export const NETWORK: string = Networks.TESTNET

/** Signs every fixture envelope. */
export const keypair: Keypair = Keypair.random()

/** Time bounds of the fixture envelope, in unix seconds (chain time). */
export const MIN_TIME = 1_800_000_000
export const MAX_TIME: number = MIN_TIME + 300

/**
 * A real signed envelope, so the derived hash and the time bounds decode as
 * they do for a real route. Without `timebounds` the envelope gets the SDK
 * default of `[0, now + 300 s]`.
 */
export const buildSignedTransaction = (timebounds?: {
  minTime: number
  maxTime: number
}): Transaction => {
  const builder = new TransactionBuilder(
    new Account(keypair.publicKey(), '1'),
    {
      fee: BASE_FEE,
      networkPassphrase: NETWORK,
      ...(timebounds ? { timebounds } : {}),
    }
  ).addOperation(
    Operation.payment({
      destination: keypair.publicKey(),
      asset: Asset.native(),
      amount: '1',
    })
  )
  if (!timebounds) {
    builder.setTimeout(300)
  }
  const transaction = builder.build()
  transaction.sign(keypair)
  return transaction
}

/** NOT_FOUND from a node that covers [MIN_TIME, MAX_TIME + margin]. */
export const coveringNotFound = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  status: rpc.Api.GetTransactionStatus.NOT_FOUND,
  oldestLedgerCloseTime: MIN_TIME - 86_400,
  latestLedgerCloseTime: MAX_TIME + 600,
  ...overrides,
})

/** The rejection that `submitStellarTransaction` throws for a terminal status. */
export const rejection = (reason = 'txBadSeq'): TransactionError =>
  new TransactionError(
    LiFiErrorCode.TransactionFailed,
    `Stellar transaction submission failed: ${reason}`
  )
