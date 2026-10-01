import { TransactionNotFoundError } from '@bigmi/core'
import { describe, expect, it, vi } from 'vitest'
import type { PublicClient } from '../../client/publicClient.js'
import {
  allTransportsFailed,
  DECODE_FAILED,
  httpError,
  NO_SUCH_TRANSACTION,
  rpcError,
  timeoutError,
} from './bitcoinRpcErrors.unit.mock.js'
import {
  ALREADY_SENT_MESSAGES,
  classifyBitcoinSendFailure,
  EVERY_NODE_REJECT_REASONS,
  isBitcoinTransactionAbsent,
  lookUpBitcoinTransaction,
  MEMPOOL_STATE_REJECT_REASONS,
} from './classifyBitcoinSendFailure.js'

const SEND = 'sendrawtransaction'
const LOOKUP = 'getrawtransaction'
const TX_ID = 'ab'.repeat(32)

/** A -26 refusal from one URL, inside the error the fallback transport throws. */
const rejected = (message: string): Error =>
  allTransportsFailed(SEND, [rpcError(SEND, { code: -26, message })])

describe('classifyBitcoinSendFailure', () => {
  it('counts the probed decode failure (-22) as refused by every node', () => {
    expect(
      classifyBitcoinSendFailure(
        allTransportsFailed(SEND, [rpcError(SEND, DECODE_FAILED)])
      )
    ).toBe('refused')
  })

  it('counts missing or spent inputs (-25) as refused by every node', () => {
    expect(
      classifyBitcoinSendFailure(
        allTransportsFailed(SEND, [
          rpcError(SEND, {
            code: -25,
            message: 'bad-txns-inputs-missingorspent',
          }),
        ])
      )
    ).toBe('refused')
  })

  it.each(EVERY_NODE_REJECT_REASONS)(
    'counts the -26 reason "%s" as refused by every node',
    (reason) => {
      expect(classifyBitcoinSendFailure(rejected(`${reason}, detail`))).toBe(
        'refused'
      )
    }
  )

  it.each(MEMPOOL_STATE_REJECT_REASONS)(
    'keeps the -26 reason "%s" of one node unknown',
    (reason) => {
      expect(classifyBitcoinSendFailure(rejected(`${reason}, detail`))).toBe(
        'unknown'
      )
    }
  )

  it('keeps a -26 reason that is in neither list unknown', () => {
    expect(
      classifyBitcoinSendFailure(
        rejected('txn-same-nonwitness-data-in-mempool')
      )
    ).toBe('unknown')
  })

  it('lets the mempool list win when a -26 message matches both lists', () => {
    expect(classifyBitcoinSendFailure(rejected('mempool full, tx-size'))).toBe(
      'unknown'
    )
  })

  // bigmi's own `message` always ends with "Version: bigmi@…". Only the
  // node's text may be matched, or the "version" reason would refuse
  // every -26 that is in neither list.
  it('reads the node text, not the bigmi message', () => {
    const error = rpcError(SEND, {
      code: -26,
      message: 'txn-same-nonwitness-data-in-mempool',
    })

    expect(error.message).toContain('Version: bigmi@')
    expect(classifyBitcoinSendFailure(error)).toBe('unknown')
  })

  it('counts -27 as sent', () => {
    expect(
      classifyBitcoinSendFailure(
        allTransportsFailed(SEND, [
          rpcError(SEND, {
            code: -27,
            message: 'Transaction outputs already in utxo set',
          }),
        ])
      )
    ).toBe('sent')
  })

  it.each(ALREADY_SENT_MESSAGES)(
    'counts a message with "%s" as sent',
    (message) => {
      expect(classifyBitcoinSendFailure(rejected(message))).toBe('sent')
    }
  )

  it('classifies a bare RpcRequestError like the wrapped one', () => {
    expect(classifyBitcoinSendFailure(rpcError(SEND, DECODE_FAILED))).toBe(
      'refused'
    )
  })

  it('reads the code and message from the JSON details of an HttpRequestError', () => {
    const http = httpError(SEND, JSON.stringify(DECODE_FAILED))

    expect(classifyBitcoinSendFailure(http)).toBe('refused')
    expect(classifyBitcoinSendFailure(allTransportsFailed(SEND, [http]))).toBe(
      'refused'
    )
    expect(
      classifyBitcoinSendFailure(
        httpError(SEND, JSON.stringify({ code: -26, message: 'mempool full' }))
      )
    ).toBe('unknown')
  })

  it('keeps a timeout unknown', () => {
    expect(
      classifyBitcoinSendFailure(
        allTransportsFailed(SEND, [timeoutError(SEND)])
      )
    ).toBe('unknown')
  })

  it('counts a refusal as refused only when every URL refused', () => {
    expect(
      classifyBitcoinSendFailure(
        allTransportsFailed(SEND, [
          rpcError(SEND, DECODE_FAILED),
          rpcError(SEND, DECODE_FAILED),
        ])
      )
    ).toBe('refused')
    // The URL that timed out may have accepted the bytes.
    expect(
      classifyBitcoinSendFailure(
        allTransportsFailed(SEND, [
          timeoutError(SEND),
          rpcError(SEND, DECODE_FAILED),
        ])
      )
    ).toBe('unknown')
  })

  it('counts the bytes as sent when any URL says so', () => {
    expect(
      classifyBitcoinSendFailure(
        allTransportsFailed(SEND, [
          rpcError(SEND, { code: -27, message: 'already in block chain' }),
          timeoutError(SEND),
        ])
      )
    ).toBe('sent')
  })

  it('keeps an empty error list unknown', () => {
    expect(classifyBitcoinSendFailure(allTransportsFailed(SEND, []))).toBe(
      'unknown'
    )
  })

  const cyclic: { message: string; cause?: unknown } = { message: 'loop' }
  cyclic.cause = cyclic

  it.each([
    ['a string', 'boom'],
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object without code or details', {}],
    ['details "null"', httpError(SEND, 'null')],
    ['details that is a JSON string', httpError(SEND, '"text"')],
    ['details that is a JSON array', httpError(SEND, '[]')],
    ['details that is an empty JSON object', httpError(SEND, '{}')],
    ['details that is not JSON', httpError(SEND, 'Internal Server Error')],
    ['a cause chain with a cycle', cyclic],
  ])('keeps %s unknown and never throws', (_label, error) => {
    expect(classifyBitcoinSendFailure(error)).toBe('unknown')
  })
})

