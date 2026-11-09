---
name: bump-packages
description: >-
  Routine dependency bump for this pnpm monorepo: every external npm dependency, the
  SHA-pinned GitHub Actions, tool versions in CI, and pnpm itself go to their latest
  release that is older than the 24h release-age gate. The work happens in a fresh
  worktree from the latest origin/main. The skill shows one upgrade table and waits for
  approval, then commits, validates, and opens a "chore: bump packages" PR. Use it when
  the user types /bump-packages or says "bump packages", "bump deps", "update
  dependencies", "upgrade everything to latest", "refresh the lockfile and actions",
  "bump pnpm", "what is outdated", or asks to run the dependency bump in sdk, widget, or
  jumper-widget, also for more than one repo at a time. Do not use it to upgrade or debug
  one named package, to bump a package version for a release, to write a changeset by
  itself, or to review an existing bump PR.
---

# Bump packages

This skill updates these items to their latest release:

- The external npm dependencies of every workspace project and of each extra pnpm project.
- The GitHub Actions in `.github/`. They are pinned to a commit SHA with a `# vX.Y.Z` comment.
- Tool versions that CI hardcodes, such as `WRANGLER_VERSION` or `npx -y wrangler@x.y.z`.
- pnpm (the `packageManager` field). The skill also reports the Node version that CI uses.

The same skill is in `lifinance/sdk`, `lifinance/widget`, and `jumperexchange/jumper-widget`.
The files are identical. If you fix the skill, copy the fix to the other two repos. Then
run `node --test "$SKILL"/scripts/test/*.test.mjs`. `references/repo-notes.md` gives hints about the
differences between the repos. The source of truth is always the repo itself:
`pnpm-workspace.yaml`, `package.json`, `.changeset/config.json`, and `.github/`.

## Rules that apply to every step

- **Do not touch the main checkout.** It can contain the user's work on a different branch.
  Do all work in a new worktree. Never switch branches, stash, or pull in the main checkout.
- **Respect the release-age gate.** pnpm 12 has a 24h release-age gate by default. The
  default is not strict: when no aged version fits a range, pnpm takes a fresh one and adds
  it to `minimumReleaseAgeExclude`. Step 6 stops on each such entry. The scripts use the same rule for npm, Actions, CI tools, and pnpm. The npm script
  cross-checks its targets with pnpm's own resolver. A held-back version shows in the
  table, so it is not silently lost. The only way past the gate is an approved
  **fast-track**: an exact `name@version` entry in `minimumReleaseAgeExclude` (see
  `references/fast-track.md`). Never install with `--config.minimum-release-age=0`.
- **Holds stay held.** An override with an exact version keeps that version. An example
  is `vite-plugin-node-polyfills: "0.26.0"`. The comment above the override decides what
  it is. A comment that gives a regression is a hold. A comment about copies, or no
  comment, means a dedupe pin. Recheck it. Propose to move it if a newer version exists.
  Do not give a held name to `pnpm up`. If you do, the specifier moves but the lockfile
  stays, and the two disagree.
- **Nothing changes before approval.** Steps 1–4 do not commit, push, or open a PR. Step 4
  shows the table and stops. A trial in the worktree is allowed before step 4, for
  example a build with TypeScript 7 to recheck a hold. Revert it afterwards with
  `git -C "$WT" checkout -- . && git -C "$WT" clean -fd && pnpm -C "$WT" install --frozen-lockfile`.
- **Run the scripts from this skill's folder.** The worktree comes from `origin/main`, so
  its copy of this skill can be older. Use the absolute path of the folder that holds
  this `SKILL.md` (`$SKILL` below). Give the scripts `--root "$WT"`.
- **Read the summaries, query the JSON.** Each script prints a Markdown summary on stderr
  and a JSON plan on stdout. Read the summary. Get single fields from the JSON with
  `node -p`, for example `node -p "require('$OUT/npm-plan.json').upCommands.join('\n')"`.
  The widget plan has thousands of lines, so do not read it whole.
- **Stop on a degraded plan.** A summary that starts with `DEGRADED` means that a registry
  or API call failed. The JSON then has a non-null `degraded`. An empty section then means
  "unknown". Rerun the script. If it fails again, tell the user. A script that exits 2
  could not run at all: read its error.
