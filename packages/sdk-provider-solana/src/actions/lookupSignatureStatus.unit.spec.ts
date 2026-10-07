import type { Signature } from '@solana/kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSolanaRpcs = vi.fn()
vi.mock('../rpc/registry.js', () => ({
  getSolanaRpcs: (...args: unknown[]) => getSolanaRpcs(...args),
}))

const {
  CANARY_CALL_TIMEOUT_MS,
  CANARY_SLOT_STEPS,
  COVERAGE_PROOF_TIMEOUT_MS,
  lookupSignatureStatus,
  SIGNATURE_LOOKUP_TIMEOUT_MS,
} = await import('./lookupSignatureStatus.js')

const TARGET = 'target-signature' as Signature
/** Base58 of 64 bytes of 0x01: passes `isSignature`, as a canary must. */
const HISTORY_CANARY =
  '2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2'
/** Base58 of 64 bytes of 0x02. */
const HEAD_CANARY =
  '3L3RY5sT8K4kyEnqhizwaqxLEbcYvpGrGPNEYRwtbCSUtL6YL86jdrvCbohnP5q8VxQ3qzGmt3W3iQJW97rD7m3'
const client = {} as never

const NOW = 1_700_000_000_000
/** Signed a minute before the anchor, the current slot 1000: the history
 * canary block is 1000 - ceil(60_000 / 400) = 850. The expiry verdict is at
 * slot 900, so the head canary block is 900 or later. */
const BOUNDS = { anchor: NOW - 60_000, expiredAtSlot: 900n, now: NOW }
const CANARY_SLOT = 850n

const HISTORY_BLOCK_CONFIG = {
  transactionDetails: 'signatures',
  rewards: false,
  maxSupportedTransactionVersion: 0,
}
const HEAD_BLOCK_CONFIG = { commitment: 'confirmed', ...HISTORY_BLOCK_CONFIG }

const landed = (confirmationStatus = 'finalized', slot = 1n) => ({
  confirmationStatus,
  err: null,
  slot,
})
/** A status of the history canary. A valid one has the slot of the block
 * the canary was taken from. */
const historyAt = (slot = CANARY_SLOT) => landed('finalized', slot)
/** A status of the head canary, by default from the block at the expiry
 * slot. */
const headAt = (slot = 900n) => landed('confirmed', slot)

/** A `getSignatureStatuses` response whose head is `headSlot`. */
const statusesAt =
  (headSlot: bigint, ...value: unknown[]) =>
  async () => ({ context: { slot: headSlot }, value })

/** A read that never settles and ignores the abort signal. */
const hangs = () => new Promise<never>(() => {})

/** An RPC fake. By default its current slot is 1000, the blocks up to the
 * history canary slot hold the history canary and the later blocks hold the
 * head canary. */
const rpcWith = (options: {
  statuses: (signatures: readonly string[]) => Promise<unknown>
  slot?: () => Promise<unknown>
  block?: (slot: bigint) => Promise<unknown>
}) => ({
  getSlot: vi.fn((_config?: object) => ({
    send: (_options?: object) => (options.slot ?? (async () => 1_000n))(),
  })),
  getBlock: vi.fn((slot: bigint, _config?: { commitment?: string }) => ({
    send: (_options?: object) =>
      (
        options.block ??
        (async (slot: bigint) => ({
          signatures: [slot <= CANARY_SLOT ? HISTORY_CANARY : HEAD_CANARY],
        }))
      )(slot),
  })),
  getSignatureStatuses: vi.fn(
    (signatures: readonly string[], _config?: object) => ({
      send: (_options?: { abortSignal?: AbortSignal }) =>
        options.statuses(signatures),
    })
  ),
})

/** The slots of the head canary `getBlock` calls, the ones at `confirmed`. */
const headBlockSlots = (rpc: ReturnType<typeof rpcWith>) =>
  rpc.getBlock.mock.calls
    .filter(([, config]) => config?.commitment === 'confirmed')
    .map(([slot]) => slot)

