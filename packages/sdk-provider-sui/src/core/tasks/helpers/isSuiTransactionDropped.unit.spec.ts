import type { SDKClient } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

// One fake gRPC client per node; like the real helper, try them in order,
// return the first result and throw the last error.
const nodes: unknown[] = []
vi.mock('../../../client/suiClient.js', () => ({
  callSuiWithRetry: async (
    _client: unknown,
    fn: (client: unknown) => Promise<unknown>
  ) => {
    let lastError: unknown
    for (const node of nodes) {
      try {
        return await fn(node)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  },
}))

const { isSuiTransactionDropped } = await import('./isSuiTransactionDropped.js')

const NOW = 1_790_000_000_000
const TIP = 1_000_000n
const INTERVAL_MS = 250
const DIGEST = 'TargetDigest111111111111111111111111111111111'
const client = {} as SDKClient

/** Checkpoint `n` is `TIP - n` intervals before now and holds one transaction `tx-<n>`. */
const timeOf = (sequenceNumber: bigint) =>
  NOW - Number(TIP - sequenceNumber) * INTERVAL_MS

interface NodeOptions {
  /** Lowest checkpoint the node still has. */
  lowest?: bigint
  /** Highest checkpoint the node has (its head). */
  head?: bigint
  /** The node has executed the target digest. */
  hasTarget?: boolean
  /** The per-digest error code for the target when the node does not have it. */
  targetErrorCode?: number
  /** The request indices in the order the response lists them. */
  resultOrder?: number[]
  /** The batch lookup fails as a whole. */
  failing?: boolean
}

const makeNode = ({
  lowest = 0n,
  head = TIP,
  hasTarget = false,
  targetErrorCode = 5,
  resultOrder = [0, 1, 2],
  failing = false,
}: NodeOptions = {}) => {
  const has = (digest: string) => {
    if (digest === DIGEST) {
      return hasTarget
    }
    const sequenceNumber = BigInt(digest.slice('tx-'.length))
    return sequenceNumber >= lowest && sequenceNumber <= head
  }
  return {
    ledgerService: {
      getCheckpoint: vi.fn(
        async ({
          checkpointId,
        }: {
          checkpointId: { oneofKind?: string; sequenceNumber?: bigint }
        }) => {
          const sequenceNumber = checkpointId.sequenceNumber ?? head
          const timestampMs = timeOf(sequenceNumber)
          return {
            response: {
              checkpoint: {
                sequenceNumber,
                summary: {
                  timestamp: {
                    seconds: BigInt(Math.floor(timestampMs / 1000)),
                    nanos: (timestampMs % 1000) * 1_000_000,
                  },
                },
                transactions: [{ digest: `tx-${sequenceNumber}` }],
              },
            },
          }
        }
      ),
      batchGetTransactions: vi.fn(
        async ({ digests }: { digests: string[] }) => {
          if (failing) {
            throw new Error('upstream connect error')
          }
          const results = digests.map((digest) =>
            has(digest)
              ? {
                  result: {
                    oneofKind: 'transaction',
                    transaction: { digest },
                  },
                }
              : {
                  result: {
                    oneofKind: 'error',
                    error: {
                      code: digest === DIGEST ? targetErrorCode : 5,
                      message: 'not found',
                      details: [],
                    },
                  },
                }
          )
          return {
            response: {
              transactions: resultOrder.map((index) => results[index]),
            },
          }
        }
      ),
    },
  }
}

const useNodes = (...list: ReturnType<typeof makeNode>[]) => {
  nodes.splice(0, nodes.length, ...list)
  return list
}

const stepSignedAt = (signedAt?: number) =>
  ({ execution: { signedAt } }) as never

// Signed 30 min ago: past the age cap, and the latest landing time
// (signing + 2 min cap + 10 min skew + 5 min margin) is 13 min ago.
const SIGNED_AT = NOW - 30 * 60_000

describe('isSuiTransactionDropped', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a digest that a covering response does not find and the status API does not know', async () => {
    const [node] = useNodes(makeNode())

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)

    // One request carries the target and both canaries: a checkpoint before
    // signing - skew (40 min back at 200 ms per checkpoint = 12,000) and one
    // 120 checkpoints behind the tip.
    expect(node.ledgerService.batchGetTransactions).toHaveBeenCalledWith({
      digests: [DIGEST, 'tx-988000', 'tx-999880'],
      readMask: { paths: ['digest'] },
    })
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      client,
      expect.anything(),
      DIGEST
    )
  })

  it('stays unknown when the covering proof is missing (the node pruned the early canary)', async () => {
    useNodes(makeNode({ lowest: 995_000n }))

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  // Only NOT_FOUND (code 5) is an answer; for example INTERNAL (13) or
  // UNAVAILABLE (14) says nothing about the digest.
  it.each([13, 14])(
    'stays unknown when a covering response answers the target with code %i',
    async (code) => {
      useNodes(makeNode({ targetErrorCode: code }))

      await expect(
        isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
      ).resolves.toBe(false)
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
    }
  )

  // The node has the target but pruned the early canary. If it listed the
  // results out of request order, the canary's NOT_FOUND would take the
  // target's position.
  it('stays unknown when a response does not keep the request order', async () => {
    useNodes(
      makeNode({ hasTarget: true, lowest: 995_000n, resultOrder: [1, 0, 2] })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  // The first node supplies the canaries (its own batch lookup fails); the
  // second answers "not found" but its head is behind the head canary.
  it('stays unknown when the answering node lags behind the head canary', async () => {
    useNodes(makeNode({ failing: true }), makeNode({ head: TIP - 1_000n }))

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
  })

  it('stays unknown while the chain is not past the latest landing time + margin', async () => {
    // Past the 2 min cap, but signing + 2 min + 10 min + 5 min is still ahead.
    const [node] = useNodes(makeNode())

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(NOW - 5 * 60_000), DIGEST)
    ).resolves.toBe(false)
    expect(node.ledgerService.batchGetTransactions).not.toHaveBeenCalled()
  })

  it('is never dropped while the status API knows the digest', async () => {
    isKnownToStatusApi.mockResolvedValue(true)
    useNodes(makeNode())

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
  })

  it('is not dropped when any node returns the digest', async () => {
    useNodes(makeNode(), makeNode({ hasTarget: true }))

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('counts a covering node although another node lags or fails', async () => {
    useNodes(
      makeNode({ failing: true }),
      makeNode({ head: TIP - 1_000n }),
      makeNode()
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)
    expect(isKnownToStatusApi).toHaveBeenCalled()
  })

  it('stays unknown when every batch lookup fails', async () => {
    useNodes(makeNode({ failing: true }))

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
  })

  it('never looks up within the age cap or without a signing time', async () => {
    const [node] = useNodes(makeNode())

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(NOW - 119_999), DIGEST)
    ).resolves.toBe(false)
    await expect(
      isSuiTransactionDropped(client, stepSignedAt(), DIGEST)
    ).resolves.toBe(false)
    expect(node.ledgerService.getCheckpoint).not.toHaveBeenCalled()
  })
})
