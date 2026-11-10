#!/usr/bin/env node
// analyze-toolchain.mjs — GitHub Actions, pnpm and Node plan for the bump-packages skill.
//
// Analyze (default): scans every workflow and composite action under .github/ for
// `uses: owner/repo[/path]@<sha> # vX.Y.Z` pins. For each action it finds the newest
// GitHub release that has aged past the release-age gate, resolves its tag to a commit SHA,
// checks that the current SHA matches its version comment, and classifies the bump. It also
// reports the pinned pnpm (packageManager) and the Node versions in CI against the latest.
// Output: JSON plan on stdout, Markdown summary on stderr. Read-only.
//
// Apply: --apply <plan.json> --actions owner/repo,owner/repo
//   Rewrites the SHA pin and the version comment together for the named actions only.
//
// Needs an authenticated `gh` CLI. Usage:
//   node analyze-toolchain.mjs [--root <repo>] [--min-age-hours <N>]
//   node analyze-toolchain.mjs --root <repo> --apply plan.json --actions a/b,c/d

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ageHours,
  classify,
  cmp,
  cmpRaw,
  confine,
  escapeRegExp,
  failures,
  ghApi,
  mdTable,
  minAgeMinutesFromYaml,
  npmView,
  parseVersion,
  pool,
  readJson,
  readText,
  readWorkspaceYaml,
  toolStatus,
} from './lib.js'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    'min-age-hours': { type: 'string' },
    apply: { type: 'string' },
    actions: { type: 'string' },
    tools: { type: 'string' },
  },
})
const root = values.root ? resolve(values.root) : process.cwd()

const USES_RE =
  /^(\s*-?\s*uses:\s*)(["']?)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s"']+)?)@([^\s"'#]+)\2(\s*#\s*(\S+))?(.*)$/

// Workflow text, read once per run (the analysis reads each file several times).
const textCache = new Map()
function workflowText(file) {
  if (!textCache.has(file)) {
    textCache.set(file, readFileSync(file, 'utf8'))
  }
  return textCache.get(file)
}

function workflowFiles() {
  const dir = confine(root, '.github')
  const out = []
  const walk = (d) => {
    let entries = []
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) {
        walk(p)
      } else if (/\.ya?ml$/.test(e)) {
        out.push(p)
      }
    }
  }
  if (dir) {
    walk(dir)
  }
  return out.sort()
}

function scanUses() {
  const uses = []
  for (const file of workflowFiles()) {
    const lines = workflowText(file).split('\n')
    lines.forEach((line, i) => {
      const m = line.match(USES_RE)
      if (!m || m[3].startsWith('.') || m[3].startsWith('docker:')) {
        return
      }
      const [owner, repo] = m[3].split('/')
      uses.push({
        file: relative(root, file),
        line: i + 1,
        action: m[3],
        repo: `${owner}/${repo}`,
        ref: m[4],
        comment: m[6] ?? null,
      })
    })
  }
  return uses
}

const isSha = (s) => /^[0-9a-f]{40}$/.test(s)

// Resolve a tag (never a branch of the same name) to its commit. Dereferences annotated
// tags. Returns { sha, date } (the commit's committer date) or null on any API failure.
async function tagCommit(repo, tag) {
  const ref = await ghApi(
    `repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`
  )
  let obj = ref?.object
  for (let i = 0; obj && obj.type === 'tag' && i < 5; i++) {
    const tagObj = await ghApi(`repos/${repo}/git/tags/${obj.sha}`)
    obj = tagObj?.object
  }
  if (obj?.type !== 'commit' || !isSha(obj.sha)) {
    return null
  }
  const commit = await ghApi(`repos/${repo}/git/commits/${obj.sha}`)
  return { sha: obj.sha, date: commit?.committer?.date ?? null }
}

// Newest stable release (by SemVer) that has aged past the gate, plus the newest overall.
const FULL_TAG = /^v?\d+\.\d+\.\d+$/

