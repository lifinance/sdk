import { LiFiErrorCode, SDKError, TransactionError } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { parseStellarErrors } from './parseStellarErrors.js'

const codeOf = async (message: string): Promise<number> => {
  const parsed = await parseStellarErrors(new Error(message))
  return (parsed.cause as TransactionError).code
}

describe('parseStellarErrors', () => {
  it('maps wallet rejections to SignatureRejected', async () => {
    await expect(codeOf('User rejected the request')).resolves.toBe(
      LiFiErrorCode.SignatureRejected
    )
    await expect(codeOf('Request was denied by the user')).resolves.toBe(
      LiFiErrorCode.SignatureRejected
    )
  })

  it('maps tx_too_late to TransactionExpired', async () => {
    await expect(codeOf('transaction failed: tx_too_late')).resolves.toBe(
      LiFiErrorCode.TransactionExpired
    )
    await expect(codeOf('txTooLate')).resolves.toBe(
      LiFiErrorCode.TransactionExpired
    )
  })

  it('maps tx_bad_seq to TransactionConflict', async () => {
    await expect(codeOf('transaction failed: tx_bad_seq')).resolves.toBe(
      LiFiErrorCode.TransactionConflict
    )
    await expect(codeOf('txBadSeq')).resolves.toBe(
      LiFiErrorCode.TransactionConflict
    )
  })

  it('maps insufficient balance and fee distinctly', async () => {
    await expect(codeOf('tx_insufficient_balance')).resolves.toBe(
      LiFiErrorCode.InsufficientFunds
    )
    await expect(codeOf('tx_insufficient_fee')).resolves.toBe(
      LiFiErrorCode.TransactionUnderpriced
    )
  })

  it('maps simulation failures to TransactionSimulationFailed', async () => {
    await expect(codeOf('HostError: Error(Contract, #402)')).resolves.toBe(
      LiFiErrorCode.TransactionSimulationFailed
    )
    await expect(codeOf('transaction simulation failed')).resolves.toBe(
      LiFiErrorCode.TransactionSimulationFailed
    )
  })

  it('passes an existing SDKError through and backfills step/action', async () => {
    const inner = new TransactionError(LiFiErrorCode.TransactionFailed, 'boom')
    const sdkError = new SDKError(inner)
    const step = { id: 'step-1' } as never
    const action = { type: 'SWAP' } as never

    const parsed = await parseStellarErrors(sdkError, step, action)

    expect(parsed).toBe(sdkError)
    expect(parsed.step).toBe(step)
    expect(parsed.action).toBe(action)
  })

  it('does not re-wrap a TransactionError thrown by our own tasks', async () => {
    const inner = new TransactionError(
      LiFiErrorCode.Timeout,
      'not confirmed in time'
    )

    const parsed = await parseStellarErrors(inner)

    expect(parsed.cause).toBe(inner)
  })

  it('falls back to UnknownError for unrecognised messages', async () => {
    const parsed = await parseStellarErrors(new Error('something odd'))

    expect(parsed.cause.name).toBe('UnknownError')
    expect(parsed.cause.message).toBe('something odd')
  })

  // The provider classifies its own failures on purpose. Message matching must
  // not re-code them — an allowance the SDK could not READ is not an allowance
  // the user must GRANT.
  it('keeps a code the provider set, even when the message matches a pattern', async () => {
    const classified = new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      'Could not read the CDEF spending allowance for CABC'
    )

    const parsed = await parseStellarErrors(classified)

    expect((parsed.cause as TransactionError).code).toBe(
      LiFiErrorCode.TransactionSimulationFailed
    )
  })

  // callStellarRpcsWithRetry collapses every RPC rejection into an
  // AggregateError. Classifying its message alone would surface UnknownError.
  it('classifies from inside an AggregateError', async () => {
    const aggregate = new AggregateError(
      [new Error('User rejected the request')],
      'All 2 Stellar RPCs failed'
    )

    const parsed = await parseStellarErrors(aggregate)

    expect((parsed.cause as TransactionError).code).toBe(
      LiFiErrorCode.SignatureRejected
    )
  })

  it('prefers an already classified error inside an AggregateError', async () => {
    const classified = new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      'simulation failed'
    )
    const aggregate = new AggregateError(
      [new Error('connect ETIMEDOUT'), classified],
      'All 2 Stellar RPCs failed'
    )

    const parsed = await parseStellarErrors(aggregate)

    expect(parsed.cause).toBe(classified)
  })
})
