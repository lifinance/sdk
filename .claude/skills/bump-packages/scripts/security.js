// security.js — the fast-track checks of the bump-packages scripts: advisories, provenance,
// families, and the checks of one exact exclude entry. Same copy rule as lib.js.

import {
  addedKeys,
  cmpRaw,
  failures,
  ghApi,
  OTHER_REGISTRY,
  onNpmjs,
  pickAgedTarget,
  satisfies,
  specName,
} from './lib.js'

// Lockstep families. A package belongs to the family of the first rule that matches, or to
// its own family. There is no generic same-scope rule: unrelated `@types/*` releases must
// not block each other.
const FAMILY_RULES = [
  [/^(next|@next\/.+)$/, 'next'],
  [/^(typescript-eslint|@typescript-eslint\/.+)$/, 'typescript-eslint'],
  [/^(motion|framer-motion|motion-dom|motion-utils)$/, 'motion'],
  [/^@dynamic-labs\/.+$/, '@dynamic-labs'],
]

export function familyKeyOf(name) {
  for (const [re, key] of FAMILY_RULES) {
    if (re.test(name)) {
      return key
    }
  }
  return null
}

// Group candidates into families. Each member is { name, excludeSet }. Two members join
// only when (1) a family rule names both, or (2) one exclude set holds the other member or
// both hold the same entry (a lockstep pin). Returns arrays of member indexes, in input order.
export function groupFamilies(members) {
  const parent = members.map((_, i) => i)
  const find = (i) => {
    let r = i
    while (parent[r] !== r) {
      r = parent[r]
    }
    return r
  }
  const join = (a, b) => {
    parent[find(a)] = find(b)
  }
  const byKey = new Map()
  const bySpec = new Map()
  members.forEach((m, i) => {
    const k = familyKeyOf(m.name)
    if (k) {
      if (byKey.has(k)) {
        join(i, byKey.get(k))
      } else {
        byKey.set(k, i)
      }
    }
    for (const spec of m.excludeSet ?? []) {
      if (bySpec.has(spec)) {
        join(i, bySpec.get(spec))
      } else {
        bySpec.set(spec, i)
      }
    }
  })
  members.forEach((m, i) => {
    members.forEach((o, j) => {
      if (i !== j && (m.excludeSet ?? []).some((s) => specName(s) === o.name)) {
        join(i, j)
      }
    })
  })
  const groups = new Map()
  members.forEach((_, i) => {
    const r = find(i)
    if (!groups.has(r)) {
      groups.set(r, [])
    }
    groups.get(r).push(i)
  })
  return [...groups.values()]
}

