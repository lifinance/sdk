#!/usr/bin/env node
// bump.mjs — the fast path of the bump-packages skill: one run does the mechanical bump end
// to end. The model joins only for the `decisions` it prints (majors, fast-tracks that need
// approval or are blocked, overrides to check by hand, failed checks, migrations).
//
//   1. git: fetch; reuse the worktree of an open bump PR (fast-forward, merge origin/main)
//      or make a new worktree and branch from origin/main.
//   2. pnpm install --frozen-lockfile; pnpm audit (before).
//   3. analyze-outdated + analyze-toolchain for the root and each extra pnpm project.
//   4. decide without questions: safe bumps, auto (and --approve) fast-tracks, lift/floor
//      override updates, stale excludes, safe actions and tools, a non-major pnpm update.
//   5. regenerate each lockfile once.
//   6. lockfile-report (STOP = exit 3, nothing committed).
//   7. one changeset file.
//   8. build, then the checks once, 3 at a time (a failure = exit 4, nothing committed).
//   9. commits with --no-verify (step 8 ran the hook checks), the lockfile commit last.
//  10. push and open the PR, or append a "Run" section to the open PR.
//
// Output: JSON on stdout, a Markdown summary on stderr.
// Exit codes: 0 done or nothing to bump, 2 cannot run, 3 lockfile STOP, 4 a check failed.
//
// Usage: node bump.mjs --repo <main checkout> [--dry-run] [--approve name@x.y.z,...]
//        [--expect-majors name,...] [--no-push] [--out <dir>]

import { execFileSync, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  advisoriesFor,
  branchGuard,
  bumpSpec,
  changesetText,
  cmpRaw,
  EXIT,
  earlierExcludes,
  editExcludes,
  editExcludesDetailed,
  groupCommits,
  invalidExcludeEntries,
  malwareCoveringAny,
  mdSafe,
  npmView,
  npmViewFields,
  packageMalwareFor,
  packageManagerValue,
  parseChangesetLine,
  parseLock,
  pickAgedTarget,
  pickBumpPr,
  pool,
  prBody,
  provenanceOf,
  provenanceVerdict,
  prRunSection,
  recheckFlags,
  replaceOverride,
  setDependencySpec,
  setPackageManager,
  specName,
  wrapLines,
  yamlList,
} from './lib.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = `Usage: node bump.mjs --repo <main checkout> [options]

  --dry-run                 analyze and print the plan; change nothing
  --approve a@1.2.3,...     extra fast-track entries that the user approved (exact only)
  --expect-majors a,b       lockfile majors that the user approved
  --no-push                 commit, but do not push or open or edit a PR
  --out <dir>               the folder for logs and plans (default: a temporary folder)
  --help                    show this text

Exit codes: 0 done or nothing to bump, 2 cannot run, 3 lockfile STOP, 4 a check failed.
`
let values
try {
  ;({ values } = parseArgs({
    options: {
      repo: { type: 'string' },
      'dry-run': { type: 'boolean' },
      approve: { type: 'string' },
      'expect-majors': { type: 'string' },
      'no-push': { type: 'boolean' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
  }))
} catch (e) {
  process.stderr.write(`${e.message}\n\n${USAGE}`)
  process.exit(2)
}
if (values.help) {
  process.stdout.write(USAGE)
  process.exit(0)
}
const list = (v) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

const ENV = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
const pad = (n) => String(n).padStart(2, '0')
const NOW = new Date()
const DATE = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}`
const STAMP = `${DATE} ${pad(NOW.getHours())}:${pad(NOW.getMinutes())}`

// --- result and exit ------------------------------------------------------------

const R = {
  mode: null,
  dryRun: !!values['dry-run'],
  worktree: null,
  branch: null,
  pr: null,
  headBefore: null,
  commits: [],
  applied: {
    bumps: [],
    fastTracks: [],
    overrides: [],
    removedExcludes: [],
    actions: [],
    tools: [],
    pnpm: null,
  },
  decisions: [],
  lockfile: null,
  checks: [],
  audit: { before: null, after: null },
  timings: {},
  notes: [],
  uncommitted: [],
  out: null,
}

function summary(code, message) {
  const e = process.stderr
  e.write(`\n## bump.mjs: ${message}\n\n`)
  e.write(
    `- Mode: ${R.mode ?? '?'}${R.dryRun ? ' (dry run)' : ''}; worktree: ${R.worktree ?? '?'}; branch: ${R.branch ?? '?'}${R.pr ? `; PR #${R.pr}` : ''}\n`
  )
  const a = R.applied
  e.write(
    `- Applied: ${a.bumps.length} bumps (${a.fastTracks.length} fast-tracks), ${a.overrides.length} override updates, ${a.removedExcludes.length} stale excludes removed, ${a.actions.length} actions, ${a.tools.length} CI tools${a.pnpm ? `, pnpm ${a.pnpm.from} → ${a.pnpm.to}` : ''}\n`
  )
  for (const c of R.commits) {
    e.write(`- Commit ${c.sha.slice(0, 9)} ${c.message}\n`)
  }
  if (R.checks.length) {
    e.write(
      `- Checks: ${R.checks.map((c) => `${c.name} ${c.ok ? 'ok' : 'FAIL'} (${c.seconds}s)`).join(', ')}\n`
    )
  }
  if (R.decisions.length) {
    e.write(`\n### Decisions for the model (${R.decisions.length})\n\n`)
    for (const d of R.decisions) {
      e.write(
        `- ${d.kind}: \`${d.name}\`${d.project && d.project !== '.' ? ` (${d.project})` : ''}. ${d.detail}\n`
      )
    }
  }
  for (const n of R.notes) {
    e.write(`- Note: ${n}\n`)
  }
  if (R.uncommitted.length) {
    e.write(
      `- Not committed (unexpected changes): ${R.uncommitted.join(', ')}\n`
    )
  }
  e.write(
    `\nTimings: ${Object.entries(R.timings)
      .map(([k, v]) => `${k} ${v}s`)
      .join(', ')}\n\n`
  )
  if (code === EXIT.lockfileStop || code === EXIT.checkFailed) {
    e.write(
      `${
        R.mergeCommit
          ? `The run made one local commit: ${R.mergeCommit}, the merge of origin/main (not pushed). Nothing else was committed.`
          : 'Nothing was committed.'
      } The worktree has the changes. To discard them:\n  git -C '${R.worktree}' reset --hard ${R.mergeCommit ? R.headBefore : 'HEAD'} && git -C '${R.worktree}' clean -fd -- .changeset\n  pnpm -C '${R.worktree}' install --frozen-lockfile\nThe head before this run was ${R.headBefore ?? '?'}.\n\n`
    )
  }
}

// Synchronous cleanups that run on every exit (the temporary dry-run worktree).
const CLEANUPS = []

