import type { Blockhash, Signature } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionLifetime } from '../../utils/getTransactionLifetime.js'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

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

const {
  canResendStored,
  cannotLandAnymore,
  failureOf,
  recordLanded,
  resolveUnconfirmed,
  sendAndSettle,
} = await import('./transactionOutcome.js')
const {
  CLOCK_SKEW_MARGIN_MS,
  DROPPED_FALLBACK_AGE_MS,
  isFinalTransactionError,
  LiFiErrorCode,
  MAX_RESEND_AGE_MS,
  RPCError,
  TransactionError,
} = await import('@lifi/sdk')

const SIGNATURE = 'sig' as Signature
const MESSAGES = {
  rpcUnavailable: 'every RPC failed',
  notConfirmed: 'not confirmed before the SDK stopped waiting',
  allRpcsFailed: 'all failed',
  someRpcsFailed: 'some failed',
}
const BLOCKHASH: TransactionLifetime = {
  kind: 'blockhash',
  blockhash: 'B' as Blockhash,
}
const NONCE: TransactionLifetime = { kind: 'nonce' }
const UNKNOWN: TransactionLifetime = { kind: 'unknown' }
/** An RPC's `null` proven by its canary and head (Task S3). */
const PROVEN_ABSENT = { kind: 'not-found' }
const UNPROVEN = { kind: 'unknown', answered: true, errors: [] }
/** No RPC gave a usable status response: an outage (Task S3). */
const SILENT = { kind: 'unknown', answered: false, errors: [] }

/** A signing time `ms` before now. */
const ago = (ms: number): number => Date.now() - ms

const updateAction = vi.fn()
const client = {}
const action = { type: 'SWAP', status: 'PENDING', txHex: 'stored' } as never

const contextWith = (
  options: { signedAt?: number; isBridgeExecution?: boolean } = {}
) => {
  const step = { execution: { signedAt: options.signedAt } }
  return {
    step,
    context: {
      client,
      step,
      statusManager: { updateAction },
      fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
      isBridgeExecution: options.isBridgeExecution ?? false,
    } as never,
  }
}

/** The unknown-outcome error a wait task hands over. */
const unknownError = () =>
  new TransactionError(LiFiErrorCode.TransactionExpired, MESSAGES.notConfirmed)

describe('cannotLandAnymore', () => {
  it('holds on an expiry verdict, whatever the age', () => {
    expect(cannotLandAnymore({ expired: true, signedAt: undefined })).toBe(true)
  })

  it('uses the five-minute fallback without a verdict', () => {
    const check = (signedAt: number) =>
      cannotLandAnymore({ expired: false, signedAt })

    expect(check(ago(DROPPED_FALLBACK_AGE_MS + 1_000))).toBe(true)
    expect(check(ago(DROPPED_FALLBACK_AGE_MS - 1_000))).toBe(false)
  })

  it('does not yet hold for a durable nonce just past the resend age cap', () => {
    // The last send may be seconds old; five minutes leave room for the head
    // of the lookup to pass every slot it could land in.
    expect(
      cannotLandAnymore({
        expired: false,
        signedAt: ago(MAX_RESEND_AGE_MS + 1_000),
      })
    ).toBe(false)
  })

  it('never holds by time when the signing time is unknown', () => {
    expect(cannotLandAnymore({ expired: false, signedAt: undefined })).toBe(
      false
    )
  })
})

