---
'@lifi/sdk-provider-solana': patch
---

Fix false `TransactionExpired` errors on Solana swaps that confirm on-chain.

Confirmation previously stopped polling by comparing `getBlockHeight()` with a
freshly fetched blockhash's `lastValidBlockHeight`. At least one endpoint in the
default RPC set answers `getBlockHeight` with the slot number, which is ~22
million higher, so that comparison was already false on its first evaluation and
the endpoint never polled at all.

Polling now stops when the signed transaction's own blockhash dies, probed via
`isBlockhashValid`, and in any case after a 90 second wall-clock ceiling. The
confirmation path never reads `getBlockHeight`. An RPC that returns no usable
response now raises `RPCError` with `LiFiErrorCode.RpcUnavailable` instead of
being reported as an expired transaction.

The Jito bundle path changes the same way: a bundle that never confirms now
throws `TransactionError` with `LiFiErrorCode.TransactionExpired`, and an
unreachable Jito RPC throws `RPCError` with `LiFiErrorCode.RpcUnavailable`.
Both previously surfaced as a bare `Error`.

A confirmed Jito bundle no longer fails when an RPC has not indexed one of its
signatures yet. A bundle is atomic, so a `confirmed` or `finalized` bundle
status means every transaction in it landed; a `null` entry from
`getSignatureStatuses` is an indexing lag, not a failed transaction. Such a swap
previously reported `LiFiErrorCode.TransactionFailed` despite having landed.

The transaction signature is now recorded on the action as `txHash` (with
`txLink`) as soon as the wallet signs, instead of only after the confirmation
succeeds. A swap whose confirmation fails therefore reports the signature of the
transaction that may have landed, rather than nothing at all.
