// Unit tests for the guards of bump.mjs (review fixes). No network; the CLI tests start
// bump.mjs only with --help or a wrong option, which exit before any git or npm call.
// Run: node --test <skill>/scripts/test/*.test.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  branchExcludes,
  branchGuard,
  editExcludesDetailed,
  mdSafe,
  pickBumpPr,
  plain,
  prBlock,
  setDependencySpec,
} from '../bump-helpers.js'
import { gateYamlProblem, minAgeMinutesFromYaml, yamlList } from '../lib.js'
import {
  checkExactEntry,
  metadataFlags,
  referenceVersion,
  trustedPublisherFlags,
} from '../security.js'

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

test('branchExcludes: exact entries that main lacks are rechecked, others stop', () => {
  const r = branchExcludes(
    ['@lifi/*', 'viem@2.57.17', 'motion@14.12.0', 'bare-name', 'x@^1.0.0'],
    ['@lifi/*', 'motion@14.12.0']
  )
  assert.deepEqual(r.exact, ['viem@2.57.17'])
  assert.deepEqual(r.other, ['bare-name', 'x@^1.0.0'])
})

test('gateYamlProblem: only the plain block form of the release-age keys', () => {
  const ok =
    'packages:\n  - a\nminimumReleaseAge: 1440 # one day\nminimumReleaseAgeExclude:\n  - x@1.0.0\n'
  assert.equal(gateYamlProblem(ok), null)
  assert.deepEqual(yamlList(ok, 'minimumReleaseAgeExclude'), ['x@1.0.0'])
  const bad = {
    flow: 'minimumReleaseAgeExclude: [evil]\n',
    quoted: "'minimumReleaseAgeExclude':\n  - '*'\n",
    duplicate:
      'minimumReleaseAgeExclude:\n  - a@1.0.0\nminimumReleaseAgeExclude:\n  - b\n',
    nested: 'settings:\n  minimumReleaseAge: 0\n',
    quotedValue: "minimumReleaseAge: '0'\n",
  }
  for (const [name, yaml] of Object.entries(bad)) {
    assert.match(gateYamlProblem(yaml) ?? '', /line \d+ /, name)
    assert.throws(() => yamlList(yaml, 'minimumReleaseAgeExclude'), name)
    assert.throws(() => minAgeMinutesFromYaml(yaml), name)
  }
  // Other keys are read as before.
  assert.deepEqual(yamlList(bad.flow, 'packages'), [])
})

