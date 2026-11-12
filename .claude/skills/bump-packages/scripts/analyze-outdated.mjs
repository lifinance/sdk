#!/usr/bin/env node
// analyze-outdated.mjs — npm dependency plan for bump.mjs.
//
// Reads `pnpm outdated -r --format json` (with pnpm's own release-age gate turned off, so a
// package whose every newer version is too fresh still shows up). For each outdated
// external dependency it predicts the version that pnpm installs under the gate, classifies
// the bump by SemVer risk, and maps which publishable packages need a changeset. It also
// reports what `pnpm outdated` cannot see:
//   - exact-version overrides (holds), also on transitive packages,
//   - open overrides that the lockfile regeneration will move, and whether by a major,
//   - `minimumReleaseAgeExclude` entries that have aged out,
//   - fast-track decisions for fresh releases (`fastTrack`, `fastTrackFamilies`),
//   - override lifts and floors that fell behind (`overrideUpdates`).
//
// Output: a JSON plan on stdout; errors on stderr. Read-only. Exits 2 if `pnpm outdated` or
// `pnpm ls` fails (the plan would be wrong), if --fast-track-min-age-hours is not a number,
// or if a fast-track exclude entry is not an exact `name@x.y.z`; otherwise 0. Needs an
// authenticated `gh` CLI for the advisory check (without it every fast-track is blocked).
//
// Usage: node analyze-outdated.mjs [--root <repo>] [--fast-track-min-age-hours <N>]

import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  addedKeys,
  agedOrExempt,
  ageHours,
  classify,
  cmpRaw,
  DEP_FIELDS,
  execFileP,
  failures,
  freshVersionsOf,
  globToRegExp,
  groupOutdated,
  invalidExcludeEntries,
  isExcluded,
  isVersionLike,
  minAgeMinutesFromYaml,
  npmView,
  npmViewFields,
  overrideUpdate,
  parseExcludes,
  parseLock,
  parseSelector,
  parseVersion,
  pickAgedTarget,
  readJson,
  readText,
  readWorkspaceYaml,
  registryVersionDoc,
  satisfies,
  yamlList,
  yamlMap,
} from './lib.js'
import {
  advisoriesFor,
  checkExactEntry,
  decideFamily,
  familyKeyOf,
  groupFamilies,
  META_FIELDS,
  malwareCoveringAny,
  metadataFlags,
  packageMalwareFor,
  provenanceOf,
} from './security.js'

const fail = (msg) => {
  process.stderr.write(`${msg}\n`)
  process.exit(2)
}

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    // A clean fast-track is 'auto' only when every entry of its exclude set is this old.
    'fast-track-min-age-hours': { type: 'string', default: '6' },
  },
})
const root = values.root ? resolve(values.root) : process.cwd()
const floorHours = Number(values['fast-track-min-age-hours'])
if (!Number.isFinite(floorHours) || floorHours < 0) {
  fail(
    `--fast-track-min-age-hours takes a number of 0 or more, not "${values['fast-track-min-age-hours']}"`
  )
}

// --- shared registry caches -----------------------------------------------------------
// Every npm call goes through one cache per kind, so the peer, new-dependency and
// fast-track steps (which run at the same time) never ask for the same thing twice. A
// semaphore keeps the number of npm processes bounded.

function semaphore(n) {
  let active = 0
  const queue = []
  const next = () => {
    if (active < n && queue.length) {
      active++
      queue.shift()()
    }
  }
  return async (fn) => {
    await new Promise((r) => {
      queue.push(r)
      next()
    })
    try {
      return await fn()
    } finally {
      active--
      next()
    }
  }
}
const npmSlot = semaphore(16)
// GitHub API calls (advisories) stay few at a time: GitHub limits bursts.
const ghSlot = semaphore(6)
const fetchSlot = semaphore(8)
const cached = (map, k, fn) => {
  if (!map.has(k)) {
    map.set(k, fn())
  }
  return map.get(k)
}
const viewCache = new Map()
// { time, distTags } of a package, or null (recorded in `failures`).
const viewOf = (name) =>
  cached(viewCache, name, () => npmSlot(() => npmView(name, root)))
const metaCache = new Map()
const metaOf = (spec) =>
  cached(metaCache, spec, () =>
    npmSlot(() => npmViewFields(spec, META_FIELDS, root))
  )
// The raw version document: the only source of the real `oidcConfigId`.
const rawCache = new Map()
const rawDocOf = (name, version) =>
  cached(rawCache, `${name}@${version}`, () =>
    fetchSlot(() => registryVersionDoc(name, version, root))
  )

