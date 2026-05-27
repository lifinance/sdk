# Linear sync — sdk

sdk syncs a **single** Linear release pipeline. Because secret refs must be static YAML,
it's modeled as a static gated **`linear-meta`** job (derives version/channel) feeding a
**`linear-release`** reusable-workflow caller — not a dynamic matrix.

| Anchor package | Linear release | Secret |
|---|---|---|
| `@lifi/sdk` | "SDK" | `LINEAR_RELEASE_ACCESS_KEY` |

## How it works

The `linear-meta` job is gated on the anchor actually publishing:

```yaml
if: needs.release.result == 'success' && contains(needs.release.outputs.publishedPackages, '"@lifi/sdk"')
```

The quotes matter — `'"@lifi/sdk"'` won't false-match `@lifi/sdk-provider-ethereum`. The
meta job derives via `jq` over `publishedPackages`:

- `full` — published version, e.g. `4.0.0-beta.12`
- `version` — `full` with prerelease suffix stripped, e.g. `4.0.0`
- `channel` — `alpha` / `beta` / `stable`

`linear-release` calls the reusable `linear-release.yaml` with `release_name: SDK`,
`version` (stripped), `channel`, and `release_tag: '@lifi/sdk@<full>'`. The reusable:

- **`sync`** — attaches merged issues to the `X.Y.Z` Linear release + records a link to the
  GitHub Release at `releases/tag/@lifi/sdk@<full>`.
- **`update`** + `stage` (alpha/beta) — advances the stage; release stays open.
- **`complete`** (stable) — closes the release (fires Linear's "→ Done" automation).

Linear releases are keyed on the marketing `X.Y.Z` (stripped), so all betas of `4.0.0`
attach to one "SDK 4.0.0" release and advance its stage; the stable cut completes it.

## Anchor coverage policy = SKIP

The only anchor is `@lifi/sdk`. A **provider-only** release cycle (providers bumped, but
`@lifi/sdk` unchanged) leaves `@lifi/sdk` out of `publishedPackages`, so `linear-meta`
skips → **no** "SDK" Linear release for that cycle. There is no fallback anchor; this is
deliberate (providers track the SDK line). Reconcile manually in Linear if a provider-only
release ever needs reflecting.
