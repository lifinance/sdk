import type { SDKClient } from '@lifi/sdk'
import { isSignature, type Signature } from '@solana/kit'
import {
  isConfirmedCommitment,
  type SignatureStatus,
} from '../confirmation/types.js'
import { getSolanaRpcs } from '../rpc/registry.js'
import type { SolanaRpcType } from '../rpc/types.js'

/** Bound on the whole lookup. A hung endpoint would otherwise hold the
 * `allSettled` calls below - and the wait task with them - open for good. */
export const SIGNATURE_LOOKUP_TIMEOUT_MS = 15_000
/** Target slot time. Real slots are rarely faster, so `ceil(age / 400)`
 * slots back reach at or before the anchor; the anchor's clock-skew margin
 * absorbs the rest. */
export const SLOT_DURATION_MS = 400
/** How far the canary search steps down over skipped or empty slots. */
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
   * outage - from RPCs that answered without proof. */
  | { kind: 'unknown'; answered: boolean; errors: Error[] }

/** What makes one RPC's `null` count as absence. */
type CoverageProof = {
  /** A landed signature from before the anchor. */
  canary: Signature
  /** The slot the answering node's head has to reach. */
  headSlot: bigint
}

const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

/**
 * Looks a signature up on every Solana RPC, the transaction history
 * included.
 *
 * Not `raceRpcs`: a race returns the first answer, and one pruned or lagging
 * node answering `null` would then read as "the transaction does not exist".
 * A node's `null` proves nothing on its own either: a default RPC forgets
 * signatures after about two days, and a pool may route each request to
 * another backend. So with `bounds` the same request also asks for a canary
 * - a signature that landed before the transaction could - and the `null`
 * counts only when that response knows the canary and its head is past the
 * last slot the transaction could land in (spec 4.2.8).
 *
 * Never throws.
 */
export async function lookupSignatureStatus(
  client: SDKClient,
  signature: Signature,
  bounds?: LookupBounds
): Promise<SignatureLookup> {
  let rpcs: SolanaRpcType[]
  try {
    rpcs = await getSolanaRpcs(client)
  } catch (error) {
    return { kind: 'unknown', answered: false, errors: [toError(error)] }
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(
          `The signature lookup did not finish within ${SIGNATURE_LOOKUP_TIMEOUT_MS}ms.`
        )
      ),
    SIGNATURE_LOOKUP_TIMEOUT_MS
  )
  try {
    const proof = bounds
      ? await findCoverageProof(rpcs, bounds, controller.signal)
      : undefined
    const reads = await Promise.allSettled(
      rpcs.map((rpc) =>
        rpc
          .getSignatureStatuses(
            proof ? [signature, proof.canary] : [signature],
            {
              searchTransactionHistory: true,
            }
          )
          .send({ abortSignal: controller.signal })
      )
    )
    return classifyReads(reads, proof)
  } finally {
    clearTimeout(timer)
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
    answered = true
    const [target, canary] = statuses as (SignatureStatus | null)[]

    if (target) {
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

    // A `null` for the target. It proves absence only together with the
    // coverage and head proof from this very response.
    const headSlot = read.value?.context?.slot
    if (!proof) {
      errors.push(
        new Error(
          'This null carries no coverage proof: no canary was asked for.'
        )
      )
    } else if (!canary) {
      errors.push(
        new Error(
          'This RPC does not cover the signing time: it has no status for the canary.'
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

/**
 * The canary and the head a `null` has to meet. `undefined` when no RPC
 * reports its current slot or no RPC still has a block near the anchor -
 * then no answer can prove absence. The canary block is at or before
 * `lowest current slot - ceil(age / SLOT_DURATION_MS)`.
 */
async function findCoverageProof(
  rpcs: SolanaRpcType[],
  bounds: LookupBounds,
  signal: AbortSignal
): Promise<CoverageProof | undefined> {
  const slots = await Promise.allSettled(
    rpcs.map((rpc) =>
      rpc.getSlot({ commitment: 'confirmed' }).send({ abortSignal: signal })
    )
  )
  // The lowest confirmed slot places the canary block: one RPC ahead of the
  // others - or wrong - must not move the canary after the anchor. The
  // highest one is the head only without an expiry verdict.
  let lowestSlot: bigint | undefined
  let highestSlot: bigint | undefined
  for (const slot of slots) {
    if (slot.status !== 'fulfilled' || typeof slot.value !== 'bigint') {
      continue
    }
    if (lowestSlot === undefined || slot.value < lowestSlot) {
      lowestSlot = slot.value
    }
    if (highestSlot === undefined || slot.value > highestSlot) {
      highestSlot = slot.value
    }
  }
  if (lowestSlot === undefined || highestSlot === undefined) {
    return undefined
  }

  const age = Math.max(0, (bounds.now ?? Date.now()) - bounds.anchor)
  const bound = lowestSlot - BigInt(Math.ceil(age / SLOT_DURATION_MS))
  for (let step = 0n; step < BigInt(CANARY_SLOT_STEPS); step += 1n) {
    const slot = bound - step
    if (slot < 0n) {
      break
    }
    const canary = await firstSignatureOfBlock(rpcs, slot, signal)
    if (canary) {
      return { canary, headSlot: bounds.expiredAtSlot ?? highestSlot }
    }
  }
  return undefined
}

/** A signature from the block at `slot`, from whichever RPC still has it.
 * `undefined` for a skipped or empty slot, pruned history or an outage. */
async function firstSignatureOfBlock(
  rpcs: SolanaRpcType[],
  slot: bigint,
  signal: AbortSignal
): Promise<Signature | undefined> {
  const blocks = await Promise.allSettled(
    rpcs.map((rpc) =>
      rpc
        .getBlock(slot, {
          transactionDetails: 'signatures',
          rewards: false,
          maxSupportedTransactionVersion: 0,
        })
        .send({ abortSignal: signal })
    )
  )
  for (const block of blocks) {
    if (block.status !== 'fulfilled' || !block.value) {
      continue
    }
    const signatures: unknown = block.value.signatures
    if (!Array.isArray(signatures)) {
      continue
    }
    for (const entry of signatures) {
      if (typeof entry === 'string' && isSignature(entry)) {
        return entry
      }
    }
  }
  return undefined
}
