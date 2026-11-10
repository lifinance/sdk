// End-to-end test of bump.mjs (see e2e-fixture.js): the rerun and approval flows of
// SKILL.md section 3, the config file, and the refusals of the git step.
// Opt-in: it needs the npm registry and gh; it takes about a minute.
// Run: BUMP_E2E=1 node --test <skill>/scripts/test/e2e-flows.test.mjs

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  BRANCH,
  fixture,
  ghCalls,
  LATEST,
  LIST,
  originRef,
  pushToMain,
  readJson,
  rerunOf,
  runBump,
  runLine,
  showAt,
  skip,
  why,
} from './e2e-fixture.js'

const RESET =
  /\n {2}(git -C '.+' reset --hard HEAD && git -C '.+' clean -fd -- \.changeset)\n/
const messages = (r) => r.json.commits.map((c) => c.message)

describe('bump.mjs flows', { skip, concurrency: true }, () => {
  test('--majors: the range, its own commit, and the changeset line', async () => {
    const fx = fixture()
    const r = await runBump(fx, '--majors', 'kleur', '--no-push')
    assert.equal(r.code, 0, why(r))
    assert.deepEqual(messages(r), [
      'chore: bump packages',
      'chore: bump kleur to 4',
      'chore: regenerate the lockfile',
    ])
    const wt = r.json.worktree
    const at = (ref) =>
      JSON.parse(fx.git(wt, 'show', `${ref}:packages/lib/package.json`))
        .dependencies
    assert.deepEqual(at('HEAD~2'), { kleur: '^3.0.3', ms: '^2.1.3' })
    assert.deepEqual(at('HEAD~1'), { kleur: '^4.1.5', ms: '^2.1.3' })
    const cs = fs
      .readdirSync(join(wt, '.changeset'))
      .find((f) => f.startsWith('bump-packages-'))
    assert.equal(
      fs.readFileSync(join(wt, '.changeset', cs), 'utf8'),
      '---\n"fx-lib": patch\n---\n\nUpdate `kleur` to 4.1.5.\nUpdate `ms` to 2.1.3.\n'
    )
    assert.ok(!r.json.needsUser.some((i) => i.name === 'kleur'))
    assert.match(
      r.err,
      /\n {2}- kleur 3\.0\.3 → 4\.1\.5 \(packages\/lib\) major/
    )
    assert.match(r.err, /Rerun: .* --worktree '.+' --majors kleur/)
  })

  test('exit 4, a fix commit, the reset, then the Rerun line (new mode)', async () => {
    // The check fails on the bump branch until the fix commit changes it.
    const check = `node -e "process.exit(require('fs').readdirSync('.changeset').some((f) => f.startsWith('bump-')) ? 1 : 0)"`
    const fx = fixture({ check })
    const r = await runBump(fx)
    assert.equal(r.code, 4, why(r))
    const wt = r.json.worktree
    const pj = readJson(join(wt, 'package.json'))
    pj.scripts.check = 'node -e 0'
    fs.writeFileSync(
      join(wt, 'package.json'),
      `${JSON.stringify(pj, null, 2)}\n`
    )
    fx.git(
      wt,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      'fix: adapt',
      'package.json'
    )
    const fix = fx.git(wt, 'rev-parse', 'HEAD')
    fx.sh(wt, 'sh', '-c', RESET.exec(r.err)[1])
    assert.equal(fx.git(wt, 'rev-parse', 'HEAD'), fix, 'the reset keeps it')
    const again = await runLine(fx, rerunOf(r))
    assert.equal(again.code, 0, why(again))
    assert.equal(again.json.mode, 'new')
    assert.equal(again.json.worktree, wt)
    const log = fx.git(fx.origin, 'log', '--format=%s', `main..${BRANCH}`)
    assert.match(log, /fix: adapt/)
    assert.match(again.json.pr, /\/pull\/10$/)
  })

  test('auto baseline: not a regression, then --skip-check', async () => {
    const fx = fixture({ check: 'node -e "process.exit(1)"' })
    const r = await runBump(fx)
    assert.equal(r.code, 4, why(r))
    assert.equal(
      r.json.checks.find((c) => c.name === 'check').regression,
      false
    )
    assert.match(
      r.err,
      /check FAIL \(also fails without the bump: not a regression; rerun with --skip-check check\)/
    )
    fx.sh(r.json.worktree, 'sh', '-c', RESET.exec(r.err)[1])
    const again = await runLine(fx, `${rerunOf(r)} --skip-check check`)
    assert.equal(again.code, 0, why(again))
    assert.deepEqual(again.json.skippedChecks, ['check'])
    assert.match(again.err, /- Checks: .*; skipped: check/)
    const body = readJson(fx.state).prs[0].body
    assert.match(body, /skipped \(they also fail on main\): `check`/)
    // An unknown check name stops the run before any change.
    const bad = await runBump(fx, '--skip-check', 'nope', '--dry-run')
    assert.equal(bad.code, 2, why(bad))
    assert.match(
      bad.json.message,
      /unknown check nope\. The checks: build, check/
    )
  })

  test('new mode with nothing to bump removes its worktree and branch', async () => {
    const fx = fixture({ pins: LATEST })
    const r = await runBump(fx)
    assert.equal(r.code, 0, why(r))
    assert.match(
      r.json.message,
      /^nothing to bump; the worktree and the branch/
    )
    assert.equal(fs.existsSync(r.json.worktree), false)
    assert.equal(fx.git(fx.main, 'branch', '--list', 'chore/*'), '')
    assert.ok(!('checks' in r.json.timings), 'no checks')
    assert.doesNotMatch(rerunOf(r), /--worktree/)
  })

  test('an open PR without a local worktree is refused', async () => {
    const pr = {
      number: 5,
      state: 'OPEN',
      title: 'chore: bump packages',
      headRefName: 'chore/bump-deps-20261101',
      isCrossRepository: false,
      headRepositoryOwner: { login: 'acme' },
      body: '',
    }
    const fx = fixture({ prs: [pr] })
    fx.git(fx.main, 'push', '-q', 'origin', `main:refs/heads/${pr.headRefName}`)
    const r = await runBump(fx)
    assert.equal(r.code, 2, why(r))
    assert.match(r.json.message, /#5 .* has no worktree on this machine/)
    assert.match(r.json.message, /worktree add .* chore\/bump-deps-20261101/)
    assert.equal(fx.git(fx.main, 'worktree', 'list').split('\n').length, 1)
    // A dry run plans against origin/main and says so.
    const dry = await runBump(fx, '--dry-run')
    assert.equal(dry.code, 0, why(dry))
    assert.match(
      dry.json.notes.join('\n'),
      /PR #5 exists, .* against origin\/main/
    )
    assert.deepEqual(
      ghCalls(fx).map((c) => c.split(' ')[0]),
      ['list', 'list']
    )
    assert.equal(ghCalls(fx)[0], LIST)
  })

  test('config file and YAML forms: heldMajors, unknown key, flow-style exclude', async () => {
    const fx = fixture()
    const cfg = (c) => ({
      '.claude/bump-packages.json': `${JSON.stringify(c, null, 2)}\n`,
    })
    const held = { name: 'kleur', reason: 'Held for this test. More text.' }
    pushToMain(fx, cfg({ heldMajors: [held] }), 'chore: hold kleur 4')
    const r = await runBump(fx, '--dry-run')
    assert.equal(r.code, 0, why(r))
    assert.ok(!r.json.needsUser.some((i) => i.name === 'kleur'))
    const w = r.json.waiting.find((i) => i.name === 'kleur')
    assert.equal(
      w?.text,
      '4.1.5 is held (.claude/bump-packages.json): Held for this test.'
    )
    pushToMain(fx, cfg({ heldMajors: [], other: 1 }), 'chore: bad config')
    const bad = await runBump(fx, '--dry-run')
    assert.equal(bad.code, 2, why(bad))
    assert.match(bad.json.message, /bump-packages\.json: unknown key other/)
    pushToMain(
      fx,
      {
        ...cfg({}),
        'pnpm-workspace.yaml':
          'packages:\n  - packages/*\nminimumReleaseAge: 1440\nminimumReleaseAgeExclude: [ms]\n',
      },
      'chore: flow-style exclude'
    )
    const flow = await runBump(fx, '--dry-run')
    assert.equal(flow.code, 2, why(flow))
    assert.match(
      flow.json.message,
      /pnpm-workspace\.yaml .*line 4 \(minimumReleaseAgeExclude: \[ms\]\)/
    )
    assert.equal(originRef(fx, BRANCH), null)
    assert.ok(showAt(fx, 'main', '.claude/bump-packages.json'))
  })

  test('a branch that lowers the release-age gate is refused before any install', async () => {
    const fx = fixture()
    const wt = join(fx.main, '.claude', 'worktrees', 'bump-lower')
    fx.git(
      fx.main,
      'worktree',
      'add',
      '-q',
      '-b',
      'chore/bump-deps-20991231',
      wt,
      'origin/main'
    )
    fs.writeFileSync(
      join(wt, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\nminimumReleaseAge: 60\n'
    )
    fx.git(wt, 'commit', '-q', '--no-verify', '-am', 'chore: lower the gate')
    const r = await runBump(fx, '--worktree', wt, '--dry-run')
    assert.equal(r.code, 2, why(r))
    assert.match(
      r.json.message,
      /lowers the release-age gate: minimumReleaseAge 60 on the branch, 1440 on origin\/main/
    )
    assert.ok(!('install' in r.json.timings), 'no install')
  })
})
