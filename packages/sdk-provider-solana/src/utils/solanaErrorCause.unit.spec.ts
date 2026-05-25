import { describe, expect, it } from 'vitest'
import {
  SolanaTransactionDetailsError,
  safeStringifyBigInt,
} from './solanaErrorCause.js'

describe('safeStringifyBigInt', () => {
  it('serializes plain objects identically to JSON.stringify', () => {
    expect(safeStringifyBigInt({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}')
  })

  it('converts top-level bigint values to strings', () => {
    expect(safeStringifyBigInt({ amount: 42n })).toBe('{"amount":"42"}')
  })

  it('converts nested bigint values to strings', () => {
    expect(safeStringifyBigInt({ outer: { inner: 9007199254740993n } })).toBe(
      '{"outer":{"inner":"9007199254740993"}}'
    )
  })

  it('handles null', () => {
    expect(safeStringifyBigInt(null)).toBe('null')
  })

  it('handles strings', () => {
    expect(safeStringifyBigInt('hello')).toBe('"hello"')
  })
})

describe('SolanaTransactionDetailsError', () => {
  it('exposes err and logs as own readonly properties', () => {
    const err = { InsufficientFundsForRent: { account_index: 0 } }
    const logs = ['Program log: AnchorError', 'Program failed: 0x1']

    const cause = new SolanaTransactionDetailsError(err, logs)

    expect(cause).toBeInstanceOf(Error)
    expect(cause.name).toBe('SolanaTransactionDetailsError')
    expect(cause.err).toBe(err)
    expect(cause.logs).toBe(logs)
  })

  it('defaults logs to null when omitted', () => {
    const cause = new SolanaTransactionDetailsError({ Custom: 1 })
    expect(cause.logs).toBeNull()
  })

  it('stringifies object err for the message', () => {
    const cause = new SolanaTransactionDetailsError({ Custom: 6_000 })
    expect(cause.message).toBe('{"Custom":6000}')
  })

  it('coerces non-object err to string for the message', () => {
    const cause = new SolanaTransactionDetailsError('BlockhashNotFound')
    expect(cause.message).toBe('BlockhashNotFound')
  })

  it('serializes bigint payloads safely in the message', () => {
    const cause = new SolanaTransactionDetailsError({ amount: 1n })
    expect(cause.message).toBe('{"amount":"1"}')
  })
})