async function releasesFor(repo, minAgeMs, nowMs) {
  const rel = await ghApi(`repos/${repo}/releases?per_page=100`)
  // Only full x.y.z tags; floating major tags like `v6` move and are not pinnable versions.
  let list = (Array.isArray(rel) ? rel : [])
    .filter((r) => !r.draft && !r.prerelease && FULL_TAG.test(r.tag_name))
    .map((r) => ({
      tag: r.tag_name,
      publishedAt: r.published_at,
      immutable: r.immutable === true,
    }))
  let datesKnown = true
  if (!list.length) {
    // No x.y.z release (none at all, or only names like `codeql-bundle-v2`): use tags.
    const tags = await ghApi(`repos/${repo}/tags?per_page=100`)
    datesKnown = false
    list = (Array.isArray(tags) ? tags : [])
      .filter((x) => FULL_TAG.test(x.name))
      .map((x) => ({ tag: x.name, publishedAt: null, immutable: false }))
  }
  list.sort((a, b) => cmp(parseVersion(b.tag), parseVersion(a.tag)))
  const newest = list[0] ?? null
  const aged = list.find(
    (r) => r.publishedAt && nowMs - Date.parse(r.publishedAt) >= minAgeMs
  )
  return { newest, aged: aged ?? null, datesKnown }
}

async function analyzeActions(minAgeMs, nowMs, minAgeHours) {
  const uses = scanUses()
  const repos = [...new Set(uses.map((u) => u.repo))].sort()
  const results = await pool(repos, 6, async (repo) => {
    const occ = uses.filter((u) => u.repo === repo)
    const currents = [
      ...new Set(occ.map((u) => u.comment ?? (isSha(u.ref) ? null : u.ref))),
    ]
    const current =
      currents
        .filter(Boolean)
        .sort((a, b) => cmp(parseVersion(a), parseVersion(b)))[0] ?? null
    const { newest, aged, datesKnown } = await releasesFor(
      repo,
      minAgeMs,
      nowMs
    )
    const target = datesKnown ? aged : newest
    const entry = {
      repo,
      current,
      occurrences: occ.length,
      files: [...new Set(occ.map((u) => u.file))],
      pinnedBySha: occ.every((u) => isSha(u.ref)),
      mixedVersions: currents.length > 1,
      newest: newest?.tag ?? null,
      newestAgeHours: newest?.publishedAt
        ? ageHours(newest.publishedAt, nowMs)
        : null,
      target: target?.tag ?? null,
      targetSha: null,
      ageUnknown: !datesKnown,
      pinMatchesComment: null,
    }
    // Integrity: does each pinned SHA match the commit of the full x.y.z tag in its
    // comment? true / false, or null when unknown (API failure, floating `# v4` comment).
    // Only a confirmed mismatch is a finding.
    const pinned = occ.filter(
      (u) => isSha(u.ref) && u.comment && FULL_TAG.test(u.comment)
    )
    if (pinned.length) {
      const checks = await pool(
        [...new Set(pinned.map((u) => `${u.ref} ${u.comment}`))],
        3,
        async (pair) => {
          const [sha, tag] = pair.split(' ')
          const c = await tagCommit(repo, tag)
          return c ? c.sha === sha : null
        }
      )
      entry.pinMatchesComment = checks.includes(false)
        ? false
        : checks.includes(null)
          ? null
          : true
    }
    if (!current || !entry.target) {
      entry.status = !entry.target ? 'no-release' : 'unknown-current'
      return entry
    }
    if (cmpRaw(entry.target, current) <= 0) {
      entry.status =
        entry.newest && cmpRaw(entry.newest, current) > 0
          ? 'too-fresh'
          : 'up-to-date'
      return entry
    }
    // Age the commit that the tag points to now, not only the release: a tag can be moved
    // to a new commit long after its release was published (tj-actions, reviewdog).
    const resolved = await tagCommit(repo, entry.target)
    entry.targetSha = resolved?.sha ?? null
    entry.targetCommitDate = resolved?.date ?? null
    // An immutable release cannot have its tag moved. A mutable one can: say so.
    entry.targetImmutable = !!target?.immutable
    const commitAgeOk =
      !!resolved?.date && nowMs - Date.parse(resolved.date) >= minAgeMs
    const publishedAt = target?.publishedAt
      ? Date.parse(target.publishedAt)
      : null
    // A commit made after the release was published (1h slack) means the tag moved.
    entry.tagMovedAfterRelease =
      !!resolved?.date &&
      publishedAt != null &&
      Date.parse(resolved.date) > publishedAt + 3600000
    const cls = classify(current, entry.target)
    entry.bumpType = cls.bumpType
    // Auto-apply only what nobody can have tampered with: an immutable release whose tag
    // resolves to an aged commit, and a current pin that matches its comment. A mismatched
    // pin must be reported, never overwritten silently.
    const reasons = [
      !cls.safe && 'major',
      entry.pinMatchesComment === false &&
        'the current pin does not match its version comment: report it first',
      entry.pinMatchesComment === null &&
        'the current pin could not be verified (floating comment or API failure)',
      !entry.targetSha && 'could not resolve the tag to a commit',
      entry.tagMovedAfterRelease &&
        'the tag points to a commit made after the release: check it',
      entry.targetSha &&
        !commitAgeOk &&
        'the tagged commit is younger than the gate',
      entry.ageUnknown && 'no release dates (tags only)',
      entry.targetSha &&
        !entry.targetImmutable &&
        'mutable release: its tag can move; check the SHA',
    ].filter(Boolean)
    entry.status = reasons.length ? 'needs-approval' : 'safe'
    entry.approvalReason = reasons.length ? reasons.join('; ') : null
    entry.heldBack = !!entry.newest && cmpRaw(entry.newest, entry.target) > 0
    entry.releasesUrl = `https://github.com/${repo}/releases`
    return entry
  })
  return { uses, actions: results, minAgeHours }
}

