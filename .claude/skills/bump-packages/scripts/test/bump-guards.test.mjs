// Unit tests for the guards of bump.mjs (review fixes). No network; the CLI tests start
// bump.mjs only with --help or a wrong option, which exit before any git or npm call.
// Run: node --test <skill>/scripts/test/*.test.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  branchGuard,
  earlierExcludes,
  editExcludesDetailed,
  mdSafe,
  pickBumpPr,
  prRunSection,
  recheckFlags,
  setDependencySpec,
  yamlList,
} from '../lib.js'

const BUMP = join(dirname(fileURLToPath(import.meta.url)), '..', 'bump.mjs')

test('pickBumpPr: never a fork PR, only a chore/bump-deps-<yyyymmdd> branch', () => {
  const pr = (number, headRefName, extra = {}) => ({
    number,
    headRefName,
    title: 'chore: bump packages',
    isCrossRepository: false,
    headRepositoryOwner: { login: 'lifinance' },
    ...extra,
  })
  const { pr: chosen, rejected } = pickBumpPr(
    [
      pr(1, 'main', {
        isCrossRepository: true,
        headRepositoryOwner: { login: 'evil' },
      }),
      pr(2, 'main'),
      pr(3, 'chore/bump-deps-20261110', {
        headRepositoryOwner: { login: 'evil' },
      }),
      pr(4, 'feature/x'),
      pr(5, 'chore/bump-deps-20261110-2'),
      {
        ...pr(6, 'chore/bump-deps-20261111'),
        title: 'chore: bump packages (draft)',
      },
    ],
    'lifinance'
  )
  assert.equal(chosen.number, 5)
  assert.deepEqual(
    rejected.map((r) => r.number),
    [1, 2, 3, 4]
  )
  assert.match(rejected[0].why, /fork/)
  assert.equal(pickBumpPr([pr(7, 'main')], 'lifinance').pr, null)
})

test('branchGuard: never main, the default branch, another branch, or the main checkout', () => {
  const ok = {
    branch: 'chore/bump-deps-20261110',
    defaultBranch: 'main',
    worktree: '/r/.claude/worktrees/bump-2026-11-10',
    mainCheckout: '/r',
  }
  assert.equal(branchGuard(ok), null)
  assert.match(branchGuard({ ...ok, branch: 'main' }), /default branch/)
  assert.match(
    branchGuard({
      ...ok,
      branch: 'chore/bump-deps-20261110',
      defaultBranch: 'chore/bump-deps-20261110',
    }),
    /default branch/
  )
  assert.match(branchGuard({ ...ok, branch: 'develop' }), /not a bump branch/)
  assert.match(branchGuard({ ...ok, worktree: '/r' }), /main checkout/)
  assert.match(branchGuard({ ...ok, branch: null }), /default branch/)
})

test('earlierExcludes: only entries that the script\'s own "chore: allow" commits added', () => {
  const r = earlierExcludes({
    baseEntries: [
      '@lifi/*',
      'viem@2.57.17',
      'evil@1.2.3',
      'motion@14.12.0',
      'bare-name',
    ],
    mainEntries: ['@lifi/*'],
    commits: [
      {
        subject: 'chore: allow fresh releases past the release-age gate',
        added: ['motion@14.12.0'],
      },
      {
        subject: 'chore: allow viem@2.57.17 past the release-age gate',
        added: ['viem@2.57.17'],
      },
      { subject: 'chore: bump packages', added: ['evil@1.2.3'] },
      { subject: 'chore: allow anything', added: ['bare-name'] },
    ],
  })
  assert.deepEqual(r.trusted, ['viem@2.57.17', 'motion@14.12.0'])
  // A hand-pushed entry, and a bare name even from an allow commit, are not trusted.
  assert.deepEqual(r.untrusted, ['evil@1.2.3', 'bare-name'])
})

test('recheckFlags: a compromise sign or a check that cannot run stops the run', () => {
  const meta = (user, scripts = {}) => ({ _npmUser: { name: user }, scripts })
  const clean = {
    f: meta('a'),
    b: meta('a'),
    adv: { hits: [] },
    pkg: [],
    prov: { flags: [], compromise: [], verified: false },
  }
  assert.deepEqual(recheckFlags('x@1.0.1', clean), [])
  assert.match(
    recheckFlags('x@1.0.1', { ...clean, f: meta('b') })[0],
    /publisher changed/
  )
  assert.match(
    recheckFlags('x@1.0.1', {
      ...clean,
      f: meta('a', { postinstall: 'node x' }),
    })[0],
    /postinstall/
  )
  assert.match(
    recheckFlags('x@1.0.1', {
      ...clean,
      adv: { hits: [{ type: 'malware', ghsa: 'GHSA-1' }] },
    })[0],
    /malware advisory GHSA-1/
  )
  assert.match(
    recheckFlags('x@1.0.1', { ...clean, adv: { error: 'gh failed' } })[0],
    /cannot run/
  )
  assert.match(
    recheckFlags('x@1.0.1', { ...clean, pkg: null })[0],
    /cannot run/
  )
  assert.match(
    recheckFlags('x@1.0.1', {
      ...clean,
      pkg: [{ ghsa: 'GHSA-2', version: '1.0.1' }],
    })[0],
    /on the package/
  )
  assert.match(
    recheckFlags('x@1.0.1', {
      ...clean,
      prov: { flags: ['x@1.0.1: provenance attestation dropped'] },
    })[0],
    /dropped/
  )
  assert.match(
    recheckFlags('x@1.0.1', { ...clean, f: null })[0],
    /cannot check/
  )
})

