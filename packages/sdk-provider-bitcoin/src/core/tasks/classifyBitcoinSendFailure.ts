import type { PublicClient } from '../../client/publicClient.js'

// Bitcoin Core `RPCErrorCode` (src/rpc/protocol.h).
/** `getrawtransaction`: "No such mempool or blockchain transaction". */
const RPC_INVALID_ADDRESS_OR_KEY = -5
/** The bytes do not decode as a transaction. */
const RPC_DESERIALIZATION_ERROR = -22
/** `RPC_TRANSACTION_ERROR`: missing or spent inputs, fee above the maximum. */
const RPC_VERIFY_ERROR = -25
/** `RPC_TRANSACTION_REJECTED`: the mempool refused the transaction. */
const RPC_VERIFY_REJECTED = -26
/** The transaction (or its outputs) is already in the chain. */
const RPC_VERIFY_ALREADY_IN_CHAIN = -27

/** Answers that mean a node already holds the transaction. */
export const ALREADY_SENT_MESSAGES: readonly string[] = [
  'already in block chain',
  'txn-already-known',
  'txn-already-in-mempool',
]

/**
 * Bitcoin Core reject reasons (the message of `RPC_VERIFY_REJECTED`, -26)
 * for consensus and standardness rules: every node refuses these bytes
 * alike, whatever its mempool holds. Together with -22 and -25, a send
 * refused this way is followed by a `getrawtransaction` lookup, and only a
 * -5 answer from every URL clears the transaction data.
 *
 * A wrong entry here costs a new quote whose transaction may spend other
 * UTXOs, so an entry must never depend on one node's mempool.
 */
export const EVERY_NODE_REJECT_REASONS: readonly string[] = [
  'min relay fee not met',
  'dust',
  'scriptpubkey',
  'bare-multisig',
  'tx-size',
  'version',
  'non-final',
  'non-BIP68-final',
  'bad-txns-',
  'mandatory-script-verify-flag-failed',
  'non-mandatory-script-verify-flag',
]

/**
 * Bitcoin Core reject reasons (-26) that depend on one node's mempool. An
 * earlier URL may have accepted the bytes, and a conflict can be another
 * tab's transaction, so the outcome stays unknown. Checked before
 * `EVERY_NODE_REJECT_REASONS`: a message that matches both stays unknown.
 * A wrong entry here costs only a stuck route.
 */
export const MEMPOOL_STATE_REJECT_REASONS: readonly string[] = [
  'mempool min fee not met',
  'mempool full',
  'txn-mempool-conflict',
  'too-long-mempool-chain',
  'insufficient fee',
]

/**
 * - `sent`: a node already holds the transaction.
 * - `refused`: every URL refused the bytes for a reason every node gives
 *   alike; look the txid up before clearing anything.
 * - `unknown`: anything else; the bytes may have reached a node.
 */
export type BitcoinSendFailure = 'sent' | 'refused' | 'unknown'

/** The result of one `getrawtransaction [txid, true]` lookup. */
export type BitcoinLookupResult = 'found' | 'absent' | 'unknown'

interface NodeError {
  code?: number
  /** The node's own text. Never bigmi's `message`, which adds metadata. */
  text: string
}

/**
 * bigmi's `fallback` transport throws `AllTransportsFailedError` with one
 * entry per URL; any other error stands for a single URL.
 */
function errorsPerUrl(error: unknown): unknown[] {
  const errors =
    error && typeof error === 'object'
      ? (error as { errors?: unknown }).errors
      : undefined
  if (!Array.isArray(errors)) {
    return [error]
  }
  return errors.map((entry) =>
    entry && typeof entry === 'object' && 'error' in entry
      ? (entry as { error: unknown }).error
      : entry
  )
}

/** `{ code, message }` from the JSON that a non-2xx answer puts in `details`. */
function parseJsonRpcError(details: string): NodeError | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(details)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined
  }
  const { code, message } = parsed as { code?: unknown; message?: unknown }
  if (typeof code !== 'number' && typeof message !== 'string') {
    return undefined
  }
  return {
    code: typeof code === 'number' ? code : undefined,
    text: typeof message === 'string' ? message : '',
  }
}

