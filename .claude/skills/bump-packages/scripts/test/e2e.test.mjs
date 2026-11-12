// End-to-end test of bump.mjs on a throwaway repo (see e2e-fixture.js): the main
// flows. e2e-flows.test.mjs has the rerun and approval flows.
// Opt-in: it needs the npm registry and gh; it takes about a minute.
// Run: BUMP_E2E=1 node --test <skill>/scripts/test/e2e.test.mjs

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  BRANCH,
  DATE,
  fixture,
  ghCalls,
  isAncestor,
  LIST,
  lockAt,
  mainState,
  originRef,
  readJson,
  runBump,
  showAt,
  skip,
  why,
  writeJson,
} from './e2e-fixture.js'

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
      const major = r.json.needsUser.find((d) => d.name === 'kleur')
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
      assert.match(
        pr.body,
        /`ms` \| packages\/lib \| \^2\.1\.1 \| \^2\.1\.3 \| patch/
      )
      assert.match(
        pr.body,
        /`picocolors` \| root \| \^1\.0\.0 \| \^1\.1\.1 \| minor/
      )
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
      // A9: nothing changed after the regeneration: no review, checks or audit.
      assert.deepEqual(Object.keys(r.json.timings), [
        'git',
        'install',
        'analyze',
        'decide',
        'edit',
        'regen',
        'recheck',
        'total',
      ])
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
      assert.match(r.json.notes.join('\n'), /conflict only in pnpm-lock\.yaml/)
      // The text above the block is from an earlier run: the agent updates it.
      assert.match(r.json.notes.join('\n'), /PR #10: .*text above the block/)
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
      // F4: one generated block, replaced (not appended).
      const body = readJson(fx.state).prs[0].body
      assert.equal(body.split('<!-- bump-packages:start -->').length, 2)
      prHead = tip
    })

    test('4b. remote commits on the PR branch are refused, not pulled', async () => {
      const other = join(fx.tmp, 'other')
      fx.git(other, 'fetch', '-q', 'origin')
      fx.git(other, 'checkout', '-q', '-b', 'pr', `origin/${BRANCH}`)
      fs.writeFileSync(join(other, 'NOTE.md'), 'pushed by someone else\n')
      fx.git(other, 'add', 'NOTE.md')
      fx.git(other, 'commit', '-q', '-m', 'docs: a remote commit')
      fx.git(other, 'push', '-q', 'origin', `pr:${BRANCH}`)
      const remote = originRef(fx, BRANCH)
      const r = await runBump(fx)
      assert.equal(r.code, 2, why(r))
      assert.match(
        r.json.message,
        /^The PR branch has commits that this checkout did not make:/
      )
      assert.match(
        r.json.message,
        /Show them to the user\. After the user has reviewed them: git -C/
      )
      assert.match(r.json.message, /docs: a remote commit/)
      assert.match(r.json.message, /merge --ff-only origin\/chore\/bump-deps-/)
      assert.equal(fx.git(wt, 'rev-parse', 'HEAD'), prHead, 'not pulled')
      // After a review, the person fast-forwards by hand, as the message says.
      fx.git(wt, 'merge', '-q', '--ff-only', `origin/${BRANCH}`)
      prHead = remote
    })

    test('6. lockfile STOP: an unapproved major exits 3', async () => {
      // SKILL.md §3: commit the major in the worktree, then run the script again.
      const file = join(wt, 'packages/lib/package.json')
      const pj = readJson(file)
      pj.dependencies.kleur = '^4.1.5'
      writeJson(file, pj)
      fx.git(wt, 'commit', '-q', '--no-verify', '-am', 'chore: bump kleur to 4')
      const head = fx.git(wt, 'rev-parse', 'HEAD')
      // A dry run installs without --frozen-lockfile (A7), then puts the files back.
      const dry = await runBump(fx, '--dry-run')
      assert.equal(dry.code, 0, why(dry))
      assert.match(dry.json.notes.join('\n'), /frozen-lockfile failed/)
      assert.equal(fx.git(wt, 'status', '--porcelain'), '', 'dry run: clean')
      const calls = ghCalls(fx).length
      const r = await runBump(fx)
      assert.equal(r.code, 3, why(r))
      assert.match(r.json.message, /major jump: kleur 3\.0\.3 → 4\.1\.5/)
      assert.deepEqual(r.json.commits, [])
      assert.equal(fx.git(wt, 'rev-parse', 'HEAD'), head, 'nothing committed')
      assert.equal(originRef(fx, BRANCH), prHead, 'nothing pushed')
      assert.deepEqual(ghCalls(fx).slice(calls), [LIST])
      // The approval: reset as the summary says, run again with --majors.
      fx.git(wt, 'reset', '-q', '--hard', 'HEAD')
      fx.git(wt, 'clean', '-qfd', '--', '.changeset')
      const ok = await runBump(fx, '--majors', 'kleur')
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
    // H2: the check passes on main: a regression. M7: the command to reproduce it.
    assert.equal(
      r.json.checks.find((c) => c.name === 'check').verdict,
      'regression'
    )
    assert.match(r.err, /- Checks: .*check FAIL \(regression\)/)
    assert.match(r.err, /\n {2}Reproduce check: pnpm -C '.+' check\n/)
    assert.match(r.err, /### FAILED: check /)
    assert.match(r.err, /Nothing was committed/)
    assert.match(
      r.err,
      /reset --hard HEAD && git -C '.+' clean -fd -- \.changeset/
    )
    assert.match(
      r.err,
      /\nRerun: node .*bump\.mjs' --repo '.+' --worktree '.+'\n/
    )
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
