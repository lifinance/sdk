#!/usr/bin/env node
// analyze-outdated.mjs — plan generator for the bump-packages skill.
//
// Reads `pnpm outdated -r --format json`, then for each outdated external dep predicts the
// version pnpm will actually install under its 24h release-age floor (pnpm 11 enforces
// `minimumReleaseAge: 1440` by default), classifies that bump by semver risk, and maps
// which publishable packages need a Changesets entry. Emits a JSON plan on stdout and a
// human summary on stderr. The skill reads the plan to drive the bump; it never installs
// from this script.
//
// Key invariant: `target` is the newest version older than the floor — it can be LOWER
// than the registry `latest` (which is only a hint). Predicting it before any mutation is
// what lets the skill gate majors and report held-back deps accurately.
//
// Flags (both optional; the skill runs it with none): --root <dir>, --min-age-hours <N>.
// Every file read is confined to <root> (see `confine`). Always exits 0.

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'

const execFileP = promisify(execFile)

function getArgs() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      'min-age-hours': { type: 'string' },
    },
  })
  return {
    root: values.root ? resolve(values.root) : process.cwd(),
    minAgeHours: values['min-age-hours']
      ? Number(values['min-age-hours'])
      : null,
  }
}

// Resolve `segments` under `base`; return the path only if it stays inside `base`
// (rejects path-traversal escapes), else null.
function confine(base, ...segments) {
  const target = resolve(base, ...segments)
  const rel = relative(base, target)
  return rel.startsWith('..') || isAbsolute(rel) ? null : target
}

