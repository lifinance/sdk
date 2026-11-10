#!/usr/bin/env node
// analyze-outdated.mjs — npm dependency plan for the bump-packages skill.
//
// Reads `pnpm outdated -r --format json` (with pnpm's own release-age gate turned off, so a
// package whose every newer version is too fresh still shows up). For each outdated
// external dependency it predicts the version that pnpm installs under the gate, classifies
// the bump by SemVer risk, and maps which publishable packages need a changeset. It also
// reports what `pnpm outdated` cannot see:
//   - exact-version overrides (holds), also on transitive packages,
//   - open overrides that the lockfile regeneration will move, and whether by a major,
//   - deprecated packages that are already on their final release,
//   - `minimumReleaseAgeExclude` entries that have aged out,
//   - fast-track decisions for fresh releases (`fastTrack`, `fastTrackFamilies`,
//     `autoExcludes`, `needsApprovalExcludes`), override lifts and floors that fell behind (`overrideUpdates`).
//
// Output: a JSON plan on stdout, a Markdown summary on stderr. Read-only. Exits 2 if
// `pnpm outdated` fails (the plan would be wrong) or an `autoExcludes` entry is not an exact
// `name@x.y.z` (nothing is written then), otherwise 0. Needs an authenticated `gh` CLI for
// the advisory check (without it every fast-track candidate is blocked).
//
// Usage: node analyze-outdated.mjs [--root <repo>] [--min-age-hours <N>]

import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  addedKeys,
  advisoriesFor,
  agedOrExempt,
  ageHours,
  classify,
  cmpRaw,
  DEP_FIELDS,
  decideFamily,
  execFileP,
  failures,
  familyKeyOf,
  freshVersionsOf,
  globToRegExp,
  groupFamilies,
  groupOutdated,
  invalidExcludeEntries,
  isExcluded,
  isVersionLike,
  listWorkspaceProjects,
  malwareCoveringAny,
  mdTable,
  minAgeMinutesFromYaml,
  npmView,
  npmViewFields,
  overrideUpdate,
  packageMalwareFor,
  parseExcludes,
  parseLock,
  parseSelector,
  parseVersion,
  pickAgedTarget,
  pool,
  provenanceOf,
  provenanceVerdict,
  readJson,
  readText,
  readWorkspaceYaml,
  satisfies,
  yamlList,
  yamlMap,
} from './lib.js'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    'min-age-hours': { type: 'string' },
  },
})
const root = values.root ? resolve(values.root) : process.cwd()

async function runOutdated(ungated = true) {
  let out = ''
  const args = ['outdated', '-r', '--format', 'json']
  if (ungated) {
    args.push('--config.minimum-release-age=0')
  }
  try {
    ;({ stdout: out } = await execFileP('pnpm', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }))
  } catch (err) {
    // `pnpm outdated` exits 1 when something is outdated; that is the normal case. Any
    // other failure (registry, auth, wrong pnpm) must stop the plan, not look like
    // "nothing is outdated".
    out = err.stdout ? err.stdout.toString() : ''
    if (err.code !== 1 || !out.includes('{')) {
      const msg = err.stderr
        ? err.stderr.toString().trim()
        : String(err.message)
      process.stderr.write(`pnpm outdated failed (exit ${err.code}): ${msg}\n`)
      process.exit(2)
    }
  }
  const start = out.indexOf('{')
  if (start === -1) {
    return {}
  }
  try {
    return JSON.parse(out.slice(start))
  } catch (e) {
    process.stderr.write(`pnpm outdated printed invalid JSON: ${e.message}\n`)
    process.exit(2)
  }
}

async function peersOf(name, version) {
  // A failure is recorded in `failures` (degraded plan), never treated as "no peers".
  const j = await npmViewFields(
    `${name}@${version}`,
    ['peerDependencies'],
    root
  )
  return j && typeof j === 'object' ? j : {}
}

// Workspace projects as pnpm sees them (`pnpm ls -r --depth -1 --json`): the same set
// that `pnpm outdated` reports locations for. Falls back to the yaml globs if pnpm fails.
function workspaceProjects(rootDir, yaml) {
  try {
    const out = execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], {
      cwd: rootDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const map = new Map()
    for (const p of JSON.parse(out.slice(out.indexOf('[')))) {
      const dir = resolve(p.path)
      const rel = relative(rootDir, dir) || '.'
      const json = readJson(dir, 'package.json')
      if (json) {
        map.set(dir, {
          name: p.name ?? json.name ?? rel,
          private: !!json.private,
          json,
          rel,
        })
      }
    }
    if (map.size) {
      return map
    }
  } catch {}
  return listWorkspaceProjects(rootDir, yaml)
}

// Versions of a package that satisfy `range`, oldest first, split by the gate. Ignores
// prereleases. `aged` counts exempt versions as aged, like pnpm does.
function satisfying(view, range, ctx, name) {
  const aged = []
  const fresh = []
  for (const [ver, iso] of Object.entries(view?.time ?? {})) {
    if (ver === 'created' || ver === 'modified' || parseVersion(ver).pre) {
      continue
    }
    if (satisfies(ver, range) !== true) {
      continue
    }
    const ok = agedOrExempt(iso, ver, ctx.minAgeMs, ctx.nowMs, ctx.exempt(name))
    ;(ok ? aged : fresh).push(ver)
  }
  aged.sort(cmpRaw)
  fresh.sort(cmpRaw)
  return { aged, fresh }
}

const FT_FIELDS = [
  '_npmUser',
  'dist.attestations',
  'scripts',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]
const DEP_MAPS = ['dependencies', 'optionalDependencies', 'peerDependencies']
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall']

// The metadata checks for one fresh version `f` against a trusted reference `b` (the
// version that lands otherwise, or the aged release below it). Provenance, advisories and
// the dependency walk run separately (see checkVersion). Flags of the compromise class (a
// publisher change, a new or changed install script) also go into `compromise`: they block
// every fresh version of the package and its family, with no fallback.
function redFlagsOf(label, f, b, compromise = []) {
  if (!f || !b) {
    return [`${label}: npm metadata unavailable, cannot check`]
  }
  const flags = []
  const who = (x) => JSON.stringify(x?._npmUser ?? null)
  if (!f._npmUser || !b._npmUser) {
    flags.push(`${label}: publisher unknown, cannot compare`)
  } else if (who(f) !== who(b)) {
    const msg = `${label}: publisher changed ${who(b)} → ${who(f)}`
    flags.push(msg)
    compromise.push(msg)
  }
  for (const s of INSTALL_SCRIPTS) {
    if (f.scripts?.[s] && f.scripts?.[s] !== b.scripts?.[s]) {
      const msg = `${label}: new or changed ${s} script`
      flags.push(msg)
      compromise.push(msg)
    }
  }
  for (const m of DEP_MAPS) {
    const added = addedKeys(f[m], b[m])
    if (added.length) {
      flags.push(`${label}: new ${m}: ${added.join(', ')}`)
    }
  }
  return flags
}

