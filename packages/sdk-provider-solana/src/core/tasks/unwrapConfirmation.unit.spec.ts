import { LiFiErrorCode, RPCError, TransactionError } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import type { RaceResult } from '../../confirmation/raceRpcs.js'
import { unwrapConfirmation } from './unwrapConfirmation.js'

const MESSAGES = {
  rpcUnavailable: 'every RPC failed',
  notConfirmed: 'not confirmed before the SDK stopped waiting',
  allRpcsFailed: 'all failed',
  someRpcsFailed: 'some failed',
}

/**
 * Returns the error `unwrapConfirmation` threw, and fails loudly if it threw
 * nothing. A `try`/`catch` that simply returns whatever it caught passes just
 * as happily when the call returns normally, which is the one outcome these
 * tests exist to rule out.
 */
const capture = (result: RaceResult<{ err: unknown }>): Error => {
  let thrown: Error | undefined
  try {
    unwrapConfirmation(result, MESSAGES)
  } catch (error) {
    thrown = error as Error
  }
  if (!thrown) {
    throw new Error('expected unwrapConfirmation to throw, but it returned')
  }
  return thrown
}

describe('unwrapConfirmation', () => {
  it('returns the confirmed value', () => {
    expect(
      unwrapConfirmation({ kind: 'confirmed', value: { err: null } }, MESSAGES)
    ).toEqual({ err: null })
  })

  it('maps rpc-unavailable to RpcUnavailable, never to an expiry', () => {
    // Collapsing these two is what reported a live RPC-compatibility defect as
    // an expired transaction: no endpoint answered, which says nothing about
    // whether the transaction landed.
    const thrown = capture({
      kind: 'rpc-unavailable',
      errors: [new Error('429')],
    })

    expect(thrown).toBeInstanceOf(RPCError)
    const error = thrown as RPCError
    expect(error.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(error.message).toBe('every RPC failed')
  })

  it('maps not-confirmed to TransactionExpired and chains every branch error', () => {
    const errors = [new Error('this endpoint never answered'), new Error('429')]
    const thrown = capture({ kind: 'not-confirmed', errors })

    expect(thrown).toBeInstanceOf(TransactionError)
    const error = thrown as TransactionError
    expect(error.code).toBe(LiFiErrorCode.TransactionExpired)

    const cause = error.cause as AggregateError
    expect(cause).toBeInstanceOf(AggregateError)
    // Every endpoint's error survives, not just the first.
    expect(cause.errors).toEqual(errors)
  })

  it('chains no cause when no branch left an error', () => {
    const thrown = capture({ kind: 'not-confirmed', errors: [] })

    expect((thrown as TransactionError).cause).toBeUndefined()
  })

  it('reports the stack of a real endpoint failure, not this module', () => {
    // `BaseError` overwrites its own stack with `getRootCause(cause).stack`,
    // and `getRootCause` walks `.cause` alone. An `AggregateError` carrying no
    // `cause` is its own root, so the surfaced stack would point at wherever
    // the SDK happened to build it instead of at the endpoint that failed.
    const endpointError = new Error('429')
    endpointError.stack = 'Error: 429\n    at theEndpointThatActuallyFailed'

    const thrown = capture({
      kind: 'rpc-unavailable',
      errors: [endpointError],
    })

    expect(thrown.stack).toContain('theEndpointThatActuallyFailed')
  })
})
