import type { Signature } from '@solana/kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSolanaRpcs = vi.fn()
vi.mock('../rpc/registry.js', () => ({
  getSolanaRpcs: (...args: unknown[]) => getSolanaRpcs(...args),
}))

const {
  CANARY_SLOT_STEPS,
  lookupSignatureStatus,
  SIGNATURE_LOOKUP_TIMEOUT_MS,
} = await import('./lookupSignatureStatus.js')

const TARGET = 'target-signature' as Signature
/** Base58 of 64 bytes of 0x01: passes `isSignature`, as a canary must. */
const CANARY =
  '2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2'
const client = {} as never

const NOW = 1_700_000_000_000
/** Signed a minute before the anchor, the current slot 1000: the canary
 * block is 1000 - ceil(60_000 / 400) = 850. */
const BOUNDS = { anchor: NOW - 60_000, expiredAtSlot: 900n, now: NOW }
const CANARY_SLOT = 850n

const landed = (confirmationStatus = 'finalized') => ({
  confirmationStatus,
  err: null,
  slot: 1n,
})

/** A `getSignatureStatuses` response whose head is `headSlot`. */
const statusesAt =
  (headSlot: bigint, ...value: unknown[]) =>
  async () => ({ context: { slot: headSlot }, value })

/** An RPC fake. By default its current slot is 1000 and every block holds
 * the canary. */
const rpcWith = (options: {
  statuses: (signatures: readonly string[]) => Promise<unknown>
  slot?: () => Promise<unknown>
  block?: (slot: bigint) => Promise<unknown>
}) => ({
  getSlot: vi.fn((_config?: object) => ({
    send: (_options?: object) => (options.slot ?? (async () => 1_000n))(),
  })),
  getBlock: vi.fn((slot: bigint, _config?: object) => ({
    send: (_options?: object) =>
      (options.block ?? (async () => ({ signatures: [CANARY] })))(slot),
  })),
  getSignatureStatuses: vi.fn(
    (signatures: readonly string[], _config?: object) => ({
      send: (_options?: { abortSignal?: AbortSignal }) =>
        options.statuses(signatures),
    })
  ),
})

describe('lookupSignatureStatus', () => {
  beforeEach(() => {
    getSolanaRpcs.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('with bounds (the dropped check)', () => {
    it('asks for the target and the canary in one request, with the history', async () => {
      const rpc = rpcWith({ statuses: statusesAt(950n, null, landed()) })
      getSolanaRpcs.mockResolvedValue([rpc])

      await lookupSignatureStatus(client, TARGET, BOUNDS)

      expect(rpc.getSlot).toHaveBeenCalledWith({ commitment: 'confirmed' })
      expect(rpc.getBlock).toHaveBeenCalledWith(CANARY_SLOT, {
        transactionDetails: 'signatures',
        rewards: false,
        maxSupportedTransactionVersion: 0,
      })
      // One request: a load-balanced pool may send a second one to another
      // backend, which would prove nothing about the first answer.
      expect(rpc.getSignatureStatuses).toHaveBeenCalledTimes(1)
      expect(rpc.getSignatureStatuses).toHaveBeenCalledWith([TARGET, CANARY], {
        searchTransactionHistory: true,
      })
    })

    it('returns not-found when a covering RPC with its head past the expiry slot answers null', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, null, landed()) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })
    })

    it('returns not-found when the head of a covering RPC is at the expiry slot', async () => {
      // The expiry slot is the highest slot of the expiry streak: a head at
      // that slot has seen every slot the transaction could land in.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(900n, null, landed()) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })
    })

    it('returns unknown when the RPC has no status for the canary either', async () => {
      // A pruned node answers null for the target and for the canary alike:
      // its history does not reach the signing time.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, null, null) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it('returns unknown when the head of the answering node is behind the expiry slot', async () => {
      // The node has not seen every slot the transaction could land in.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(899n, null, landed()) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it('returns unknown when one RPC proves only the coverage and another only the head', async () => {
      // Each half of the proof has to come from the same response: two
      // halves from two nodes prove nothing about either node.
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(899n, null, landed()) }),
        rpcWith({ statuses: statusesAt(950n, null, null) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })
    })

    it('places the canary from the lowest current slot, so an RPC ahead cannot move it after the anchor', async () => {
      const onTime = rpcWith({ statuses: statusesAt(950n, null, landed()) })
      const ahead = rpcWith({
        slot: async () => 5_000n,
        statuses: statusesAt(950n, null, landed()),
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
        statuses: statusesAt(1_005n, null, landed()),
      })
      const fresh = rpcWith({
        slot: async () => 1_010n,
        statuses: statusesAt(1_009n, null, landed()),
      })
      getSolanaRpcs.mockResolvedValue([lagging, fresh])
      const bounds = { anchor: NOW - 60_000, now: NOW }

      // Both heads are behind 1010, the freshest slot any RPC reported.
      await expect(
        lookupSignatureStatus(client, TARGET, bounds)
      ).resolves.toMatchObject({ kind: 'unknown' })
      // The canary block is placed from the lowest slot, not the freshest.
      expect(lagging.getBlock.mock.calls[0][0]).toBe(1_000n - 150n)

      fresh.getSignatureStatuses.mockImplementation(() => ({
        send: statusesAt(1_010n, null, landed()),
      }))
      await expect(
        lookupSignatureStatus(client, TARGET, bounds)
      ).resolves.toEqual({ kind: 'not-found' })
    })

    it('returns found when any RPC has the target, whatever another one proves', async () => {
      getSolanaRpcs.mockResolvedValue([
        rpcWith({ statuses: statusesAt(950n, null, landed()) }),
        rpcWith({ statuses: statusesAt(950n, landed('confirmed'), landed()) }),
      ])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'found', status: landed('confirmed') })
    })

    it('lets any RPC supply the canary and steps down over skipped slots', async () => {
      const pruned = rpcWith({
        block: async () => {
          throw new Error('Block not available for slot')
        },
        statuses: statusesAt(950n, null, landed()),
      })
      const archival = rpcWith({
        block: async (slot) => {
          if (slot === CANARY_SLOT) {
            return null
          }
          if (slot === CANARY_SLOT - 1n) {
            throw new Error('Slot was skipped')
          }
          return { signatures: [CANARY] }
        },
        statuses: statusesAt(950n, null, landed()),
      })
      getSolanaRpcs.mockResolvedValue([pruned, archival])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toEqual({ kind: 'not-found' })

      expect(archival.getBlock.mock.calls.map((call) => call[0])).toEqual([
        CANARY_SLOT,
        CANARY_SLOT - 1n,
        CANARY_SLOT - 2n,
      ])
      expect(pruned.getSignatureStatuses).toHaveBeenCalledWith(
        [TARGET, CANARY],
        { searchTransactionHistory: true }
      )
    })

    it('cannot prove absence when no RPC supplies a canary', async () => {
      const rpc = rpcWith({
        block: async () => null,
        statuses: statusesAt(950n, null),
      })
      getSolanaRpcs.mockResolvedValue([rpc])

      await expect(
        lookupSignatureStatus(client, TARGET, BOUNDS)
      ).resolves.toMatchObject({ kind: 'unknown', answered: true })

      expect(rpc.getBlock).toHaveBeenCalledTimes(CANARY_SLOT_STEPS)
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
