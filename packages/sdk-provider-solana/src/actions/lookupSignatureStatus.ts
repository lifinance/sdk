import type { SDKClient } from '@lifi/sdk'
import { isSignature, type Signature } from '@solana/kit'
import {
  isConfirmedCommitment,
  type SignatureStatus,
} from '../confirmation/types.js'
import { getSolanaRpcs } from '../rpc/registry.js'
import type { SolanaRpcType } from '../rpc/types.js'

/** Budget of each `getSignatureStatuses` call, the status request. A hung
 * endpoint would otherwise hold the `allSettled` below - and the wait task
 * with it - open for good. */
export const SIGNATURE_LOOKUP_TIMEOUT_MS = 15_000
/** Budget of each `getSlot` and `getBlock` call of the proof search. An RPC
 * that has not answered by then counts as silent, as a rejection does, and
 * is left out of the rest of the search: a single hung RPC must not block a
 * verdict when other RPCs answer. */
export const CANARY_CALL_TIMEOUT_MS = 3_000
/** Budget of the whole proof search. Past it the lookup asks for the target
 * alone: it can still find the transaction, but it cannot prove absence. */
export const COVERAGE_PROOF_TIMEOUT_MS = 10_000
/** Target slot time. Real slots are rarely faster, so `ceil(age / 400)`
 * slots back reach at or before the anchor; the anchor's clock-skew margin
 * absorbs the rest. */
export const SLOT_DURATION_MS = 400
/** How far each canary search steps over skipped or empty slots. */
export const CANARY_SLOT_STEPS = 32

export type LookupBounds = {
  /** The earliest time the transaction can have landed, in ms since the
   * epoch: `execution.signedAt - CLOCK_SKEW_MARGIN_MS`. */
  anchor: number
  /** The slot of the expiry verdict (the `expired` result): the highest
   * slot of the expiry streak. A node's head at or past it (`>=`) has seen
   * every slot the transaction could land in. Without a verdict the freshest
   * current slot of the RPCs is the head. */
  expiredAtSlot?: bigint
  /** Injectable clock for the canary bound. */
  now?: number
}

export type SignatureLookup =
  /** An RPC returned a status, of any commitment: the caller decides what
   * counts as landed. */
  | { kind: 'found'; status: SignatureStatus }
  /** An RPC answered `null` in a response that also proves it covers the
   * signing time and has seen every slot the transaction could land in, and
   * no RPC returned a status. */
  | { kind: 'not-found' }
  /** Nothing proves either way. `answered` separates silent RPCs - an
   * outage - from RPCs that gave a usable answer without proof. */
  | { kind: 'unknown'; answered: boolean; errors: Error[] }

/** What makes one RPC's `null` count as absence. */
type CoverageProof = {
  /** A landed signature from before the anchor: the node's history reaches
   * back to the signing time. */
  historyCanary: Canary
  /** A signature from a confirmed block at or after the expiry slot (or,
   * without a verdict, a recent one): the node is on the majority fork. */
  headCanary: Canary
  /** The slot the answering node's head has to reach. */
  headSlot: bigint
}

/** A canary signature and the slot of the block that supplied it. */
type Canary = { signature: Signature; slot: bigint }

/** The history canary block. Old enough to be finalized everywhere. */
const HISTORY_BLOCK_CONFIG = {
  transactionDetails: 'signatures',
  rewards: false,
  maxSupportedTransactionVersion: 0,
} as const
/** The head canary block: only a block the majority confirmed. */
const HEAD_BLOCK_CONFIG = {
  commitment: 'confirmed',
  ...HISTORY_BLOCK_CONFIG,
} as const

/** Never throws: `String()` throws on an object without a prototype, and a
 * proxy can throw on `instanceof`. */
const toError = (reason: unknown): Error => {
  try {
    return reason instanceof Error ? reason : new Error(String(reason))
  } catch {
    return new Error('An RPC call failed with a reason that cannot be read.')
  }
}

/** Only an object is a status. Unvalidated wire data, so `true` or a
 * string is no answer. */
const isStatus = (entry: unknown): entry is SignatureStatus =>
  typeof entry === 'object' && entry !== null

/** A canary status counts only with the slot of the block that supplied the
 * canary. A node on a minority fork can hold the head canary transaction if
 * the same transaction also landed on its fork; its status then has another
 * slot. This also rejects `{}`, arrays and a status without a bigint slot. */
const isCanaryStatus = (entry: unknown, canary: Canary): boolean =>
  isStatus(entry) &&
  typeof entry.slot === 'bigint' &&
  entry.slot === canary.slot

/** `isSignature` throws on a 64-88 character string that is not base58.
 * Here a throw means "not a signature". */
const isSignatureEntry = (entry: unknown): entry is Signature => {
  if (typeof entry !== 'string') {
    return false
  }
  try {
    return isSignature(entry)
  } catch {
    return false
  }
}

class CallTimeoutError extends Error {}

