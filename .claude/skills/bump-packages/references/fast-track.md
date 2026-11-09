# Fast-track a fresh release past the age gate

pnpm 12 holds back a version that is younger than 24h. The gate stops a hijacked release from
reaching the repo before the community notices it. Sometimes a fresh release has a fix
that the repo needs now, for example a security fix in `viem`. Then the user can let that
**one exact version** through with an entry in `minimumReleaseAgeExclude`.

## Rules

- **Exact versions only.** Write `viem@2.57.17`, never `viem`. A bare name would let every
  future release through at once, also a hijacked one. The repo comments above the key
  say the same. The only bare entries are the first-party `@bigmi/*` and `@lifi/*`.
- **The user approves each one** at the step-4 checkpoint. The default is to wait: the
  version passes the gate by itself within `eligibleInHours`, and the next run takes it.
- **Commit the exclusion.** CI runs `pnpm install --frozen-lockfile` with the committed
  `pnpm-workspace.yaml`. Never install with `--config.minimum-release-age=0`.
- **The entry cleans itself up.** The version passes the gate after 24h. The next run
  then lists it in `staleExcludes`, and step 5.7 removes it.

## What the script checks (`fastTrack` in `npm-plan.json`)

For each fresh version, the script compares it with the version that lands without the
fast-track (or with the current one). It runs the same checks on every entry of
`excludeSet`. The reference is the aged release just below the entry, the one it
replaces. If there is none below, it is the newest aged release. `checkedAgainst` names
that version:

| Check | Red flag when |
|---|---|
| Publisher (`_npmUser`) | It changed, or it is missing on either side. |
| Provenance (`dist.attestations`) | The old version has it and the fresh one does not. |
| Install scripts | A `preinstall`, `install`, or `postinstall` is new or changed. |
| Dependencies | The fresh version adds a dependency, optional dependency, or peer. |
| Ranges | A dependency range changed so that only a fresh version meets it (a lockstep pin of the same version is only a note). |
| Specs | A dependency now uses an `npm:` alias, a git, URL, or file spec. An alias is checked as the real package. |
| Coverage | A range only a prerelease meets, or the walk stopped at 4 levels with work left. |

`excludeSet` lists every exact entry that the install needs. That is the fresh version,
and each dependency whose range no aged version satisfies. The walk goes 4 levels deep. For such a range, the
script takes the **earliest** fresh version that meets it. Then a later release by the
same publisher cannot slip in. Example: `vite@8.3.7` also needs `rolldown@1.2.18`. Add the set
exactly as the user approved it. If a rerun gives a different set, ask again.

A fresh **major** (or `0.x` minor) is never fast-tracked. The script lists it in
`fastTrackSkipped`: wait until it ages, then review it as a major.

A candidate with a red flag is never recommended. Report the red flag to the user.

## What you check (only for a candidate without red flags)

Do this only for runtime dependencies (`kind` is `runtime-published` or
`runtime-private`), unless the user asks about a dev tool:

1. Read the release notes of the fresh version (`gh release view <tag> --repo <org>/<repo>`,
   or its `CHANGELOG.md`).
2. Sort it into one of these:
   - **Security fix**: an advisory or a CVE. Recommend the fast-track.
   - **Bug fix in an API this repo uses**: check the usage with
     `git grep -n "from '<pkg>" -- packages`. Recommend the fast-track.
   - **Anything else**: features, refactors, fixes in code the repo does not call.
     Recommend to wait.
3. In the table, give these items: version, age, and eligible in ~Nh. Also give the red
   flags, the exclude set, the class from item 2 with a link, and your recommendation.

## The commit (step 5.1)

```yaml
# … existing comment lines …
#   - 2026-11-09: viem 2.57.17 deliberately inside the age window: it fixes
#     <one line, with the advisory or issue link>.
minimumReleaseAgeExclude:
  - '@bigmi/*'
  - '@lifi/*'
  - viem@2.57.17
```

Commit message: `chore: allow viem@2.57.17 past the release-age gate`. Then step 5.2 lands
the version: pnpm's gated resolver now returns it as the latest.

## In the PR body

Add a section "Allowed past the release-age gate". For each version, give the reason and
its link, and the exclude set. Also give the checks: publisher, provenance, install
scripts, and dependencies.
