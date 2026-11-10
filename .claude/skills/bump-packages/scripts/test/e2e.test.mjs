// End-to-end test of bump.mjs on a throwaway repo: a bare origin at
// <tmp>/github.com/acme/fixture.git, a main checkout with a small pnpm workspace,
// and a stub `gh` that answers `gh pr` from a JSON file (`gh api` goes to the
// real gh). Opt-in: it needs the npm registry and gh; it takes about a minute.
// Run: BUMP_E2E=1 node --test <skill>/scripts/test/e2e.test.mjs

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BUMP = join(dirname(fileURLToPath(import.meta.url)), '..', 'bump.mjs')
const skip = process.env.BUMP_E2E !== '1' && 'set BUMP_E2E=1 (network, ~1 min)'
const pad = (n) => String(n).padStart(2, '0')
const D = new Date()
// The local date, as bump.mjs makes it.
const DATE = `${D.getFullYear()}-${pad(D.getMonth() + 1)}-${pad(D.getDate())}`
const BRANCH = `chore/bump-deps-${DATE.replaceAll('-', '')}`
const LIST = `list --repo acme/fixture --state open --search "chore: bump packages" in:title --json number,headRefName,title,isCrossRepository,headRepositoryOwner`

// The stub gh (CommonJS). It logs every call to GH_STUB_CALLS, answers `pr` and
// `repo` from GH_STUB_STATE, and passes anything else to the real gh.
const STUB = `const fs = require('node:fs')
const a = process.argv.slice(2)
fs.appendFileSync(process.env.GH_STUB_CALLS, JSON.stringify(a) + '\\n')
if (a[0] !== 'pr' && a[0] !== 'repo') {
  const r = require('node:child_process').spawnSync(process.env.GH_REAL, a, { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
const file = process.env.GH_STUB_STATE
const st = JSON.parse(fs.readFileSync(file, 'utf8'))
const opt = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined)
const repo = opt('--repo') || 'acme/fixture'
const find = () => st.prs.find((p) => String(p.number) === a[2])
const pick = (p) => Object.fromEntries(opt('--json').split(',').map((k) => [k, p[k]]))
const body = () => fs.readFileSync(opt('--body-file'), 'utf8')
let out = ''
if (a[0] === 'repo') {
  out = JSON.stringify({ nameWithOwner: repo, defaultBranchRef: { name: 'main' } })
} else if (a[1] === 'list') {
  out = JSON.stringify(st.prs.filter((p) => p.state === 'OPEN').map(pick))
} else if (a[1] === 'create') {
  const number = st.next++
  st.prs.push({ number, state: 'OPEN', title: opt('--title'), headRefName: opt('--head'),
    isCrossRepository: false, headRepositoryOwner: { login: repo.split('/')[0] }, body: body() })
  out = 'https://github.com/' + repo + '/pull/' + number
} else if (a[1] === 'edit') {
  find().body = body()
} else if (a[1] === 'view') {
  out = opt('-q') === '.body' ? find().body : JSON.stringify(pick(find()))
} else {
  process.stderr.write('gh stub: not supported: ' + a.join(' ') + '\\n')
  process.exit(1)
}
fs.writeFileSync(file, JSON.stringify(st, null, 2))
process.stdout.write(out + '\\n')
`
const GITCONFIG = `[user]\n\tname = e2e\n\temail = e2e@example.com
[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n`

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const writeJson = (p, v) => {
  fs.mkdirSync(dirname(p), { recursive: true })
  fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`)
}

// A throwaway repo. `check` is the root check script; `pnpm` the packageManager
// version (default: the pnpm that runs here, so corepack downloads nothing).
function fixture({ check = 'node -e 0', pnpm, prs = [] } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bump-e2e-')))
  const bin = join(tmp, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(join(bin, 'gh.cjs'), STUB)
  const sh = `#!/bin/sh\nexec node '${bin}/gh.cjs' "$@"\n`
  fs.writeFileSync(join(bin, 'gh'), sh, { mode: 0o755 })
  fs.writeFileSync(join(tmp, 'gitconfig'), GITCONFIG)
  const fx = {
    tmp,
    origin: join(tmp, 'github.com', 'acme', 'fixture.git'),
    main: join(tmp, 'main'),
    state: join(tmp, 'gh-state.json'),
    calls: join(tmp, 'gh-calls.jsonl'),
    runs: 0,
  }
  fx.env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GH_REAL: execFileSync('sh', ['-c', 'command -v gh'], { encoding: 'utf8' }),
    GH_STUB_STATE: fx.state,
    GH_STUB_CALLS: fx.calls,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  }
  fx.env.GH_REAL = fx.env.GH_REAL.trim()
  const opts = { env: fx.env, encoding: 'utf8', maxBuffer: 64 << 20 }
  fx.sh = (cwd, cmd, ...args) =>
    execFileSync(cmd, args, { ...opts, cwd, stdio: 'pipe' }).trim()
  fx.git = (cwd, ...args) => fx.sh(cwd, 'git', ...args)
  fx.og = (...args) => fx.git(fx.origin, ...args)
  writeJson(fx.state, { next: 10, prs })
  fs.writeFileSync(fx.calls, '')
  fx.git(tmp, 'init', '-q', '--bare', '-b', 'main', fx.origin)
  const m = fx.main
  writeJson(join(m, 'package.json'), {
    name: 'fixture',
    private: true,
    packageManager: `pnpm@${pnpm ?? fx.sh(tmp, 'pnpm', '--version')}`,
    scripts: {
      build: 'node -e 0',
      check,
      'check:types': 'node -e 0',
      test: 'node -e 0',
      regen: 'rm -f pnpm-lock.yaml && pnpm install && pnpm dedupe',
    },
    devDependencies: { picocolors: '1.0.0' },
  })
  const scripts = { 'check:types': 'node -e 0' }
  const deps = { kleur: '3.0.3', ms: '2.1.1' }
  writeJson(join(m, 'packages/lib/package.json'), {
    ...{ name: 'fx-lib', version: '1.0.0', scripts, dependencies: deps },
  })
  writeJson(join(m, 'packages/app/package.json'), {
    ...{ name: 'fx-app', version: '1.0.0', private: true, scripts },
    dependencies: { 'fx-lib': 'workspace:*' },
  })
  writeJson(join(m, '.changeset/config.json'), {
    ...{ changelog: false, commit: false, access: 'public' },
    baseBranch: 'main',
    privatePackages: { version: false, tag: false },
  })
  const yaml = 'packages:\n  - packages/*\nminimumReleaseAge: 1440\n'
  fs.writeFileSync(join(m, 'pnpm-workspace.yaml'), yaml)
  fs.writeFileSync(join(m, '.gitignore'), '.claude/worktrees/\nnode_modules\n')
  fx.git(m, 'init', '-q', '-b', 'main')
  lockAt(fx, m, [
    ['.', 'devDependencies', 'picocolors', '1.0.0', '^1.0.0'],
    ['packages/lib', 'dependencies', 'ms', '2.1.1', '^2.1.1'],
    ['packages/lib', 'dependencies', 'kleur', '3.0.3', '^3.0.3'],
  ])
  fx.git(m, 'add', '-A')
  fx.git(m, 'commit', '-q', '-m', 'chore: init')
  fx.git(m, 'remote', 'add', 'origin', fx.origin)
  fx.git(m, 'push', '-q', '-u', 'origin', 'main')
  fx.git(m, 'remote', 'set-head', 'origin', 'main')
  return fx
}