describe('isBitcoinTransactionAbsent', () => {
  it('is true when every URL answers the probed -5', () => {
    expect(
      isBitcoinTransactionAbsent(
        allTransportsFailed(LOOKUP, [
          rpcError(LOOKUP, NO_SUCH_TRANSACTION),
          rpcError(LOOKUP, NO_SUCH_TRANSACTION),
        ])
      )
    ).toBe(true)
    expect(
      isBitcoinTransactionAbsent(
        httpError(LOOKUP, JSON.stringify(NO_SUCH_TRANSACTION))
      )
    ).toBe(true)
  })

  it('is false when one URL did not answer -5', () => {
    expect(
      isBitcoinTransactionAbsent(
        allTransportsFailed(LOOKUP, [
          rpcError(LOOKUP, NO_SUCH_TRANSACTION),
          timeoutError(LOOKUP),
        ])
      )
    ).toBe(false)
  })

  // bigmi's getUTXOTransaction maps every error, a timeout included, to
  // TransactionNotFoundError, so it proves nothing.
  it('is false for TransactionNotFoundError', () => {
    expect(
      isBitcoinTransactionAbsent(
        new TransactionNotFoundError({ hash: `0x${TX_ID}` })
      )
    ).toBe(false)
  })

  it.each([
    ['an empty error list', allTransportsFailed(LOOKUP, [])],
    ['a string', 'No such mempool or blockchain transaction'],
    ['undefined', undefined],
    ['an object without code or details', {}],
    ['details that is not JSON', httpError(LOOKUP, 'Bad Gateway', 502)],
  ])('is false for %s', (_label, error) => {
    expect(isBitcoinTransactionAbsent(error)).toBe(false)
  })
})

describe('lookUpBitcoinTransaction', () => {
  const clientWith = (request: ReturnType<typeof vi.fn>): PublicClient =>
    ({ request }) as unknown as PublicClient

  it('asks getrawtransaction for the txid, verbose, and finds an object', async () => {
    const request = vi.fn().mockResolvedValue({ txid: TX_ID })

    await expect(
      lookUpBitcoinTransaction(clientWith(request), TX_ID)
    ).resolves.toBe('found')
    expect(request).toHaveBeenCalledWith({
      method: 'getrawtransaction',
      params: [TX_ID, true],
    })
  })

  it('does not count a null result as found', async () => {
    const request = vi.fn().mockResolvedValue(null)

    await expect(
      lookUpBitcoinTransaction(clientWith(request), TX_ID)
    ).resolves.toBe('unknown')
  })

  it('reports absent only for -5 from every URL', async () => {
    const absent = vi
      .fn()
      .mockRejectedValue(
        allTransportsFailed(LOOKUP, [rpcError(LOOKUP, NO_SUCH_TRANSACTION)])
      )
    const timedOut = vi
      .fn()
      .mockRejectedValue(allTransportsFailed(LOOKUP, [timeoutError(LOOKUP)]))

    await expect(
      lookUpBitcoinTransaction(clientWith(absent), TX_ID)
    ).resolves.toBe('absent')
    await expect(
      lookUpBitcoinTransaction(clientWith(timedOut), TX_ID)
    ).resolves.toBe('unknown')
  })
})
