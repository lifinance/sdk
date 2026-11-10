#!/usr/bin/env node
// lockfile-report.mjs — compare pnpm-lock.yaml with a base ref after the regeneration.
//
// `pnpm outdated` sees direct dependencies only. A regeneration can also move transitive
// packages, e.g. an open override (`preact: ">=10.29.1"`) that jumps a major. This script
// uses two refs:
//   - the compare base (--base, default: the merge-base of HEAD and origin/main). Any
//     ancestor of HEAD, e.g. the head of an open bump PR branch. All diffs use it.
//   - the trust anchor: always the merge-base of HEAD and origin/main. Only its
//     minimumReleaseAgeExclude list (reviewed and merged) plus --approved is trusted, so
//     --base cannot widen the trusted list.
// It reports, against the compare base:
//   - transitive and direct major jumps,
//   - new duplicate copies, and the copies of the single-copy packages,
//   - every added version with its age, and the ones younger than the release-age gate
//     (unless --skip-age),
//   - new minimumReleaseAgeExclude entries that nobody approved. pnpm's default gate is
//     not strict: when no mature version fits, pnpm installs a fresh one and adds it to the
//     list by itself. So the gate check trusts only the ANCHOR list plus --approved entries.
// Output: JSON on stdout, Markdown on stderr. Read-only. Exits 2 (fail closed) when a base
// is not usable: no merge-base with origin/main, a --base that is not an ancestor of HEAD,
// or no lockfile on the compare base.
//
// Usage: node lockfile-report.mjs [--root <repo>] [--base <ancestor of HEAD>]
//        [--watch name,name] [--skip-age] [--approved name@1.2.3,name@4.5.6]
//        [--expect-majors name,name]   (the majors the user approved)

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ageHours,
  breakingLines,
  cmpRaw,
  isExcluded,
  isStopJump,
  isVersionLike,
  minAgeMinutesFromYaml,
  npmView,
  parseExcludes,
  parseLock,
  parseParents,
  parseSelector,
  parseVersion,
  pool,
  readText,
  readWorkspaceYaml,
  resolveLockfileBases,
  yamlList,
  yamlMap,
} from './lib.js'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    base: { type: 'string' },
    watch: { type: 'string' },
    'skip-age': { type: 'boolean' },
    approved: { type: 'string' },
    'expect-majors': { type: 'string' },
  },
})
const root = values.root ? resolve(values.root) : process.cwd()
const git = (args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
// The merge-base, not origin/main itself: origin/main can move while the branch is open
// (another session fetches); its new commits are not changes of this branch.
let baseRef
let trustAnchor
try {
  ;({ compareBase: baseRef, trustAnchor } = resolveLockfileBases(
    values.base,
    git
  ))
} catch (err) {
  process.stderr.write(`${err.message}\n`)
  process.exit(2)
}

// Packages that must be single-copy in these repos (see each repo's CLAUDE.md).
const DEFAULT_WATCH = [
  '@lifi/sdk',
  '@lifi/types',
  '@bigmi/core',
  '@bigmi/client',
  '@bigmi/react',
  'viem',
  'wagmi',
  '@wagmi/core',
  '@tanstack/react-query',
  '@creit.tech/stellar-wallets-kit',
  'react',
  'react-dom',
]

// The "breaking line" of a version under caret rules: the major, or 0.minor, or 0.0.patch.
// A new line on the branch is a breaking move (2.x, but also 0.3 -> 0.4).
async function main() {
  const headText = readText(root, 'pnpm-lock.yaml')
  let baseText = ''
  try {
    // `./` makes the path relative to --root, so an extra project (examples/node) is
    // compared with its own lockfile on the base, not with the root one.
    baseText = execFileSync('git', ['show', `${baseRef}:./pnpm-lock.yaml`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    // Without a base every package looks "added" and no major jump shows: fail closed.
    process.stderr.write(
      `Cannot read ${baseRef}:pnpm-lock.yaml (${String(err.message).split('\n')[0]}). Run git fetch --no-prune-tags origin, then run again.\n`
    )
    process.exit(2)
  }
  if (!headText) {
    process.stderr.write('No pnpm-lock.yaml in --root.\n')
    process.exit(2)
  }
  const head = parseLock(headText)
  const parents = parseParents(headText)
  const base = parseLock(baseText)
  const headSnap = parseLock(headText, 'snapshots')
  const baseSnap = parseLock(baseText, 'snapshots')
  const yaml = readWorkspaceYaml(root)
  // A project without pnpm-workspace.yaml on a ref has no exclude list there.
  const yamlAt = (ref) => {
    try {
      return git(['show', `${ref}:./pnpm-workspace.yaml`])
    } catch {
      return ''
    }
  }
  const baseYaml = yamlAt(baseRef)
  const anchorYaml = trustAnchor === baseRef ? baseYaml : yamlAt(trustAnchor)
  const approved = (values.approved ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Only exact `name@x.y.z` entries: a bare name or a glob would exempt every version.
  const badApproved = approved.filter(
    (a) => !/^(@[^/@\s]+\/)?[^/@\s*|,]+@\d+\.\d+\.\d+(-[\w.-]+)?$/.test(a)
  )
  if (badApproved.length) {
    process.stderr.write(
      `--approved takes exact name@x.y.z entries only: ${badApproved.join(', ')}\n`
    )
    process.exit(2)
  }
  // Trusted: the exclude list of the trust anchor (merged on main), never of --base.
  const anchorEntries = yamlList(anchorYaml, 'minimumReleaseAgeExclude')
  const headEntries = yamlList(yaml, 'minimumReleaseAgeExclude')
  // Entries on the branch that are neither on the anchor nor approved: pnpm (or someone)
  // added them. Each one is a version past the gate that nobody reviewed.
  const unapprovedExcludes = headEntries.filter(
    (e) => !anchorEntries.includes(e) && !approved.includes(e)
  )
  // The gate check uses only what was trusted before plus what the user approved.
  const excludes = parseExcludes([...anchorEntries, ...approved])
  // The strictest of the branch, the compare base and the anchor: a branch cannot lower
  // the gate for itself.
  const minAgeHours =
    Math.max(
      minAgeMinutesFromYaml(yaml),
      minAgeMinutesFromYaml(baseYaml),
      minAgeMinutesFromYaml(anchorYaml)
    ) / 60

  // pnpm itself (packageManager) is not in the project lockfile document. Age-check a new
  // pnpm version here: corepack has no release-age gate.
  const pmOf = (text) => {
    try {
      return (
        JSON.parse(text)?.packageManager?.match(/^pnpm@([^+]+)/)?.[1] ?? null
      )
    } catch {
      return null
    }
  }
  let basePkgText = ''
  try {
    basePkgText = git(['show', `${baseRef}:./package.json`])
  } catch {}
  const pnpmBefore = pmOf(basePkgText)
  const pnpmAfter = pmOf(readText(root, 'package.json') ?? '')
  let freshPnpm = null
  if (pnpmAfter && pnpmAfter !== pnpmBefore) {
    const iso = (await npmView('pnpm', root))?.time?.[pnpmAfter]
    const h = iso ? ageHours(iso, Date.now()) : null
    if (h == null || h < minAgeHours) {
      freshPnpm = { version: pnpmAfter, ageHours: h }
    }
  }
  const watch = values.watch
    ? values.watch.split(',').map((s) => s.trim())
    : DEFAULT_WATCH

  const added = []
  const removed = []
  const majorJumps = []
  const newDuplicates = []
  for (const [name, versions] of head) {
    const was = base.get(name) ?? new Set()
    for (const v of versions) {
      if (!was.has(v)) {
        added.push({ name, version: v })
      }
    }
    // Any major that main did not have: a raised top major, or a lower copy that moved to a
    // new major (1.x + 3.x -> 2.x + 3.x).
    const wasMajors = breakingLines(was)
    if (
      was.size &&
      [...breakingLines(versions)].some((m) => !wasMajors.has(m))
    ) {
      // Name the cause: the packages that depend on each new version.
      const causes = [...versions]
        .filter((v) => !was.has(v))
        .flatMap((v) =>
          [...(parents.get(`${name}@${v}`) ?? [])].map((p) => `${p} → ${v}`)
        )
      // A new 1.x+ major is a real major. A new 0.x line (0.3 -> 0.4) is breaking too,
      // but a transitive one moves only when its parent moves: list it, do not stop on it.
      const newLines = [...breakingLines(versions)].filter(
        (m) => !wasMajors.has(m)
      )
      majorJumps.push({
        name,
        from: [...was].sort(),
        to: [...versions].sort(),
        realMajor: newLines.some((m) => !m.startsWith('0.')),
        prerelease: [...versions].some(
          (v) => !was.has(v) && parseVersion(v).pre
        ),
        causes: causes.slice(0, 5),
      })
    }
    if (versions.size > 1 && versions.size > was.size) {
      newDuplicates.push({
        name,
        before: [...was].sort(),
        after: [...versions].sort(),
      })
    }
  }
  for (const [name, versions] of base) {
    if (!head.has(name)) {
      removed.push({ name, versions: [...versions] })
    }
  }
  // A split that main already has (e.g. wagmi 2 in one example) is known; only a new
  // split, or a split with more copies than main, needs action.
  const singleCopy = watch
    .filter((n) => head.has(n))
    .map((n) => {
      // Count runtime instances: each peer variant in `snapshots:` is its own copy.
      const instances = headSnap.get(n) ?? head.get(n)
      const baseInstances = baseSnap.get(n) ?? base.get(n) ?? new Set()
      const now = instances.size
      const was = baseInstances.size
      return {
        name: n,
        versions: [...head.get(n)].sort(),
        instances: [...instances].sort(),
        baseInstances: [...baseInstances].sort(),
        // A split is new when it has more instances than main, or a version that main
        // did not have (same count, but 2.57.7 + 2.58.0 instead of two 2.57.7 variants).
        // New when there are more instances than on main, or more distinct versions (two
        // peer variants of 2.57.7 that became 2.57.7 + 2.58.0). A known split whose
        // copies only moved (wagmi 2.x + 3.1.0 -> 2.x + 3.2.0) stays "same as base".
        status:
          now === 1
            ? 'single'
            : now > was || head.get(n).size > (base.get(n)?.size ?? 0)
              ? 'new-split'
              : 'same-as-base',
      }
    })

  let fresh = []
  let ageUnknown = []
  added.sort(
    (a, b) => a.name.localeCompare(b.name) || cmpRaw(a.version, b.version)
  )
  if (!values['skip-age'] && added.length) {
    const names = [...new Set(added.map((a) => a.name))]
    const views = await pool(names, 12, (n) => npmView(n, root))
    const byName = new Map(names.map((n, i) => [n, views[i]]))
    const nowMs = Date.now()
    for (const a of added) {
      const iso = byName.get(a.name)?.time?.[a.version]
      a.ageHours = iso ? ageHours(iso, nowMs) : null
    }
    const checked = added.filter(
      (a) => !isExcluded(excludes, a.name, a.version)
    )
    // Fail closed: a version whose age npm cannot confirm is treated like a fresh one.
    fresh = checked.filter(
      (a) => a.ageHours != null && a.ageHours < minAgeHours
    )
    ageUnknown = checked.filter((a) => a.ageHours == null)
  } else {
    for (const a of added) {
      a.ageHours = null
    }
  }

  // Majors the user approved are expected; every other major jump is a STOP.
  const expected = new Set(
    (values['expect-majors'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
  // Whole-package overrides that are not exact holds re-resolve at the regeneration.
  const openOverrideNames = new Set(
    yamlMap(yaml, 'overrides')
      .map((o) => ({ ...o, ...parseSelector(o.key) }))
      // Same hold rule as analyze-outdated (isVersionLike); a range selector with an open
      // value re-resolves as well.
      .filter(
        (o) =>
          (o.kind === 'whole' || o.kind === 'range') &&
          !(o.kind === 'whole' && isVersionLike(o.value))
      )
      .map((o) => o.name)
  )
  for (const j of majorJumps) {
    j.viaOpenOverride = openOverrideNames.has(j.name)
  }
  const unexpectedMajors = majorJumps.filter((j) =>
    isStopJump(j, openOverrideNames, expected)
  )
  // A lockfile identical to the base: nothing was regenerated (for example a preview that
  // pnpm rebuilt from node_modules/.pnpm/lock.yaml). Say so; do not report a clean pass.
  const unchanged = headText === baseText
  const report = {
    unchanged,
    base: baseRef,
    // The ref whose exclude list is trusted: always the merge-base of HEAD and origin/main.
    trustAnchor,
    counts: {
      packagesBefore: base.size,
      packagesAfter: head.size,
      addedVersions: added.length,
      removedPackages: removed.length,
    },
    // Every version that the compare base did not have: { name, version, ageHours }.
    added,
    majorJumps,
    newDuplicates,
    singleCopy,
    freshThirdParty: fresh,
    ageUnknown,
    // The skill must stop (step 6) when this is false.
    unapprovedExcludes,
    unexpectedMajors,
    pnpm: { before: pnpmBefore, after: pnpmAfter, fresh: freshPnpm },
    ageChecked: !values['skip-age'],
    ok:
      !values['skip-age'] &&
      !freshPnpm &&
      unexpectedMajors.length === 0 &&
      unapprovedExcludes.length === 0 &&
      fresh.length === 0 &&
      ageUnknown.length === 0 &&
      !singleCopy.some((s) => s.status === 'new-split'),
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  const e = process.stderr
  e.write(
    `\n## Lockfile compared with ${baseRef}${trustAnchor === baseRef ? '' : ` (trusted excludes from ${trustAnchor})`}\n\n`
  )
  if (report.unchanged) {
    e.write(
      '- **The lockfile is identical to the base.** Nothing was regenerated. In a preview, move node_modules/.pnpm/lock.yaml aside first.\n'
    )
  }
  e.write(
    `- ${head.size} packages (was ${base.size}); ${added.length} added versions; ${removed.length} packages removed.\n`
  )
  // Every added version; a long list is cut to a count (the JSON has all of them).
  const ADDED_LINES = 40
  e.write(
    `- Added versions (${added.length})${
      added.length > ADDED_LINES
        ? `: more than ${ADDED_LINES}, so not listed here. Read \`added\` in the JSON.`
        : added.length
          ? `:\n${added
              .map(
                (a) =>
                  `  - \`${a.name}@${a.version}\` (${a.ageHours == null ? 'age not checked' : `${a.ageHours}h old`})`
              )
              .join('\n')}`
          : ''
    }\n`
  )
  e.write(
    `- Major jumps (${majorJumps.length}): ${
      majorJumps
        .map(
          (j) =>
            `\`${j.name}\`${j.realMajor ? '' : ' (0.x line)'}${j.viaOpenOverride ? ' (open override)' : ''}${j.prerelease ? ' (PRERELEASE)' : ''} ${j.from.join('/')} → ${j.to.join('/')}${j.causes?.length ? ` (from ${j.causes.join('; ')})` : ''}`
        )
        .join(', ') || 'none'
    }\n`
  )
  e.write(
    `- New duplicate copies (${newDuplicates.length}): ${
      newDuplicates
        .map((d) => `\`${d.name}\` ${d.after.join(', ')}`)
        .join('; ') || 'none'
    }\n`
  )
  const fmt = (list) =>
    list
      .map((s) => {
        // "3.7.7 ×2 peer variants" instead of the full peer suffixes.
        const counts = new Map()
        for (const i of s.instances) {
          const v = i.replace(/\(.*$/, '')
          counts.set(v, (counts.get(v) ?? 0) + 1)
        }
        const parts = [...counts].map(([v, c]) =>
          c > 1 ? `${v} ×${c} peer variants` : v
        )
        return `\`${s.name}\` ${parts.join(', ')}`
      })
      .join('; ')
  const split = singleCopy.filter((s) => s.status === 'new-split')
  const known = singleCopy.filter((s) => s.status === 'same-as-base')
  const single = singleCopy.filter((s) => s.status === 'single')
  e.write(
    `- Single-copy packages: NEW SPLIT: ${fmt(split) || 'none'}. Same split as ${baseRef}: ${
      fmt(known) || 'none'
    }. Single: ${single.map((s) => `${s.name} ${s.versions[0]}`).join(', ') || 'none'}.\n`
  )
  e.write(
    `- Added versions younger than ${minAgeHours}h and not excluded: ${
      values['skip-age']
        ? 'not checked (--skip-age)'
        : fresh
            .map((f) => `\`${f.name}@${f.version}\` (${f.ageHours}h)`)
            .join(', ') || 'none'
    }\n`
  )
  e.write(
    `- pnpm: ${report.pnpm.before ?? '?'} → ${report.pnpm.after ?? '?'}${
      report.pnpm.fresh
        ? ` (STOP: ${report.pnpm.fresh.version} is ${report.pnpm.fresh.ageHours ?? 'of unknown age'}h old)`
        : ''
    }${report.ageChecked ? '' : '; ages NOT checked (--skip-age), so the result is not OK'}\n`
  )
  e.write(
    `- Major jumps that nobody approved (STOP): ${
      unexpectedMajors.map((j) => `\`${j.name}\``).join(', ') || 'none'
    }\n`
  )
  e.write(
    `- New minimumReleaseAgeExclude entries that nobody approved: ${
      unapprovedExcludes.map((x) => `\`${x}\``).join(', ') || 'none'
    }\n`
  )
  if (ageUnknown.length) {
    e.write(
      `- Added versions whose age npm did not return (treat as too fresh): ${ageUnknown
        .map((f) => `\`${f.name}@${f.version}\``)
        .join(', ')}\n`
    )
  }
  e.write(
    `\n**Result: ${report.ok ? 'OK' : 'STOP: fix the items above before you continue'}**\n\n`
  )
}

main()
