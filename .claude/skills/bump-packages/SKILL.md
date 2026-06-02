---
name: bump-packages
description: >-
  Bump every external npm dependency in this pnpm workspace to its latest
  version, then open a `chore: bump packages` PR. Use this whenever the user
  runs `/bump-packages`, asks to "bump/update/upgrade the (dev)dependencies",
  "update packages to latest", "do a dependency bump", or otherwise wants the
  monorepo's deps refreshed. Patch and (>=1.x) minor bumps apply automatically;
  major bumps — and 0.x minors, which are breaking under SemVer — are NEVER
  applied without first showing the user a breaking-changes report and getting
  an explicit go/no-go per package. The skill validates the result (build,
  types, lint, tests), adds a `fix:` changeset for any runtime-dependency bump
  on a publishable package, and finishes with an overview of what changed.
---

# Bumping packages

This repo is a pnpm-workspace monorepo (`@lifi/sdk` + five providers). Keeping its
external dependencies current is routine maintenance, but three things make a blind
`pnpm update --latest && git push` a bad idea, and they're the reason this skill exists:

1. **Major bumps break things.** A `2.x → 3.x` jump (or, under SemVer, a `0.22 → 0.23`)
   can change APIs the SDK relies on. Those need a human looking at the changelog before
   they land — so this skill researches the breaking changes and asks you per package,
   while applying the safe patch/minor bumps without ceremony.
2. **Runtime bumps ship to users; dev bumps don't.** Bumping `viem` changes what
   `@lifi/sdk-provider-ethereum` resolves for consumers, so it needs a Changesets entry
   (CI/releases depend on it). Bumping `biome` or `vitest` doesn't affect the published
   tarball, so it must NOT get a changeset (a noisy, meaningless release entry).
3. **Brand-new releases are a supply-chain risk.** A version published in the last 24h is
   "too fresh" to trust. The target is never automatically the registry's `latest` — it's
   the newest version that has already **aged past 24h**. pnpm 11 enforces this floor by
   default (`minimumReleaseAge: 1440`), so `pnpm up --latest`, run under the repo's pinned
   pnpm, holds a too-fresh release back to the newest aged version on its own — and preserves
   each dependency's existing prefix (`^`, `~`, or a deliberate exact pin) — verified for all
   three. So you don't hand-write versions; you let pnpm resolve, and report what it held
   back.

