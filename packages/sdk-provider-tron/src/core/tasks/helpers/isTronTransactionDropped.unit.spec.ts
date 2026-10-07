import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

const { withTronNodes } = await import(
  '../../../rpc/callTronRpcsWithRetry.unit.mock.js'
)
const { isTronTransactionDropped } = await import(
  './isTronTransactionDropped.js'
)

const TX_HASH =
  'c3e7a4c5c0b8d2f1e9a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f809102'
// `raw_data.expiration` = ref block timestamp + 60 s (getCurrentRefBlockParams).
const EXPIRATION = 1_790_000_060_000
const REF_BLOCK_TIME = EXPIRATION - 60_000
const HEAD_MARGIN = 5 * 60_000
const WINDOW = 24 * 60 * 60 * 1000
// A head that satisfies every condition: past expiration + 5 min, inside 24 h.
const HEAD_OK = EXPIRATION + HEAD_MARGIN + 1

type Node = {
  trx: {
    getCurrentBlock: ReturnType<typeof vi.fn>
    getUnconfirmedTransactionInfo: ReturnType<typeof vi.fn>
  }
}

/** A node with the given head time and the given answer to the lookup. */
const answeringNode = (head: number, txInfo: unknown): Node => ({
  trx: {
    getCurrentBlock: vi.fn(async () => ({
      block_header: { raw_data: { timestamp: head } },
    })),
    getUnconfirmedTransactionInfo: vi.fn(async () => txInfo),
  },
})

/** A node with the given head time that has not included the transaction. */
const makeNode = (head: number): Node => answeringNode(head, {})

/** A node whose head request fails, with the given answer to the lookup. */
const headlessNode = (txInfo: unknown): Node => ({
  trx: {
    getCurrentBlock: vi.fn(async () => {
      throw new Error('socket hang up')
    }),
    getUnconfirmedTransactionInfo: vi.fn(async () => txInfo),
  },
})

const failingNode = (): Node => ({
  trx: {
    getCurrentBlock: vi.fn(async () => {
      throw new Error('socket hang up')
    }),
    getUnconfirmedTransactionInfo: vi.fn(async () => {
      throw new Error('socket hang up')
    }),
  },
})

const stepSignedAt = (signedAt?: number) =>
  ({ execution: { signedAt } }) as never