// Read+parse a JSON file confined to `base`. Every JSON read in this script goes through
// here, so nothing outside the repo root can be read.
function readJson(base, ...segments) {
  const p = confine(base, ...segments)
  if (!p) {
    return null
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function getOutdatedJson(root) {
  // `pnpm outdated` exits non-zero when deps are outdated, so capture stdout regardless.
  let out = ''
  try {
    out = execFileSync('pnpm', ['outdated', '-r', '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    out = err.stdout ? err.stdout.toString() : ''
  }
  const start = out.indexOf('{')
  return start === -1 ? {} : JSON.parse(out.slice(start))
}

// --- pnpm-workspace.yaml: age floor + exclude list -------------------------
// Mirror pnpm's `minimumReleaseAge` / `minimumReleaseAgeExclude` so the plan predicts
// exactly what pnpm will install — excluded packages (trusted first-party, or a knowingly
// fast-tracked release) bypass the floor and must not be reported as held back.

function readWorkspaceYaml(root) {
  const p = confine(root, 'pnpm-workspace.yaml')
  if (!p) {
    return ''
  }
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

function minAgeHoursFromYaml(yaml) {
  const m = yaml.match(/^\s*minimumReleaseAge\s*:\s*(\d+)/m)
  return m ? Number(m[1]) / 60 : null
}

// Pull the `minimumReleaseAgeExclude:` list entries (quoted or bare) out of the yaml.
function excludesFromYaml(yaml) {
  const block = yaml.match(
    /^minimumReleaseAgeExclude:\s*\n((?:[ \t]+-.*\n?)+)/m
  )
  if (!block) {
    return []
  }
  return [...block[1].matchAll(/^[ \t]+-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map(
    (x) => x[1].trim()
  )
}

// '*' is the only wildcard; everything else is literal.
function globToRegExp(glob) {
  const body = glob
    .split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`)
}

// Build matchers from exclude entries: a name/glob, an exact `name@version`, or a `||`
// disjunction of versions for one name (e.g. `webpack@4.47.0 || 5.102.1`).
function parseExcludes(entries) {
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
        name = lastName // bare version continuing the previous name
        version = piece
      } else {
        name = piece // a name or glob — all versions
        version = null
      }
      lastName = name
      matchers.push({ re: globToRegExp(name), version })
    }
  }
  return matchers
}

// Does `name@version` bypass the age floor per the exclude matchers?
function isExcluded(matchers, name, version) {
  return matchers.some(
    (m) => m.re.test(name) && (m.version == null || m.version === version)
  )
}

// Fetch publish timestamps for every candidate, concurrently. `npm view` (not a raw
// registry fetch) so it honors .npmrc registry/auth/proxy config. Returns Map<name, map|null>.
async function fetchTimes(names, root) {
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const { stdout } = await execFileP(
          'npm',
          ['view', name, 'time', '--json'],
          {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
          }
        )
        return [name, JSON.parse(stdout)]
      } catch {
        return [name, null]
      }
    })
  )
  return new Map(entries)
}

function parseVersion(v) {
  const core = String(v)
    .replace(/^[\^~>=<\s]+/, '')
    .split('+')[0]
  const [main, pre] = core.split('-')
  const [major = 0, minor = 0, patch = 0] = main
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  return { major, minor, patch, pre: pre || null }
}

// Compare parsed versions. Stable > its prerelease; prereleases compared lexically.
function cmp(a, b) {
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1
  }
  if (a.pre && !b.pre) {
    return -1
  }
  if (!a.pre && b.pre) {
    return 1
  }
  if (a.pre && b.pre) {
    return a.pre < b.pre ? -1 : a.pre > b.pre ? 1 : 0
  }
  return 0
}

// Newest version strictly above `current` that has aged past the floor — or is exempt via
// minimumReleaseAgeExclude. Skips prereleases unless `current` is itself a prerelease.
function pickAgedTarget(timeMap, currentRaw, minAgeMs, nowMs, isExempt) {
  if (!timeMap) {
    return null
  }
  const cur = parseVersion(currentRaw)
  let best = null
  let bestRaw = null
  for (const [ver, iso] of Object.entries(timeMap)) {
    if (ver === 'created' || ver === 'modified') {
      continue
    }
    const p = parseVersion(ver)
    if ((p.pre && !cur.pre) || cmp(p, cur) <= 0) {
      continue
    }
    // Eligible once it has aged past the floor, or if it's exempt from the floor entirely.
    const published = Date.parse(iso)
    const aged = Number.isFinite(published) && nowMs - published >= minAgeMs
    if (!(aged || isExempt(ver))) {
      continue
    }
    if (!best || cmp(p, best) > 0) {
      best = p
      bestRaw = ver
    }
  }
  return bestRaw
}

// `target` is always strictly above `current` (pickAgedTarget guarantees it), so a
// major/minor/patch ladder is exhaustive — no downgrade/equal cases reach here.
function classify(currentRaw, targetRaw) {
  const c = parseVersion(currentRaw)
  const t = parseVersion(targetRaw)
  if (t.major > c.major) {
    return { bumpType: 'major', reason: 'major', safe: false }
  }
  if (c.major === 0) {
    // 0.x: SemVer treats a minor as breaking, so route it to approval.
    return t.minor > c.minor
      ? { bumpType: 'minor', reason: 'zerox-minor', safe: false }
      : { bumpType: 'patch', reason: 'zerox-patch', safe: true }
  }
  return t.minor > c.minor
    ? { bumpType: 'minor', reason: 'minor', safe: true }
    : { bumpType: 'patch', reason: 'patch', safe: true }
}

// Map every workspace location (root + packages/*) to { name, private, json }.
function listWorkspacePackages(root) {
  const map = new Map()
  const rootPkg = readJson(root, 'package.json')
  if (rootPkg) {
    map.set(root, {
      name: rootPkg.name || '(root)',
      private: !!rootPkg.private,
      json: rootPkg,
    })
  }
  const pkgsDir = resolve(root, 'packages')
  if (existsSync(pkgsDir)) {
    for (const entry of readdirSync(pkgsDir)) {
      const dir = confine(pkgsDir, entry) // skip any entry that escapes packages/
      if (!dir) {
        continue
      }
      const pj = readJson(dir, 'package.json')
      if (pj) {
        map.set(dir, {
          name: pj.name,
          private: !!pj.private,
          json: pj,
        })
      }
    }
  }
  return map
}

// Which field lists `depName`, and its range — or null.
function depField(pkgJson, depName) {
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const range = pkgJson?.[field]?.[depName]
    if (range != null) {
      return { field, range }
    }
  }
  return null
}

async function main() {
  const args = getArgs()
  const outdated = getOutdatedJson(args.root)
  const workspaces = listWorkspacePackages(args.root)
  const wsYaml = readWorkspaceYaml(args.root)
  const excludeMatchers = parseExcludes(excludesFromYaml(wsYaml))

  const minAgeHours =
    Math.max(args.minAgeHours || 24, minAgeHoursFromYaml(wsYaml) || 0) || 24
  const minAgeMs = minAgeHours * 3600 * 1000
  const nowMs = Date.now()

  // Candidates: external deps with a newer registry version. Fetch all publish times at once.
  const candidates = Object.entries(outdated).filter(
    ([, info]) => info.current && info.latest && info.current !== info.latest
  )
  const times = await fetchTimes(
    candidates.map(([name]) => name),
    args.root
  )

  const safe = []
  const needsApproval = []
  const tooFresh = []
  const deprecated = []
  const changeset = {} // publishable package -> ["dep current→target", ...]

  for (const [name, info] of candidates) {
    const { current, latest: registryLatest } = info
    if (info.isDeprecated) {
      deprecated.push(name)
    }

    const target = pickAgedTarget(
      times.get(name),
      current,
      minAgeMs,
      nowMs,
      (ver) => isExcluded(excludeMatchers, name, ver)
    )
    if (!target) {
      // Updates exist but the newest is younger than the floor — report, don't bump.
      const latestIso = times.get(name)?.[registryLatest]
      const ageH = latestIso
        ? Math.round((nowMs - Date.parse(latestIso)) / 3600000)
        : null
      tooFresh.push({
        name,
        current,
        registryLatest,
        registryLatestAgeHours: ageH,
        hoursUntilEligible:
          ageH == null ? null : Math.max(0, minAgeHours - ageH),
        ageUnknown: !times.get(name),
      })
      continue
    }

    // A runtime-dep bump on a publishable package ships to users -> it needs a changeset.
    let runtime = false
    for (const dep of info.dependentPackages || []) {
      const ws = dep.location && workspaces.get(resolve(dep.location))
      const where = ws?.json ? depField(ws.json, name) : null
      if (!where || String(where.range).startsWith('workspace:')) {
        continue
      }
      if (
        where.field === 'dependencies' ||
        where.field === 'peerDependencies'
      ) {
        runtime = true
        if (!ws.private && ws.name) {
          if (!changeset[ws.name]) {
            changeset[ws.name] = []
          }
          changeset[ws.name].push(`${name} ${current}→${target}`)
        }
      }
    }

    const cls = classify(current, target)
    const entry = {
      name,
      current,
      target,
      registryLatest,
      heldBack: cmp(parseVersion(registryLatest), parseVersion(target)) > 0,
      bumpType: cls.bumpType,
      reason: cls.reason,
      runtime,
      isDeprecated: !!info.isDeprecated,
    }
    ;(cls.safe ? safe : needsApproval).push(entry)
  }

  const byName = (a, b) => a.name.localeCompare(b.name)
  safe.sort(byName)
  needsApproval.sort(byName)
  tooFresh.sort(byName)

  const plan = {
    minAgeHours,
    now: new Date(nowMs).toISOString(),
    summary: {
      total: safe.length + needsApproval.length,
      safe: safe.length,
      needsApproval: needsApproval.length,
      tooFresh: tooFresh.length,
      changesetPackages: Object.keys(changeset).length,
      deprecated: deprecated.length,
    },
    safe,
    needsApproval,
    tooFresh,
    changeset,
    deprecated,
  }

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  printSummary(plan)
}

function printSummary(plan) {
  const e = process.stderr
  const fmt = (x) =>
    `  ${x.name.padEnd(34)} ${x.current.padEnd(12)} → ${x.target.padEnd(12)} ` +
    `[${x.bumpType}${x.reason === 'zerox-minor' ? ' (0.x minor)' : ''}] ` +
    `${x.runtime ? 'runtime' : 'dev'}${x.heldBack ? `, held<${x.registryLatest}` : ''}` +
    `${x.isDeprecated ? ', DEPRECATED' : ''}`

  e.write(
    `\n=== bump-packages: outdated analysis (age floor: ${plan.minAgeHours}h) ===\n`
  )
  e.write(`\nSAFE to auto-apply (patch / >=1.x minor) — ${plan.safe.length}:\n`)
  e.write(
    plan.safe.length ? `${plan.safe.map(fmt).join('\n')}\n` : '  (none)\n'
  )

  e.write(
    `\nNEEDS APPROVAL (major, or 0.x minor) — ${plan.needsApproval.length}:\n`
  )
  e.write(
    plan.needsApproval.length
      ? `${plan.needsApproval.map(fmt).join('\n')}\n`
      : '  (none)\n'
  )

  if (plan.tooFresh.length) {
    e.write(
      `\nHELD BACK — newest release younger than ${plan.minAgeHours}h — ${plan.tooFresh.length}:\n`
    )
    for (const x of plan.tooFresh) {
      const age = x.ageUnknown
        ? 'age unknown'
        : `${x.registryLatestAgeHours}h old, eligible in ~${x.hoursUntilEligible}h`
      e.write(
        `  ${x.name.padEnd(34)} ${x.current} → ${x.registryLatest} (${age})\n`
      )
    }
  }

  const cs = Object.entries(plan.changeset)
  e.write(
    `\nCHANGESET needed (runtime bumps on publishable packages) — ${cs.length} package(s):\n`
  )
  e.write(
    cs.length
      ? `${cs.map(([p, rs]) => `  ${p}: ${rs.join(', ')}`).join('\n')}\n`
      : '  (none — dev-only bumps)\n'
  )

  if (plan.deprecated.length) {
    e.write(
      `\n⚠ DEPRECATED packages flagged by npm: ${plan.deprecated.join(', ')}\n`
    )
  }
  e.write('\n')
}

main()
