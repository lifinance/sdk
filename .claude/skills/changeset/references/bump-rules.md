# Bump rules — sdk

## Bump level

- **`feat:`** (new capability, backwards-compatible) → **minor**
- **`fix:`** (bug fix, backwards-compatible) → **patch**
- **breaking change** (removed/renamed export, changed signature, behavior break) → **major**

While the repo is in **pre-beta** (see the `release` skill's `channels.md`), every bump
lands as `4.0.0-beta.N` regardless of level — but still pick the level that *would* apply
on the stable line; it determines the eventual stable bump on `pre exit`.

## Publishable packages (these need a changeset when changed)

- `@lifi/sdk` (the hub)
- `@lifi/sdk-provider-ethereum`
- `@lifi/sdk-provider-bitcoin`
- `@lifi/sdk-provider-solana`
- `@lifi/sdk-provider-sui`
- `@lifi/sdk-provider-tron`

There are no private/ignored workspace packages (`.changeset/config.json` `ignore` is empty).

## Dependency graph — don't author cascade-only changesets

```
@lifi/sdk
  ↑ @lifi/sdk-provider-{ethereum,bitcoin,solana,sui,tron}   (each depends on @lifi/sdk)
```

Providers depend on `@lifi/sdk` via `workspace:*` regular `dependencies`. With
`updateInternalDependencies: minor`, bumping `@lifi/sdk` **re-releases every provider
automatically** with an updated range. So:

- Changed `@lifi/sdk` source only → declare a changeset for **just** `@lifi/sdk`; the five
  providers bump on their own. Do **not** add changesets for the providers.
- Changed one provider's source → declare a changeset for **just** that provider. A
  provider-only change does **not** bump `@lifi/sdk` (the dependency points the other way),
  and that cycle is intentionally **not** reflected in the Linear "SDK" release (see the
  `release` skill's `linear-sync.md`).

## External pinned deps — not Changesets' job

`@lifi/types` (a `@lifi/sdk` dependency) and `@lifi/data-types` (devDep) are **external
pinned versions**, not workspace packages. Changesets does not track or bump them. When you
upgrade a pin, edit it by hand and add a `fix:`/`feat:` changeset on the affected package
describing the bump.