// Pick the versions for one family and its decision.
//
// `members` is [{ id?, name, fresh: [versions, newest first] }]; `id` (default: the name)
// keys the result. `check(member, version)` resolves to { redFlags, compromiseFlags,
// unverifiedProvenance, excludeSet, … }. `packageCheck(member)` (optional) resolves to
// { compromiseFlags } for checks on the whole package (a malware advisory on any fresh
// version).
//
// 1. Every fresh version of every member is checked. A compromise flag (advisory hit,
//    publisher change, dropped or changed provenance, new or changed install script) on ANY
//    of them blocks the whole family: no fallback.
// 2. Otherwise the levels are tried in order: the newest of each member, then each version
//    that ALL members have, newest first (a family never splits across versions). The first
//    level without any red flag wins. Older fresh versions are a fallback only for other
//    flags (ranges, coverage, new dependencies, specs).
// 3. The winning level is 'auto' only when every exclude entry of every member has verified
//    provenance (reference and fresh version, same repository and workflow). Otherwise it is
//    'needs-approval'. Without a clean level the family is 'blocked'.
// A blocked family keeps the exclude set of its newest level, so a person can approve it by
// name; the caller keeps it out of autoExcludes.
export async function decideFamily(members, check, packageCheck = null) {
  const key = (m) => m.id ?? m.name
  const levels = [Object.fromEntries(members.map((m) => [key(m), m.fresh[0]]))]
  const common = members[0].fresh.filter((v) =>
    members.every((m) => m.fresh.includes(v))
  )
  for (const v of common.sort((a, b) => cmpRaw(b, a))) {
    if (!levels.some((l) => members.every((m) => l[key(m)] === v))) {
      levels.push(Object.fromEntries(members.map((m) => [key(m), v])))
    }
  }
  // Step 1: every fresh version, newest first, plus the package-level checks.
  const tried = {}
  const packageFlags = {}
  const compromise = new Set()
  await Promise.all(
    members.map(async (m) => {
      const results = await Promise.all(m.fresh.map((v) => check(m, v)))
      tried[key(m)] = m.fresh.map((version, i) => ({
        version,
        ...results[i],
      }))
      for (const r of results) {
        for (const f of r.compromiseFlags ?? []) {
          compromise.add(f)
        }
      }
      packageFlags[key(m)] = packageCheck
        ? ((await packageCheck(m)).compromiseFlags ?? [])
        : []
      for (const f of packageFlags[key(m)]) {
        compromise.add(f)
      }
    })
  )
  const resultAt = (m, v) => tried[key(m)].find((t) => t.version === v)
  const unionExcludes = (level) =>
    [
      ...new Set(members.flatMap((m) => resultAt(m, level[key(m)]).excludeSet)),
    ].sort()
  const allFlags = () => [
    ...new Set([
      ...compromise,
      ...members.flatMap((m) => tried[key(m)].flatMap((t) => t.redFlags)),
    ]),
  ]
  const blocked = {
    decision: 'blocked',
    versions: levels[0],
    tried,
    skippedFlags: Object.fromEntries(members.map((m) => [key(m), []])),
    packageFlags,
    excludeSet: unionExcludes(levels[0]),
    unverifiedProvenance: [],
  }
  if (compromise.size) {
    return {
      ...blocked,
      redFlags: allFlags(),
      compromiseFlags: [...compromise],
    }
  }
  for (const level of levels) {
    const results = members.map((m) => resultAt(m, level[key(m)]))
    if (results.some((r) => r.redFlags.length)) {
      continue
    }
    const unverified = [
      ...new Set(results.flatMap((r) => r.unverifiedProvenance ?? [])),
    ].sort()
    // Per member: the flags of the newer fresh versions that this level skips.
    const skippedFlags = Object.fromEntries(
      members.map((m) => [
        key(m),
        [
          ...new Set(
            tried[key(m)]
              .filter((t) => cmpRaw(t.version, level[key(m)]) > 0)
              .flatMap((t) => t.redFlags)
          ),
        ],
      ])
    )
    return {
      decision: unverified.length ? 'needs-approval' : 'auto',
      versions: level,
      tried,
      skippedFlags,
      packageFlags,
      redFlags: [],
      compromiseFlags: [],
      excludeSet: unionExcludes(level),
      unverifiedProvenance: unverified,
    }
  }
  return { ...blocked, redFlags: allFlags(), compromiseFlags: [] }
}

// GitHub advisory database: the advisories in a `GET /advisories?affects=name@version`
// answer that really hit this exact version. Malware always counts, also when withdrawn:
// GitHub withdraws a malware advisory once npm removes the version, so a withdrawn one that
// still matches a published version is suspect (fail closed; the cost is a wait of <24h).
// A reviewed advisory counts when it is high or critical and not withdrawn. Returns the
// hits, or null when the answer cannot be trusted (not an array, or a full page that may
// hide more).
export function advisoryHits(list, name, version, pageSize = 100) {
  if (!Array.isArray(list) || list.length >= pageSize) {
    return null
  }
  const hits = []
  for (const a of list) {
    if (
      !a ||
      typeof a !== 'object' ||
      (a.withdrawn_at && a.type !== 'malware')
    ) {
      continue
    }
    const serious =
      a.type === 'malware' ||
      (a.type === 'reviewed' &&
        (a.severity === 'high' || a.severity === 'critical'))
    if (!serious) {
      continue
    }
    const vulns = (a.vulnerabilities ?? []).filter(
      (v) =>
        v?.package?.name === name &&
        (v.package.ecosystem ?? 'npm').toLowerCase() === 'npm'
    )
    // The API already filtered by `affects`; a range that we cannot parse still counts.
    const affected = vulns.some((v) => {
      const range = String(v.vulnerable_version_range ?? '').replace(/,/g, ' ')
      return !range.trim() || satisfies(version, range) !== false
    })
    if (affected) {
      hits.push({
        ghsa: a.ghsa_id,
        type: a.type,
        severity: a.severity,
        withdrawn: !!a.withdrawn_at,
      })
    }
  }
  return hits
}

