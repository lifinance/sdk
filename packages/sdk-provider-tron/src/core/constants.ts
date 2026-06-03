export const TRON_POLL_INTERVAL_MS = 3000
// Maximum number of poll attempts before the confirmation wait times out.
// At TRON_POLL_INTERVAL_MS=3000 this caps total wait at ~2 minutes.
export const TRON_POLL_MAX_POLLS = 40
// Maximum tolerated RPC errors during confirmation polling before bailing.
export const TRON_POLL_MAX_ERROR_RETRIES = 5

// Max tokens per aggregate3 multicall — avoids Tron node CPU timeouts on large lists.
export const DEFAULT_MULTICALL_BATCH_SIZE = 50
