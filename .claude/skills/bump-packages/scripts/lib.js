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

// `gh api <path>` -> parsed JSON, or null on any error.
export async function ghApi(path) {
  try {
    const { stdout } = await execFileP('gh', ['api', path], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
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