async function runOutdated() {
  let out = ''
  try {
    ;({ stdout: out } = await execFileP(
      'pnpm',
      ['outdated', '-r', '--format', 'json', '--config.minimum-release-age=0'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    ))
  } catch (err) {
    // `pnpm outdated` exits 1 when something is outdated; that is the normal case. Any
    // other failure (registry, auth, wrong pnpm) must stop the plan, not look like
    // "nothing is outdated".
    out = err.stdout ? err.stdout.toString() : ''
    if (err.code !== 1 || !out.includes('{')) {
      const msg = err.stderr
        ? err.stderr.toString().trim()
        : String(err.message)
      fail(`pnpm outdated failed (exit ${err.code}): ${msg}`)
    }
  }
  const start = out.indexOf('{')
  if (start === -1) {
    return {}
  }
  try {
    return JSON.parse(out.slice(start))
  } catch (e) {
    fail(`pnpm outdated printed invalid JSON: ${e.message}`)
  }
}

// Workspace projects as pnpm sees them (`pnpm ls -r --depth -1 --json`): the same set
// that `pnpm outdated` reports locations for.
async function workspaceProjects() {
  let out
  try {
    ;({ stdout: out } = await execFileP(
      'pnpm',
      ['ls', '-r', '--depth', '-1', '--json'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    ))
  } catch (err) {
    fail(`pnpm ls -r failed: ${String(err.message).split('\n')[0]}`)
  }
  const map = new Map()
  for (const p of JSON.parse(out.slice(out.indexOf('[')))) {
    const dir = resolve(p.path)
    const rel = relative(root, dir) || '.'
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
  if (!map.size) {
    fail('pnpm ls -r found no workspace project.')
  }
  return map
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

const DEP_MAPS = ['dependencies', 'optionalDependencies', 'peerDependencies']
const splitSpec = (spec) => {
  const at = spec.lastIndexOf('@')
  return [spec.slice(0, at), spec.slice(at + 1)]
}

// The metadata checks for one fresh version `f` against a trusted reference `b` (the
// version that lands otherwise, or the aged release below it). Provenance, advisories, the
// trusted-publisher config and the dependency walk run separately (see checkVersion). Flags
// of the compromise class (a publisher change, a trusted publisher that is gone or
// different, a new or changed install script) also go into `compromise`: they block every
// fresh version of the package and its family, with no fallback.
function redFlagsOf(label, f, b, compromise = []) {
  const r = metadataFlags(label, f, b)
  compromise.push(...r.compromise)
  return r.flags
}

// Fast-track: a fresh patch or minor (younger than the gate) that passes all checks, has
// verified provenance (same repository and workflow as its reference), and whose every
// exclude entry is at least `floorHours` old, is let through by default ('auto') with exact
// `name@version` exclude entries. A clean one without verified provenance, or with a
// younger entry, is 'needs-approval'. No person reviews an 'auto' one, so every check fails
// closed: a check that cannot run is a red flag.
//
// For each candidate, checkVersion() tests one fresh version against the version that lands
// otherwise (`base`): the metadata checks, then its dependency ranges (up to 4 levels). A
// range that no aged version meets needs an exact exclude entry: take the EARLIEST fresh
// version that meets it (later ones stay gated, so pnpm resolves to it) and check it against
// the aged release below it. Every entry of the exclude set then gets the advisory check,
// the provenance-source check and the trusted-publisher config check.
//
// Candidates that move together form a family (groupFamilies). decideFamily() checks every
// fresh version: a compromise flag on any of them blocks the family with no fallback.
// Otherwise it picks the newest level where every member is clean (older fresh versions are
// a fallback for other flags). One red flag in the family blocks the whole family. A fresh
// major is never fast-tracked.
async function fastTrackCandidates(items, ctx) {
  const advCache = new Map()
  const advisoryOf = (name, version) =>
    cached(advCache, `${name}@${version}`, () =>
      ghSlot(() => advisoriesFor(name, version, root))
    )
  const provCache = new Map()
  const provOf = (name, version) =>
    cached(provCache, `${name}@${version}`, () =>
      fetchSlot(() => provenanceOf(name, version, root))
    )
  const pkgMalwareCache = new Map()
  const pkgMalwareOf = (name) =>
    cached(pkgMalwareCache, name, () =>
      ghSlot(() => packageMalwareFor(name, root))
    )

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

  // Advisories, provenance source and trusted-publisher config for one exclude entry
  // against its reference (lib.js checkExactEntry). Returns { flags, compromise, verified }.
  const io = {
    advisories: advisoryOf,
    provenance: provOf,
    meta: metaOf,
    rawDoc: rawDocOf,
  }
  const networkFlags = ({ spec, comparedWith }) =>
    checkExactEntry(spec, comparedWith, io)

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
    const prefetch = (nodes) =>
      Promise.all(
        nodes.flatMap(({ from }) =>
          edgesOf(from).map(registryName).filter(Boolean).map(viewOf)
        )
      )

    let frontier = [{ from: f, ref: b, owner: label, ownerVersion: fresh }]
    const MAX_DEPTH = 4
    for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
      // Pass 1: fetch the whole level at once and find every edge that needs a fresh
      // version. Pass 2: check those versions (their metadata is already in flight).
      await prefetch(frontier)
      const needs = []
      for (const node of frontier) {
        for (const { m, key, spec } of edgesOf(node.from)) {
          const n = await inspect(node.owner, node.ref, m, key, spec)
          if (!n) {
            continue
          }
          // The range check runs for EVERY owner, also when an earlier owner already put
          // this version in excludeSet (a second owner that moves onto it gets its flag too).
          // A lockstep family (motion + framer-motion, rolldown + its bindings) pins the
          // same new version on every release: no flag. Any other move to a fresh-only
          // range is a red flag.
          if (
            n.oldRange &&
            n.oldRange !== n.range &&
            n.need !== node.ownerVersion
          ) {
            redFlags.push(
              `${node.owner}: ${m} range of ${n.dep} changed ${n.oldRange} → ${n.range}, and only a fresh version meets it`
            )
          }
          if (excludeSet.some((x) => x.spec === `${n.dep}@${n.need}`)) {
            continue
          }
          // Reference: the previous aged release below `need` (the one it replaces), or
          // the newest aged release if there is none below.
          const agedBelow = (accept) =>
            pickAgedTarget(
              n.view,
              '0.0.0',
              ctx.minAgeMs,
              ctx.nowMs,
              ctx.exempt(n.dep),
              accept
            )
          n.trusted =
            agedBelow((x) => cmpRaw(x, n.need) < 0) ?? agedBelow(undefined)
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
          n.trusted ? metaOf(`${n.dep}@${n.trusted}`) : null,
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
    await prefetch(frontier)
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
    // Advisories, provenance source and trusted-publisher config for every exclude entry.
    const net = await Promise.all(excludeSet.map(networkFlags))
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
      excludeSet: excludeSet.map((x) => x.spec),
    }
  }

  // Phase 1: the newest fresh version of every candidate (its exclude set joins families).
  const first = await Promise.all(
    eligible.map((it) => checkVersion(it, it.fresh[0].version))
  )
  // Phase 2: families, then one decision per family (results of phase 1 are cached).
  const groups = groupFamilies(
    eligible.map((it, i) => ({
      name: it.entry.name,
      excludeSet: first[i].excludeSet,
    }))
  )
  const decisions = await Promise.all(
    groups.map((g) =>
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
  )

  // The fast-track floor, after decideFamily: a clean family is 'auto' only when every
  // entry of its exclude set is at least `floorHours` old. An unknown age counts as too
  // young. (decideFamily does not know the floor, so a too-young family does not fall back
  // to an older fresh version that is old enough.)
  const tooYoungOf = async (excludeSet) => {
    const out = []
    for (const spec of excludeSet) {
      const [name, version] = splitSpec(spec)
      const iso = (await viewOf(name))?.time?.[version]
      const h = iso ? ageHours(iso, ctx.nowMs) : null
      if (h == null || h < floorHours) {
        out.push(`${spec} (${h ?? '?'} h)`)
      }
    }
    return out
  }

  const candidates = []
  const families = []
  for (const [gi, g] of groups.entries()) {
    const d = decisions[gi]
    const names = g.map((i) => eligible[i].entry.name)
    const tooYoung =
      d.decision === 'blocked' ? [] : await tooYoungOf(d.excludeSet)
    const decision =
      d.decision === 'auto' && tooYoung.length ? 'needs-approval' : d.decision
    // Why a family needs approval: 'no-provenance', 'too-young', or both.
    const reasons =
      decision === 'needs-approval'
        ? [
            ...(d.unverifiedProvenance.length ? ['no-provenance'] : []),
            ...(tooYoung.length ? ['too-young'] : []),
          ]
        : []
    families.push({
      family: names.map(familyKeyOf).find(Boolean) ?? names[0],
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
      // Exclude entries without verified provenance (reason 'no-provenance').
      unverifiedProvenance: d.unverifiedProvenance,
      // Exclude entries younger than the floor, with their age (reason 'too-young').
      tooYoung,
      reasons,
      decision,
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
      candidates.push({
        name: entry.name,
        kind: entry.kind,
        current: entry.current,
        decision,
        reasons,
        // The version that the fast-track lets through ('auto'), or the newest tried one.
        fresh: version,
        bumpType: classify(base, version).bumpType,
        ageHours: fresh.find((x) => x.version === version)?.ageHours ?? null,
        // Own flags: none unless 'blocked'; then every flag of every fresh version of this
        // member. A member can be clean and still blocked by a sibling.
        redFlags: decision === 'blocked' ? ownFlags : [],
        // auto / needs-approval: the flags of newer fresh versions that were skipped.
        skippedFlags: d.skippedFlags[id],
        // The packages whose changeset must name it.
        changesetPackages: entry.changesetPackages ?? [],
        // The project folders that declare it (bump.mjs edits their bumpable specifiers).
        where: entry.where,
        bumpable: !!entry.bumpable,
        // The exact entries this version needs.
        excludeSet: chosen?.excludeSet ?? [],
      })
    }
  }
  return { candidates, skipped, families }
}

const isRuntimeField = (f) =>
  f === 'dependencies' || f === 'optionalDependencies'

async function main() {
  const yaml = readWorkspaceYaml(root)
  const [projects, outdatedRaw] = await Promise.all([
    workspaceProjects(),
    runOutdated(),
  ])
  const overrides = yamlMap(yaml, 'overrides').map((o) => ({
    ...o,
    ...parseSelector(o.key),
  }))
  for (const o of overrides) {
    o.hold = o.kind === 'whole' && isVersionLike(o.value)
  }
  const excludes = parseExcludes(yamlList(yaml, 'minimumReleaseAgeExclude'))
  const lock = parseLock(readText(root, 'pnpm-lock.yaml'))
  // The gate of this project. bump.mjs makes sure that a branch cannot lower it.
  const minAgeHours = minAgeMinutesFromYaml(yaml) / 60
  const minAgeMs = minAgeHours * 3600 * 1000
  const nowMs = Date.now()
  const exempt = (name) => (v) => isExcluded(excludes, name, v)

  // `pnpm outdated` keys are not always plain names. With more than one resolved version or
  // dependency type it uses `next@16.4.2` or `vite-plugin-node-polyfills@0.26.0 (dev)`.
  // Group by the real name and the installed version; each group is classified alone.
  const candidates = [...groupOutdated(outdatedRaw).entries()]
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
  await Promise.all(names.map(viewOf))
  const views = new Map()
  for (const n of names) {
    views.set(n, await viewOf(n))
  }

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
    const agedTarget = (from, accept) =>
      pickAgedTarget(view, from, minAgeMs, nowMs, exempt(name), accept)

    if (info.isDeprecated && info.current === info.latest) {
      held.push({
        ...base,
        target: null,
        heldBy: 'deprecated on npm, already on its final release',
        reason: 'Replace it or drop it; there is nothing to bump.',
      })
      continue
    }
    const override = overrides.find(
      (o) => o.name === name && o.kind === 'whole'
    )
    if (override?.hold) {
      held.push({
        ...base,
        target: agedTarget(info.current),
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
    const target = agedTarget(info.current)
    if (!target) {
      tooFresh.push({
        ...base,
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
    const cls = classify(info.current, target)
    const heldBack = cmpRaw(registryLatest, target) > 0
    if (bumpable.length === 0) {
      // Only `>=` floors, peer or protocol ranges: no specifier changes, but the lockfile
      // regeneration moves the resolved version. A breaking move there still needs
      // approval.
      if (!cls.safe) {
        needsApproval.push({
          ...base,
          target,
          bumpType: cls.bumpType,
          reason: cls.reason,
          regenOnly: true,
          ifDeclined: info.current,
          note: 'only the lockfile regeneration moves it (open range); decline = add an upper bound',
        })
        continue
      }
      regen.push({
        ...base,
        target,
        bumpType: cls.bumpType,
        heldBack,
        note: 'no bumpable specifier; the lockfile regeneration moves it',
      })
      continue
    }
    const entry = {
      ...base,
      target,
      heldBack,
      bumpType: cls.bumpType,
      reason: cls.reason,
    }
    if (!cls.safe) {
      // What the lockfile lands on if the user declines the major.
      // Projects can declare different ranges; the lowest result is what all of them allow.
      const options = [...new Set(bumpable.map((d) => d.range))].map(
        (range) =>
          agedTarget(info.current, (v) => satisfies(v, range) === true) ??
          info.current
      )
      entry.ifDeclined = options.sort(cmpRaw)[0] ?? info.current
    }
    ;(cls.safe ? safe : needsApproval).push(entry)
    const map = cls.safe ? changeset : changesetIfApproved
    for (const p of base.changesetPackages) {
      map[p] ??= []
      map[p].push(`${name} ${info.current}→${target}`)
    }
  }

  // Majors that need each other (a peer of one target is another major) go together.
  const majorNames = new Set(needsApproval.map((e) => e.name))
  const peersStep = Promise.all(
    needsApproval.map(async (e) => {
      // A failure is recorded in `failures` (degraded plan), never treated as "no peers".
      const peers =
        (await metaOf(`${e.name}@${e.target}`))?.peerDependencies ?? {}
      // Coupled only if the peer range does not accept the version installed now. A range
      // that does not parse is "unknown": show it, do not drop it.
      e.requires = []
      e.requiresUnknown = []
      for (const [p, range] of Object.entries(peers)) {
        if (p === e.name || !majorNames.has(p)) {
          continue
        }
        const other = needsApproval.find((x) => x.name === p)
        const ok = satisfies(other.current, range)
        if (ok === false) {
          e.requires.push(p)
        } else if (ok === null) {
          e.requiresUnknown.push(`${p} (${range})`)
        }
      }
    })
  )

  // New dependencies that an aged target brings: no block (the gate covers the target),
  // but each new package lands unseen, so the summary names it. null = the check failed.
  const newDepsStep = Promise.all(
    safe.map(async (e) => {
      const [t, c] = await Promise.all([
        metaOf(`${e.name}@${e.target}`),
        metaOf(`${e.name}@${e.current}`),
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
  )

  // Fast-track candidates: a fresh patch or minor (younger than the gate) that passes every
  // check goes through by default ('auto') with exact `name@version` exclude entries. The
  // checks replace the gate; one that cannot run blocks the candidate.
  const fastTrackStep = fastTrackCandidates(
    [
      // Not needsApproval: its target is an unapproved major, and a major is never
      // fast-tracked (also not a fresh patch on top of one).
      ...[...safe, ...regen]
        .filter((e) => e.heldBack)
        .map((e) => ({ entry: e, base: e.target })),
      ...tooFresh.map((e) => ({ entry: e, base: e.current })),
    ],
    { minAgeMs, nowMs, exempt }
  )
  const [, , ft] = await Promise.all([peersStep, newDepsStep, fastTrackStep])
  for (const e of needsApproval) {
    for (const r of e.requires) {
      const other = needsApproval.find((x) => x.name === r)
      if (other && !other.requires.includes(e.name)) {
        other.requires.push(e.name)
      }
    }
  }
  // Fail closed on any exclude entry that is not one exact stable version (never a name,
  // range, tag or glob). bump.mjs checks the entries again before the yaml edit.
  const badExcludes = invalidExcludeEntries(
    ft.families
      .filter((f) => f.decision !== 'blocked')
      .flatMap((f) => f.excludeSet)
  )
  if (badExcludes.length) {
    fail(
      `fast-track exclude sets hold entries that are not exact name@x.y.z: ${badExcludes.join(', ')}. No plan written.`
    )
  }

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
      isDeprecated: false,
      target: newer,
      heldBy: `override ${o.key}: ${o.value}`,
      reason: o.reason,
      upToDate: !newer,
    })
  }

  // Open whole-package overrides and range selectors with an open value
  // (`validator@<13.15.26: >=13.15.26`): the regeneration re-resolves them. Report where
  // they move. Path selectors are narrow.
  const overrideMoves = []
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

  // Peer floors of versioned packages that are behind the latest release in their major.
  const peerFloors = []
  for (const p of peerDecls) {
    const target = pickAgedTarget(
      views.get(p.dep),
      p.range.slice(1),
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
    fastTrackMinAgeHours: floorHours,
    safe,
    needsApproval,
    held,
    regen,
    tooFresh,
    overrideMoves,
    changeset,
    changesetIfApproved,
    peerFloors,
    overrideUpdates,
    fastTrack: ft.candidates,
    fastTrackFamilies: ft.families,
    fastTrackSkipped: ft.skipped,
    staleExcludes,
    // Calls that failed. Non-null means the plan is incomplete: rerun, do not trust "none".
    degraded: failures.length ? failures : null,
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
}

main()
