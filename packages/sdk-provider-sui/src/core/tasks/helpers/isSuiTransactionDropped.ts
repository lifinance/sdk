import {
  CLOCK_SKEW_MARGIN_MS,
  isKnownToStatusApi,
  type LiFiStepExtended,
  MAX_RESEND_AGE_MS,
  type SDKClient,
} from '@lifi/sdk'
import { GrpcStatusCode, GrpcTypes, type SuiGrpcClient } from '@mysten/sui/grpc'
import { callSuiWithRetry } from '../../../client/suiClient.js'
import {
  SUI_CANARY_TIP_OFFSET,
  SUI_HEAD_MARGIN_MS,
  SUI_LOOKUP_TIMEOUT_MS,
  SUI_MIN_CHECKPOINT_INTERVAL_MS,
} from '../../constants.js'
import { callWithinDeadline } from './callWithinDeadline.js'

// A canary search skips at most this many checkpoints without a user
// transaction.
const MAX_SKIPPED_CHECKPOINTS = 10

// The kind of a user transaction. System transactions (the consensus commit
// prologue, randomness updates, programmable system transactions, epoch
// changes) have other kinds.
const PROGRAMMABLE_TRANSACTION =
  GrpcTypes.TransactionKind_Kind.PROGRAMMABLE_TRANSACTION

interface CheckpointInfo {
  sequenceNumber: bigint
  timestampMs: number
  /**
   * The digest of the last user transaction of the checkpoint, the last one
   * whose kind is `PROGRAMMABLE_TRANSACTION`. A transaction without a kind
   * does not count.
   */
  userTransactionDigest?: string
}

interface Canaries {
  /** Landed before the earliest landing time. */
  before: string
  /** Landed after the latest landing time + margin. */
  after: string
}

/**
 * True only when the digest can no longer land and no source knows it (see
 * the resume rules in `transactionState.ts`):
 * (a) the resend age cap has passed, so the SDK never sends the bytes again.
 *     An unknown signing time never drops, and nor does one in the future:
 *     a refused resend does not mean that the cap passed;
 * (b) a node answers "not found" for the digest in the same
 *     `BatchGetTransactions` response that finds one canary user transaction
 *     from before the earliest landing time and one from after the latest
 *     landing time + margin, and no node returns the digest. The canaries
 *     prove that this very response covers the whole landing window; a
 *     separate coverage request can reach another backend of a load-balanced
 *     RPC;
 * (c) the LI.FI status API does not know the digest (veto only).
 *
 * Any lookup error leaves the outcome unknown and returns false. Each call
 * to a node has `SUI_LOOKUP_TIMEOUT_MS` to answer; a node that does not
 * counts as failed, so the next node is asked.
 */
export async function isSuiTransactionDropped(
  client: SDKClient,
  step: LiFiStepExtended,
  digest: string
): Promise<boolean> {
  const signedAt = step.execution?.signedAt
  if (signedAt === undefined || Date.now() - signedAt < MAX_RESEND_AGE_MS) {
    return false
  }
  try {
    // `signedAt` is the local clock; the skew margin widens the window on
    // both sides.
    const earliest = signedAt - CLOCK_SKEW_MARGIN_MS
    const latest =
      signedAt + MAX_RESEND_AGE_MS + CLOCK_SKEW_MARGIN_MS + SUI_HEAD_MARGIN_MS
    // `findCanaries` throws when a node cannot supply them, so that
    // `callSuiWithRetry` asks the next node.
    const canaries = await callSuiWithRetry(client, (suiClient) =>
      findCanaries(suiClient, earliest, latest)
    )
    if ((await lookUpWithCanaries(client, digest, canaries)) !== 'not-found') {
      return false
    }
    return !(await isKnownToStatusApi(client, step, digest))
  } catch {
    return false
  }
}

/**
 * Any node may supply the canaries; the proof is in the lookup response.
 * Throws when this node cannot supply them.
 */
async function findCanaries(
  suiClient: SuiGrpcClient,
  earliest: number,
  latest: number
): Promise<Canaries> {
  const tip = await getCheckpoint(suiClient)
  if (tip.timestampMs <= latest) {
    throw new Error('The chain is not yet past the latest landing time.')
  }

  // Prefer a checkpoint behind the tip; the search moves toward the tip.
  let afterStart = await getCheckpoint(
    suiClient,
    tip.sequenceNumber > SUI_CANARY_TIP_OFFSET
      ? tip.sequenceNumber - SUI_CANARY_TIP_OFFSET
      : 0n
  )
  if (afterStart.timestampMs <= latest) {
    afterStart = tip
  }
  const after = await findUserTransaction(
    suiClient,
    afterStart,
    1n,
    (checkpoint) =>
      checkpoint.timestampMs > latest &&
      checkpoint.sequenceNumber <= tip.sequenceNumber
  )

  const before = await findUserTransaction(
    suiClient,
    await findCheckpointBefore(suiClient, tip, earliest),
    -1n,
    (checkpoint) => checkpoint.timestampMs < earliest
  )
  return { before, after }
}

