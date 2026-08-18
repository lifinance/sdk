---
'@lifi/sdk-provider-solana': patch
---

Fix false `TransactionExpired` errors on Solana swaps that confirm on-chain.

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
now also throws `RPCError` with `LiFiErrorCode.RpcUnavailable`.

The message on the standard path's `TransactionExpired` error is reworded:
`'Transaction has expired: The block height has exceeded the maximum allowed
limit.'` becomes `'Transaction was not confirmed before the SDK stopped
waiting.'`, describing what actually happened instead of naming a block-height
comparison the code no longer makes. Its `LiFiErrorCode` is unchanged
(`TransactionExpired`). The bundle path's expiry message is new:
`'Bundle was not confirmed before the SDK stopped waiting.'` Neither message
names the blockhash probe, because the wall-clock ceiling can end the wait
without one.

A confirmed Jito bundle no longer fails when an RPC has not indexed its
signatures yet. A bundle is atomic, so a `confirmed` or `finalized` bundle
status means every transaction in it landed; a missing or `null`
`getSignatureStatuses` result is an indexing lag, not a failed transaction. Such
a swap previously threw `TransactionError` with `LiFiErrorCode.TransactionFailed`
and the message `'Bundle confirmation failed: Not all transactions were
confirmed.'` — that message no longer exists.

The transaction signature is now recorded on the action as `txHash` (with
`txLink`) as soon as the wallet signs, instead of only after the confirmation
succeeds. A swap whose confirmation fails therefore reports the signature of the
transaction that may have landed, rather than nothing at all.
