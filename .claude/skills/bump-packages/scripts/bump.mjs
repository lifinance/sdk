#!/usr/bin/env node
// bump.mjs — the bump-packages skill in one run. The model reads only the summary: the
// applied bumps and three lists (needs the user, not applied by the script, waiting or
// held), and a `Rerun:` line.
//
//   1. git: fetch; continue the local worktree of the open bump PR (never content that
//      only origin has), or --worktree, or a new worktree and branch from origin/main;
//      merge origin/main; check the release-age gate of each pnpm-workspace.yaml.
//   2. pnpm install --frozen-lockfile (once more without it if that fails); pnpm audit.
//   3. analyze-outdated + analyze-toolchain for the root and each extra pnpm project.
//   4. decide: safe bumps, auto (and --approve) fast-tracks, --majors, lift/floor
//      override updates, stale excludes, safe actions and tools, a non-major pnpm update.
//   5. regenerate each lockfile once. Nothing changed: stop here (nothing to bump).
//   6. lockfile-report (STOP = exit 3, nothing committed).
//   7. one changeset file.
//   8. the checks once (a failure = exit 4, nothing committed; a baseline run says if it
//      is a regression).
//   9. commits with --no-verify (step 8 ran the hook checks), the lockfile commit last.
//  10. push and open the PR, or update the generated block of the open PR.
//
// Output: JSON on stdout and in <out>/result.json, a summary on stderr.
// Exit codes: 0 done or nothing to bump, 2 cannot run, 3 lockfile STOP, 4 a check failed.

import { execFileSync, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
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
  addFastTrackBump,
  appliedLines,
  branchExcludes,
  branchGuard,
  bumpSpec,
  changesetText,
  checkText,
  editExcludesDetailed,
  EXIT,
  fitPrBlock,
  groupCommits,
  lockstepKey,
  lockstepWaits,
  majorLine,
  majorTargets,
  mergeItems,
  newPrBody,
  ownReasons,
  packageManagerValue,
  parseChangesetLine,
  pickBumpPr,
  plain,
  prBlock,
  replaceOverride,
  replacePrBlock,
  reuseChangesets,
  setDependencySpec,
  setPackageManager,
  terminalText,
  wrapLines,
} from './bump-helpers.js'
import {
  classify,
  gateYamlProblem,
  invalidExcludeEntries,
  minAgeMinutesFromYaml,
  npmView,
  npmViewFields,
  parseLock,
  pool,
  registryVersionDoc,
  specName,
  yamlList,
  yamlMap,
} from './lib.js'
import {
  advisoriesFor,
  approvalObstacles,
  checkExactEntry,
  familyKeyOf,
  malwareCoveringAny,
  META_FIELDS,
  packageMalwareFor,
  provenanceOf,
  referenceVersion,
} from './security.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = `Usage: node bump.mjs --repo <main checkout> [options]

  --dry-run                 analyze and print the plan; change nothing
  --approve a@1.2.3,...     exact fresh versions that the user approved
  --majors a,b              majors that the user approved
  --skip-check a,b          accept a failure of these checks when main fails them too
  --worktree <path>         continue in this bump worktree (no PR yet)
  --no-push                 commit, but do not push or open or edit a PR
  --out <dir>               the folder for logs and the result (default: a temporary folder)
  --help                    show this text

Exit codes: 0 done or nothing to bump, 2 cannot run, 3 lockfile STOP, 4 a check failed.
`
let values
try {
  ;({ values } = parseArgs({
    options: {
      repo: { type: 'string' },
      'dry-run': { type: 'boolean' },
      approve: { type: 'string', multiple: true },
      majors: { type: 'string', multiple: true },
      'skip-check': { type: 'string', multiple: true },
      worktree: { type: 'string' },
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
// L1: a flag can repeat; its values are merged.
const list = (v) => [
  ...new Set(
    (v ?? [])
      .flatMap((x) => x.split(','))
      .map((x) => x.trim())
      .filter(Boolean)
  ),
]
const APPROVE = list(values.approve)
const MAJORS = list(values.majors)
const SKIP = list(values['skip-check'])
// L2: `--majors name` or `name@<major>` (`zustand@6`, `@scope/x@0.5`): name → pin or null.
const MAJOR_PINS = new Map(
  MAJORS.map((m) => {
    const at = m.lastIndexOf('@')
    return at > 0 ? [m.slice(0, at), m.slice(at + 1)] : [m, null]
  })
)

const ENV = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
const pad = (n) => String(n).padStart(2, '0')
const NOW = new Date()
const DATE = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}`

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
    majors: [],
    fastTracks: [],
    approved: [],
    overrides: [],
    removedExcludes: [],
    actions: [],
    tools: [],
    pnpm: null,
  },
  // The three lists (B1): { name, project, text, flag? }.
  needsUser: [],
  notApplied: [],
  waiting: [],
  lockfile: null,
  checks: [],
  acceptedChecks: [],
  audit: { before: null, after: null },
  timings: {},
  notes: [],
  uncommitted: [],
  out: null,
  rerun: null,
}

const sq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`

// The command for the next run (A6): the same approvals, and --worktree when the run was
// in new mode and its worktree stays.
function rerunCommand() {
  const args = [
    'node',
    sq(join(HERE, 'bump.mjs')),
    '--repo',
    sq(resolve(values.repo)),
  ]
  if (R.mode === 'new' && R.worktreeKept) {
    args.push('--worktree', sq(R.worktree))
  }
  for (const [flag, v] of [
    ['--approve', APPROVE],
    ['--majors', MAJORS],
    ['--skip-check', SKIP],
  ]) {
    if (v.length) {
      args.push(flag, v.join(','))
    }
  }
  if (values['no-push']) {
    args.push('--no-push') // L1
  }
  return args.join(' ')
}

// The last `n` lines of a text (K3), or one line joined with " | ".
const tail = (text, n) =>
  String(text ?? '')
    .trimEnd()
    .split('\n')
    .slice(-n)
    .join('\n')
const tailLine = (text, n = 3) =>
  tail(String(text ?? '').trim(), n).replaceAll('\n', ' | ')

// True when the worktree exists and has uncommitted changes (M1).
function hasChanges(wt) {
  try {
    return !!execFileSync('git', ['status', '--porcelain'], {
      cwd: wt,
      encoding: 'utf8',
    }).trim()
  } catch {
    return false
  }
}

const item = (i) =>
  `- ${i.name}${i.project && i.project !== '.' ? ` (${i.project})` : ''}: ${i.text}${i.flag ? ` Apply: ${i.flag}` : ''}`

function summary(code, message) {
  const out = []
  const w = (s = '') => out.push(s)
  w(`\n## bump.mjs: ${message}\n`)
  w(
    `- Mode: ${R.mode ?? '?'}${R.dryRun ? ' (dry run)' : ''}; worktree: ${R.worktree ?? '?'}${R.worktreeRemoved ? ' (removed)' : ''}; branch: ${R.branch ?? '?'}${typeof R.pr === 'string' ? `; PR: ${R.pr}` : R.pr ? `; PR #${R.pr}` : ''}`
  )
  const a = R.applied
  w(
    `- Applied: ${a.bumps.length} bumps (${a.fastTracks.length} fast-tracks), ${a.majors.length} majors, ${a.overrides.length} override updates, ${a.removedExcludes.length} stale excludes removed, ${a.actions.length} actions, ${a.tools.length} CI tools${a.pnpm ? `, pnpm ${a.pnpm.from} → ${a.pnpm.to}` : ''}`
  )
  w(
    `- Needs the user: ${R.needsUser.length}, not applied: ${R.notApplied.length}, waiting or held: ${R.waiting.length}`
  )
  // G3, M6: every applied item, one line each (the model reads this on exit 4).
  const lines = appliedLines(a)
  for (const l of lines.slice(0, 30)) {
    w(`  - ${l}`)
  }
  if (lines.length > 30) {
    w(`  - … and ${lines.length - 30} more (see the JSON)`)
  }
  w(
    `- Commits: ${R.commits.length ? R.commits.map((c) => `${c.sha.slice(0, 9)} ${c.message}`).join('; ') : 'none'}`
  )
  if (R.checks.length) {
    w(`- Checks: ${R.checks.map(checkText).join(', ')}`)
    // M7: the command that reproduces each failed check in the worktree.
    for (const c of R.checks.filter((x) => !x.ok && !x.notRun)) {
      w(`  Reproduce ${c.name}: ${c.cmd}`)
    }
  }
  for (const [title, items] of [
    ['Needs the user', R.needsUser],
    ['Not applied by the script', R.notApplied],
    ['Waiting or held', R.waiting],
  ]) {
    if (items.length) {
      w(`\n### ${title} (${items.length})\n`)
      out.push(...items.map(item))
    }
  }
  if (R.notes.length || R.uncommitted.length) {
    w('')
  }
  for (const n of R.notes) {
    w(`- Note: ${n}`)
  }
  if (R.uncommitted.length) {
    w(`- Not committed (unexpected changes): ${R.uncommitted.join(', ')}`)
  }
  // G4: the files this run left.
  if (R.out) {
    const failed = R.checks.filter((c) => !c.ok).map((c) => c.log)
    w(
      `\nFiles: ${R.out} (logs); ${join(R.out, 'result.json')} (the JSON)${failed.length ? `; failed checks: ${failed.join(', ')}` : ''}`
    )
  }
  w(
    `Timings: ${Object.entries(R.timings)
      .map(([k, v]) => `${k} ${v}s`)
      .join(', ')}`
  )
  // M1: every exit after the edit step leaves changes: print how to discard them.
  if (code !== EXIT.ok && R.dirtied && hasChanges(R.worktree)) {
    // F3: discard only the uncommitted changes; keep a fix commit and a merge commit.
    w(
      `\n${R.mergeCommit ? `The run made one local commit, the merge of origin/main (${R.mergeCommit.slice(0, 9)}); the next run pushes it. Nothing else` : 'Nothing'} was committed. The worktree has the changes. To discard them:\n  git -C ${sq(R.worktree)} reset --hard HEAD && git -C ${sq(R.worktree)} clean -fd -- .changeset`
    )
  }
  w(`\nRerun: ${R.rerun}\n`)
  process.stderr.write(`${terminalText(out.join('\n'))}\n`)
}

