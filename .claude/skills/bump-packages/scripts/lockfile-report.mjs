#!/usr/bin/env node
// lockfile-report.mjs — compare pnpm-lock.yaml with a base ref after the regeneration.
//
// `pnpm outdated` sees direct dependencies only. A regeneration can also move transitive
// packages, e.g. an open override (`preact: ">=10.29.1"`) that jumps a major. This script
// uses two refs:
//   - the trust anchor: always the merge-base of HEAD and origin/main. Only its
//     minimumReleaseAgeExclude list (reviewed and merged) plus --approved is trusted, and the
//     age check covers every version that the anchor lockfile does not have, so --base can
//     neither widen the trusted list nor hide a fresh version.
//   - the compare base (--base, default: the trust anchor). Any ancestor of HEAD, e.g. the
//     head of an open bump PR branch. Only the major jumps, the single-copy splits and
//     `added` use it, so an earlier approved major does not stop again.
// It reports:
//   - transitive and direct major jumps (against the compare base),
//   - the copies of the single-copy packages (against the compare base),
//   - every version that the compare base did not have (`added`),
//   - versions younger than the release-age gate that the anchor did not have, and pnpm
//     itself when it is new and fresh,
//   - new minimumReleaseAgeExclude entries that nobody approved. pnpm's default gate is
//     not strict: when no mature version fits, pnpm installs a fresh one and adds it to the
//     list by itself. So the gate check trusts only the ANCHOR list plus --approved entries.
// Output: JSON on stdout; errors on stderr. Read-only. Exits 2 (fail closed) when a base is
// not usable (no merge-base with origin/main, a --base that is not an ancestor of HEAD, or
// no lockfile on the compare base) or an --approved entry is not an exact name@x.y.z.
//
// Usage: node lockfile-report.mjs [--root <repo>] [--base <ancestor of HEAD>]
//        [--approved name@1.2.3,name@4.5.6]
//        [--expect-majors name,name]   (the majors the user approved)

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ageHours,
  breakingLines,
  cmpRaw,
  invalidExcludeEntries,
  isExcluded,
  isStopJump,
  isVersionLike,
  minAgeMinutesFromYaml,
  npmView,
  parseExcludes,
  parseLock,
  parseParents,
  parseSelector,
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
    approved: { type: 'string' },
    'expect-majors': { type: 'string' },
  },
})
const root = values.root ? resolve(values.root) : process.cwd()
const git = (args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
const fail = (msg) => {
  process.stderr.write(`${msg}\n`)
  process.exit(2)
}
const list = (s) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

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
  fail(err.message)
}