- **Each Bash call starts a new shell.** Variables and `cd` do not carry over. Step 1
  writes `$OUT/env.sh`. Begin every later block with
  `source <full path of env.sh> && cd "$WT"`.
- **Never commit generated files.** `pnpm build` rewrites the `version.ts` files (see
  `references/repo-notes.md`). Before every commit, restore them, stage with
  `git add -u` plus the new files by name, and check `git status`. Never use
  `git commit -a`.

## 1. Make a fresh worktree from the latest main

`REPO` is the main checkout of the repo to bump. When the user names a repo, or a
multi-repo run passes one, set it. Otherwise it defaults to the repo that holds this skill.
Then check for an open bump PR. A second bump PR conflicts on the lockfile.

```bash
SKILL=/absolute/path/to/this/skill/folder          # the folder that holds this SKILL.md
REPO=${REPO:-$(dirname "$(git -C "$SKILL" rev-parse --path-format=absolute --git-common-dir)")}
GH_REPO=$(gh repo view "$(git -C "$REPO" remote get-url origin)" --json nameWithOwner -q .nameWithOwner)
gh pr list --repo "$GH_REPO" --state open --search '"chore: bump packages" in:title' \
  --json number,title,headRefName
```

If an open bump PR exists, stop and ask the user. Otherwise continue. This is a new Bash
call, so set the three variables again:

```bash
SKILL=/absolute/path/to/this/skill/folder
REPO=${REPO:-$(dirname "$(git -C "$SKILL" rev-parse --path-format=absolute --git-common-dir)")}
GH_REPO=$(gh repo view "$(git -C "$REPO" remote get-url origin)" --json nameWithOwner -q .nameWithOwner)
TMP=${TMPDIR:-/tmp}; TMP=${TMP%/}                  # TMPDIR is not set on every shell
DATE=$(date +%Y-%m-%d)
git -C "$REPO" fetch origin --prune
# One free suffix for the worktree, the branch and $OUT: "", -2, -3 …
SFX=""; n=1
while [ -e "$REPO/.claude/worktrees/bump-$DATE$SFX" ] ||
  git -C "$REPO" show-ref --quiet "refs/heads/chore/bump-deps-${DATE//-/}$SFX" ||
  git -C "$REPO" ls-remote --exit-code --heads origin "chore/bump-deps-${DATE//-/}$SFX" >/dev/null ||
  [ -e "$TMP/bump-$(basename "$REPO")-$DATE$SFX" ]; do
  n=$((n + 1)); SFX="-$n"
done
WT="$REPO/.claude/worktrees/bump-$DATE$SFX"
BRANCH="chore/bump-deps-${DATE//-/}$SFX"
OUT="$TMP/bump-$(basename "$REPO")-$DATE$SFX"; mkdir -p "$OUT" || exit 1
git -C "$REPO" worktree add --no-track -b "$BRANCH" "$WT" origin/main
printf 'SKILL=%q\nREPO=%q\nGH_REPO=%q\nDATE=%q\nBRANCH=%q\nWT=%q\nOUT=%q\n' \
  "$SKILL" "$REPO" "$GH_REPO" "$DATE" "$BRANCH" "$WT" "$OUT" > "$OUT/env.sh"
echo "env: $OUT/env.sh"
cd "$WT"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
pnpm build        # check:types needs each workspace package's dist/ in a fresh worktree
git restore -- $(git ls-files '*version.ts')       # the build rewrote them; keep them clean
git ls-files '*pnpm-lock.yaml' ':!pnpm-lock.yaml'   # extra pnpm projects, e.g. examples/node
```

- `.claude/worktrees/` is in `.gitignore` in all three repos. Keep scratch files in `$OUT`,
  outside the repo, so that they cannot get into a commit.
- An **extra pnpm project** has its own lockfile outside the workspace, for example
  `examples/node` in sdk. The skill bumps it too. Steps 3, 5, and 7 say how.
- Old bump worktrees whose PRs are merged can stay. List them to the user at the end. Do
  not remove them yourself.

## 2. Record the baseline

Run the checks of the repo on the clean worktree before you change anything. Then you
can tell a regression from an error that was already on `main`. Read the script names
from `package.json`. They are different in each repo.

