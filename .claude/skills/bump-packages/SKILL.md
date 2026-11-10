---
name: bump-packages
description: >-
  Use when the user types /bump-packages or says "bump packages", "bump deps", "update
  dependencies", "upgrade everything to latest", "refresh the lockfile and actions", "bump
  pnpm", or "what is outdated", or asks for the routine dependency bump (npm dependencies,
  GitHub Actions, CI tool versions, pnpm) in sdk, widget, or jumper-widget, also for more
  than one repo at a time. Do not use it to upgrade or debug one named package, to bump a
  package version for a release, to write a changeset by itself, or to review an existing
  bump PR.
---

# Bump packages

`scripts/bump.mjs` does the whole bump. Run it, read its summary, and act only on what it
hands back. Do not do its steps by hand.

## 1. Run

```bash
node "$SKILL/scripts/bump.mjs" --repo "$REPO"             # the bump
node "$SKILL/scripts/bump.mjs" --repo "$REPO" --dry-run   # "what is outdated": changes nothing
```

- `$SKILL` is the folder of this file. `$REPO` is the main checkout of the repo.
- A run takes 1 to 5 minutes. Start it as a background command and wait for it.
- **More than one repo:** start one background command for each repo, in parallel. Do not
  use subagents. Give one merged report.

The script works in a worktree under `$REPO/.claude/worktrees/`. It starts from the latest
`origin/main`, or it continues the open "chore: bump packages" PR of this machine. It applies
what is safe without a question: aged patch and minor bumps, fresh releases that pass the
security checks (`references/fast-track.md`), override floors, safe GitHub Actions and CI
tools, and pnpm. It regenerates the lockfile once and reviews it. It runs the checks once.
Then it commits, pushes, and opens or updates the PR.

## 2. Read the summary

The summary on stderr gives the PR link, the applied bumps, and three lists:

| List | What you do |
|---|---|
| Needs the user | Show it to the user. Each line ends with the flag that applies it. |
| Not applied by the script | Report it. A person applies these items in a follow-up. An action pin that does not match its comment is a security finding: report it first. |
| Waiting or held | Report it as one short block. It needs no action. |

| Exit | Meaning | What you do |
|---|---|---|
| 0 | Done, or nothing to bump | Report (section 4). |
| 2 | The script cannot run | The message says what to do. Do that, then run again. |
| 3 | Lockfile STOP | See section 3. Nothing is committed. |
| 4 | A check failed | See section 3. Nothing is committed. |

The summary ends with a `Rerun:` line. Use that exact command for the next run, and add the
flags that the user approved.

## 3. Act on what the script hands back

**The user names what to approve.** Pass `--approve <name@x.y.z,...>` (a fresh release) or
`--majors <names>` (a major) only for items that the user named. "Update everything" does
not name them. If you cannot ask the user, report the items and stop.

- **A major.** Research it first (`references/breaking-changes.md`), and show the result to
  the user. After the approval, run again with `--majors <name>`. The script writes the new
  range and the changeset. If a check fails then, do the failed-check steps below. For a
  runtime or UI major, also run the e2e suite (`references/repo-notes.md`).
- **Lockfile STOP (exit 3).** The summary names the cause:

  | Cause | What you do |
  |---|---|
  | major jump (a transitive major) | `pnpm -C <worktree> why <pkg>` gives the parent. Show it to the user. With the approval: `--majors <pkg>`. |
  | new split (a second copy of a single-copy package) | Find the parent with `pnpm why`. Hold the parent, or ask the user. Two copies break at runtime. |
  | unapproved exclude entry, or fresh version | pnpm needs a version younger than the gate for a range. Find the parent with `pnpm why`. With the approval: `--approve <name@x.y.z>`. Without it: hold the parent. |
  | anything else | Report it to the user. Do not work around it. |

- **Failed check (exit 4).** The worktree still has the bump. The summary lists the applied
  bumps and says if the failure is a regression.
  1. Not a regression (the check also fails without the bump): run again with
     `--skip-check <name>`, and say so in the report.
  2. A regression: find the cause from the error and the list of applied bumps. Reproduce
     it in the worktree with the command of the failed check.
  3. Small fix (a few lines that you can verify with that command): edit, then commit only
     your files by name: `git commit --no-verify -m "fix: adapt to <pkg> <version>"`.
  4. No small fix: hold the package (below), and report it as deferred.
  5. Run the reset command of the summary. Then run the `Rerun:` command.
- **Hold a package at its version.** Add an exact override in `pnpm-workspace.yaml`
  (`<pkg>: <current version>`) with a comment above it that says what breaks and when to
  remove the hold. Commit it as `chore: hold <pkg> at <version>`. The script never moves an
  exact override that has a comment.
- **A major that the user declines.** Add it to `heldMajors` in `.claude/bump-packages.json`
  (`references/repo-notes.md`), so that the script does not ask again.

## 4. Report

Give the user:

- the PR link,
- what landed, in one table,
- what is held or waiting, with one line each that says why,
- what needs the user, with the flag for each item,
- the check results and the run time.

Write all text for people in Simplified Technical English: short sentences, active voice,
one term for one thing. Put scoped package names in backticks, so that GitHub does not
mention users.

## Rules

- **The release-age gate stays on.** Never install with `--config.minimum-release-age=0`.
  The only way past the gate is an exact `name@version` entry that the script decided, or
  that the user approved by name.
- **The script only runs code from `origin/main` or from this machine.** If it refuses
  remote commits on the PR branch, show them to the user first. Do not pull them yourself.
- **Your own commits** in the worktree use `--no-verify` and name their files. The next run
  of the script runs the checks. Never rebase or force-push, and never work in the main
  checkout.
- **Same skill in three repos** (`lifinance/sdk`, `lifinance/widget`,
  `jumperexchange/jumper-widget`). If you fix it, copy the fix to the other two, and run
  `node --test "$SKILL"/scripts/test/*.test.mjs`.
- Old bump worktrees whose PRs are merged can stay. List them for the user. Do not remove
  them.
