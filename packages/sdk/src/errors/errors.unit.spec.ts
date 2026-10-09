import { describe, expect, it } from 'vitest'
import { LiFiErrorCode } from './constants.js'
import { RPCError, TransactionError } from './errors.js'

describe('RPCError', () => {
  it('carries the RpcUnavailable code, the RPCError name and the cause', () => {
    const cause = new AggregateError([new Error('boom')], 'all failed')
    const error = new RPCError(
      LiFiErrorCode.RpcUnavailable,
      'no RPC returned a usable response',
      cause
    )

    expect(LiFiErrorCode.RpcUnavailable).toBe(1027)
    expect(error.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(error.name).toBe('RPCError')
    expect(error.message).toBe('no RPC returned a usable response')
    expect(error.cause).toBe(cause)
  })
})

describe('CallBundleNotFound', () => {
  it('is code 1028', () => {
    expect(LiFiErrorCode.CallBundleNotFound).toBe(1028)
  })
})

describe('TransactionError final option', () => {
  it('defaults final to false', () => {
    expect(
      new TransactionError(LiFiErrorCode.TransactionFailed, 'x').final
    ).toBe(false)
  })

  it('keeps code and message when final is set', () => {
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction was reverted.',
      undefined,
      { final: true }
    )
    expect(error.final).toBe(true)
    expect(error.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(error.message).toBe('Transaction was reverted.')
  })
})