/**
 * Runs `call` with its own abort signal and a budget of `timeoutMs`. Past
 * the budget it rejects with a `CallTimeoutError` and aborts the call. The
 * race does not rely on the transport to honour the abort. A synchronous
 * throw of `call` becomes a rejection too.
 */
function callWithin<T>(
  call: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new CallTimeoutError(
        `This RPC did not answer within ${timeoutMs}ms.`
      )
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  const answer = new Promise<T>((resolve) => resolve(call(controller.signal)))
  return Promise.race([answer, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Looks a signature up on every Solana RPC, the transaction history
 * included.
 *
 * Not `raceRpcs`: a race returns the first answer, and one pruned or lagging
 * node answering `null` would then read as "the transaction does not exist".
 * A node's `null` proves nothing on its own either: a default RPC forgets
 * signatures after about two days, a node on a minority fork has not seen
 * the majority's blocks, and a pool may route each request to another
 * backend. So with `bounds` the same request also asks for two canaries:
 * one that landed before the transaction could, and one from a confirmed
 * block at or after the expiry. The `null` counts only when that response
 * knows both canaries and its head is at or past the last slot the
 * transaction could land in.
 *
 * Takes at most `COVERAGE_PROOF_TIMEOUT_MS + CANARY_CALL_TIMEOUT_MS` for
 * the proof search and `SIGNATURE_LOOKUP_TIMEOUT_MS` for the status
 * request. Never throws.
 */
export async function lookupSignatureStatus(
  client: SDKClient,
  signature: Signature,
  bounds?: LookupBounds
): Promise<SignatureLookup> {
  try {
    const rpcs = await getSolanaRpcs(client)
    const proof = bounds ? await findCoverageProof(rpcs, bounds) : undefined
    const signatures = proof
      ? [signature, proof.historyCanary.signature, proof.headCanary.signature]
      : [signature]
    // Every RPC, also one that timed out in the proof search: it may still
    // return the target.
    const reads = await Promise.allSettled(
      rpcs.map((rpc) =>
        callWithin(
          (abortSignal) =>
            rpc
              .getSignatureStatuses(signatures, {
                searchTransactionHistory: true,
              })
              .send({ abortSignal }),
          SIGNATURE_LOOKUP_TIMEOUT_MS
        )
      )
    )
    return classifyReads(reads, proof)
  } catch (error) {
    // An unexpected fault proves nothing either way.
    return { kind: 'unknown', answered: false, errors: [toError(error)] }
  }
}

function classifyReads(
  reads: PromiseSettledResult<{
    context?: { slot?: unknown }
    value?: unknown
  }>[],
  proof: CoverageProof | undefined
): SignatureLookup {
  let found: SignatureStatus | undefined
  let provenAbsent = false
  let answered = false
  const errors: Error[] = []

  for (const read of reads) {
    if (read.status === 'rejected') {
      errors.push(toError(read.reason))
      continue
    }
    // Unvalidated wire data: only entries of a `value` array are answers.
    // `{ value: null }` responded but said nothing about the signature.
    const statuses = read.value?.value
    if (!Array.isArray(statuses) || statuses.length === 0) {
      errors.push(
        new Error('The signature status response carried no statuses.')
      )
      continue
    }
    const [target, historyCanary, headCanary]: unknown[] = statuses

    if (isStatus(target)) {
      answered = true
      // A lagging RPC may still report `processed` for a confirmed one.
      if (
        !found ||
        (!isConfirmedCommitment(found.confirmationStatus) &&
          isConfirmedCommitment(target.confirmationStatus))
      ) {
        found = target
      }
      continue
    }
    if (target !== null) {
      errors.push(new Error('The signature status response was unusable.'))
      continue
    }
    answered = true

    // A `null` for the target. It proves absence only together with the
    // coverage and head proof from this very response.
    const headSlot = read.value?.context?.slot
    if (!proof) {
      errors.push(
        new Error(
          'This null carries no coverage proof: no canary was asked for.'
        )
      )
    } else if (!isCanaryStatus(historyCanary, proof.historyCanary)) {
      errors.push(
        new Error(
          'This RPC does not cover the signing time: it has no status for the history canary at the slot of its block.'
        )
      )
    } else if (!isCanaryStatus(headCanary, proof.headCanary)) {
      errors.push(
        new Error(
          'This RPC does not know the confirmed block at the head: it has no status for the head canary at the slot of its block.'
        )
      )
    } else if (typeof headSlot !== 'bigint' || headSlot < proof.headSlot) {
      errors.push(
        new Error(
          'This RPC has not reached the last slot the transaction could land in.'
        )
      )
    } else {
      provenAbsent = true
    }
  }

  if (found) {
    return { kind: 'found', status: found }
  }
  if (provenAbsent) {
    return { kind: 'not-found' }
  }
  return { kind: 'unknown', answered, errors }
}

/** Up to `CANARY_SLOT_STEPS` slots from `from` in `direction`, within
 * `[0, last]`. */
function slotsFrom(
  from: bigint,
  direction: 1n | -1n,
  last: bigint = from
): bigint[] {
  const slots: bigint[] = []
  for (let step = 0n; step < BigInt(CANARY_SLOT_STEPS); step += 1n) {
    const slot = from + direction * step
    if (slot < 0n || (direction === 1n && slot > last)) {
      break
    }
    slots.push(slot)
  }
  return slots
}

/**
 * The canaries and the head a `null` has to meet. `undefined` when no RPC
 * reports its current slot, no RPC supplies a canary block, the age is not
 * positive, or the search runs out of time - then no answer can prove
 * absence.
 *
 * - History canary: a block at or before
 *   `lowest current slot - ceil(age / SLOT_DURATION_MS)`, stepping down.
 *   The lowest slot places it: one RPC ahead of the others - or wrong - must
 *   not move it after the anchor.
 * - Head canary: a `confirmed` block at or after `expiredAtSlot`, stepping
 *   up toward the current slot. Without a verdict, the freshest confirmed
 *   block, stepping down from the highest current slot, which is then also
 *   the head.
 */
async function findCoverageProof(
  rpcs: SolanaRpcType[],
  bounds: LookupBounds
): Promise<CoverageProof | undefined> {
  const age = (bounds.now ?? Date.now()) - bounds.anchor
  // A clock before the anchor cannot place the history canary: an age of 0
  // would put it at the current slot, the weakest canary there is.
  if (!Number.isFinite(age) || age <= 0) {
    return undefined
  }

  let outOfTime = false
  const deadline = setTimeout(() => {
    outOfTime = true
  }, COVERAGE_PROOF_TIMEOUT_MS)
  // RPCs that let a call run out of its budget. A rejection does not count:
  // a pruned node rejects an old block but can still supply the head canary.
  const silent = new Set<SolanaRpcType>()

  /** The answers of the RPCs that are not silent, each within its budget. */
  const ask = async <T>(
    call: (rpc: SolanaRpcType, abortSignal: AbortSignal) => Promise<T>
  ): Promise<T[]> => {
    const asked = rpcs.filter((rpc) => !silent.has(rpc))
    const results = await Promise.allSettled(
      asked.map((rpc) =>
        callWithin(
          (abortSignal) => call(rpc, abortSignal),
          CANARY_CALL_TIMEOUT_MS
        )
      )
    )
    const answers: T[] = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        answers.push(result.value)
      } else if (result.reason instanceof CallTimeoutError) {
        silent.add(asked[index])
      }
    })
    return answers
  }

  /** A signature from the first of `slots` whose block any RPC supplies,
   * with the slot of that block. */
  const canaryFrom = async (
    slots: bigint[],
    config: typeof HISTORY_BLOCK_CONFIG | typeof HEAD_BLOCK_CONFIG
  ): Promise<Canary | undefined> => {
    for (const slot of slots) {
      if (outOfTime) {
        return undefined
      }
      const blocks = await ask<unknown>((rpc, abortSignal) =>
        rpc.getBlock(slot, config).send({ abortSignal })
      )
      const signature = firstSignatureOf(blocks)
      if (signature) {
        return { signature, slot }
      }
    }
    return undefined
  }

  try {
    const slots = (
      await ask<unknown>((rpc, abortSignal) =>
        rpc.getSlot({ commitment: 'confirmed' }).send({ abortSignal })
      )
    ).filter((slot): slot is bigint => typeof slot === 'bigint')
    if (slots.length === 0) {
      return undefined
    }
    const lowestSlot = slots.reduce((low, slot) => (slot < low ? slot : low))
    const highestSlot = slots.reduce((high, slot) =>
      slot > high ? slot : high
    )

    const historyCanary = await canaryFrom(
      slotsFrom(lowestSlot - BigInt(Math.ceil(age / SLOT_DURATION_MS)), -1n),
      HISTORY_BLOCK_CONFIG
    )
    if (!historyCanary) {
      return undefined
    }

    const { expiredAtSlot } = bounds
    const headCanary = await canaryFrom(
      expiredAtSlot === undefined
        ? slotsFrom(highestSlot, -1n)
        : slotsFrom(
            expiredAtSlot,
            1n,
            highestSlot > expiredAtSlot ? highestSlot : expiredAtSlot
          ),
      HEAD_BLOCK_CONFIG
    )
    if (!headCanary) {
      return undefined
    }
    return {
      historyCanary,
      headCanary,
      headSlot: expiredAtSlot ?? highestSlot,
    }
  } finally {
    clearTimeout(deadline)
  }
}

/** A signature from the first block that has one. `undefined` for skipped
 * or empty slots, pruned history or an outage. */
function firstSignatureOf(blocks: unknown[]): Signature | undefined {
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) {
      continue
    }
    const { signatures } = block as { signatures?: unknown }
    if (!Array.isArray(signatures)) {
      continue
    }
    const canary = signatures.find(isSignatureEntry)
    if (canary) {
      return canary
    }
  }
  return undefined
}