describe('canResendStored', () => {
  it('always allows a blockhash transaction: the chain rejects it once the blockhash dies', () => {
    expect(canResendStored([BLOCKHASH], ago(60 * 60_000))).toBe(true)
    expect(canResendStored([BLOCKHASH], undefined)).toBe(true)
  })

  it('allows a durable nonce only inside the resend age cap', () => {
    // Past the cap a send would execute a swap on an old quote.
    expect(canResendStored([NONCE], ago(MAX_RESEND_AGE_MS - 1_000))).toBe(true)
    expect(canResendStored([NONCE], ago(MAX_RESEND_AGE_MS + 1_000))).toBe(false)
    expect(canResendStored([NONCE], undefined)).toBe(false)
  })

  it('applies the age cap to a bundle with any lifetime that does not expire on its own', () => {
    expect(
      canResendStored([BLOCKHASH, NONCE], ago(MAX_RESEND_AGE_MS + 1_000))
    ).toBe(false)
    expect(
      canResendStored([BLOCKHASH, UNKNOWN], ago(MAX_RESEND_AGE_MS + 1_000))
    ).toBe(false)
  })

  it('applies the age cap when no lifetime is known at all', () => {
    // An empty list says nothing about a blockhash, so it never expires on
    // its own.
    expect(canResendStored([], ago(MAX_RESEND_AGE_MS + 1_000))).toBe(false)
  })
})

describe('failureOf', () => {
  it('passes the err of a failed transaction on, and nothing for a success', () => {
    expect(failureOf({ err: 'AccountInUse' })).toEqual({ err: 'AccountInUse' })
    expect(failureOf({ err: null })).toBeUndefined()
  })
})

describe('recordLanded', () => {
  beforeEach(() => {
    updateAction.mockReset()
  })

  it('writes txHash and txLink, clears txHex, and completes', () => {
    const { context } = contextWith()

    expect(
      recordLanded(context, action, {
        signature: SIGNATURE,
        failure: undefined,
      })
    ).toEqual({ status: 'COMPLETED' })

    expect(updateAction).toHaveBeenCalledTimes(1)
    const [, type, status, params] = updateAction.mock.calls[0]
    expect(type).toBe('SWAP')
    expect(status).toBe('PENDING')
    expect(params).toEqual({
      txHash: SIGNATURE,
      txLink: 'https://explorer/tx/sig',
    })
    expect('txHex' in params).toBe(true)
    expect(params.txHex).toBeUndefined()
  })

  it('marks a bridge action DONE', () => {
    const { context } = contextWith({ isBridgeExecution: true })

    recordLanded(context, action, { signature: SIGNATURE, failure: undefined })

    expect(updateAction).toHaveBeenLastCalledWith(
      expect.anything(),
      'SWAP',
      'DONE'
    )
  })

  it('records a failed transaction, then throws a final TransactionFailed', () => {
    // It exists on chain, so its hash is written even though it failed. A
    // resume that found it by lookup has no `txHash` yet.
    const err = { InstructionError: [0, 'AccountInUse'] }
    const { context } = contextWith({ isBridgeExecution: true })

    const thrown = (() => {
      try {
        recordLanded(context, action, {
          signature: SIGNATURE,
          failure: { err },
        })
      } catch (error) {
        return error as InstanceType<typeof TransactionError>
      }
      throw new Error('expected recordLanded to throw')
    })()

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.message).toBe(
      'Transaction failed: {"InstructionError":[0,"AccountInUse"]}'
    )
    expect(thrown.final).toBe(true)
    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
    expect(updateAction).toHaveBeenCalledTimes(1)
    expect(updateAction.mock.calls[0][3].txHash).toBe(SIGNATURE)
  })
})

