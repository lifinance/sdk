import { rpc } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

/** One configured RPC per answer; an `Error` makes that RPC's request fail. */
const nodes = (...answers: (Record<string, unknown> | Error)[]): void => {
  getStellarRpcs.mockResolvedValue(
    answers.map((answer) => ({
      getTransaction: vi.fn(async () => {
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

  // Coverage and head must come from the SAME response (spec 4.2.8). Each node
  // proves one half only; combining the oldest of one with the latest of the
  // other would prove nothing about either node.
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
})
