import { describe, expect, it } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError, UnknownError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { ExecutionAction, LiFiStepExtended } from '../types/core.js'
import {
  assertNoOpenTransaction,
  CLEARED_TRANSACTION_FIELDS,
  CLOCK_SKEW_MARGIN_MS,
  DROPPED_FALLBACK_AGE_MS,
  hasOpenTransaction,
  hasStepOpenTransaction,
  isFinalTransactionError,
  isOldEnoughToDrop,
  isResendAllowed,
  MAX_RESEND_AGE_MS,
} from './transactionState.js'

const action = (overrides: Partial<ExecutionAction>): ExecutionAction => ({
  type: 'SWAP',
  status: 'PENDING',
  ...overrides,
})

describe('hasOpenTransaction', () => {
  it('is false without an action or without transaction data', () => {
    expect(hasOpenTransaction(undefined)).toBe(false)
    expect(hasOpenTransaction(action({}))).toBe(false)
  })

  it.each([
    ['txHash', { txHash: '0xhash' }],
    ['taskId', { taskId: 'task-1' }],
    ['txHex', { txHex: 'AQID' }],
  ])('is true for a pending action with %s', (_, data) => {
    expect(hasOpenTransaction(action(data))).toBe(true)
  })

  it('is true for a FAILED action without txFinal (unknown outcome)', () => {
    expect(
      hasOpenTransaction(action({ status: 'FAILED', txHash: '0xhash' }))
    ).toBe(true)
  })

  it('is false for a FAILED action with txFinal (final outcome)', () => {
    expect(
      hasOpenTransaction(
        action({ status: 'FAILED', txHash: '0xhash', txFinal: true })
      )
    ).toBe(false)
  })

  it('ignores txFinal on an action that is not FAILED', () => {
    expect(
      hasOpenTransaction(action({ txHash: '0xhash', txFinal: true }))
    ).toBe(true)
  })
})

describe('hasStepOpenTransaction', () => {
  const step = (actions: ExecutionAction[]): LiFiStepExtended =>
    ({
      execution: { startedAt: 0, status: 'PENDING', actions },
    }) as unknown as LiFiStepExtended

  it('only looks at SWAP and CROSS_CHAIN actions', () => {
    expect(
      hasStepOpenTransaction(
        step([action({ type: 'SET_ALLOWANCE', txHash: '0xapprove' })])
      )
    ).toBe(false)
    expect(
      hasStepOpenTransaction(
        step([action({ type: 'CROSS_CHAIN', txHex: 'AQID' })])
      )
    ).toBe(true)
  })

  it('is false for a step without execution', () => {
    expect(hasStepOpenTransaction({} as LiFiStepExtended)).toBe(false)
  })

  it('is false for a damaged stored step with execution but no actions', () => {
    const damaged = {
      execution: { startedAt: 0, status: 'PENDING' },
    } as unknown as LiFiStepExtended

    expect(hasStepOpenTransaction(damaged)).toBe(false)
  })
})

describe('isFinalTransactionError', () => {
  const final = new TransactionError(
    LiFiErrorCode.TransactionFailed,
    'Transaction was reverted.',
    undefined,
    { final: true }
  )

  it('reads the marker on the error itself', () => {
    expect(isFinalTransactionError(final)).toBe(true)
  })

  it('reads the marker through the cause chain', () => {
    const wrapped = new SDKError(
      new UnknownError('rebuilt by a parser', final as unknown as Error)
    )
    expect(isFinalTransactionError(wrapped)).toBe(true)
  })

  it('is false for errors without the marker', () => {
    expect(
      isFinalTransactionError(
        new TransactionError(LiFiErrorCode.TransactionFailed, 'timeout')
      )
    ).toBe(false)
    expect(isFinalTransactionError(new Error('plain'))).toBe(false)
    expect(isFinalTransactionError(undefined)).toBe(false)
  })

  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b') as Error & { cause?: unknown }
    a.cause = b
    b.cause = a
    expect(isFinalTransactionError(a)).toBe(false)
  })
})

describe('assertNoOpenTransaction', () => {
  it('passes for an action without an open transaction', () => {
    expect(() => assertNoOpenTransaction(action({}))).not.toThrow()
    expect(() =>
      assertNoOpenTransaction(
        action({ status: 'FAILED', txHash: '0xhash', txFinal: true })
      )
    ).not.toThrow()
  })

  it('throws TransactionConflict for an open transaction', () => {
    expect(() => assertNoOpenTransaction(action({ txHex: 'AQID' }))).toThrow(
      expect.objectContaining({ code: LiFiErrorCode.TransactionConflict })
    )
  })
})

describe('age helpers', () => {
  const now = 1_000_000_000

  it('allows a resend only below MAX_RESEND_AGE_MS and never without signedAt', () => {
    expect(isResendAllowed(now - MAX_RESEND_AGE_MS + 1, now)).toBe(true)
    expect(isResendAllowed(now - MAX_RESEND_AGE_MS, now)).toBe(false)
    expect(isResendAllowed(undefined, now)).toBe(false)
  })

  it('allows a drop only above DROPPED_FALLBACK_AGE_MS and never without signedAt', () => {
    expect(isOldEnoughToDrop(now - DROPPED_FALLBACK_AGE_MS - 1, now)).toBe(true)
    expect(isOldEnoughToDrop(now - DROPPED_FALLBACK_AGE_MS, now)).toBe(false)
    expect(isOldEnoughToDrop(undefined, now)).toBe(false)
  })
})

describe('CLOCK_SKEW_MARGIN_MS', () => {
  it('is ten minutes', () => {
    expect(CLOCK_SKEW_MARGIN_MS).toBe(600_000)
  })
})

describe('CLEARED_TRANSACTION_FIELDS', () => {
  it('clears every field of a previous transaction', () => {
    expect(CLEARED_TRANSACTION_FIELDS).toEqual({
      txHash: undefined,
      txLink: undefined,
      txHex: undefined,
      txFinal: undefined,
      taskId: undefined,
    })
    expect(Object.keys(CLEARED_TRANSACTION_FIELDS).sort()).toEqual([
      'taskId',
      'txFinal',
      'txHash',
      'txHex',
      'txLink',
    ])
  })
})
