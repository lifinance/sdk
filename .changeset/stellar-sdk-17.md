---
'@lifi/sdk-provider-stellar': patch
---

Bump `@stellar/stellar-sdk` from 16.2.0 to 17.0.1.

v17 rebuilds the XDR namespace as a class based API and switches every byte
returning API from `Buffer` to `Uint8Array`. The public API of this package is
unchanged.

`deriveTransactionHash` called `.toString('hex')` on the result of
`transaction.hash()`. That is a `Uint8Array` now, whose `toString` ignores the
argument and returns comma separated decimals, so the digest is built from the
bytes instead. The helper still returns the same 64 character lowercase hex
string, which `StellarSignAndExecuteTask.unit.spec.ts` asserts against an
independently computed digest.

`submitStellarTransaction` and `waitForStellarTransaction` read the failure
reason through `result().switch().name`. The generated XDR classes expose
`result` as a readonly field with a `type` discriminant, so both read
`result.type`. The variant names are unchanged, and a new test pins the failure
variant into the error message.

`toXDR` and `TransactionBuilder.fromXDR` are both deprecated in v17 in favour of
`toXdr` and `fromXdr`, and both remain as aliases. All seven call sites moved to
the new names.

Two behaviour notes that need no code change here. v17 raises its Node floor to
22.12.0, and CI runs Node 26. v17 also sends `useUpgradedAuth: true` on every
simulation rather than omitting the key, which turns on CAP-71 address
credentials. The two read paths simulate methods that need no authorization, and
the approve path authorizes with the transaction source account, so a live
mainnet simulation records `sorobanCredentialsSourceAccount` and the flag has no
effect. Mainnet is on protocol 27, which activates CAP-71 in any case.