describe('isTronTransactionDropped', () => {
  beforeEach(() => {
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops an expired transaction that a covering node does not find and the status API does not know', async () => {
    const client = withTronNodes(makeNode(HEAD_OK))

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(true)
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      client,
      expect.anything(),
      TX_HASH
    )
  })

  it('looks up a 0x-prefixed hash without the prefix', async () => {
    const node = makeNode(HEAD_OK)
    const client = withTronNodes(node)

    await expect(
      isTronTransactionDropped(
        client,
        stepSignedAt(),
        `0x${TX_HASH}`,
        EXPIRATION
      )
    ).resolves.toBe(true)
    expect(node.trx.getUnconfirmedTransactionInfo).toHaveBeenCalledWith(TX_HASH)
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      client,
      expect.anything(),
      TX_HASH
    )
  })

  it('stays unknown while the latest block is not past expiration + 5 min', async () => {
    const client = withTronNodes(makeNode(EXPIRATION + HEAD_MARGIN))

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('stays unknown for an expired transaction when the head is only a minute past the expiration', async () => {
    const client = withTronNodes(makeNode(EXPIRATION + 60_001))

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
  })

  // `Date.now()` as the head would pass both bounds here (1 h past the
  // expiration, inside the 24 h window), so only the block time keeps it unknown.
  it('uses block time: a local clock an hour ahead does not expire the transaction', async () => {
    vi.setSystemTime(EXPIRATION + 60 * 60_000)
    const client = withTronNodes(makeNode(EXPIRATION - 1))

    await expect(
      isTronTransactionDropped(
        client,
        stepSignedAt(EXPIRATION - 60_000),
        TX_HASH,
        EXPIRATION
      )
    ).resolves.toBe(false)
  })

  // No covering proof: past the fixed window, a node may have pruned the
  // block that holds the transaction.
  it('stays unknown when the head is 24 h or more past the ref block time', async () => {
    const client = withTronNodes(makeNode(REF_BLOCK_TIME + WINDOW))

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('is never dropped while the status API knows the hash', async () => {
    isKnownToStatusApi.mockResolvedValue(true)
    const client = withTronNodes(makeNode(HEAD_OK))

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
  })

  it('is not dropped when any node returns the transaction', async () => {
    const client = withTronNodes(
      makeNode(HEAD_OK),
      answeringNode(HEAD_OK, { id: TX_HASH })
    )

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  // Condition (b) of `isTronTransactionDropped`: no node may return the
  // transaction, also a node that does not cover the window.
  it('is not dropped when a lagging node returns the transaction', async () => {
    const client = withTronNodes(
      makeNode(HEAD_OK),
      answeringNode(EXPIRATION, { id: TX_HASH })
    )

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('is not dropped when a node without a head returns the transaction', async () => {
    const headless = headlessNode({ id: TX_HASH })
    const client = withTronNodes(makeNode(HEAD_OK), headless)

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
    expect(headless.trx.getUnconfirmedTransactionInfo).toHaveBeenCalledWith(
      TX_HASH
    )
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('never counts the "not found" of a node without a head', async () => {
    const headless = headlessNode({})
    const client = withTronNodes(headless)

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
    expect(headless.trx.getUnconfirmedTransactionInfo).toHaveBeenCalled()
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  // Only `{}` is TronWeb's answer for a transaction the node has not included.
  // Any other answer without `id` (an error body, an empty response) proves
  // nothing, also from a covering node.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'Internal Server Error'],
    ['an error body', { Error: 'lack of computing resources' }],
    ['an object without id', { result: false }],
    ['an empty array', []],
  ])(
    'stays unknown when a covering node answers %s',
    async (_label, txInfo) => {
      const client = withTronNodes(answeringNode(HEAD_OK, txInfo))

      await expect(
        isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
      ).resolves.toBe(false)
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
    }
  )

  it('counts a covering node although another node lags or fails', async () => {
    const lagging = makeNode(EXPIRATION)
    const client = withTronNodes(lagging, failingNode(), makeNode(HEAD_OK))

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(true)
    expect(lagging.trx.getUnconfirmedTransactionInfo).toHaveBeenCalled()
  })

  it('stays unknown when no node answers', async () => {
    const client = withTronNodes(failingNode(), failingNode())

    await expect(
      isTronTransactionDropped(client, stepSignedAt(), TX_HASH, EXPIRATION)
    ).resolves.toBe(false)
  })

  describe('without a stored transaction (routes stored before txHex)', () => {
    const NOW = 1_790_000_000_000

    beforeEach(() => {
      vi.setSystemTime(NOW)
    })

    it('drops 20 minutes after signing when a covering node does not find it', async () => {
      const client = withTronNodes(makeNode(NOW))

      await expect(
        isTronTransactionDropped(
          client,
          stepSignedAt(NOW - 20 * 60_000),
          TX_HASH,
          undefined
        )
      ).resolves.toBe(true)
    })

    // Old enough by the local clock, but the head bound adds the clock skew
    // margin: signedAt + 10 min + 60 s + 5 min.
    it('stays unknown while the head is not past signing + skew + expiry + 5 min', async () => {
      const client = withTronNodes(makeNode(NOW))

      await expect(
        isTronTransactionDropped(
          client,
          stepSignedAt(NOW - 6 * 60_000),
          TX_HASH,
          undefined
        )
      ).resolves.toBe(false)
    })

    it('stays unknown when it was signed less than five minutes ago', async () => {
      const client = withTronNodes(makeNode(NOW + 60 * 60_000))

      await expect(
        isTronTransactionDropped(
          client,
          stepSignedAt(NOW - 4 * 60_000),
          TX_HASH,
          undefined
        )
      ).resolves.toBe(false)
    })

    it('never drops without a signing time', async () => {
      const client = withTronNodes(makeNode(NOW))

      await expect(
        isTronTransactionDropped(client, stepSignedAt(), TX_HASH, undefined)
      ).resolves.toBe(false)
    })
  })
})