function finish(code, message) {
  for (const fn of CLEANUPS.splice(0)) {
    try {
      fn()
    } catch (e) {
      R.notes.push(`cleanup failed: ${e.message}`)
    }
  }
  R.exit = code
  R.message = message
  process.stdout.write(`${JSON.stringify(R, null, 2)}\n`)
  summary(code, message)
  process.exit(code)
}

async function step(name, fn) {
  const t = Date.now()
  try {
    return await fn()
  } finally {
    R.timings[name] = Math.round((Date.now() - t) / 100) / 10
    process.stderr.write(`[bump] ${name}: ${R.timings[name]}s\n`)
  }
}

// --- child processes (argument arrays only, always with an explicit cwd) -------------

function run(cmd, args, { cwd, log = null, input = null } = {}) {
  if (!cwd) {
    throw new Error(`run ${cmd}: no cwd`)
  }
  const t = Date.now()
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env: ENV })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    if (input != null) {
      child.stdin.end(input)
    } else {
      child.stdin.end()
    }
    const end = (code) => {
      const r = {
        code,
        out,
        err,
        seconds: Math.round((Date.now() - t) / 100) / 10,
      }
      if (log) {
        writeFileSync(
          log,
          `$ ${cmd} ${args.join(' ')}\n(cwd ${cwd}, exit ${code}, ${r.seconds}s)\n\n${out}\n${err}`
        )
      }
      done(r)
    }
    child.on('error', (e) => {
      err += String(e.message)
      end(127)
    })
    child.on('close', end)
  })
}

async function must(cmd, args, opts, what) {
  const r = await run(cmd, args, opts)
  if (r.code !== 0) {
    finish(
      EXIT.cannotRun,
      `${what ?? `${cmd} ${args.join(' ')}`} failed (exit ${r.code}): ${(r.err || r.out).trim().split('\n').slice(-5).join(' | ')}`
    )
  }
  return r.out
}

const git = (cwd, args) => run('git', args, { cwd })
const gitOk = async (cwd, args) => (await git(cwd, args)).code === 0
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
// A name or an entry in backticks (GitHub must not read `@scope/x` as a mention).
const tick = (s) => `\`${s}\``

// --- 1. git ----------------------------------------------------------------------