// Install exact versions, then write `spec` into package.json and the lockfile
// importer: the lockfile keeps the old version under a caret range (a plain
// install takes the newest). `deps` is [[project, field, name, version, spec]].
function lockAt(fx, dir, deps) {
  const set = (rel, field, name, v) => {
    const file = join(dir, rel, 'package.json')
    const pj = readJson(file)
    pj[field][name] = v
    writeJson(file, pj)
  }
  for (const [rel, field, name, version] of deps) {
    set(rel, field, name, version)
  }
  fx.sh(dir, 'pnpm', 'install')
  const lockFile = join(dir, 'pnpm-lock.yaml')
  let lock = fs.readFileSync(lockFile, 'utf8')
  for (const [rel, field, name, version, spec] of deps) {
    set(rel, field, name, spec)
    const re = new RegExp(`(\\n\\s+${name}:\\n\\s+specifier: )${version}\\n`)
    assert.match(lock, re)
    lock = lock.replace(re, `$1${spec}\n`)
  }
  fs.writeFileSync(lockFile, lock)
  fx.sh(dir, 'pnpm', 'install', '--frozen-lockfile')
}

// Run bump.mjs on the fixture: { code, json, err }. Async, so fixtures can run
// in parallel.
function runBump(fx, ...args) {
  const out = join(fx.tmp, `out-${++fx.runs}`)
  const argv = [BUMP, '--repo', fx.main, '--out', out, ...args]
  const child = spawn('node', argv, { env: fx.env })
  let stdout = ''
  let err = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (err += d))
  return new Promise((done) =>
    child.on('close', (code) => {
      let json = null
      try {
        json = JSON.parse(stdout)
      } catch {}
      done({ code, json, err })
    })
  )
}

