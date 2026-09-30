import {
  CLOCK_SKEW_MARGIN_MS,
  isKnownToStatusApi,
  isOldEnoughToDrop,
  type LiFiStepExtended,
  type SDKClient,
} from '@lifi/sdk'
import { callTronRpcsWithRetry } from '../../../rpc/callTronRpcsWithRetry.js'
import { stripHexPrefix } from '../../../utils/stripHexPrefix.js'
import {
  TRON_EXPIRATION_OFFSET_MS,
  TRON_HEAD_MARGIN_MS,
  TRON_LOOKUP_WINDOW_MS,
} from '../../constants.js'

interface LandingWindow {
  /** The earliest time the transaction can land (chain time). */
  earliest: number
  /** The latest time the transaction can land (chain time). */
  latest: number
}

/**
 * True only when the transaction can no longer land and no source knows it
 * (spec 4.2.8):
 * (a) it can no longer land: with a stored transaction, a node's head is past
 *     `raw_data.expiration` (block time, not `Date.now()`, so a wrong local
 *     clock cannot expire it); without one (routes stored before `txHex`),
 *     `isOldEnoughToDrop(signedAt)` on the local clock of the same device;
 * (b) at least one covering node answers "not found" and no node returns the
 *     transaction. A node covers when its head is more than
 *     `TRON_HEAD_MARGIN_MS` past the latest landing time and less than
 *     `TRON_LOOKUP_WINDOW_MS` past the earliest one;
 * (c) the LI.FI status API does not know the hash. It is a veto only: an
 *     unknown hash says nothing.
 *
 * Any lookup error leaves the outcome unknown and returns false. A `0x` prefix
 * on `txHash` is removed first: a node does not find a prefixed txID.
 */
export async function isTronTransactionDropped(
  client: SDKClient,
  step: LiFiStepExtended,
  txHash: string,
  expiration: number | undefined
): Promise<boolean> {
  try {
    const window = getLandingWindow(step, expiration)
    if (!window) {
      return false
    }
    const txId = stripHexPrefix(txHash)
    if ((await lookUpOnTronNodes(client, txId, window)) !== 'not-found') {
      return false
    }
    return !(await isKnownToStatusApi(client, step, txId))
  } catch {
    return false
  }
}

function getLandingWindow(
  step: LiFiStepExtended,
  expiration: number | undefined
): LandingWindow | undefined {
  if (expiration !== undefined) {
    // Chain times carried by the transaction itself. The head condition in
    // `lookUpOnTronNodes` is the expiry verdict (a).
    return {
      earliest: expiration - TRON_EXPIRATION_OFFSET_MS,
      latest: expiration,
    }
  }
  const signedAt = step.execution?.signedAt
  if (signedAt === undefined || !isOldEnoughToDrop(signedAt)) {
    return undefined
  }
  // Local signing time: the ref block was fetched just before signing, so the
  // expiration is at most the signing time + 60 s, give or take the clock skew.
  return {
    earliest: signedAt - CLOCK_SKEW_MARGIN_MS,
    latest: signedAt + CLOCK_SKEW_MARGIN_MS + TRON_EXPIRATION_OFFSET_MS,
  }
}

/**
 * Asks every node. `found` as soon as one returns the transaction;
 * `not-found` when none returns it and at least one covering node answered
 * `{}`; `unknown` otherwise (errors, answers other than `{}` without `id`, or
 * no node covers the window).
 */
async function lookUpOnTronNodes(
  client: SDKClient,
  txId: string,
  window: LandingWindow
): Promise<'found' | 'not-found' | 'unknown'> {
  let coveringNotFound = 0
  try {
    await callTronRpcsWithRetry(client, async (tronWeb) => {
      const block = await tronWeb.trx.getCurrentBlock()
      const head = block.block_header.raw_data.timestamp
      // The full node answers: unlike `getTransactionInfo`, this call does not
      // wait for the solidity node.
      const txInfo: unknown =
        await tronWeb.trx.getUnconfirmedTransactionInfo(txId)
      if (hasId(txInfo)) {
        return
      }
      // The full node answers `{}` for a transaction it has not included.
      // Any other answer (an `{ Error }` body, an empty response) proves
      // nothing and counts as a lookup error.
      if (!isEmptyObject(txInfo)) {
        throw new Error('The node answered neither the transaction nor {}.')
      }
      const covers =
        head > window.latest + TRON_HEAD_MARGIN_MS &&
        head - window.earliest < TRON_LOOKUP_WINDOW_MS
      if (covers) {
        coveringNotFound++
      }
      // Throw so that `callTronRpcsWithRetry` asks the next node as well.
      throw new Error('The node does not return the transaction.')
    })
    return 'found'
  } catch {
    return coveringNotFound > 0 ? 'not-found' : 'unknown'
  }
}

function hasId(txInfo: unknown): boolean {
  return (
    typeof txInfo === 'object' &&
    txInfo !== null &&
    'id' in txInfo &&
    Boolean(txInfo.id)
  )
}

/** Only a plain object without keys: `null` and `[]` do not count. */
function isEmptyObject(txInfo: unknown): boolean {
  return (
    typeof txInfo === 'object' &&
    txInfo !== null &&
    !Array.isArray(txInfo) &&
    Object.keys(txInfo).length === 0
  )
}