test('pickBumpPr returns every qualifying PR, so that two of them can stop the run', () => {
  const pr = (number, headRefName) => ({
    number,
    headRefName,
    title: 'chore: bump packages',
    isCrossRepository: false,
    headRepositoryOwner: { login: 'acme' },
  })
  const r = pickBumpPr(
    [pr(1, 'chore/bump-deps-20261110'), pr(2, 'chore/bump-deps-20261111')],
    'acme'
  )
  assert.deepEqual(
    r.all.map((p) => p.number),
    [1, 2]
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
  // A bare user mention, and a backtick in untrusted text that would close a span.
  assert.equal(mdSafe('ping @octocat now'), 'ping `@octocat` now')
  assert.equal(mdSafe(`flag: ${plain('x` @evil `y')}`), "flag: x' `@evil` 'y")
  const empty = { packages: [], excludes: [], overrides: [], toolchain: [] }
  const s = prBlock(empty, {
    needsUser: [
      {
        kind: 'blocked',
        name: '@dynamic-labs/sdk',
        project: '.',
        text: 'blocked: @dynamic-labs/sdk@4.5.1: publisher changed.',
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

test('metadataFlags: publisher, trusted publisher, install scripts, dependencies', () => {
  const m = (extra = {}) => ({
    _npmUser: 'a <a@x.org>',
    scripts: {},
    dependencies: { x: '^1.0.0' },
    ...extra,
  })
  assert.deepEqual(metadataFlags('p@1.0.1', m(), m()), {
    flags: [],
    compromise: [],
  })
  const changed = metadataFlags('p@1.0.1', m({ _npmUser: 'b <b@x.org>' }), m())
  assert.match(changed.compromise[0], /publisher changed/)
  const tp = {
    '_npmUser.trustedPublisher': { id: 'github', oidcConfigId: '***' },
  }
  assert.match(
    metadataFlags('p@1.0.1', m(), m(tp)).compromise[0],
    /trusted publisher gone/
  )
  assert.match(
    metadataFlags('p@1.0.1', m({ scripts: { postinstall: 'x' } }), m())
      .compromise[0],
    /postinstall/
  )
  // A new dependency is a flag, not a compromise flag; `deps: false` skips it.
  const dep = m({ dependencies: { x: '^1.0.0', y: '1.0.0' } })
  const withDeps = metadataFlags('p@1.0.1', dep, m())
  assert.match(withDeps.flags[0], /new dependencies: y/)
  assert.deepEqual(withDeps.compromise, [])
  assert.deepEqual(
    metadataFlags('p@1.0.1', dep, m(), { deps: false }).flags,
    []
  )
  assert.match(metadataFlags('p@1.0.1', null, m()).flags[0], /cannot check/)
})

test('trustedPublisherFlags: the oidcConfigId from the raw documents', () => {
  const meta = (integrity) => ({
    '_npmUser.trustedPublisher': { id: 'github', oidcConfigId: '***' },
    'dist.integrity': integrity,
  })
  const raw = (integrity, oidcConfigId) => ({
    dist: { integrity },
    _npmUser: { trustedPublisher: { id: 'github', oidcConfigId } },
  })
  const same = trustedPublisherFlags(
    'p@2',
    meta('i2'),
    meta('i1'),
    raw('i2', 'A'),
    raw('i1', 'A')
  )
  assert.deepEqual(same, { flags: [], compromise: [] })
  const changed = trustedPublisherFlags(
    'p@2',
    meta('i2'),
    meta('i1'),
    raw('i2', 'B'),
    raw('i1', 'A')
  )
  assert.match(changed.compromise[0], /oidcConfigId A → B/)
  // A document that is not the artifact that the metadata described cannot be compared.
  const other = trustedPublisherFlags(
    'p@2',
    meta('i2'),
    meta('i1'),
    raw('zz', 'A'),
    raw('i1', 'A')
  )
  assert.match(other.flags[0], /cannot compare/)
  assert.deepEqual(other.compromise, [])
})

test('checkExactEntry and referenceVersion: one implementation for every exact entry', async () => {
  const day = 86400000
  const now = Date.parse('2026-11-10T12:00:00Z')
  const view = {
    time: {
      '1.0.0': new Date(now - 10 * day).toISOString(),
      '1.0.1': new Date(now - 3 * day).toISOString(),
      '1.0.2': new Date(now - 3600000).toISOString(),
    },
    distTags: { latest: '1.0.2' },
  }
  assert.equal(referenceVersion(view, '1.0.2', day, now), '1.0.1')
  assert.equal(referenceVersion(view, '1.0.0', day, now), '1.0.1')
  const meta = { _npmUser: 'a <a@x.org>', scripts: {}, dependencies: {} }
  const io = (adv, f = meta) => ({
    advisories: async () => adv,
    provenance: async () => null,
    meta: async (spec) => (spec.endsWith('1.0.2') ? f : meta),
    rawDoc: async () => null,
  })
  const clean = await checkExactEntry('p@1.0.2', '1.0.1', io({ hits: [] }), {
    metadata: true,
  })
  assert.deepEqual(clean, { flags: [], compromise: [], verified: false })
  const malware = await checkExactEntry(
    'p@1.0.2',
    '1.0.1',
    io({ hits: [{ type: 'malware', ghsa: 'GHSA-1', severity: 'critical' }] })
  )
  assert.match(malware.compromise[0], /malware advisory GHSA-1/)
  const blind = await checkExactEntry('p@1.0.2', '1.0.1', io({ error: 'down' }))
  assert.match(blind.flags[0], /cannot run/)
  assert.deepEqual(blind.compromise, [])
  // The metadata checks run only when asked (the analyzer runs them in its walk).
  const pub = { ...meta, _npmUser: 'b <b@x.org>' }
  assert.deepEqual(
    (await checkExactEntry('p@1.0.2', '1.0.1', io({ hits: [] }, pub))).flags,
    []
  )
  const recheck = await checkExactEntry(
    'p@1.0.2',
    '1.0.1',
    io({ hits: [] }, pub),
    {
      metadata: true,
      deps: false,
    }
  )
  assert.match(recheck.compromise[0], /publisher changed/)
  assert.match(
    (await checkExactEntry('p@1.0.2', null, io({ hits: [] }))).flags[0],
    /no aged version to compare with/
  )
})
