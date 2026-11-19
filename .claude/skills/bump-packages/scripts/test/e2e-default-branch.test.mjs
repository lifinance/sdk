// End-to-end test of bump.mjs (see e2e-fixture.js): a repo whose default branch is not
// main, a repo without origin/HEAD, and the `checks` key of the config file.
// Opt-in: it needs the npm registry and gh; it takes about a minute.
// Run: BUMP_E2E=1 node --test <skill>/scripts/test/e2e-default-branch.test.mjs

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  BRANCH,
  fixture,
  ghCalls,
  isAncestor,
  originRef,
  pushToMain,
  readJson,
  runBump,
  skip,
  why,
  writeJson,
} from './e2e-fixture.js'

describe(
  'bump.mjs default branch and checks',
  { skip, concurrency: true },
  () => {
    test('default branch develop: the run starts from origin/develop, and the PR targets develop', async () => {
      const fx = fixture()
      const staleMain = originRef(fx, 'main')
      fx.git(fx.main, 'checkout', '-q', '-b', 'develop')
      fs.writeFileSync(join(fx.main, 'develop.txt'), 'only on develop\n')
      fx.git(fx.main, 'add', 'develop.txt')
      fx.git(fx.main, 'commit', '-q', '-m', 'chore: a commit only on develop')
      fx.git(fx.main, 'push', '-q', '-u', 'origin', 'develop')
      fx.og('symbolic-ref', 'HEAD', 'refs/heads/develop')
      fx.git(fx.main, 'remote', 'set-head', 'origin', 'develop')
      writeJson(fx.state, { ...readJson(fx.state), defaultBranch: 'develop' })

      const r = await runBump(fx)
      assert.equal(r.code, 0, why(r))
      assert.equal(r.json.defaultBranch, 'develop')
      assert.ok(originRef(fx, BRANCH), 'the bump branch is on origin')
      assert.ok(
        isAncestor(fx, 'develop', BRANCH),
        'the bump branch starts from develop'
      )
      assert.equal(originRef(fx, 'main'), staleMain, 'main is unchanged')
      // The lockfile review trusts the merge-base with develop, not with the old main.
      const rep = readJson(join(fx.tmp, `out-${fx.runs}`, 'lockfile-root.json'))
      const developTip = fx.git(fx.main, 'rev-parse', 'origin/develop')
      assert.equal(rep.trustAnchor, developTip)
      assert.equal(rep.base, developTip)
      const create = ghCalls(fx).find((c) => c.startsWith('create '))
      assert.match(create, / --base develop /)
      assert.doesNotMatch(r.err, /origin\/main/)
    })

    test('origin/HEAD that differs from the default branch on GitHub: exit 2', async () => {
      const fx = fixture()
      fx.git(fx.main, 'checkout', '-q', '-b', 'develop')
      fx.git(fx.main, 'push', '-q', '-u', 'origin', 'develop')
      fx.git(fx.main, 'config', 'remote.origin.followRemoteHEAD', 'never')
      fx.git(fx.main, 'remote', 'set-head', 'origin', 'develop')
      // GitHub (the stub) still says main.
      const r = await runBump(fx, '--dry-run')
      assert.equal(r.code, 2, why(r))
      assert.match(
        r.json.message,
        /origin\/HEAD is origin\/develop, but the default branch on GitHub is main/
      )
    })

    test('no origin/HEAD: exit 2 before any change', async () => {
      const fx = fixture()
      // git 2.48+ recreates origin/HEAD on fetch unless followRemoteHEAD is "never".
      fx.git(fx.main, 'config', 'remote.origin.followRemoteHEAD', 'never')
      fx.git(fx.main, 'remote', 'set-head', 'origin', '-d')
      const r = await runBump(fx, '--dry-run')
      assert.equal(r.code, 2, why(r))
      assert.match(r.json.message, /origin\/HEAD is not set/)
      assert.equal(originRef(fx, BRANCH), null)
    })

    test('a range selector with one exact version and a reason holds a bump into its range', async () => {
      const fx = fixture()
      pushToMain(
        fx,
        {
          'pnpm-workspace.yaml':
            "packages:\n  - packages/*\nminimumReleaseAge: 1440\noverrides:\n  # Old copies only.\n  'ms@<2': 1.0.0\n  # 2.1.2+ changes the output for this test.\n  'ms@>=2.1.2': 2.1.1\n",
        },
        'chore: hold ms below 2.1.2'
      )
      const r = await runBump(fx, '--dry-run')
      assert.equal(r.code, 0, why(r))
      const w = r.json.waiting.find((i) => i.name === 'ms')
      assert.match(
        w?.text ?? '',
        /held at 2\.1\.1 by override ms@(?:>|&gt;)=2\.1\.2: 2\.1\.1/
      )
      assert.ok(
        !r.json.applied.bumps.some((b) => b.name === 'ms'),
        'ms is not bumped'
      )
    })

    test('build: the key on the default branch names the build check; a branch cannot change it', async () => {
      const fx = fixture()
      const pj = readJson(join(fx.main, 'package.json'))
      pj.scripts.build = 'node -e "process.exit(1)"'
      pj.scripts['build:compile'] = 'node -e 0'
      pushToMain(
        fx,
        {
          'package.json': `${JSON.stringify(pj, null, 2)}\n`,
          '.claude/bump-packages.json': `${JSON.stringify({ build: 'build:compile' }, null, 2)}\n`,
        },
        'chore: a compile-only build check'
      )
      const r = await runBump(fx, '--no-push')
      assert.equal(r.code, 0, why(r))
      const names = r.json.checks.map((c) => c.name)
      assert.ok(names.includes('build:compile'), names.join(', '))
      assert.ok(
        !names.includes('build'),
        'the failing build script does not run'
      )
      assert.ok(r.json.checks.find((c) => c.name === 'build:compile').ok)
      assert.match(
        r.json.checks.find((c) => c.name === 'build:compile').cmd,
        / run build:compile$/
      )
      // --skip-check never accepts the build check, also under its configured name.
      const skip = await runBump(
        fx,
        '--skip-check',
        'build:compile',
        '--dry-run'
      )
      assert.equal(skip.code, 2, why(skip))
      assert.match(
        skip.json.message,
        /cannot accept a failure of build:compile/
      )

      // A branch that names another build script: the default branch's value counts.
      const fy = fixture()
      const wt = join(fy.main, '.claude', 'worktrees', 'bump-build-key')
      fy.git(fy.main, 'fetch', '-q', 'origin')
      fy.git(
        fy.main,
        'worktree',
        'add',
        '-q',
        '-b',
        'chore/bump-deps-20991229',
        wt,
        'origin/main'
      )
      fs.mkdirSync(join(wt, '.claude'), { recursive: true })
      fs.writeFileSync(
        join(wt, '.claude/bump-packages.json'),
        `${JSON.stringify({ build: 'check' })}\n`
      )
      fy.git(wt, 'add', '.claude/bump-packages.json')
      fy.git(
        wt,
        'commit',
        '-q',
        '--no-verify',
        '-m',
        'chore: swap the build check'
      )
      const branch = await runBump(fy, '--worktree', wt, '--dry-run')
      assert.equal(branch.code, 0, why(branch))
      assert.match(
        branch.json.notes.join('\n'),
        /the build check on the branch \(check\) is not used: the value comes from origin\/main \(build\)/
      )
    })

    test('a root-only workspace runs the root check:types (pnpm -r matches no project)', async () => {
      const fy = fixture()
      const pk = readJson(join(fy.main, 'package.json'))
      pk.scripts['check:types'] = 'node -e "process.exit(1)"'
      pushToMain(
        fy,
        {
          'package.json': `${JSON.stringify(pk, null, 2)}\n`,
          'pnpm-workspace.yaml':
            "packages:\n  - '.'\nminimumReleaseAge: 1440\n",
        },
        'chore: a root-only workspace'
      )
      const r = await runBump(fy, '--no-push')
      const types = r.json.checks.find((c) => c.name === 'check:types')
      assert.equal(types?.ok, false, `check:types must run and fail: ${why(r)}`)
      assert.equal(r.code, 4, why(r))
    })

    test('a flow-style packages list with more than the root keeps pnpm -r', async () => {
      const fx = fixture()
      const pj = readJson(join(fx.main, 'package.json'))
      pj.scripts['check:types'] = 'node -e "process.exit(1)"'
      pushToMain(
        fx,
        {
          'package.json': `${JSON.stringify(pj, null, 2)}\n`,
          'pnpm-workspace.yaml':
            "packages: ['packages/*']\nminimumReleaseAge: 1440\n",
        },
        'chore: a flow-style packages list'
      )
      const r = await runBump(fx, '--no-push')
      const types = r.json.checks.find((c) => c.name === 'check:types')
      assert.match(
        types?.cmd ?? '',
        / -r --parallel --no-bail check:types$/,
        why(r)
      )
    })

    test('build: a key that names no package.json script is exit 2', async () => {
      const fx = fixture()
      pushToMain(
        fx,
        {
          '.claude/bump-packages.json': `${JSON.stringify({ build: 'build:missing' })}\n`,
        },
        'chore: a build key without a script'
      )
      const r = await runBump(fx, '--dry-run')
      assert.equal(r.code, 2, why(r))
      assert.match(
        r.json.message,
        /build names build:missing, but package\.json has no such script/
      )
    })

    test('a workspace that lists the root and packages type-checks the root too', async () => {
      const fx = fixture()
      const pj = readJson(join(fx.main, 'package.json'))
      pj.scripts['check:types'] = 'node -e "process.exit(1)"'
      pushToMain(
        fx,
        {
          'package.json': `${JSON.stringify(pj, null, 2)}\n`,
          'pnpm-workspace.yaml':
            "packages:\n  - '.'\n  - packages/*\nminimumReleaseAge: 1440\n",
        },
        'chore: the root is a workspace project'
      )
      const r = await runBump(fx, '--no-push')
      const types = r.json.checks.find((c) => c.name === 'check:types')
      assert.match(types?.cmd ?? '', / -r --include-workspace-root /, why(r))
      assert.equal(types.ok, false)
    })

    test('checks: extra package.json scripts run; a bad value is exit 2', async () => {
      const fx = fixture()
      const pj = readJson(join(fx.main, 'package.json'))
      pj.scripts['test:extra'] = 'node -e 0'
      pushToMain(
        fx,
        {
          'package.json': `${JSON.stringify(pj, null, 2)}\n`,
          '.claude/bump-packages.json': `${JSON.stringify({ checks: ['test:extra', 'not-a-script'] }, null, 2)}\n`,
        },
        'chore: an extra check'
      )
      const r = await runBump(fx, '--no-push')
      assert.equal(r.code, 0, why(r))
      const names = r.json.checks.map((c) => c.name)
      assert.ok(names.includes('test:extra'), names.join(', '))
      assert.ok(r.json.checks.find((c) => c.name === 'test:extra').ok)
      assert.match(
        r.json.checks.find((c) => c.name === 'test:extra').cmd,
        / run test:extra$/
      )
      assert.ok(
        !names.includes('not-a-script'),
        'a name without a script is skipped'
      )

      pushToMain(
        fx,
        {
          '.claude/bump-packages.json': `${JSON.stringify({ checks: ['rm -rf /'] })}\n`,
        },
        'chore: a bad check'
      )
      const bad = await runBump(fx, '--dry-run')
      assert.equal(bad.code, 2, why(bad))
      assert.match(
        bad.json.message,
        /checks must be a list of package\.json script names/
      )
    })
  }
)