async function setupGit() {
  const repo = resolve(values.repo)
  const url = (
    await must('git', ['remote', 'get-url', 'origin'], { cwd: repo })
  ).trim()
  const ghRepo = /github\.com[:/](.+?)(?:\.git)?$/.exec(url)?.[1]
  if (!ghRepo) {
    finish(EXIT.cannotRun, `origin is not a GitHub URL: ${url}`)
  }
  // The user's git config has fetch.pruneTags=true: never prune tags here.
  await must('git', ['fetch', '--no-prune-tags', 'origin'], { cwd: repo })
  const prs = JSON.parse(
    await must(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        ghRepo,
        '--state',
        'open',
        '--search',
        '"chore: bump packages" in:title',
        '--json',
        'number,headRefName,title,isCrossRepository,headRepositoryOwner',
      ],
      { cwd: repo }
    )
  )
  // Never a fork PR, never a branch that bump.mjs did not make (see pickBumpPr).
  const { pr: openPr, rejected } = pickBumpPr(prs, ghRepo.split('/')[0])
  for (const r of rejected) {
    R.notes.push(`Open PR #${r.number} is not reused: ${r.why}.`)
  }
  const head = await git(repo, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  R.defaultBranch =
    head.code === 0 ? head.out.trim().replace(/^origin\//, '') : 'main'
  const worktrees = (
    await must('git', ['worktree', 'list', '--porcelain'], { cwd: repo })
  )
    .split('\n\n')
    .map((b) => ({
      path: /^worktree (.+)$/m.exec(b)?.[1],
      branch: /^branch (.+)$/m.exec(b)?.[1],
    }))
  // The first entry is the main checkout: never work there.
  R.mainCheckout = realpathSync(worktrees[0].path)
  const guard = () => {
    const why = branchGuard({
      branch: R.branch,
      defaultBranch: R.defaultBranch,
      worktree: R.worktree && realpathSync(R.worktree),
      mainCheckout: R.mainCheckout,
    })
    if (why) {
      finish(EXIT.cannotRun, `refused: ${why}`)
    }
  }
  const base = `${repo}/.claude/worktrees`
  const free = (p) => {
    let n = 1
    while (existsSync(n === 1 ? p : `${p}-${n}`)) {
      n++
    }
    return n === 1 ? p : `${p}-${n}`
  }
  if (openPr) {
    const pr = openPr
    R.mode = 'open-pr'
    R.pr = pr.number
    R.branch = pr.headRefName
    guard()
    let wt = worktrees.find(
      (w) => w.branch === `refs/heads/${pr.headRefName}`
    )?.path
    if (wt) {
      const st = await must('git', ['status', '--porcelain'], { cwd: wt })
      if (st.trim()) {
        R.worktree = wt
        finish(
          EXIT.cannotRun,
          `the worktree of PR #${pr.number} is not clean: ${wt}`
        )
      }
    } else {
      wt = free(`${base}/bump-${DATE}-pr${pr.number}`)
      const local = await gitOk(repo, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${pr.headRefName}`,
      ])
      await must(
        'git',
        local
          ? ['worktree', 'add', wt, pr.headRefName]
          : [
              'worktree',
              'add',
              '--track',
              '-b',
              pr.headRefName,
              wt,
              `origin/${pr.headRefName}`,
            ],
        { cwd: repo }
      )
    }
    R.worktree = wt
    guard()
    R.headBefore = (
      await must('git', ['rev-parse', 'HEAD'], { cwd: wt })
    ).trim()
    R.base = `origin/${pr.headRefName}`
    if (R.dryRun) {
      R.notes.push(
        'Dry run: the plan comes from the branch head; origin/main was not merged.'
      )
      return { repo, ghRepo, wt }
    }
    // Fast-forward to the remote branch (never rebase, never force).
    if (!(await gitOk(wt, ['merge-base', '--is-ancestor', R.base, 'HEAD']))) {
      await must(
        'git',
        ['merge', '--ff-only', R.base],
        { cwd: wt },
        `fast-forward to ${R.base}`
      )
    }
    if (
      !(await gitOk(wt, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']))
    ) {
      const m = await run(
        'git',
        ['merge', '--no-ff', '--no-edit', 'origin/main'],
        { cwd: wt }
      )
      if (m.code !== 0) {
        const conflicts = (
          await git(wt, ['diff', '--name-only', '--diff-filter=U'])
        ).out
          .split('\n')
          .filter(Boolean)
        if (
          conflicts.length &&
          conflicts.every((f) => /(^|\/)pnpm-lock\.yaml$/.test(f))
        ) {
          // Lockfile-only conflict: take origin/main's lockfile; step 5 regenerates it.
          await must('git', ['checkout', '--theirs', '--', ...conflicts], {
            cwd: wt,
          })
          await must('git', ['add', '--', ...conflicts], { cwd: wt })
          await must('git', ['commit', '--no-verify', '--no-edit'], { cwd: wt })
          R.lockfileFromMain = true
        } else {
          await git(wt, ['merge', '--abort'])
          finish(
            EXIT.cannotRun,
            `merging origin/main conflicts outside the lockfile: ${conflicts.join(', ') || m.err.trim()}`
          )
        }
      }
      R.mergedMain = true
      R.mergeCommit = (
        await must('git', ['rev-parse', 'HEAD'], { cwd: wt })
      ).trim()
      R.notes.push(
        `Merged origin/main into the PR branch (local merge commit ${R.mergeCommit}).`
      )
    }
    return { repo, ghRepo, wt }
  }
  // No open PR: a new worktree and branch from origin/main, with a free suffix.
  R.mode = 'new'
  if (R.dryRun) {
    // A dry run makes no branch: a temporary detached worktree, removed on exit.
    const tmp = join(R.out, 'dry-run-worktree')
    await must('git', ['worktree', 'add', '--detach', tmp, 'origin/main'], {
      cwd: repo,
    })
    CLEANUPS.push(() => {
      execFileSync('git', ['worktree', 'remove', '--force', tmp], {
        cwd: repo,
        stdio: 'ignore',
      })
    })
    R.worktree = tmp
    R.branch = null
    R.headBefore = (
      await must('git', ['rev-parse', 'HEAD'], { cwd: tmp })
    ).trim()
    R.base = null
    R.notes.push(
      'Dry run: a temporary detached worktree from origin/main; it is removed at the end.'
    )
    return { repo, ghRepo, wt: tmp }
  }
  const compact = DATE.replaceAll('-', '')
  let n = 1
  for (; ; n++) {
    const sfx = n === 1 ? '' : `-${n}`
    const path = `${base}/bump-${DATE}${sfx}`
    const br = `chore/bump-deps-${compact}${sfx}`
    const taken =
      existsSync(path) ||
      (await gitOk(repo, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${br}`,
      ])) ||
      (await gitOk(repo, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/remotes/origin/${br}`,
      ]))
    if (!taken) {
      R.worktree = path
      R.branch = br
      break
    }
  }
  guard()
  await must(
    'git',
    [
      'worktree',
      'add',
      '--no-track',
      '-b',
      R.branch,
      R.worktree,
      'origin/main',
    ],
    { cwd: repo }
  )
  R.headBefore = (
    await must('git', ['rev-parse', 'HEAD'], { cwd: R.worktree })
  ).trim()
  R.base = null
  return { repo, ghRepo, wt: R.worktree }
}

// --- 3. analysis ------------------------------------------------------------------

async function analyze(wt, out) {
  const extras = (
    await must('git', ['ls-files', '*pnpm-lock.yaml', ':!pnpm-lock.yaml'], {
      cwd: wt,
    })
  )
    .split('\n')
    .filter(Boolean)
    .map((f) => dirname(f))
  const projects = ['.', ...extras].map((rel) => ({
    rel,
    dir: rel === '.' ? wt : join(wt, rel),
    slug: rel === '.' ? 'root' : rel.replace(/[^\w]+/g, '-'),
  }))
  const jobs = projects.flatMap((p) =>
    ['analyze-outdated', 'analyze-toolchain'].map((script) => ({ p, script }))
  )
  const results = await pool(jobs, 4, async ({ p, script }) => {
    const r = await run(
      'node',
      [join(HERE, `${script}.mjs`), '--root', p.dir],
      {
        cwd: p.dir,
      }
    )
    const base = join(
      out,
      `${script === 'analyze-outdated' ? 'npm' : 'toolchain'}-plan-${p.slug}`
    )
    writeFileSync(`${base}.json`, r.out)
    writeFileSync(`${base}.md`, r.err)
    if (r.code !== 0) {
      finish(
        EXIT.cannotRun,
        `${script} failed for ${p.rel} (exit ${r.code}): ${r.err.trim().split('\n').slice(-3).join(' | ')}`
      )
    }
    const plan = JSON.parse(r.out)
    if (plan.degraded) {
      finish(
        EXIT.cannotRun,
        `${script} for ${p.rel} is degraded: ${plan.degraded
          .slice(0, 3)
          .map((f) => `${f.call}: ${f.error}`)
          .join('; ')}. Rerun.`
      )
    }
    return plan
  })
  projects.forEach((p, i) => {
    p.plan = results[i * 2]
    p.tc = results[i * 2 + 1]
    p.tcPath = join(out, `toolchain-plan-${p.slug}.json`)
  })
  return projects
}

async function audit(wt) {
  const r = await run('pnpm', ['audit', '--json'], { cwd: wt })
  try {
    return JSON.parse(r.out).metadata?.vulnerabilities ?? null
  } catch {
    return null // a network failure is data, not a failure of the run
  }
}

// --- 4. decide --------------------------------------------------------------------

function decide(projects, approve) {
  const decisions = R.decisions
  const add = (kind, project, name, detail) =>
    decisions.push({ kind, project, name, detail: mdSafe(detail) })
  const usedApprove = new Set()
  for (const p of projects) {
    const plan = p.plan
    p.bumps = []
    p.excludeAdd = []
    p.overrides = []
    p.removeExcludes = []
    const mismatch = new Set(
      plan.targetMismatch.map((x) => `${x.name}@${x.current}`)
    )
    for (const e of plan.safe) {
      if (mismatch.has(`${e.name}@${e.current}`)) {
        const m = plan.targetMismatch.find(
          (x) => x.name === e.name && x.current === e.current
        )
        add(
          'target differs from pnpm',
          p.rel,
          e.name,
          `Predicted ${m.predicted}, pnpm ${m.pnpm}. Not applied.`
        )
        continue
      }
      p.bumps.push({
        name: e.name,
        where: e.where,
        from: e.current,
        to: e.target,
        bump: e.bumpType,
        kind: e.kind,
      })
      if (e.newDependencies === null) {
        add(
          'new dependencies unknown',
          p.rel,
          e.name,
          'The npm call failed. Check the target by hand.'
        )
      } else if (e.newDependencies?.length) {
        add(
          'new dependencies (note)',
          p.rel,
          e.name,
          `${e.target} adds ${e.newDependencies.map(tick).join(', ')}.`
        )
      }
    }
    for (const fam of plan.fastTrackFamilies) {
      const members = plan.fastTrack.filter((c) =>
        fam.versions.includes(`${c.name}@${c.fresh}`)
      )
      const approved =
        fam.decision === 'auto' ||
        (fam.excludeSet.length > 0 &&
          fam.excludeSet.every((x) => approve.has(x)))
      if (approved) {
        for (const x of fam.excludeSet) {
          usedApprove.add(x)
        }
        p.excludeAdd.push(...fam.excludeSet)
        for (const c of members) {
          R.applied.fastTracks.push({
            project: p.rel,
            spec: `${c.name}@${c.fresh}`,
            ageHours: c.ageHours,
            excludeSet: c.excludeSet,
            approved: fam.decision !== 'auto',
          })
          if (c.bumpable) {
            p.bumps.push({
              name: c.name,
              where: c.where ?? [],
              from: c.current,
              to: c.fresh,
              bump: c.bumpType,
              kind: c.kind,
              fastTrack: true,
              changesetPackages: c.changesetPackages,
            })
          }
        }
        continue
      }
      const partial = fam.excludeSet.filter((x) => approve.has(x))
      add(
        fam.decision === 'blocked'
          ? 'fast-track blocked'
          : 'fast-track needs approval',
        p.rel,
        fam.members.join(' + '),
        `${fam.versions.map(tick).join(', ')}. ${
          fam.decision === 'blocked'
            ? `Red flags: ${fam.redFlags.join('; ')}.`
            : `No verified provenance: ${fam.unverifiedProvenance.map(tick).join(', ')}.`
        } Exclude set: ${fam.excludeSet.map(tick).join(', ')}.${partial.length ? ` Only part of the set is approved (${partial.map(tick).join(', ')}): not applied.` : ''}`
      )
    }
    for (const u of plan.overrideUpdates) {
      if (/^(lift|floor):/.test(u.reason)) {
        p.overrides.push(u)
      } else {
        add(
          'override: check by hand',
          p.rel,
          u.key,
          `${tick(`${u.key}: ${u.value}`)} → ${tick(`${u.newKey}: ${u.newValue}`)}.${u.comment ? ` Comment: ${u.comment}` : ''}`
        )
      }
    }
    p.removeExcludes = plan.staleExcludes.map((x) => x.entry)
    for (const e of plan.needsApproval) {
      add(
        'major',
        p.rel,
        e.name,
        `${e.current} → ${e.target} (${e.reason}).${e.ifDeclined ? ` If declined: ${e.ifDeclined}.` : ''}${e.requires?.length ? ` Goes with ${e.requires.map(tick).join(', ')}.` : ''}${e.regenOnly ? ' Only the regeneration moves it.' : ''}`
      )
    }
    for (const e of plan.held) {
      add(
        'held',
        p.rel,
        e.name,
        `${e.heldBy}${e.target ? ` (available: ${e.target})` : ''}.${e.reason ? ` ${e.reason}` : ''}`
      )
    }
    for (const f of plan.peerFloors) {
      add(
        'peer floor',
        p.rel,
        f.name,
        `${tick(f.project)}: ${f.range} → ${f.target}.`
      )
    }
    const fastTracked = new Set(
      R.applied.fastTracks
        .filter((f) => f.project === p.rel)
        .map((f) => specName(f.spec))
    )
    for (const e of plan.tooFresh.filter((x) => !fastTracked.has(x.name))) {
      add(
        'too fresh',
        p.rel,
        e.name,
        `${e.current}; fresh: ${(e.freshVersions ?? []).map((f) => `${f.version} (eligible in ~${f.eligibleInHours}h)`).join(', ') || e.registryLatest}.`
      )
    }
    for (const s of plan.fastTrackSkipped) {
      add('fresh major', p.rel, s.name, `${s.fresh}: ${s.reason}.`)
    }
    for (const m of plan.overrideMoves.filter((x) => x.major)) {
      add(
        'override moves a major',
        p.rel,
        m.name,
        `${tick(m.override)}: ${m.lockVersions.join(', ')} → ${m.target}.`
      )
    }
    // Toolchain: actions and CI tools (root only), pnpm for each project.
    const tc = p.tc
    if (p.rel === '.') {
      for (const a of tc.actions.actions) {
        if (a.status === 'safe') {
          R.applied.actions.push({
            repo: a.repo,
            from: a.current,
            to: a.target,
          })
        } else if (a.status === 'needs-approval') {
          add(
            'action needs approval',
            p.rel,
            a.repo,
            `${a.current} → ${a.target}: ${a.approvalReason}.`
          )
        } else if (a.status === 'too-fresh') {
          add(
            'too fresh',
            p.rel,
            a.repo,
            `${a.newest} is ${a.newestAgeHours}h old.`
          )
        }
        if (a.pinMatchesComment === false) {
          add(
            'ACTION PIN DOES NOT MATCH ITS COMMENT',
            p.rel,
            a.repo,
            'Report it as a security finding.'
          )
        }
      }
      for (const t of tc.ciTools) {
        if (t.status === 'safe') {
          R.applied.tools.push({ pkg: t.pkg, from: t.current, to: t.target })
        } else if (t.status !== 'up-to-date') {
          add(
            `CI tool ${t.status}`,
            p.rel,
            t.pkg,
            `${t.current} → ${t.target ?? t.newest ?? '?'}${t.newestAgeHours != null ? ` (newest ${t.newest}, ${t.newestAgeHours}h old)` : ''}.`
          )
        }
      }
      if (tc.node?.upToDate === false) {
        add(
          'node',
          p.rel,
          'node',
          `CI is not on the latest LTS (${tc.node.latestLts}).`
        )
      }
    }
    if (tc.pnpm.status === 'safe' && tc.pnpm.target) {
      p.pnpmTarget = tc.pnpm.target
      if (p.rel === '.') {
        R.applied.pnpm = { from: tc.pnpm.current, to: tc.pnpm.target }
      }
    } else if (tc.pnpm.status === 'needs-approval') {
      add(
        'pnpm major',
        p.rel,
        'pnpm',
        `${tc.pnpm.current} → ${tc.pnpm.target}.`
      )
    } else if (tc.pnpm.status === 'too-fresh') {
      add(
        'too fresh',
        p.rel,
        'pnpm',
        `${tc.pnpm.newest} is ${tc.pnpm.newestAgeHours}h old.`
      )
    }
    R.applied.bumps.push(...p.bumps.map((b) => ({ ...b, project: p.rel })))
    R.applied.overrides.push(
      ...p.overrides.map((o) => ({ ...o, project: p.rel }))
    )
    // The planned removals; the edit step replaces them with what it really removed.
    R.applied.removedExcludes.push(...p.removeExcludes)
  }
  for (const a of approve) {
    if (!usedApprove.has(a)) {
      add(
        'approved entry not used',
        '.',
        a,
        'It is not in a complete fast-track family of the plan, so it was not added.'
      )
    }
  }
  // An extra project gets the root's exclude entries for the packages in its lockfile.
  const root = projects[0]
  for (const p of projects.slice(1)) {
    const lock = parseLock(read(join(p.dir, 'pnpm-lock.yaml')))
    p.excludeAdd.push(...root.excludeAdd.filter((x) => lock.has(specName(x))))
  }
  for (const p of projects) {
    p.excludeAdd = [...new Set(p.excludeAdd)].sort()
  }
}

// --- 4b. apply the edits -----------------------------------------------------------

function editManifests(p) {
  for (const b of p.bumps) {
    let edits = 0
    for (const w of b.where) {
      const file = join(p.dir, w, 'package.json')
      let text = read(file)
      if (!text) {
        continue
      }
      const json = JSON.parse(text)
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
      ]) {
        const spec = json[field]?.[b.name]
        const next = spec == null ? null : bumpSpec(spec, b.to)
        if (next && next !== spec) {
          const changed = setDependencySpec(text, field, b.name, next)
          if (changed == null || changed === text) {
            finish(
              EXIT.cannotRun,
              `could not set ${b.name} to ${next} in ${field} of ${file}`
            )
          }
          text = changed
          edits++
        }
      }
      writeFileSync(file, text)
    }
    if (!edits) {
      R.notes.push(
        `${b.name} ${b.to}: no bumpable specifier found in ${b.where.join(', ')} (the regeneration may still move it).`
      )
    }
  }
}

// Why the exclude entries are there: every check passed, or the user approved them.
function excludeReason() {
  const ft = R.applied.fastTracks
  const approved = ft.filter((f) => f.approved).length
  return approved === 0
    ? 'all checks pass'
    : approved === ft.length
      ? 'approved by the user'
      : 'all checks pass, or approved by the user'
}

function editWorkspaceYaml(p) {
  const file = join(p.dir, 'pnpm-workspace.yaml')
  const orig = read(file)
  if (orig == null) {
    return
  }
  let text = orig
  for (const o of p.overrides) {
    const next = replaceOverride(text, o.key, o.value, o.newKey, o.newValue)
    if (next == null) {
      R.decisions.push({
        kind: 'override line not found',
        project: p.rel,
        name: o.key,
        detail: `Wanted ${tick(`${o.newKey}: ${o.newValue}`)}.`,
      })
    } else {
      text = next
    }
  }
  const have = new Set(yamlList(orig, 'minimumReleaseAgeExclude'))
  const add = p.excludeAdd.filter((x) => !have.has(x))
  const comment = add.length
    ? `#   - ${DATE}: fast-track ${add.join(', ')} (${excludeReason()}).`
    : null
  // Stale entries can also sit inside a `name@a || b` item: editExcludesDetailed says
  // what it really removed.
  const res = editExcludesDetailed(text, {
    add,
    remove: p.removeExcludes,
    comment,
  })
  text = res.text
  p.removedReal = res.removed
  R.applied.removedExcludes.push(...res.removed)
  for (const x of p.removeExcludes.filter((e) => !res.removed.includes(e))) {
    R.decisions.push({
      kind: 'stale exclude not removed',
      project: p.rel,
      name: x,
      detail: 'The entry has aged out, but the script found no item to remove.',
    })
  }
  if (text !== orig) {
    writeFileSync(file, text)
  }
  // The state for the first commit: only the additions.
  p.yamlFile = file
  p.yamlAddsOnly = add.length ? editExcludes(orig, { add, comment }) : null
  p.yamlOrig = orig
}

async function setPnpm(p) {
  if (!p.pnpmTarget) {
    return
  }
  const r = await run(
    'npm',
    ['view', `pnpm@${p.pnpmTarget}`, 'dist.integrity'],
    { cwd: p.dir }
  )
  const value = packageManagerValue(p.pnpmTarget, r.out.trim())
  if (!value) {
    finish(EXIT.cannotRun, `cannot read the integrity of pnpm@${p.pnpmTarget}`)
  }
  const file = join(p.dir, 'package.json')
  const text = read(file)
  p.pmOld = /"packageManager"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? null
  writeFileSync(file, setPackageManager(text, value))
  p.pmFile = file
  const v = (await run('pnpm', ['--version'], { cwd: p.dir })).out.trim()
  if (v !== p.pnpmTarget) {
    finish(
      EXIT.cannotRun,
      `pnpm in ${p.rel} runs ${v}, not ${p.pnpmTarget}: it does not switch versions by packageManager`
    )
  }
}

// --- 5. regenerate --------------------------------------------------------------------

async function regen(p, out, headLock) {
  const lockFile = join(p.dir, 'pnpm-lock.yaml')
  const modLock = join(p.dir, 'node_modules', '.pnpm', 'lock.yaml')
  const aside = join(out, `modules-lock-${p.slug}.yaml`)
  const oldLock = read(lockFile)
  let moved = false
  let ok = false
  try {
    // pnpm rebuilds a deleted lockfile from node_modules/.pnpm/lock.yaml: move it aside.
    if (existsSync(modLock)) {
      copyFileSync(modLock, aside)
      rmSync(modLock)
      moved = true
    }
    rmSync(lockFile, { force: true })
    const r = await run('pnpm', ['install'], {
      cwd: p.dir,
      log: join(out, `regen-${p.slug}.log`),
    })
    if (r.code !== 0) {
      throw new Error(
        `pnpm install failed (exit ${r.code}): ${r.err.trim().split('\n').slice(-3).join(' | ')}`
      )
    }
    if (/resolution step is skipped/i.test(r.out + r.err)) {
      throw new Error(
        'pnpm skipped the resolution step: the lockfile was not regenerated'
      )
    }
    const regenScript =
      JSON.parse(read(join(p.dir, 'package.json'))).scripts?.regen ?? ''
    if (/\bdedupe\b/.test(regenScript)) {
      const d = await run('pnpm', ['dedupe'], {
        cwd: p.dir,
        log: join(out, `dedupe-${p.slug}.log`),
      })
      if (d.code !== 0) {
        throw new Error(`pnpm dedupe failed (exit ${d.code})`)
      }
    }
    ok = true
  } catch (e) {
    if (oldLock != null && !existsSync(lockFile)) {
      writeFileSync(lockFile, oldLock)
    }
    if (moved && !existsSync(modLock)) {
      copyFileSync(aside, modLock)
    }
    finish(EXIT.cannotRun, `regeneration of ${p.rel} failed: ${e.message}`)
  } finally {
    if (moved && ok) {
      rmSync(aside, { force: true })
    }
  }
  const now = read(lockFile)
  const expectMoves =
    p.bumps.length ||
    p.overrides.length ||
    p.excludeAdd.length ||
    p.pnpmTarget ||
    p.plan.regen.length ||
    p.plan.overrideMoves.length
  if (now === headLock && expectMoves) {
    finish(
      EXIT.cannotRun,
      `the lockfile of ${p.rel} is identical to HEAD although the plan moves packages: the regeneration did not run`
    )
  }
  // Each applied bump must be in the new lockfile.
  const lock = parseLock(now)
  p.missing = p.bumps.filter((b) => !lock.get(b.name)?.has(b.to))
}

// --- 6. lockfile review -----------------------------------------------------------

// Open-PR mode: the exclude entries that an earlier run of this script added. Only the
// entries that its own `chore: allow …` commits (on BASE, not on origin/main) added are
// trusted; any other new entry on the branch is a STOP. Each trusted entry that is still
// younger than the gate is checked again: advisories (the version and the package),
// publisher, install scripts and provenance source. Any flag is a STOP.
async function trustEarlierExcludes(projects, wt) {
  const stop = []
  for (const p of projects) {
    const where = p.rel === '.' ? '' : ` (${p.rel})`
    const path = `${p.rel === '.' ? '' : `${p.rel}/`}pnpm-workspace.yaml`
    const at = async (ref) =>
      yamlList(
        (await git(wt, ['show', `${ref}:${path}`])).out,
        'minimumReleaseAgeExclude'
      )
    const log = (
      await must(
        'git',
        ['log', '--format=%H%x09%s', `origin/main..${R.base}`, '--', path],
        { cwd: wt }
      )
    )
      .split('\n')
      .filter(Boolean)
    const commits = []
    for (const line of log) {
      const [sha, subject] = line.split('\t')
      if (!subject.startsWith('chore: allow ')) {
        continue
      }
      const before = new Set(await at(`${sha}^`))
      commits.push({
        subject,
        added: (await at(sha)).filter((x) => !before.has(x)),
      })
    }
    const { trusted, untrusted } = earlierExcludes({
      baseEntries: await at(R.base),
      mainEntries: await at('origin/main'),
      commits,
    })
    const removed = new Set(p.removedReal ?? [])
    for (const x of untrusted.filter((e) => !removed.has(e))) {
      stop.push(
        `exclude entry${where} that no "chore: allow" commit of this script added: ${x}`
      )
    }
    p.earlier = trusted.filter((e) => !removed.has(e))
    const minAgeMs = p.plan.minAgeHours * 3600000
    const flags = await pool(p.earlier, 3, (spec) =>
      recheckEarlier(spec, minAgeMs, p.dir)
    )
    stop.push(...flags.flat().map((f) => `earlier fast-track${where}: ${f}`))
  }
  if (stop.length) {
    R.lockfile = { majors: [], singleCopy: [], added: 0, stop }
    finish(
      EXIT.lockfileStop,
      `exclude entries of the PR branch cannot be trusted: ${stop.join('; ')}`
    )
  }
}

async function recheckEarlier(spec, minAgeMs, cwd) {
  const name = specName(spec)
  const version = spec.slice(name.length + 1)
  const view = await npmView(name, cwd)
  const iso = view?.time?.[version]
  if (!iso) {
    return [`${spec}: registry data unavailable, cannot check`]
  }
  const nowMs = Date.now()
  if (nowMs - Date.parse(iso) >= minAgeMs) {
    return [] // aged out: the gate covers it now
  }
  const never = () => false
  const ref =
    pickAgedTarget(
      view,
      '0.0.0',
      minAgeMs,
      nowMs,
      never,
      (v) => cmpRaw(v, version) < 0
    ) ?? pickAgedTarget(view, '0.0.0', minAgeMs, nowMs, never)
  if (!ref) {
    return [`${spec}: no aged version to compare with`]
  }
  const fields = ['_npmUser', 'scripts', 'dist.attestations']
  const [f, b, adv, pkgRes] = await Promise.all([
    npmViewFields(spec, fields, cwd),
    npmViewFields(`${name}@${ref}`, fields, cwd),
    advisoriesFor(name, version),
    packageMalwareFor(name),
  ])
  const refHas = !!b?.['dist.attestations']
  const freshHas = !!f?.['dist.attestations']
  const [ri, fi] = await Promise.all([
    refHas ? provenanceOf(name, ref) : null,
    refHas && freshHas ? provenanceOf(name, version) : null,
  ])
  return recheckFlags(spec, {
    f,
    b,
    adv,
    pkg: pkgRes.error ? null : malwareCoveringAny(pkgRes.list, name, [version]),
    prov: provenanceVerdict(
      spec,
      { has: refHas, info: ri },
      { has: freshHas, info: fi }
    ),
  })
}

async function lockfileReview(projects, wt, out) {
  const majors = list(values['expect-majors'])
  if (R.mode === 'open-pr') {
    await trustEarlierExcludes(projects, wt)
  }
  const reports = await pool(projects, 2, async (p) => {
    const approved = [...new Set([...p.excludeAdd, ...(p.earlier ?? [])])]
    const args = [join(HERE, 'lockfile-report.mjs'), '--root', p.dir]
    if (approved.length) {
      args.push('--approved', approved.join(','))
    }
    if (majors.length) {
      args.push('--expect-majors', majors.join(','))
    }
    if (R.base) {
      args.push(`--base=${R.base}`)
    }
    const r = await run('node', args, { cwd: p.dir })
    writeFileSync(join(out, `lockfile-${p.slug}.json`), r.out)
    writeFileSync(join(out, `lockfile-${p.slug}.md`), r.err)
    if (r.code !== 0) {
      finish(
        EXIT.cannotRun,
        `lockfile-report failed for ${p.rel}: ${r.err.trim().split('\n').slice(-3).join(' | ')}`
      )
    }
    return { p, rep: JSON.parse(r.out) }
  })
  const stop = []
  for (const { p, rep } of reports) {
    const where = p.rel === '.' ? '' : ` (${p.rel})`
    for (const j of rep.unexpectedMajors) {
      stop.push(
        `major jump${where}: ${j.name} ${j.from.join('/')} → ${j.to.join('/')}${j.causes?.length ? ` (from ${j.causes.join('; ')})` : ''}`
      )
    }
    for (const s of rep.singleCopy.filter((x) => x.status === 'new-split')) {
      stop.push(`new split${where}: ${s.name} ${s.instances.join(', ')}`)
    }
    for (const x of rep.unapprovedExcludes) {
      stop.push(`unapproved exclude entry${where}: ${x}`)
    }
    for (const f of rep.freshThirdParty) {
      stop.push(
        `fresh version${where}: ${f.name}@${f.version} (${f.ageHours}h)`
      )
    }
    for (const f of rep.ageUnknown) {
      stop.push(`age unknown${where}: ${f.name}@${f.version}`)
    }
    if (rep.pnpm?.fresh) {
      stop.push(`fresh pnpm${where}: ${rep.pnpm.fresh.version}`)
    }
    for (const b of p.missing ?? []) {
      stop.push(`applied bump not in the lockfile${where}: ${b.name}@${b.to}`)
    }
  }
  const root = reports[0].rep
  R.lockfile = {
    majors: reports.flatMap(({ rep }) =>
      rep.majorJumps.map(
        (j) => `${j.name} ${j.from.join('/')} → ${j.to.join('/')}`
      )
    ),
    singleCopy: root.singleCopy.map(
      (s) =>
        `${s.name} ${s.versions.join('/')}${s.status === 'single' ? '' : ` (${s.status})`}`
    ),
    added: reports.reduce((n, { rep }) => n + rep.added.length, 0),
    stop,
  }
  if (stop.length) {
    finish(
      EXIT.lockfileStop,
      `lockfile STOP: ${stop.length} item(s): ${stop.join('; ')}`
    )
  }
}

// --- 7. changeset -----------------------------------------------------------------

function writeChangeset(wt, root) {
  if (!existsSync(join(wt, '.changeset', 'config.json'))) {
    return null
  }
  const applied = new Set(root.bumps.map((b) => `${b.name}@${b.to}`))
  const updates = []
  for (const [pkg, lines] of Object.entries(root.plan.changeset)) {
    for (const l of lines) {
      const c = parseChangesetLine(l)
      if (c && applied.has(`${c.dep}@${c.version}`)) {
        updates.push({ pkg, dep: c.dep, version: c.version })
      }
    }
  }
  for (const b of root.bumps.filter((x) => x.fastTrack)) {
    for (const pkg of b.changesetPackages ?? []) {
      updates.push({ pkg, dep: b.name, version: b.to })
    }
  }
  if (!updates.length) {
    return null
  }
  let file = join(wt, '.changeset', `bump-packages-${DATE}.md`)
  for (let n = 2; existsSync(file); n++) {
    file = join(wt, '.changeset', `bump-packages-${DATE}-${n}.md`)
  }
  writeFileSync(file, changesetText(updates))
  return file
}

// --- 8. checks ----------------------------------------------------------------------

async function checks(wt, projects, out) {
  const pkg = JSON.parse(read(join(wt, 'package.json')))
  const has = (s) => !!pkg.scripts?.[s]
  const logOf = (name) =>
    join(out, `check-${name.replace(/[^\w.-]+/g, '-')}.log`)
  const record = (name, r) => {
    R.checks.push({
      name,
      ok: r.code === 0,
      seconds: r.seconds,
      log: logOf(name),
    })
    return r.code === 0
  }
  if (has('build')) {
    const b = await run('pnpm', ['build'], { cwd: wt, log: logOf('build') })
    if (!record('build', b)) {
      return false
    }
  }
  const tasks = []
  const add = (name, fn) => tasks.push({ name, fn })
  const pnpmTask = (name, args, cwd = wt) =>
    add(name, () => run('pnpm', args, { cwd, log: logOf(name) }))
  if (has('check')) {
    pnpmTask('check', ['check'])
  }
  if (has('check:types')) {
    pnpmTask('check:types', ['-r', '--parallel', '--no-bail', 'check:types'])
  }
  if (has('check:circular-deps')) {
    pnpmTask('check:circular-deps', ['check:circular-deps'])
  }
  if (has('knip:check')) {
    pnpmTask('knip:check', ['knip:check'])
  }
  const testScript = has('test:unit')
    ? 'test:unit'
    : has('test')
      ? 'test'
      : null
  if (testScript) {
    add(testScript, async () => {
      const r = await run('pnpm', [testScript], {
        cwd: wt,
        log: logOf(testScript),
      })
      // One retry: a parallel vitest run can fail once with ENOTEMPTY on its cache.
      return r.code === 0
        ? r
        : run('pnpm', [testScript], { cwd: wt, log: logOf(testScript) })
    })
  }
  pnpmTask('dedupe --check', ['dedupe', '--check'])
  if (existsSync(join(wt, 'scripts', 'size-measure.mjs'))) {
    add('size-measure', () =>
      run('node', ['scripts/size-measure.mjs', '.', join(out, 'size.json')], {
        cwd: wt,
        log: logOf('size-measure'),
      })
    )
  }
  for (const p of projects.slice(1)) {
    add(`${p.rel}: install + tsc`, async () => {
      const name = `${p.rel}: install + tsc`
      const i = await run('pnpm', ['install', '--frozen-lockfile'], {
        cwd: p.dir,
        log: logOf(`${name}-install`),
      })
      if (i.code !== 0) {
        return i
      }
      const pj = JSON.parse(read(join(p.dir, 'package.json')))
      if (!pj.dependencies?.typescript && !pj.devDependencies?.typescript) {
        return i
      }
      const t = await run('pnpm', ['exec', 'tsc', '--noEmit'], {
        cwd: p.dir,
        log: logOf(name),
      })
      return { ...t, seconds: Math.round((i.seconds + t.seconds) * 10) / 10 }
    })
  }
  const results = await pool(tasks, 3, (t) => t.fn())
  let ok = true
  tasks.forEach((t, i) => {
    ok = record(t.name, results[i]) && ok
  })
  return ok
}

async function restoreVersionFiles(wt) {
  const files = (await git(wt, ['ls-files', '*version.ts'])).out
    .split('\n')
    .filter(Boolean)
  if (files.length) {
    await git(wt, ['restore', '--', ...files])
  }
}

// --- 9. commits ---------------------------------------------------------------------

// The hard guard before every commit and the push: the worktree is on the bump branch,
// the branch is a bump branch and not the default branch, and it is not the main checkout.
async function assertBumpBranch(wt) {
  const cur = (
    await must('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt })
  ).trim()
  const why =
    cur !== R.branch
      ? `the worktree is on ${cur}, not on ${R.branch}`
      : branchGuard({
          branch: R.branch,
          defaultBranch: R.defaultBranch,
          worktree: realpathSync(wt),
          mainCheckout: R.mainCheckout,
        })
  if (why) {
    finish(EXIT.cannotRun, `refused before a commit or a push: ${why}`)
  }
}

async function commitAll(wt, projects) {
  await assertBumpBranch(wt)
  const status = await must('git', ['status', '--porcelain', '-uall'], {
    cwd: wt,
  })
  const files = status
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''))
  const rel = (abs) => abs.slice(wt.length + 1)
  const excludeAddFiles = projects
    .filter((p) => p.yamlAddsOnly)
    .map((p) => rel(p.yamlFile))
  const pmProjects = projects.filter((p) => p.pmFile)
  const { commits, unexpected } = groupCommits(files, {
    excludeAddFiles,
    packageManagerFiles: pmProjects.map((p) => rel(p.pmFile)),
    pnpmTarget: projects[0].pnpmTarget ?? null,
  })
  R.uncommitted = unexpected
  const bodies = {
    excludes: `Exact entries past the release-age gate (${excludeReason()}): ${[...new Set(projects.flatMap((p) => p.excludeAdd))].map(tick).join(', ')}.`,
    bump: `${R.applied.bumps.length} patch and minor bumps, ${R.applied.overrides.length} override updates, ${R.applied.removedExcludes.length} aged-out exclude entries removed.`,
    ci: [
      ...R.applied.actions.map((a) => `${tick(a.repo)} ${a.to}`),
      ...R.applied.tools.map((t) => `${tick(t.pkg)} ${t.to}`),
    ].join(', '),
    lockfile: 'Regenerated from scratch under the 24 h release-age gate.',
  }
  for (const c of commits) {
    // Two commits share files: write the in-between state, commit, then the final state.
    const restore = []
    if (c.id === 'excludes') {
      for (const p of projects.filter((x) => x.yamlAddsOnly)) {
        restore.push([p.yamlFile, read(p.yamlFile)])
        writeFileSync(p.yamlFile, p.yamlAddsOnly)
      }
    }
    if (c.id === 'bump') {
      for (const p of pmProjects) {
        const now = read(p.pmFile)
        restore.push([p.pmFile, now])
        writeFileSync(p.pmFile, setPackageManager(now, p.pmOld))
      }
    }
    await must('git', ['add', '--', ...c.files], { cwd: wt })
    for (const [f, text] of restore) {
      writeFileSync(f, text)
    }
    if (await gitOk(wt, ['diff', '--cached', '--quiet'])) {
      continue // nothing staged for this group
    }
    await must(
      'git',
      [
        'commit',
        '--no-verify',
        '-m',
        c.message,
        '-m',
        wrapLines(bodies[c.id] || c.message),
      ],
      { cwd: wt }
    )
    const sha = (await must('git', ['rev-parse', 'HEAD'], { cwd: wt })).trim()
    R.commits.push({ sha, message: c.message, files: c.files })
  }
}

// --- 10. push and PR ----------------------------------------------------------------

async function pushAndPr(wt, ghRepo, out) {
  const body = join(out, 'pr-body.md')
  if (R.mode === 'open-pr') {
    const old = await must(
      'gh',
      [
        'pr',
        'view',
        String(R.pr),
        '--repo',
        ghRepo,
        '--json',
        'body',
        '-q',
        '.body',
      ],
      { cwd: wt }
    )
    writeFileSync(
      body,
      `${old.trimEnd()}\n\n## Run ${STAMP}\n\n${prRunSection(R)}\n`
    )
  } else {
    writeFileSync(body, prBody(R))
  }
  if (values['no-push']) {
    R.notes.push(`--no-push: nothing pushed. The PR text is in ${body}.`)
    return
  }
  await assertBumpBranch(wt)
  await must('git', ['push', '-u', 'origin', `HEAD:refs/heads/${R.branch}`], {
    cwd: wt,
  })
  if (R.mode === 'open-pr') {
    await must(
      'gh',
      ['pr', 'edit', String(R.pr), '--repo', ghRepo, '--body-file', body],
      { cwd: wt }
    )
  } else {
    const url = await must(
      'gh',
      [
        'pr',
        'create',
        '--repo',
        ghRepo,
        '--base',
        'main',
        '--head',
        R.branch,
        '--title',
        'chore: bump packages',
        '--body-file',
        body,
      ],
      { cwd: wt }
    )
    R.pr = url.trim()
  }
}

// --- main ---------------------------------------------------------------------------------

async function main() {
  if (!values.repo) {
    process.stderr.write(USAGE)
    process.exit(EXIT.cannotRun)
  }
  const approve = new Set(list(values.approve))
  const bad = invalidExcludeEntries([...approve])
  if (bad.length) {
    finish(
      EXIT.cannotRun,
      `--approve takes exact name@x.y.z entries only: ${bad.join(', ')}`
    )
  }
  const out = resolve(
    values.out ??
      join(
        tmpdir(),
        `bump-${basename(resolve(values.repo))}-${DATE}-${Date.now()}`
      )
  )
  mkdirSync(out, { recursive: true })
  R.out = out
  const t0 = Date.now()

  const { ghRepo, wt } = await step('git', setupGit)
  await step('install', async () => {
    const r = await run('pnpm', ['install', '--frozen-lockfile'], {
      cwd: wt,
      log: join(out, 'install.log'),
    })
    if (r.code !== 0) {
      if (!R.lockfileFromMain) {
        finish(
          EXIT.cannotRun,
          `pnpm install --frozen-lockfile failed; see ${join(out, 'install.log')}`
        )
      }
      // origin/main's lockfile does not match the branch manifests: step 5 regenerates it.
      await must('pnpm', ['install'], {
        cwd: wt,
        log: join(out, 'install-2.log'),
      })
    }
  })
  const [projects, auditBefore] = await step('analyze', () =>
    Promise.all([analyze(wt, out), R.dryRun ? null : audit(wt)])
  )
  R.audit.before = auditBefore
  await step('decide', () => decide(projects, approve))
  if (R.dryRun) {
    R.timings.total = Math.round((Date.now() - t0) / 100) / 10
    finish(EXIT.ok, 'dry run: the plan above, nothing changed')
  }
  const headLocks = new Map()
  await step('edit', async () => {
    R.applied.removedExcludes = []
    for (const p of projects) {
      headLocks.set(
        p.rel,
        (
          await git(wt, [
            'show',
            `HEAD:${p.rel === '.' ? '' : `${p.rel}/`}pnpm-lock.yaml`,
          ])
        ).out
      )
      editManifests(p)
      editWorkspaceYaml(p)
      await setPnpm(p)
    }
    const root = projects[0]
    if (R.applied.actions.length || R.applied.tools.length) {
      const args = [
        join(HERE, 'analyze-toolchain.mjs'),
        '--root',
        wt,
        '--apply',
        root.tcPath,
      ]
      if (R.applied.actions.length) {
        args.push('--actions', R.applied.actions.map((a) => a.repo).join(','))
      }
      if (R.applied.tools.length) {
        args.push('--tools', R.applied.tools.map((t) => t.pkg).join(','))
      }
      const res = JSON.parse(await must('node', args, { cwd: wt }))
      for (const part of [res.actions, res.tools].filter(Boolean)) {
        for (const m of part.missing ?? []) {
          R.decisions.push({
            kind: 'not applied',
            project: '.',
            name: m,
            detail: 'The toolchain apply step did not find it.',
          })
        }
        for (const s of part.skipped ?? []) {
          R.decisions.push({
            kind: 'check by hand',
            project: '.',
            name: s,
            detail: 'The line has a version that the script cannot read.',
          })
        }
      }
    }
  })
  await step('regen', async () => {
    for (const p of projects) {
      await regen(p, out, headLocks.get(p.rel))
    }
  })
  await step('lockfile', () => lockfileReview(projects, wt, out))
  await step('changeset', () => writeChangeset(wt, projects[0]))
  const ok = await step('checks', () => checks(wt, projects, out))
  await restoreVersionFiles(wt)
  if (!ok) {
    const failed = R.checks.filter((c) => !c.ok)
    for (const c of failed) {
      const tail = (read(c.log) ?? '')
        .trimEnd()
        .split('\n')
        .slice(-40)
        .join('\n')
      process.stderr.write(`\n### FAILED: ${c.name} (${c.log})\n\n${tail}\n`)
    }
    finish(
      EXIT.checkFailed,
      `${failed.length} check(s) failed: ${failed.map((c) => c.name).join(', ')}`
    )
  }
  R.audit.after = await step('audit', () => audit(wt))
  await step('commit', () => commitAll(wt, projects))
  if (!R.commits.length && !R.mergedMain) {
    R.timings.total = Math.round((Date.now() - t0) / 100) / 10
    finish(EXIT.ok, 'nothing to bump')
  }
  await step('push', () => pushAndPr(wt, ghRepo, out))
  R.timings.total = Math.round((Date.now() - t0) / 100) / 10
  finish(
    EXIT.ok,
    values['no-push'] ? 'committed, not pushed (--no-push)' : 'done'
  )
}

main().catch((e) => finish(EXIT.cannotRun, `unexpected error: ${e.stack ?? e}`))
