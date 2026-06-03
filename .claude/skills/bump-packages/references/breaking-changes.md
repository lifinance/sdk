# Researching a major bump

When a dependency is in the `needsApproval` bucket (a real major, or a `0.x` minor that
SemVer treats as breaking), the user needs enough to make a go/no-go call without reading
the changelog themselves. Your goal is a short, *honest* report: what actually breaks for
**this repo's usage**, not a copy-paste of the upstream release notes.

Research and report against the entry's **`target`** (the aged version the skill would
actually install), not `registryLatest` — if a newer version was held back for being <24h
old, it's not what's landing, so don't report its changes.

## Where to look (in rough priority order)

1. **GitHub releases between the two versions.** Find the repo, then read the release notes
   for every version from just-above-current through latest — breaking changes are often
   introduced in an intermediate release, not just the latest tag.
   ```bash
   npm view <pkg> repository.url homepage   # find the GitHub repo
   ```
   Then `WebFetch` `https://github.com/<org>/<repo>/releases` (or the project's
   `CHANGELOG.md`). For monorepo deps (e.g. `@mysten/sui`, `@solana/*`) the changelog may
   live under a package subfolder.
2. **The package's own CHANGELOG**, via `npm view <pkg> homepage` or the unpkg/jsdelivr
   copy of the new version's `CHANGELOG.md`.
3. **A migration guide**, if the project publishes one (viem, for example, keeps
   `/docs/migration` notes). `WebSearch` `"<pkg> v<major> migration breaking changes"`.
4. **How this repo uses the dep.** Grep the workspace for the import to gauge blast radius
   — a breaking change to an API the repo never calls doesn't matter.
   ```bash
   grep -rn "from '<pkg>'" packages/*/src | head
   ```

Prefer primary sources (release notes, migration guide) over blog posts. If you genuinely
can't find breaking-change notes, say so — "couldn't find a changelog; treat as unknown
risk" is more useful than a confident guess.

## What to report (one block per package)

```
### <pkg>  <current> → <target>   (<N> major versions)

**Breaking changes that affect this repo:**
- <change> — <which import/API in which package it touches, or "not used here">

**Migration:** <concrete steps, or "drop-in; no code changes found">

**Risk:** low / medium / high — <one-line why>
**Source:** <link to the release notes / migration guide>
```

Keep it tight. If a major has dozens of breaking changes but the repo only touches one API,
lead with that one and note the rest are irrelevant. If nothing the repo uses changed, say
"appears drop-in for our usage" and rate the risk low — that helps the user approve quickly.

## Then ask

After presenting all the blocks, collect the decision with a single `AskUserQuestion`
(multi-select) listing every candidate, e.g. "Which major upgrades should I apply?" with one
option per package. Apply only what's selected; leave the rest at their current versions and
list them as **deferred** in the final summary so nothing is silently skipped.

If applying an approved major needs code changes:
- **Small** (a rename, a moved import, a changed option name the changelog spells out): make
  the minimal edit so it compiles and tests pass.
- **Large** (an API redesign, a behavior change needing real rework): don't try to power
  through it inside a routine bump PR. Revert that one dep, and report it as deferred with a
  note on what the migration would involve, so the user can scope it as its own task.
