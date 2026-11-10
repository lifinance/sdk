// lib.js — shared helpers for the bump-packages scripts.
//
// The same file ships in the sdk, widget and jumper-widget repos. Keep the copies identical:
// a fix here must be copied to the other two repos.
//
// Everything here is read-only. File reads are confined to the repo root.

import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

export const execFileP = promisify(execFile)

// Every registry or API call that failed. A plan with failures is "degraded": an empty
// answer then means "unknown", not "nothing to do". Scripts copy this into their output.
export const failures = []

// pnpm >= 11 enforces a 24h release-age gate by default (minimumReleaseAge: 1440 minutes).
export const DEFAULT_MIN_AGE_MINUTES = 1440

// --- files ------------------------------------------------------------------

// Resolve `segments` under `base`; return the path only if it stays inside `base`.
export function confine(base, ...segments) {
  const target = resolve(base, ...segments)
  const rel = relative(base, target)
  return rel.startsWith('..') || isAbsolute(rel) ? null : target
}

export function readText(base, ...segments) {
  const p = confine(base, ...segments)
  if (!p) {
    return null
  }
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

export function readJson(base, ...segments) {
  const text = readText(base, ...segments)
  if (text == null) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// --- semver -----------------------------------------------------------------

export function parseVersion(v) {
  const core = String(v)
    .trim()
    .replace(/^[v^~>=<\s]+/, '')
    .split('+')[0]
  const dash = core.indexOf('-')
  const main = dash === -1 ? core : core.slice(0, dash)
  const pre = dash === -1 ? null : core.slice(dash + 1)
  const [major = 0, minor = 0, patch = 0] = main
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  return { major, minor, patch, pre: pre || null }
}

export function isVersionLike(v) {
  return /^v?\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/.test(String(v).trim())
}

// Stable > its prerelease; prereleases compare lexically.
export function cmp(a, b) {
  for (const k of ['major', 'minor', 'patch']) {
    if (a[k] !== b[k]) {
      return a[k] < b[k] ? -1 : 1
    }
  }
  if (a.pre && !b.pre) {
    return -1
  }
  if (!a.pre && b.pre) {
    return 1
  }
  if (a.pre && b.pre) {
    // SemVer: compare dot-separated identifiers; numeric ones as numbers (beta.10 > beta.9).
    const x = a.pre.split('.')
    const y = b.pre.split('.')
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) {
        return -1
      }
      if (y[i] === undefined) {
        return 1
      }
      const nx = /^\d+$/.test(x[i])
      const ny = /^\d+$/.test(y[i])
      if (nx && ny && Number(x[i]) !== Number(y[i])) {
        return Number(x[i]) < Number(y[i]) ? -1 : 1
      }
      if (nx !== ny) {
        return nx ? -1 : 1
      }
      if (!nx && x[i] !== y[i]) {
        return x[i] < y[i] ? -1 : 1
      }
    }
    return 0
  }
  return 0
}

export const cmpRaw = (a, b) => cmp(parseVersion(a), parseVersion(b))

// SemVer risk of current -> target. Under SemVer a 0.x minor is breaking.
export function classify(currentRaw, targetRaw) {
  const c = parseVersion(currentRaw)
  const t = parseVersion(targetRaw)
  if (c.pre) {
    // From a prerelease (2.0.0-beta.3 -> 2.0.0 or later): the API can change before GA.
    return { bumpType: 'prerelease', reason: 'from-prerelease', safe: false }
  }
  if (t.major > c.major) {
    return { bumpType: 'major', reason: 'major', safe: false }
  }
  if (c.major === 0 && t.minor > c.minor) {
    return { bumpType: 'minor', reason: 'zerox-minor', safe: false }
  }
  if (c.major === 0 && c.minor === 0 && t.patch > c.patch) {
    // Under caret rules every 0.0.x release is breaking.
    return { bumpType: 'patch', reason: 'zero-zero-patch', safe: false }
  }
  if (t.minor > c.minor) {
    return { bumpType: 'minor', reason: 'minor', safe: true }
  }
  return { bumpType: 'patch', reason: 'patch', safe: true }
}

