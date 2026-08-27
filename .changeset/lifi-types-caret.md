---
'@lifi/sdk': minor
---

Widen the `@lifi/types` dependency from the exact pin `18.2.0` to `^18.3.0`.

The exact pin forced a second copy of `@lifi/types` into any tree that also used
`@lifi/perps-sdk`, which pins exactly too. Two exact pins on different versions can
never share a resolution. Carets on both sides let the package manager settle on one
version, and remove the need for the two packages to bump in lockstep.

`@lifi/sdk` re-exports `@lifi/types` in full, so the change is a minor rather than a
patch.