async function analyzePnpm(minAgeMs, nowMs) {
  const pm = readJson(root, 'package.json')?.packageManager ?? ''
  const m = pm.match(/^pnpm@([^+]+)/)
  const current = m ? m[1] : null
  const view = await npmView('pnpm', root)
  // too-fresh (not up-to-date) when every newer release is younger than the gate. pnpm is
  // never fast-tracked: it has no exclude list, so it keeps the gate.
  const st =
    current && view
      ? toolStatus(view, current, minAgeMs, nowMs)
      : { target: null, status: view ? 'up-to-date' : 'unknown' }
  const target = st.target
  const latest = view?.distTags?.latest ?? null
  // CI must read pnpm from packageManager. A hardcoded version would drift.
  const hardcoded = []
  for (const file of workflowFiles()) {
    const lines = workflowText(file).split('\n')
    lines.forEach((l, i) => {
      if (/pnpm\/action-setup@/.test(l)) {
        for (const next of lines.slice(i + 1, i + 6)) {
          if (/^\s*version:\s*\S/.test(next)) {
            hardcoded.push(`${relative(root, file)}:${i + 1}`)
          }
        }
      }
    })
  }
  return {
    current,
    target,
    latest,
    latestAgeHours:
      latest && view?.time?.[latest]
        ? ageHours(view.time[latest], nowMs)
        : null,
    bumpType: current && target ? classify(current, target).bumpType : null,
    // A pnpm major (or any non-safe move) needs the user's approval like any other major.
    // 'too-fresh': only releases younger than the gate are newer; 'unknown': npm failed.
    status: st.status,
    // The newest release above the target (or above current), and its age.
    newest: st.newest ?? null,
    newestAgeHours: st.newestAgeHours ?? null,
    hardcodedInCi: hardcoded,
  }
}

