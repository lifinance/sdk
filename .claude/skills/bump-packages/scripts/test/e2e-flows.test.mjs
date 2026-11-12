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
  writeJson,
} from './e2e-fixture.js'

const RESET =
  /\n {2}(git -C '.+' reset --hard HEAD && git -C '.+' clean -fd -- \.changeset)\n/
const messages = (r) => r.json.commits.map((c) => c.message)

describe('bump.mjs flows', { skip, concurrency: true }, () => {
  test('--majors: the range, its own commit, and the changeset line', async () => {
    const fx = fixture()
    // L2: a pin that does not match the plan's target is not applied.
    const wrong = await runBump(fx, '--majors', 'kleur@5', '--dry-run')
    assert.equal(wrong.code, 0, why(wrong))
    assert.match(
      wrong.json.notes.join('\n'),
      /--majors kleur@5: the plan's target is 4\.1\.5; not applied/
    )
    assert.equal(
      wrong.json.needsUser.find((i) => i.name === 'kleur')?.flag,
      '--majors kleur@4'
    )
    // L1: a repeated flag keeps every value.
    const r = await runBump(
      fx,
      '--majors',
      'kleur@4',
      '--majors',
      'nope',
      '--no-push'
    )
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
    assert.match(
      r.err,
      /Rerun: .* --worktree '.+' --majors kleur@4,nope --no-push\n/
    )
    // H3: the next run has unpushed commits: the review and the checks run first.
    // M1: `gh pr create` fails after the commits: the tree is clean, so no reset line.
    const rerun = rerunOf(r).replace(' --no-push', '')
    const state = readJson(fx.state)
    writeJson(fx.state, { ...state, failCreate: true })
    const failed = await runLine(fx, rerun)
    assert.equal(failed.code, 2, why(failed))
    assert.ok('checks' in failed.json.timings, 'the checks ran')
    assert.doesNotMatch(failed.err, /To discard them/)
    assert.ok(originRef(fx, BRANCH), 'pushed before the PR step')
    // The branch is on origin now, but no PR: the next run opens it.
    writeJson(fx.state, { ...readJson(fx.state), failCreate: false })
    const again = await runLine(fx, rerun)
    assert.equal(again.code, 0, why(again))
    assert.match(again.json.pr, /\/pull\/10$/)
    assert.equal(
      again.json.message,
      'pushed the local commits; nothing else to bump'
    )
  })

  test('exit 4, a fix commit, the reset, then the Rerun line (new mode)', async () => {
    // The check fails on the bump branch until the fix commit changes it.
    const check = `node -e "process.exit(require('fs').readdirSync('.changeset').some((f) => f.startsWith('bump-')) ? 1 : 0)"`
    const fx = fixture({ check })
    const r = await runBump(fx)
    assert.equal(r.code, 4, why(r))
    const wt = r.json.worktree
    fx.sh(wt, 'sh', '-c', RESET.exec(r.err)[1])
    const skipFirst = await runLine(fx, `${rerunOf(r)} --skip-check check`)
    assert.equal(skipFirst.code, 4, why(skipFirst))
    assert.equal(
      skipFirst.json.checks.find((c) => c.name === 'check').verdict,
      'regression',
      'a regression cannot be skipped (H2)'
    )
    fx.sh(wt, 'sh', '-c', RESET.exec(skipFirst.err)[1])
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
    assert.equal(fx.git(wt, 'status', '--porcelain'), '')
    const again = await runLine(fx, rerunOf(r))
    assert.equal(again.code, 0, why(again))
    assert.equal(again.json.mode, 'new')
    assert.equal(again.json.worktree, wt)
    const log = fx.git(fx.origin, 'log', '--format=%s', `main..${BRANCH}`)
    assert.match(log, /fix: adapt/)
    assert.match(again.json.pr, /\/pull\/10$/)
  })

  test('auto baseline: fails on main, then --skip-check accepts it', async () => {
    const fx = fixture({ check: 'node -e "process.exit(1)"' })
    const r = await runBump(fx)
    assert.equal(r.code, 4, why(r))
    const c = r.json.checks.find((x) => x.name === 'check')
    assert.equal(c.verdict, 'fails-on-main')
    assert.ok(fs.existsSync(c.baselineLog), 'the baseline log stays')
    assert.match(
      r.err,
      /check FAIL \(also fails on main; compare .+check-check\.log with .+baseline\/check-check\.log\)/
    )
    fx.sh(r.json.worktree, 'sh', '-c', RESET.exec(r.err)[1])
    const again = await runLine(fx, `${rerunOf(r)} --skip-check check`)
    assert.equal(again.code, 0, why(again))
    assert.deepEqual(again.json.acceptedChecks, ['check'])
    assert.match(
      again.err,
      /check FAIL \(fails on main too; accepted with --skip-check\)/
    )
    const body = readJson(fx.state).prs[0].body
    assert.match(
      body,
      /`check` FAIL \(fails on main too; accepted with --skip-check\)/
    )
    // A failed build or signature check is never accepted.
    const build = await runBump(fx, '--skip-check', 'build', '--dry-run')
    assert.equal(build.code, 2, why(build))
    assert.match(build.json.message, /cannot accept a failure of build/)
    // An unknown check name stops the run before any change.
    const bad = await runBump(fx, '--skip-check', 'nope', '--dry-run')
    assert.equal(bad.code, 2, why(bad))
    assert.match(
      bad.json.message,
      /unknown check nope\. The checks: build, check/
    )
  })

  test('a failed build: the later checks do not run, exit 4 with the baseline', async () => {
    const fx = fixture()
    const pj = readJson(join(fx.main, 'package.json'))
    pj.scripts.build = `node -e "process.exit(require('fs').readdirSync('.changeset').some((f) => f.startsWith('bump-')) ? 1 : 0)"`
    pushToMain(
      fx,
      { 'package.json': `${JSON.stringify(pj, null, 2)}\n` },
      'chore: a build that fails on the bump'
    )
    const r = await runBump(fx)
    assert.equal(r.code, 4, why(r))
    const by = Object.fromEntries(r.json.checks.map((c) => [c.name, c]))
    assert.equal(by.build.verdict, 'regression')
    assert.equal(by['check:types'].notRun, 'build failed')
    assert.equal(by.test.notRun, 'build failed')
    assert.match(
      r.err,
      /build FAIL \(regression\).*check:types not run \(build failed\)/
    )
    assert.match(r.err, /To discard them:/)
    assert.deepEqual(r.json.commits, [])
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
    pushToMain(
      fx,
      cfg({ heldMajors: [held], fastTrackMinAgeHours: 12 }),
      'chore: hold kleur 4'
    )
    const r = await runBump(fx, '--dry-run')
    assert.equal(r.code, 0, why(r))
    assert.ok(!r.json.needsUser.some((i) => i.name === 'kleur'))
    const w = r.json.waiting.find((i) => i.name === 'kleur')
    assert.equal(
      w?.text,
      '4.1.5 is held (.claude/bump-packages.json): Held for this test.'
    )
    assert.equal(r.json.fastTrackMinAgeHours, 12)
    // L4: a branch cannot lower the floor; main's value counts.
    const wt = join(fx.main, '.claude', 'worktrees', 'bump-floor')
    fx.git(fx.main, 'fetch', '-q', 'origin')
    fx.git(
      fx.main,
      'worktree',
      'add',
      '-q',
      '-b',
      'chore/bump-deps-20991230',
      wt,
      'origin/main'
    )
    fs.writeFileSync(
      join(wt, '.claude/bump-packages.json'),
      `${JSON.stringify({ heldMajors: [held], fastTrackMinAgeHours: 0 })}\n`
    )
    fx.git(wt, 'commit', '-q', '--no-verify', '-am', 'chore: lower the floor')
    const floor = await runBump(fx, '--worktree', wt, '--dry-run')
    assert.equal(floor.code, 0, why(floor))
    assert.equal(floor.json.fastTrackMinAgeHours, 12)
    assert.match(
      floor.json.notes.join('\n'),
      /fastTrackMinAgeHours 0 on the branch is not used/
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