describe('lookupSignatureStatus', () => {
  beforeEach(() => {
    getSolanaRpcs.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('with bounds (the dropped check)', () => {
    it('asks for the target and both canaries in one request, with the history', async () => {
      const rpc = rpcWith({
        statuses: statusesAt(950n, null, historyAt(), headAt()),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await lookupSignatureStatus(client, TARGET, BOUNDS)

      expect(rpc.getSlot).toHaveBeenCalledWith({ commitment: 'confirmed' })
      expect(rpc.getBlock).toHaveBeenCalledWith(
        CANARY_SLOT,
        HISTORY_BLOCK_CONFIG
      )
      expect(rpc.getBlock).toHaveBeenCalledWith(900n, HEAD_BLOCK_CONFIG)
      // One request: a load-balanced pool may send a second one to another
      // backend, which would prove nothing about the first answer.
      expect(rpc.getSignatureStatuses).toHaveBeenCalledTimes(1)
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith(
        [TARGET, HISTORY_CANARY, HEAD_CANARY],
        { searchTransactionHistory: true }
      )
    })

    it('returns not-found when a covering RPC with its head past the expiry slot answers null', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, null, historyAt(), headAt()) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })
    })

    it('returns not-found when the head of a covering RPC is at the expiry slot', async () => {
      // The expiry slot is the highest slot of the expiry streak: a head at
      // that slot has seen every slot the transaction could land in.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(900n, null, historyAt(), headAt()) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })
    })

    it('returns unknown when the RPC has no status for the history canary', async () => {
      // A pruned node answers null for the target and for the history canary
      // alike: its history does not reach the signing time.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, null, null, headAt()) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it('returns unknown when the RPC has no status for the head canary', async () => {
      // A node on a minority fork does not know the confirmed block of the
      // majority at the head, whatever its own head slot says.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, null, historyAt(), null) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it('returns unknown when the head of the answering node is behind the expiry slot', async () => {
      // The node has not seen every slot the transaction could land in.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(899n, null, historyAt(), headAt()) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it('returns unknown when the response has no context slot', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({
          statuses: async () => ({ value: [null, historyAt(), headAt()] }),
        }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it('returns unknown when a canary entry is not a status object', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, null, 'landed', 'landed') }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it.each([
      ['history', historyAt(CANARY_SLOT + 1n), headAt()],
      ['head', historyAt(), headAt(901n)],
    ])(
      'returns unknown when the %s canary status has another slot than its block',
      async (_canary, history, head) => {
        // A node on a minority fork can hold the head canary transaction if
        // the same transaction also landed on its fork: its status then has
        // another slot.
        getSolanaRpcs.mockResolvedValue([
          rpcWith({ statuses: statusesAt(950n, null, history, head) }),
        ])

        await expect(
          lookupSignatureStatus(client, TARGET, BOUNDS)
        ).resolves.toMatchObject({ kind: 'unknown', answered: true })
      }
    )

    it.each([
      [
        'history',
        'without a slot',
        { confirmationStatus: 'finalized', err: null },
        headAt(),
      ],
      [
        'head',
        'without a slot',
        historyAt(),
        { confirmationStatus: 'confirmed', err: null },
      ],
      ['history', 'an empty object', {}, headAt()],
      ['head', 'an empty object', historyAt(), {}],
      ['head', 'an array', historyAt(), []],
      ['history', 'at a number slot', { ...historyAt(), slot: 850 }, headAt()],
      ['head', 'at a number slot', historyAt(), { ...headAt(), slot: 900 }],
      // Only the head canary is bad: the history canary alone must not pass.
      ['head', 'not an object', historyAt(), 'landed'],
    ])(
      'returns unknown when the %s canary status is %s',
      async (_canary, _shape, history, head) => {
        getSolanaRpcs.mockResolvedValue([
          rpcWith({ statuses: statusesAt(950n, null, history, head) }),
        ])

        await expect(
          lookupSignatureStatus(client, TARGET, BOUNDS)
        ).resolves.toMatchObject({ kind: 'unknown', answered: true })
      }
    )

    it('returns unknown when no single response carries the whole proof', async () => {
      // Each part of the proof has to come from the same response: parts
      // from several nodes prove nothing about any one of them.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(899n, null, historyAt(), headAt()) }),
        rpcWith({ statuses: statusesAt(950n, null, null, headAt()) }),
        rpcWith({ statuses: statusesAt(950n, null, historyAt(), null) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it('places the history canary from the lowest current slot, so an RPC ahead cannot move it after the anchor', async () => {
      const onTime = rpcWith({
        statuses: statusesAt(950n, null, historyAt(), headAt()),
      })
      const ahead = rpcWith({
        slot: async () => 5_000n,
        statuses: statusesAt(950n, null, historyAt(), headAt()),
      })
      getSolanaRpcs.mockResolvedValue([onTime, ahead])

      // With an expiry verdict the head is the expiry slot, not the highest
      // current slot.
      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })
      expect(onTime.getBlock.mock.calls[0][0]).toBe(CANARY_SLOT)
      expect(ahead.getBlock.mock.calls[0][0]).toBe(CANARY_SLOT)
    })

    it('uses the freshest current slot as the head when there is no expiry verdict', async () => {
      const lagging = rpcWith({
        slot: async () => 1_000n,
        statuses: statusesAt(1_005n, null, historyAt(), headAt(1_010n)),
      })
      const fresh = rpcWith({
        slot: async () => 1_010n,
        statuses: statusesAt(1_009n, null, historyAt(), headAt(1_010n)),
      })
      getSolanaRpcs.mockResolvedValue([lagging, fresh])
      const bounds = { anchor: NOW - 60_000, now: NOW }

      // Both heads are behind 1010, the freshest slot any RPC reported.
      await expect(
        lookupSignatureStatus(client, TARGET, bounds)
      ).resolves.toMatchObject({ kind: 'unknown' })
      // The history canary block is placed from the lowest slot, not the
      // freshest. The head canary block is the freshest confirmed block.
      expect(lagging.getBlock.mock.calls[0][0]).toBe(1_000n - 150n)
      expect(headBlockSlots(lagging)).toEqual([1_010n])

      fresh.getSignatureStatuses.mockImplementation(() => ({
        send: statusesAt(1_010n, null, historyAt(), headAt(1_010n)),
      }))
      await expect(
        lookupSignatureStatus(client, TARGET, bounds)
      ).resolves.toEqual({ kind: 'not-found' })
    })

    it('returns found when any RPC has the target, whatever another one proves', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, null, historyAt(), headAt()) }),
        rpcWith({
          statuses: statusesAt(
            950n,
            landed('confirmed'),
            historyAt(),
            headAt()
          ),
        }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'found', status: landed('confirmed') })
    })

    it('lets any RPC supply the history canary and steps down over skipped slots', async () => {
      const pruned = rpcWith({
        block: async (slot) => {
          if (slot <= CANARY_SLOT) {
            throw new Error('Block not available for slot')
          }
          return { signatures: [HEAD_CANARY] }
        },
        statuses: statusesAt(950n, null, historyAt(CANARY_SLOT - 2n), headAt()),
      })
      const archival = rpcWith({
        block: async (slot) => {
          if (slot === CANARY_SLOT) {
            return null
          }
          if (slot === CANARY_SLOT - 1n) {
            throw new Error('Slot was skipped')
          }
          return {
            signatures: [slot <= CANARY_SLOT ? HISTORY_CANARY : HEAD_CANARY],
          }
        },
        statuses: statusesAt(950n, null, historyAt(CANARY_SLOT - 2n), headAt()),
      })
      getSolanaRpcs.mockResolvedValue([pruned, archival])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })

      expect(
        archival.getBlock.mock.calls
          .filter(([slot]) => slot <= CANARY_SLOT)
          .map(([slot]) => slot)
      ).toEqual([CANARY_SLOT, CANARY_SLOT - 1n, CANARY_SLOT - 2n])
      expect(pruned.getSignatureStatuses).toHaveBeenCalledWith(
        [TARGET, HISTORY_CANARY, HEAD_CANARY],
        { searchTransactionHistory: true }
      )
    })

    it('takes the head canary from the first confirmed block at or after the expiry slot', async () => {
      const rpc = rpcWith({
        block: async (slot) => {
          if (slot === 900n) {
            throw new Error('Slot 900 was skipped')
          }
          if (slot < 900n && slot > CANARY_SLOT) {
            // Before the expiry: a search that steps down would take this
            // signature as the head canary.
            return { signatures: [HISTORY_CANARY] }
          }
          return {
            signatures: [slot <= CANARY_SLOT ? HISTORY_CANARY : HEAD_CANARY],
          }
        },
        statuses: statusesAt(950n, null, historyAt(), headAt(901n)),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })

      expect(headBlockSlots(rpc)).toEqual([900n, 901n])
      expect(rpc.getBlock).toHaveBeenCalledWith(901n, HEAD_BLOCK_CONFIG)
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith(
        [TARGET, HISTORY_CANARY, HEAD_CANARY],
        { searchTransactionHistory: true }
      )
    })

    it('skips a block entry that is not a signature, also one that is not base58', async () => {
      // `isSignature` throws on a 64-88 character string that is not base58.
      const rpc = rpcWith({
        block: async (slot) => ({
          signatures:
            slot <= CANARY_SLOT
              ? ['0'.repeat(64), 'not-a-signature', 42, HISTORY_CANARY]
              : [HEAD_CANARY],
        }),
        statuses: statusesAt(950n, null, historyAt(), headAt()),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })

      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith(
        [TARGET, HISTORY_CANARY, HEAD_CANARY],
        { searchTransactionHistory: true }
      )
    })

    it('cannot prove absence when no RPC supplies a history canary', async () => {
      const rpc = rpcWith({
        block: async () => null,
        statuses: statusesAt(950n, null),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })

      // No head canary search follows: without a history canary no answer
      // can prove absence.
      expect(rpc.getBlock).toHaveBeenCalledTimes(CANARY_SLOT_STEPS)
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith([TARGET], {
        searchTransactionHistory: true,
      })
    })

    it('cannot prove absence when no RPC supplies a head canary, and asks for no block past the current slot', async () => {
      const rpc = rpcWith({
        block: async (slot) =>
          slot <= CANARY_SLOT ? { signatures: [HISTORY_CANARY] } : null,
        statuses: statusesAt(1_000n, null),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(
        lookupSignatureStatus(client, TARGET, {
          ...BOUNDS,
          expiredAtSlot: 990n,
        })
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })

      expect(headBlockSlots(rpc)).toEqual(
        Array.from({ length: 11 }, (_, index) => 990n + BigInt(index))
      )
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith([TARGET], {
        searchTransactionHistory: true,
      })
    })

    it('cannot prove absence when no RPC reports its current slot', async () => {
      const rpc = rpcWith({
        slot: async () => {
          throw new Error('429')
        },
        statuses: statusesAt(950n, null),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown' })

      expect(rpc.getBlock).not.toHaveBeenCalled()
    })

    it('cannot prove absence when the clock is before the anchor', async () => {
      // An age of 0 would put the history canary at the current slot: the
      // weakest canary there is.
      const rpc = rpcWith({
        statuses: statusesAt(950n, null, historyAt(), headAt()),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(
        lookupSignatureStatus(client, TARGET, { ...BOUNDS, anchor: NOW + 1 })
      ).resolves.toMatchObject({ kind: 'unknown' })

      expect(rpc.getBlock).not.toHaveBeenCalled()
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith([TARGET], {
        searchTransactionHistory: true,
      })
    })

    it('returns unknown instead of throwing when the anchor is not a number', async () => {
      const rpc = rpcWith({
        statuses: statusesAt(950n, null, historyAt(), headAt()),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(
        lookupSignatureStatus(client, TARGET, {
          ...BOUNDS,
          anchor: Number.NaN,
        })
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })

      // No proof, but the target is still looked up: it may have landed.
      expect(rpc.getBlock).not.toHaveBeenCalled()
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith([TARGET], {
        searchTransactionHistory: true,
      })
    })

    it.each([
      ['getSlot', { slot: hangs }],
      ['getBlock', { block: hangs }],
      ['getSignatureStatuses', { statuses: hangs }],
      ['every method', { slot: hangs, block: hangs, statuses: hangs }],
    ] as const)(
      'a single hung RPC must not block a verdict when other RPCs answer (%s hangs)',
      async (_method, hang) => {
        vi.useFakeTimers()
        const hung = rpcWith({
          statuses: statusesAt(950n, null, historyAt(), headAt()),
          ...hang,
        })
        getSolanaRpcs.mockResolvedValue([
          hung,
          rpcWith({ statuses: statusesAt(950n, null, historyAt(), headAt()) }),
        ])

        let result: unknown
        void lookupSignatureStatus(client, TARGET, BOUNDS).then((value) => {
          result = value
        })
        // The hung RPC costs one call budget in the proof search, then it is
        // left out of it, and one status budget.
        await vi.advanceTimersByTimeAsync(
          CANARY_CALL_TIMEOUT_MS + SIGNATURE_LOOKUP_TIMEOUT_MS
        )

        expect(result).toEqual({ kind: 'not-found' })
      }
    )

    it('ends the proof search after COVERAGE_PROOF_TIMEOUT_MS and still looks the target up', async () => {
      // Each block read answers inside its own budget, but the search as a
      // whole must not hold the wait task for CANARY_SLOT_STEPS of them.
      vi.useFakeTimers()
      const rpc = rpcWith({
        block: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(null), 1_000)
          }),
        statuses: statusesAt(950n, null),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      let result: unknown
      void lookupSignatureStatus(client, TARGET, BOUNDS).then((value) => {
        result = value
      })
      await vi.advanceTimersByTimeAsync(
        COVERAGE_PROOF_TIMEOUT_MS + CANARY_CALL_TIMEOUT_MS
      )

      expect(result).toMatchObject({ kind: 'unknown', answered: true })
      expect(rpc.getBlock.mock.calls.length).toBeLessThan(CANARY_SLOT_STEPS)
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith([TARGET], {
        searchTransactionHistory: true,
      })
    })
  })

  describe('without bounds', () => {
    it('asks every RPC for the target alone and never proves absence', async () => {
      const rpc = rpcWith({ statuses: statusesAt(950n, null) })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(lookupSignatureStatus(client, TARGET)).resolves.toEqual({
        kind: 'unknown',
        answered: true,
        errors: [expect.any(Error)],
      })

      expect(rpc.getSlot).not.toHaveBeenCalled()
      expect(rpc.getBlock).not.toHaveBeenCalled()
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith([TARGET], {
        searchTransactionHistory: true,
      })
    })

    it('prefers a confirmed status over a processed one from a lagging RPC', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, landed('processed')) }),
        rpcWith({ statuses: statusesAt(950n, landed('confirmed')) }),
      ])

      await expect(lookupSignatureStatus(client, TARGET)).resolves.toEqual({
        kind: 'found',
        status: landed('confirmed'),
      })
    })

    it('returns a processed status as found and leaves the verdict to the caller', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, landed('processed')) }),
      ])

      await expect(lookupSignatureStatus(client, TARGET)).resolves.toEqual({
        kind: 'found',
        status: landed('processed'),
      })
    })

    it('does not count a target entry that is not a status object as an answer', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, 'finalized') }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET)
      ).resolves.toMatchObject({ kind: 'unknown', answered: false })
    })
  })

  it('returns unknown, not answered, with every error when no RPC answered', async () => {
    const failing = (message: string) =>
      rpcWith({
        statuses: async () => {
          throw new Error(message)
        },
      })
    getSolanaRpcs.mockResolvedValue([
      failing('429'),
      failing('method not found'),
    ])

    const result = await lookupSignatureStatus(client, TARGET)

    expect(result).toMatchObject({ kind: 'unknown', answered: false })
    if (result.kind !== 'unknown') {
      throw new Error('unreachable')
    }
    expect(result.errors.map((error) => error.message).sort()).toEqual([
      '429',
      'method not found',
    ])
  })

  it('does not read a { value: null } response as an answer', async () => {
    // The endpoint responded but said nothing about the signature. Reading
    // it as "not on chain" would be the one coercion that invents a drop.
    getSolanaRpcs.mockResolvedValue([
      rpcWith({
        statuses: async () => ({ context: { slot: 950n }, value: null }),
      }),
    ])

    await expect(
      lookupSignatureStatus(client, TARGET, BOUNDS)
    ).resolves.toMatchObject({ kind: 'unknown', answered: false })
  })

  it('returns unknown when no RPC is configured', async () => {
    getSolanaRpcs.mockResolvedValue([])

    await expect(
      lookupSignatureStatus(client, TARGET, BOUNDS)
    ).resolves.toEqual({ kind: 'unknown', answered: false, errors: [] })
  })

  it('returns unknown instead of throwing when the RPC list cannot be read', async () => {
    getSolanaRpcs.mockRejectedValue(new Error('chains request failed'))

    const result = await lookupSignatureStatus(client, TARGET, BOUNDS)

    expect(result).toMatchObject({ kind: 'unknown', answered: false })
    if (result.kind !== 'unknown') {
      throw new Error('unreachable')
    }
    expect(result.errors[0].message).toBe('chains request failed')
  })

  it('returns unknown instead of throwing on an unexpected fault', async () => {
    getSolanaRpcs.mockResolvedValue(null)

    await expect(
      lookupSignatureStatus(client, TARGET, BOUNDS)
    ).resolves.toMatchObject({ kind: 'unknown', answered: false })
  })

  it('returns unknown instead of throwing when a failure reason cannot be printed', async () => {
    // `String()` throws on an object without a prototype.
    getSolanaRpcs.mockRejectedValue(Object.create(null))

    const result = await lookupSignatureStatus(client, TARGET, BOUNDS)

    expect(result).toMatchObject({ kind: 'unknown', answered: false })
    if (result.kind !== 'unknown') {
      throw new Error('unreachable')
    }
    expect(result.errors[0]).toBeInstanceOf(Error)
  })

  it('keeps the answers of the other RPCs when one fails with a reason that cannot be printed', async () => {
    getSolanaRpcs.mockResolvedValue([
      rpcWith({ statuses: () => Promise.reject(Object.create(null)) }),
      rpcWith({ statuses: statusesAt(950n, landed('confirmed')) }),
    ])

    await expect(lookupSignatureStatus(client, TARGET)).resolves.toEqual({
      kind: 'found',
      status: landed('confirmed'),
    })
  })

  it('gives up on a hung RPC after SIGNATURE_LOOKUP_TIMEOUT_MS', async () => {
    // `allSettled` over a read that never settles would hold the wait task
    // forever. The abort is what ends it.
    vi.useFakeTimers()
    const hung = rpcWith({ statuses: async () => ({}) })
    hung.getSignatureStatuses.mockImplementation(() => ({
      send: (options?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted')),
            { once: true }
          )
        }),
    }))
    getSolanaRpcs.mockResolvedValue([
      hung,
      rpcWith({ statuses: statusesAt(950n, landed()) }),
    ])

    const pending = lookupSignatureStatus(client, TARGET)
    await vi.advanceTimersByTimeAsync(SIGNATURE_LOOKUP_TIMEOUT_MS)

    await expect(pending).resolves.toEqual({
      kind: 'found',
      status: landed(),
    })
  })
})
