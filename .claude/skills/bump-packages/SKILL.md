---
name: bump-packages
description: >-
  Fast dependency bump for this pnpm monorepo: every external npm dependency, the
  SHA-pinned GitHub Actions, tool versions in CI, and pnpm itself go to their latest
  release that is older than the 24h release-age gate. A fresh patch or minor that passes
  the security checks goes in as a fast-track. One script does the whole bump in a
  worktree, runs the checks once, commits, and opens or updates the "chore: bump packages"
  PR. The model only handles majors, migrations, and failures. Use it when the user types
  /bump-packages or says "bump packages", "bump deps", "update dependencies", "upgrade
  everything to latest", "refresh the lockfile and actions", "bump pnpm", "what is
  outdated", or asks to run the dependency bump in sdk, widget, or jumper-widget, also for
  more than one repo at a time. Do not use it to upgrade or debug one named package, to
  bump a package version for a release, to write a changeset by itself, or to review an
  existing bump PR.
---

# Bump packages

`scripts/bump.mjs` does the whole bump. Run it, read its summary, and act only on what it
hands back. Do not do its steps by hand.

The same skill is in `lifinance/sdk`, `lifinance/widget`, and `jumperexchange/jumper-widget`.
The files are identical. If you fix the skill, copy the fix to the other two repos and run
`node --test "$SKILL"/scripts/test/*.test.mjs`.

## 1. Run the script

`SKILL` is the folder that holds this `SKILL.md`. `REPO` is the main checkout of the repo to
bump.

```bash
node "$SKILL/scripts/bump.mjs" --repo "$REPO" > "$TMPDIR/bump-$(basename "$REPO").json"
```

- **Only the analysis:** for "what is outdated", add `--dry-run`. The script then changes
  nothing.
- **More than one repo:** start one run for each repo, in parallel, as background commands.
  Do not use subagents for this. Give one merged report at the end.
- **Run time:** a run takes about 1–10 minutes, mostly install, build, and tests. Use a
  background command, and wait for it to finish.

The script does these steps:

1. It fetches `origin` with `--no-prune-tags`. With `fetch.pruneTags=true`, a plain fetch
   deletes the tags of other remotes.
2. It makes a worktree under `$REPO/.claude/worktrees/`. If a "chore: bump packages" PR is
   open, it continues on that branch (open-PR mode). It never touches the main checkout,
   never rebases, and never force-pushes.
3. It analyzes npm, the GitHub Actions, the CI tools, pnpm, and Node.
4. It applies only these items, with no question:
   - safe bumps,
   - `auto` fast-tracks (see `references/fast-track.md`),
   - `lift:` and `floor:` override updates,
   - safe Actions and CI tools,
   - a pnpm update that is not a major,
   - the removal of exclude entries that are older than the gate.
5. It regenerates the lockfile once and reviews it.
6. It writes changesets, and runs all checks once, in parallel.
7. It makes 2–4 commits, pushes, and opens or updates the PR.

Each item that needs a person goes into `decisions`. The script does not apply it.

## 2. Read the result

The summary on stderr gives the PR link, the applied items, the decisions, and the time of
each step. The JSON on stdout has the details. Read single fields with `node -p`.

| Exit | Meaning | What you do |
|---|---|---|
| 0 | Done, or nothing to bump | Report the PR and the decisions. |
| 2 | The script cannot run | Read the error. Fix the cause (for example `gh auth`, a dirty worktree, a merge conflict outside the lockfile), then run it again. |
| 3 | Lockfile STOP | See "Lockfile STOP" below. Nothing is committed. |
| 4 | A check failed | See "Failed check" below. Nothing is committed. |

## 3. Handle what the script hands back

Do only the items that apply. For the details of each one, read the matching section of
`references/manual.md`.

- **Decisions.** Show them to the user in one short list:
  - majors that are not known holds (research them with `references/breaking-changes.md`),
  - `needs-approval` fast-tracks (no provenance),
  - blocked fast-tracks with their red flags,
  - `check by hand` overrides, peer floors, and new dependencies of aged versions.

  When the user approves items, run the script again with `--approve <name@x.y.z,...>` for
  fast-track entries, or `--expect-majors <names>` for lockfile majors. In open-PR mode, it
  adds new commits to the same PR.
- **An approved major of a direct dependency.** The script does not apply majors. Do these
  steps in the worktree of the run:
  1. Change the range in each `package.json` that uses the package. Make the migration
     edits (`references/breaking-changes.md`).
  2. Commit as `chore: bump <pkg> to <major>` with `--no-verify`.
  3. Run the script again with `--expect-majors <pkg>`. It regenerates the lockfile, runs
     the checks, commits the lockfile, and pushes.
  4. For a runtime or UI major, also run the e2e suite (`references/repo-notes.md`).
- **Lockfile STOP (exit 3).** The summary names the cause: an unexpected major, a new
  second copy of a single-copy package, an exclude entry that pnpm added by itself, or a
  fresh version. Find the cause with `pnpm why <pkg>`. Show it to the user. Then run the
  script again with the approval, or fix the range.
- **Failed check (exit 4).** The summary gives the last lines of each failed check. The
  logs are in the output folder. Do these steps:
  1. Check whether `main` has the same failure. If it has, it is not a regression: say so,
     and run the script again with the check skipped only if the user agrees.
  2. If it is a regression, find the package that causes it. A small fix goes into the
     worktree as a commit `fix: adapt to <pkg> <version>`. For a large break, hold the
     package with an override and a comment, and report it as deferred.
  3. Run the script again.

## 4. Report

Give the user:

- the PR link,
- what landed: the applied items, in one table,
- what is held, with one line each that says why,
- the decisions that need the user,
- the check results and the run time.

Write all text for people in Simplified Technical English: short sentences, active voice,
one term for one thing. Put scoped package names in backticks, so that GitHub does not
mention users.

## Rules

- **The release-age gate stays on.** Never install with `--config.minimum-release-age=0`.
  The only way past the gate is an exact `name@version` entry in `minimumReleaseAgeExclude`
  that the script decided `auto`, or that the user approved by name.
- **Holds stay held.** An exact-version override with a comment is a hold. Do not move it
  without the user.
- **The commits skip the git hooks** (`--no-verify`). The script ran the same checks once
  before it committed. Do not add commits by hand without running the checks.
- **Repo differences** are in `references/repo-notes.md`. The repo itself is the source of
  truth: `pnpm-workspace.yaml`, `package.json`, `.changeset/config.json`, and `.github/`.
- Old bump worktrees whose PRs are merged can stay. List them to the user. Do not remove
  them yourself.