// Source repository and workflow path from an npm attestation bundle
// (`/-/npm/v1/attestations/<name>@<version>`). Reads SLSA provenance v1
// (buildDefinition.externalParameters.workflow) and v0.2 (invocation.configSource). The
// statement subject must name this exact package version. Returns { repository, path } or
// { error }.
export function parseProvenance(bundle, name, version) {
  const purl = `pkg:npm/${name.replace(/^@/, '%40')}@${version}`
  for (const a of bundle?.attestations ?? []) {
    if (!/^https:\/\/slsa\.dev\/provenance\//.test(a?.predicateType ?? '')) {
      continue
    }
    let st
    try {
      st = JSON.parse(
        Buffer.from(a.bundle.dsseEnvelope.payload, 'base64').toString('utf8')
      )
    } catch {
      return { error: 'provenance statement does not decode' }
    }
    if (!(st?.subject ?? []).some((s) => s?.name === purl)) {
      return { error: `provenance subject is not ${purl}` }
    }
    const wf = st.predicate?.buildDefinition?.externalParameters?.workflow
    if (wf?.repository && wf?.path) {
      return { repository: normalizeRepo(wf.repository), path: wf.path }
    }
    const cs = st.predicate?.invocation?.configSource
    if (cs?.uri && cs?.entryPoint) {
      return { repository: normalizeRepo(cs.uri), path: cs.entryPoint }
    }
    return { error: 'provenance has no source repository or workflow path' }
  }
  return { error: 'no SLSA provenance statement in the bundle' }
}