The deterministic parts — discovering outdated deps, predicting the aged target pnpm will
land on, classifying each by SemVer risk, and working out which publishable packages need a
changeset — are done by `scripts/analyze-outdated.mjs` so they come out the same way every
run. The script tells you *what* will happen (and what's held back, and why) before any
mutation; pnpm then *does* the bump. Your job is the judgement: reviewing the majors,
validating the result, writing a good PR.

> **Why not `pnpm up -r -i --latest`?** The interactive `-i` picker is a keyboard-driven TUI
> this tool can't drive, so we use the non-interactive `--latest` form.

## Workflow

### 1. Start clean, on a fresh branch, using the repo's pnpm

Bumps land as a PR, and you can't commit to `main`. Make sure the working tree is clean
(`git status`), sync, and cut the branch:

```bash
git fetch origin main
git switch main && git pull --ff-only    # only if already on main and clean
git switch -c chore/bump-packages         # or chore/bump-packages-<date> if it exists
```

If the tree has unrelated uncommitted changes, stop and ask the user — don't sweep their
work into a dependency PR.

**Run pnpm from the repo root so you get the pinned version.** Corepack serves the
`packageManager`-pinned pnpm (11.x) inside the repo, and that's what enforces the 24h floor
(see the intro). A stray pnpm 10.x on `PATH` would not — if a resolution looks too fresh,
confirm `pnpm --version` says `11.x`. Nothing to configure.

**Bump the package manager itself, too.** Check the pinned pnpm against the latest:

```bash
npm view pnpm version                                  # latest pnpm
node -p "require('./package.json').packageManager"     # currently pinned
```

Bump it to latest now — this rewrites the `packageManager` hash and the diff rides along in
the PR:

```bash
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack use pnpm@latest
```

Do this **first — before any dependency bump**. The dependency steps and the final
`pnpm regen` (step 6) rewrite `pnpm-lock.yaml`, and you want that lockfile written by the
*new* pnpm so its format and resolution match what CI and everyone else uses post-merge.
pnpm goes to latest unconditionally — even a major (`11.x → 12.x`); `pnpm regen` would force
it regardless, and step-6 validation plus your PR review are the safety net if a toolchain
major misbehaves. (The major-approval gate is for the workspace's *dependencies*, not the
package manager.)

CI derives pnpm from `packageManager` (`.github/actions/pnpm-install` runs
`pnpm/action-setup` with no explicit `version:`), so this one field bump keeps CI in sync —
nothing else to change. If that ever stops being true (a hardcoded pnpm `version:` in a
workflow, a `.tool-versions`/`.nvmrc`, or an `engines.pnpm`), bump it in lockstep, or the PR
goes red. A quick `git grep` for the old version catches strays.

### 2. Capture the type-check baseline (before touching anything)

`pnpm check:types` can carry a *pre-existing* failure (see the repo's CLAUDE.md "Known
Issues"). If you only look at the post-bump result you'll wrongly blame the bump. So
record the baseline now, on the clean branch:

```bash
pnpm check:types > /tmp/bump-typecheck-before.txt 2>&1; echo "baseline exit: $?"
```

Keep this file. After bumping you'll re-run and diff — only *new* errors are the bump's
fault.

### 3. Analyze what's outdated

```bash
node .claude/skills/bump-packages/scripts/analyze-outdated.mjs > /tmp/bump-plan.json
```

The script fetches npm publish timestamps, picks the newest **aged** target per dep (≥24h
old), preserves each prefix, and prints a readable summary to stderr plus a JSON plan to
stdout (`/tmp/bump-plan.json`). Read both. The plan's parts:

- **`safe`** — patch bumps and minor bumps on `>=1.x` packages. Apply these automatically.
- **`needsApproval`** — major bumps, plus `0.x` minor bumps (`reason: "zerox-minor"`),
  which SemVer treats as breaking. Never apply these without the user's OK (step 5).
- **`tooFresh`** — deps with updates whose newest version is younger than 24h, so there's
  nothing aged enough to install yet. **Don't bump these.** Mention them in the summary
  (with `hoursUntilEligible`) so the user knows they're waiting, not forgotten. An
  `ageUnknown` entry means `npm view` couldn't return timestamps — treat as not-yet-eligible
  rather than guessing.
- **`changeset`** — a map of publishable package → the runtime-dep bumps affecting it.
  This is what needs a `fix:` changeset (step 7).
- **`deprecated`** — packages npm flags as deprecated. Call these out; a deprecated package
  usually wants replacing, not just bumping.

Per entry, note `target` (the aged version pnpm should land on), `registryLatest`, and
`heldBack: true` when `registryLatest` is newer than `target` but too fresh. The `target`
is what the script *predicts* pnpm will install under the 24h floor — use it for
classification and the summary; pnpm produces the actual resolution in step 4.

If everything is up to date (`summary.total === 0` and no `tooFresh`), tell the user and stop.

### 4. Apply the safe bumps

Let pnpm rewrite the ranges across the whole workspace — under pnpm 11's default age floor
it lands the aged target and keeps each prefix (caret, tilde, or exact) intact:

```bash
pnpm up -r --latest <name1> <name2> ...   # only the names from plan.safe
```

Then sanity-check that pnpm's resolution matches the plan — versions should equal each
entry's `target`, never a `heldBack` `registryLatest`:

```bash
git diff -- '**/package.json' package.json    # confirm the new ranges
grep -E '<one-bumped-name>@' pnpm-lock.yaml    # confirm the lockfile resolved to the aged version
```

If a resolved version is newer than the plan's `target`, the age floor isn't taking effect
(likely a non-pinned pnpm 10.x on `PATH` — see step 1); stop and fix that before continuing,
rather than shipping a too-fresh dependency.

### 5. Research and approve the majors / 0.x minors

For each entry in `needsApproval`, build a breaking-changes report **before** asking.
Follow `references/breaking-changes.md` for where to look (GitHub releases between the two
versions, the package CHANGELOG, migration guides) and how to summarize. Present one block
per package — `current → target` (use the entry's aged `target`, not `registryLatest`), the
breaking changes that actually touch how this repo uses the dep, the migration steps, and a
link — then collect a per-package decision with an `AskUserQuestion` (multi-select: "Which
major upgrades should I apply?"). List every candidate so the user can pick a subset;
default is to skip the ones they don't pick.

Apply only the approved ones with `pnpm up -r --latest <approved-names>` (same as step 4).
If a major needs code changes to compile, make the minimal migration edits the changelog
calls for — or, if they're large, report back and let the user decide to defer that one.

Leave declined/deferred majors exactly as they were; they'll show as "deferred" in the
final summary so they're not silently dropped.

### 6. Regenerate the lockfile, then validate

First **regenerate everything from scratch** so you validate the exact, fresh state that
ships — not an incrementally-patched lockfile. `pnpm regen` deletes `pnpm-lock.yaml`, wipes
every `node_modules`, and runs `corepack use pnpm@latest`, then reinstalls cleanly:

```bash
pnpm regen
```

This re-resolves the whole tree from the bumped `package.json` ranges under pnpm 11's age
floor — so the committed lockfile is fully fresh and deduped, and reaffirms pnpm@latest. It's
a full reinstall, so it takes a bit. (It also re-runs `corepack use pnpm@latest`; if a newer
pnpm landed mid-run, the `packageManager` hash updates again — that's fine.)

Then run the checks proactively, against the fresh tree — the pre-commit hook will run
`check + check:types + circular-deps + knip` and pre-push runs `test:unit` anyway, so doing
them now lets you attribute and fix failures cleanly:

```bash
pnpm build
pnpm check                 # biome lint/format
pnpm check:circular-deps
pnpm knip:check
pnpm test:unit
pnpm check:types > /tmp/bump-typecheck-after.txt 2>&1; echo "after exit: $?"
diff /tmp/bump-typecheck-before.txt /tmp/bump-typecheck-after.txt || true
```

Interpreting results:
- **`check:types`** — judge it by the *diff* against the baseline, not pass/fail. Errors
  present in both files are pre-existing (not yours). Errors only in the "after" file are
  regressions the bump caused — investigate them.
- A **runtime** bump that breaks the build/tests is the high-stakes case: either make the
  small migration fix, or drop that single dep from the batch (revert its range, re-install)
  and note it as "reverted — needs follow-up" rather than shipping a broken provider.
- If `biome check` reports formatting changes, run `pnpm check:write` to apply them.
- **`pnpm build` rewrites the generated `packages/*/src/version.ts` files** (it inlines each
  package's current version). Those are build artifacts, unrelated to a dependency bump — and
  a build can surface a pre-existing version drift in them. Don't let them into the PR; you'll
  discard them at staging time (step 8).

### 7. Add a changeset for runtime bumps

Every publishable package in `plan.changeset` had a runtime dependency change, so it ships
to users and needs a Changesets entry — CI nudges (and releases depend) on it. Author **one**
changeset declaring those packages at `patch` (a dependency refresh is a `fix:`-level change
unless the bump changed the package's own public API). Use the **`changeset` skill's** format
(`references/format.md` there) — write `.changeset/bump-packages.md`:

```markdown
---
"@lifi/sdk-provider-ethereum": patch
"@lifi/sdk-provider-sui": patch
---

Bump runtime dependencies: viem to 2.51.3, @mysten/sui to 2.17.0.
```

Only list the packages from `plan.changeset`. Dev-only bumps (biome, vitest, knip, tsdown,
@types/node, @lifi/data-types as a devDep, …) get **no** changeset. If `plan.changeset` is
empty, skip this step entirely. Confirm with `pnpm changeset status`.

### 8. Commit, push, open the PR

Stage deliberately. `git add -A` is wrong here — it would sweep this skill (untracked on
the branch) and any scratch files into the PR. But a narrow `package.json`/lockfile glob is
also wrong: a major bump may have required **migration edits in `packages/*/src/`**, and the
pnpm bump changes the `packageManager` field — all of which must ship. Stage tracked
modifications (which covers `src/` edits, every `package.json`, the lockfile, and
`packageManager`) plus the new changeset, then eyeball exactly what's staged before
committing:

```bash
git add -u                 # all tracked edits: src migrations, package.json(s), pnpm-lock.yaml, packageManager
# Drop build-generated version.ts files (step 6's build rewrites them; not part of the bump):
git restore --staged --worktree -- $(git ls-files '**/version.ts')
git add .changeset/*.md    # the new changeset (untracked but intended) — skip if none
git status                 # confirm NO skill/scratch/version.ts files are staged
git diff --cached --stat   # eyeball the staged set
git commit -m "chore: bump packages"     # husky re-runs the step-6 checks; commitlint requires this conventional subject
git push -u origin HEAD
gh pr create --title "chore: bump packages" --body "<summary>" --base main
```

Write the PR body as the overview from step 9 (the bump table, plus any deferred majors and
the changeset note). Open it **ready for review** (no `--draft`).

> Hook escape hatch — use only with proof: if the pre-commit hook blocks the commit on a
> `check:types` error that your step-6 baseline diff shows is **pre-existing** (identical in
> both files), it's not your bump's fault and you may commit with `--no-verify`. Never reach
> for `--no-verify` to bypass a failure the bump actually introduced — fix or drop that bump
> instead.

### 9. Give the user the overview

End with a compact table so the user sees exactly what happened:

```
## Bumped packages

| Package              | Type    | From     | To      | Bump  | Changeset |
|----------------------|---------|----------|---------|-------|-----------|
| viem                 | runtime | 2.48.11  | 2.51.3  | minor | ✅ patch  |
| @mysten/sui          | runtime | 2.16.2   | 2.17.0  | minor | ✅ patch  |
| @biomejs/biome       | dev     | 2.4.15   | 2.4.16  | patch | —         |
| vitest               | dev     | 4.1.6    | 4.1.7   | patch | —         |
| …                    |         |          |         |       |           |

**Package manager**: pnpm 11.1.2 → 11.5.0 (or "already latest").
**Held back** (newest too fresh, <24h): <name → registryLatest, eligible in ~Nh> — or "none".
**Deferred majors** (declined/needs work): <name current→target, one line why> — or "none".
**Validation**: lockfile regenerated (`pnpm regen`) ✅ · build ✅ · types ✅ (no new errors) · lint ✅ · unit tests ✅
**PR**: <link>
```

The `To` column is always the **aged target** that was actually installed. If a dep was
held back, the held-back line names the newer registry version still waiting out the 24h —
so nothing looks silently skipped.

Include any deprecated-package warnings and anything you reverted. If a major was deferred,
say what the user needs to do to revisit it.
