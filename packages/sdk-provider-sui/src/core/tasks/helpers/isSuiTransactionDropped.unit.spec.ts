import type { SDKClient } from '@lifi/sdk'
import { GrpcTypes } from '@mysten/sui/grpc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUI_LOOKUP_TIMEOUT_MS } from '../../constants.js'

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

/** Checkpoint `n` is `TIP - n` intervals before now. */
const timeOf = (sequenceNumber: bigint, intervalMs: number) =>
  NOW - Number(TIP - sequenceNumber) * intervalMs

const {
  CONSENSUS_COMMIT_PROLOGUE_V4: PROLOGUE,
  PROGRAMMABLE_SYSTEM_TRANSACTION: PROGRAMMABLE_SYSTEM,
  PROGRAMMABLE_TRANSACTION: PROGRAMMABLE,
  RANDOMNESS_STATE_UPDATE: RANDOMNESS,
} = GrpcTypes.TransactionKind_Kind

/** The gRPC call options a fake node records (`RpcOptions`). */
interface RpcOptions {
  abort?: AbortSignal
  timeout?: number | Date
}

/** A checkpoint transaction: its digest and its kind (none: no kind). */
type FakeTransaction = [digest: string, kind?: GrpcTypes.TransactionKind_Kind]

/**
 * Checkpoint `n` holds the consensus commit prologue, then user
 * transactions. The last user transaction is `tx-<n>`.
 */
const checkpointTransactions = (sequenceNumber: bigint): FakeTransaction[] => [
  [`prologue-${sequenceNumber}`, PROLOGUE],
  [`user-${sequenceNumber}`, PROGRAMMABLE],
  [`tx-${sequenceNumber}`, PROGRAMMABLE],
]

/** A checkpoint that holds only the consensus commit prologue. */
const prologueOnly = (sequenceNumber: bigint): FakeTransaction[] => [
  [`prologue-${sequenceNumber}`, PROLOGUE],
]

interface NodeOptions {
  /** Lowest checkpoint the node still has. */
  lowest?: bigint
  /** Highest checkpoint the node has (its head). */
  head?: bigint
  /** Milliseconds between two checkpoints. */
  intervalMs?: number
  /** The transactions of a checkpoint, in checkpoint order. */
  transactionsOf?: (sequenceNumber: bigint) => FakeTransaction[]
  /** Checkpoint timestamps (ms) that break the regular spacing. */
  timestamps?: Map<bigint, number>
  /** The node has executed the target digest. */
  hasTarget?: boolean
  /** The per-digest error code for the target when the node does not have it. */
  targetErrorCode?: number
  /** The target's result has no oneof case. */
  targetUnset?: boolean
  /** The request indices in the order the response lists them. */
  resultOrder?: number[]
  /** The batch lookup fails as a whole. */
  failing?: boolean
}

