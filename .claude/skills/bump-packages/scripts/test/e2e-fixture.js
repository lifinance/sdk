// The fixture of the end-to-end tests (e2e*.test.mjs): a throwaway repo with a bare
// origin at <tmp>/github.com/acme/fixture.git, a main checkout with a small pnpm
// workspace, and a stub `gh` that answers `gh pr` from a JSON file (`gh api` goes to
// the real gh). Not a test file itself.

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUMP = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'bump.mjs'
)
export const skip =
  process.env.BUMP_E2E !== '1' && 'set BUMP_E2E=1 (network, ~1 min)'
const pad = (n) => String(n).padStart(2, '0')
const D = new Date()
// The local date, as bump.mjs makes it.
export const DATE = `${D.getFullYear()}-${pad(D.getMonth() + 1)}-${pad(D.getDate())}`
export const BRANCH = `chore/bump-deps-${DATE.replaceAll('-', '')}`
export const LIST = `list --repo acme/fixture --state open --search "chore: bump packages" in:title --json number,headRefName,title,isCrossRepository,headRepositoryOwner`

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

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
export const writeJson = (p, v) => {
  fs.mkdirSync(dirname(p), { recursive: true })
  fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`)
}

// A throwaway repo. `check` is the root check script; `pnpm` the packageManager
// version (default: the pnpm that runs here, so corepack downloads nothing).
const PINS = [
  ['.', 'devDependencies', 'picocolors', '1.0.0', '^1.0.0'],
  ['packages/lib', 'dependencies', 'ms', '2.1.1', '^2.1.1'],
  ['packages/lib', 'dependencies', 'kleur', '3.0.3', '^3.0.3'],
]
// Every dependency at its newest release (nothing to bump).
export const LATEST = [
  ['.', 'devDependencies', 'picocolors', '1.1.1', '^1.1.1'],
  ['packages/lib', 'dependencies', 'ms', '2.1.3', '^2.1.3'],
  ['packages/lib', 'dependencies', 'kleur', '4.1.5', '^4.1.5'],
]

export function fixture({
  check = 'node -e 0',
  pnpm,
  prs = [],
  pins = PINS,
} = {}) {
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
  lockAt(fx, m, pins)
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
export function lockAt(fx, dir, deps) {
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
export function runBump(fx, ...args) {
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

export const why = (r) => r.err.slice(-4000) // the tail of stderr, for a failure
// The `gh pr` calls, as strings without the leading `pr`.
export const ghCalls = (fx) =>
  fs
    .readFileSync(fx.calls, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((a) => a[0] === 'pr')
    .map((a) => a.slice(1).join(' '))
const git0 = (fx, ...args) =>
  spawnSync('git', args, { cwd: fx.origin, env: fx.env, encoding: 'utf8' })
export const originRef = (fx, ref) => {
  const r = git0(fx, 'rev-parse', '--verify', '--quiet', ref)
  return r.status === 0 ? r.stdout.trim() : null
}
export const isAncestor = (fx, a, b) =>
  git0(fx, 'merge-base', '--is-ancestor', a, b).status === 0
export const showAt = (fx, ref, path) =>
  fx.git(fx.origin, 'show', `${ref}:${path}`)
export const mainState = (fx) =>
  ['symbolic-ref HEAD', 'rev-parse HEAD', 'status --porcelain'].map((c) =>
    fx.git(fx.main, ...c.split(' '))
  )

// Run a command line (for example the `Rerun:` line) with the fixture's environment.
export function runLine(fx, line) {
  const child = spawn('sh', ['-c', line], { env: fx.env })
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

// The `Rerun:` line of a summary.
export const rerunOf = (r) => /\nRerun: (.+)\n/.exec(r.err)?.[1]

// Write files in the main checkout, commit them, and push to origin main.
export function pushToMain(fx, files, message) {
  for (const [path, text] of Object.entries(files)) {
    fs.mkdirSync(dirname(join(fx.main, path)), { recursive: true })
    fs.writeFileSync(join(fx.main, path), text)
  }
  fx.git(fx.main, 'add', '-A')
  fx.git(fx.main, 'commit', '-q', '-m', message)
  fx.git(fx.main, 'push', '-q', 'origin', 'main')
}