```bash
TEST=$(node -p "require('./package.json').scripts['test:unit'] ? 'test:unit' : 'test'")
for s in check check:types check:circular-deps knip:check "$TEST"; do
  node -e "process.exit(require('./package.json').scripts['$s']?0:1)" || continue
  if [ "$s" = check:types ]; then
    # --no-bail: report every package's errors, the same way step 7 does.
    pnpm -r --parallel --no-bail check:types > "$OUT/before-check-types.txt" 2>&1
  else
    pnpm "$s" > "$OUT/before-${s//:/-}.txt" 2>&1
  fi
  echo "$s exit $?"
done
grep -hE "Tests +[0-9]+ (passed|failed)" "$OUT"/before-test*.txt | tee "$OUT/before-test-count.txt"
pnpm audit --json > "$OUT/before-audit.json" 2>/dev/null || true   # exit 1 = advisories exist
node -e "const j=require('$OUT/before-audit.json');console.log(JSON.stringify(j.metadata?.vulnerabilities));for(const a of Object.values(j.advisories??{}))console.log(a.severity,a.module_name,a.vulnerable_versions,a.findings?.map(f=>f.version).join(' '))"
```

- `pnpm check:types` stops at the first failing package, so the baseline above, every
  trial, and step 7 run `pnpm -r --parallel --no-bail check:types` to see every error.
- A parallel `pnpm test` can fail once with `ENOTEMPTY` on `node_modules/.vitest-cache`
  after a dependency change. Run it again once before you call it a regression.

## 3. Analyze (read-only)

```bash
node "$SKILL/scripts/analyze-outdated.mjs"  --root "$WT" > "$OUT/npm-plan.json"
node "$SKILL/scripts/analyze-toolchain.mjs" --root "$WT" > "$OUT/toolchain-plan.json"
# For each extra pnpm project from step 1, for example examples/node:
node "$SKILL/scripts/analyze-outdated.mjs"  --root "$WT/examples/node" > "$OUT/npm-plan-examples-node.json"
```

**`npm-plan.json`**

- `safe`: patch bumps and minor bumps of `>=1.x` versions. `upCommands` gives the
  `pnpm -C '<root>' up` commands. Some packages have different versions in
  different projects, for example `next` 16 and `next` 15. Their command has `--filter`, so
  pnpm does not rewrite the range of the other projects. Each entry is one name and one
  installed version.
- `needsApproval`: majors, `0.x` minors, and `0.0.x` patches (all breaking under caret
  rules).
  - `requires` names other majors that must move with this one. `requiresUnknown` lists
    peer ranges that the script could not parse: check them by hand.
  - `ifDeclined` is the version that the lockfile lands on if the user says no. That move
    stays inside the current range, so it needs no changeset.
  - `regenOnly: true` means an open `>=` range: only the lockfile regeneration moves it.
    If the user approves, add the name to `--expect-majors` in step 6. If the user
    declines, add an upper bound with an override.
- `held`: exact-version overrides (also on transitive packages), and deprecated packages
  that are already on their final release.
- `regen`: dependencies with only open `>=` ranges. No specifier changes, but the lockfile
  regeneration in step 5.9 moves them.
- `overrideMoves`: open whole-package overrides that the regeneration moves. `major: true`
  needs approval. `otherOverrides`: range-selector (`ws@<=8.22.0`) and path (`a>b`)
  overrides with the newest aged version. Recheck that each lift or floor is still current.
- `tooFresh`: updates where every newer version is younger than the gate.
- `fastTrack`: every fresh release that the gate holds back, with red flags and the exact
  exclude entries that installing it needs. Every entry of `excludeSet` is checked
  (`checkedAgainst`). `fastTrackSkipped` lists fresh majors: a major is never
  fast-tracked. See `references/fast-track.md`.
- `targetMismatch`: entries where the predicted target differs from pnpm's gated resolver.
  Trust pnpm, and report the difference.
- `changeset`: each package that Changesets versions, with its safe runtime bumps. The
  script reads `.changeset/config.json` (`ignore`, `privatePackages.version`). Projects
  outside `packages/` (examples, e2e) never get one. `changesetIfApproved` gives the same
  for the majors.
- `peerFloors`: caret or tilde peer ranges of versioned packages that are behind the latest
  release. Ask the user in step 4.
