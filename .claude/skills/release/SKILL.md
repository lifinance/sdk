---
name: release
description: >-
  Cut and manage releases for the sdk monorepo (Changesets + wagmi model). Use
  this when the user wants to release/publish SDK packages, asks about the
  "version packages" PR, dist-tags, alpha/beta/stable channels, the npm publish
  pipeline, the Linear "SDK" release sync, or how a merge becomes published npm
  packages + GitHub Releases. Covers the maintainer flow, the pre-beta channel
  state, and the dist-tag safety rules specific to this repo.
---

# Releasing sdk

sdk publishes with **Changesets** on the wagmi model: releases are driven by `push: main`,
not by tags. There is **no single repo version tag** — each package gets its own
`@lifi/sdk@x.y.z` / `@lifi/sdk-provider-*@x.y.z` tag and GitHub Release, all created in one
publish run.

## The flow at a glance

1. PRs land on `main`, each carrying a changeset (see the `changeset` skill).
2. `publish.yaml` `changesets` job opens/updates a **"chore: version packages"** PR.
3. Merging it → the `release` job runs `pnpm changeset:publish` (build → per-package
   transform → `changeset publish`), publishes to npm with provenance, creates per-package
   GitHub Releases.
4. The `linear-meta` + `linear-release` jobs sync the "SDK" Linear release.

Read the reference for the part you're working on:

- **`references/pipeline.md`** — workflow jobs, triggers, the transform wrap, rerun idempotency.
- **`references/channels.md`** — alpha/beta/stable/canary via `pre` mode + the current
  pre-beta state and the rule that must not be broken.
- **`references/dist-tags.md`** — npm dist-tag safety (v3 is on `latest`!) + cutover.
  **Read before any publish.**
- **`references/linear-sync.md`** — the single "SDK" anchor and version/channel derivation.

## This repo's release state

- **Pre-beta.** `.changeset/pre.json` (`tag: beta`) is committed; repo is mid
  `4.0.0-beta.x`. `latest` on npm is **v3** (`3.16.x`); 4.x ships under `@beta`. **Never
  `changeset pre exit`** except to deliberately cut stable `4.0.0`.
- **One Linear anchor:** `@lifi/sdk` → "SDK", secret `LINEAR_RELEASE_ACCESS_KEY`.
  Provider-only cycles don't bump `@lifi/sdk`, so they're intentionally skipped in Linear.
- **External pins** `@lifi/types` / `@lifi/data-types` are bumped **manually** — Changesets
  doesn't track them (see the `changeset` skill's `bump-rules.md`).
- **OIDC trusted publishing** (no npm token); the trusted publisher is bound to the
  `publish.yaml` filename — keep that filename.