describe('resolveUnconfirmed', () => {
  beforeEach(() => {
    updateAction.mockReset()
    lookupSignatureStatus.mockReset()
    isKnownToStatusApi.mockReset()
  })

  const resolve = (
    options: { expiredAtSlot?: bigint; signedAt?: number },
    error: unknown = unknownError()
  ) => {
    const { context } = contextWith({ signedAt: options.signedAt })
    return resolveUnconfirmed(context, action, {
      signature: SIGNATURE,
      error,
      expiredAtSlot: options.expiredAtSlot,
      messages: MESSAGES,
    })
  }

  it('rethrows the unknown error, without asking anyone, while the transaction may still land', async () => {
    const error = unknownError()

    await expect(resolve({ signedAt: ago(60_000) }, error)).rejects.toBe(error)

    expect(lookupSignatureStatus).not.toHaveBeenCalled()
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('rethrows without a lookup when the signing time is unknown, verdict or not', async () => {
    // No anchor, so no canary can prove that a node covers the signing time.
    const error = unknownError()

    await expect(resolve({ expiredAtSlot: 900n }, error)).rejects.toBe(error)

    expect(lookupSignatureStatus).not.toHaveBeenCalled()
  })

  it('drops an expired transaction that a covering RPC does not have and the status API does not know', async () => {
    lookupSignatureStatus.mockResolvedValue(PROVEN_ABSENT)
    isKnownToStatusApi.mockResolvedValue(false)
    const signedAt = ago(60_000)
    const error = unknownError()

    const thrown = await resolve(
      { expiredAtSlot: 900n, signedAt },
      error
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.message).toBe(MESSAGES.notConfirmed)
    expect(thrown.final).toBe(true)
    expect(thrown.cause).toBe(error)
    // The head bound is the slot at which the expiry was observed.
    expect(lookupSignatureStatus).toHaveBeenCalledWith(client, SIGNATURE, {
      anchor: signedAt - CLOCK_SKEW_MARGIN_MS,
      expiredAtSlot: 900n,
    })
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      client,
      expect.anything(),
      SIGNATURE
    )
    // The bytes go with a final outcome.
    const [, , , params] = updateAction.mock.calls.at(-1) ?? []
    expect('txHex' in params).toBe(true)
    expect(params.txHex).toBeUndefined()
  })

  it('never drops a transaction the status API knows, even when a covering RPC says not found', async () => {
    // The status API is a veto. HTTP 200 with a status means the transaction
    // is real, whatever one node's history says.
    lookupSignatureStatus.mockResolvedValue(PROVEN_ABSENT)
    isKnownToStatusApi.mockResolvedValue(true)
    const error = unknownError()

    await expect(
      resolve({ expiredAtSlot: 900n, signedAt: ago(60_000) }, error)
    ).rejects.toBe(error)

    expect(updateAction).not.toHaveBeenCalled()
  })

  it('keeps the outcome unknown when no RPC could prove the absence', async () => {
    // A pruned node's null, a head behind the expiry slot, or no canary: the
    // lookup says unknown, and a status API miss cannot make up for it.
    lookupSignatureStatus.mockResolvedValue(UNPROVEN)
    isKnownToStatusApi.mockResolvedValue(false)
    const error = unknownError()

    await expect(
      resolve({ expiredAtSlot: 900n, signedAt: ago(60_000) }, error)
    ).rejects.toBe(error)

    expect(isKnownToStatusApi).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('keeps the outcome unknown when no RPC answered at all', async () => {
    // An outage is no verdict: silence is never read as "not found".
    lookupSignatureStatus.mockResolvedValue(SILENT)
    isKnownToStatusApi.mockResolvedValue(false)
    const error = unknownError()

    await expect(
      resolve({ expiredAtSlot: 900n, signedAt: ago(60_000) }, error)
    ).rejects.toBe(error)

    expect(isKnownToStatusApi).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('returns the status of a transaction that landed after all', async () => {
    const status = { confirmationStatus: 'confirmed', err: null }
    lookupSignatureStatus.mockResolvedValue({ kind: 'found', status })

    await expect(
      resolve({ expiredAtSlot: 900n, signedAt: ago(60_000) })
    ).resolves.toBe(status)

    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('keeps a transaction the lookup sees only as processed unknown', async () => {
    lookupSignatureStatus.mockResolvedValue({
      kind: 'found',
      status: { confirmationStatus: 'processed', err: null },
    })
    const error = unknownError()

    await expect(
      resolve({ expiredAtSlot: 900n, signedAt: ago(60_000) }, error)
    ).rejects.toBe(error)
  })

  it('drops by the time fallback without a verdict, with the current slot as the head', async () => {
    lookupSignatureStatus.mockResolvedValue(PROVEN_ABSENT)
    isKnownToStatusApi.mockResolvedValue(false)
    const signedAt = ago(DROPPED_FALLBACK_AGE_MS + 1_000)

    await expect(resolve({ signedAt })).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionExpired,
      final: true,
    })

    // No `expiredAtSlot`: the lookup takes the freshest current slot.
    expect(lookupSignatureStatus).toHaveBeenCalledWith(client, SIGNATURE, {
      anchor: signedAt - CLOCK_SKEW_MARGIN_MS,
      expiredAtSlot: undefined,
    })
  })
})

describe('sendAndSettle', () => {
  const confirmedFailure = vi.fn()

  beforeEach(() => {
    updateAction.mockReset()
    lookupSignatureStatus.mockReset()
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
    confirmedFailure.mockReset().mockReturnValue(undefined)
  })

  /** Settles what `send` reports for a SWAP action signed at `signedAt`. */
  const settle = (
    send: () => Promise<unknown>,
    options: { signedAt?: number; resuming?: boolean } = {}
  ) => {
    const { context } = contextWith({ signedAt: options.signedAt })
    return sendAndSettle(context, action, {
      signature: SIGNATURE,
      send: send as () => Promise<never>,
      confirmedFailure,
      resuming: options.resuming ?? false,
      messages: MESSAGES,
    })
  }
  const reporting = (result: unknown) => () => Promise.resolve(result)
  const rejecting = (error: unknown) => () => Promise.reject(error)

  /** The `txHex` writes: only these clear the stored bytes. */
  const txHexWrites = () =>
    updateAction.mock.calls
      .map((call) => call[3])
      .filter((params) => params && 'txHex' in params)

  it('records a confirmed result through confirmedFailure, without a lookup', async () => {
    const value = { bundleId: 'b' }

    await expect(
      settle(reporting({ kind: 'confirmed', value }), { signedAt: ago(60_000) })
    ).resolves.toEqual({ status: 'COMPLETED' })

    expect(confirmedFailure).toHaveBeenCalledWith(value)
    expect(lookupSignatureStatus).not.toHaveBeenCalled()
    const [params] = txHexWrites()
    expect(params.txHash).toBe(SIGNATURE)
    expect(params.txHex).toBeUndefined()
  })

  it('throws a final TransactionFailed for a confirmed result that failed on chain', async () => {
    confirmedFailure.mockReturnValue({ err: 'AccountInUse' })

    await expect(
      settle(reporting({ kind: 'confirmed', value: {} }))
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      final: true,
    })
  })

  it('rethrows the unknown error of a young not-confirmed result, without a lookup', async () => {
    // No verdict, so no slot: a defined one would read as an expiry and
    // start the dropped check at once.
    const thrown = await settle(
      reporting({ kind: 'not-confirmed', errors: [] }),
      { signedAt: ago(60_000) }
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.message).toBe(MESSAGES.notConfirmed)
    expect(thrown.final).toBe(false)
    expect(lookupSignatureStatus).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('rethrows RpcUnavailable for a young rpc-unavailable result, without a lookup', async () => {
    const errors = [new Error('429')]

    const thrown = await settle(
      reporting({ kind: 'rpc-unavailable', errors }),
      { signedAt: ago(60_000) }
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.cause.errors).toEqual(errors)
    expect(isFinalTransactionError(thrown)).toBe(false)
    expect(lookupSignatureStatus).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('drops an expired result by the dropped rule, with its verdict slot as the head', async () => {
    lookupSignatureStatus.mockResolvedValue(PROVEN_ABSENT)
    const signedAt = ago(60_000)

    await expect(
      settle(reporting({ kind: 'expired', slot: 900n, errors: [] }), {
        signedAt,
      })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionExpired,
      final: true,
    })

    expect(lookupSignatureStatus).toHaveBeenCalledWith(client, SIGNATURE, {
      anchor: signedAt - CLOCK_SKEW_MARGIN_MS,
      expiredAtSlot: 900n,
    })
    const [params] = txHexWrites()
    expect(params.txHex).toBeUndefined()
  })

  it('takes an old rpc-unavailable result to the dropped rule too', async () => {
    // A permanent RPC problem must not keep "Try again" looping where the
    // transaction can no longer land (spec 4.4.6).
    lookupSignatureStatus.mockResolvedValue(PROVEN_ABSENT)
    const signedAt = ago(DROPPED_FALLBACK_AGE_MS + 1_000)

    const thrown = await settle(
      reporting({ kind: 'rpc-unavailable', errors: [] }),
      { signedAt }
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(true)
    expect(thrown.cause).toBeInstanceOf(RPCError)
    expect(lookupSignatureStatus).toHaveBeenCalledTimes(1)
    expect(lookupSignatureStatus.mock.calls[0][2].expiredAtSlot).toBeUndefined()
    expect(isKnownToStatusApi).toHaveBeenCalledTimes(1)
  })

  it('records a transaction that landed after all by its own status', async () => {
    lookupSignatureStatus.mockResolvedValue({
      kind: 'found',
      status: { confirmationStatus: 'finalized', err: 'AccountInUse' },
    })

    await expect(
      settle(reporting({ kind: 'not-confirmed', errors: [] }), {
        signedAt: ago(DROPPED_FALLBACK_AGE_MS + 1_000),
      })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      final: true,
    })

    // The status is a signature status, whatever `send` confirms.
    expect(confirmedFailure).not.toHaveBeenCalled()
    expect(txHexWrites()[0].txHash).toBe(SIGNATURE)
  })

  it('keeps the outcome unknown, and the bytes, when the lookup sees it only as processed', async () => {
    lookupSignatureStatus.mockResolvedValue({
      kind: 'found',
      status: { confirmationStatus: 'processed', err: null },
    })

    const thrown = await settle(
      reporting({ kind: 'not-confirmed', errors: [] }),
      { signedAt: ago(DROPPED_FALLBACK_AGE_MS + 1_000) }
    ).catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('clears the bytes and rethrows when the first run fails before its first send', async () => {
    // Nothing left the SDK, so "Try again" signs again.
    const error = new Error('no RPC configured')

    await expect(
      settle(rejecting(error), {
        signedAt: ago(DROPPED_FALLBACK_AGE_MS + 1_000),
      })
    ).rejects.toBe(error)

    expect(updateAction).toHaveBeenCalledTimes(1)
    const [, , , params] = updateAction.mock.calls[0]
    expect('txHex' in params).toBe(true)
    expect(params.txHex).toBeUndefined()
    expect(lookupSignatureStatus).not.toHaveBeenCalled()
  })

  it('keeps the bytes on a resume that fails before its first send', async () => {
    // An earlier run may have sent them. Without a verdict nothing is final
    // while the transaction may still land.
    const error = new Error('no RPC configured')

    await expect(
      settle(rejecting(error), { signedAt: ago(60_000), resuming: true })
    ).rejects.toBe(error)

    expect(updateAction).not.toHaveBeenCalled()
    expect(lookupSignatureStatus).not.toHaveBeenCalled()
  })

  it('drops a resume that fails before its first send only by the dropped rule', async () => {
    lookupSignatureStatus.mockResolvedValue(PROVEN_ABSENT)
    const error = new Error('no RPC configured')
    const signedAt = ago(DROPPED_FALLBACK_AGE_MS + 1_000)

    const thrown = await settle(rejecting(error), {
      signedAt,
      resuming: true,
    }).catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(true)
    expect(thrown.cause).toBe(error)
    expect(lookupSignatureStatus.mock.calls[0][2]).toEqual({
      anchor: signedAt - CLOCK_SKEW_MARGIN_MS,
      expiredAtSlot: undefined,
    })
  })
})