// Tool versions that CI hardcodes: `FOO_VERSION: '1.2.3'` env values (mapped to the npm
// package `foo`) and `npx -y pkg@1.2.3` / `pnpm dlx pkg@1.2.3` / `pnpx pkg@1.2.3` calls.
const ENV_VERSION_RE =
  /^(\s*)([A-Z][A-Z0-9_]*)_VERSION:\s*(["']?)(\d+\.\d+\.\d+)\3/
const CALL_VERSION_RE =
  /(?:npx\s+(?:-y\s+|--yes\s+)?|pnpm\s+dlx\s+|pnpx\s+)["']?(@?[a-z0-9][\w./-]*)@(\d+\.\d+\.\d+)/g

async function analyzeCiTools(minAgeMs, nowMs) {
  const found = []
  for (const file of workflowFiles()) {
    workflowText(file)
      .split('\n')
      .forEach((l, i) => {
        if (/^\s*#/.test(l)) {
          return
        }
        const env = l.match(ENV_VERSION_RE)
        if (env) {
          const pkg = env[2].toLowerCase().replace(/_/g, '-')
          const v = `${env[2]}_VERSION`
          // The env name maps to an npm package by a guess. Trust the guess only if the
          // same workflow calls `<pkg>@"$VAR"`, `<pkg>@${VAR}` or `<pkg>@$VAR`.
          const esc = escapeRegExp(pkg)
          const used = new RegExp(`${esc}@["']?\\$\\{?${v}\\b`).test(
            workflowText(file)
          )
          found.push({
            file: relative(root, file),
            line: i + 1,
            pkg,
            via: v,
            version: env[4],
            mappingConfirmed: used,
          })
        }
        for (const m of l.matchAll(CALL_VERSION_RE)) {
          found.push({
            file: relative(root, file),
            line: i + 1,
            pkg: m[1],
            via: 'npx/dlx',
            version: m[2],
          })
        }
      })
  }
  const pkgs = [...new Set(found.map((f) => f.pkg))].sort()
  const views = await pool(pkgs, 6, (p) => npmView(p, root))
  return pkgs.map((pkg, i) => {
    const occ = found.filter((f) => f.pkg === pkg)
    const view = views[i]
    const current = occ
      .map((o) => o.version)
      .sort((a, b) => cmp(parseVersion(a), parseVersion(b)))[0]
    // CI tools are never fast-tracked (no exclude list): they keep the gate.
    const st = view ? toolStatus(view, current, minAgeMs, nowMs) : null
    const target = st?.target ?? null
    const entry = {
      pkg,
      via: [...new Set(occ.map((o) => o.via))].join(', '),
      current,
      target,
      latest: view?.distTags?.latest ?? null,
      newest: st?.newest ?? null,
      newestAgeHours: st?.newestAgeHours ?? null,
      occurrences: occ,
      mixedVersions: new Set(occ.map((o) => o.version)).size > 1,
      unknownPackage: !view,
    }
    if (!view) {
      entry.status = 'unknown-package'
    } else if (!target) {
      // 'too-fresh' when newer releases exist but all are younger than the gate.
      entry.status = st.status
    } else {
      entry.bumpType = st.bumpType
      entry.mappingConfirmed = occ.every((o) => o.mappingConfirmed !== false)
      entry.status =
        st.status === 'safe' && entry.mappingConfirmed
          ? 'safe'
          : 'needs-approval'
    }
    return entry
  })
}

function applyTools(planPath, names) {
  const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'))
  const wanted = new Set(names)
  const tools = plan.ciTools.filter(
    (x) =>
      wanted.has(x.pkg) &&
      /^\d+\.\d+\.\d+$/.test(x.target ?? '') &&
      /^\d+\.\d+\.\d+$/.test(x.current ?? '')
  )
  // One read and one write per file, whatever the number of occurrences in it.
  const byFile = new Map()
  for (const tool of tools) {
    for (const o of tool.occurrences) {
      if (!byFile.has(o.file)) {
        byFile.set(o.file, [])
      }
      byFile.get(o.file).push({ tool, o })
    }
  }
  let changed = 0
  for (const [file, edits] of byFile) {
    const p = confine(root, file)
    if (!p) {
      continue
    }
    const lines = readFileSync(p, 'utf8').split('\n')
    let dirty = false
    for (const { tool, o } of edits) {
      // Never move a line down: a version already at or above the target stays.
      if (cmpRaw(o.version, tool.target) >= 0) {
        continue
      }
      const before = lines[o.line - 1] ?? ''
      // Replace only this tool's own version: `pkg@1.2.3` or the `X_VERSION: '1.2.3'` value.
      const re =
        o.via === 'npx/dlx'
          ? new RegExp(
              `(${escapeRegExp(tool.pkg)}@)${escapeRegExp(o.version)}(?![\\d.])`
            )
          : new RegExp(
              `(${escapeRegExp(o.via)}:\\s*["']?)${escapeRegExp(o.version)}(?![\\d.])`
            )
      const after = before.replace(re, (_m, pre) => `${pre}${tool.target}`)
      if (after !== before) {
        lines[o.line - 1] = after
        dirty = true
        changed++
      }
    }
    if (dirty) {
      writeFileSync(p, lines.join('\n'))
    }
  }
  const missing = [...wanted].filter((n) => !tools.some((x) => x.pkg === n))
  return { changedLines: changed, applied: tools.map((x) => x.pkg), missing }
}

async function analyzeNode() {
  const found = []
  for (const file of workflowFiles()) {
    workflowText(file)
      .split('\n')
      .forEach((l, i) => {
        const m = l.match(/node-version:\s*['"]?([^'"\s#]+)/)
        if (m) {
          found.push({ where: `${relative(root, file)}:${i + 1}`, value: m[1] })
        }
      })
  }
  for (const f of ['.nvmrc', '.node-version']) {
    const t = readText(root, f)
    if (t) {
      found.push({ where: f, value: t.trim() })
    }
  }
  const engines = readJson(root, 'package.json')?.engines?.node
  let lts = null
  let current = null
  try {
    const res = await fetch('https://nodejs.org/dist/index.json', {
      signal: AbortSignal.timeout(15000),
    })
    const list = await res.json()
    const stable = list.filter((r) => !/-/.test(r.version))
    lts = stable.find((r) => r.lts)?.version ?? null
    current = stable[0]?.version ?? null
  } catch (err) {
    failures.push({
      call: 'GET nodejs.org/dist/index.json',
      error: String(err.message),
    })
  }
  const ltsMajor = lts ? parseVersion(lts).major : null
  // `lts/*`, `node`, `latest` and similar are aliases: they follow the latest release by
  // themselves. Only a number (26, 26.x, 26.13.0) can fall behind.
  for (const f of found) {
    // Only real aliases follow the latest release. A matrix list or a ${{ }} expression
    // cannot be read here: it is "unparsed" and makes the result unknown.
    // `lts/*` follows the latest LTS; a codename such as `lts/iron` is fixed to one major.
    f.alias = /^(lts\/\*|node|latest|current|stable)$/i.test(f.value)
    const codename = /^lts\/[a-z]+$/i.test(f.value)
    f.unparsed = !f.alias && (codename || !/^v?\d/.test(f.value))
  }
  return {
    found,
    engines: engines ?? null,
    latestLts: lts,
    latestCurrent: current,
    upToDate:
      ltsMajor == null || found.some((f) => f.unparsed)
        ? null
        : found
            .filter((f) => !f.alias)
            .every((f) => parseVersion(f.value).major >= ltsMajor),
  }
}

function applyActions(planPath, names) {
  const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'))
  const wanted = new Set(names)
  const byRepo = new Map(
    plan.actions.actions
      // Write only a full 40-hex SHA and an x.y.z tag, whatever the plan file says.
      .filter(
        (a) =>
          wanted.has(a.repo) &&
          isSha(a.targetSha ?? '') &&
          FULL_TAG.test(a.target ?? '')
      )
      .map((a) => [a.repo, a])
  )
  const missing = [...wanted].filter((n) => !byRepo.has(n))
  const files = new Set(plan.actions.uses.map((u) => u.file))
  const skipped = []
  let changed = 0
  for (const rel of files) {
    const p = confine(root, rel)
    if (!p) {
      continue
    }
    const lines = readFileSync(p, 'utf8').split('\n')
    let dirty = false
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(USES_RE)
      if (!m) {
        continue
      }
      const repo = m[3].split('/').slice(0, 2).join('/')
      const a = byRepo.get(repo)
      if (!a) {
        continue
      }
      // Rewrite only a line whose version is known and lower than the target. A line with
      // a floating ref or comment (`@v5`, `# v5`) or none could be newer: report it.
      const lineVersion =
        m[6] && FULL_TAG.test(m[6]) ? m[6] : FULL_TAG.test(m[4]) ? m[4] : null
      if (!lineVersion) {
        skipped.push(
          `${rel}:${i + 1} (version unknown: ${m[4]}${m[6] ? ` # ${m[6]}` : ''})`
        )
        continue
      }
      if (cmpRaw(lineVersion, a.target) >= 0) {
        continue
      }
      const next = `${m[1]}${m[2]}${m[3]}@${a.targetSha}${m[2]} # ${a.target}${m[7] ?? ''}`
      if (next !== lines[i]) {
        lines[i] = next
        dirty = true
        changed++
      }
    }
    if (dirty) {
      writeFileSync(p, lines.join('\n'))
    }
  }
  return {
    changedLines: changed,
    applied: [...byRepo.keys()],
    missing,
    skipped,
  }
}

function printSummary(plan) {
  const e = process.stderr
  const a = plan.actions.actions
  if (plan.degraded) {
    e.write(
      `\n**DEGRADED: ${plan.degraded.length} API call(s) failed. The plan is incomplete. Rerun before you trust it.**\n${plan.degraded
        .slice(0, 10)
        .map((f) => `- ${f.call}: ${f.error}`)
        .join('\n')}\n`
    )
  }
  e.write(
    `\n## GitHub Actions (release-age gate ${plan.actions.minAgeHours}h)\n\n`
  )
  const bump = a.filter(
    (x) => x.status === 'safe' || x.status === 'needs-approval'
  )
  e.write(
    bump.length
      ? `${mdTable(
          ['Action', 'From', 'To', 'Bump', 'Uses', 'Notes'],
          bump.map((x) => [
            `\`${x.repo}\``,
            x.current,
            x.target,
            x.status === 'needs-approval'
              ? `${x.bumpType} (approval)`
              : x.bumpType,
            x.occurrences,
            [
              x.heldBack ? `newest ${x.newest} is too fresh` : '',
              x.mixedVersions ? 'mixed versions in repo' : '',
              x.pinMatchesComment === false ? 'PIN DOES NOT MATCH COMMENT' : '',
              x.pinMatchesComment === null ? 'pin not verified' : '',
              x.approvalReason && x.approvalReason !== 'major'
                ? x.approvalReason
                : '',
              x.targetSha
                ? `→ ${x.targetSha.slice(0, 12)} (${x.targetCommitDate?.slice(0, 10) ?? '?'}${x.targetImmutable ? ', immutable release' : ', mutable release'})`
                : '',
              x.ageUnknown ? 'no release dates (tags only)' : '',
            ]
              .filter(Boolean)
              .join(' · '),
          ])
        )}\n`
      : 'All actions use their latest aged release.\n'
  )
  const other = a.filter(
    (x) => !(x.status === 'safe' || x.status === 'needs-approval')
  )
  if (other.length) {
    e.write(
      `\nUp to date or not bumpable: ${other
        .map(
          (x) =>
            `\`${x.repo}\` ${x.current ?? '?'} (${x.status}${x.status === 'too-fresh' ? `: ${x.newest} is ${x.newestAgeHours}h old` : ''}${x.pinMatchesComment === false ? ', PIN DOES NOT MATCH COMMENT' : ''})`
        )
        .join(', ')}\n`
    )
  }
  const unpinned = plan.actions.uses.filter(
    (u) => !/^[0-9a-f]{40}$/.test(u.ref)
  )
  if (unpinned.length) {
    e.write(
      `\nNot pinned to a SHA: ${unpinned.map((u) => `${u.file}:${u.line} ${u.action}@${u.ref}`).join(', ')}\n`
    )
  }
  const p = plan.pnpm
  e.write('\n## pnpm\n\n')
  e.write(
    `- packageManager: ${p.current ?? 'not set'} → ${p.target ?? p.current} ${
      p.target
        ? `(${p.bumpType}${p.status === 'needs-approval' ? ', NEEDS APPROVAL' : ''})`
        : p.status === 'too-fresh'
          ? `(too fresh: ${p.newest} is ${p.newestAgeHours}h old; step 5.9 regenerates with the current pnpm)`
          : p.status === 'unknown'
            ? '(UNKNOWN: npm call failed)'
            : '(up to date: step 5.9 regenerates with the current pnpm)'
    }; npm latest ${p.latest}${p.latestAgeHours != null ? ` (${p.latestAgeHours}h old)` : ''}\n`
  )
  e.write(
    `- Hardcoded pnpm version in CI: ${p.hardcodedInCi.length ? p.hardcodedInCi.join(', ') : 'none (CI reads packageManager)'}\n`
  )
  e.write('\n## Tool versions hardcoded in CI\n\n')
  e.write(
    plan.ciTools.length
      ? `${mdTable(
          ['Tool', 'Via', 'From', 'To', 'Bump', 'Notes'],
          plan.ciTools.map((x) => [
            `\`${x.pkg}\``,
            x.via,
            x.current,
            x.target ?? '—',
            x.status === 'needs-approval'
              ? `${x.bumpType} (approval)`
              : (x.bumpType ?? x.status),
            [
              x.status === 'too-fresh'
                ? `newest ${x.newest} is ${x.newestAgeHours}h old (<${plan.actions.minAgeHours}h)`
                : '',
              x.target && x.newest && x.newest !== x.target
                ? `newest ${x.newest} is too fresh (${x.newestAgeHours}h)`
                : '',
              x.mixedVersions ? 'mixed versions in repo' : '',
              x.unknownPackage
                ? 'no npm package with this name; check by hand'
                : '',
              x.mappingConfirmed === false
                ? 'env name mapped to npm by guess; confirm by hand'
                : '',
              x.occurrences.map((o) => `${o.file}:${o.line}`).join(', '),
            ]
              .filter(Boolean)
              .join(' · '),
          ])
        )}\n`
      : 'None.\n'
  )
  const n = plan.node
  e.write('\n## Node\n\n')
  e.write(
    `- CI and version files: ${n.found.map((f) => `${f.value} (${f.where})`).join(', ') || 'none'}\n`
  )
  e.write(
    `- engines.node: ${n.engines ?? 'not set'}; latest LTS ${n.latestLts}; latest current ${n.latestCurrent}; ${
      n.upToDate == null
        ? 'unknown: nodejs.org not reachable, or a node-version the script cannot read (matrix or expression); check by hand'
        : n.upToDate
          ? 'CI is on the latest LTS major (aliases such as lts/* follow it)'
          : 'CI is NOT on the latest LTS major'
    }\n\n`
  )
}

async function main() {
  if (values.apply) {
    // One JSON document for both kinds, so the caller can read every `missing` list.
    const list = (v) =>
      (v ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    const out = {}
    if (values.tools) {
      out.tools = applyTools(values.apply, list(values.tools))
    }
    if (values.actions) {
      out.actions = applyActions(values.apply, list(values.actions))
    }
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
    return
  }
  const yaml = readWorkspaceYaml(root)
  const minAgeHours = values['min-age-hours']
    ? Number(values['min-age-hours'])
    : minAgeMinutesFromYaml(yaml) / 60
  const minAgeMs = minAgeHours * 3600 * 1000
  const nowMs = Date.now()
  const [actions, pnpm, node, ciTools] = await Promise.all([
    analyzeActions(minAgeMs, nowMs, minAgeHours),
    analyzePnpm(minAgeMs, nowMs),
    analyzeNode(),
    analyzeCiTools(minAgeMs, nowMs),
  ])
  const plan = {
    root,
    now: new Date(nowMs).toISOString(),
    actions,
    pnpm,
    node,
    ciTools,
    // Calls that failed. Non-null means the plan is incomplete: rerun, do not trust "none".
    degraded: failures.length ? failures : null,
    // Names to pass to --tools for the safe batch.
    safeTools: ciTools.filter((x) => x.status === 'safe').map((x) => x.pkg),
    // Names to pass to --actions for the safe batch.
    safeActions: actions.actions
      .filter((x) => x.status === 'safe')
      .map((x) => x.repo),
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  printSummary(plan)
}

main()