// Fast-track: a fresh patch or minor (younger than the gate) that passes all checks AND has
// verified provenance (same repository and workflow as its reference) is let through by
// default ('auto') with exact `name@version` exclude entries. A clean one without verified
// provenance is 'needs-approval'. No person reviews an 'auto' one, so every check fails
// closed: a check that cannot run is a red flag.
//
// For each candidate, checkVersion() tests one fresh version against the version that lands
// otherwise (`base`): the metadata checks, then its dependency ranges (up to 4 levels). A
// range that no aged version meets needs an exact exclude entry: take the EARLIEST fresh
// version that meets it (later ones stay gated, so pnpm resolves to it) and check it against
// the aged release below it. Every entry of the exclude set then gets the advisory check
// and the provenance-source check.
//
// Candidates that move together form a family (groupFamilies). decideFamily() checks every
// fresh version: a compromise flag on any of them blocks the family with no fallback.
// Otherwise it picks the newest level where every member is clean (older fresh versions are
// a fallback for other flags). One red flag in the family blocks the whole family. A fresh
// major is never fast-tracked.
async function fastTrackCandidates(items, ctx) {
  const viewCache = new Map(
    [...ctx.views].map(([n, v]) => [n, Promise.resolve(v)])
  )
  const cached = (map, k, fn) => {
    if (!map.has(k)) {
      map.set(k, fn())
    }
    return map.get(k)
  }
  const viewOf = (n) => cached(viewCache, n, () => npmView(n, root))
  const metaCache = new Map()
  const metaOf = (spec) =>
    cached(metaCache, spec, () => npmViewFields(spec, FT_FIELDS, root))
  const advCache = new Map()
  const advisoryOf = (name, version) =>
    cached(advCache, `${name}@${version}`, () => advisoriesFor(name, version))
  const provCache = new Map()
  const provOf = (name, version) =>
    cached(provCache, `${name}@${version}`, () => provenanceOf(name, version))
  const pkgMalwareCache = new Map()
  const pkgMalwareOf = (name) =>
    cached(pkgMalwareCache, name, () => packageMalwareFor(name))

  const skipped = []
  const eligible = []
  for (const { entry, base } of items) {
    const view = await viewOf(entry.name)
    if (!view) {
      skipped.push({
        name: entry.name,
        fresh: entry.registryLatest,
        reason: 'registry data unavailable: cannot list the fresh versions',
      })
      continue
    }
    const fresh = freshVersionsOf(
      view,
      base,
      ctx.minAgeMs,
      ctx.nowMs,
      ctx.exempt(entry.name)
    )
    const majors = fresh.filter((x) => !classify(base, x.version).safe)
    if (majors.length) {
      const top = majors[majors.length - 1].version
      skipped.push({
        name: entry.name,
        fresh: top,
        reason: `${classify(base, top).bumpType} above ${base}: wait, then review it as a major`,
      })
    }
    const ok = fresh.filter((x) => classify(base, x.version).safe).reverse()
    if (ok.length) {
      eligible.push({ id: String(eligible.length), entry, base, fresh: ok })
    }
  }

  const splitSpec = (spec) => {
    const at = spec.lastIndexOf('@')
    return [spec.slice(0, at), spec.slice(at + 1)]
  }

  // The advisory and provenance checks for one exclude entry, against its reference.
  // Returns { flags, compromise (malware hits, provenance dropped or changed), verified
  // (both sides have provenance with the same repository and workflow) }.
  async function networkFlags({ spec, comparedWith }) {
    const [name, version] = splitSpec(spec)
    const flags = []
    const compromise = []
    const adv = await advisoryOf(name, version)
    if (adv.error) {
      flags.push(
        `${spec}: advisory check cannot run, cannot check (${adv.error})`
      )
    } else {
      for (const h of adv.hits) {
        const msg = `${spec}: ${h.type} advisory ${h.ghsa} (${h.severity}${h.withdrawn ? ', withdrawn' : ''})`
        flags.push(msg)
        // Only malware blocks every fresh version. A reviewed advisory flags this version
        // only, so the fix release above it can still be the fast-track.
        if (h.type === 'malware') {
          compromise.push(msg)
        }
      }
    }
    if (!comparedWith) {
      // Flagged in the walk: no aged version to compare with.
      return { flags, compromise, verified: false }
    }
    const [fm, bm] = await Promise.all([
      metaOf(spec),
      metaOf(`${name}@${comparedWith}`),
    ])
    if (!fm || !bm) {
      // Flagged by redFlagsOf: metadata unavailable.
      return { flags, compromise, verified: false }
    }
    const refHas = !!bm['dist.attestations']
    const freshHas = !!fm['dist.attestations']
    const [ri, fi] = await Promise.all([
      refHas ? provOf(name, comparedWith) : null,
      refHas && freshHas ? provOf(name, version) : null,
    ])
    const pv = provenanceVerdict(
      spec,
      { has: refHas, info: ri },
      { has: freshHas, info: fi }
    )
    return {
      flags: [...flags, ...pv.flags],
      compromise: [...compromise, ...pv.compromise],
      verified: pv.verified,
    }
  }

  // Malware advisories on the whole package that cover any of its fresh versions: a
  // compromise flag for the family. A failed query blocks too (fail closed).
  async function packageCheck(m) {
    const r = await pkgMalwareOf(m.name)
    const hits = r.error ? null : malwareCoveringAny(r.list, m.name, m.fresh)
    if (hits == null) {
      return {
        compromiseFlags: [
          `${m.name}: package malware advisory check cannot run, cannot check (${r.error ?? 'incomplete answer'})`,
        ],
      }
    }
    return {
      compromiseFlags: hits.map(
        (h) =>
          `${m.name}@${h.version}: malware advisory ${h.ghsa} on the package${h.withdrawn ? ' (withdrawn)' : ''}`
      ),
    }
  }

  const checkCache = new Map()
  const checkVersion = (item, fresh) =>
    cached(checkCache, `${item.entry.name}@${fresh} vs ${item.base}`, () =>
      checkVersionUncached(item, fresh)
    )

  async function checkVersionUncached({ entry, base }, fresh) {
    const label = `${entry.name}@${fresh}`
    const [f, b] = await Promise.all([
      metaOf(label),
      metaOf(`${entry.name}@${base}`),
    ])
    const compromise = []
    const redFlags = redFlagsOf(label, f, b, compromise)
    const notes = []
    const excludeSet = [{ spec: label, comparedWith: base }]
    // One dependency edge: resolve an alias, flag non-registry specs, and say whether the
    // range needs a fresh version (`need`) or is already met by an aged one.
    const inspect = async (owner, ref, m, key, spec) => {
      const oldRange = ref?.[m]?.[key]
      const alias = /^npm:((?:@[^/@]+\/)?[^@]+)@(.+)$/.exec(spec)
      if (alias || satisfies('0.0.0', spec) === null) {
        // An alias installs another package under this key; a git, URL or file spec
        // bypasses the registry. Neither may change unseen.
        if (oldRange !== spec) {
          redFlags.push(
            `${owner}: ${m} ${key} uses ${alias ? 'the alias' : 'the non-registry spec'} "${spec}" (was ${oldRange ? `"${oldRange}"` : 'absent'})`
          )
        }
        if (!alias) {
          return null
        }
      }
      const dep = alias ? alias[1] : key
      const range = alias ? alias[2] : spec
      const v = await viewOf(dep)
      if (!v) {
        redFlags.push(`${dep}: registry data unavailable, cannot check`)
        return null
      }
      const { aged, fresh: fv } = satisfying(v, range, ctx, dep)
      if (!aged.length && !fv.length) {
        const pre = Object.keys(v.time ?? {}).some(
          (x) => parseVersion(x).pre && satisfies(x, range) === true
        )
        redFlags.push(
          `${owner}: ${m} ${dep}@${range}: ${pre ? 'only a prerelease meets it' : 'no published version meets it'}`
        )
        return null
      }
      if (aged.length) {
        return null
      }
      return { dep, range, oldRange, need: fv[0], view: v }
    }
    // The registry package behind an edge: the alias target, the key, or null for a git,
    // URL or file spec (those have no registry entry to fetch).
    const registryName = ({ key, spec }) => {
      const alias = /^npm:((?:@[^/@]+\/)?[^@]+)@/.exec(spec)
      if (alias) {
        return alias[1]
      }
      return satisfies('0.0.0', spec) === null ? null : key
    }
    const edgesOf = (from) =>
      DEP_MAPS.flatMap((m) =>
        Object.entries(from?.[m] ?? {}).map(([key, spec]) => ({ m, key, spec }))
      )

    let frontier = [{ from: f, ref: b, owner: label, ownerVersion: fresh }]
    const MAX_DEPTH = 4
    for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
      // Pass 1: fetch the whole level at once and find every edge that needs a fresh
      // version. Pass 2: check those versions (their metadata is already in flight).
      await Promise.all(
        frontier.flatMap(({ from }) =>
          edgesOf(from).map(registryName).filter(Boolean).map(viewOf)
        )
      )
      const needs = []
      for (const node of frontier) {
        for (const { m, key, spec } of edgesOf(node.from)) {
          const n = await inspect(node.owner, node.ref, m, key, spec)
          if (!n) {
            continue
          }
          // The range check runs for EVERY owner, also when an earlier owner already put
          // this version in excludeSet (a second owner that moves onto it gets its flag too).
          if (n.oldRange && n.oldRange !== n.range) {
            // A lockstep family (motion + framer-motion, rolldown + its bindings) pins
            // the same new version on every release: a note. Any other move to a
            // fresh-only range is a red flag.
            const msg = `${node.owner}: ${m} range of ${n.dep} changed ${n.oldRange} → ${n.range}, and only a fresh version meets it`
            ;(n.need === node.ownerVersion ? notes : redFlags).push(
              n.need === node.ownerVersion ? `${msg} (lockstep release)` : msg
            )
          }
          if (excludeSet.some((x) => x.spec === `${n.dep}@${n.need}`)) {
            continue
          }
          // Reference: the previous aged release below `need` (the one it replaces), or
          // the newest aged release if there is none below.
          n.trusted =
            pickAgedTarget(
              n.view,
              '0.0.0',
              ctx.minAgeMs,
              ctx.nowMs,
              ctx.exempt(n.dep),
              (x) => cmpRaw(x, n.need) < 0
            ) ??
            pickAgedTarget(
              n.view,
              '0.0.0',
              ctx.minAgeMs,
              ctx.nowMs,
              ctx.exempt(n.dep)
            )
          excludeSet.push({
            spec: `${n.dep}@${n.need}`,
            comparedWith: n.trusted,
          })
          needs.push(n)
          metaOf(`${n.dep}@${n.need}`)
          if (n.trusted) {
            metaOf(`${n.dep}@${n.trusted}`)
          }
        }
      }
      const next = []
      for (const n of needs) {
        const [nf, nb] = await Promise.all([
          metaOf(`${n.dep}@${n.need}`),
          n.trusted ? metaOf(`${n.dep}@${n.trusted}`) : Promise.resolve(null),
        ])
        redFlags.push(
          ...(n.trusted
            ? redFlagsOf(`${n.dep}@${n.need}`, nf, nb, compromise)
            : [`${n.dep}@${n.need}: no aged version to compare with`])
        )
        next.push({
          from: nf,
          ref: nb,
          owner: `${n.dep}@${n.need}`,
          ownerVersion: n.need,
        })
      }
      frontier = next
    }
    // The walk stopped with nodes left: flag only if one of their ranges still needs a
    // fresh version (ordinary aged dependencies at the bottom are fine).
    await Promise.all(
      frontier.flatMap(({ from }) =>
        edgesOf(from).map(registryName).filter(Boolean).map(viewOf)
      )
    )
    for (const node of frontier) {
      for (const { m, key, spec } of edgesOf(node.from)) {
        const n = await inspect(node.owner, node.ref, m, key, spec)
        if (n) {
          redFlags.push(
            `${node.owner}: ${n.dep}@${n.range} needs a fresh version below depth ${MAX_DEPTH}, not checked`
          )
        }
      }
    }
    // Advisories and provenance source for every exclude entry, a few at a time.
    const net = await pool(excludeSet, 4, networkFlags)
    for (const r of net) {
      redFlags.push(...r.flags)
      compromise.push(...r.compromise)
    }
    return {
      redFlags: [...new Set(redFlags)],
      compromiseFlags: [...new Set(compromise)],
      // Entries without verified provenance: a clean version then needs approval.
      unverifiedProvenance: excludeSet
        .filter((_, i) => !net[i].verified)
        .map((x) => x.spec),
      notes,
      excludeSet: excludeSet.map((x) => x.spec),
      checkedAgainst: excludeSet,
    }
  }

  // Phase 1: the newest fresh version of every candidate (its exclude set joins families).
  const first = await pool(eligible, 4, (it) =>
    checkVersion(it, it.fresh[0].version)
  )
  // Phase 2: families, then one decision per family (results of phase 1 are cached).
  const groups = groupFamilies(
    eligible.map((it, i) => ({
      name: it.entry.name,
      excludeSet: first[i].excludeSet,
    }))
  )
  const decisions = await pool(groups, 2, (g) =>
    decideFamily(
      g.map((i) => ({
        id: eligible[i].id,
        name: eligible[i].entry.name,
        fresh: eligible[i].fresh.map((x) => x.version),
        item: eligible[i],
      })),
      (m, v) => checkVersion(m.item, v),
      packageCheck
    )
  )

  const candidates = []
  const families = []
  groups.forEach((g, gi) => {
    const d = decisions[gi]
    const names = g.map((i) => eligible[i].entry.name)
    const family = names.map(familyKeyOf).find(Boolean) ?? names[0]
    families.push({
      family,
      members: names,
      versions: g.map(
        (i) => `${eligible[i].entry.name}@${d.versions[eligible[i].id]}`
      ),
      // auto / needs-approval: the entries of the chosen versions. blocked: the entries of
      // the newest versions, so a person can still approve them by name.
      excludeSet: d.excludeSet,
      redFlags: d.redFlags,
      // The flags that blocked every fresh version with no fallback.
      compromiseFlags: d.compromiseFlags,
      // Exclude entries without verified provenance (the reason for 'needs-approval').
      unverifiedProvenance: d.unverifiedProvenance,
      decision: d.decision,
    })
    for (const i of g) {
      const { id, entry, base, fresh } = eligible[i]
      const version = d.versions[id]
      const tried = d.tried[id]
      const chosen = tried.find((t) => t.version === version)
      const ownFlags = [
        ...new Set([
          ...d.packageFlags[id],
          ...tried.flatMap((t) => t.redFlags),
        ]),
      ]
      const info = fresh.find((x) => x.version === version)
      candidates.push({
        name: entry.name,
        kind: entry.kind,
        current: entry.current,
        landsWithoutFastTrack: base === entry.current ? null : base,
        family,
        decision: d.decision,
        // The version that the fast-track lets through ('auto'), or the newest tried one.
        fresh: version,
        bumpType: classify(base, version).bumpType,
        ageHours: info?.ageHours ?? null,
        eligibleInHours: info?.eligibleInHours ?? null,
        // Own flags: none unless 'blocked'; then every flag of every fresh version of this
        // member. A member can be clean and still blocked by a sibling (blockedByFamily).
        redFlags: d.decision === 'blocked' ? ownFlags : [],
        blockedByFamily: d.decision === 'blocked' && ownFlags.length === 0,
        // auto / needs-approval: the flags of newer fresh versions that were skipped.
        skippedFlags: d.skippedFlags[id],
        // Exclude entries of `fresh` without verified provenance on both sides.
        provenanceUnverified: chosen?.unverifiedProvenance ?? [],
        notes: chosen?.notes ?? [],
        // The command that lands it (null = only the lockfile regeneration moves it), and
        // the packages whose changeset must name it.
        upCommand: entry.bumpable
          ? `pnpm -C '${root}' up -r --latest ${entry.name} ${entry.projects.map((p) => `--filter '${p}'`).join(' ')}`
          : null,
        changesetPackages: entry.changesetPackages ?? [],
        // The exact entries this version needs, each checked against `comparedWith`.
        excludeSet: chosen?.excludeSet ?? [],
        checkedAgainst: chosen?.checkedAgainst ?? [],
        // Every fresh version (all are checked), newest first, with its own flags.
        tried: tried.map((t) => ({
          version: t.version,
          ageHours:
            fresh.find((x) => x.version === t.version)?.ageHours ?? null,
          redFlags: t.redFlags,
          compromiseFlags: t.compromiseFlags,
          provenanceVerified: t.unverifiedProvenance.length === 0,
          excludeSet: t.excludeSet,
        })),
      })
    }
  })
  return { candidates, skipped, families }
}

