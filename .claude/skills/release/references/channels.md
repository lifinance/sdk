# Channels — sdk

Channels map to npm **dist-tags**, controlled by Changesets `pre` mode.

| Channel | dist-tag | How |
|---|---|---|
| stable | `latest` | normal (not in pre mode) — **moves `latest`** |
| beta | `beta` | `pre` mode with `tag: beta` (current state) |
| alpha | `alpha` | `pre` mode with `tag: alpha` |
| canary | `canary` | snapshot: `changeset version --snapshot canary` + `changeset publish --tag canary` (additive; not wired in CI today) |

## Current state: pre-beta

`.changeset/pre.json` exists with `tag: beta`; the repo is mid `4.0.0-beta.x`. While in pre
mode:

- `changeset version` increments the beta counter (`4.0.0-beta.11` → `4.0.0-beta.12`); it
  never jumps to a bare stable `4.0.0`.
- `changeset publish` publishes under the **`beta`** dist-tag, so npm `latest` stays on the
  v3 line (`3.16.x`) and v3 consumers are unaffected.

## The one rule: do not `pre exit` casually

```
pnpm changeset pre exit     # ← moves the next publish to `latest` (4.x becomes stable)
```

`pre exit` is the **only** action that moves npm `latest` from v3 to 4.x. Run it **only**
when deliberately cutting the stable `4.0.0` release:

1. `pnpm changeset pre exit`
2. ensure a graduating changeset exists (the bump that lands `4.0.0`)
3. merge the resulting "version packages" PR → `release` publishes `4.0.0` to `latest`.

Re-enter pre mode afterward (`pnpm changeset pre enter beta`) to continue betas on the next
line. See `dist-tags.md` for the post-publish safety check.

## Entering/leaving pre mode

```
pnpm changeset pre enter beta
pnpm changeset pre enter alpha
pnpm changeset pre exit
```

`pre.json` is committed and travels through the "version packages" PR like any other change.