- `staleExcludes`: `minimumReleaseAgeExclude` entries whose version has aged out.
- `kind`: `runtime-published` ships to users ("runtime (released)" in the table).
  `runtime-private` is a private app or the root. `dev` does not ship.

**`toolchain-plan.json`**

- `actions.actions[]`: one entry for each action, keyed by `repo` (`owner/name`): `status`
  (`safe`, `needs-approval`, `up-to-date`, `too-fresh`), `target`, `targetSha`,
  `targetCommitDate`, `targetImmutable`, `approvalReason`, and `pinMatchesComment`
  (`true`, `false`, or `null` when it could not be checked). The script resolves each tag
  through `git/ref/tags` and ages the commit as well as the release. Only an immutable
  release with an aged commit and a matching current pin is `safe`. A mutable release, a
  moved tag, or a mismatched pin needs approval; `approvalReason` says why.
- `safeActions` (top level) is the list for `--actions`. `ciTools[]` lists tool versions
  that CI hardcodes, keyed by `pkg`; `safeTools` (top level) is the list for `--tools`.
- `pnpm`: the current and target `packageManager`, and any pnpm version hardcoded in CI.
- `node`: the Node versions in CI and the latest LTS. Aliases such as `lts/*` follow the
  latest release by themselves.

Do these checks next:

- **Preview the regeneration.** Transitive moves and most advisory fixes come only from
  the lockfile regeneration, so show them now. This is a trial; revert it.
  ```bash
  cp pnpm-lock.yaml "$OUT/lock.backup" && cp pnpm-workspace.yaml "$OUT/ws.backup"
  # pnpm rebuilds a deleted lockfile from this copy; move it aside, or nothing changes.
  mv node_modules/.pnpm/lock.yaml "$OUT/modules-lock.backup"
  rm pnpm-lock.yaml && pnpm install --lockfile-only > "$OUT/regen-preview.log" 2>&1
  node "$SKILL/scripts/lockfile-report.mjs" --root "$WT" > "$OUT/regen-preview.json" 2> "$OUT/regen-preview.md"
  pnpm audit --json > "$OUT/regen-preview-audit.json" 2>/dev/null || true
  git diff -- pnpm-workspace.yaml   # exclude entries that pnpm added by itself
  cp "$OUT/lock.backup" pnpm-lock.yaml && cp "$OUT/ws.backup" pnpm-workspace.yaml
  mv "$OUT/modules-lock.backup" node_modules/.pnpm/lock.yaml
  git status --short                # must be empty again
  ```
  If the preview says "identical to the base", it did not run: check the `mv` above.
  Put the preview's results in the table, in the area "npm lockfile". Include the major
  jumps with their causes, the new splits, the added versions, and the exclude entries
  that pnpm added. A STOP in the preview is not an error here: each STOP item becomes a
  question in step 4. Compare `regen-preview-audit.json` with `before-audit.json` to see
  which advisories the regeneration fixes. An advisory is fixed only if its vulnerable
  versions no longer appear.
- **The holds of the last bump PR.** `gh pr list --search` sorts by relevance, so sort by
  merge date:
  ```bash
  gh pr list --repo "$GH_REPO" --state merged --search '"chore: bump packages" in:title' --limit 10 \
    --json number,title,mergedAt --jq 'sort_by(.mergedAt) | reverse | .[0:3]'
  ```
  In the latest PR, read the section about held-back packages. It is a heading or a bold
  line, for example "Held back" or "Held back on purpose". For each hold:
  1. A hold whose only reason was the age gate is gone. Do not recheck it.
  2. Compare it with `origin/main`. Another PR can lift a hold. Run
     `git log --oneline origin/main -- <package.json path>` to find it. Then report
     "already lifted on main by #N".
  3. If the hold is still on `main`, check that the reason is still true. For example,
     check whether the upstream issue is still open, or whether a newer release fixes it.
     A known example hold (for example Next.js 15 in `examples/nextjs15`) needs no
     changelog research.
  4. Report the holds that you can lift, and the holds that stay with their reason.
- **Pins.** If `pinMatchesComment` is `false`, the SHA of an action is not the commit of
  its version comment. Report this as a security finding. Do not fix it silently. If it is
  `null`, say "not verified" and rerun.
