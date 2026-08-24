---
'@lifi/sdk-provider-solana': minor
---

Fix false `TransactionExpired` errors on Solana swaps that confirmed on-chain.

Confirmation stopped polling by comparing `getBlockHeight()` against a freshly
fetched blockhash's `lastValidBlockHeight`. At least one endpoint in the
default RPC set answers `getBlockHeight` with the slot number (~22M higher), so
that comparison was false on its first evaluation and the endpoint never polled
at all. Every swap then depended on the remaining endpoint alone.

Polling now stops when the signed transaction's own blockhash dies, probed via
`isBlockhashValid`, and in any case after a 90 second ceiling. `getBlockHeight`
is never read. The wait is hard-bounded: branches abort 5 seconds after the
ceiling, so allow ~95 seconds for the confirmation phase. A branch also gives up
early once its endpoint has gone 30 seconds without answering a status read,
which is long enough to ride out a throttling window rather than end the swap
inside one.

Minor rather than patch: no exported signature changes, but the error
classification integrators branch on does. Transitions, old → new:

- Standard path, no RPC returned a usable response: `TransactionError`
  `TransactionExpired` (1018) → `RPCError` `RpcUnavailable` (1027).
- Jito path, bundle never confirmed: `UnknownError` `InternalError` (1000) →
  `TransactionError` `TransactionExpired` (1018).
- Jito path, every Jito RPC failed: `UnknownError` (1000) → `RPCError` (1027).
- Jito path, no RPC supports bundle methods: `UnknownError` (1000) → `RPCError`
  (1027).
- Jito path, confirmed bundle whose signatures an RPC had not indexed yet:
  `TransactionError` `TransactionFailed` (1003) → success.
- Jito path, confirmed bundle whose status omits `transactions`:
  `UnknownError` (1000) → success.
- Either path, a signed transaction carrying no fee payer signature: raw
  `SolanaError` → `TransactionError` `TransactionUnprepared` (1002). Both wait
  tasks read the signature before they submit, so this throw now stays inside
  the `LiFiErrorCode` contract instead of reaching integrator error branching
  as an unclassified error.

A confirmed Jito bundle no longer fails on missing per-signature data. A bundle
is atomic, so a `confirmed` status means every transaction in it landed; a
`null` or absent `getSignatureStatuses` result is indexing lag, not failure.
The bundle-level `err` is now read as well.

`txHash` and `txLink` are both recorded when the first RPC accepts the send,
rather than only after confirmation. A swap that broadcast and then failed to
confirm now reports its signature, so it can be looked up on chain. Neither is
written at signing time: a signed-but-unsent signature resolves to `null` on
every explorer, and simulation, a send failure, or a bundle route with no
Jito-capable RPC all sit between signing and the first broadcast. Signing does
clear both fields, so a route resumed from storage no longer reports the previous
run's signature - including when decoding the signed transaction fails, since
the clearing write now precedes the decode. A throwing `updateRouteHook` no
longer fails the step from the broadcast callback, and no longer changes which
error a failed confirmation reports. The action writes that follow a verdict
are not guarded: a hook that throws there still fails the step, as before.

Jito capability is probed once per endpoint and cached, rather than re-probed
before every bundle submission, and concurrent submissions now share one probe
per URL instead of each firing their own. Each cached answer carries its own
retry window. An endpoint that names the method unknown over JSON-RPC is
believed permanently; a bare HTTP 401 or 403 is not, because it never reached
the JSON-RPC layer and cannot distinguish a plan restriction from a provider
mid-deploy or an allowlist entry still propagating. Those retry after 15
minutes, so one transient refusal no longer removes a working endpoint for the
lifetime of the process.

For integrators: routes the backend builds as Jito bundles need a Jito-capable
Solana RPC. The default set has none, and for `ChainId.SOL` URLs supplied via
`rpcUrls` replace the defaults rather than merging. Without one, such a route
fails before submission with `RpcUnavailable` (1027).