// Packages that must be single-copy in these repos (see each repo's CLAUDE.md).
const WATCH = [
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

// A file of `ref` relative to --root (`./` keeps an extra project, e.g. examples/node, on
// its own files), or null when the ref does not have it.
const showAt = (ref, file) => {
  try {
    return git(['show', `${ref}:./${file}`])
  } catch {
    return null
  }
}
const pmOf = (text) => {
  try {
    return JSON.parse(text)?.packageManager?.match(/^pnpm@([^+]+)/)?.[1] ?? null
  } catch {
    return null
  }
}

async function main() {
  const approved = list(values.approved)
  const bad = invalidExcludeEntries(approved)
  if (bad.length) {
    fail(`--approved takes exact name@x.y.z entries only: ${bad.join(', ')}`)
  }
  const headText = readText(root, 'pnpm-lock.yaml')
  if (!headText) {
    fail('No pnpm-lock.yaml in --root.')
  }
  const baseText = showAt(baseRef, 'pnpm-lock.yaml')
  if (baseText == null) {
    // Without a base every package looks "added" and no major jump shows: fail closed.
    fail(
      `Cannot read ${baseRef}:pnpm-lock.yaml. Run git fetch --no-prune-tags origin, then run again.`
    )
  }
  // A project that is new since the anchor has no lockfile there: every version is new.
  const anchorText =
    trustAnchor === baseRef
      ? baseText
      : (showAt(trustAnchor, 'pnpm-lock.yaml') ?? '')
  const head = parseLock(headText)
  const base = parseLock(baseText)
  const anchor = trustAnchor === baseRef ? base : parseLock(anchorText)
  const parents = parseParents(headText)
  const headSnap = parseLock(headText, 'snapshots')
  const baseSnap = parseLock(baseText, 'snapshots')
  const anchorSnap =
    trustAnchor === baseRef ? baseSnap : parseLock(anchorText, 'snapshots')
  const yaml = readWorkspaceYaml(root)
  // A project without pnpm-workspace.yaml on a ref has no exclude list there.
  const baseYaml = showAt(baseRef, 'pnpm-workspace.yaml') ?? ''
  const anchorYaml =
    trustAnchor === baseRef
      ? baseYaml
      : (showAt(trustAnchor, 'pnpm-workspace.yaml') ?? '')
  // Trusted: the exclude list of the trust anchor (merged on main), never of --base.
  const anchorEntries = yamlList(anchorYaml, 'minimumReleaseAgeExclude')
  // Entries on the branch that are neither on the anchor nor approved: pnpm (or someone)
  // added them. Each one is a version past the gate that nobody reviewed.
  const unapprovedExcludes = yamlList(yaml, 'minimumReleaseAgeExclude').filter(
    (e) => !anchorEntries.includes(e) && !approved.includes(e)
  )
  const excludes = parseExcludes([...anchorEntries, ...approved])
  // The strictest of the branch, the compare base and the anchor: a branch cannot lower
  // the gate for itself.
  const minAgeHours =
    Math.max(
      minAgeMinutesFromYaml(yaml),
      minAgeMinutesFromYaml(baseYaml),
      minAgeMinutesFromYaml(anchorYaml)
    ) / 60

  const added = []
  const sinceAnchor = []
  const majorJumps = []
  for (const [name, versions] of head) {
    const was = base.get(name) ?? new Set()
    const trusted = anchor.get(name) ?? new Set()
    for (const v of versions) {
      if (!was.has(v)) {
        added.push({ name, version: v })
      }
      if (!trusted.has(v)) {
        sinceAnchor.push({ name, version: v })
      }
    }
    // Any major that the base did not have: a raised top major, or a lower copy that moved
    // to a new major (1.x + 3.x -> 2.x + 3.x). A major that the trust anchor (main) already
    // has is not new: it came in with a merge of main, and main was reviewed.
    const wasMajors = breakingLines(was)
    const trustedMajors = breakingLines(trusted)
    const newLines = [...breakingLines(versions)].filter(
      (m) => !wasMajors.has(m) && !trustedMajors.has(m)
    )
    if (was.size && newLines.length) {
      // Name the cause: the packages that depend on each new version.
      const causes = [...versions]
        .filter((v) => !was.has(v) && !trusted.has(v))
        .flatMap((v) =>
          [...(parents.get(`${name}@${v}`) ?? [])].map((p) => `${p} needs ${v}`)
        )
      majorJumps.push({
        name,
        from: [...was].sort(),
        to: [...versions].sort(),
        // A new 1.x+ major is a real major. A new 0.x line (0.3 -> 0.4) is breaking too,
        // but a transitive one moves only when its parent moves: list it, do not stop on it.
        realMajor: newLines.some((m) => !m.startsWith('0.')),
        causes: causes.slice(0, 5),
      })
    }
  }
  // A split that the base already has (e.g. wagmi 2 in one example) is known; only a new
  // split, or a split with more copies than the base, needs action.
  const singleCopy = WATCH.filter((n) => head.has(n)).map((n) => {
    // Count runtime instances: each peer variant in `snapshots:` is its own copy.
    const instances = headSnap.get(n) ?? head.get(n)
    // Known = the base or the trust anchor (main) already has it: a split that came in
    // with a merge of main is not new.
    const was = Math.max(
      (baseSnap.get(n) ?? base.get(n) ?? new Set()).size,
      (anchorSnap.get(n) ?? anchor.get(n) ?? new Set()).size
    )
    const wasVersions = Math.max(
      base.get(n)?.size ?? 0,
      anchor.get(n)?.size ?? 0
    )
    return {
      name: n,
      versions: [...head.get(n)].sort(),
      instances: [...instances].sort(),
      // New when there are more instances than on the base, or more distinct versions (two
      // peer variants of 2.57.7 that became 2.57.7 + 2.58.0). A known split whose copies
      // only moved (wagmi 2.x + 3.1.0 -> 2.x + 3.2.0) stays "same as base".
      status:
        instances.size === 1
          ? 'single'
          : instances.size > was || head.get(n).size > wasVersions
            ? 'new-split'
            : 'same-as-base',
    }
  })

  // The age check: every version that the anchor lockfile does not have, except the
  // trusted and approved exclude entries. Fail closed: an unknown age counts as fresh.
  const nowMs = Date.now()
  const names = [...new Set([...added, ...sinceAnchor].map((a) => a.name))]
  const views = await pool(names, 12, (n) => npmView(n, root))
  const byName = new Map(names.map((n, i) => [n, views[i]]))
  const ageOf = (a) => {
    const iso = byName.get(a.name)?.time?.[a.version]
    return iso ? ageHours(iso, nowMs) : null
  }
  for (const a of [...added, ...sinceAnchor]) {
    a.ageHours = ageOf(a)
  }
  const checked = sinceAnchor.filter(
    (a) => !isExcluded(excludes, a.name, a.version)
  )
  const fresh = checked.filter(
    (a) => a.ageHours != null && a.ageHours < minAgeHours
  )
  const ageUnknown = checked.filter((a) => a.ageHours == null)
  const bySpec = (a, b) =>
    a.name.localeCompare(b.name) || cmpRaw(a.version, b.version)
  added.sort(bySpec)
  fresh.sort(bySpec)
  ageUnknown.sort(bySpec)

  // pnpm itself (packageManager) is not in the project lockfile. Age-check a pnpm version
  // that the anchor does not have: corepack has no release-age gate.
  const pnpmBefore = pmOf(showAt(trustAnchor, 'package.json') ?? '')
  const pnpmAfter = pmOf(readText(root, 'package.json') ?? '')
  let freshPnpm = null
  if (pnpmAfter && pnpmAfter !== pnpmBefore) {
    const iso = (await npmView('pnpm', root))?.time?.[pnpmAfter]
    const h = iso ? ageHours(iso, nowMs) : null
    if (h == null || h < minAgeHours) {
      freshPnpm = { version: pnpmAfter, ageHours: h }
    }
  }

  // Whole-package overrides that are not exact holds re-resolve at the regeneration (same
  // hold rule as analyze-outdated); a range selector with an open value re-resolves too.
  const openOverrideNames = new Set(
    yamlMap(yaml, 'overrides')
      .map((o) => ({ ...o, ...parseSelector(o.key) }))
      .filter(
        (o) =>
          (o.kind === 'whole' || o.kind === 'range') &&
          !(o.kind === 'whole' && isVersionLike(o.value))
      )
      .map((o) => o.name)
  )
  // Majors the user approved are expected; every other major jump is a STOP.
  const expected = new Set(list(values['expect-majors']))
  const report = {
    base: baseRef,
    // The ref whose exclude list and lockfile the age check trusts.
    trustAnchor,
    // Every version that the compare base did not have: { name, version, ageHours }.
    added,
    majorJumps,
    singleCopy,
    freshThirdParty: fresh,
    ageUnknown,
    unapprovedExcludes,
    unexpectedMajors: majorJumps.filter((j) =>
      isStopJump(j, openOverrideNames, expected)
    ),
    pnpm: { before: pnpmBefore, after: pnpmAfter, fresh: freshPnpm },
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main()
