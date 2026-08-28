---
'@lifi/sdk-provider-stellar': patch
---

Bump `@stellar/stellar-sdk` from 16.2.0 to 17.0.1.

v17 rebuilds the XDR namespace as a class based API and switches every
byte returning API from `Buffer` to `Uint8Array`. Three call sites needed
updating and the public API of this package is unchanged.

`deriveTransactionHash` called `.toString('hex')` on the result of
`transaction.hash()`. That is a `Uint8Array` now, whose `toString` ignores the
argument and returns comma separated decimals, so the hash is built from the
bytes directly. The helper still returns the same 64 character lowercase hex
digest, verified against the raw digest for a signed transaction.

`submitStellarTransaction` and `waitForStellarTransaction` read the failure
reason through `result().switch().name`. The generated XDR classes expose
`result` as a readonly field and carry a `type` discriminant, so both now read
`result.type`. The variant names are unchanged, so error messages are the same.

`toXDR` is deprecated in v17 in favour of `toXdr`, and still present as an
alias, so nothing broke. All five call sites moved to `toXdr` anyway rather
than leave deprecated calls behind.
