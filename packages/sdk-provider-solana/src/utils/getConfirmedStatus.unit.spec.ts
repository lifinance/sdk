import { describe, expect, it } from 'vitest'
import {
  getConfirmedStatus,
  isConfirmedCommitment,
  type SignatureStatus,
} from './getConfirmedStatus.js'

describe('isConfirmedCommitment', () => {
  it('returns true for confirmed', () => {
    expect(isConfirmedCommitment('confirmed')).toBe(true)
  })

  it('returns true for finalized', () => {
    expect(isConfirmedCommitment('finalized')).toBe(true)
  })

  it('returns false for processed', () => {
    expect(isConfirmedCommitment('processed')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isConfirmedCommitment(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isConfirmedCommitment(undefined)).toBe(false)
  })
})

const makeStatus = (confirmationStatus: string | null): SignatureStatus => ({
  slot: 100n,
  confirmations: 10n,
  err: null,
  confirmationStatus:
    confirmationStatus as SignatureStatus['confirmationStatus'],
  status: { Ok: null },
})

describe('getConfirmedStatus', () => {
  it('returns status for confirmed transaction', () => {
    const status = makeStatus('confirmed')
    const result = getConfirmedStatus({ value: [status] })
    expect(result).toBe(status)
  })

  it('returns status for finalized transaction', () => {
    const status = makeStatus('finalized')
    const result = getConfirmedStatus({ value: [status] })
    expect(result).toBe(status)
  })

  it('returns null for processed transaction', () => {
    const result = getConfirmedStatus({ value: [makeStatus('processed')] })
    expect(result).toBeNull()
  })

  it('returns null when status is null', () => {
    const result = getConfirmedStatus({ value: [null] })
    expect(result).toBeNull()
  })

  it('returns null for empty value array', () => {
    const result = getConfirmedStatus({ value: [] })
    expect(result).toBeNull()
  })
})
