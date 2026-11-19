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
            "packages:\n  - packages/*\nminimumReleaseAge: 1440\noverrides:\n  # 2.1.2+ changes the output for this test.\n  'ms@>=2.1.2': 2.1.1\n",
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
