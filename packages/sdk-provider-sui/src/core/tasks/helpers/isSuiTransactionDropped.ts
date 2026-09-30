import {
  CLOCK_SKEW_MARGIN_MS,
  isKnownToStatusApi,
  isResendAllowed,
  type LiFiStepExtended,
  MAX_RESEND_AGE_MS,
  type SDKClient,
} from '@lifi/sdk'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { callSuiWithRetry } from '../../../client/suiClient.js'
import {
  SUI_CANARY_TIP_OFFSET,
  SUI_HEAD_MARGIN_MS,
  SUI_MIN_CHECKPOINT_INTERVAL_MS,
} from '../../constants.js'

// `google.rpc.Code.NOT_FOUND` in a per-digest `GetTransactionResult` error.
const GRPC_NOT_FOUND = 5

interface CheckpointCanary {
  sequenceNumber: bigint
  timestampMs: number
  /** A transaction digest from this checkpoint. */
  transactionDigest: string
}

interface Canaries {
  /** Landed before the earliest landing time. */
  before: string
  /** Landed after the latest landing time + margin. */
  after: string
}

/**
 * True only when the digest can no longer land and no source knows it
 * (spec 4.2.8):
 * (a) the resend age cap has passed, so the SDK never sends the bytes again.
 *     An unknown signing time never drops;
 * (b) a node answers "not found" for the digest in the same
 *     `BatchGetTransactions` response that finds one canary transaction from
 *     before the earliest landing time and one from after the latest landing
 *     time + margin, and no node returns the digest. The canaries prove that
 *     this very response covers the whole landing window; a separate coverage
 *     request can reach another backend of a load-balanced RPC;
 * (c) the LI.FI status API does not know the digest (veto only).
 *
 * Any lookup error leaves the outcome unknown and returns false.
 */
export async function isSuiTransactionDropped(
  client: SDKClient,
  step: LiFiStepExtended,
  digest: string
): Promise<boolean> {
  const signedAt = step.execution?.signedAt
  if (signedAt === undefined || isResendAllowed(signedAt)) {
    return false
  }
  try {
    // `signedAt` is the local clock; the skew margin widens the window on
    // both sides.
    const earliest = signedAt - CLOCK_SKEW_MARGIN_MS
    const latest =
      signedAt + MAX_RESEND_AGE_MS + CLOCK_SKEW_MARGIN_MS + SUI_HEAD_MARGIN_MS
    const canaries = await callSuiWithRetry(client, (suiClient) =>
      findCanaries(suiClient, earliest, latest)
    )
    if (!canaries) {
      return false
    }
    if ((await lookUpWithCanaries(client, digest, canaries)) !== 'not-found') {
      return false
    }
    return !(await isKnownToStatusApi(client, step, digest))
  } catch {
    return false
  }
}

/** Any node may supply the canaries; the proof is in the lookup response. */
async function findCanaries(
  suiClient: SuiGrpcClient,
  earliest: number,
  latest: number
): Promise<Canaries | undefined> {
  const tip = await getCheckpoint(suiClient)
  if (!tip || tip.timestampMs <= latest) {
    // The chain is not yet past the latest landing time.
    return undefined
  }

  let after = await getCheckpoint(
    suiClient,
    tip.sequenceNumber > SUI_CANARY_TIP_OFFSET
      ? tip.sequenceNumber - SUI_CANARY_TIP_OFFSET
      : 0n
  )
  if (!after || after.timestampMs <= latest) {
    after = tip
  }

  // Estimated with the shortest interval, the guess lands at or before
  // `earliest`; step further back if the interval was even shorter.
  let distance = BigInt(
    Math.ceil((tip.timestampMs - earliest) / SUI_MIN_CHECKPOINT_INTERVAL_MS)
  )
  for (let attempt = 0; attempt < 3; attempt++) {
    const sequenceNumber =
      tip.sequenceNumber > distance ? tip.sequenceNumber - distance : 0n
    const before = await getCheckpoint(suiClient, sequenceNumber)
    if (before && before.timestampMs < earliest) {
      return {
        before: before.transactionDigest,
        after: after.transactionDigest,
      }
    }
    if (sequenceNumber === 0n) {
      return undefined
    }
    distance *= 2n
  }
  return undefined
}

/** The latest checkpoint without `sequenceNumber`. */
async function getCheckpoint(
  suiClient: SuiGrpcClient,
  sequenceNumber?: bigint
): Promise<CheckpointCanary | undefined> {
  const { response } = await suiClient.ledgerService.getCheckpoint({
    checkpointId:
      sequenceNumber === undefined
        ? { oneofKind: undefined }
        : { oneofKind: 'sequenceNumber', sequenceNumber },
    readMask: {
      paths: ['sequence_number', 'summary.timestamp', 'transactions.digest'],
    },
  })
  const checkpoint = response.checkpoint
  const timestamp = checkpoint?.summary?.timestamp
  const transactionDigest = checkpoint?.transactions[0]?.digest
  if (
    checkpoint?.sequenceNumber === undefined ||
    !timestamp ||
    !transactionDigest
  ) {
    return undefined
  }
  return {
    sequenceNumber: checkpoint.sequenceNumber,
    timestampMs:
      Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1e6),
    transactionDigest,
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
      const { response } = await suiClient.ledgerService.batchGetTransactions({
        digests: [digest, canaries.before, canaries.after],
        readMask: { paths: ['digest'] },
      })
      const [target, before, after] = response.transactions
      if (target?.result.oneofKind === 'transaction') {
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
        target.result.error.code === GRPC_NOT_FOUND
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
