---
'@lifi/sdk-provider-solana': minor
---

Fix false `TransactionExpired` errors on Solana swaps that confirm on-chain.

This is a minor release rather than a patch: no exported signature changes
and nothing breaks at import time, but the error classification integrators
branch on changes. The transitions, old → new (`LiFiErrorCode` values in
parentheses — `SDKError.code` carries them):

- Standard path, no configured RPC returned a usable response:
  `TransactionError` with `TransactionExpired` (1018) → `RPCError` with
  `RpcUnavailable` (1027).
- Jito path, bundle never confirmed: `UnknownError` with `InternalError`
  (1000) → `TransactionError` with `TransactionExpired` (1018).
- Jito path, every configured Jito RPC failed: `UnknownError` with
  `InternalError` (1000) → `RPCError` with `RpcUnavailable` (1027).
- Jito path, no configured RPC supports Jito bundle methods: `UnknownError`
  with `InternalError` (1000) → `RPCError` with `RpcUnavailable` (1027).
- Jito path, confirmed bundle whose signatures an RPC had not indexed yet:
  `TransactionError` with `TransactionFailed` (1003) → success.
- Jito path, confirmed bundle whose status carries no `transactions` list:
  `UnknownError` with `InternalError` (1000) → success.

Confirmation previously stopped polling by comparing `getBlockHeight()` with a
freshly fetched blockhash's `lastValidBlockHeight`. At least one endpoint in the
default RPC set answers `getBlockHeight` with the slot number, which is ~22
million higher, so that comparison was already false on its first evaluation and
the endpoint never polled at all. Every swap then depended on the remaining
endpoint alone, and failed whenever that endpoint throttled.

Polling now stops when the signed transaction's own blockhash dies, probed via
`isBlockhashValid`, and in any case after a 90 second wall-clock ceiling. The
confirmation path never reads `getBlockHeight`. When no configured RPC returns a
usable response, the SDK now raises `RPCError` with
`LiFiErrorCode.RpcUnavailable` instead of reporting an expired transaction; as
long as at least one RPC still answers, its verdict decides between confirmation
and `TransactionExpired`.

The Jito bundle path changes the same way: a bundle that never confirms now
throws `TransactionError` with `LiFiErrorCode.TransactionExpired`, and an
unreachable Jito RPC throws `RPCError` with `LiFiErrorCode.RpcUnavailable`.
Both previously surfaced as a bare
`Error('Failed to send and confirm bundle')`, which the error parser delivered
to integrators as `UnknownError` with `LiFiErrorCode.InternalError`. An empty
Jito RPC list — previously a bare
`Error('No Jito-enabled RPC connection available for bundle submission')` —
now also throws `RPCError` with `LiFiErrorCode.RpcUnavailable`. Its message
distinguishes the two ways the list can be empty. When every configured
endpoint answered the capability probe by reporting the method as unknown, it
names the configuration gap: none of the configured Solana RPCs supports Jito
bundle methods (the default LI.FI set does not), and a Jito-capable endpoint
must be supplied via the `rpcUrls` client config option. When endpoints failed
the probe without saying the method was unknown — a throttle, a timeout, a
gateway error — it names an outage and says to retry instead, because telling
an integrator to configure an `rpcUrls` entry they already configured sends
them after the wrong problem. The outage case — every configured Jito RPC failed — keeps its own
message and chains the per-endpoint errors as the error's `cause`.

The message on the standard path's `TransactionExpired` error is reworded:
`'Transaction has expired: The block height has exceeded the maximum allowed
limit.'` becomes `'Transaction was not confirmed before the SDK stopped
waiting.'`, describing what actually happened instead of naming a block-height
comparison the code no longer makes. Its `LiFiErrorCode` is unchanged
(`TransactionExpired`). The bundle path's expiry message is new:
`'Bundle was not confirmed before the SDK stopped waiting.'` Neither message
names the blockhash probe, because the wall-clock ceiling can end the wait
without one. When other RPC branches died while the deciding branch polled to
its deadline, their errors are chained as the expiry error's `cause` (an
`AggregateError`). That trail is reachable from the error `executeRoute`
throws, at `SDKError.cause.cause`; it does not reach `action.error`, which
carries only `message` and `code`.

A confirmed Jito bundle no longer fails when an RPC has not indexed its
signatures yet, nor when the confirming status omits its `transactions` list
altogether — that list is unvalidated wire data, and reading it unguarded made
a landed bundle fail on a `TypeError`. A bundle is atomic, so a `confirmed` or `finalized` bundle
status means every transaction in it landed; a missing or `null`
`getSignatureStatuses` result is an indexing lag, not a failed transaction. Such
a swap previously threw `TransactionError` with `LiFiErrorCode.TransactionFailed`
and the message `'Bundle confirmation failed: Not all transactions were
confirmed.'` — that message no longer exists. The bundle-level `err` field of
the confirming `getBundleStatuses` response is now read as well: an explicit
`Err` payload there throws `TransactionError` with
`LiFiErrorCode.TransactionFailed` even when the per-signature statuses are
unavailable.

The transaction signature is now recorded on the action as `txHash` as soon as
the wallet signs, instead of only after the confirmation succeeds. A swap whose
confirmation fails therefore reports the signature of the transaction that may
have landed, rather than nothing at all. The explorer link (`txLink`) is
written later, the moment the first RPC accepts the send: a link recorded at
signing time would point at a transaction that a failed simulation — or the
empty-Jito-RPC-list case, which never submits — leaves nonexistent on chain.
An `updateRouteHook` that throws while handling that write no longer fails the
step: the callback runs after the network accepted the send, so a throw there
would report a transaction that may have landed as an RPC outage. It is
contained, and the next accepted send re-attempts the write.

For integrators:

- Routes the backend builds as Jito bundles need a Jito-capable Solana RPC.
  The default LI.FI set has none, so supply one via the `rpcUrls` client
  config option; for `ChainId.SOL`, URLs supplied there replace the defaults
  rather than merging with them. Without one, such a route now fails before
  submission with `RpcUnavailable` (1027).
- The confirmation wait is now hard-bounded: polling stops at the 90 second
  ceiling and every RPC branch is aborted 5 seconds later, so a timeout
  wrapped around step execution should allow at least ~95 seconds for the
  confirmation phase.