// --- pnpm-workspace.yaml (small, line-based reader; enough for these files) --

export function readWorkspaceYaml(root) {
  return readText(root, 'pnpm-workspace.yaml') ?? ''
}

export function unquote(s) {
  const t = String(s).trim()
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    return t.slice(1, -1)
  }
  return t
}

// Lines of the top-level block `key:` (indented lines, blanks and comments that follow it).
function blockLines(yaml, key) {
  const lines = yaml.split('\n')
  // `key:` alone or with a comment (`key: # note`). A flow value (`key: [a]`) is not read.
  const start = lines.findIndex((l) =>
    new RegExp(`^${key}:\\s*(#.*)?$`).test(l)
  )
  if (start === -1) {
    return []
  }
  const out = []
  for (const line of lines.slice(start + 1)) {
    // Indented lines, and `- item` at column 0 (a valid YAML sequence under a key).
    if (line.trim() === '' || /^\s/.test(line) || /^- /.test(line)) {
      out.push(line.replace(/^- /, '  - '))
      continue
    }
    if (line.startsWith('#')) {
      out.push(line)
      continue
    }
    break
  }
  return out
}

// Items of a top-level list, e.g. `packages:` or `minimumReleaseAgeExclude:`.
export function yamlList(yaml, key) {
  return blockLines(yaml, key)
    .map((l) => l.match(/^\s+-\s*(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => unquote(m[1].replace(/\s+#.*$/, '')))
}

// Entries of a top-level map, e.g. `overrides:`. Each entry keeps the comment lines
// directly above it (a blank line ends a comment group).
export function yamlMap(yaml, key) {
  const out = []
  let comment = []
  for (const line of blockLines(yaml, key)) {
    const trimmed = line.trim()
    if (trimmed === '') {
      comment = []
      continue
    }
    if (trimmed.startsWith('#')) {
      comment.push(trimmed.replace(/^#\s?/, ''))
      continue
    }
    const m = line.match(
      /^\s+("[^"]+"|'[^']+'|[^:#][^:]*?):\s*("[^"]*"|'[^']*'|[^#]*?)\s*(#.*)?$/
    )
    if (m) {
      out.push({
        key: unquote(m[1]),
        value: unquote(m[2]),
        reason: comment.join(' ').trim() || null,
      })
    }
    comment = []
  }
  return out
}

export function minAgeMinutesFromYaml(yaml) {
  const m = yaml.match(/^minimumReleaseAge\s*:\s*(\d+)/m)
  return m ? Number(m[1]) : DEFAULT_MIN_AGE_MINUTES
}

// --- minimumReleaseAgeExclude matchers -------------------------------------

export const escapeRegExp = (s) =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)

export function globToRegExp(glob) {
  return new RegExp(`^${glob.split('*').map(escapeRegExp).join('.*')}$`)
}

// The one release-age rule: published at least `minAgeMs` ago, or exempt (excluded).
export function agedOrExempt(iso, ver, minAgeMs, nowMs, isExempt) {
  const t = Date.parse(iso)
  return (Number.isFinite(t) && nowMs - t >= minAgeMs) || isExempt(ver)
}

// An entry is a name/glob (all versions), `name@version`, or `name@v1 || v2`.
export function parseExcludes(entries) {
  const matchers = []
  for (const raw of entries) {
    let lastName = null
    for (const piece of String(raw)
      .split('||')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const at = piece.lastIndexOf('@')
      let name
      let version
      if (at > 0) {
        name = piece.slice(0, at)
        version = piece.slice(at + 1)
      } else if (lastName && /^[0-9]/.test(piece)) {
        name = lastName
        version = piece
      } else {
        name = piece
        version = null
      }
      lastName = name
      matchers.push({ raw, name, re: globToRegExp(name), version })
    }
  }
  return matchers
}

export function isExcluded(matchers, name, version) {
  return matchers.some(
    (m) => m.re.test(name) && (m.version == null || m.version === version)
  )
}

// --- workspace projects -----------------------------------------------------

function findPackageDirs(dir, recursive, out) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) {
      continue
    }
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (!st.isDirectory()) {
      continue
    }
    if (existsSync(join(p, 'package.json'))) {
      out.add(p)
    }
    if (recursive) {
      findPackageDirs(p, true, out)
    }
  }
}

// Map of absolute dir -> { name, private, json, rel } for the root and every project that the
// `packages:` globs of pnpm-workspace.yaml match. Supports `dir`, `dir/*`, `dir/**`, `!dir`.
export function listWorkspaceProjects(root, yaml) {
  const dirs = new Set([root])
  const negated = []
  for (const glob of yamlList(yaml, 'packages')) {
    if (glob.startsWith('!')) {
      negated.push(globToRegExp(glob.slice(1).replace(/\/\*\*$/, '/*')))
      continue
    }
    const clean = glob.replace(/\/$/, '')
    if (clean.endsWith('/**')) {
      const base = confine(root, clean.slice(0, -3))
      if (base) {
        findPackageDirs(base, true, dirs)
      }
    } else if (clean.endsWith('/*')) {
      const base = confine(root, clean.slice(0, -2))
      if (base) {
        findPackageDirs(base, false, dirs)
      }
    } else {
      const p = confine(root, clean)
      if (p && existsSync(join(p, 'package.json'))) {
        dirs.add(p)
      }
    }
  }
  const map = new Map()
  for (const dir of dirs) {
    const rel = relative(root, dir) || '.'
    if (negated.some((re) => re.test(rel))) {
      continue
    }
    const json = readJson(dir, 'package.json')
    if (json) {
      map.set(dir, {
        name: json.name || rel,
        private: !!json.private,
        json,
        rel,
      })
    }
  }
  return map
}

export const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

// --- registries ---------------------------------------------------------------

// Run `fn` over `items` with at most `limit` in flight.
export async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  )
  return out
}

// `npm view <name> time dist-tags --json`. Uses npm (not a raw fetch) so .npmrc
// registry, scope and auth settings apply. Returns { time, distTags } or null.
export async function npmView(name, cwd) {
  try {
    const { stdout } = await execFileP(
      'npm',
      ['view', '--json', '--', name, 'time', 'dist-tags'],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
    const j = JSON.parse(stdout)
    return { time: j.time ?? {}, distTags: j['dist-tags'] ?? {} }
  } catch (err) {
    failures.push({
      call: `npm view ${name}`,
      error: String(err.message).split('\n')[0],
    })
    return null
  }
}

// `npm view --json -- <spec> <fields…>` -> parsed JSON (an object when several fields are
// asked for), or null on failure (recorded in `failures`).
export async function npmViewFields(spec, fields, cwd) {
  try {
    // With several fields npm prints an object, but if only ONE of them exists it prints
    // that value bare. `name` and `version` always exist, so asking for them too keeps
    // the object form.
    const all = fields.length > 1 ? ['name', 'version', ...fields] : fields
    const { stdout } = await execFileP(
      'npm',
      ['view', '--json', '--', spec, ...all],
      { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
    const j = stdout.trim() ? JSON.parse(stdout) : {}
    if (fields.length > 1) {
      // Only a plain object for exactly the requested version counts as an answer.
      const at = spec.lastIndexOf('@')
      const want = at > 0 ? spec.slice(at + 1) : null
      if (
        !j ||
        typeof j !== 'object' ||
        Array.isArray(j) ||
        (want && /^\d/.test(want) && j.version !== want)
      ) {
        throw new Error(`unexpected npm view output for ${spec}`)
      }
    }
    return j
  } catch (err) {
    failures.push({
      call: `npm view ${spec}`,
      error: String(err.message).split('\n')[0],
    })
    return null
  }
}

// Newest version above `current` and at or below the `latest` dist-tag that has aged past
// the gate (or is exempt from it). Skips prereleases unless `current` is one. This is the
// version that `pnpm up --latest` lands on under the release-age gate.
// `accept` (optional) limits the result, e.g. `(v) => satisfies(v, '^26.5.2') === true`.
export function pickAgedTarget(
  view,
  currentRaw,
  minAgeMs,
  nowMs,
  isExempt,
  accept = null
) {
  if (!view) {
    return null
  }
  const cur = parseVersion(currentRaw)
  const cap = view.distTags.latest ? parseVersion(view.distTags.latest) : null
  let best = null
  let bestRaw = null
  for (const [ver, iso] of Object.entries(view.time)) {
    if (ver === 'created' || ver === 'modified') {
      continue
    }
    const p = parseVersion(ver)
    if ((p.pre && !cur.pre) || cmp(p, cur) <= 0) {
      continue
    }
    if (cap && cmp(p, cap) > 0) {
      continue
    }
    if (accept && !accept(ver)) {
      continue
    }
    if (!agedOrExempt(iso, ver, minAgeMs, nowMs, isExempt)) {
      continue
    }
    if (!best || cmp(p, best) > 0) {
      best = p
      bestRaw = ver
    }
  }
  return bestRaw
}

export function ageHours(iso, nowMs) {
  const t = Date.parse(iso)
  // Floor to 0.1h. Rounding up would let a 23.6h-old version count as aged (24h).
  return Number.isFinite(t) ? Math.floor((nowMs - t) / 360000) / 10 : null
}

// `gh api <path>` -> parsed JSON, or null on any error. A stalled call is killed after
// `timeoutMs` and counts as a failure, not as an answer.
export async function ghApi(path, timeoutMs = 60000) {
  try {
    const { stdout } = await execFileP('gh', ['api', path], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
    })
    return JSON.parse(stdout)
  } catch (err) {
    failures.push({
      call: `gh api ${path}`,
      error: String(err.message).split('\n')[0],
    })
    return null
  }
}

// name -> Set(version), from the `packages:` section of a v9 lockfile. With
// `section: 'snapshots'` the values keep the peer suffix, e.g. `2.19.5(viem@2.57.7)`:
// two peer variants of one version are two runtime instances.
export function parseLock(text, section = 'packages') {
  const map = new Map()
  if (!text) {
    return map
  }
  // pnpm 12 can write two YAML documents: the first holds only pnpm itself
  // (packageManagerDependencies), the last one holds the project. Read the last one.
  const docs = text.split(/^---\s*$/m).filter((d) => d.trim())
  const doc = docs[docs.length - 1] ?? ''
  let inPackages = false
  for (const line of doc.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith(`${section}:`)
      continue
    }
    if (!inPackages) {
      continue
    }
    // `  name@1.0.0:` (a block follows) or `  name@1.0.0: {}` (no dependencies). Quoted
    // keys (scopes, tarball URLs) may contain ':'.
    const m = line.match(/^ {2}('[^']+'|"[^"]+"|[^\s'"][^:]*):(?:\s*\{\})?\s*$/)
    if (!m) {
      continue
    }
    const full = unquote(m[1])
    const paren = full.indexOf('(')
    const key = paren === -1 ? full : full.slice(0, paren)
    const peers = paren === -1 ? '' : full.slice(paren)
    const at = key.lastIndexOf('@')
    if (at <= 0) {
      continue
    }
    const name = key.slice(0, at)
    const version = key.slice(at + 1) + (section === 'snapshots' ? peers : '')
    if (!map.has(name)) {
      map.set(name, new Set())
    }
    map.get(name).add(version)
  }
  return map
}

// --- semver ranges (node-semver rules, stable versions only) ----------------
// satisfies('26.7.2', '^26.5.2') -> true. Supports ^, ~, >=, >, <=, <, =, x-ranges,
// partial versions, hyphen ranges, space-separated comparator sets and `||`.
// Returns null when the range is not a semver range (npm:, workspace:, $ref, '-', …).

function parsePartial(s) {
  const m = String(s)
    .trim()
    .match(
      /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
    )
  if (!m) {
    return null
  }
  const num = (x) => (x == null || /^[xX*]$/.test(x) ? null : Number(x))
  return { major: num(m[1]), minor: num(m[2]), patch: num(m[3]) }
}

const V = (major, minor, patch) => ({ major, minor, patch, pre: null })

// Desugar one comparator into [op, version] pairs; null if it does not parse.
function desugar(op, raw) {
  if (/^[xX*]?$/.test(raw)) {
    return []
  }
  const p = parsePartial(raw)
  if (!p || p.major == null) {
    return p ? [] : null
  }
  const { major: M, minor: m, patch: pt } = p
  const lo = V(M, m ?? 0, pt ?? 0)
  const nextBound = () =>
    m == null ? V(M + 1, 0, 0) : pt == null ? V(M, m + 1, 0) : null
  switch (op) {
    case '^': {
      let hi
      if (M > 0 || m == null) {
        hi = V(M + 1, 0, 0)
      } else if (m > 0 || pt == null) {
        hi = V(0, m + 1, 0)
      } else {
        hi = V(0, 0, pt + 1)
      }
      return [
        ['>=', lo],
        ['<', hi],
      ]
    }
    case '~':
      return [
        ['>=', lo],
        ['<', m == null ? V(M + 1, 0, 0) : V(M, m + 1, 0)],
      ]
    case '>=':
      return [['>=', lo]]
    case '<':
      return [['<', lo]]
    case '>': {
      const nb = nextBound()
      return nb ? [['>=', nb]] : [['>', lo]]
    }
    case '<=': {
      const nb = nextBound()
      return nb ? [['<', nb]] : [['<=', lo]]
    }
    default: {
      const nb = nextBound()
      return nb
        ? [
            ['>=', lo],
            ['<', nb],
          ]
        : [['=', lo]]
    }
  }
}

function compileAlternative(alt) {
  const a = alt.trim()
  const hy = a.match(/^(\S+)\s+-\s+(\S+)$/)
  if (hy) {
    const lo = desugar('>=', hy[1])
    const hi = desugar('<=', hy[2])
    return lo && hi ? [...lo, ...hi] : null
  }
  const tokens = a
    .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
    .split(/\s+/)
    .filter(Boolean)
  const out = []
  for (const tok of tokens.length ? tokens : ['*']) {
    const m = tok.match(/^(>=|<=|>|<|=|\^|~)?(.*)$/)
    const parts = desugar(m[1] ?? '', m[2])
    if (!parts) {
      return null
    }
    out.push(...parts)
  }
  return out
}

export function satisfies(version, range) {
  const r = String(range ?? '').trim()
  if (/^(npm:|workspace:|catalog:|link:|file:|git|https?:|\$|-$)/.test(r)) {
    return null
  }
  const alts = r === '' ? [[]] : r.split('||').map(compileAlternative)
  if (alts.some((x) => x == null)) {
    return null
  }
  const v = parseVersion(version)
  // node-semver: a prerelease satisfies a range only if the range names a prerelease of
  // the same major.minor.patch. Otherwise 1.0.0-rc.1 is NOT in ^1.0.0.
  if (v.pre) {
    const core = `${v.major}.${v.minor}.${v.patch}-`
    if (!r.includes(core)) {
      return false
    }
  }
  const test = ([op, b]) => {
    const c = cmp(V(v.major, v.minor, v.patch), b)
    return op === '>='
      ? c >= 0
      : op === '>'
        ? c > 0
        : op === '<'
          ? c < 0
          : op === '<='
            ? c <= 0
            : c === 0
  }
  return alts.some((set) => set.every(test))
}

// Split an override selector into the package it targets and its kind.
//   `name`            -> whole package       (an exact value is a hold)
//   `name@<range>`    -> old copies only     (lifts them; not a hold)
//   `parent>child`    -> one dependency path (reported, never a hold)
export function parseSelector(sel) {
  // A range comparator `>` is followed by `=`, a space, a digit or `v<digit>`. Any other
  // `>` separates a path (`parent>child`, `foo@1>bar`, `foo>vue`).
  const seps = [...sel.matchAll(/>(?![=\s\d]|v\d)/g)]
  if (seps.length) {
    // The child starts after the LAST path separator; a range on it may contain `>`
    // (`vite>esbuild@>=0.18`).
    const child = sel.slice(seps[seps.length - 1].index + 1)
    return { name: child.replace(/(.)@.*$/, '$1'), kind: 'path' }
  }
  const at = sel.lastIndexOf('@')
  if (at > 0) {
    return { name: sel.slice(0, at), kind: 'range' }
  }
  return { name: sel, kind: 'whole' }
}

// `pnpm outdated` keys are not always plain names. With more than one resolved version or
// dependency type it uses `next@16.4.2` or `vite-plugin-node-polyfills@0.26.0 (dev)`.
// Group by the real name and the installed version (`name@current`).
export function groupOutdated(raw) {
  const groups = new Map()
  for (const [key, info] of Object.entries(raw)) {
    const name = key.replace(/\s+\(.*\)$/, '').replace(/(.)@\d[^@]*$/, '$1')
    const id = `${name}@${info.current}`
    const g = groups.get(id)
    if (g) {
      g.dependentPackages.push(...(info.dependentPackages ?? []))
      g.isDeprecated ||= !!info.isDeprecated
    } else {
      groups.set(id, {
        ...info,
        dependentPackages: [...(info.dependentPackages ?? [])],
      })
    }
  }
  return groups
}

// child "name@version" -> Set of parent "name@version", from the `snapshots:` section
// (`  parent@1.0.0(peers):` then `    dependencies:` then `      child: 2.0.0(peers)`).
// Used to name the cause of a transitive major jump.
export function parseParents(text) {
  const parents = new Map()
  if (!text) {
    return parents
  }
  const docs = text.split(/^---\s*$/m).filter((d) => d.trim())
  const doc = docs[docs.length - 1] ?? ''
  let inSnapshots = false
  let parent = null
  let inDeps = false
  const strip = (s) => unquote(s).replace(/\(.*$/, '')
  for (const line of doc.split('\n')) {
    if (/^\S/.test(line)) {
      inSnapshots = line.startsWith('snapshots:')
      parent = null
      continue
    }
    if (!inSnapshots) {
      continue
    }
    const top = line.match(/^ {2}('[^']+'|"[^"]+"|[^\s'"][^:]*):/)
    if (top) {
      parent = strip(top[1])
      inDeps = false
      continue
    }
    const sec = line.match(/^ {4}(\w+):\s*$/)
    if (sec) {
      inDeps = /dependencies$/i.test(sec[1])
      continue
    }
    const dep =
      inDeps &&
      parent &&
      line.match(/^ {6}('[^']+'|"[^"]+"|[^\s:'"]+):\s*(\S+)/)
    if (dep) {
      const child = `${unquote(dep[1])}@${strip(dep[2])}`
      if (!parents.has(child)) {
        parents.set(child, new Set())
      }
      parents.get(child).add(parent)
    }
  }
  return parents
}

// The "breaking line" of each version under caret rules: the major, or 0.minor, or
// 0.0.patch. A line that the base did not have is a breaking move.
export function breakingLines(versions) {
  return new Set(
    [...versions].map((v) => {
      const p = parseVersion(v)
      return p.major > 0
        ? `${p.major}`
        : p.minor > 0
          ? `0.${p.minor}`
          : `0.0.${p.patch}`
    })
  )
}

// Does a lockfile jump stop the run? A new 1.x+ major always does, unless expected. A new
// 0.x line does only when the repo's own open override moved it (a transitive 0.x line
// moves only with its parent, which the parent's author chose).
export function isStopJump(jump, openOverrideNames, expected) {
  if (expected.has(jump.name)) {
    return false
  }
  return jump.realMajor || openOverrideNames.has(jump.name)
}

// Markdown table helper.
export function mdTable(headers, rows) {
  const esc = (c) => String(c ?? '').replace(/\|/g, '\\|')
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n')
}

// --- fast-track helpers (pure, unit-tested) -----------------------------------

// Every stable version above `aboveRaw` and at or below the `latest` dist-tag that has NOT
// passed the gate, oldest first, with its age and the hours until the gate lets it through
// (rounded up to 0.1h, so it is never early).
export function freshVersionsOf(
  view,
  aboveRaw,
  minAgeMs,
  nowMs,
  isExempt = () => false
) {
  if (!view) {
    return []
  }
  const cap = view.distTags?.latest ?? null
  const out = []
  for (const [ver, iso] of Object.entries(view.time ?? {})) {
    if (ver === 'created' || ver === 'modified' || parseVersion(ver).pre) {
      continue
    }
    if (cmpRaw(ver, aboveRaw) <= 0 || (cap && cmpRaw(ver, cap) > 0)) {
      continue
    }
    if (agedOrExempt(iso, ver, minAgeMs, nowMs, isExempt)) {
      continue
    }
    const t = Date.parse(iso)
    out.push({
      version: ver,
      ageHours: ageHours(iso, nowMs),
      // From the exact publish time (integer ms), so float noise cannot round it up.
      eligibleInHours: Number.isFinite(t)
        ? Math.max(0, Math.ceil((minAgeMs - (nowMs - t)) / 360000) / 10)
        : null,
    })
  }
  return out.sort((a, b) => cmpRaw(a.version, b.version))
}

// Status of a tool pinned at `current` (pnpm, a CI tool): the aged target, or 'too-fresh'
// when every newer release is younger than the gate. Never 'up-to-date' while a newer
// release exists. `newest` and `newestAgeHours` name the newest release above `current`.
export function toolStatus(view, current, minAgeMs, nowMs) {
  const target = view
    ? pickAgedTarget(view, current, minAgeMs, nowMs, () => false)
    : null
  const fresh = freshVersionsOf(view, target ?? current, minAgeMs, nowMs)
  const newest = fresh.length ? fresh[fresh.length - 1] : null
  const out = {
    target,
    newest: newest?.version ?? target ?? null,
    newestAgeHours:
      newest?.ageHours ??
      (target && view?.time?.[target]
        ? ageHours(view.time[target], nowMs)
        : null),
    status: 'up-to-date',
    bumpType: null,
  }
  if (target) {
    const cls = classify(current, target)
    out.bumpType = cls.bumpType
    out.status = cls.safe ? 'safe' : 'needs-approval'
  } else if (newest) {
    out.status = 'too-fresh'
  }
  return out
}

// An exclude entry that the scripts may write: one exact stable version of one package.
// Never a bare name, a glob, a range, a dist-tag, a prerelease or an `a || b` list.
export const EXACT_EXCLUDE_RE =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/

export function invalidExcludeEntries(entries) {
  return entries.filter(
    (e) => typeof e !== 'string' || !EXACT_EXCLUDE_RE.test(e)
  )
}

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

export const specName = (spec) => spec.slice(0, spec.lastIndexOf('@'))

// Keys of `next` that `prev` does not have as its OWN key. `in` would treat `constructor`
// or `toString` as present (they are on Object.prototype).
export const addedKeys = (next, prev) =>
  Object.keys(next ?? {}).filter((k) => !Object.hasOwn(prev ?? {}, k))

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

export const provenanceFlags = (label, ref, fresh) =>
  provenanceVerdict(label, ref, fresh).flags

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

// Proposed update for one override, or null. `o` is { key, value, name, kind, reason }.
//   - A comment that names a hold (hold, held, regressed, "do not lift", …) keeps every
//     kind of override as it is.
//   (a) lift `name@<=X: X` (or `<X`): the newest aged Y in the same major -> `name@<=Y: Y`.
//   (b) caret whole or path override `^F`: the newest aged Y in the same major -> `^Y`.
//       Tilde `~F`: the newest aged Y in the same major AND minor -> `~Y`.
//   (c) an exact pin: a whole-package pin with any comment is a hold (no update). Without a
//       comment, or on a path, a newer aged version in the same major is `check by hand`.
// Never crosses a major (a 0.x minor or a 0.0.x patch counts as a major).
const HOLD_RE =
  /\b(hold|holds|held|regress(?:ed|ion|es)?|do not (?:bump|move|update|lift)|don't (?:bump|move|update|lift)|keep (?:it )?at)\b/i

export function overrideUpdate(o, view, minAgeMs, nowMs, isExempt) {
  if (HOLD_RE.test(o.reason ?? '')) {
    return null
  }
  const sameMajor = (from) => (v) => classify(from, v).safe
  const sameMinor = (from) => (v) => {
    const a = parseVersion(from)
    const b = parseVersion(v)
    return a.major === b.major && a.minor === b.minor
  }
  const newer = (from, accept = sameMajor(from)) =>
    pickAgedTarget(view, from, minAgeMs, nowMs, isExempt, accept)
  const base = { key: o.key, value: o.value, comment: o.reason ?? null }
  if (o.kind === 'range') {
    const m = /^(.+)@(<=?)\s*v?(\d+\.\d+\.\d+)$/.exec(o.key)
    if (m && m[3] === o.value) {
      const y = newer(o.value)
      return y
        ? {
            ...base,
            newKey: `${m[1]}@${m[2]}${y}`,
            newValue: y,
            reason: `lift: ${y} is the newest aged release in the same major`,
          }
        : null
    }
  }
  if (o.kind === 'whole' || o.kind === 'path') {
    const caret = /^([\^~])(\d+\.\d+\.\d+)$/.exec(o.value)
    if (caret) {
      const tilde = caret[1] === '~'
      const y = newer(caret[2], tilde ? sameMinor(caret[2]) : undefined)
      return y
        ? {
            ...base,
            newKey: o.key,
            newValue: `${caret[1]}${y}`,
            reason: `floor: ${y} is the newest aged release in the same ${tilde ? 'minor' : 'major'}`,
          }
        : null
    }
  }
  if (/^\d+\.\d+\.\d+$/.test(o.value)) {
    if (o.kind === 'whole' && o.reason) {
      return null // a commented exact pin is a hold
    }
    const y = newer(o.value)
    return y
      ? {
          ...base,
          newKey: o.key,
          newValue: y,
          reason: 'check by hand',
        }
      : null
  }
  return null
}

// lockfile-report: the two bases. `git(args)` returns stdout or throws.
//   compareBase: --base, or the merge-base of HEAD and origin/main. Any ancestor of HEAD.
//   trustAnchor: always the merge-base of HEAD and origin/main. Only its exclude list is
//                trusted, so --base cannot widen the trusted list.
// Throws an Error with a message for the user when either base is not usable.
export function resolveLockfileBases(baseOpt, git) {
  let trustAnchor
  try {
    trustAnchor = git(['merge-base', 'HEAD', 'origin/main']).trim()
  } catch {
    throw new Error(
      'Cannot find the merge-base of HEAD and origin/main (the trust anchor). Run git fetch origin, then run again.'
    )
  }
  if (!trustAnchor) {
    throw new Error('The merge-base of HEAD and origin/main is empty.')
  }
  const compareBase = baseOpt || trustAnchor
  try {
    git(['merge-base', '--is-ancestor', compareBase, 'HEAD'])
  } catch {
    throw new Error(
      `--base ${compareBase} is not an ancestor of HEAD. Use a commit of this branch's history, or omit --base.`
    )
  }
  return { compareBase, trustAnchor }
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
export async function advisoriesFor(name, version) {
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
export async function packageMalwareFor(name) {
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
export async function provenanceOf(name, version, timeoutMs = 20000) {
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
        return { error: `HTTP ${res.status}` }
      }
      return parseProvenance(await res.json(), name, version)
    } catch (err) {
      last = String(err.message)
    }
  }
  failures.push({ call: `GET ${url}`, error: last })
  return { error: last }
}
