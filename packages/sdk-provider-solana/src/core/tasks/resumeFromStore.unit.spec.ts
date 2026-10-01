import { getBase64EncodedWireTransaction, type Transaction } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SWAP_TRANSACTION_BASE64,
  SWAP_TRANSACTION_BLOCKHASH,
} from '../../utils/getTransactionLifetime.unit.mock.js'
import {
  signatureFilledWith,
  signedNonceTransactionBase64,
  signedSwapTransactionBase64,
} from '../../utils/storedTransactions.unit.mock.js'

const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

const lookupSignatureStatus = vi.fn()
vi.mock('../../actions/lookupSignatureStatus.js', () => ({
  lookupSignatureStatus: (...args: unknown[]) => lookupSignatureStatus(...args),
}))

const { resumeFromStore } = await import('./resumeFromStore.js')
const {
  CLOCK_SKEW_MARGIN_MS,
  DROPPED_FALLBACK_AGE_MS,
  LiFiErrorCode,
  MAX_RESEND_AGE_MS,
  RPCError,
  TransactionError,
} = await import('@lifi/sdk')

const MESSAGES = {
  rpcUnavailable: 'every RPC failed',
  notConfirmed: 'not confirmed before the SDK stopped waiting',
  allRpcsFailed: 'all failed',
  someRpcsFailed: 'some failed',
}

/** Every RPC answered, none had the transaction, nothing proved absence. */
const NOTHING_FOUND = { kind: 'unknown', answered: true, errors: [] }
/** A covering RPC with its head past the landing window answered null. */
const PROVEN_ABSENT = { kind: 'not-found' }

const updateAction = vi.fn()
const send = vi.fn()
/** Only the sign task resolves the account, so a resume never needs the
 * wallet to have reconnected. */
const getWalletAccount = vi.fn()
const client = {}

/** A signing time `ms` before now. */
const ago = (ms: number): number => Date.now() - ms

/**
 * The first look has no bounds and can only find; the dropped check passes
 * bounds and may prove absence.
 */
const lookupAnswers = (first: unknown, bounded: unknown = NOTHING_FOUND) =>
  lookupSignatureStatus.mockImplementation(
    async (_client: unknown, _signature: unknown, bounds?: unknown) =>
      bounds ? bounded : first
  )

/** Runs a resume of a SWAP action carrying `fields`. */
const resume = (fields: Record<string, unknown>, signedAt?: number) =>
  resumeFromStore(
    {
      client,
      step: { execution: { signedAt } },
      statusManager: { updateAction },
      fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
      isBridgeExecution: false,
      getWalletAccount,
    } as never,
    { type: 'SWAP', status: 'PENDING', ...fields } as never,
    { messages: MESSAGES, send }
  )

const found = (confirmationStatus: string, err: unknown = null) => ({
  kind: 'found',
  status: { confirmationStatus, err },
})

/** Every `updateAction` params object that names `txHex`. */
const txHexWrites = () =>
  updateAction.mock.calls
    .map((call) => call[3])
    .filter((params) => params && 'txHex' in params)