// `git+https://github.com/Org/Repo.git@refs/heads/main` -> `https://github.com/org/repo`.
export function normalizeRepo(uri) {
  return String(uri)
    .trim()
    .replace(/^git\+/, '')
    .replace(/@refs\/.*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .toLowerCase()
}

// Compare the provenance of a fresh version with its reference. Each side is
// { has: boolean (dist.attestations present), info: { repository, path } | { error } | null }.
// Only the repository and the workflow path count; the ref (branch or tag) changes for
// legitimate reasons. Returns
//   flags:      every red flag,
//   compromise: the flags of the compromise class (provenance dropped, repository or
//               workflow changed),
//   verified:   true only when both sides have readable provenance with the same repository
//               and workflow. Without it, a clean version needs approval (never 'auto').
export function provenanceVerdict(label, ref, fresh) {
  const out = (flags, compromise = [], verified = false) => ({
    flags,
    compromise,
    verified,
  })
  if (!ref.has) {
    return out([])
  }
  if (!fresh.has) {
    const f = `${label}: provenance attestation dropped`
    return out([f], [f])
  }
  if (!ref.info || ref.info.error) {
    return out([
      `${label}: cannot check provenance of the reference (${ref.info?.error ?? 'not fetched'})`,
    ])
  }
  if (!fresh.info || fresh.info.error) {
    return out([
      `${label}: provenance unreadable, cannot check (${fresh.info?.error ?? 'not fetched'})`,
    ])
  }
  const flags = []
  if (fresh.info.repository !== ref.info.repository) {
    flags.push(
      `${label}: provenance source repository changed ${ref.info.repository} → ${fresh.info.repository}`
    )
  }
  if (fresh.info.path !== ref.info.path) {
    flags.push(
      `${label}: provenance workflow changed ${ref.info.path} → ${fresh.info.path}`
    )
  }
  return out(flags, flags, flags.length === 0)
}

// Malware advisories of a whole package (`/advisories?type=malware&affects=<name>`, no
// version) whose range covers any of `versions`. Returns [{ ghsa, version }] or null when
// the answer cannot be trusted (the caller blocks).
export function malwareCoveringAny(list, name, versions) {
  const out = []
  for (const v of versions) {
    const hits = advisoryHits(list, name, v)
    if (hits == null) {
      return null
    }
    for (const h of hits.filter((x) => x.type === 'malware')) {
      out.push({ ghsa: h.ghsa, version: v, withdrawn: h.withdrawn })
    }
  }
  return out
}

// --- fast-track network checks -------------------------------------------------

// Advisory hits for one exact version from the GitHub advisory database: malware, plus
// reviewed advisories that are high or critical. Verified by hand on 2026-11-10:
//   type=malware  affects=chalk@5.6.1            -> GHSA-2v46-p5h4-248w (malware, critical)
//   type=malware  affects=debug@4.4.2            -> GHSA-8mgj-vmr8-frr6 (withdrawn 2025-09-15)
//   type=reviewed affects=debug@4.4.2            -> GHSA-4x49-vf9v-38px (high)
//   type=malware  affects=@ctrl/tinycolor@4.1.1  -> GHSA-qjqf-7j6f-82c4 (scoped name works)
//   type=reviewed affects=event-stream@3.3.6     -> GHSA-mh6f-8j2x-4483 (critical)
//   type=malware / reviewed affects=viem@2.57.17, debug@4.4.1, @ctrl/tinycolor@4.1.0 -> []
// Returns { hits } or { error } (the check could not run: the caller fails closed).
export async function advisoriesFor(name, version, cwd) {
  if (!onNpmjs(name, cwd)) {
    return { error: OTHER_REGISTRY }
  }
  const affects = encodeURIComponent(`${name}@${version}`)
  const hits = []
  for (const type of ['malware', 'reviewed']) {
    const list = await ghApi(
      `/advisories?type=${type}&ecosystem=npm&affects=${affects}&per_page=100`,
      30000
    )
    const h = advisoryHits(list, name, version)
    if (h == null) {
      return {
        error: `GitHub ${type} advisory query failed or was incomplete`,
      }
    }
    hits.push(...h)
  }
  return { hits }
}

// Malware advisories of a whole package (no version in `affects`). Returns { list } or
// { error }. analyze-outdated blocks the package when one covers any fresh version.
export async function packageMalwareFor(name, cwd) {
  if (!onNpmjs(name, cwd)) {
    return { error: OTHER_REGISTRY }
  }
  const list = await ghApi(
    `/advisories?type=malware&ecosystem=npm&affects=${encodeURIComponent(name)}&per_page=100`,
    30000
  )
  return Array.isArray(list)
    ? { list }
    : { error: 'GitHub malware advisory query for the package failed' }
}

// Provenance source of one version from the npm attestation bundle. Returns
// { repository, path } or { error }. One retry on a network error or an HTTP 5xx.
export async function provenanceOf(name, version, cwd, timeoutMs = 20000) {
  if (!onNpmjs(name, cwd)) {
    return { error: OTHER_REGISTRY }
  }
  const url = `https://registry.npmjs.org/-/npm/v1/attestations/${name.replace('/', '%2f')}@${version}`
  let last = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (res.status >= 500) {
        last = `HTTP ${res.status}`
        continue
      }
      if (!res.ok) {
        // The caller asks only when `dist.attestations` exists: a 4xx is a failure too.
        last = `HTTP ${res.status}`
        break
      }
      return parseProvenance(await res.json(), name, version)
    } catch (err) {
      last = String(err.message)
    }
  }
  failures.push({ call: `GET ${url}`, error: last })
  return { error: last }
}

// --- the exact-entry checks (one implementation for analyze-outdated and bump.mjs) ---

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall']
const DEP_MAPS = ['dependencies', 'optionalDependencies', 'peerDependencies']

