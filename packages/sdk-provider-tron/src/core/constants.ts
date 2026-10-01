export const TRON_POLL_INTERVAL_MS = 3000
// Maximum number of poll attempts before the confirmation wait times out.
// At TRON_POLL_INTERVAL_MS=3000 this caps total wait at ~2 minutes.
export const TRON_POLL_MAX_POLLS = 40
// Maximum tolerated RPC errors during confirmation polling before bailing.
export const TRON_POLL_MAX_ERROR_RETRIES = 5

// Max tokens per aggregate3 multicall — avoids Tron node CPU timeouts on large lists.
export const DEFAULT_MULTICALL_BATCH_SIZE = 50

// `getCurrentRefBlockParams` sets `raw_data.expiration` to the ref block time
// + 60 s. The ref block time is the earliest time the transaction can land.
export const TRON_EXPIRATION_OFFSET_MS = 60_000
// A node's "not found" counts only while its head is less than this past the
// earliest landing time: every node type keeps at least this much history
// (lite fullnodes keep 65,536 blocks, about 54 h). Tron has no call that
// proves coverage in the lookup response itself.
export const TRON_LOOKUP_WINDOW_MS: number = 24 * 60 * 60 * 1000
// A node's "not found" also needs its head this far past the latest landing
// time: more than a healthy node lags behind the chain.
export const TRON_HEAD_MARGIN_MS: number = 5 * 60_000