/**
 * Reads the RPC code and the node's text from one URL's error, walking the
 * `cause` chain. `RpcRequestError` carries `code` and the node's message in
 * `details`; `HttpRequestError` carries the JSON of the RPC error in
 * `details`. bigmi's `message` ends with "Version: bigmi@…", so it is read
 * only from an error that is not a bigmi error.
 */
function readNodeError(error: unknown): NodeError {
  const seen = new Set<unknown>()
  let current: unknown = error
  let text = ''
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (typeof current === 'string') {
      return { text: text || current }
    }
    if (typeof current !== 'object') {
      break
    }
    const { code, details, message } = current as {
      code?: unknown
      details?: unknown
      message?: unknown
    }
    const fromJson =
      typeof details === 'string' ? parseJsonRpcError(details) : undefined
    if (fromJson) {
      return fromJson
    }
    const ownText =
      typeof details === 'string'
        ? details
        : typeof message === 'string' && !('shortMessage' in current)
          ? message
          : ''
    if (typeof code === 'number') {
      return { code, text: ownText }
    }
    text = text || ownText
    current = (current as { cause?: unknown }).cause
  }
  return { text }
}

const includesAny = (text: string, reasons: readonly string[]): boolean =>
  reasons.some((reason) => text.includes(reason.toLowerCase()))

function classifyNodeError({ code, text }: NodeError): BitcoinSendFailure {
  const lowerText = text.toLowerCase()
  if (
    code === RPC_VERIFY_ALREADY_IN_CHAIN ||
    includesAny(lowerText, ALREADY_SENT_MESSAGES)
  ) {
    return 'sent'
  }
  if (code === RPC_DESERIALIZATION_ERROR || code === RPC_VERIFY_ERROR) {
    return 'refused'
  }
  if (
    code === RPC_VERIFY_REJECTED &&
    !includesAny(lowerText, MEMPOOL_STATE_REJECT_REASONS) &&
    includesAny(lowerText, EVERY_NODE_REJECT_REASONS)
  ) {
    return 'refused'
  }
  return 'unknown'
}

/**
 * Classifies a failed first-run `sendrawtransaction`. Any URL that already
 * holds the transaction makes it `sent`. It is `refused` only when every URL
 * refused it for a reason every node gives alike; any other answer, a
 * timeout included, keeps it `unknown`. Never throws.
 */
export function classifyBitcoinSendFailure(error: unknown): BitcoinSendFailure {
  const outcomes = errorsPerUrl(error).map((urlError) =>
    classifyNodeError(readNodeError(urlError))
  )
  if (outcomes.includes('sent')) {
    return 'sent'
  }
  return outcomes.length > 0 &&
    outcomes.every((outcome) => outcome === 'refused')
    ? 'refused'
    : 'unknown'
}

/**
 * True only when every URL answered `getrawtransaction` with -5. bigmi's
 * `getUTXOTransaction` maps every error, a timeout included, to
 * `TransactionNotFoundError`, which proves nothing. Never throws.
 */
export function isBitcoinTransactionAbsent(error: unknown): boolean {
  const errors = errorsPerUrl(error)
  return (
    errors.length > 0 &&
    errors.every(
      (urlError) => readNodeError(urlError).code === RPC_INVALID_ADDRESS_OR_KEY
    )
  )
}

/**
 * Looks the txid up once with `getrawtransaction [txid, true]`, directly
 * and not through `getUTXOTransaction`, so that the RPC code stays readable.
 */
export async function lookUpBitcoinTransaction(
  publicClient: PublicClient,
  txHash: string
): Promise<BitcoinLookupResult> {
  try {
    const transaction: unknown = await publicClient.request({
      method: 'getrawtransaction',
      params: [txHash, true],
    })
    return transaction && typeof transaction === 'object' ? 'found' : 'unknown'
  } catch (error) {
    return isBitcoinTransactionAbsent(error) ? 'absent' : 'unknown'
  }
}