const why = (r) => r.err.slice(-4000) // the tail of stderr, for a failure
// The `gh pr` calls, as strings without the leading `pr`.
const ghCalls = (fx) =>
  fs
    .readFileSync(fx.calls, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((a) => a[0] === 'pr')
    .map((a) => a.slice(1).join(' '))
const git0 = (fx, ...args) =>
  spawnSync('git', args, { cwd: fx.origin, env: fx.env, encoding: 'utf8' })
const originRef = (fx, ref) => {
  const r = git0(fx, 'rev-parse', '--verify', '--quiet', ref)
  return r.status === 0 ? r.stdout.trim() : null
}
const isAncestor = (fx, a, b) =>
  git0(fx, 'merge-base', '--is-ancestor', a, b).status === 0
const showAt = (fx, ref, path) => fx.git(fx.origin, 'show', `${ref}:${path}`)
const mainState = (fx) =>
  ['symbolic-ref HEAD', 'rev-parse HEAD', 'status --porcelain'].map((c) =>
    fx.git(fx.main, ...c.split(' '))
  )

describe('bump.mjs end to end', { skip, concurrency: true }, () => {
  describe('one fixture, in order: 1-4, 6', { concurrency: false }, () => {
    let fx
    let wt // the worktree of the bump PR
    let prHead // the PR branch head on origin

    test('1. dry run in new mode: a plan, nothing changes', async () => {
      fx = fixture()
      const before = mainState(fx)
      const r = await runBump(fx, '--dry-run')
      assert.equal(r.code, 0, why(r))
      assert.equal(r.json.mode, 'new')
      assert.equal(r.json.branch, null)
      const bumps = r.json.applied.bumps.map((b) => b.name).sort()
      assert.deepEqual(bumps, ['ms', 'picocolors'])
      const major = r.json.decisions.find((d) => d.name === 'kleur')
      assert.equal(major?.kind, 'major')
      assert.deepEqual(mainState(fx), before)
      assert.equal(fx.git(fx.main, 'branch', '--list', 'chore/*'), '')
      assert.equal(fs.existsSync(r.json.worktree), false)
      const wts = fx.git(fx.main, 'worktree', 'list', '--porcelain')
      assert.equal(wts.split('\n\n').length, 1)
      assert.equal(originRef(fx, BRANCH), null)
      assert.deepEqual(ghCalls(fx), [LIST])
    })

    test('2. full run in new mode: branch, commits, push, PR', async (t) => {
      const before = mainState(fx)
      const r = await runBump(fx)
      t.diagnostic(`timings: ${JSON.stringify(r.json?.timings)}`)
      assert.equal(r.code, 0, why(r))
      assert.equal(r.json.branch, BRANCH)
      prHead = originRef(fx, BRANCH)
      assert.ok(prHead, 'the branch is on origin')
      const log = fx.og('log', '--reverse', '--format=%s', `main..${BRANCH}`)
      assert.equal(
        log,
        'chore: bump packages\nchore: regenerate the lockfile',
        'the lockfile commit is last'
      )
      const lib = JSON.parse(showAt(fx, BRANCH, 'packages/lib/package.json'))
      assert.deepEqual(lib.dependencies, { kleur: '^3.0.3', ms: '^2.1.3' })
      const root = JSON.parse(showAt(fx, BRANCH, 'package.json'))
      assert.equal(root.devDependencies.picocolors, '^1.1.1')
      const lock = showAt(fx, BRANCH, 'pnpm-lock.yaml')
      assert.match(lock, /\n {2}ms@2\.1\.3:/)
      assert.match(lock, /\n {2}picocolors@1\.1\.1:/)
      assert.doesNotMatch(lock, /ms@2\.1\.1|picocolors@1\.0\.0/)
      // One changeset, for the published package only (not fx-app, not root).
      const cs = fx.og('ls-tree', '--name-only', BRANCH, '.changeset/')
      const csFile = `.changeset/bump-packages-${DATE}.md`
      assert.equal(cs, `${csFile}\n.changeset/config.json`)
      const csText = showAt(fx, BRANCH, csFile)
      assert.equal(csText, '---\n"fx-lib": patch\n---\n\nUpdate `ms` to 2.1.3.')
      const create = ghCalls(fx).find((c) => c.startsWith('create'))
      const head = `--head ${BRANCH} --title chore: bump packages --body-file`
      assert.ok(create?.includes(`--base main ${head}`), create)
      const pr = readJson(fx.state).prs.find((p) => p.headRefName === BRANCH)
      assert.match(pr.body, /`ms` .* 2\.1\.1 \| 2\.1\.3/)
      assert.match(pr.body, /`picocolors` .* 1\.0\.0 \| 1\.1\.1/)
      assert.match(r.json.pr, /\/pull\/10$/)
      assert.deepEqual(mainState(fx), before)
      wt = r.json.worktree
    })

    test('3. second run on the open PR: nothing to bump', async (t) => {
      const calls = ghCalls(fx).length
      const r = await runBump(fx)
      t.diagnostic(`timings: ${JSON.stringify(r.json?.timings)}`)
      assert.equal(r.code, 0, why(r))
      assert.equal(r.json.mode, 'open-pr')
      assert.equal(r.json.pr, 10)
      assert.equal(r.json.worktree, wt, 'reuses the worktree of the PR')
      assert.equal(r.json.message, 'nothing to bump')
      assert.deepEqual(r.json.commits, [])
      assert.equal(originRef(fx, BRANCH), prHead, 'nothing pushed')
      assert.deepEqual(ghCalls(fx).slice(calls), [LIST])
      const todo = 'regen, the checks and the audit run with nothing applied'
      await t.test('no wasted work', { todo }, () =>
        assert.ok(!('checks' in r.json.timings))
      )
    })

    test('4. open PR after main moved: a lockfile-only conflict', async () => {
      const other = join(fx.tmp, 'other')
      fx.git(fx.tmp, 'clone', '-q', fx.origin, other)
      // main locks ms 2.1.2 (same range): the PR changed the same lockfile lines.
      lockAt(fx, other, [
        ['packages/lib', 'dependencies', 'ms', '2.1.2', '^2.1.1'],
      ])
      assert.equal(fx.git(other, 'status', '--porcelain'), 'M pnpm-lock.yaml')
      fx.git(other, 'commit', '-q', '-am', 'chore: lock ms 2.1.2')
      fx.git(other, 'push', '-q', 'origin', 'main')
      const mainTip = originRef(fx, 'main')
      const calls = ghCalls(fx).length
      const r = await runBump(fx)
      assert.equal(r.code, 0, why(r))
      assert.equal(r.json.mode, 'open-pr')
      assert.equal(r.json.mergedMain, true)
      assert.equal(r.json.lockfileFromMain, true, 'the merge had a conflict')
      const tip = originRef(fx, BRANCH)
      assert.ok(isAncestor(fx, prHead, tip), 'no force-push')
      assert.ok(isAncestor(fx, mainTip, tip), 'the PR branch has main')
      const lock = showAt(fx, BRANCH, 'pnpm-lock.yaml')
      assert.match(lock, /\n {2}ms@2\.1\.3:/)
      assert.doesNotMatch(lock, /ms@2\.1\.[12]:/)
      assert.equal(fx.git(wt, 'rev-parse', 'HEAD'), tip)
      assert.equal(fx.git(wt, 'status', '--porcelain'), '')
      fx.sh(wt, 'pnpm', 'install', '--frozen-lockfile', '--offline')
      const edits = ghCalls(fx).slice(calls)
      assert.deepEqual(
        edits.map((c) => c.split(' ').slice(0, 2).join(' ')),
        ['list --repo', 'view 10', 'edit 10']
      )
      assert.match(readJson(fx.state).prs[0].body, /\n## Run /)
      prHead = tip
    })

    test('6. lockfile STOP: an unapproved major exits 3', async () => {
      // SKILL.md §3: commit the major in the worktree, then run the script again.
      const file = join(wt, 'packages/lib/package.json')
      const pj = readJson(file)
      pj.dependencies.kleur = '^4.1.5'
      writeJson(file, pj)
      fx.git(wt, 'commit', '-q', '--no-verify', '-am', 'chore: bump kleur to 4')
      const head = fx.git(wt, 'rev-parse', 'HEAD')
      // A dry run cannot install this state; it stops and leaves the worktree.
      const dry = await runBump(fx, '--dry-run')
      assert.equal(dry.code, 2, why(dry))
      assert.match(dry.json.message, /install --frozen-lockfile failed/)
      assert.equal(fx.git(wt, 'status', '--porcelain'), '', 'dry run: clean')
      const calls = ghCalls(fx).length
      const r = await runBump(fx)
      assert.equal(r.code, 3, why(r))
      assert.match(r.json.message, /major jump: kleur 3\.0\.3 → 4\.1\.5/)
      assert.deepEqual(r.json.commits, [])
      assert.equal(fx.git(wt, 'rev-parse', 'HEAD'), head, 'nothing committed')
      assert.equal(originRef(fx, BRANCH), prHead, 'nothing pushed')
      assert.deepEqual(ghCalls(fx).slice(calls), [LIST])
      // The approval: reset as the summary says, run again with --expect-majors.
      fx.git(wt, 'reset', '-q', '--hard', 'HEAD')
      fx.git(wt, 'clean', '-qfd', '--', '.changeset')
      const ok = await runBump(fx, '--expect-majors', 'kleur')
      assert.equal(ok.code, 0, why(ok))
      assert.deepEqual(
        ok.json.commits.map((c) => c.message),
        ['chore: regenerate the lockfile']
      )
      assert.ok(isAncestor(fx, head, originRef(fx, BRANCH)))
      const lock = showAt(fx, BRANCH, 'pnpm-lock.yaml')
      assert.match(lock, /\n {2}kleur@4\.1\.5:/)
    })
  })

  test('5. a failed check exits 4 and commits nothing', async () => {
    // It fails on the bump branch only: step 7 writes the changeset first.
    const check = `node -e "process.exit(require('fs').readdirSync('.changeset').some((f) => f.startsWith('bump-')) ? 1 : 0)"`
    const fx = fixture({ check })
    const r = await runBump(fx)
    assert.equal(r.code, 4, why(r))
    assert.match(r.json.message, /1 check\(s\) failed: check$/)
    assert.deepEqual(r.json.commits, [])
    const ahead = fx.git(fx.main, 'rev-list', '--count', `main..${BRANCH}`)
    assert.equal(ahead, '0', 'no commit on the local branch')
    assert.equal(originRef(fx, BRANCH), null, 'nothing pushed')
    assert.deepEqual(ghCalls(fx), [LIST])
    assert.match(r.err, /### FAILED: check /)
    assert.match(r.err, /Nothing was committed/)
    assert.match(
      r.err,
      /reset --hard HEAD && git -C '.+' clean -fd -- \.changeset/
    )
    assert.match(r.err, /pnpm -C '.+' install --frozen-lockfile/)
  })

  test('7. guards: a fork PR, a PR on main or on another branch', async () => {
    const pr = (number, headRefName, extra = {}) => ({
      ...{ number, state: 'OPEN', title: 'chore: bump packages', body: '' },
      headRefName,
      isCrossRepository: false,
      headRepositoryOwner: { login: 'acme' },
      ...extra,
    })
    const evil = {
      isCrossRepository: true,
      headRepositoryOwner: { login: 'x' },
    }
    const prs = [pr(1, BRANCH, evil), pr(2, 'main'), pr(3, 'feature/x')]
    const fx = fixture({ prs })
    const mainTip = originRef(fx, 'main')
    const r = await runBump(fx)
    assert.equal(r.code, 0, why(r))
    assert.equal(r.json.mode, 'new')
    assert.equal(r.json.branch, BRANCH)
    const notes = r.json.notes.join('\n')
    assert.match(notes, /#1 is not reused: from a fork/)
    assert.match(notes, /#2 is not reused: branch main is not/)
    assert.match(notes, /#3 is not reused: branch feature\/x is not/)
    assert.equal(originRef(fx, 'main'), mainTip, 'main on origin is unchanged')
    assert.equal(fx.git(fx.main, 'rev-parse', 'main'), mainTip)
    const calls = ghCalls(fx).map((c) => c.split(' ')[0])
    assert.deepEqual(calls, ['list', 'create'])
    assert.ok(originRef(fx, BRANCH))
  })

  test('8. pnpm update inside the major (--no-push)', async () => {
    // The target is the newest aged pnpm. Today it is 12.18.0, in the corepack
    // cache next to 12.14.0. A newer 12.x means a download; an aged pnpm 13
    // makes the target a major (a decision), and this case then fails.
    const fx = fixture({ pnpm: '12.14.0' })
    const r = await runBump(fx, '--no-push')
    assert.equal(r.code, 0, why(r))
    const to = r.json.applied.pnpm?.to
    assert.match(to ?? '', /^12\./)
    assert.equal(r.json.applied.pnpm.from, '12.14.0')
    assert.deepEqual(
      r.json.commits.map((c) => c.message),
      [
        'chore: bump packages',
        `chore: bump pnpm to ${to} and regenerate the lockfile`,
      ]
    )
    const wt = r.json.worktree
    const pm = readJson(join(wt, 'package.json')).packageManager
    assert.ok(pm.startsWith(`pnpm@${to}+sha512.`), pm)
    const bumpPj = fx.git(wt, 'show', 'HEAD~1:package.json')
    assert.ok(
      bumpPj.includes('"pnpm@12.14.0"'),
      'pnpm moves in the last commit'
    )
    assert.equal(fx.sh(wt, 'pnpm', '--version'), to)
    assert.equal(originRef(fx, BRANCH), null, '--no-push')
    assert.deepEqual(ghCalls(fx), [LIST])
  })
})