/** A checkpoint older than `earliest`. Throws if none is found. */
async function findCheckpointBefore(
  suiClient: SuiGrpcClient,
  tip: CheckpointInfo,
  earliest: number
): Promise<CheckpointInfo> {
  // Estimated with the shortest interval, the guess lands at or before
  // `earliest`; step further back if the interval was even shorter.
  let distance = BigInt(
    Math.ceil((tip.timestampMs - earliest) / SUI_MIN_CHECKPOINT_INTERVAL_MS)
  )
  for (let attempt = 0; attempt < 3; attempt++) {
    const sequenceNumber =
      tip.sequenceNumber > distance ? tip.sequenceNumber - distance : 0n
    const checkpoint = await getCheckpoint(suiClient, sequenceNumber)
    if (checkpoint.timestampMs < earliest) {
      return checkpoint
    }
    if (sequenceNumber === 0n) {
      throw new Error('The chain starts after the earliest landing time.')
    }
    distance *= 2n
  }
  throw new Error('No checkpoint before the earliest landing time was found.')
}

/**
 * From `start`, steps one checkpoint at a time in `direction` over
 * checkpoints without a user transaction, and returns the first user
 * transaction digest. Every checkpoint on the way must be `inRange`.
 */
async function findUserTransaction(
  suiClient: SuiGrpcClient,
  start: CheckpointInfo,
  direction: bigint,
  inRange: (checkpoint: CheckpointInfo) => boolean
): Promise<string> {
  let checkpoint = start
  for (let skipped = 0; inRange(checkpoint); skipped++) {
    if (checkpoint.userTransactionDigest) {
      return checkpoint.userTransactionDigest
    }
    const next = checkpoint.sequenceNumber + direction
    if (skipped === MAX_SKIPPED_CHECKPOINTS || next < 0n) {
      break
    }
    checkpoint = await getCheckpoint(suiClient, next)
  }
  throw new Error('No checkpoint in range holds a user transaction.')
}

/**
 * The latest checkpoint without `sequenceNumber`. Throws when the sequence
 * number or the timestamp is missing.
 */
async function getCheckpoint(
  suiClient: SuiGrpcClient,
  sequenceNumber?: bigint
): Promise<CheckpointInfo> {
  const { response } = await callWithinDeadline(
    (abort) =>
      suiClient.ledgerService.getCheckpoint(
        {
          checkpointId:
            sequenceNumber === undefined
              ? { oneofKind: undefined }
              : { oneofKind: 'sequenceNumber', sequenceNumber },
          readMask: {
            paths: [
              'sequence_number',
              'summary.timestamp',
              'transactions.digest',
              'transactions.transaction.kind',
            ],
          },
        },
        { abort }
      ),
    SUI_LOOKUP_TIMEOUT_MS
  )
  const checkpoint = response.checkpoint
  const timestamp = checkpoint?.summary?.timestamp
  const timestampMs = timestamp
    ? Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1e6)
    : 0
  // A zero timestamp is the protobuf default, so it counts as missing.
  if (checkpoint?.sequenceNumber === undefined || timestampMs <= 0) {
    throw new Error('The checkpoint has no sequence number or timestamp.')
  }
  return {
    sequenceNumber: checkpoint.sequenceNumber,
    timestampMs,
    userTransactionDigest: checkpoint.transactions.findLast(
      ({ transaction }) => transaction?.kind?.kind === PROGRAMMABLE_TRANSACTION
    )?.digest,
  }
}

/**
 * Asks every node with one batch request each. `found` as soon as one returns
 * the digest; `not-found` when none returns it and at least one response
 * finds both canaries but not the digest; `unknown` otherwise.
 */
async function lookUpWithCanaries(
  client: SDKClient,
  digest: string,
  canaries: Canaries
): Promise<'found' | 'not-found' | 'unknown'> {
  let coveringNotFound = 0
  try {
    await callSuiWithRetry(client, async (suiClient) => {
      const { response } = await callWithinDeadline(
        (abort) =>
          suiClient.ledgerService.batchGetTransactions(
            {
              digests: [digest, canaries.before, canaries.after],
              readMask: { paths: ['digest'] },
            },
            { abort }
          ),
        SUI_LOOKUP_TIMEOUT_MS
      )
      const [target, before, after] = response.transactions
      // A node that returns the digest vetoes, in any position.
      if (
        target?.result.oneofKind === 'transaction' ||
        response.transactions.some(
          ({ result }) =>
            result.oneofKind === 'transaction' &&
            result.transaction.digest === digest
        )
      ) {
        return
      }
      // Each canary must sit at its own request position: then the result at
      // the target position belongs to the target, even if a node ever
      // breaks the request order.
      const covers =
        response.transactions.length === 3 &&
        before?.result.oneofKind === 'transaction' &&
        before.result.transaction.digest === canaries.before &&
        after?.result.oneofKind === 'transaction' &&
        after.result.transaction.digest === canaries.after
      const notFound =
        target?.result.oneofKind === 'error' &&
        target.result.error.code === GrpcStatusCode.NOT_FOUND
      if (covers && notFound) {
        coveringNotFound++
      }
      // Throw so that `callSuiWithRetry` asks the next node as well.
      throw new Error('The node does not return the transaction.')
    })
    return 'found'
  } catch {
    return coveringNotFound > 0 ? 'not-found' : 'unknown'
  }
}