// Synchronous cleanups that run on every exit and on a signal (the temporary worktree, the
// moved node_modules/.pnpm/lock.yaml). The running child processes, for a signal.
const CLEANUPS = new Set()
const CHILDREN = new Set()

function runCleanups() {
  for (const fn of [...CLEANUPS].reverse()) {
    CLEANUPS.delete(fn)
    try {
      fn()
    } catch (e) {
      R.notes.push(`cleanup failed: ${e.message}`)
    }
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const c of CHILDREN) {
      c.kill('SIGTERM')
    }
    runCleanups()
    process.stderr.write(`\nbump.mjs: stopped by ${sig}; cleanups done.\n`)
    process.exit(130)
  })
}

function finish(code, message) {
  runCleanups()
  R.exit = code
  R.message = message
  R.rerun = rerunCommand()
  const json = `${JSON.stringify(R, null, 2)}\n`
  if (R.out) {
    try {
      writeFileSync(join(R.out, 'result.json'), json) // G4: never lost
    } catch {}
  }
  process.stdout.write(json)
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
    CHILDREN.add(child)
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
      CHILDREN.delete(child)
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
      `${what ?? `${cmd} ${args.join(' ')}`} failed (exit ${r.code}): ${tailLine(r.err || r.out, 5)}`
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
  const { pr: openPr, all, rejected } = pickBumpPr(prs, ghRepo.split('/')[0])
  for (const r of rejected) {
    R.notes.push(`Open PR #${r.number} is not reused: ${r.why}.`)
  }
  if (all.length > 1) {
    finish(
      EXIT.cannotRun,
      `more than one open bump PR: ${all.map((p) => `#${p.number} (${p.headRefName})`).join(', ')}. Close all but one, then run again.`
    )
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
      // New mode checks before `git worktree add`: the path does not exist yet.
      worktree:
        R.worktree &&
        (existsSync(R.worktree)
          ? realpathSync(R.worktree)
          : resolve(R.worktree)),
      mainCheckout: R.mainCheckout,
    })
    if (why) {
      finish(EXIT.cannotRun, `refused: ${why}`)
    }
  }
  const base = `${repo}/.claude/worktrees`
  // The script only runs code from origin/main or from this machine: it continues only a
  // local worktree (the open PR's, or --worktree) whose HEAD contains origin/<branch>.
  const real = (p) => (p && existsSync(p) ? realpathSync(p) : null)
  let cont = null
  if (values.worktree) {
    const want = real(resolve(values.worktree))
    const w = want && worktrees.find((x) => real(x.path) === want)
    if (!w || real(w.path) === R.mainCheckout) {
      finish(
        EXIT.cannotRun,
        `--worktree ${values.worktree} is not a bump worktree of ${repo}`
      )
    }
    const branch = w.branch?.replace(/^refs\/heads\//, '') ?? null
    if (openPr && openPr.headRefName !== branch) {
      finish(
        EXIT.cannotRun,
        `--worktree is on ${branch ?? 'a detached HEAD'}, but the open bump PR #${openPr.number} is on ${openPr.headRefName}. Continue that PR (run without --worktree), or close it.`
      )
    }
    cont = { wt: want, branch, pr: openPr }
  } else if (openPr) {
    const w = worktrees.find(
      (x) => x.branch === `refs/heads/${openPr.headRefName}`
    )
    if (w) {
      cont = { wt: w.path, branch: openPr.headRefName, pr: openPr }
    } else if (!R.dryRun) {
      finish(
        EXIT.cannotRun,
        `open bump PR #${openPr.number} (${openPr.headRefName}) has no worktree on this machine. The script does not run remote branch content. Review PR #${openPr.number}, then run: git -C ${sq(repo)} worktree add ${sq(`${base}/bump-pr${openPr.number}`)} ${openPr.headRefName} — and run the script again.`
      )
    } else {
      R.notes.push(
        `Open bump PR #${openPr.number} exists, but it has no worktree on this machine; this plan is against origin/main.`
      )
    }
  }
  if (cont) {
    const wt = cont.wt
    R.mode = cont.pr ? 'open-pr' : 'new'
    R.pr = cont.pr?.number ?? null
    R.branch = cont.branch
    R.worktree = wt
    R.worktreeKept = true
    guard()
    const st = await must('git', ['status', '--porcelain'], { cwd: wt })
    if (st.trim()) {
      finish(EXIT.cannotRun, `the worktree is not clean: ${wt}`)
    }
    R.headBefore = (
      await must('git', ['rev-parse', 'HEAD'], { cwd: wt })
    ).trim()
    const remote = `origin/${cont.branch}`
    R.base = (await gitOk(wt, ['rev-parse', '--verify', '--quiet', remote]))
      ? remote
      : null
    if (cont.pr && !R.base) {
      finish(EXIT.cannotRun, `${remote} does not exist after the fetch`)
    }
    // Never fast-forward or merge from the remote branch: a person reviews it first.
    if (
      R.base &&
      !(await gitOk(wt, ['merge-base', '--is-ancestor', R.base, 'HEAD']))
    ) {
      const ahead = (
        await git(wt, ['log', '--oneline', `HEAD..${R.base}`])
      ).out.trim()
      finish(
        EXIT.cannotRun,
        `The PR branch has commits that this checkout did not make:\n${ahead}\nShow them to the user. After the user has reviewed them: git -C ${sq(wt)} merge --ff-only ${R.base}`
      )
    }
    if (R.dryRun) {
      R.notes.push(
        'Dry run: the plan comes from the branch head; origin/main was not merged.'
      )
      return { repo, ghRepo, wt }
    }
    await mergeMain(wt)
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
    CLEANUPS.add(() => removeWorktree(repo, tmp))
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
  R.worktreeKept = true
  R.createdWorktree = true
  R.headBefore = (
    await must('git', ['rev-parse', 'HEAD'], { cwd: R.worktree })
  ).trim()
  R.base = null
  return { repo, ghRepo, wt: R.worktree }
}

// Merge origin/main into the branch (never rebase, never force). A conflict only in
// pnpm-lock.yaml takes main's lockfile (step 5 regenerates it); any other conflict is
// exit 2.
async function mergeMain(wt) {
  if (await gitOk(wt, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])) {
    return
  }
  const m = await run('git', ['merge', '--no-ff', '--no-edit', 'origin/main'], {
    cwd: wt,
  })
  if (m.code !== 0) {
    const conflicts = (
      await git(wt, ['diff', '--name-only', '--diff-filter=U'])
    ).out
      .split('\n')
      .filter(Boolean)
    if (
      !conflicts.length ||
      !conflicts.every((f) => /(^|\/)pnpm-lock\.yaml$/.test(f))
    ) {
      await git(wt, ['merge', '--abort'])
      finish(
        EXIT.cannotRun,
        `merging origin/main conflicts outside the lockfile: ${conflicts.join(', ') || m.err.trim()}. Merge by hand: git -C '${wt}' merge origin/main; resolve those files (for pnpm-lock.yaml take main's copy: git checkout --theirs pnpm-lock.yaml); commit the merge; then run again.`
      )
    }
    await must('git', ['checkout', '--theirs', '--', ...conflicts], { cwd: wt })
    await must('git', ['add', '--', ...conflicts], { cwd: wt })
    await must('git', ['commit', '--no-verify', '--no-edit'], { cwd: wt })
    R.notes.push(
      "The merge of origin/main had a conflict only in pnpm-lock.yaml: main's lockfile was taken, and the regeneration rewrites it."
    )
  }
  R.mergedMain = true
  R.mergeCommit = (await must('git', ['rev-parse', 'HEAD'], { cwd: wt })).trim()
  R.notes.push(
    `Merged origin/main into the branch (local merge commit ${R.mergeCommit.slice(0, 9)}).`
  )
}

