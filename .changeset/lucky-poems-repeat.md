---
'@lifi/sdk': patch
---

Fix `client.extend()` dropping the `config` and `providers` accessors.

`extend` built the extended object with a shallow spread, which evaluates
getters and writes their current values as plain data properties. Because
`setProviders` reassigns the backing array, an extended client was frozen on
whatever the provider list happened to be at extend time — so a host that
extended before registering its wallet providers got a client that could
never execute, and `getProvider` always returned `undefined`.

Copy property descriptors instead, so the base and every extension share one
live view of the client's config and providers.
