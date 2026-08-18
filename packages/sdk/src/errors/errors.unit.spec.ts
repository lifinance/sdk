import { describe, expect, it } from 'vitest'
import { LiFiErrorCode } from './constants.js'
import { RPCError } from './errors.js'

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