- **Majors.** Research the breaking changes as `references/breaking-changes.md`
  describes. Do this for each entry in `needsApproval`, each action or CI tool major, a pnpm major
  (`pnpm.status` is `needs-approval`), each `overrideMoves` entry with `major: true`, and
  each major jump in the preview. A known
  hold from the last bump PR is not a new decision. An example is TypeScript 7 in some
  examples. Show it as "held (known)" with its reason. Do not research it again.
- **Fast-track.** Review the `fastTrack` candidates as `references/fast-track.md`
  describes. The default is to wait: the version lands on the next run anyway.

## 4. Show the upgrade table and stop

Give the user one message that contains these items:

1. **One table for all areas.** Use the template in `references/pr-body.md` ("Upgrade
   table"). The areas are npm runtime (released), npm runtime (private), npm dev, npm
   lockfile, GitHub Actions, CI tools, pnpm, and Node. The Plan column is one of: auto,
   needs approval, held, lockfile regen, too fresh, or fast-track?. Add a short note in
   brackets when it helps, for example "auto (2.57.17 is <24h, eligible in ~5h)". Collapse
   the actions that are up to date into one row. A family that moves to the same version
   (for example `@dynamic-labs/*`) can use one row.
2. One breaking-changes block for each major. Give the `ifDeclined` version too.
3. The fast-track group: each candidate with its age, red flags, exclude set, the reason
   from its notes, and your recommendation.
4. The holds: the ones that stay and the ones that you propose to lift.
5. The aged-out exclude entries that you will remove.
6. The paths of `$WT` and `$OUT`.

Save the same message to `$OUT/upgrade-table.md`. A later session can then continue.

Then ask with `AskUserQuestion`. Give one option for each major, each proposed lift, each
recommended fast-track, and the peer floors. Majors that `requires` links go in one
option, because one does not install without the other. Add the option "Apply the auto
bumps and open the PR". One question takes at most 4 options, and one call takes at most
4 questions. Use multi-select questions, grouped by topic. If there are more items, number
them in the message and ask the user to answer with the numbers.

If you cannot ask, stop after the table and return it. This applies to a subagent or a
non-interactive run, or when the user asked for the table only. Do not make changes that
nobody approved.

## 5. Apply the changes as separate commits

First run `git -C "$REPO" fetch origin`. If `origin/main` moved since step 1 and the
worktree has no commits, run `git -C "$WT" merge --ff-only origin/main`. Then run
`pnpm install --frozen-lockfile` and steps 2–3 again. A stale base gives lockfile
conflicts in the PR. If more than about 3 hours passed since step 3, run both scripts
again first. Targets
and held-back versions change quickly. A fast-track candidate that has aged in the
meantime needs no exclude entry.

Keep the commits in this order. A reviewer can then drop one change. The lockfile
regeneration is always last, so it covers everything before it.

1. **`chore: allow <pkg>@<version> past the release-age gate`**, only for approved
   fast-tracks. Add to `minimumReleaseAgeExclude` exactly the `excludeSet` that the user
   saw in step 4. It is in `$OUT/upgrade-table.md`. Add a dated line with the reason to
   the comment block above the key. If an extra pnpm project uses the same
   package, add the same entries to its `pnpm-workspace.yaml` too. If a rerun gives a
   different set, stop and ask the user again.
2. **`chore: bump packages`**. Run each command in the plan's `upCommands`. Also run the
   `upCommand` of each approved fast-track candidate. pnpm's gated resolver now returns its
   fresh version. Check
   `git diff -- '**/package.json'`. Each new version must equal the plan's `target`, or
   the approved fast-track version. pnpm keeps `^`, `~`, exact pins, and `>=` floors as
   they are. If a version is newer than expected, the gate is not active: check
   `pnpm --version` (it must be 12.x) and stop. A bump can overtake an open override
   floor, for example `viem: ^2.57.7` when viem moves to 2.57.16. Then move the floor to
   the new version in the same commit. For widget, also move the example pins (see
   `references/repo-notes.md`). A Biome bump can change the formatter, so the hook's
   `pnpm check` fails on files that the bump did not touch. Prefer a config fix in
   `biome.json` that keeps the old output. An example is
   `"yaml": { "formatter": { "quoteStyle": "single", "bracketSpacing": false } }` for
   Biome 2.6. Run `pnpm check:write` only if no option keeps the old output. Report new
   lint warnings in the PR.
3. **`chore(examples): bump packages`**, for each extra pnpm project. Run the `upCommands`
   of its plan (they already carry `-C <project>`), then `pnpm -C <project> install`.
4. **`chore: bump <pkg> to <major>`**, one commit for each approved major or group. Run
   `pnpm -C "$WT" up -r --latest <pkg> [<required pkg>]`, then make the migration edits.
   If a hold applies only to some projects, add `--filter '!<project>'`. If the migration
   is large, revert the package and report it as deferred.
5. **`ci: bump GitHub Actions and CI tools`**. Run
   `node "$SKILL/scripts/analyze-toolchain.mjs" --root "$WT" --apply "$OUT/toolchain-plan.json" --actions <safeActions + approved> --tools <safeTools + approved>`.
   The script writes only a 40-hex SHA and an `x.y.z` version, and never moves a line
   down. It prints one JSON object. Read the `missing` and `skipped` lists of each part.
   A skipped line has a version that the script cannot read, for example `@v5`. Check
   each one by hand.
6. **`chore: move peer floors to the latest releases`**, only if the user approved it. Edit
   the `peerDependencies` ranges from `peerFloors` by hand.
7. **`chore: prune aged-out release-age exclusions`**. Remove only the `staleExcludes`
   entries from `minimumReleaseAgeExclude`. Keep `@bigmi/*`, `@lifi/*`, and the entries
   that step 5.1 added. pnpm deletes comments between the items. So update the comment
   block above the key. Do the same in each extra pnpm project.
8. **`chore: add changesets for the dependency bump`**. Use the `changeset` skill of the
   repo. Give each package in the plan's `changeset` map a `patch` with a one-line summary.
   Add the `changesetIfApproved` lines of the approved majors, and the
   `changesetPackages` of each approved fast-track. Dev-only bumps and private projects get
   no changeset.
9. **`chore: bump pnpm to <X> and regenerate the lockfile`**. Do the steps of the repo's
   `regen` script by hand. Never run `pnpm regen` itself: it runs
   `corepack use pnpm@latest`, and corepack has no age gate. Use `pnpm.target` from the
   toolchain plan. If it is null, pnpm is up to date: use `pnpm.current`, and name the
   commit `chore: regenerate the lockfile`. A pnpm major (`pnpm.status` is
   `needs-approval`) needs the user's approval in step 4, like any other major.
   ```bash
   P=$(node -p "const p=require('$OUT/toolchain-plan.json').pnpm; p.target ?? p.current")
   [ -n "$P" ] || exit 1
   rm -f pnpm-lock.yaml && pnpm clean:modules
   COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack use "pnpm@$P"
   node -p "require('./package.json').scripts.regen" | grep -q dedupe && pnpm dedupe
   pnpm build
   ```
   An extra pnpm project has its own `packageManager`. Run
   `(cd <project> && corepack use "pnpm@$P")` for each one, in the same commit.
   Otherwise its frozen install fails with `ERR_PNPM_BAD_PM_VERSION`.
   Step 6 checks the age of the new pnpm version as well.

Each commit runs the husky hooks of the repo. If a hook fails on an error that the
step-2 baseline already has, you may use `--no-verify` for that commit. Write this in
the PR. Never use `--no-verify` to hide a failure that the bump caused.

## 6. Review the regenerated lockfile

```bash
APPROVED="<the approved excludeSet entries, comma-separated, or empty>"
MAJORS="<the package names of the approved majors, comma-separated, or empty>"
node "$SKILL/scripts/lockfile-report.mjs" --root "$WT" --approved "$APPROVED" \
  --expect-majors "$MAJORS" > "$OUT/lockfile.json"
# For each extra pnpm project, against its own lockfile on main, with the same approvals:
node "$SKILL/scripts/lockfile-report.mjs" --root "$WT/examples/node" --approved "$APPROVED" \
  --expect-majors "$MAJORS" > "$OUT/lockfile-examples-node.json"
```

The summary ends with `Result: OK` or `Result: STOP`. On STOP, fix the cause first.

- **Major jumps.** Every major jump outside `--expect-majors` is a STOP. It comes from an
  open override or a transitive range (often a dependency of an approved bump). Find the
  cause with `pnpm why <pkg>`. Then add an upper bound to the override, or show the jump
  to the user. If the user keeps it, add the name to `--expect-majors` and run again.
- **Single-copy packages.** `@lifi/sdk`, `@lifi/types`, `wagmi`, `viem`, and
  `@creit.tech/stellar-wallets-kit` must each have one copy in each app. Two copies cause
  runtime errors such as "Execution data not found". The report counts runtime instances
  (peer variants too) and compares them with `main`. A "same split as main" is known:
  report it. For a "NEW SPLIT", run `pnpm dedupe`, then confirm per app with
  `pnpm --filter <app> why <pkg>`.
- **Fresh third-party versions.** A STOP comes from two cases: a version younger than the
  gate that is not excluded, and a version whose age npm did not return. Do not ship it. Find the cause.
  The report trusts only the exclude list of `main` plus `--approved`.
- **Unapproved exclude entries.** pnpm's default gate is not strict. When no mature
  version fits a range, pnpm installs a fresh one. It also adds that version to
  `minimumReleaseAgeExclude` by itself. Each such new entry is a STOP. Show it to the user.
  Keep it only if the user approves it. It is then a fast-track. Otherwise remove it, and
  find the range that needs it.

## 7. Validate against the baseline

Run the same checks as in step 2, but write the results to `$OUT/after-*.txt`. Do not
overwrite the `before-*` files. Also run
`pnpm install --frozen-lockfile`, `pnpm build`, `pnpm dedupe --check`, `pnpm audit`,
and `pnpm changeset status`. If the repo has `scripts/size-measure.mjs`, run
`node scripts/size-measure.mjs . "$OUT/size.json"`. The CI `bundle-size` job compares it
with `main` on the PR. For
each extra pnpm project, run `pnpm -C <project> install --frozen-lockfile` and its type
check (for example `pnpm -C examples/node exec tsc --noEmit`). Restore the `version.ts`
files afterwards.

- Compare every output with its `before-*` file. Only a new error is a regression.
  Compare the test counts with `before-test-count.txt`.
- If a runtime or UI dependency had a major, run the e2e suite as
  `references/repo-notes.md` describes.
- **If something breaks**, the regeneration commit must stay last. Drop it, fix, and
  regenerate again. This is safe, because the regeneration is reproducible:
  1. Confirm that `git log -1 --format=%s` starts with `chore: bump pnpm to`. Then run
     `git reset --hard HEAD~1`.
  2. Small break: add a commit `fix: adapt to <pkg> <version>`. Large break in a
     per-major commit (5.4): run `git revert --no-edit <sha>`. Large break in the batched
     `chore: bump packages` commit: do not revert the batch. Put only that package back:
     `pnpm -C "$WT" up -r <pkg>@<its old version>` (keep the old range prefix), commit it
     as `chore: keep <pkg> at <version>`. In both cases remove that bump from the
     changeset files in a commit `chore: update changesets`, and report it as deferred.
  3. Run step 5.9 again, then steps 6 and 7.
- Local Node can be older than the Node 26 in CI. If a failure appears only locally, say so.

## 8. Push and open the PR

```bash
git push -u origin HEAD
gh pr create --repo "$GH_REPO" --base main --title "chore: bump packages" \
  --body-file "$OUT/pr-body.md"
```

Write the PR body from the template in `references/pr-body.md`. Write it in Simplified
Technical English: short sentences, active voice, one term for one thing. Open the PR
ready for review, not as a draft.

## 9. Report to the user

Give the final upgrade table, the PR link, the holds, the fast-tracked versions, the
deferred majors, and the validation result. Each held-back or deferred item needs one
line that says why, so that nothing is silently lost. List old bump worktrees whose PRs
are merged, so that the user can remove them.

## More than one repo

The user can ask for a bump in sdk, widget, and jumper-widget together. Run one subagent
for each repo. Give each one the path of **this** `SKILL.md`, the copy that you are
reading. Another checkout can hold an older copy on a feature branch. Also give the main
checkout of its repo as `REPO`, and the instruction to stop at step 4. Merge the three tables into one message,
and ask once. Then continue each repo with its approved list. A widget bump usually wants
the newest `@lifi/sdk`. If the sdk bump releases a new SDK version, say so to the user.