describe('resumeFromStore', () => {
  beforeEach(() => {
    updateAction.mockReset()
    getWalletAccount.mockReset()
    send.mockReset().mockResolvedValue({ status: 'COMPLETED' })
    lookupSignatureStatus.mockReset()
    lookupAnswers(NOTHING_FOUND)
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
  })

  it('looks the first signature up, without bounds, before it sends anything', async () => {
    const txHex = signedSwapTransactionBase64(7)

    await expect(resume({ txHex }, Date.now())).resolves.toEqual({
      status: 'COMPLETED',
    })

    // The first look only has to find a landed transaction: no canary.
    expect(lookupSignatureStatus).toHaveBeenCalledTimes(1)
    expect(lookupSignatureStatus.mock.calls[0]).toEqual([
      client,
      signatureFilledWith(7),
    ])
    expect(send).toHaveBeenCalledTimes(1)
    expect(lookupSignatureStatus.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0]
    )
  })

  it('hands send exactly the stored bytes and their lifetime', async () => {
    const txHex = signedSwapTransactionBase64(7)

    await resume({ txHex }, Date.now())

    const [stored, lifetimes] = send.mock.calls[0]
    expect(
      stored.transactions.map((transaction: Transaction) =>
        getBase64EncodedWireTransaction(transaction)
      )
    ).toEqual([txHex])
    expect(stored.signature).toBe(signatureFilledWith(7))
    expect(lifetimes).toEqual([
      { kind: 'blockhash', blockhash: SWAP_TRANSACTION_BLOCKHASH },
    ])
  })

  it('hands send a stored bundle whole, with the first signature', async () => {
    const wires = [
      signedSwapTransactionBase64(7),
      signedSwapTransactionBase64(8),
    ]

    await resume({ txHex: JSON.stringify(wires) }, Date.now())

    const [stored] = send.mock.calls[0]
    expect(stored.isBundle).toBe(true)
    expect(
      stored.transactions.map((transaction: Transaction) =>
        getBase64EncodedWireTransaction(transaction)
      )
    ).toEqual(wires)
    expect(lookupSignatureStatus.mock.calls[0][1]).toBe(signatureFilledWith(7))
  })

  it('does not send when the lookup finds the transaction confirmed', async () => {
    lookupAnswers(found('finalized'))
    const txHex = signedSwapTransactionBase64(7)

    await expect(resume({ txHex }, Date.now())).resolves.toEqual({
      status: 'COMPLETED',
    })

    expect(send).not.toHaveBeenCalled()
    const signature = signatureFilledWith(7)
    expect(txHexWrites()).toEqual([
      { txHash: signature, txLink: `https://explorer/tx/${signature}` },
    ])
  })

  it('reports a transaction the lookup found failed as a final failure, without sending', async () => {
    lookupAnswers(found('confirmed', { InstructionError: [0, 'Custom'] }))

    await expect(
      resume({ txHex: signedSwapTransactionBase64(7) }, Date.now())
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      final: true,
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('resends a transaction the lookup sees only as processed', async () => {
    lookupAnswers(found('processed'))

    await resume({ txHex: signedSwapTransactionBase64(7) }, Date.now())

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('resends a blockhash transaction whatever its age: the chain decides', async () => {
    await resume({ txHex: signedSwapTransactionBase64(7) }, ago(60 * 60_000))

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('resends a durable-nonce transaction inside the resend age cap', async () => {
    await resume(
      { txHex: signedNonceTransactionBase64(9) },
      ago(MAX_RESEND_AGE_MS - 10_000)
    )

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1]).toEqual([{ kind: 'nonce' }])
  })

  it('never sends a durable-nonce transaction past the resend age cap', async () => {
    // A send there would execute a swap on an old quote (spec 4.2.8). Just
    // past the cap, the dropped check does not run yet either.
    const thrown = await resume(
      { txHex: signedNonceTransactionBase64(9) },
      ago(MAX_RESEND_AGE_MS + 1_000)
    ).catch((e) => e)

    expect(send).not.toHaveBeenCalled()
    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(lookupSignatureStatus).toHaveBeenCalledTimes(1)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('drops a durable-nonce transaction five minutes after signing by the dropped rule', async () => {
    lookupAnswers(NOTHING_FOUND, PROVEN_ABSENT)
    const signedAt = ago(DROPPED_FALLBACK_AGE_MS + 1_000)

    await expect(
      resume({ txHex: signedNonceTransactionBase64(9) }, signedAt)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionExpired,
      message: MESSAGES.notConfirmed,
      final: true,
    })

    expect(send).not.toHaveBeenCalled()
    // No verdict: the lookup takes the freshest current slot as the head.
    expect(lookupSignatureStatus).toHaveBeenLastCalledWith(
      client,
      signatureFilledWith(9),
      { anchor: signedAt - CLOCK_SKEW_MARGIN_MS, expiredAtSlot: undefined }
    )
    expect(txHexWrites().at(-1)).toEqual({ txHex: undefined })
  })

  it('keeps a durable-nonce transaction the status API knows unknown', async () => {
    lookupAnswers(NOTHING_FOUND, PROVEN_ABSENT)
    isKnownToStatusApi.mockResolvedValue(true)

    const thrown = await resume(
      { txHex: signedNonceTransactionBase64(9) },
      ago(DROPPED_FALLBACK_AGE_MS + 1_000)
    ).catch((e) => e)

    expect(thrown.final).toBe(false)
    expect(txHexWrites()).toEqual([])
  })

  it('clears undecodable bytes and fails without a final marker when no txHash exists', async () => {
    // The captured fixture's fee payer slot is empty: it decodes, but no
    // signature can be read. Without a hash it was never accepted, so "Try
    // again" may sign again.
    const thrown = await resume({ txHex: SWAP_TRANSACTION_BASE64 }).catch(
      (e) => e
    )

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionUnprepared)
    expect(thrown.message).toBe(
      'Unable to prepare transaction. Signed transactions are not found.'
    )
    expect(thrown.final).toBe(false)
    expect(txHexWrites()).toEqual([{ txHex: undefined }])
    expect(lookupSignatureStatus).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('clears undecodable bytes and continues by hash when a txHash exists', async () => {
    lookupAnswers(found('confirmed'))

    await expect(
      resume({ txHex: '%damaged%', txHash: 'hash-sig' }, Date.now())
    ).resolves.toEqual({ status: 'COMPLETED' })

    expect(txHexWrites()[0]).toEqual({ txHex: undefined })
    expect(lookupSignatureStatus.mock.calls[0]).toEqual([client, 'hash-sig'])
    expect(send).not.toHaveBeenCalled()
  })

  // Damaged storage: the stored bytes are another transaction than the
  // stored txHash. They prove nothing about it, and they may have been sent.
  // Without the check, the blockhash bytes would be resent and the nonce
  // bytes would be dropped.
  it.each([
    ['blockhash', signedSwapTransactionBase64],
    ['durable-nonce', signedNonceTransactionBase64],
  ])(
    'never sends or drops %s bytes whose first signature is not the stored txHash',
    async (_kind, signedTransactionBase64) => {
      lookupAnswers(NOTHING_FOUND, PROVEN_ABSENT)

      const thrown = await resume(
        { txHex: signedTransactionBase64(7), txHash: signatureFilledWith(8) },
        ago(DROPPED_FALLBACK_AGE_MS + 60_000)
      ).catch((e) => e)

      expect(send).not.toHaveBeenCalled()
      expect(thrown).toBeInstanceOf(TransactionError)
      expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
      expect(thrown.message).toBe(MESSAGES.notConfirmed)
      expect(thrown.final).toBe(false)
      // One look by the stored txHash, without bounds: no dropped check.
      expect(lookupSignatureStatus.mock.calls).toEqual([
        [client, signatureFilledWith(8)],
      ])
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
      // txHex and txHash stay.
      expect(updateAction).not.toHaveBeenCalled()
    }
  )

  it('records the stored txHash as landed when the lookup finds it, although the stored bytes differ', async () => {
    lookupAnswers(found('finalized'))
    const txHash = signatureFilledWith(8)

    await expect(
      resume({ txHex: signedSwapTransactionBase64(7), txHash }, Date.now())
    ).resolves.toEqual({ status: 'COMPLETED' })

    expect(send).not.toHaveBeenCalled()
    expect(txHexWrites()).toEqual([
      { txHash, txLink: `https://explorer/tx/${txHash}` },
    ])
  })

  it('looks a route from before the upgrade up by hash and never sends', async () => {
    const thrown = await resume({ txHash: 'hash-sig' }, ago(60_000)).catch(
      (e) => e
    )

    expect(send).not.toHaveBeenCalled()
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.message).toBe(MESSAGES.notConfirmed)
    expect(thrown.final).toBe(false)
    // Younger than the fallback: no bounded lookup, no status API.
    expect(lookupSignatureStatus).toHaveBeenCalledTimes(1)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('drops a route from before the upgrade by the time fallback', async () => {
    lookupAnswers(NOTHING_FOUND, PROVEN_ABSENT)

    await expect(
      resume({ txHash: 'hash-sig' }, ago(DROPPED_FALLBACK_AGE_MS + 60_000))
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionExpired,
      final: true,
    })

    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      client,
      expect.anything(),
      'hash-sig'
    )
  })

  it('keeps an old route unknown when no RPC can prove the absence', async () => {
    // Every node that answered has pruned the signing time: its null proves
    // nothing, and the exit is "delete the route" (spec 4.2.8, section 8).
    lookupAnswers(NOTHING_FOUND, NOTHING_FOUND)

    const thrown = await resume(
      { txHash: 'hash-sig' },
      ago(DROPPED_FALLBACK_AGE_MS + 60_000)
    ).catch((e) => e)

    expect(thrown.final).toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('reports RpcUnavailable when no RPC answered and nothing may be sent', async () => {
    const errors = [new Error('429')]
    lookupAnswers({ kind: 'unknown', answered: false, errors })

    const thrown = await resume({ txHash: 'hash-sig' }, ago(60_000)).catch(
      (e) => e
    )

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.message).toBe(MESSAGES.rpcUnavailable)
    expect(thrown.cause.errors).toEqual(errors)
  })

  it('fails as today when neither txHex nor txHash exists', async () => {
    await expect(resume({})).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionUnprepared,
      message:
        'Unable to prepare transaction. Signed transactions are not found.',
    })

    expect(lookupSignatureStatus).not.toHaveBeenCalled()
  })

  it('takes an outage of the first look to the dropped rule too', async () => {
    // Nothing may be sent for a hash alone. A permanent RPC problem must not
    // keep "Try again" looping where the transaction can no longer land.
    lookupAnswers(
      { kind: 'unknown', answered: false, errors: [] },
      PROVEN_ABSENT
    )

    await expect(
      resume({ txHash: 'hash-sig' }, ago(DROPPED_FALLBACK_AGE_MS + 60_000))
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionExpired,
      final: true,
    })

    expect(lookupSignatureStatus).toHaveBeenCalledTimes(2)
    expect(lookupSignatureStatus.mock.calls[1][2].expiredAtSlot).toBeUndefined()
    expect(isKnownToStatusApi).toHaveBeenCalledTimes(1)
  })

  it('records nothing for a hash the lookup sees only as processed', async () => {
    // Only a confirmed status is a landing; a processed one may still fall
    // off a minority fork.
    lookupAnswers(found('processed'))

    const thrown = await resume({ txHash: 'hash-sig' }, ago(60_000)).catch(
      (e) => e
    )

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('keeps the stored bytes when nothing may be sent and the outcome stays unknown', async () => {
    await resume(
      { txHex: signedNonceTransactionBase64(9) },
      ago(MAX_RESEND_AGE_MS + 1_000)
    ).catch(() => undefined)

    expect(send).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('never resolves the wallet account', async () => {
    await resume({ txHex: signedSwapTransactionBase64(7) }, Date.now())
    lookupAnswers(found('confirmed'))
    await resume({ txHash: 'hash-sig' }, Date.now())

    expect(send).toHaveBeenCalledTimes(1)
    expect(getWalletAccount).not.toHaveBeenCalled()
  })
})