const makeNode = ({
  lowest = 0n,
  head = TIP,
  intervalMs = INTERVAL_MS,
  transactionsOf = checkpointTransactions,
  timestamps = new Map(),
  hasTarget = false,
  targetErrorCode = 5,
  targetUnset = false,
  resultOrder = [0, 1, 2],
  failing = false,
}: NodeOptions = {}) => {
  const has = (digest: string) => {
    if (digest === DIGEST) {
      return hasTarget
    }
    const sequenceNumber = BigInt(digest.slice(digest.lastIndexOf('-') + 1))
    return sequenceNumber >= lowest && sequenceNumber <= head
  }
  const answer = (digest: string) => {
    if (digest === DIGEST && targetUnset) {
      return { result: { oneofKind: undefined } }
    }
    return has(digest)
      ? { result: { oneofKind: 'transaction', transaction: { digest } } }
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
  }
  return {
    ledgerService: {
      getCheckpoint: vi.fn(
        async (
          {
            checkpointId,
          }: {
            checkpointId: { oneofKind?: string; sequenceNumber?: bigint }
            readMask?: { paths: string[] }
          },
          _options?: RpcOptions
        ): Promise<unknown> => {
          const sequenceNumber = checkpointId.sequenceNumber ?? head
          const timestampMs =
            timestamps.get(sequenceNumber) ?? timeOf(sequenceNumber, intervalMs)
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
                transactions: transactionsOf(sequenceNumber).map(
                  ([digest, kind]) =>
                    kind === undefined
                      ? { digest }
                      : { digest, transaction: { kind: { kind } } }
                ),
              },
            },
          }
        }
      ),
      batchGetTransactions: vi.fn(
        async (
          { digests }: { digests: string[] },
          _options?: RpcOptions
        ): Promise<unknown> => {
          if (failing) {
            throw new Error('upstream connect error')
          }
          const results = digests.map(answer)
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

type FakeNode = ReturnType<typeof makeNode>

const useNodes = (...list: FakeNode[]) => {
  nodes.splice(0, nodes.length, ...list)
  return list
}

/** The node got one batch request with the target and these canaries. */
const expectCanaries = (node: FakeNode, before: string, after: string) =>
  expect(node.ledgerService.batchGetTransactions).toHaveBeenCalledWith(
    {
      digests: [DIGEST, before, after],
      readMask: { paths: ['digest'] },
    },
    { abort: expect.any(AbortSignal) }
  )

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
    // 120 checkpoints behind the tip. Each canary is the last user
    // transaction of its checkpoint.
    expectCanaries(node, 'tx-988000', 'tx-999880')
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      client,
      expect.anything(),
      DIGEST
    )
    // Every checkpoint request asks for the transaction kinds.
    for (const [request] of node.ledgerService.getCheckpoint.mock.calls) {
      expect(request.readMask).toEqual({
        paths: [
          'sequence_number',
          'summary.timestamp',
          'transactions.digest',
          'transactions.transaction.kind',
        ],
      })
    }
  })

  it('takes the only user transaction of a checkpoint as its canary', async () => {
    const [node] = useNodes(
      makeNode({
        transactionsOf: (n) => [
          [`prologue-${n}`, PROLOGUE],
          [`tx-${n}`, PROGRAMMABLE],
        ],
      })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)
    expectCanaries(node, 'tx-988000', 'tx-999880')
  })

  // Testnet checkpoint 389,597,491 ends with a PROGRAMMABLE_SYSTEM_TRANSACTION.
  it.each([
    ['RANDOMNESS_STATE_UPDATE', RANDOMNESS],
    ['PROGRAMMABLE_SYSTEM_TRANSACTION', PROGRAMMABLE_SYSTEM],
  ])(
    'takes the earlier user transaction when a %s is last',
    async (_, kind) => {
      const [node] = useNodes(
        makeNode({
          transactionsOf: (n) => [
            ...checkpointTransactions(n),
            [`system-${n}`, kind],
          ],
        })
      )

      await expect(
        isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
      ).resolves.toBe(true)
      expectCanaries(node, 'tx-988000', 'tx-999880')
    }
  )

  it('skips a checkpoint with only system transactions', async () => {
    const [node] = useNodes(
      makeNode({
        transactionsOf: (n) =>
          n === 988_000n || n === 999_880n
            ? [
                [`prologue-${n}`, PROLOGUE],
                [`randomness-${n}`, RANDOMNESS],
                [`system-${n}`, PROGRAMMABLE_SYSTEM],
              ]
            : checkpointTransactions(n),
      })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)
    expectCanaries(node, 'tx-987999', 'tx-999881')
  })

  it('skips a transaction without a kind', async () => {
    const [node] = useNodes(
      makeNode({
        transactionsOf: (n) =>
          n === 988_000n || n === 999_880n
            ? [[`prologue-${n}`, PROLOGUE], [`tx-${n}`]]
            : checkpointTransactions(n),
      })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)
    expectCanaries(node, 'tx-987999', 'tx-999881')
  })

  it('steps back over prologue-only checkpoints for the before canary', async () => {
    const [node] = useNodes(
      makeNode({
        transactionsOf: (n) =>
          n === 988_000n || n === 987_999n
            ? prologueOnly(n)
            : checkpointTransactions(n),
      })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)
    expectCanaries(node, 'tx-987998', 'tx-999880')
  })

  it('steps toward the tip over prologue-only checkpoints for the after canary', async () => {
    const [node] = useNodes(
      makeNode({
        transactionsOf: (n) =>
          n === 999_880n ? prologueOnly(n) : checkpointTransactions(n),
      })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)
    expectCanaries(node, 'tx-988000', 'tx-999881')
  })

  it('stays unknown after 10 skipped prologue-only checkpoints', async () => {
    // Checkpoints 987,990 to 988,000: the search skips 10 and stops at the 11th.
    const [node] = useNodes(
      makeNode({
        transactionsOf: (n) =>
          n >= 987_990n && n <= 988_000n
            ? prologueOnly(n)
            : checkpointTransactions(n),
      })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(node.ledgerService.batchGetTransactions).not.toHaveBeenCalled()
  })

  it('steps further back when checkpoints come faster than the minimum interval', async () => {
    // At 150 ms, 12,000 checkpoints back is 30 min ago, after the earliest
    // landing time (40 min ago); 24,000 back is 60 min ago.
    const [node] = useNodes(makeNode({ intervalMs: 150 }))

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)
    expectCanaries(node, 'tx-976000', 'tx-999880')
  })

  it('stops at checkpoint 0 when the chain starts after the earliest landing time', async () => {
    // Signed 60 h ago; at 100 ms, checkpoint 0 is only about 28 h old.
    const [node] = useNodes(makeNode({ intervalMs: 100 }))

    await expect(
      isSuiTransactionDropped(
        client,
        stepSignedAt(NOW - 60 * 60 * 60_000),
        DIGEST
      )
    ).resolves.toBe(false)
    const genesisCalls = node.ledgerService.getCheckpoint.mock.calls.filter(
      ([{ checkpointId }]) => checkpointId.sequenceNumber === 0n
    )
    expect(genesisCalls).toHaveLength(1)
    expect(node.ledgerService.batchGetTransactions).not.toHaveBeenCalled()
  })

  it('takes the tip as the after canary when 120 checkpoints behind it is not past the latest landing time', async () => {
    // The latest landing time is 10 s ago; 120 checkpoints back is 30 s ago.
    // The before canary: 27 min 10 s back at 200 ms = 8,150 checkpoints.
    const [node] = useNodes(makeNode())

    await expect(
      isSuiTransactionDropped(
        client,
        stepSignedAt(NOW - 17 * 60_000 - 10_000),
        DIGEST
      )
    ).resolves.toBe(true)
    expectCanaries(node, 'tx-991850', 'tx-1000000')
  })

  it('stays unknown when a checkpoint timestamp is the protobuf default', async () => {
    // At 150 ms, checkpoint 988,000 is 30 min old, after the earliest landing
    // time. A zero timestamp must not make it look older.
    const [node] = useNodes(
      makeNode({ intervalMs: 150, timestamps: new Map([[988_000n, 0]]) })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(node.ledgerService.batchGetTransactions).not.toHaveBeenCalled()
  })

  // Checkpoint timestamps grow with the sequence number. A node that breaks
  // this must not move a canary into the landing window.
  it('stays unknown when a stepped-back checkpoint is not older than the earliest landing time', async () => {
    const [node] = useNodes(
      makeNode({
        transactionsOf: (n) =>
          n === 988_000n ? prologueOnly(n) : checkpointTransactions(n),
        timestamps: new Map([[987_999n, NOW]]),
      })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(node.ledgerService.batchGetTransactions).not.toHaveBeenCalled()
  })

  it('stays unknown when a checkpoint toward the tip is not past the latest landing time', async () => {
    const [node] = useNodes(
      makeNode({
        transactionsOf: (n) =>
          n === 999_880n ? prologueOnly(n) : checkpointTransactions(n),
        timestamps: new Map([[999_881n, NOW - 20 * 60_000]]),
      })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(node.ledgerService.batchGetTransactions).not.toHaveBeenCalled()
  })

  it('asks the next node for canaries when the first node lags', async () => {
    // The first node's head is 16 min 40 s old, not past the latest landing
    // time (13 min ago).
    const [, second] = useNodes(makeNode({ head: TIP - 4_000n }), makeNode())

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(true)
    expectCanaries(second, 'tx-988000', 'tx-999880')
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

  it.each<[string, NodeOptions]>([
    ['the response has more than three results', { resultOrder: [0, 1, 2, 1] }],
    ['the before slot holds another digest', { resultOrder: [0, 2, 2] }],
    ['the after slot holds another digest', { resultOrder: [0, 1, 1] }],
    ['the target result has no case', { targetUnset: true }],
  ])('stays unknown when %s', async (_, options) => {
    useNodes(makeNode(options))

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  // The first node covers and answers "not found". The second node has the
  // target but pruned the early canary, and lists the results out of request
  // order: the canary's NOT_FOUND is first, the target second.
  it('is not dropped when a node returns the digest out of request order', async () => {
    useNodes(
      makeNode(),
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
    const [, lagging] = useNodes(
      makeNode({ failing: true }),
      makeNode({ head: TIP - 1_000n })
    )

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expectCanaries(lagging, 'tx-988000', 'tx-999880')
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
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      client,
      expect.anything(),
      DIGEST
    )
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

  // The device clock now runs an hour behind the chain, so signedAt lies in
  // the future. A refused resend does not mean that the age cap passed.
  it('never looks up while signedAt is in the future', async () => {
    vi.setSystemTime(NOW - 60 * 60_000)
    const [node] = useNodes(makeNode())

    await expect(
      isSuiTransactionDropped(client, stepSignedAt(SIGNED_AT), DIGEST)
    ).resolves.toBe(false)
    expect(node.ledgerService.getCheckpoint).not.toHaveBeenCalled()
  })

  // A node that accepts the connection and never answers must not hold the
  // resume, and the route with it, open for good. Each call to a node has
  // its own budget; past it the call is aborted and counts as failed.
  describe('when a node never answers', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(NOW)
    })

    const never = (): Promise<never> => new Promise<never>(() => {})

    /** Starts the check; `state.settled` turns true when it settles. */
    const start = () => {
      const state = { settled: false }
      const result = isSuiTransactionDropped(
        client,
        stepSignedAt(SIGNED_AT),
        DIGEST
      ).finally(() => {
        state.settled = true
      })
      return { state, result }
    }

    it('stays unknown when a checkpoint read never answers', async () => {
      const [node] = useNodes(makeNode())
      node.ledgerService.getCheckpoint.mockImplementation(never)

      const { state, result } = start()
      await vi.advanceTimersByTimeAsync(SUI_LOOKUP_TIMEOUT_MS - 1)
      expect(state.settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      expect(state.settled).toBe(true)
      await expect(result).resolves.toBe(false)

      expect(node.ledgerService.getCheckpoint).toHaveBeenCalledTimes(1)
      const [, options] = node.ledgerService.getCheckpoint.mock.calls[0]
      expect(options?.abort).toBeInstanceOf(AbortSignal)
      expect(options?.abort?.aborted).toBe(true)
      expect(node.ledgerService.batchGetTransactions).not.toHaveBeenCalled()
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('stays unknown when the batch lookup never answers', async () => {
      const [node] = useNodes(makeNode())
      node.ledgerService.batchGetTransactions.mockImplementation(never)

      const { state, result } = start()
      await vi.advanceTimersByTimeAsync(SUI_LOOKUP_TIMEOUT_MS - 1)
      expect(state.settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      expect(state.settled).toBe(true)
      await expect(result).resolves.toBe(false)

      expect(node.ledgerService.batchGetTransactions).toHaveBeenCalledTimes(1)
      const [, options] = node.ledgerService.batchGetTransactions.mock.calls[0]
      expect(options?.abort).toBeInstanceOf(AbortSignal)
      expect(options?.abort?.aborted).toBe(true)
      // Every checkpoint read got its own signal, and none was aborted.
      for (const [, readOptions] of node.ledgerService.getCheckpoint.mock
        .calls) {
        expect(readOptions?.abort?.aborted).toBe(false)
      }
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    // As a node that fails: the budget is per node, so the next node is
    // still asked, and its covering response is the proof.
    it('asks the next node when a node never answers', async () => {
      const [hung, second] = useNodes(makeNode(), makeNode())
      hung.ledgerService.getCheckpoint.mockImplementation(never)
      hung.ledgerService.batchGetTransactions.mockImplementation(never)

      const { state, result } = start()
      await vi.advanceTimersByTimeAsync(2 * SUI_LOOKUP_TIMEOUT_MS + 1)
      expect(state.settled).toBe(true)
      await expect(result).resolves.toBe(true)

      expectCanaries(second, 'tx-988000', 'tx-999880')
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