// The metadata of one version that the checks need (npmViewFields). `npm view` prints
// `_npmUser` as "name <email>" and masks `_npmUser.trustedPublisher.oidcConfigId`.
export const META_FIELDS = [
  '_npmUser',
  '_npmUser.trustedPublisher',
  'dist.integrity',
  'dist.attestations',
  'scripts',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]

// The metadata checks for one fresh version `f` against a trusted reference `b` (the
// version that lands otherwise, or the aged release below it). Returns { flags,
// compromise }: `compromise` holds the flags that block every fresh version of the
// package and its family (a publisher change, a trusted publisher that is gone or
// different, a new or changed install script). `deps: false` skips the new-dependency
// flags (the recheck of an entry that is already approved).
export function metadataFlags(label, f, b, { deps = true } = {}) {
  if (!f || !b) {
    return {
      flags: [`${label}: npm metadata unavailable, cannot check`],
      compromise: [],
    }
  }
  const flags = []
  const compromise = []
  const flagCompromise = (msg) => {
    flags.push(msg)
    compromise.push(msg)
  }
  const who = (x) => JSON.stringify(x?._npmUser ?? null)
  if (!f._npmUser || !b._npmUser) {
    flags.push(`${label}: publisher unknown, cannot compare`)
  } else if (who(f) !== who(b)) {
    flagCompromise(`${label}: publisher changed ${who(b)} → ${who(f)}`)
  }
  // A trust downgrade: the reference came from a trusted publisher (OIDC), the fresh one
  // does not, or from another kind. The config id: trustedPublisherFlags.
  const bt = b['_npmUser.trustedPublisher']
  const ft = f['_npmUser.trustedPublisher']
  if (bt && !ft) {
    flagCompromise(
      `${label}: trusted publisher gone (the reference has ${JSON.stringify(bt.id)})`
    )
  } else if (bt && ft.id !== bt.id) {
    flagCompromise(
      `${label}: trusted publisher changed ${JSON.stringify(bt.id)} → ${JSON.stringify(ft.id)}`
    )
  }
  for (const s of INSTALL_SCRIPTS) {
    if (f.scripts?.[s] && f.scripts?.[s] !== b.scripts?.[s]) {
      flagCompromise(`${label}: new or changed ${s} script`)
    }
  }
  if (deps) {
    for (const m of DEP_MAPS) {
      const added = addedKeys(f[m], b[m])
      if (added.length) {
        flags.push(`${label}: new ${m}: ${added.join(', ')}`)
      }
    }
  }
  return { flags, compromise }
}

// The trusted-publisher config of one entry against its reference. `fm`/`bm` are the
// npmViewFields metadata (the id is masked there), `fr`/`br` the raw registry documents
// (registryVersionDoc): the only source of the real `oidcConfigId`. Both documents must be
// the artifacts that the metadata described (same integrity). Pure.
export function trustedPublisherFlags(spec, fm, bm, fr, br) {
  const ft = fm?.['_npmUser.trustedPublisher']
  const bt = bm?.['_npmUser.trustedPublisher']
  if (!ft || !bt || ft.id !== bt.id) {
    return { flags: [], compromise: [] } // none, or flagged by metadataFlags
  }
  const same = (raw, meta) =>
    raw &&
    !raw.error &&
    raw.dist?.integrity != null &&
    raw.dist.integrity === meta['dist.integrity']
  if (!same(fr, fm) || !same(br, bm)) {
    return {
      flags: [
        `${spec}: trusted publisher config cannot compare (${fr?.error ?? br?.error ?? 'registry document differs from npm view'})`,
      ],
      compromise: [],
    }
  }
  const fid = fr._npmUser?.trustedPublisher?.oidcConfigId ?? null
  const bid = br._npmUser?.trustedPublisher?.oidcConfigId ?? null
  if (fid !== bid) {
    const msg = `${spec}: trusted publisher config changed (oidcConfigId ${bid} → ${fid})`
    return { flags: [msg], compromise: [msg] }
  }
  return { flags: [], compromise: [] }
}

