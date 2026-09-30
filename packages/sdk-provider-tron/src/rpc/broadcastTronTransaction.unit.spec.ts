import type { SignedTransaction } from '@tronweb3/tronwallet-abstract-adapter'
import { describe, expect, it, vi } from 'vitest'
import { broadcastTronTransaction } from './broadcastTronTransaction.js'
import { withTronNodes } from './callTronRpcsWithRetry.unit.mock.js'

const TX_ID = 'c3e7a4c5c0b8d2f1e9a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f809102'

const SIGNED_TRANSACTION = {
  visible: false,
  txID: TX_ID,
  raw_data: { expiration: 1_790_000_060_000 },
  raw_data_hex: '0a021a2b',
  signature: ['c0ffee'],
} as unknown as SignedTransaction

type SendRawTransaction = (transaction: unknown) => Promise<unknown>

const accepts: SendRawTransaction = async (transaction) => ({
  result: true,
  transaction,
})
const duplicate: SendRawTransaction = async () => ({
  result: false,
  code: 'DUP_TRANSACTION_ERROR',
})
const refuses: SendRawTransaction = async () => ({
  result: false,
  code: 'CONTRACT_VALIDATE_ERROR',
})
const networkError: SendRawTransaction = async () => {
  throw new Error('socket hang up')
}
// An HTTP 200 error body without a code: TronWeb spreads it next to the
// transaction. It does not tell whether the node took the transaction.
const errorBody: SendRawTransaction = async (transaction) => ({
  Error: 'lack of computing resources',
  transaction,
})
const answersCode =
  (code: string): SendRawTransaction =>
  async () => ({ result: false, code })
// java-tron returns this code after it put the transaction into its pending
// pool: the node holds the transaction although the answer is `result: false`.
const postPush = answersCode('NOT_ENOUGH_EFFECTIVE_CONNECTION')

/** One fake TronWeb per RPC URL; `callTronRpcsWithRetry` tries them in order. */
const withNodes = (...sends: SendRawTransaction[]) =>
  withTronNodes(
    ...sends.map((send) => ({ trx: { sendRawTransaction: vi.fn(send) } }))
  )

describe('broadcastTronTransaction', () => {
  it('is accepted when a node takes the transaction', async () => {
    await expect(
      broadcastTronTransaction(withNodes(accepts), SIGNED_TRANSACTION)
    ).resolves.toEqual({ status: 'accepted', txHash: TX_ID })
  })

  it('treats DUP_TRANSACTION_ERROR as accepted', async () => {
    await expect(
      broadcastTronTransaction(withNodes(duplicate), SIGNED_TRANSACTION)
    ).resolves.toEqual({ status: 'accepted', txHash: TX_ID })
  })

  it('falls through a refusal to a node that accepts', async () => {
    await expect(
      broadcastTronTransaction(withNodes(refuses, accepts), SIGNED_TRANSACTION)
    ).resolves.toEqual({ status: 'accepted', txHash: TX_ID })
  })

  it('is rejected only when every node answered with a refusal', async () => {
    const result = await broadcastTronTransaction(
      withNodes(refuses, refuses),
      SIGNED_TRANSACTION
    )

    expect(result.status).toBe('rejected')
    // The same error as before this change, so the widget text is unchanged.
    expect(result).toMatchObject({
      error: {
        name: 'AggregateError',
        message: 'All 2 Tron RPCs failed',
      },
    })
  })

  it.each([
    ['a refusal, then a network error', [refuses, networkError]],
    ['a network error, then a refusal', [networkError, refuses]],
    ['network errors only', [networkError, networkError]],
  ])('is unknown after %s', async (_label, sends) => {
    const result = await broadcastTronTransaction(
      withNodes(...sends),
      SIGNED_TRANSACTION
    )

    expect(result.status).toBe('unknown')
  })

  // The codes that java-tron returns before the pending-pool push.
  it.each([
    'SIGERROR',
    'BLOCK_UNSOLIDIFIED',
    'NO_CONNECTION',
    'SERVER_BUSY',
    'CONTRACT_VALIDATE_ERROR',
    'CONTRACT_EXE_ERROR',
    // java-tron's spelling (api.proto `BANDWITH_ERROR = 4`), and the alias.
    'BANDWITH_ERROR',
    'BANDWIDTH_ERROR',
    'TAPOS_ERROR',
    'TOO_BIG_TRANSACTION_ERROR',
    'TRANSACTION_EXPIRATION_ERROR',
  ])('is rejected when every node answers %s', async (code) => {
    const result = await broadcastTronTransaction(
      withNodes(answersCode(code), answersCode(code)),
      SIGNED_TRANSACTION
    )

    expect(result.status).toBe('rejected')
  })

  it.each([
    'NOT_ENOUGH_EFFECTIVE_CONNECTION',
    'OTHER_ERROR',
    'A_CODE_THAT_DOES_NOT_EXIST',
  ])('is unknown when every node answers %s', async (code) => {
    const result = await broadcastTronTransaction(
      withNodes(answersCode(code), answersCode(code)),
      SIGNED_TRANSACTION
    )

    expect(result.status).toBe('unknown')
    // The same message as a refusal before this change.
    expect(result).toMatchObject({
      error: {
        name: 'AggregateError',
        errors: [
          { message: `Transaction broadcast failed: ${code}` },
          { message: `Transaction broadcast failed: ${code}` },
        ],
      },
    })
  })

  it('is unknown when one node refuses before the push and another after it', async () => {
    const result = await broadcastTronTransaction(
      withNodes(answersCode('SIGERROR'), postPush),
      SIGNED_TRANSACTION
    )

    expect(result.status).toBe('unknown')
  })

  it('is unknown when every node answers without a code', async () => {
    const result = await broadcastTronTransaction(
      withNodes(errorBody, errorBody),
      SIGNED_TRANSACTION
    )

    expect(result.status).toBe('unknown')
    // The same message as a refusal without a code before this change.
    expect(result).toMatchObject({
      error: {
        name: 'AggregateError',
        errors: [
          { message: 'Transaction broadcast failed: Unknown error' },
          { message: 'Transaction broadcast failed: Unknown error' },
        ],
      },
    })
  })

  it('is rejected when no node could be tried: nothing was sent', async () => {
    const result = await broadcastTronTransaction(
      withNodes(),
      SIGNED_TRANSACTION
    )

    expect(result).toMatchObject({
      status: 'rejected',
      error: { message: 'No Tron RPC URLs available' },
    })
  })
})