test('setDependencySpec edits only the top-level field, never a nested one', () => {
  const pkg = `{
  "name": "x",
  "pnpm": {
    "packageExtensions": {
      "foo@1": {
        "dependencies": {
          "viem": "^2.0.0"
        }
      }
    }
  },
  "description": "has \\"dependencies\\": { inside a string",
  "dependencies": {
    "viem": "^2.57.7"
  }
}
`
  const out = setDependencySpec(pkg, 'dependencies', 'viem', '^2.57.17')
  assert.match(
    out,
    /"foo@1": \{\n {8}"dependencies": \{\n {10}"viem": "\^2\.0\.0"/,
    'nested one unchanged'
  )
  assert.match(out, /\n {2}"dependencies": \{\n {4}"viem": "\^2\.57\.17"/)
  assert.equal(JSON.parse(out).dependencies.viem, '^2.57.17')
  // Only nested: not found.
  assert.equal(
    setDependencySpec(
      '{"pnpm":{"dependencies":{"viem":"1.0.0"}}}',
      'dependencies',
      'viem',
      '2.0.0'
    ),
    null
  )
})

test('editExcludesDetailed: blank lines inside the list, and a||b items', () => {
  const yaml = `minimumReleaseAgeExclude:
  - '@lifi/*'

  - viem@2.57.17
  - 'webpack@4.47.0 || 5.102.1'
  - left@1.0.0 || 1.1.0

# the comment of the next key
overrides:
  a: 1
`
  // The same item region as yamlList: the entry after the blank line is seen.
  assert.ok(yamlList(yaml, 'minimumReleaseAgeExclude').includes('viem@2.57.17'))
  const r = editExcludesDetailed(yaml, {
    remove: [
      'viem@2.57.17',
      'webpack@4.47.0',
      'left@1.0.0',
      'left@1.1.0',
      'absent@9.9.9',
    ],
  })
  assert.deepEqual(r.removed.sort(), [
    'left@1.0.0',
    'left@1.1.0',
    'viem@2.57.17',
    'webpack@4.47.0',
  ])
  assert.deepEqual(yamlList(r.text, 'minimumReleaseAgeExclude'), [
    '@lifi/*',
    'webpack@5.102.1',
  ])
  assert.match(
    r.text,
    /# the comment of the next key\noverrides:\n {2}a: 1\n$/,
    'the next key keeps its comment'
  )
})

test('mdSafe and the PR text: scoped names are always in backticks', () => {
  assert.equal(
    mdSafe('held by @lifi/sdk@4.12.1 and `@lifi/types`'),
    'held by `@lifi/sdk@4.12.1` and `@lifi/types`'
  )
  assert.equal(
    mdSafe('mail imchybisov@gmail.com stays'),
    'mail imchybisov@gmail.com stays'
  )
  const s = prRunSection({
    decisions: [
      {
        kind: 'fast-track blocked',
        name: '@dynamic-labs/sdk',
        project: '.',
        detail: 'Red flags: @dynamic-labs/sdk@4.5.1: publisher changed.',
      },
    ],
    lockfile: { majors: [], singleCopy: ['@lifi/sdk 4.12.1'] },
    audit: {},
    checks: [],
  })
  assert.doesNotMatch(
    s.replace(/`[^`]*`/g, ''),
    /@[\w.-]+\//,
    'no scoped name outside backticks'
  )
})

test('bump.mjs --help prints the usage; an unknown option exits 2 with the usage', () => {
  const help = spawnSync(process.execPath, [BUMP, '--help'], {
    encoding: 'utf8',
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage: node bump\.mjs --repo/)
  const bad = spawnSync(process.execPath, [BUMP, '--bogus'], {
    encoding: 'utf8',
  })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /Usage: node bump\.mjs --repo/)
  const none = spawnSync(process.execPath, [BUMP], { encoding: 'utf8' })
  assert.equal(none.status, 2)
})
