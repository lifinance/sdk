# Fast-track: a fresh release past the age gate

pnpm 12 holds back a version that is younger than 24 h. The gate stops a hijacked release from
reaching the repo before the community finds it. The repos also want the newest fixes. So
the script lets a fresh patch or minor through with an exact `name@version` entry in
`minimumReleaseAgeExclude`, but only when the checks below pass. You do not edit the exclude
list by hand: the script does it.

## The three decisions

| Decision | When | What happens |
|---|---|---|
| auto | No red flag. Each entry of the exclude set, and the release it replaces, have provenance from the same repo and workflow. Each entry is at least 6 h old. | The script applies it without a question. |
| needs approval | No red flag, but one side has no provenance, or an entry is younger than 6 h. | It goes in only when the user names it: `--approve <entries>`. |
| blocked | A red flag. | It waits for the normal gate. `--approve` is refused for a compromise flag, for an advisory, and for a check that could not run. |

- **Why provenance.** For a package without provenance, the checks cannot see a code-only
  release from a hijacked account. `debug` 4.4.2 (September 2025) had the same publisher, no
  provenance, and no install script.
- **Why 6 h.** The script builds and tests on this machine right after the bump. Recent npm
  compromises were found within about 3 to 4 h. `fastTrackMinAgeHours` in
  `.claude/bump-packages.json` on `main` can change the value.
- **Majors** are never fast-tracked. Actions and CI tools have no exclude list, so they keep
  the gate.

## The checks

The script compares each entry with the aged release that it replaces. A check that cannot
run is a red flag, never a pass.

| Check | Red flag when | Class |
|---|---|---|
| Malware advisory | The GitHub advisory database has a malware advisory for the version, or for the package with a range that covers a fresh version. | compromise |
| Publisher | The npm publisher changed, or the trusted publisher is gone or different. | compromise |
| Provenance | The old release has it and the fresh one does not, or the source repo or the workflow changed. | compromise |
| Install scripts | A `preinstall`, `install`, or `postinstall` is new or changed. | compromise |
| Reviewed advisory | A high or critical advisory covers that exact version. | other |
| Dependencies | A new dependency, optional dependency, or peer. A range that only a fresh version meets. An `npm:` alias, a git, URL, or file spec. | other |

- **A compromise flag blocks every fresh version** of the package and of its family. An
  attacker can publish more than one bad version.
- **Another flag falls back** to the next older fresh version. The summary shows the flags
  of the skipped versions.
- **One family, one decision.** Packages that move together (`next` and `@next/*`,
  `typescript-eslint` and `@typescript-eslint/*`, `motion` with `framer-motion` and
  `motion-dom`, `@dynamic-labs/*`) get one exclude set. The weakest member decides.
- **The exclude set** holds every exact entry that the install needs: the fresh version and
  each dependency whose range no aged version meets.

## Limits

- The script reads the provenance statement from the npm registry. npm verified its
  signature at publish time. The script does not verify the Sigstore signature again.
- Same repo and same workflow does not help when an attacker controls that workflow. The
  6 h floor and the advisory check reduce this risk; they do not remove it.
- An aged release gets no fast-track checks. If it adds a dependency, the summary lists it
  under "Not applied by the script" as a note. Look at what the new dependency is.

## Cleanup

An entry is needed only while its version is younger than the gate. A later run removes it,
with its comment line.
