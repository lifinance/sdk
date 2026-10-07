import { rpc } from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getStellarRpcs = vi.fn()
vi.mock('../../../client/getStellarRpc.js', () => ({
  getStellarRpcs: (...args: unknown[]) => getStellarRpcs(...args),
}))

const { proveStellarTransactionAbsent } = await import(
  './proveStellarTransactionAbsent.js'
)

const HASH = 'ab'.repeat(32)
const WINDOW = { earliest: 1_800_000_000, maxTime: 1_800_000_300 }

/** A NOT_FOUND answer. The defaults cover the window and are past its head. */
const notFound = (overrides: Record<string, unknown> = {}) => ({
  status: rpc.Api.GetTransactionStatus.NOT_FOUND,
  txHash: HASH,
  oldestLedgerCloseTime: WINDOW.earliest - 86_400,
  latestLedgerCloseTime: WINDOW.maxTime + 600,
  ...overrides,
})

/** An RPC that accepts the request and never answers. */
const SILENT = 'silent'

/**
 * One configured RPC per answer; an `Error` makes that RPC's request fail,
 * and `SILENT` makes it hang.
 */
const nodes = (
  ...answers: (Record<string, unknown> | Error | typeof SILENT)[]
): void => {
  getStellarRpcs.mockResolvedValue(
    answers.map((answer) => ({
      getTransaction: vi.fn(async () => {
        if (answer === SILENT) {
          return new Promise(() => {})
        }
        if (answer instanceof Error) {
          throw answer
        }
        return answer
      }),
    }))
  )
}

const prove = (): Promise<boolean> =>
  proveStellarTransactionAbsent({} as never, HASH, WINDOW)

describe('proveStellarTransactionAbsent', () => {
  beforeEach(() => {
    getStellarRpcs.mockReset()
  })

  it('proves absence from a NOT_FOUND that covers the window and is past its head', async () => {
    nodes(notFound())

    await expect(prove()).resolves.toBe(true)
  })

  it('reads the timestamps also in the string form of the RPC JSON', async () => {
    nodes(
      notFound({
        oldestLedgerCloseTime: String(WINDOW.earliest - 86_400),
        latestLedgerCloseTime: String(WINDOW.maxTime + 600),
      })
    )

    await expect(prove()).resolves.toBe(true)
  })

  // A pruned node: its history starts after the earliest landing time.
  it('does not count a node whose oldest ledger closed after the anchor', async () => {
    nodes(notFound({ oldestLedgerCloseTime: WINDOW.earliest + 1 }))

    await expect(prove()).resolves.toBe(false)
  })

  it('does not count a node whose latest ledger is not past maxTime plus the margin', async () => {
    nodes(notFound({ latestLedgerCloseTime: WINDOW.maxTime + 10 }))

    await expect(prove()).resolves.toBe(false)
  })

  // The head margin is 30 s: a latest close time exactly at the margin does
  // not count, one second past it does.
  it.each([
    [30, false],
    [31, true],
  ])(
    'with a latest ledger at maxTime + %i s, resolves %s',
    async (secondsPastMaxTime, expected) => {
      nodes(
        notFound({ latestLedgerCloseTime: WINDOW.maxTime + secondsPastMaxTime })
      )

      await expect(prove()).resolves.toBe(expected)
    }
  )

  // Coverage and head must come from the SAME response. Each node proves one
  // half only; combining the oldest of one with the latest of the other
  // would prove nothing about either node.
  it('does not combine a covering node and a node past the head', async () => {
    nodes(
      notFound({ latestLedgerCloseTime: WINDOW.maxTime + 10 }),
      notFound({ oldestLedgerCloseTime: WINDOW.earliest + 1 })
    )

    await expect(prove()).resolves.toBe(false)
  })

  it('does not count a NOT_FOUND without the coverage fields', async () => {
    nodes(
      notFound({
        oldestLedgerCloseTime: undefined,
        latestLedgerCloseTime: undefined,
      })
    )

    await expect(prove()).resolves.toBe(false)
  })

  // `Number(null)` and `Number('')` are 0, which is before every anchor. An
  // empty field must not read as a history that starts at the epoch.
  it.each([null, ''])(
    'does not count an oldestLedgerCloseTime of %j',
    async (oldestLedgerCloseTime) => {
      nodes(notFound({ oldestLedgerCloseTime }))

      await expect(prove()).resolves.toBe(false)
    }
  )

  it.each([
    rpc.Api.GetTransactionStatus.SUCCESS,
    rpc.Api.GetTransactionStatus.FAILED,
  ])('is false when any node returns the transaction (%s)', async (status) => {
    nodes(notFound(), { status, txHash: HASH })

    await expect(prove()).resolves.toBe(false)
  })

  it('counts a covering node even when another node fails', async () => {
    nodes(new Error('503'), notFound())

    await expect(prove()).resolves.toBe(true)
  })

  it('is false when every node fails or the RPC list cannot be read', async () => {
    nodes(new Error('503'), new Error('timeout'))
    await expect(prove()).resolves.toBe(false)

    getStellarRpcs.mockRejectedValue(new Error('chains unavailable'))
    await expect(prove()).resolves.toBe(false)
  })

  // Each node gets 10 s. A node that never answers gives no information,
  // exactly as a node whose request fails, so it cannot hold the route.
  describe('with a deadline per node', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('settles after 10 s with the verdict it gives for a failing node', async () => {
      nodes(new Error('503'), notFound())
      const withFailingNode = await prove()

      nodes(SILENT, notFound())
      let settled = false
      const proof = prove().finally(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(9_999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
      await expect(proof).resolves.toBe(withFailingNode)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('proves absence from one answering node and leaves no timer', async () => {
      nodes(notFound())

      await expect(prove()).resolves.toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