// The reference of an exact entry: the newest aged release below it, else the newest
// aged release. Null when there is none.
export function referenceVersion(view, version, minAgeMs, nowMs) {
  const never = () => false
  return (
    pickAgedTarget(
      view,
      '0.0.0',
      minAgeMs,
      nowMs,
      never,
      (v) => cmpRaw(v, version) < 0
    ) ?? pickAgedTarget(view, '0.0.0', minAgeMs, nowMs, never)
  )
}

// The checks of one exact entry against its reference: advisories of the version, the
// provenance source, the trusted-publisher config and, with `metadata: true`, the metadata
// checks. `io` gives the (cached) calls: { advisories(name, version), provenance(name,
// version), meta(spec), rawDoc(name, version) }. Every check that cannot run is a flag.
// Returns { flags, compromise, verified } (verified: both sides have provenance with the
// same repository and workflow).
export async function checkExactEntry(
  spec,
  reference,
  io,
  { metadata = false, deps = true } = {}
) {
  const name = specName(spec)
  const version = spec.slice(name.length + 1)
  const flags = []
  const compromise = []
  const adv = await io.advisories(name, version)
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
  if (!reference) {
    flags.push(`${spec}: no aged version to compare with`)
    return { flags, compromise, verified: false }
  }
  const [fm, bm] = await Promise.all([
    io.meta(spec),
    io.meta(`${name}@${reference}`),
  ])
  if (metadata) {
    const m = metadataFlags(spec, fm, bm, { deps })
    flags.push(...m.flags)
    compromise.push(...m.compromise)
  }
  if (!fm || !bm) {
    // metadataFlags names it (here, or in the caller): metadata unavailable.
    return { flags, compromise, verified: false }
  }
  const refHas = !!bm['dist.attestations']
  const freshHas = !!fm['dist.attestations']
  const tpNeeded =
    fm['_npmUser.trustedPublisher'] &&
    bm['_npmUser.trustedPublisher'] &&
    fm['_npmUser.trustedPublisher'].id === bm['_npmUser.trustedPublisher'].id
  const [ri, fi, fr, br] = await Promise.all([
    refHas ? io.provenance(name, reference) : null,
    refHas && freshHas ? io.provenance(name, version) : null,
    tpNeeded ? io.rawDoc(name, version) : null,
    tpNeeded ? io.rawDoc(name, reference) : null,
  ])
  const pv = provenanceVerdict(
    spec,
    { has: refHas, info: ri },
    { has: freshHas, info: fi }
  )
  const tp = trustedPublisherFlags(spec, fm, bm, fr, br)
  return {
    flags: [...flags, ...pv.flags, ...tp.flags],
    compromise: [...compromise, ...pv.compromise, ...tp.compromise],
    verified: pv.verified,
  }
}

// --- what `--approve` may override (M2) ------------------------------------------

// A check that gave no answer. An approval never skips one: the run stops ("run again").
export const isBlindFlag = (flag) =>
  /cannot (run|check|compare)|\bunknown\b|unavailable|not checked|no aged version to compare/.test(
    flag
  )

// The flag kinds that a person may approve: a new dependency, a range that only a fresh
// version meets, an alias or non-registry spec. Everything else (an advisory hit, a
// compromise-class flag, an unknown kind) refuses the approval.
const APPROVABLE_RE =
  /: new (dependencies|optionalDependencies|peerDependencies): |uses the (alias|non-registry spec)|range of .+ changed .+ only a fresh version meets it|no published version meets it|only a prerelease meets it/

// Why `--approve` cannot apply these flags: { blind: [...], refused: [...] }. Both empty
// means the approval may go ahead (no provenance and too young are not flags).
export function approvalObstacles(flags = [], compromise = []) {
  const all = [...new Set([...compromise, ...flags])]
  const blind = all.filter(isBlindFlag)
  const refused = all.filter(
    (f) =>
      !isBlindFlag(f) &&
      (compromise.includes(f) || /advisory/.test(f) || !APPROVABLE_RE.test(f))
  )
  return { blind, refused }
}