// Before any install: each pnpm-workspace.yaml (root and extra projects) must keep the
// release-age gate of origin/main, in a form the scripts can read. A lower value, or a
// removed key, is exit 2: the branch must not lower the gate for itself.
async function checkGate(wt) {
  const isYaml = (f) => /(^|\/)pnpm-workspace\.yaml$/.test(f)
  const files = new Set(
    [
      ...(await must('git', ['ls-files', '*pnpm-workspace.yaml'], { cwd: wt }))
        .split('\n')
        .filter(isYaml),
      ...(await git(wt, ['ls-tree', '-r', '--name-only', 'origin/main'])).out
        .split('\n')
        .filter(isYaml),
    ].filter(Boolean)
  )
  for (const f of files) {
    const branch = read(join(wt, f)) ?? ''
    const main = (await git(wt, ['show', `origin/main:${f}`])).out
    for (const [where, text] of [
      ['worktree', branch],
      ['origin/main', main],
    ]) {
      const problem = gateYamlProblem(text)
      if (problem) {
        finish(EXIT.cannotRun, `${f} (${where}): ${problem}`)
      }
    }
    const has = (y) => /^minimumReleaseAge:/m.test(y)
    const [b, m] = [branch, main].map(minAgeMinutesFromYaml)
    if ((has(main) && !has(branch)) || b < m) {
      finish(
        EXIT.cannotRun,
        `${f} lowers the release-age gate: minimumReleaseAge ${has(branch) ? b : '(removed)'} on the branch, ${m} on origin/main. Restore it, then run again.`
      )
    }
  }
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
    const args = [join(HERE, `${script}.mjs`), '--root', p.dir]
    if (script === 'analyze-outdated') {
      // A11: the floor of an automatic fast-track (the config file can change it).
      args.push(
        '--fast-track-min-age-hours',
        String(CONFIG.fastTrackMinAgeHours ?? 6)
      )
    }
    const r = await run('node', args, { cwd: p.dir })
    const base = join(
      out,
      `${script === 'analyze-outdated' ? 'npm' : 'toolchain'}-plan-${p.slug}`
    )
    writeFileSync(`${base}.json`, r.out)
    if (r.code !== 0) {
      finish(
        EXIT.cannotRun,
        `${script} failed for ${p.rel} (exit ${r.code}): ${tailLine(r.err)}`
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

// The package name of a project folder (M3).
const nameOf = (root, w) =>
  JSON.parse(read(join(root, w, 'package.json')) ?? '{}').name

// --- 4. decide --------------------------------------------------------------------

// The first sentence of a comment or reason, at most 120 characters, without backticks.
const firstSentence = (s) => {
  const t = plain(s)
    .trim()
    .split(/(?<=[.!?])\s/)[0]
  return t.length > 120 ? `${t.slice(0, 117)}…` : t
}

// The reason of a hold without a first sentence that only says "Held at X." again.
const heldWhy = (reason) => {
  const t = (reason ?? '').replace(/^\s*held at \S+\.\s*/i, '')
  return t ? ` ${firstSentence(t)}` : ''
}

// Exit 2 when `--approve` cannot apply `what` (M2): a check without an answer ("run
// again"), or a flag that no approval overrides.
function refuseApproval(what, { blind, refused }) {
  if (blind.length) {
    finish(
      EXIT.cannotRun,
      `the checks for --approve ${what} gave no answer: ${blind.map(plain).join('; ')}. Run again.`
    )
  }
  if (refused.length) {
    finish(
      EXIT.cannotRun,
      `--approve cannot apply ${what}: ${refused.map(plain).join('; ')}. It lands through the normal gate when it ages.`
    )
  }
}

// The order of "needs the user": security findings, majors, approvals, blocked.
const NEEDS_ORDER = ['security', 'major', 'approve', 'blocked']

async function decide(projects) {
  const needs = (kind, project, name, text, flag = null) =>
    R.needsUser.push({ kind, project, name, text: plain(text), flag })
  const notApplied = (project, name, text) =>
    R.notApplied.push({ project, name, text: plain(text) })
  const waiting = (project, name, text) =>
    R.waiting.push({ project, name, text: plain(text) })
  const usedApprove = new Set()
  const familyEntries = new Set()
  const floor = CONFIG.fastTrackMinAgeHours ?? 6
  const usedHeld = new Set()
  // `name@<major>` of a major in the plan (the Apply hint and the group message, L2).
  const targets = new Map(
    projects.flatMap((p) => p.plan.needsApproval.map((e) => [e.name, e.target]))
  )
  const pinned = (n) =>
    targets.has(n) ? `${n}@${majorLine(targets.get(n))}` : n
  for (const p of projects) {
    const plan = p.plan
    p.bumps = []
    p.majors = []
    p.excludeAdd = []
    p.overrides = []
    for (const e of plan.safe) {
      p.bumps.push({
        name: e.name,
        where: e.where,
        from: e.current,
        to: e.target,
        bump: e.bumpType,
        kind: e.kind,
      })
      if (e.newDependencies === null) {
        notApplied(
          p.rel,
          e.name,
          `${e.target}: the new-dependency check failed. Check the target by hand.`
        )
      } else if (e.newDependencies?.length) {
        notApplied(
          p.rel,
          e.name,
          `${e.target} adds ${e.newDependencies.join(', ')} (an aged release gets no fast-track checks). Look at what it is.`
        )
      }
    }
    // Fast-tracks: one decision per family (references/fast-track.md).
    const ftNames = new Set()
    for (const fam of plan.fastTrackFamilies) {
      const members = plan.fastTrack.filter((c) =>
        fam.versions.includes(`${c.name}@${c.fresh}`)
      )
      for (const n of fam.members) {
        ftNames.add(n)
      }
      for (const x of fam.excludeSet) {
        familyEntries.add(x)
      }
      const set = fam.excludeSet
      const approved =
        fam.decision !== 'auto' &&
        set.length > 0 &&
        set.every((x) => APPROVE.includes(x))
      // M2 (F5): an approval overrides only no provenance, too young, and the flag kinds
      // new dependency / range / spec. A check without an answer, an advisory hit or a
      // compromise-class flag refuses it.
      const obstacles = approvalObstacles(
        fam.redFlags ?? [],
        fam.compromiseFlags ?? []
      )
      if (approved) {
        refuseApproval(fam.versions.join(', '), obstacles)
      }
      if (fam.decision === 'auto' || approved) {
        for (const x of set) {
          usedApprove.add(x)
        }
        p.excludeAdd.push(...set)
        if (approved && fam.redFlags?.length) {
          R.notes.push(
            plain(
              `Approved by the user with flags: ${fam.redFlags.join('; ')}.`
            )
          )
        }
        for (const c of members) {
          R.applied.fastTracks.push({
            project: p.rel,
            spec: `${c.name}@${c.fresh}`,
            ageHours: c.ageHours,
            excludeSet: c.excludeSet,
            approved,
          })
          if (c.skippedFlags?.length) {
            notApplied(
              p.rel,
              c.name,
              `newer fresh versions skipped: ${c.skippedFlags.join('; ')}.`
            )
          }
          if (c.bumpable) {
            p.bumps = addFastTrackBump(p.bumps, {
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
      const name = fam.members.join(' + ')
      const missing = set.filter((x) => !APPROVE.includes(x))
      const part =
        missing.length < set.length
          ? ` Only part of the set is approved; missing: ${missing.join(', ')}.`
          : ''
      const stuck = ownReasons(
        [...obstacles.blind, ...obstacles.refused],
        fam.versions
      )
      if (fam.decision === 'blocked' && stuck.length) {
        needs(
          'blocked',
          p.rel,
          name,
          `${fam.versions.join(', ')} is blocked: ${stuck.join('; ')}. It cannot be approved; it lands through the normal gate when it ages.`
        )
      } else if (fam.decision === 'blocked') {
        needs(
          'blocked',
          p.rel,
          name,
          `${fam.versions.join(', ')} is blocked: ${ownReasons(fam.redFlags, fam.versions).join('; ')}.${part}`,
          `--approve ${set.join(',')}`
        )
      } else {
        // The analyzer's reasons: 'no-provenance', 'too-young' (every entry of the set).
        const why = []
        if (fam.reasons?.includes('no-provenance')) {
          const which = ownReasons(fam.unverifiedProvenance, fam.versions)
          why.push(
            `no verified provenance${which.some(Boolean) ? ` (${which.join(', ')})` : ''}`
          )
        }
        if (fam.reasons?.includes('too-young')) {
          // One version: "3.9 h old, younger than 6 h".
          why.push(
            fam.versions.length === 1
              ? `${ownReasons(fam.tooYoung, fam.versions)[0].replace(/^\((.*)\)$/, '$1')} old, younger than ${floor} h`
              : `younger than ${floor} h: ${fam.tooYoung.join(', ')}`
          )
        }
        needs(
          'approve',
          p.rel,
          name,
          `${fam.versions.join(', ')}: ${why.join('; ') || 'needs approval'}.${part}`,
          `--approve ${set.join(',')}`
        )
      }
    }
    for (const u of plan.overrideUpdates) {
      if (/^(lift|floor):/.test(u.reason)) {
        p.overrides.push(u)
      } else {
        notApplied(
          p.rel,
          u.key,
          `override ${u.key}: ${u.value} → ${u.newKey}: ${u.newValue} (check by hand).${u.comment ? ` Comment: ${firstSentence(u.comment)}` : ''}`
        )
      }
    }
    p.removeExcludes = plan.staleExcludes.map((x) => x.entry)
    // Majors: --majors applies a direct one (with its group); heldMajors waits.
    for (const e of plan.needsApproval) {
      const desc = `${e.current} → ${e.target} (${e.reason ?? e.bumpType}).${e.ifDeclined ? ` If declined: ${e.ifDeclined}.` : ''}`
      const held = CONFIG.heldMajors.find((h) => h.name === e.name)
      const projs = e.projects ?? []
      const rest = held?.projects
        ? projs.filter((x) => !held.projects.includes(x))
        : []
      // L2: a pinned major applies only when the plan's target has that major.
      const asked = MAJOR_PINS.has(e.name)
      const pin = MAJOR_PINS.get(e.name)
      if (asked && pin != null && pin !== majorLine(e.target)) {
        R.notes.push(
          `--majors ${e.name}@${pin}: the plan's target is ${e.target}; not applied.`
        )
      }
      if (asked && (pin == null || pin === majorLine(e.target))) {
        // M3: never into a project that heldMajors holds, unless every project is held.
        const t = majorTargets(e.where, held, (w) => nameOf(p.dir, w))
        if (t.stale) {
          R.notes.push(
            `heldMajors in .claude/bump-packages.json still holds ${e.name}, but --majors applies it: remove the entry.`
          )
        } else if (t.kept.length) {
          usedHeld.add(held)
          R.notes.push(
            `--majors ${e.name}: applied to ${t.where.join(', ')}; ${t.kept.join(', ')} stay held (.claude/bump-packages.json).`
          )
        }
        if (e.regenOnly) {
          continue // lockfile-only: lockfile-report gets it as expected
        }
        const group = [e.name, ...(e.requires ?? [])]
        const lacking = group.filter((n) => !MAJOR_PINS.has(n))
        if (lacking.length) {
          finish(
            EXIT.cannotRun,
            `--majors ${e.name} needs ${lacking.join(', ')} too (a peer of the new version). Approve them together: --majors ${group.map(pinned).join(',')}.`
          )
        }
        p.majors.push({
          name: e.name,
          where: t.where,
          from: e.current,
          to: e.target,
          bump: e.bumpType,
          kind: e.kind,
          major: true,
          group: [...group].sort().join(' '),
        })
        continue
      }
      if (held && !rest.length) {
        usedHeld.add(held)
        waiting(
          p.rel,
          e.name,
          `${e.target} is held (.claude/bump-packages.json): ${firstSentence(held.reason)}`
        )
        continue
      }
      const group = [e.name, ...(e.requires ?? [])]
      needs(
        'major',
        p.rel,
        e.name,
        `${desc}${e.requires?.length ? ` Goes with ${e.requires.join(', ')}.` : ''}${e.regenOnly ? ' Only the lockfile regeneration moves it.' : ''}${rest.length ? ` Held in .claude/bump-packages.json for ${held.projects.join(', ')}; the flag changes only ${rest.join(', ')}.` : ''}`,
        `--majors ${group.map(pinned).join(',')}`
      )
    }
    for (const e of plan.held) {
      // Only a hold with a newer version is news; a pin at the latest is not.
      if (e.target) {
        waiting(
          p.rel,
          e.name,
          `held at ${e.current} by ${e.heldBy}; ${e.target} is available.${heldWhy(e.reason)}`
        )
      }
    }
    for (const f of plan.peerFloors) {
      notApplied(
        p.rel,
        f.name,
        `peer range in ${f.project}: ${f.range}; the latest is ${f.target}.`
      )
    }
    for (const e of plan.tooFresh.filter((x) => !ftNames.has(x.name))) {
      const times = (e.freshVersions ?? [])
        .map((f) => `${f.version} in ~${f.eligibleInHours} h`)
        .join(', ')
      waiting(
        p.rel,
        e.name,
        `${e.current}; ${times || `${e.registryLatest} is too fresh`}.`
      )
    }
    for (const s of plan.fastTrackSkipped ?? []) {
      waiting(p.rel, s.name, `${s.fresh}: ${s.reason}.`)
    }
    for (const m of plan.overrideMoves.filter((x) => x.major)) {
      notApplied(
        p.rel,
        m.name,
        `override ${m.override} would move ${m.lockVersions.join(', ')} → ${m.target} (a major).`
      )
    }
    // M5: an aged bump waits while a lockstep sibling's same version is too young.
    const lw = lockstepWaits(
      p.bumps.filter((b) => !b.fastTrack),
      plan.tooFresh,
      (n) => lockstepKey(n, familyKeyOf)
    )
    p.bumps = [...lw.keep, ...p.bumps.filter((b) => b.fastTrack)]
    for (const w of lw.waits) {
      waiting(
        p.rel,
        `${w.key} (${w.names.length} package${w.names.length > 1 ? 's' : ''})`,
        `waits for ${w.blocker} ${w.version} (in ~${w.inHours} h).`
      )
    }
    decideToolchain(p, { needs, notApplied, waiting })
    R.applied.bumps.push(...p.bumps.map((b) => ({ ...b, project: p.rel })))
    R.applied.majors.push(...p.majors.map((b) => ({ ...b, project: p.rel })))
    R.applied.overrides.push(
      ...p.overrides.map((o) => ({ ...o, project: p.rel }))
    )
  }
  for (const h of CONFIG.heldMajors) {
    if (!usedHeld.has(h) && !MAJOR_PINS.has(h.name)) {
      R.notes.push(
        `heldMajors entry ${h.name}: no such major in this run (stale?).`
      )
    }
  }
  for (const m of MAJOR_PINS.keys()) {
    const known = projects.some((p) =>
      p.plan.needsApproval.some((e) => e.name === m)
    )
    if (!known) {
      R.notes.push(
        `--majors ${m}: no direct dependency has this major; the lockfile review accepts it as a transitive major.`
      )
    }
  }
  // --approve entries in no family of the plan (A2): for example a fresh transitive
  // version that pnpm needs after a lockfile STOP. Still younger than the gate: checked,
  // then added. Aged: skipped with a note.
  const root = projects[0]
  const lone = APPROVE.filter(
    (a) => !usedApprove.has(a) && !familyEntries.has(a)
  )
  const minAgeMs = root.plan.minAgeHours * 3600000
  const checked = await pool(lone, 3, (a) =>
    recheckEarlier(a, minAgeMs, root.dir)
  )
  lone.forEach((a, i) => {
    const r = checked[i]
    if (r.aged) {
      R.notes.push(`--approve ${a}: already older than the gate, not added.`)
      return
    }
    refuseApproval(a, approvalObstacles(r.flags, r.compromise))
    if (r.flags.length) {
      R.notes.push(
        plain(
          `--approve ${a} has flags (approved by the user): ${r.flags.join('; ')}.`
        )
      )
    }
    root.excludeAdd.push(a)
    R.applied.approved.push(a)
  })
  // An extra project gets a root exclude entry only when its lockfile resolves that exact
  // version. A propagated entry is not an expected lockfile move (see regen).
  for (const p of projects.slice(1)) {
    const lock = parseLock(read(join(p.dir, 'pnpm-lock.yaml')))
    const has = (x) =>
      lock.get(specName(x))?.has(x.slice(specName(x).length + 1))
    p.propagated = new Set(root.excludeAdd.filter(has))
    p.excludeAdd.push(...p.propagated)
  }
  for (const p of projects) {
    p.excludeAdd = [...new Set(p.excludeAdd)].sort()
  }
  // One list per package: needs the user > not applied > waiting.
  R.needsUser.sort(
    (a, b) => NEEDS_ORDER.indexOf(a.kind) - NEEDS_ORDER.indexOf(b.kind)
  )
  const seen = new Set(R.needsUser.map((i) => i.name))
  R.notApplied = R.notApplied.filter((i) => !seen.has(i.name))
  for (const i of R.notApplied) {
    seen.add(i.name)
  }
  R.waiting = R.waiting.filter((i) => !seen.has(i.name))
  R.needsUser = mergeItems(R.needsUser)
  R.notApplied = mergeItems(R.notApplied)
  R.waiting = mergeItems(R.waiting)
}

// Actions and CI tools (root only), and pnpm for each project.
function decideToolchain(p, { needs, notApplied, waiting }) {
  const tc = p.tc
  // K2: actions, CI tools and pnpm share one status → list rule.
  const items = []
  if (p.rel === '.') {
    for (const a of tc.actions.actions) {
      if (a.pinMatchesComment === false) {
        needs(
          'security',
          p.rel,
          a.repo,
          'ACTION PIN DOES NOT MATCH ITS COMMENT. Report it as a security finding.'
        )
      }
      items.push({
        ...a,
        id: a.repo,
        label: 'action',
        why: a.approvalReason,
        apply: () =>
          R.applied.actions.push({
            repo: a.repo,
            from: a.current,
            to: a.target,
          }),
      })
    }
    for (const t of tc.ciTools) {
      items.push({
        ...t,
        id: t.pkg,
        label: 'CI tool',
        apply: () =>
          R.applied.tools.push({ pkg: t.pkg, from: t.current, to: t.target }),
      })
    }
    if (tc.node?.upToDate === false) {
      notApplied(
        p.rel,
        'node',
        `CI is not on the latest LTS (${tc.node.latestLts}).`
      )
    }
    for (const h of tc.pnpm?.hardcodedInCi ?? []) {
      notApplied(
        p.rel,
        'pnpm',
        `CI hardcodes the pnpm version at ${h}; CI must read packageManager.`
      )
    }
  }
  items.push({
    ...tc.pnpm,
    id: 'pnpm',
    label: '',
    why: 'a major; not applied by any flag',
    apply: () => {
      p.pnpmTarget = tc.pnpm.target
      if (p.rel === '.') {
        R.applied.pnpm = { from: tc.pnpm.current, to: tc.pnpm.target }
      }
    },
  })
  for (const x of items) {
    if (x.status === 'safe' && x.target) {
      x.apply()
    } else if (x.status === 'needs-approval') {
      notApplied(
        p.rel,
        x.id,
        `${x.label ? `${x.label} ` : ''}${x.current} → ${x.target}: ${x.why ?? 'needs approval'}.`
      )
    } else if (x.status === 'too-fresh') {
      waiting(
        p.rel,
        x.id,
        `${x.label ? `${x.label} ` : ''}${x.newest} is ${x.newestAgeHours} h old.`
      )
    } else if (x.status !== 'up-to-date' && x.status !== 'safe') {
      notApplied(
        p.rel,
        x.id,
        `${x.label ? `${x.label} ` : ''}status ${x.status}: check by hand.`
      )
    }
  }
}

// --- 4b. apply the edits -----------------------------------------------------------

// Write the new specifiers. A major (--majors) also records each edit and the text of the
// file before the first major edit: each major group gets its own commit.
function editManifests(p) {
  p.majorEdits = []
  p.preMajor = new Map()
  const apply = (b, isMajor) => {
    let edits = 0
    for (const w of b.where) {
      const file = join(p.dir, w, 'package.json')
      let text = read(file)
      if (!text) {
        continue
      }
      const before = text
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
          if (isMajor) {
            p.majorEdits.push({
              group: b.group,
              file,
              field,
              name: b.name,
              spec: next,
            })
          }
        }
      }
      if (isMajor && text !== before && !p.preMajor.has(file)) {
        p.preMajor.set(file, before)
      }
      writeFileSync(file, text)
    }
    if (!edits) {
      R.notes.push(
        `${b.name} ${b.to}: no bumpable specifier found in ${b.where.join(', ')} (the regeneration may still move it).`
      )
    }
  }
  for (const b of p.bumps) {
    apply(b, false)
  }
  for (const b of p.majors) {
    apply(b, true)
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
      R.notApplied.push({
        project: p.rel,
        name: o.key,
        text: plain(
          `override line not found; wanted ${o.newKey}: ${o.newValue}.`
        ),
      })
    } else {
      text = next
    }
  }
  const have = new Set(yamlList(orig, 'minimumReleaseAgeExclude'))
  const add = p.excludeAdd.filter((x) => !have.has(x))
  // Only exact `name@x.y.z` entries are ever written.
  const badAdd = invalidExcludeEntries(add)
  if (badAdd.length) {
    finish(
      EXIT.cannotRun,
      `refused to write exclude entries that are not exact name@x.y.z: ${badAdd.join(', ')}`
    )
  }
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
    R.notApplied.push({
      project: p.rel,
      name: x,
      text: 'the exclude entry has aged out, but the script found no item to remove.',
    })
  }
  if (text !== orig) {
    writeFileSync(file, text)
  }
  // The state for the first commit: only the additions.
  p.yamlFile = file
  p.yamlAddsOnly = add.length
    ? editExcludesDetailed(orig, { add, comment }).text
    : null
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
  // On a signal: put the old lockfile and the moved modules lockfile back.
  const undo = () => {
    if (oldLock != null && !existsSync(lockFile)) {
      writeFileSync(lockFile, oldLock)
    }
    if (moved && !existsSync(modLock)) {
      copyFileSync(aside, modLock)
    }
  }
  CLEANUPS.add(undo)
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
        `pnpm install failed (exit ${r.code}): ${tailLine(r.err)}`
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
      p.deduped = true
    }
    ok = true
  } catch (e) {
    finish(EXIT.cannotRun, `regeneration of ${p.rel} failed: ${e.message}`)
  } finally {
    CLEANUPS.delete(undo)
    if (moved && ok) {
      rmSync(aside, { force: true })
    }
  }
  const now = read(lockFile)
  const expectMoves =
    p.bumps.length ||
    p.overrides.length ||
    p.excludeAdd.some((x) => !p.propagated?.has(x)) ||
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

// The exclude entries of the branch (HEAD, before this run's edit) that origin/main does
// not have. The branch is local (the git step refuses remote commits), so each exact entry
// is an earlier entry; one that is still younger than the gate is checked again
// (advisories of the version and the package, publisher, install scripts, provenance
// source). Any flag is a STOP. A bare name, a range or a glob is a STOP.
async function earlierExcludes(projects, wt) {
  const stop = []
  for (const p of projects) {
    const where = p.rel === '.' ? '' : ` (${p.rel})`
    const path = `${p.rel === '.' ? '' : `${p.rel}/`}pnpm-workspace.yaml`
    const at = async (ref) =>
      yamlList(
        (await git(wt, ['show', `${ref}:${path}`])).out,
        'minimumReleaseAgeExclude'
      )
    const { exact, other } = branchExcludes(
      await at('HEAD'),
      await at('origin/main')
    )
    const removed = new Set(p.removedReal ?? [])
    for (const x of other.filter((e) => !removed.has(e))) {
      stop.push(
        `exclude entry${where} that origin/main does not have and that is not one exact version: ${x}`
      )
    }
    p.earlier = exact.filter((e) => !removed.has(e))
    const minAgeMs = p.plan.minAgeHours * 3600000
    const flags = await pool(p.earlier, 3, (spec) =>
      recheckEarlier(spec, minAgeMs, p.dir)
    )
    stop.push(
      ...flags
        .flatMap((r) => r.flags)
        .map((f) => `earlier fast-track${where}: ${f}`)
    )
  }
  if (stop.length) {
    R.lockfile = { majors: [], singleCopy: [], added: 0, stop }
    finish(
      EXIT.lockfileStop,
      `exclude entries of the PR branch cannot be trusted: ${stop.join('; ')}`
    )
  }
}

// One exact entry that is still younger than the gate, against the aged release below it
// (lib.js checkExactEntry with the metadata checks, without the new-dependency flags: the
// entry is already approved), plus the malware advisories of the whole package. Returns
// { aged, flags, compromise }.
async function recheckEarlier(spec, minAgeMs, cwd) {
  const name = specName(spec)
  const version = spec.slice(name.length + 1)
  const view = await npmView(name, cwd)
  const iso = view?.time?.[version]
  if (!iso) {
    return {
      aged: false,
      flags: [`${spec}: registry data unavailable, cannot check`],
      compromise: [],
    }
  }
  if (Date.now() - Date.parse(iso) >= minAgeMs) {
    return { aged: true, flags: [], compromise: [] } // the gate covers it now
  }
  const io = {
    advisories: (n, v) => advisoriesFor(n, v, cwd),
    provenance: (n, v) => provenanceOf(n, v, cwd),
    meta: (s) => npmViewFields(s, META_FIELDS, cwd),
    rawDoc: (n, v) => registryVersionDoc(n, v, cwd),
  }
  const ref = referenceVersion(view, version, minAgeMs, Date.now())
  const [r, pkgRes] = await Promise.all([
    checkExactEntry(spec, ref, io, { metadata: true, deps: false }),
    packageMalwareFor(name, cwd),
  ])
  const hits = pkgRes.error
    ? null
    : malwareCoveringAny(pkgRes.list, name, [version])
  const pkgFlags =
    hits == null
      ? [`${spec}: package malware check cannot run`]
      : hits.map((h) => `${spec}: malware advisory ${h.ghsa} on the package`)
  return {
    aged: false,
    flags: [...r.flags, ...pkgFlags],
    compromise: [...r.compromise, ...(hits ? pkgFlags : [])],
  }
}

async function lockfileReview(projects, out) {
  // --majors: a lockfile major of these names is expected (direct or transitive).
  const majors = [...MAJOR_PINS.keys()]
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
    if (r.code !== 0) {
      finish(
        EXIT.cannotRun,
        `lockfile-report failed for ${p.rel}: ${tailLine(r.err)}`
      )
    }
    return { p, rep: JSON.parse(r.out) }
  })
  const stop = []
  for (const { p, rep } of reports) {
    const where = p.rel === '.' ? '' : ` (${p.rel})`
    for (const j of rep.unexpectedMajors) {
      stop.push(
        `major jump${where}: ${j.name} ${j.from.join('/')} → ${j.to.join('/')}${j.causes?.length ? ` (${j.causes.join('; ')})` : ''}`
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

async function writeChangeset(wt, root) {
  if (!existsSync(join(wt, '.changeset', 'config.json'))) {
    return null
  }
  const applied = new Set(
    [...root.bumps, ...root.majors].map((b) => `${b.name}@${b.to}`)
  )
  const updates = []
  // A major (--majors) takes its lines from changesetIfApproved.
  for (const [pkg, lines] of [
    ...Object.entries(root.plan.changeset),
    ...Object.entries(root.plan.changesetIfApproved ?? {}),
  ]) {
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
  // A rerun on a PR: the changesets that the branch added get the new versions first.
  const mb = (
    await must('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: wt })
  ).trim()
  const added = (
    await must(
      'git',
      [
        'diff',
        '--name-only',
        '--diff-filter=A',
        mb,
        'HEAD',
        '--',
        '.changeset',
      ],
      { cwd: wt }
    )
  )
    .split('\n')
    .filter(
      (f) =>
        /^\.changeset\/[^/]+\.md$/.test(f) &&
        existsSync(join(wt, f)) &&
        lstatSync(join(wt, f)).isFile()
    )
  const { edits, rest } = reuseChangesets(
    added.map((file) => ({ file, text: readFileSync(join(wt, file), 'utf8') })),
    updates
  )
  for (const e of edits) {
    writeFileSync(join(wt, e.file), e.text)
  }
  if (!rest.length) {
    return null
  }
  let file = join(wt, '.changeset', `bump-packages-${DATE}.md`)
  for (let n = 2; existsSync(file); n++) {
    file = join(wt, '.changeset', `bump-packages-${DATE}-${n}.md`)
  }
  writeFileSync(file, changesetText(rest))
  return file
}

// --- 8. checks ----------------------------------------------------------------------

const logOf = (out, name) =>
  join(out, `check-${name.replace(/[^\w.-]+/g, '-')}.log`)

// The checks of this repo: [{ name, cmd, build?, afterBuild?, fn }]. `cmd` reproduces the
// check by hand (M7). D1: the checks that do not need `dist` run while `build` runs; the
// `afterBuild` ones start after it.
function planChecks(wt, projects, out) {
  const pkg = JSON.parse(read(join(wt, 'package.json')))
  const has = (s) => !!pkg.scripts?.[s]
  const tasks = []
  const add = (name, cmd, fn, extra = {}) =>
    tasks.push({ name, cmd, fn, ...extra })
  const pnpmIn = (dir, args) => `pnpm -C ${sq(dir)} ${args.join(' ')}`
  const pnpmTask = (name, args, extra) =>
    add(
      name,
      pnpmIn(wt, args),
      () => run('pnpm', args, { cwd: wt, log: logOf(out, name) }),
      extra
    )
  const after = { afterBuild: true }
  if (has('build')) {
    pnpmTask('build', ['build'], { build: true })
  }
  if (has('check')) {
    pnpmTask('check', ['check'])
  }
  if (has('check:types')) {
    pnpmTask(
      'check:types',
      ['-r', '--parallel', '--no-bail', 'check:types'],
      after
    )
  }
  if (has('check:circular-deps')) {
    pnpmTask('check:circular-deps', ['check:circular-deps'], after)
  }
  if (has('knip:check')) {
    pnpmTask('knip:check', ['knip:check'], after)
  }
  const testScript = has('test:unit')
    ? 'test:unit'
    : has('test')
      ? 'test'
      : null
  if (testScript) {
    add(
      testScript,
      pnpmIn(wt, [testScript]),
      async () => {
        const log = logOf(out, testScript)
        const r = await run('pnpm', [testScript], { cwd: wt, log })
        // One retry: a parallel vitest run can fail once with ENOTEMPTY on its cache.
        return r.code === 0 ? r : run('pnpm', [testScript], { cwd: wt, log })
      },
      after
    )
  }
  pnpmTask('dedupe --check', ['dedupe', '--check'])
  // A13: registry signatures of every package in the lockfile.
  add('signatures', pnpmIn(wt, ['audit', 'signatures']), async () => {
    const r = await run('pnpm', ['audit', 'signatures'], {
      cwd: wt,
      log: logOf(out, 'signatures'),
    })
    // A pnpm without the subcommand runs a plain `pnpm audit` and ignores the word.
    return /signature/i.test(r.out + r.err)
      ? r
      : { ...r, code: 0, unsupported: true }
  })
  if (existsSync(join(wt, 'scripts', 'size-measure.mjs'))) {
    const args = ['scripts/size-measure.mjs', '.', join(out, 'size.json')]
    add(
      'size-measure',
      `cd ${sq(wt)} && node ${args.map(sq).join(' ')}`,
      () => run('node', args, { cwd: wt, log: logOf(out, 'size-measure') }),
      after
    )
  }
  for (const p of projects.slice(1)) {
    const name = `${p.rel}: install + tsc`
    const dir = join(wt, p.rel) // also for the baseline worktree
    const cmd = `${pnpmIn(dir, ['install', '--frozen-lockfile'])} && ${pnpmIn(dir, ['exec', 'tsc', '--noEmit'])}`
    add(name, cmd, async () => {
      const i = await run('pnpm', ['install', '--frozen-lockfile'], {
        cwd: dir,
        log: logOf(out, name),
      })
      if (i.code !== 0) {
        return i
      }
      const pj = JSON.parse(read(join(dir, 'package.json')))
      if (!pj.dependencies?.typescript && !pj.devDependencies?.typescript) {
        return i
      }
      const t = await run('pnpm', ['exec', 'tsc', '--noEmit'], {
        cwd: dir,
        log: logOf(out, name),
      })
      return { ...t, seconds: Math.round((i.seconds + t.seconds) * 10) / 10 }
    })
  }
  return tasks
}

// Run the checks once and record each one in R.checks. H1: when the build fails, the
// checks that need it are recorded as not run.
async function checks(wt, projects, out) {
  const record = (t, r) => {
    if (r.unsupported) {
      R.notes.push(
        `This pnpm has no \`pnpm audit signatures\`: the ${t.name} check did not run.`
      )
      return
    }
    R.checks.push({
      name: t.name,
      ok: r.code === 0,
      seconds: r.seconds,
      log: logOf(out, t.name),
      cmd: t.cmd,
    })
  }
  // The regeneration already ran `pnpm dedupe`: `dedupe --check` adds nothing.
  const todo = planChecks(wt, projects, out).filter(
    (t) => !(t.name === 'dedupe --check' && projects[0].deduped)
  )
  const build = todo.find((t) => t.build)
  const early = todo.filter((t) => !t.build && !t.afterBuild)
  const late = todo.filter((t) => t.afterBuild)
  const auditAfter = audit(wt).then((a) => {
    R.audit.after = a
  })
  const earlyRuns = pool(early, 3, (t) => t.fn())
  const buildResult = build ? await build.fn() : { code: 0 }
  if (build) {
    record(build, buildResult)
  }
  const lateResults =
    buildResult.code === 0 ? await pool(late, 3, (t) => t.fn()) : null
  const earlyResults = await earlyRuns
  await auditAfter
  early.forEach((t, i) => {
    record(t, earlyResults[i])
  })
  late.forEach((t, i) => {
    if (lateResults) {
      record(t, lateResults[i])
    } else {
      R.checks.push({
        name: t.name,
        ok: false,
        notRun: 'build failed',
        cmd: t.cmd,
      })
    }
  })
}

// H2: run the failed checks again on a temporary detached worktree of the merge-base with
// origin/main (main's code, not the PR's own commits). Each failed check gets `verdict`:
// 'regression' (it passes on main), 'fails-on-main', or 'unknown' with `baselineWhy`.
// The baseline logs stay in <out>/baseline/.
async function baseline(repo, wt, failed, projects, out) {
  const dir = join(out, 'baseline-worktree')
  const logs = join(out, 'baseline')
  mkdirSync(logs, { recursive: true })
  const unknown = (why, list = failed) => {
    for (const c of list) {
      c.verdict = 'unknown'
      c.baselineWhy = why
    }
  }
  const base = await git(wt, ['merge-base', 'HEAD', 'origin/main'])
  const add =
    base.code === 0
      ? await run(
          'git',
          ['worktree', 'add', '--detach', dir, base.out.trim()],
          { cwd: repo }
        )
      : base
  if (add.code !== 0) {
    return unknown('no worktree of the merge-base with origin/main')
  }
  const remove = () => removeWorktree(repo, dir)
  CLEANUPS.add(remove)
  try {
    const i = await run('pnpm', ['install', '--frozen-lockfile'], {
      cwd: dir,
      log: join(logs, 'install.log'),
    })
    if (i.code !== 0) {
      return unknown('pnpm install failed on main')
    }
    const tasks = planChecks(dir, projects, logs)
    const build = tasks.find((t) => t.build)
    const buildOk = build ? (await build.fn()).code === 0 : true
    for (const c of failed) {
      const t = tasks.find((x) => x.name === c.name)
      if (!t) {
        unknown('the check does not exist on main', [c])
        continue
      }
      c.baselineLog = logOf(logs, c.name)
      if (t.build) {
        c.verdict = buildOk ? 'regression' : 'fails-on-main'
      } else if (!buildOk) {
        unknown('the build fails on main', [c])
      } else {
        c.verdict = (await t.fn()).code === 0 ? 'regression' : 'fails-on-main'
      }
    }
  } finally {
    CLEANUPS.delete(remove)
    remove()
  }
}

// K1: one way to remove a worktree of this run.
function removeWorktree(repo, dir) {
  execFileSync('git', ['worktree', 'remove', '--force', dir], {
    cwd: repo,
    stdio: 'ignore',
  })
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

async function commit(wt, message, body, files) {
  await must(
    'git',
    ['commit', '--no-verify', '-m', message, '-m', wrapLines(body || message)],
    { cwd: wt }
  )
  const sha = (await must('git', ['rev-parse', 'HEAD'], { cwd: wt })).trim()
  R.commits.push({ sha, message, files })
}

// Each major group (--majors) in its own commit after `chore: bump packages`: the files
// get the text before the majors plus the edits of the groups so far.
async function commitMajors(wt, projects) {
  const rel = (abs) => abs.slice(wt.length + 1)
  const pre = new Map(projects.flatMap((p) => [...p.preMajor]))
  const edits = projects.flatMap((p) => p.majorEdits)
  const cur = new Map()
  for (const g of [...new Set(edits.map((e) => e.group))].sort()) {
    const files = new Set()
    for (const e of edits.filter((x) => x.group === g)) {
      const base = cur.get(e.file) ?? pre.get(e.file)
      cur.set(e.file, setDependencySpec(base, e.field, e.name, e.spec))
      files.add(e.file)
    }
    for (const f of files) {
      const final = read(f)
      writeFileSync(f, cur.get(f))
      await must('git', ['add', '--', rel(f)], { cwd: wt })
      writeFileSync(f, final)
    }
    const majors = R.applied.majors.filter((m) => m.group === g)
    const names = [...new Map(majors.map((m) => [m.name, m])).values()]
    await commit(
      wt,
      `chore: bump ${names.map((m) => `${m.name} to ${majorLine(m.to)}`).join(' and ')}`,
      `Approved by the user (--majors): ${names.map((m) => `${tick(m.name)} ${m.from} → ${m.to}`).join(', ')}.`,
      [...files].map(rel)
    )
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
    const stage = (file, text) => {
      restore.push([file, read(file)])
      writeFileSync(file, text)
    }
    if (c.id === 'excludes') {
      for (const p of projects.filter((x) => x.yamlAddsOnly)) {
        stage(p.yamlFile, p.yamlAddsOnly)
      }
    }
    if (c.id === 'bump') {
      for (const p of pmProjects) {
        stage(p.pmFile, setPackageManager(read(p.pmFile), p.pmOld))
      }
      // The texts before the majors (they also have the old packageManager).
      for (const p of projects) {
        for (const [f, text] of p.preMajor) {
          stage(f, text)
        }
      }
    }
    await must('git', ['add', '--', ...c.files], { cwd: wt })
    for (const [f, text] of restore.reverse()) {
      writeFileSync(f, text)
    }
    if (!(await gitOk(wt, ['diff', '--cached', '--quiet']))) {
      await commit(wt, c.message, bodies[c.id], c.files)
    }
    if (c.id === 'bump') {
      await commitMajors(wt, projects)
    }
  }
}

// --- 10. push and PR ----------------------------------------------------------------

// The state of the branch against origin/main for the PR block (F4): every dependency
// change of the package.json files, the exclude entries and overrides that main does not
// have, and the toolchain lines (packageManager, changed `.github` lines).
async function prState(wt, projects) {
  const mb = (
    await must('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: wt })
  ).trim()
  const show = async (ref, f) => {
    const r = await git(wt, ['show', `${ref}:${f}`])
    return r.code === 0 ? r.out : null
  }
  const changed = (await git(wt, ['diff', '--name-only', mb, 'HEAD'])).out
    .split('\n')
    .filter(Boolean)
  const rows = new Map()
  for (const f of changed.filter((x) => /(^|\/)package\.json$/.test(x))) {
    const [a, b] = (await Promise.all([show(mb, f), show('HEAD', f)])).map(
      (t) => (t ? JSON.parse(t) : {})
    )
    const where = dirname(f) === '.' ? 'root' : dirname(f)
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      const names = new Set([
        ...Object.keys(a[field] ?? {}),
        ...Object.keys(b[field] ?? {}),
      ])
      for (const name of names) {
        const from = a[field]?.[name] ?? null
        const to = b[field]?.[name] ?? null
        if (from === to) {
          continue
        }
        const semver = (x) => /^[\^~]?\d+\.\d+\.\d+/.test(x ?? '')
        const key = `${name} ${from} ${to}`
        const row = rows.get(key) ?? {
          name,
          from,
          to,
          bump: semver(from) && semver(to) ? classify(from, to).bumpType : '',
          where: [],
        }
        row.where.push(field === 'peerDependencies' ? `${where} (peer)` : where)
        rows.set(key, row)
      }
    }
  }
  const packages = [...rows.values()]
    .map((r) => ({ ...r, where: r.where.join(', ') }))
    .sort((x, y) => x.name.localeCompare(y.name))
  const excludes = []
  const removedExcludes = []
  const overrides = []
  for (const p of projects) {
    const path = `${p.rel === '.' ? '' : `${p.rel}/`}pnpm-workspace.yaml`
    const [head, main] = await Promise.all([
      show('HEAD', path),
      show('origin/main', path),
    ])
    const { exact, other } = branchExcludes(
      yamlList(head ?? '', 'minimumReleaseAgeExclude'),
      yamlList(main ?? '', 'minimumReleaseAgeExclude')
    )
    excludes.push(...exact, ...other)
    // M6: the aged entries this branch removed (on main, not on the branch).
    removedExcludes.push(
      ...branchExcludes(
        yamlList(main ?? '', 'minimumReleaseAgeExclude'),
        yamlList(head ?? '', 'minimumReleaseAgeExclude')
      ).exact
    )
    const om = new Map(
      yamlMap(main ?? '', 'overrides').map((o) => [o.key, o.value])
    )
    const hm = new Map(
      yamlMap(head ?? '', 'overrides').map((o) => [o.key, o.value])
    )
    for (const key of new Set([...om.keys(), ...hm.keys()])) {
      if (om.get(key) !== hm.get(key)) {
        overrides.push({
          key,
          from: om.get(key) ?? null,
          to: hm.get(key) ?? null,
          project: p.rel,
        })
      }
    }
  }
  const toolchain = []
  const pm = async (ref) =>
    /"packageManager"\s*:\s*"pnpm@([^+"]+)/.exec(
      (await show(ref, 'package.json')) ?? ''
    )?.[1] ?? null
  const [pmFrom, pmTo] = await Promise.all([pm(mb), pm('HEAD')])
  if (pmFrom !== pmTo) {
    toolchain.push(`pnpm ${pmFrom ?? '?'} → ${pmTo ?? '?'}`)
  }
  let file = null
  for (const l of (
    await git(wt, ['diff', '-U0', mb, 'HEAD', '--', '.github'])
  ).out.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l.replace(/^\+\+\+ b\//, '')
    } else if (l.startsWith('+') && /uses:|VERSION|npx |dlx |pnpx /.test(l)) {
      toolchain.push(`${file}: \`${plain(l.slice(1).trim())}\``)
    }
  }
  return {
    packages,
    excludes: [...new Set(excludes)],
    removedExcludes: [...new Set(removedExcludes)],
    overrides,
    toolchain,
  }
}

const GITHUB_BODY_MAX = 65536

async function pushAndPr(wt, ghRepo, out, projects) {
  const bodyFile = join(out, 'pr-body.md')
  const state = await prState(wt, projects)
  const old =
    R.mode === 'open-pr'
      ? await must(
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
      : null
  const template =
    read(join(wt, '.github', 'pull_request_template.md')) ??
    read(join(wt, '.github', 'PULL_REQUEST_TEMPLATE.md'))
  // F4, M4: smaller lists until the body fits; then cut the block. Never exit 2 here:
  // the commits exist already.
  const wrap = (block) =>
    old != null ? replacePrBlock(old, block) : newPrBody(block, template)
  let block = ''
  for (const cap of [150, 50, 10]) {
    block = prBlock(state, R, cap)
    if (wrap(block).length <= GITHUB_BODY_MAX) {
      break
    }
  }
  const room = GITHUB_BODY_MAX - (wrap('').length + 1)
  const body = wrap(fitPrBlock(block, room))
  writeFileSync(bodyFile, body)
  if (values['no-push']) {
    R.notes.push(`--no-push: nothing pushed. The PR text is in ${bodyFile}.`)
    return
  }
  await assertBumpBranch(wt)
  // --no-verify: a pre-push hook would run the tests again; the checks above ran them.
  await must(
    'git',
    ['push', '--no-verify', '-u', 'origin', `HEAD:refs/heads/${R.branch}`],
    { cwd: wt }
  )
  if (R.mode === 'open-pr') {
    await must(
      'gh',
      ['pr', 'edit', String(R.pr), '--repo', ghRepo, '--body-file', bodyFile],
      { cwd: wt }
    )
    R.notes.push(
      `PR #${R.pr}: the script rewrote only its block. Update the text above the block so that it matches the branch.`
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
        bodyFile,
      ],
      { cwd: wt }
    )
    R.pr = url.trim()
  }
}

// --- config -------------------------------------------------------------------------

let CONFIG = { heldMajors: [], fastTrackMinAgeHours: null }

// `.claude/bump-packages.json` of the worktree (A10). A malformed file or an unknown key
// is exit 2.
// One copy of `.claude/bump-packages.json`: { heldMajors, fastTrackMinAgeHours }, or
// exit 2 for a malformed file or an unknown key.
function parseConfig(text, where) {
  const bad = (why) => finish(EXIT.cannotRun, `${where}: ${why}`)
  let c
  try {
    c = JSON.parse(text)
  } catch (e) {
    bad(`not valid JSON (${e.message})`)
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    bad('not a JSON object')
  }
  for (const k of Object.keys(c)) {
    if (k !== 'heldMajors' && k !== 'fastTrackMinAgeHours') {
      bad(`unknown key ${k} (known: heldMajors, fastTrackMinAgeHours)`)
    }
  }
  const held = c.heldMajors ?? []
  const strings = (x) =>
    Array.isArray(x) && x.every((s) => typeof s === 'string')
  if (
    !Array.isArray(held) ||
    !held.every(
      (h) =>
        h &&
        typeof h.name === 'string' &&
        typeof h.reason === 'string' &&
        (h.projects === undefined || strings(h.projects)) &&
        Object.keys(h).every((k) => ['name', 'projects', 'reason'].includes(k))
    )
  ) {
    bad(
      'heldMajors must be a list of { name, reason, projects? } (projects: package names)'
    )
  }
  const ft = c.fastTrackMinAgeHours
  if (ft !== undefined && !(Number.isFinite(ft) && ft >= 0)) {
    bad('fastTrackMinAgeHours must be a number of hours (0 or more)')
  }
  return { heldMajors: held, fastTrackMinAgeHours: ft ?? null }
}

// A10: `heldMajors` from the worktree's copy. L4: `fastTrackMinAgeHours` only from
// origin/main's copy (default 6): a control is lowered only by a merged change on main.
function loadConfig(wt) {
  const file = join(wt, '.claude', 'bump-packages.json')
  const text = read(file)
  const branch = text == null ? null : parseConfig(text, file)
  let mainText = null
  try {
    mainText = execFileSync(
      'git',
      ['show', 'origin/main:.claude/bump-packages.json'],
      { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
  } catch {}
  const main =
    mainText == null
      ? null
      : parseConfig(mainText, 'origin/main:.claude/bump-packages.json')
  const ft = main?.fastTrackMinAgeHours ?? null
  if (
    branch?.fastTrackMinAgeHours != null &&
    branch.fastTrackMinAgeHours !== (ft ?? 6)
  ) {
    R.notes.push(
      `fastTrackMinAgeHours ${branch.fastTrackMinAgeHours} on the branch is not used: the value comes from origin/main (${ft ?? 6}).`
    )
  }
  CONFIG = { heldMajors: branch?.heldMajors ?? [], fastTrackMinAgeHours: ft }
  R.fastTrackMinAgeHours = ft ?? 6
}

// --- main ---------------------------------------------------------------------------------

const total = (t0) => {
  R.timings.total = Math.round((Date.now() - t0) / 100) / 10
}

// HEAD has commits that origin does not have (on the PR branch, or on origin/main for a
// branch that was never pushed).
const unpushed = async (wt) =>
  !(await gitOk(wt, [
    'merge-base',
    '--is-ancestor',
    'HEAD',
    R.base ?? 'origin/main',
  ]))

// New mode with nothing to bump: the worktree and the branch of this run go (A8).
function removeEmptyWorktree(repo, wt) {
  if (R.mode !== 'new' || !R.createdWorktree) {
    return
  }
  removeWorktree(repo, wt)
  execFileSync('git', ['branch', '-D', R.branch], {
    cwd: repo,
    stdio: 'ignore',
  })
  R.worktreeKept = false
  R.worktreeRemoved = true
}

async function main() {
  if (!values.repo) {
    process.stderr.write(USAGE)
    process.exit(EXIT.cannotRun)
  }
  const repo = resolve(values.repo)
  const out = resolve(
    values.out ?? join(tmpdir(), `bump-${basename(repo)}-${DATE}-${Date.now()}`)
  )
  mkdirSync(out, { recursive: true })
  R.out = out
  const bad = invalidExcludeEntries(APPROVE)
  if (bad.length) {
    finish(
      EXIT.cannotRun,
      `--approve takes exact name@x.y.z entries only: ${bad.join(', ')}`
    )
  }
  const badPins = MAJORS.filter(
    (m) =>
      MAJOR_PINS.get(m.slice(0, m.lastIndexOf('@'))) != null &&
      !/@\d+(\.\d+)?$/.test(m)
  )
  if (badPins.length) {
    finish(
      EXIT.cannotRun,
      `--majors takes name or name@<major> (zustand@6, x@0.5): ${badPins.join(', ')}`
    )
  }
  const t0 = Date.now()

  const { ghRepo, wt } = await step('git', async () => {
    const r = await setupGit()
    await checkGate(r.wt)
    loadConfig(r.wt)
    return r
  })
  await step('install', async () => {
    const r = await run('pnpm', ['install', '--frozen-lockfile'], {
      cwd: wt,
      log: join(out, 'install.log'),
    })
    if (r.code === 0) {
      return
    }
    // A7: a hand commit can change a manifest without the lockfile; step 5 regenerates
    // it. A dry run in a real worktree puts the tracked files back at the end.
    R.notes.push(
      'pnpm install --frozen-lockfile failed; ran pnpm install once (the regeneration rewrites the lockfile).'
    )
    if (R.dryRun && R.worktreeKept) {
      CLEANUPS.add(() =>
        execFileSync('git', ['checkout', '--', '.'], {
          cwd: wt,
          stdio: 'ignore',
        })
      )
    }
    await must('pnpm', ['install'], {
      cwd: wt,
      log: join(out, 'install-2.log'),
    })
  })
  const [projects, auditBefore] = await step('analyze', () =>
    Promise.all([analyze(wt, out), R.dryRun ? null : audit(wt)])
  )
  R.audit.before = auditBefore
  const checkNames = planChecks(wt, projects, out).map((t) => t.name)
  const unknown = SKIP.filter((n) => !checkNames.includes(n))
  if (unknown.length) {
    finish(
      EXIT.cannotRun,
      `--skip-check: unknown check ${unknown.join(', ')}. The checks: ${checkNames.join(', ')}.`
    )
  }
  // H2: a failed build or signature check is never accepted.
  const never = SKIP.filter((n) => n === 'build' || n === 'signatures')
  if (never.length) {
    finish(
      EXIT.cannotRun,
      `--skip-check cannot accept a failure of ${never.join(', ')}.`
    )
  }
  await step('decide', () => decide(projects))
  if (R.dryRun) {
    total(t0)
    finish(EXIT.ok, 'dry run: the plan above, nothing changed')
  }
  const headLocks = new Map()
  await step('edit', async () => {
    R.dirtied = true // M1: from here on, an exit prints the reset command
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
          R.notApplied.push({
            project: '.',
            name: m,
            text: 'the apply step did not find it.',
          })
        }
        for (const s of part.skipped ?? []) {
          R.notApplied.push({
            project: '.',
            name: s,
            text: 'the line has a version that the script cannot read; check by hand.',
          })
        }
      }
    }
  })
  await step('regen', async () => {
    // D3: the root and the extra projects in parallel.
    await Promise.all(projects.map((p) => regen(p, out, headLocks.get(p.rel))))
  })
  // H3: the recheck of earlier exclude entries runs before any early exit.
  await step('recheck', () => earlierExcludes(projects, wt))
  // A9: nothing changed and nothing unpushed: no review, changeset, checks or audit.
  // Unpushed commits (a merge of main, a fix commit) get the review and the checks.
  const clean = !(
    await must('git', ['status', '--porcelain'], { cwd: wt })
  ).trim()
  // New mode: a branch on origin without a PR (an earlier `gh pr create` failed) still
  // goes to the push step, which opens the PR.
  const needsPr = R.mode === 'new' && !!R.base
  if (clean && !(await unpushed(wt)) && !needsPr) {
    removeEmptyWorktree(repo, wt)
    total(t0)
    finish(
      EXIT.ok,
      `nothing to bump${R.worktreeRemoved ? '; the worktree and the branch of this run are removed' : ''}`
    )
  }
  await step('lockfile', () => lockfileReview(projects, out))
  await step('changeset', () => writeChangeset(wt, projects[0]))
  await step('checks', () => checks(wt, projects, out))
  await restoreVersionFiles(wt)
  const failed = R.checks.filter((c) => !c.ok && !c.notRun)
  if (failed.length) {
    await step('baseline', () => baseline(repo, wt, failed, projects, out))
  }
  // H2: --skip-check accepts a failure only when main fails the same check.
  for (const c of failed) {
    c.accepted = SKIP.includes(c.name) && c.verdict === 'fails-on-main'
  }
  R.acceptedChecks = failed.filter((c) => c.accepted).map((c) => c.name)
  const blocking = R.checks.filter((c) => !c.ok && !c.accepted)
  if (blocking.length) {
    for (const c of blocking.filter((x) => !x.notRun)) {
      process.stderr.write(
        `\n### FAILED: ${c.name} (${c.log})\n\n${tail(read(c.log), 40)}\n`
      )
    }
    total(t0)
    finish(
      EXIT.checkFailed,
      `${blocking.length} check(s) failed: ${blocking.map((c) => c.name).join(', ')}`
    )
  }
  await step('commit', () => commitAll(wt, projects))
  if (!R.commits.length) {
    if (!(await unpushed(wt)) && !needsPr) {
      total(t0)
      finish(EXIT.ok, 'nothing to bump')
    }
    R.notes.push(
      'No new commit; the local commits that origin does not have are pushed.'
    )
  }
  await step('push', () => pushAndPr(wt, ghRepo, out, projects))
  total(t0)
  const what = R.commits.length
    ? 'committed'
    : R.mergedMain
      ? 'merged main; nothing else to bump'
      : 'pushed the local commits; nothing else to bump'
  finish(
    EXIT.ok,
    values['no-push']
      ? `${what}; not pushed (--no-push)`
      : R.commits.length
        ? 'done'
        : what
  )
}

main().catch((e) => finish(EXIT.cannotRun, `unexpected error: ${e.stack ?? e}`))
