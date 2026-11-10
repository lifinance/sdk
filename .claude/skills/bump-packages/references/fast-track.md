# Fast-track a fresh release past the age gate

pnpm 12 holds back a version that is younger than 24h. The gate stops a hijacked release from
reaching the repo before the community notices it. The repos want the newest fixes, so a
fresh release goes through the gate with an entry in `minimumReleaseAgeExclude` when the
security checks below pass. Each entry lets **one exact version** through.

## Rules

- **Clean patches and minors with provenance go in by default.** The script gives each
  fresh release a `decision`:
  - `auto`: every entry of its exclude set passed every check, and each entry and its
    reference version have provenance from the same repo and workflow. Add the `auto`
    entries without a question, and list them in the table and in the PR.
  - `needs-approval`: no red flag, but one side has no provenance. Then the checks cannot
    see a code-only release from a hijacked account (`debug` 4.4.2 in September 2025 had
    no provenance, the same publisher, and no install script). It goes in only if the user
    names it. `needsApprovalExcludes` gives the sets.
  - `blocked`: a red flag. Report it to the user with the flag.
- **A compromise flag blocks every fresh version.** These flags are the compromise class:
  a malware advisory, a publisher change, dropped or changed provenance, and a new or
  changed install script. A reviewed (non-malware) advisory flags only its own version. One such flag on any fresh version blocks all fresh versions of that
  package and of its family. An attacker can publish more than one bad version.
- **Other flags fall back.** For a range, coverage, spec, or new-dependency flag, the
  script tries the next older fresh version (`tried`). The flags of the skipped versions
  stay in `skippedFlags`: report them. If no fresh version passes, the package lands on
  its aged target, and the blocked version lands later through the normal gate.
- **Majors keep their own approval.** A fresh major (or `0.x` minor) is in
  `fastTrackSkipped`. It is never fast-tracked without the user's approval. When the user
  approves it, review it as a major (`breaking-changes.md`) and run the checks below.
- **Actions and CI tools keep the gate.** They have no exclude list. A fresh action or
  tool version waits for the next run (status `too-fresh`).
- **Exact versions only.** Write `viem@2.57.17`, never `viem`. A bare name would let every
  future release through at once, also a hijacked one. The repo comments above the key
  say the same. The only bare entries are the first-party `@bigmi/*` and `@lifi/*`. The
  script refuses to print an `autoExcludes` entry that is not an exact `name@version`.
- **One family, one decision.** Packages that move together (`next` and `@next/*`,
  `typescript-eslint` and `@typescript-eslint/*`, `motion` with `framer-motion` and
  `motion-dom`, `@dynamic-labs/*`) get one exclude set in `fastTrackFamilies`. The script
  joins packages only through this list, lockstep pins, or a shared exclude entry. The
  weakest member decides: one `blocked` member blocks the family, and one
  `needs-approval` member makes the family `needs-approval`. A half-installed family
  gives two copies or a peer conflict.
- **Who edits the exclude list.** In auto mode, the permission system can block an exclude
  edit that a subagent makes. Then the subagent stops and returns the exact entries. The
  session that has the user's instruction makes the edit.
- **Commit the exclusion.** CI runs `pnpm install --frozen-lockfile` with the committed
  `pnpm-workspace.yaml`. Never install with `--config.minimum-release-age=0`.
- **The entry cleans itself up.** The version passes the gate after 24h. The next run
  then lists it in `staleExcludes`, and step 5.7 removes it.

## What the script checks (`fastTrack` in `npm-plan.json`)

For each fresh version, the script compares it with the version that lands without the
fast-track (or with the current one). It runs the same checks on every entry of
`excludeSet`. The reference is the aged release just below the entry, the one it
replaces. If there is none below, it is the newest aged release. `checkedAgainst` names
that version. A check that cannot run (a network error, or data that the reference has and
the fresh version does not) is a red flag, never a pass.

| Check | Red flag when |
|---|---|
| Malware advisory | The GitHub advisory database has a malware advisory, or a high or critical advisory, for that exact version, or a malware advisory of the package covers any fresh version. |
| Publisher (`_npmUser`) | It changed, or it is missing on either side. |
| Provenance | The old version has it and the fresh one does not, or it cannot be read. If neither has it, the decision is `needs-approval`. |
| Provenance source | The source repo or the build workflow in the attestation changed. |
| Install scripts | A `preinstall`, `install`, or `postinstall` is new or changed. |
| Dependencies | The fresh version adds a dependency, optional dependency, or peer. |
| Ranges | A dependency range changed so that only a fresh version meets it (a lockstep pin of the same version is only a note). |
| Specs | A dependency now uses an `npm:` alias, a git, URL, or file spec. An alias is checked as the real package. |
| Coverage | A range only a prerelease meets, or the walk stopped at 4 levels with work left. |

`excludeSet` lists every exact entry that the install needs. That is the fresh version,
and each dependency whose range no aged version satisfies. The walk goes 4 levels deep. For such a range, the
script takes the **earliest** fresh version that meets it. Then a later release by the
same publisher cannot slip in. Example: `vite@8.3.7` also needs `rolldown@1.2.18`. If a
rerun gives a different set, use it only if each family in it is still `auto`, and report
the change.

**Aged versions are not checked by the gate.** An aged target that adds a dependency
(`newDependencies` on a `safe` entry) lands without a check. Example: `@dynamic-labs/waas-svm`
5.15.0 added `tweetnacl`. Name each one in the table. Look at what it is: its publisher,
its age, and its downloads (`npm view <dep> _npmUser time.created`). It is a note, not a
block.

**Known limits.** The script reads the provenance statement and checks its subject, but it
does not verify the Sigstore signature. It cannot see a code-only change in a package
without provenance: that is why such a package needs the user. A minimum age before
`auto` (for example 6 h) and a scan of the code diff are possible later additions.

## What you check

The checks above cover the supply chain only. A clean fresh release can still change
behavior. For each runtime fast-track (`kind` is `runtime-published` or
`runtime-private`):

1. Read the release notes of the fresh version (`gh release view <tag> --repo <org>/<repo>`,
   or its `CHANGELOG.md`).
2. Give one line about what it changes, with the link. If it changes the behavior of an
   API that this repo uses, find the usage with `git grep -n "from '<pkg>" -- packages`.
   Name the files in the PR, and check them in step 7 (unit tests, e2e, or a visual check).
   Example: `motion` 14.12.0 changes how `spring` with `visualDuration` and `bounce` uses
   `velocity`, so the widget animations that use it need a look.
3. In the table, give: version, age, the result of each check, the exclude set, and the
   decision.

## The commit (step 5.1)

One commit for all fast-tracks of the run. Add one dated comment line for each entry:

```yaml
# … existing comment lines …
#   - 2026-11-10: i18next 27.1.1 inside the age window (fast-track: all checks pass).
#   - 2026-11-10: motion, framer-motion, motion-dom 14.12.0 (one family).
minimumReleaseAgeExclude:
  - '@bigmi/*'
  - '@lifi/*'
  - framer-motion@14.12.0
  - i18next@27.1.1
  - motion-dom@14.12.0
  - motion@14.12.0
```

Commit message: `chore: allow fresh releases past the release-age gate` (for one entry:
`chore: allow <pkg>@<version> past the release-age gate`). Then step 5.2 lands the
versions: pnpm's gated resolver now returns them as the latest.

## In the PR body

Add a section "Allowed past the release-age gate". For each fast-track, give its age, what
it changes with a link, the exclude set, and the checks. Put each blocked version under
"Held back on purpose", with its red flag.