const isRuntimeField = (f) =>
  f === 'dependencies' || f === 'optionalDependencies'

async function main() {
  const yaml = readWorkspaceYaml(root)
  const projects = workspaceProjects(root, yaml)
  const overrides = yamlMap(yaml, 'overrides').map((o) => ({
    ...o,
    ...parseSelector(o.key),
  }))
  for (const o of overrides) {
    o.hold = o.kind === 'whole' && isVersionLike(o.value)
  }
  const excludes = parseExcludes(yamlList(yaml, 'minimumReleaseAgeExclude'))
  const lock = parseLock(readText(root, 'pnpm-lock.yaml'))
  const minAgeHours = values['min-age-hours']
    ? Number(values['min-age-hours'])
    : minAgeMinutesFromYaml(yaml) / 60
  const minAgeMs = minAgeHours * 3600 * 1000
  const nowMs = Date.now()
  const exempt = (name) => (v) => isExcluded(excludes, name, v)

  // `pnpm outdated` keys are not always plain names. With more than one resolved version or
  // dependency type it uses `next@16.4.2` or `vite-plugin-node-polyfills@0.26.0 (dev)`.
  // Group by the real name and the installed version; each group is classified alone.
  // Both scans at once: the ungated one finds every newer version, the gated one is
  // pnpm's own answer under the release-age gate (the cross-check below).
  const [ungatedRaw, gatedRaw] = await Promise.all([
    runOutdated(true),
    runOutdated(false),
  ])
  const groups = groupOutdated(ungatedRaw)
  const candidates = [...groups.entries()]
    .map(([id, info]) => [id.slice(0, id.lastIndexOf('@')), info])
    .filter(
      ([, i]) =>
        i.current && i.latest && (i.current !== i.latest || i.isDeprecated)
    )
  const candidateNames = new Set(candidates.map(([n]) => n))

  // Changesets versions a package unless it is ignored, or private with
  // privatePackages.version: false (the default is true). Examples never get one.
  const csConfig = readJson(root, '.changeset', 'config.json')
  const csIgnore = (csConfig?.ignore ?? []).map(globToRegExp)
  const versioned = (d) =>
    !!csConfig &&
    d.path.startsWith('packages/') &&
    !csIgnore.some((re) => re.test(d.project)) &&
    (!d.private || csConfig.privatePackages?.version !== false)

  // Caret/tilde peer floors of versioned packages, to compare with the latest release.
  const peerDecls = []
  for (const ws of projects.values()) {
    for (const [dep, range] of Object.entries(ws.json.peerDependencies ?? {})) {
      const d = { project: ws.name, path: ws.rel, private: ws.private }
      if (/^[\^~]\d+(\.\d+){0,2}$/.test(String(range)) && versioned(d)) {
        peerDecls.push({ ...d, dep, range: String(range) })
      }
    }
  }

  const names = [
    ...new Set([
      ...candidateNames,
      ...excludes.filter((m) => m.version).map((m) => m.name),
      ...overrides.map((o) => o.name),
      ...peerDecls.map((p) => p.dep),
    ]),
  ]
  const viewsArr = await pool(names, 12, (n) => npmView(n, root))
  const views = new Map(names.map((n, i) => [n, viewsArr[i]]))

  const safe = []
  const needsApproval = []
  const held = []
  const regen = []
  const tooFresh = []
  const changeset = {}
  const changesetIfApproved = {}

  for (const [name, info] of candidates) {
    const declared = []
    for (const dep of info.dependentPackages || []) {
      const ws = dep.location && projects.get(resolve(dep.location))
      if (!ws) {
        continue
      }
      for (const field of DEP_FIELDS) {
        const range = ws.json?.[field]?.[name]
        if (range != null) {
          declared.push({
            project: ws.name,
            path: ws.rel,
            private: ws.private,
            field,
            range: String(range),
          })
        }
      }
    }
    const bumpable = declared.filter(
      (d) =>
        d.field !== 'peerDependencies' &&
        !/^(workspace:|catalog:|link:|file:|npm:)/.test(d.range) &&
        !d.range.trim().startsWith('>')
    )
    // The label uses every declaration (a `>=` floor is still a runtime dependency).
    const published = declared.some(
      (d) => isRuntimeField(d.field) && versioned(d)
    )
    const runtime = declared.some((d) => isRuntimeField(d.field))
    const view = views.get(name)
    const registryLatest = view?.distTags?.latest ?? info.latest
    const override = overrides.find(
      (o) => o.name === name && o.kind === 'whole'
    )
    const base = {
      name,
      current: info.current,
      registryLatest,
      // dev | runtime-private (private app or root) | runtime-published (ships to users)
      kind: published
        ? 'runtime-published'
        : runtime
          ? 'runtime-private'
          : 'dev',
      runtime,
      where: [...new Set(declared.map((d) => d.path))],
      projects: [...new Set(declared.map((d) => d.project))],
      ranges: [...new Set(declared.map((d) => d.range))],
      peerRanges: declared
        .filter((d) => d.field === 'peerDependencies')
        .map((d) => `${d.project}: ${d.range}`),
      isDeprecated: !!info.isDeprecated,
      // A specifier that `pnpm up` can move (not only peer, `>=` or protocol ranges).
      bumpable: bumpable.length > 0,
      // Runtime bumps of packages that Changesets versions ship to users: a changeset.
      changesetPackages: [
        ...new Set(
          bumpable
            .filter((d) => versioned(d) && isRuntimeField(d.field))
            .map((d) => d.project)
        ),
      ],
    }

    if (info.isDeprecated && info.current === info.latest) {
      held.push({
        ...base,
        target: null,
        heldBy: 'deprecated on npm, already on its final release',
        reason: 'Replace it or drop it; there is nothing to bump.',
      })
      continue
    }
    if (override?.hold) {
      held.push({
        ...base,
        target: pickAgedTarget(
          view,
          info.current,
          minAgeMs,
          nowMs,
          exempt(name)
        ),
        heldBy: `override ${override.key}: ${override.value}`,
        reason: override.reason,
      })
      continue
    }
    if (registryLatest && cmpRaw(info.current, registryLatest) > 0) {
      // Above the `latest` dist-tag (a prerelease, or `latest` moved back): no upgrade.
      held.push({
        ...base,
        target: null,
        heldBy: `installed ${info.current} is above the latest dist-tag ${registryLatest}`,
        reason: 'Check by hand; never move it down.',
      })
      continue
    }
    const target = pickAgedTarget(
      view,
      info.current,
      minAgeMs,
      nowMs,
      exempt(name)
    )
    if (!target) {
      const latestIso = view?.time?.[registryLatest]
      const h = latestIso ? ageHours(latestIso, nowMs) : null
      // The first newer release passes the gate first: count from the oldest one.
      const newer = Object.entries(view?.time ?? {})
        .filter(
          ([ver]) =>
            ver !== 'created' &&
            ver !== 'modified' &&
            !parseVersion(ver).pre &&
            cmpRaw(ver, info.current) > 0 &&
            cmpRaw(ver, registryLatest) <= 0
        )
        .map(([, iso]) => ageHours(iso, nowMs))
        .filter((x) => x != null)
      const oldest = newer.length ? Math.max(...newer) : h
      tooFresh.push({
        ...base,
        registryLatestAgeHours: h,
        // Hours until the OLDEST newer release passes the gate (not registryLatest).
        hoursUntilEligible:
          oldest == null ? null : Math.max(0, Math.ceil(minAgeHours - oldest)),
        ageUnknown: !view,
        // Every newer release, oldest first, each with its own age and eligible time.
        freshVersions: freshVersionsOf(
          view,
          info.current,
          minAgeMs,
          nowMs,
          exempt(name)
        ),
      })
      continue
    }
    if (bumpable.length === 0) {
      // Only `>=` floors, peer or protocol ranges: no specifier changes, but the lockfile
      // regeneration (step 5.9) moves the resolved version. A breaking move there still
      // needs approval.
      const rCls = classify(info.current, target)
      if (!rCls.safe) {
        needsApproval.push({
          ...base,
          target,
          bumpType: rCls.bumpType,
          reason: rCls.reason,
          regenOnly: true,
          ifDeclined: info.current,
          note: 'only the lockfile regeneration moves it (open range); decline = add an upper bound',
        })
        continue
      }
      const rb = cmpRaw(registryLatest, target) > 0
      const rIso = rb ? view?.time?.[registryLatest] : null
      const rAge = rIso ? ageHours(rIso, nowMs) : null
      regen.push({
        ...base,
        target,
        bumpType: classify(info.current, target).bumpType,
        heldBack: rb,
        registryLatestAgeHours: rAge,
        hoursUntilEligible:
          rAge == null ? null : Math.max(0, Math.ceil(minAgeHours - rAge)),
        freshVersions: freshVersionsOf(
          view,
          target,
          minAgeMs,
          nowMs,
          exempt(name)
        ),
        note: 'no bumpable specifier; the lockfile regeneration moves it',
      })
      continue
    }

    const cls = classify(info.current, target)
    const heldBack = cmpRaw(registryLatest, target) > 0
    const latestIso = heldBack ? view?.time?.[registryLatest] : null
    const latestAge = latestIso ? ageHours(latestIso, nowMs) : null
    const changesetPackages = base.changesetPackages
    const entry = {
      ...base,
      target,
      heldBack,
      registryLatestAgeHours: latestAge,
      // Hours until registryLatest passes the gate. freshVersions gives each version.
      hoursUntilEligible:
        latestAge == null
          ? null
          : Math.max(0, Math.ceil(minAgeHours - latestAge)),
      // Every release above the target that the gate holds back, oldest first.
      freshVersions: freshVersionsOf(
        view,
        target,
        minAgeMs,
        nowMs,
        exempt(name)
      ),
      bumpType: cls.bumpType,
      reason: cls.reason,
      changesetPackages,
      overrideFloor: override ? `${override.key}: ${override.value}` : null,
    }
    if (!cls.safe) {
      // What the lockfile lands on if the user declines the major.
      // Projects can declare different ranges; the lowest result is what all of them allow.
      const options = [...new Set(bumpable.map((d) => d.range))].map(
        (range) =>
          pickAgedTarget(
            view,
            info.current,
            minAgeMs,
            nowMs,
            exempt(name),
            (v) => satisfies(v, range) === true
          ) ?? info.current
      )
      entry.ifDeclined = options.sort(cmpRaw)[0] ?? info.current
    }
    ;(cls.safe ? safe : needsApproval).push(entry)
    const map = cls.safe ? changeset : changesetIfApproved
    for (const p of changesetPackages) {
      map[p] ??= []
      map[p].push(`${name} ${info.current}→${target}`)
    }
  }

  // Majors that need each other (a peer of one target is another major) go together.
  const majorNames = new Set(needsApproval.map((e) => e.name))
  await pool(needsApproval, 6, async (e) => {
    const peers = await peersOf(e.name, e.target)
    // Coupled only if the peer range does not accept the version installed now. A range
    // that does not parse is "unknown": show it, do not drop it.
    const related = Object.entries(peers).filter(
      ([p]) => p !== e.name && majorNames.has(p)
    )
    e.requires = []
    e.requiresUnknown = []
    for (const [p, range] of related) {
      const other = needsApproval.find((x) => x.name === p)
      const ok = satisfies(other.current, range)
      if (ok === false) {
        e.requires.push(p)
      } else if (ok === null) {
        e.requiresUnknown.push(`${p} (${range})`)
      }
    }
  })
  for (const e of needsApproval) {
    for (const r of e.requires) {
      const other = needsApproval.find((x) => x.name === r)
      if (other && !other.requires.includes(e.name)) {
        other.requires.push(e.name)
      }
    }
  }

  // New dependencies that an aged target brings: no block (the gate covers the target),
  // but each new package lands unseen, so the table names it. null = the check failed.
  await pool(safe, 8, async (e) => {
    const fields = ['dependencies', 'optionalDependencies']
    const [t, c] = await Promise.all([
      npmViewFields(`${e.name}@${e.target}`, fields, root),
      npmViewFields(`${e.name}@${e.current}`, fields, root),
    ])
    if (!t || !c) {
      e.newDependencies = null
      return
    }
    const now = { ...t.dependencies, ...t.optionalDependencies }
    e.newDependencies = addedKeys(now, {
      ...c.dependencies,
      ...c.optionalDependencies,
    })
      .map((d) => `${d}@${now[d]}`)
      .sort()
  })

  // Exact-version overrides on packages that no project declares (transitive holds).
  for (const o of overrides.filter(
    (x) => x.hold && !candidateNames.has(x.name)
  )) {
    const view = views.get(o.name)
    const newer = pickAgedTarget(view, o.value, minAgeMs, nowMs, exempt(o.name))
    // An up-to-date direct dependency is not a candidate either: name its projects.
    const declarers = [...projects.values()].filter((ws) =>
      DEP_FIELDS.some((f) => ws.json?.[f]?.[o.name] != null)
    )
    held.push({
      name: o.name,
      current: o.value,
      registryLatest: view?.distTags?.latest ?? null,
      kind: !declarers.length
        ? 'transitive'
        : declarers.some((ws) => ws.json?.dependencies?.[o.name] != null)
          ? 'runtime-private'
          : 'dev',
      where: declarers.length
        ? declarers.map((ws) => ws.rel)
        : ['(override only)'],
      ranges: [],
      peerRanges: [],
      isDeprecated: false,
      target: newer,
      heldBy: `override ${o.key}: ${o.value}`,
      reason: o.reason,
      upToDate: !newer,
    })
  }

  // Open whole-package overrides: the regeneration re-resolves them. Report where they
  // move. Range selectors (`ws@<8`) only lift old copies, and path selectors are narrow.
  const overrideMoves = []
  // Range selectors with an open value (`validator@<13.15.26: >=13.15.26`) re-resolve too.
  for (const o of overrides.filter(
    (x) => !x.hold && (x.kind === 'whole' || x.kind === 'range')
  )) {
    const resolved = [...(lock.get(o.name) ?? [])].sort(cmpRaw)
    if (!resolved.length) {
      continue
    }
    const current = resolved[resolved.length - 1]
    // Only values that are semver ranges; npm: aliases, $refs and '-' (removal) are skipped.
    if (satisfies(current, o.value) == null) {
      continue
    }
    const target = pickAgedTarget(
      views.get(o.name),
      current,
      minAgeMs,
      nowMs,
      exempt(o.name),
      (v) => satisfies(v, o.value) === true
    )
    if (target) {
      overrideMoves.push({
        override: `${o.key}: ${o.value}`,
        kind: o.kind,
        name: o.name,
        lockVersions: resolved,
        target,
        // Breaking under caret rules: a new major, a 0.x minor or a 0.0.x patch.
        major: !classify(current, target).safe,
      })
    }
  }

  // The `pnpm up` commands for the safe batch. A name whose every group is safe goes in one
  // command. A name with mixed groups (e.g. next 16.x safe, next 15.x a major) gets a
  // filtered command, so pnpm does not rewrite the other projects' ranges.
  const groupsByName = new Map()
  for (const e of [...safe, ...needsApproval, ...held, ...regen, ...tooFresh]) {
    if (!groupsByName.has(e.name)) {
      groupsByName.set(e.name, [])
    }
    groupsByName.get(e.name).push(e)
  }
  const allSafe = []
  const upCommands = []
  for (const [n, list] of groupsByName) {
    const s = list.filter((e) => safe.includes(e))
    if (!s.length) {
      continue
    }
    if (s.length === list.length) {
      allSafe.push(n)
    } else {
      const filters = [...new Set(s.flatMap((e) => e.projects))]
        .map((p) => `--filter '${p}'`)
        .join(' ')
      upCommands.push(`pnpm -C '${root}' up -r --latest ${n} ${filters}`)
    }
  }
  allSafe.sort()
  if (allSafe.length) {
    upCommands.unshift(`pnpm -C '${root}' up -r --latest ${allSafe.join(' ')}`)
  }

  // Peer floors of versioned packages that are behind the latest release in their major.
  const peerFloors = []
  for (const p of peerDecls) {
    const floor = p.range.slice(1)
    const target = pickAgedTarget(
      views.get(p.dep),
      floor,
      minAgeMs,
      nowMs,
      exempt(p.dep),
      (v) => satisfies(v, p.range) === true
    )
    if (target) {
      peerFloors.push({
        project: p.project,
        name: p.dep,
        range: p.range,
        target: `${p.range[0]}${target}`,
      })
    }
  }

  // Range-selector (`ws@<=8.22.0: 8.22.0`) and path (`a>b: ^1`) overrides: neither a hold nor
  // an open whole-package range. Show them with the newest aged version, so the agent can
  // recheck whether the lift or floor is still current.
  const otherOverrides = []
  for (const o of overrides.filter((x) => x.kind !== 'whole')) {
    const resolved = [...(lock.get(o.name) ?? [])].sort(cmpRaw)
    const view = views.get(o.name)
    const newestAged = pickAgedTarget(
      view,
      '0.0.0',
      minAgeMs,
      nowMs,
      exempt(o.name)
    )
    otherOverrides.push({
      override: `${o.key}: ${o.value}`,
      kind: o.kind,
      name: o.name,
      lockVersions: resolved,
      newestAged,
      reason: o.reason,
    })
  }

  // Overrides that fall behind: lifts (`ws@<=8.22.0: 8.22.0`) and caret or tilde floors
  // with a newer aged release in the same major, and exact pins without a hold comment
  // (`check by hand`). Never across a major.
  const overrideUpdates = []
  for (const o of overrides) {
    const u = overrideUpdate(
      o,
      views.get(o.name),
      minAgeMs,
      nowMs,
      exempt(o.name)
    )
    if (u) {
      overrideUpdates.push({ file: 'pnpm-workspace.yaml', ...u })
    }
  }

  // Cross-check with pnpm's own resolver: the gated `pnpm outdated` `latest` must equal
  // the predicted target. A difference means the prediction drifted from pnpm.
  const gated = groupOutdated(gatedRaw)
  const targetMismatch = []
  for (const e of [...safe, ...needsApproval]) {
    const g = gated.get(`${e.name}@${e.current}`)
    // pnpm lists nothing newer = pnpm finds nothing aged: that is a mismatch too.
    if ((g?.latest ?? e.current) !== e.target) {
      targetMismatch.push({
        name: e.name,
        current: e.current,
        predicted: e.target,
        pnpm: g?.latest ?? 'nothing newer',
      })
    }
  }

  // Fast-track candidates: a fresh patch or minor (younger than the gate) that passes every
  // check goes through by default ('auto') with exact `name@version` exclude entries. The
  // checks replace the gate; one that cannot run blocks the candidate.
  const {
    candidates: fastTrack,
    skipped: fastTrackSkipped,
    families: fastTrackFamilies,
  } = await fastTrackCandidates(
    [
      // Not needsApproval: its target is an unapproved major, and a major is never
      // fast-tracked (also not a fresh patch on top of one).
      ...[...safe, ...regen]
        .filter((e) => e.heldBack)
        .map((e) => ({ entry: e, base: e.target })),
      ...tooFresh.map((e) => ({ entry: e, base: e.current })),
    ],
    { minAgeMs, nowMs, minAgeHours, exempt, views }
  )
  // The exact entries that every 'auto' family needs: the default fast-track. Fail closed
  // on any entry that is not one exact stable version (never a name, range, tag or glob).
  const excludesOf = (decision) =>
    [
      ...new Set(
        fastTrackFamilies
          .filter((f) => f.decision === decision)
          .flatMap((f) => f.excludeSet)
      ),
    ].sort()
  const autoExcludes = excludesOf('auto')
  // Clean, but without verified provenance: the user approves these by name.
  const needsApprovalExcludes = excludesOf('needs-approval')
  const badExcludes = invalidExcludeEntries([
    ...autoExcludes,
    ...needsApprovalExcludes,
  ])
  if (badExcludes.length) {
    process.stderr.write(
      `autoExcludes or needsApprovalExcludes hold entries that are not exact name@x.y.z: ${badExcludes.join(', ')}. No plan written.\n`
    )
    process.exit(2)
  }

  const staleExcludes = []
  for (const m of excludes) {
    if (!m.version) {
      continue
    }
    const iso = views.get(m.name)?.time?.[m.version]
    const h = iso ? ageHours(iso, nowMs) : null
    if (h != null && h >= minAgeHours) {
      staleExcludes.push({ entry: `${m.name}@${m.version}`, ageHours: h })
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name)
  for (const list of [
    safe,
    needsApproval,
    held,
    regen,
    tooFresh,
    overrideMoves,
  ]) {
    list.sort(byName)
  }

  const plan = {
    root,
    now: new Date(nowMs).toISOString(),
    minAgeHours,
    summary: {
      safe: safe.length,
      needsApproval: needsApproval.length,
      held: held.length,
      regen: regen.length,
      tooFresh: tooFresh.length,
      overrideMoves: overrideMoves.length,
      peerFloors: peerFloors.length,
      fastTrack: fastTrack.length,
      fastTrackAuto: fastTrack.filter((x) => x.decision === 'auto').length,
      fastTrackNeedsApproval: fastTrack.filter(
        (x) => x.decision === 'needs-approval'
      ).length,
      fastTrackBlocked: fastTrack.filter((x) => x.decision === 'blocked')
        .length,
      autoExcludes: autoExcludes.length,
      needsApprovalExcludes: needsApprovalExcludes.length,
      overrideUpdates: overrideUpdates.length,
      targetMismatch: targetMismatch.length,
      degraded: failures.length,
      staleExcludes: staleExcludes.length,
      changesetPackages: Object.keys(changeset).length,
    },
    safeNames: allSafe,
    upCommands,
    safe,
    needsApproval,
    held,
    regen,
    tooFresh,
    overrideMoves,
    changeset,
    changesetIfApproved,
    peerFloors,
    otherOverrides,
    overrideUpdates,
    targetMismatch,
    fastTrack,
    fastTrackFamilies,
    fastTrackSkipped,
    autoExcludes,
    needsApprovalExcludes,
    staleExcludes,
    // Calls that failed. Non-null means the plan is incomplete: rerun, do not trust "none".
    degraded: failures.length ? failures : null,
    deprecated: [...safe, ...needsApproval, ...held, ...regen, ...tooFresh]
      .filter((e) => e.isDeprecated)
      .map((e) => e.name),
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  printSummary(plan)
}

function printSummary(plan) {
  const e = process.stderr
  const h = plan.minAgeHours
  const kindLabel = {
    'runtime-published': 'runtime (released)',
    'runtime-private': 'runtime (private)',
    dev: 'dev',
    transitive: 'transitive',
  }
  const where = (x) =>
    x.where.length > 3
      ? `${x.where.slice(0, 3).join(', ')} +${x.where.length - 3}`
      : x.where.join(', ')
  // "fresh: 14.11.1 (22.4h old, eligible in ~1.6h), 14.12.0 (2.8h old, eligible in ~21.2h)"
  const freshList = (list) =>
    list
      .map(
        (f) =>
          `${f.version} (${f.ageHours ?? '?'}h old, eligible in ~${f.eligibleInHours ?? '?'}h)`
      )
      .join(', ')
  const notes = (x) =>
    [
      where(x),
      x.freshVersions?.length
        ? `fresh (<${h}h): ${freshList(x.freshVersions)}`
        : '',
      x.newDependencies === null
        ? 'new dependencies: UNKNOWN (npm call failed)'
        : x.newDependencies?.length
          ? `new dependencies: ${x.newDependencies.join(', ')}`
          : '',
      x.ifDeclined ? `if declined: ${x.ifDeclined}` : '',
      x.requires?.length ? `goes with ${x.requires.join(', ')}` : '',
      x.peerRanges.length ? `peer: ${x.peerRanges.join('; ')}` : '',
      x.isDeprecated ? 'DEPRECATED' : '',
    ]
      .filter(Boolean)
      .join(' · ')
  const row = (x) => [
    `\`${x.name}\``,
    kindLabel[x.kind],
    x.current,
    x.target,
    x.reason === 'zerox-minor'
      ? 'minor (0.x)'
      : x.reason === 'zero-zero-patch'
        ? 'patch (0.0.x)'
        : x.bumpType,
    notes(x),
  ]
  const headers = ['Package', 'Kind', 'From', 'To', 'Bump', 'Where / notes']
  const section = (title, list, render) => {
    e.write(`\n### ${title} (${list.length})\n\n`)
    e.write(list.length ? `${render(list)}\n` : 'None.\n')
  }

  if (plan.degraded) {
    e.write(
      `\n**DEGRADED: ${plan.degraded.length} registry/API call(s) failed. The plan is incomplete. Rerun before you trust an empty section.**\n${plan.degraded
        .slice(0, 10)
        .map((f) => `- ${f.call}: ${f.error}`)
        .join('\n')}\n`
    )
  }
  e.write(`\n## npm dependencies (release-age gate ${h}h)\n`)
  section('Safe: patch and >=1.x minor', plan.safe, (l) =>
    mdTable(headers, l.map(row))
  )
  section('Needs approval: major or 0.x minor', plan.needsApproval, (l) =>
    mdTable(headers, l.map(row))
  )
  section('Held', plan.held, (l) =>
    mdTable(
      ['Package', 'Kind', 'Current', 'Available', 'Held by', 'Reason'],
      l.map((x) => [
        `\`${x.name}\``,
        kindLabel[x.kind],
        x.current,
        x.target ?? '—',
        x.heldBy,
        x.reason ?? '',
      ])
    )
  )
  section(
    'Fast-track candidates (auto = let through by default; needs approval = clean, but no verified provenance; BLOCKED = red flag)',
    plan.fastTrack,
    (l) =>
      mdTable(
        [
          'Package',
          'Kind',
          'Family',
          'Decision',
          'Version',
          'Age',
          'Eligible in',
          'Tried',
          'Red flags',
          'Skipped newer versions',
          'Notes',
          'Exclude entries needed',
        ],
        l.map((x) => [
          `\`${x.name}\``,
          kindLabel[x.kind] ?? x.kind,
          x.family,
          x.decision === 'blocked'
            ? 'BLOCKED'
            : x.decision === 'needs-approval'
              ? `needs approval (no verified provenance: ${x.provenanceUnverified.join(', ')})`
              : 'auto',
          x.fresh,
          x.ageHours == null ? '?' : `${x.ageHours}h`,
          x.eligibleInHours == null ? '?' : `~${x.eligibleInHours}h`,
          x.tried
            .map((t) => `${t.version} (${t.redFlags.length} flags)`)
            .join(', '),
          x.redFlags.length
            ? x.redFlags.join('; ')
            : x.blockedByFamily
              ? 'none of its own: a family member is flagged'
              : 'none',
          x.skippedFlags.length ? x.skippedFlags.join('; ') : '',
          x.notes.length
            ? `${x.notes.length} lockstep pins, exclude set of ${x.excludeSet.length}`
            : '',
          x.excludeSet.join(', '),
        ])
      )
  )
  const fams = plan.fastTrackFamilies.filter((f) => f.members.length > 1)
  if (fams.length) {
    e.write(
      `\nFamilies (one red flag blocks every member): ${fams
        .map(
          (f) =>
            `${f.family} [${f.versions.join(', ')}] ${f.decision === 'blocked' ? `BLOCKED: ${f.redFlags.length} flags` : `${f.decision}, exclude set of ${f.excludeSet.length}`}`
        )
        .join('; ')}\n`
    )
  }
  e.write(
    `\n**autoExcludes (${plan.autoExcludes.length}):** ${
      plan.autoExcludes.map((x) => `\`${x}\``).join(', ') || 'none'
    }\n\n**needsApprovalExcludes (${plan.needsApprovalExcludes.length}):** ${
      plan.needsApprovalExcludes.map((x) => `\`${x}\``).join(', ') || 'none'
    }\n`
  )
  if (plan.fastTrackSkipped.length) {
    e.write(
      `\nNot offered for fast-track (a major is never fast-tracked): ${plan.fastTrackSkipped
        .map((x) => `\`${x.name}@${x.fresh}\` (${x.reason})`)
        .join('; ')}\n`
    )
  }
  section(
    'Range-selector and path overrides (recheck)',
    plan.otherOverrides,
    (l) =>
      mdTable(
        ['Override', 'Kind', 'Lockfile now', 'Newest aged', 'Reason'],
        l.map((x) => [
          `\`${x.override}\``,
          x.kind,
          x.lockVersions.join(', ') || '—',
          x.newestAged ?? '?',
          x.reason ?? '',
        ])
      )
  )
  section(
    'Override updates (lifts and floors behind the newest aged release)',
    plan.overrideUpdates,
    (l) =>
      mdTable(
        ['File', 'Override now', 'Proposed', 'Reason'],
        l.map((x) => [
          x.file,
          `\`${x.key}: ${x.value}\``,
          `\`${x.newKey}: ${x.newValue}\``,
          x.reason,
        ])
      )
  )
  if (plan.targetMismatch.length) {
    e.write(
      `\n**Target differs from pnpm's gated resolver** (trust pnpm, report the difference): ${plan.targetMismatch
        .map(
          (x) =>
            `\`${x.name}\` ${x.current}: predicted ${x.predicted}, pnpm ${x.pnpm}`
        )
        .join('; ')}\n`
    )
  }
  section('Lockfile regeneration only (open ranges)', plan.regen, (l) =>
    mdTable(
      ['Package', 'Kind', 'Resolved', 'Moves to', 'Where'],
      l.map((x) => [
        `\`${x.name}\``,
        kindLabel[x.kind],
        x.current,
        x.target,
        where(x),
      ])
    )
  )
  section(
    `Too fresh: every newer release is younger than ${h}h`,
    plan.tooFresh,
    (l) =>
      mdTable(
        ['Package', 'Current', 'Fresh versions (age, eligible in)'],
        l.map((x) => [
          `\`${x.name}\``,
          x.current,
          x.ageUnknown
            ? `${x.registryLatest} (age unknown)`
            : freshList(x.freshVersions ?? []) || x.registryLatest,
        ])
      )
  )
  section(
    'Open overrides that the regeneration moves',
    plan.overrideMoves,
    (l) =>
      mdTable(
        ['Package', 'Override', 'Lockfile now', 'Moves to', 'Major?'],
        l.map((x) => [
          `\`${x.name}\``,
          `\`${x.override}\``,
          x.lockVersions.join(', '),
          x.target,
          x.major ? 'YES' : 'no',
        ])
      )
  )
  const cs = Object.entries(plan.changeset)
  e.write(`\n### Changeset needed (${cs.length} package(s))\n\n`)
  e.write(
    cs.length
      ? `${cs.map(([p, r]) => `- \`${p}\`: ${r.join(', ')}`).join('\n')}\n`
      : 'None: dev-only bumps or private projects.\n'
  )
  const ci = Object.entries(plan.changesetIfApproved)
  if (ci.length) {
    e.write(
      `\nOnly if the majors are approved: ${ci.map(([p, r]) => `\`${p}\` (${r.join(', ')})`).join('; ')}\n`
    )
  }
  section(
    'Aged-out minimumReleaseAgeExclude entries',
    plan.staleExcludes,
    (l) => l.map((x) => `- \`${x.entry}\` (${x.ageHours}h old)`).join('\n')
  )
  section(
    'Peer floors of released packages behind the latest release',
    plan.peerFloors,
    (l) =>
      mdTable(
        ['Package', 'Peer', 'Floor now', 'Latest floor'],
        l.map((x) => [`\`${x.project}\``, `\`${x.name}\``, x.range, x.target])
      )
  )
  if (plan.deprecated.length) {
    e.write(`\nDeprecated on npm: ${plan.deprecated.join(', ')}\n`)
  }
  e.write(
    `\n### Commands for the safe batch\n\n${
      plan.upCommands.length
        ? plan.upCommands.map((c) => `- \`${c}\``).join('\n')
        : 'None.'
    }\n\n`
  )
}

main()
