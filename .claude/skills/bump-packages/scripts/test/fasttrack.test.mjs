// Unit tests for the fast-track, toolchain and lockfile-base helpers in lib.js. No network:
// registry views, advisory answers, attestation bundles and git are fakes.
// Run: node --test <skill>/scripts/test/*.test.mjs

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addedKeys,
  advisoryHits,
  decideFamily,
  freshVersionsOf,
  groupFamilies,
  invalidExcludeEntries,
  malwareCoveringAny,
  normalizeRepo,
  overrideUpdate,
  parseProvenance,
  provenanceFlags,
  provenanceVerdict,
  resolveLockfileBases,
  toolStatus,
} from '../lib.js'

const H = 3600000
const NOW = Date.parse('2026-11-10T12:00:00Z')
const GATE = 24 * H
const ago = (hours) => new Date(NOW - hours * H).toISOString()
const view = (versions, latest) => ({
  time: Object.fromEntries(
    Object.entries(versions).map(([v, h]) => [v, ago(h)])
  ),
  distTags: { latest: latest ?? Object.keys(versions).at(-1) },
})

test('toolStatus: a CI tool whose only newer releases are fresh is too-fresh, not up-to-date', () => {
  const v = view({ '4.40.0': 300, '4.41.0': 5 })
  const s = toolStatus(v, '4.40.0', GATE, NOW)
  assert.equal(s.status, 'too-fresh')
  assert.equal(s.target, null)
  assert.equal(s.newest, '4.41.0')
  assert.equal(s.newestAgeHours, 5)
  assert.equal(
    toolStatus(view({ '4.40.0': 300 }), '4.40.0', GATE, NOW).status,
    'up-to-date'
  )
  const safe = toolStatus(
    view({ '4.40.0': 300, '4.41.0': 30, '4.42.0': 2 }),
    '4.40.0',
    GATE,
    NOW
  )
  assert.equal(safe.status, 'safe')
  assert.equal(safe.target, '4.41.0')
  assert.equal(safe.newest, '4.42.0')
  assert.equal(
    toolStatus(view({ '4.40.0': 300, '5.0.0': 30 }), '4.40.0', GATE, NOW)
      .status,
    'needs-approval'
  )
})

test('freshVersionsOf: oldest first, each with its own age and eligible time', () => {
  const v = view(
    {
      '14.10.0': 100,
      '14.11.0': 40,
      '14.12.0': 2.8,
      '14.11.1': 22.4,
      '15.0.0-beta.1': 1,
      // A stable release above the `latest` dist-tag (published under another tag).
      '14.13.0': 1,
    },
    '14.12.0'
  )
  const fresh = freshVersionsOf(v, '14.11.0', GATE, NOW)
  assert.deepEqual(fresh, [
    { version: '14.11.1', ageHours: 22.4, eligibleInHours: 1.6 },
    { version: '14.12.0', ageHours: 2.8, eligibleInHours: 21.2 },
  ])
  // Above the latest dist-tag, exempt, and aged versions are not fresh.
  assert.deepEqual(
    freshVersionsOf(v, '14.11.0', GATE, NOW, (x) => x === '14.11.1').map(
      (x) => x.version
    ),
    ['14.12.0']
  )
  assert.deepEqual(freshVersionsOf(null, '1.0.0', GATE, NOW), [])
})

test('groupFamilies: name rules and lockstep pins only, never a bare shared scope', () => {
  const members = [
    { name: '@dynamic-labs/sdk', excludeSet: ['@dynamic-labs/sdk@4.5.1'] },
    {
      name: '@dynamic-labs/waas-svm',
      excludeSet: ['@dynamic-labs/waas-svm@4.5.1'],
    },
    { name: 'next', excludeSet: ['next@16.4.3'] },
    { name: '@next/env', excludeSet: ['@next/env@16.4.3'] },
    { name: '@types/node', excludeSet: ['@types/node@24.1.0'] },
    { name: '@types/react', excludeSet: ['@types/react@19.2.1'] },
    {
      name: 'motion',
      excludeSet: ['motion@12.23.25', 'framer-motion@12.23.25'],
    },
    { name: 'vite', excludeSet: ['vite@8.3.7', 'rolldown@1.2.18'] },
    { name: 'rolldown', excludeSet: ['rolldown@1.2.18'] },
    { name: 'left-pad', excludeSet: ['left-pad@1.3.1'] },
    { name: 'a-lib', excludeSet: ['a-lib@2.0.1', 'shared@1.0.1'] },
    { name: 'b-lib', excludeSet: ['b-lib@3.0.1', 'shared@1.0.1'] },
  ]
  const groups = groupFamilies(members).map((g) =>
    g.map((i) => members[i].name).sort()
  )
  assert.deepEqual(
    groups.sort((a, b) => a[0].localeCompare(b[0])),
    [
      ['@dynamic-labs/sdk', '@dynamic-labs/waas-svm'],
      ['@next/env', 'next'],
      ['@types/node'],
      ['@types/react'],
      ['a-lib', 'b-lib'],
      ['left-pad'],
      ['motion'],
      ['rolldown', 'vite'],
    ]
  )
  // Same scope AND same version is not enough: @types/a and @types/b stay apart.
  const types = [
    { name: '@types/a', excludeSet: ['@types/a@1.0.1'] },
    { name: '@types/b', excludeSet: ['@types/b@1.0.1'] },
  ]
  assert.deepEqual(groupFamilies(types), [[0], [1]])
})

// A fake check: `flags` maps name@version to [flag, compromise?]; `unverified` lists
// name@version entries without verified provenance.
const fakeCheck =
  (flags = {}, unverified = []) =>
  async ({ name }, version) => {
    const spec = `${name}@${version}`
    const f = flags[spec]
    return {
      redFlags: f ? [f[0]] : [],
      compromiseFlags: f?.[1] ? [f[0]] : [],
      unverifiedProvenance: unverified.includes(spec) ? [spec] : [],
      excludeSet: [spec, 'shared-dep@1.0.1'],
    }
  }

test('decideFamily: one red flag anywhere blocks the whole family', async () => {
  const check = fakeCheck({ 'b@2.1.0': ['b@2.1.0: new dependencies: x'] })
  // Both members only have 2.1.0 fresh: b is flagged, so a is blocked too.
  const blocked = await decideFamily(
    [
      { name: 'a', fresh: ['2.1.0'] },
      { name: 'b', fresh: ['2.1.0'] },
    ],
    check
  )
  assert.equal(blocked.decision, 'blocked')
  assert.deepEqual(blocked.redFlags, ['b@2.1.0: new dependencies: x'])
  // A blocked family keeps the exclude set of its newest level (approval by name).
  assert.deepEqual(blocked.excludeSet, [
    'a@2.1.0',
    'b@2.1.0',
    'shared-dep@1.0.1',
  ])
  // A non-compromise flag: the family falls back together to an older common version.
  const fallback = await decideFamily(
    [
      { name: 'a', fresh: ['2.1.0', '2.0.1'] },
      { name: 'b', fresh: ['2.1.0', '2.0.1'] },
    ],
    check
  )
  assert.equal(fallback.decision, 'auto')
  assert.deepEqual(fallback.versions, { a: '2.0.1', b: '2.0.1' })
  assert.deepEqual(fallback.excludeSet, [
    'a@2.0.1',
    'b@2.0.1',
    'shared-dep@1.0.1',
  ])
  assert.deepEqual(
    fallback.tried.b.map((t) => t.version),
    ['2.1.0', '2.0.1']
  )
  // The skipped newer version keeps its flags visible on the chosen row.
  assert.deepEqual(fallback.skippedFlags, {
    a: [],
    b: ['b@2.1.0: new dependencies: x'],
  })
  // A clean family: the union of the exclude sets, sorted and deduplicated.
  const clean = await decideFamily(
    [
      { name: 'a', fresh: ['3.0.1'] },
      { name: 'c', fresh: ['3.0.1'] },
    ],
    check
  )
  assert.equal(clean.decision, 'auto')
  assert.deepEqual(clean.excludeSet, ['a@3.0.1', 'c@3.0.1', 'shared-dep@1.0.1'])
  // One member: per-version fallback.
  const single = await decideFamily(
    [{ name: 'b', fresh: ['2.1.0', '2.0.9'] }],
    check
  )
  assert.equal(single.decision, 'auto')
  assert.deepEqual(single.versions, { b: '2.0.9' })
})

test('decideFamily: a compromise flag on any fresh version blocks every version, no fallback', async () => {
  // On the newest version: the clean older version is NOT taken.
  const newest = await decideFamily(
    [{ name: 'p', fresh: ['1.2.5', '1.2.4'] }],
    fakeCheck({ 'p@1.2.5': ['p@1.2.5: publisher changed "a" → "b"', true] })
  )
  assert.equal(newest.decision, 'blocked')
  assert.deepEqual(newest.compromiseFlags, [
    'p@1.2.5: publisher changed "a" → "b"',
  ])
  assert.deepEqual(
    newest.tried.p.map((t) => t.version),
    ['1.2.5', '1.2.4']
  )
  // On an OLDER fresh version: the clean newest version is blocked too.
  const older = await decideFamily(
    [{ name: 'p', fresh: ['1.2.5', '1.2.4'] }],
    fakeCheck({
      'p@1.2.4': ['p@1.2.4: new or changed postinstall script', true],
    })
  )
  assert.equal(older.decision, 'blocked')
  // On one member: the whole family is blocked.
  const fam = await decideFamily(
    [
      { name: 'a', fresh: ['2.1.0', '2.0.1'] },
      { name: 'b', fresh: ['2.1.0', '2.0.1'] },
    ],
    fakeCheck({ 'b@2.0.1': ['b@2.0.1: malware advisory GHSA-x', true] })
  )
  assert.equal(fam.decision, 'blocked')
  assert.deepEqual(fam.excludeSet, ['a@2.1.0', 'b@2.1.0', 'shared-dep@1.0.1'])
  // A package-level malware advisory blocks the family as well.
  const pkg = await decideFamily(
    [
      { name: 'a', fresh: ['2.1.0'] },
      { name: 'b', fresh: ['2.1.0'] },
    ],
    fakeCheck(),
    async (m) => ({
      compromiseFlags:
        m.name === 'a'
          ? ['a@2.1.0: malware advisory GHSA-y on the package']
          : [],
    })
  )
  assert.equal(pkg.decision, 'blocked')
  assert.deepEqual(pkg.packageFlags, {
    a: ['a@2.1.0: malware advisory GHSA-y on the package'],
    b: [],
  })
})

test('decideFamily: without verified provenance a clean family needs approval', async () => {
  const one = await decideFamily(
    [{ name: 'i18next', fresh: ['27.1.1'] }],
    fakeCheck({}, ['i18next@27.1.1'])
  )
  assert.equal(one.decision, 'needs-approval')
  assert.deepEqual(one.unverifiedProvenance, ['i18next@27.1.1'])
  assert.deepEqual(one.excludeSet, ['i18next@27.1.1', 'shared-dep@1.0.1'])
  // One member without provenance: the whole family needs approval.
  const fam = await decideFamily(
    [
      { name: 'a', fresh: ['2.1.0'] },
      { name: 'b', fresh: ['2.1.0'] },
    ],
    fakeCheck({}, ['b@2.1.0'])
  )
  assert.equal(fam.decision, 'needs-approval')
  // blocked beats needs-approval.
  const both = await decideFamily(
    [
      { name: 'a', fresh: ['2.1.0'] },
      { name: 'b', fresh: ['2.1.0'] },
    ],
    fakeCheck({ 'a@2.1.0': ['a@2.1.0: range flag'] }, ['b@2.1.0'])
  )
  assert.equal(both.decision, 'blocked')
  // Verified everywhere: auto.
  assert.equal(
    (await decideFamily([{ name: 'v', fresh: ['8.3.7'] }], fakeCheck()))
      .decision,
    'auto'
  )
})

test('malwareCoveringAny: a package-level malware advisory that covers any fresh version', () => {
  const list = [
    {
      ghsa_id: 'GHSA-qjqf-7j6f-82c4',
      type: 'malware',
      severity: 'critical',
      vulnerabilities: [
        {
          package: { ecosystem: 'npm', name: '@ctrl/tinycolor' },
          vulnerable_version_range: '>= 4.1.1, <= 4.1.2',
        },
      ],
    },
  ]
  assert.deepEqual(
    malwareCoveringAny(list, '@ctrl/tinycolor', ['4.1.3', '4.1.2']),
    [{ ghsa: 'GHSA-qjqf-7j6f-82c4', version: '4.1.2', withdrawn: false }]
  )
  assert.deepEqual(malwareCoveringAny(list, '@ctrl/tinycolor', ['4.1.3']), [])
  assert.equal(malwareCoveringAny({ message: 'error' }, 'x', ['1.0.0']), null)
})

test('addedKeys: prototype names such as constructor count as new', () => {
  assert.deepEqual(addedKeys({ constructor: '^1.0.0', a: '1' }, { a: '1' }), [
    'constructor',
  ])
  assert.deepEqual(addedKeys({ toString: '1', b: '2' }, undefined), [
    'toString',
    'b',
  ])
  assert.deepEqual(addedKeys(undefined, { a: '1' }), [])
})

test('invalidExcludeEntries: exact name@x.y.z only', () => {
  assert.deepEqual(
    invalidExcludeEntries([
      'viem@2.57.17',
      '@dynamic-labs/sdk@4.5.1',
      'JSONStream@1.3.5',
    ]),
    []
  )
  const bad = [
    'viem',
    '@lifi/*',
    'foo@^1.2.3',
    'foo@~1.2.3',
    'foo@>=1.2.3',
    'foo@1.x',
    'foo@latest',
    'foo@1.2.3 || 1.2.4',
    'foo@1.2.3-rc.1',
    'foo @1.2.3',
    'foo@1.2.3 ',
    'foo*@1.2.3',
    '@scope/foo',
    '',
    null,
  ]
  assert.deepEqual(invalidExcludeEntries(bad), bad)
})

const bundle = (
  name,
  version,
  predicate,
  predicateType = 'https://slsa.dev/provenance/v1'
) => ({
  attestations: [
    {
      predicateType:
        'https://github.com/npm/attestation/tree/main/specs/publish/v0.1',
      bundle: { dsseEnvelope: { payload: '' } },
    },
    {
      predicateType,
      bundle: {
        dsseEnvelope: {
          payload: Buffer.from(
            JSON.stringify({
              subject: [
                { name: `pkg:npm/${name.replace(/^@/, '%40')}@${version}` },
              ],
              predicateType,
              predicate,
            })
          ).toString('base64'),
        },
      },
    },
  ],
})
const v1 = (repository, path) => ({
  buildDefinition: {
    externalParameters: {
      workflow: { ref: 'refs/heads/main', repository, path },
    },
  },
})

test('parseProvenance reads SLSA v1 and v0.2 and checks the subject (scoped too)', () => {
  assert.deepEqual(
    parseProvenance(
      bundle(
        '@tanstack/react-query',
        '5.107.1',
        v1('https://github.com/TanStack/query', '.github/workflows/release.yml')
      ),
      '@tanstack/react-query',
      '5.107.1'
    ),
    {
      repository: 'https://github.com/tanstack/query',
      path: '.github/workflows/release.yml',
    }
  )
  const v02 = bundle(
    'sigstore',
    '1.6.0',
    {
      invocation: {
        configSource: {
          uri: 'git+https://github.com/sigstore/sigstore-js@refs/heads/main',
          entryPoint: '.github/workflows/release.yml',
        },
      },
    },
    'https://slsa.dev/provenance/v0.2'
  )
  assert.deepEqual(parseProvenance(v02, 'sigstore', '1.6.0'), {
    repository: 'https://github.com/sigstore/sigstore-js',
    path: '.github/workflows/release.yml',
  })
  assert.ok(
    parseProvenance(v02, 'sigstore', '1.7.0').error,
    'wrong subject version'
  )
  assert.ok(parseProvenance({ attestations: [] }, 'x', '1.0.0').error)
  assert.ok(parseProvenance(null, 'x', '1.0.0').error)
  assert.equal(
    normalizeRepo('git+https://github.com/Org/Repo.git'),
    'https://github.com/org/repo'
  )
})

test('provenanceFlags: same source passes, a changed source or a missing one fails', () => {
  const info = (repository, path) => ({ repository, path })
  const ref = {
    has: true,
    info: info(
      'https://github.com/wevm/viem',
      '.github/workflows/changesets.yml'
    ),
  }
  assert.deepEqual(
    provenanceFlags('viem@2.57.18', ref, {
      has: true,
      info: info(
        'https://github.com/wevm/viem',
        '.github/workflows/changesets.yml'
      ),
    }),
    []
  )
  assert.equal(
    provenanceFlags('x', ref, {
      has: true,
      info: info(
        'https://github.com/evil/viem',
        '.github/workflows/changesets.yml'
      ),
    }).length,
    1
  )
  assert.match(
    provenanceFlags('x', ref, {
      has: true,
      info: info('https://github.com/wevm/viem', '.github/workflows/other.yml'),
    })[0],
    /workflow changed/
  )
  assert.match(
    provenanceFlags('x', ref, { has: false, info: null })[0],
    /dropped/
  )
  assert.match(
    provenanceFlags('x', ref, { has: true, info: { error: 'timeout' } })[0],
    /cannot check/
  )
  assert.match(
    provenanceFlags(
      'x',
      { has: true, info: { error: 'HTTP 500' } },
      { has: true, info: ref.info }
    )[0],
    /reference/
  )
  // Neither side has provenance: nothing to compare (today's behavior).
  assert.deepEqual(
    provenanceFlags(
      'x',
      { has: false, info: null },
      { has: false, info: null }
    ),
    []
  )
})

test('advisoryHits: malware and high/critical reviewed advisories for this exact version', () => {
  // Shapes from `gh api /advisories?type=malware&ecosystem=npm&affects=debug@4.4.2` and
  // `…type=reviewed…&affects=lodash@4.17.20`.
  const malware = [
    {
      ghsa_id: 'GHSA-8mgj-vmr8-frr6',
      type: 'malware',
      severity: 'critical',
      withdrawn_at: null,
      vulnerabilities: [
        {
          package: { ecosystem: 'npm', name: 'debug' },
          vulnerable_version_range: '= 4.4.2',
        },
      ],
    },
  ]
  assert.deepEqual(advisoryHits(malware, 'debug', '4.4.2'), [
    {
      ghsa: 'GHSA-8mgj-vmr8-frr6',
      type: 'malware',
      severity: 'critical',
      withdrawn: false,
    },
  ])
  // GitHub withdrew the real one after npm removed 4.4.2: it still counts (fail closed).
  const withdrawn = [{ ...malware[0], withdrawn_at: '2025-09-15T23:53:23Z' }]
  assert.equal(advisoryHits(withdrawn, 'debug', '4.4.2')[0].withdrawn, true)
  assert.deepEqual(advisoryHits(malware, 'debug', '4.4.1'), [], 'other version')
  assert.deepEqual(
    advisoryHits(malware, 'other', '4.4.2'),
    [],
    'other package in the advisory'
  )
  assert.deepEqual(advisoryHits([], 'viem', '2.57.17'), [], 'clean package')
  const reviewed = [
    {
      ghsa_id: 'A',
      type: 'reviewed',
      severity: 'high',
      vulnerabilities: [
        {
          package: { ecosystem: 'npm', name: 'lodash' },
          vulnerable_version_range: '>= 4.0.0, <= 4.17.23',
        },
      ],
    },
    {
      ghsa_id: 'B',
      type: 'reviewed',
      severity: 'medium',
      vulnerabilities: [
        {
          package: { ecosystem: 'npm', name: 'lodash' },
          vulnerable_version_range: '< 4.17.21',
        },
      ],
    },
    {
      ghsa_id: 'C',
      type: 'reviewed',
      severity: 'critical',
      withdrawn_at: '2026-01-01T00:00:00Z',
      vulnerabilities: [
        {
          package: { ecosystem: 'npm', name: 'lodash' },
          vulnerable_version_range: '>= 0',
        },
      ],
    },
  ]
  assert.deepEqual(
    advisoryHits(reviewed, 'lodash', '4.17.20').map((h) => h.ghsa),
    ['A']
  )
  // Answers that cannot be trusted: not an array, or a full page.
  assert.equal(advisoryHits({ message: 'Bad credentials' }, 'x', '1.0.0'), null)
  assert.equal(advisoryHits(new Array(100).fill({}), 'x', '1.0.0'), null)
})

test('overrideUpdate: lift and floor in the same major, never across a major', () => {
  const exempt = () => false
  const ws = view(
    { '8.22.0': 500, '8.22.1': 300, '8.22.2': 100, '9.0.0': 50 },
    '9.0.0'
  )
  assert.deepEqual(
    overrideUpdate(
      { key: 'ws@<=8.22.0', value: '8.22.0', name: 'ws', kind: 'range' },
      ws,
      GATE,
      NOW,
      exempt
    ),
    {
      key: 'ws@<=8.22.0',
      value: '8.22.0',
      comment: null,
      newKey: 'ws@<=8.22.2',
      newValue: '8.22.2',
      reason: 'lift: 8.22.2 is the newest aged release in the same major',
    }
  )
  assert.equal(
    overrideUpdate(
      { key: 'ws@<8.22.0', value: '8.22.0', name: 'ws', kind: 'range' },
      ws,
      GATE,
      NOW,
      exempt
    ).newKey,
    'ws@<8.22.2'
  )
  const types = view(
    { '18.13.0': 900, '18.16.0': 200, '18.17.0': 2, '19.0.0': 100 },
    '19.0.0'
  )
  const floor = overrideUpdate(
    {
      key: '@lifi/data-types>@lifi/types',
      value: '^18.13.0',
      name: '@lifi/types',
      kind: 'path',
    },
    types,
    GATE,
    NOW,
    exempt
  )
  assert.equal(
    floor.newValue,
    '^18.16.0',
    'newest aged in 18.x, not the fresh 18.17.0 nor 19.0.0'
  )
  assert.equal(floor.newKey, '@lifi/data-types>@lifi/types')
  // Up to date: nothing. Only a newer major: nothing.
  assert.equal(
    overrideUpdate(
      { key: 'x', value: '^18.16.0', name: 'x', kind: 'whole' },
      types,
      GATE,
      NOW,
      exempt
    ),
    null
  )
  assert.equal(
    overrideUpdate(
      { key: 'ws@<=8.22.2', value: '8.22.2', name: 'ws', kind: 'range' },
      ws,
      GATE,
      NOW,
      exempt
    ),
    null
  )
  // 0.x: a new minor is a major.
  const zero = view({ '0.26.0': 900, '0.26.1': 300, '0.28.0': 300 })
  assert.equal(
    overrideUpdate(
      { key: 'p', value: '~0.26.0', name: 'p', kind: 'whole' },
      zero,
      GATE,
      NOW,
      exempt
    ).newValue,
    '~0.26.1'
  )
  // Exact pins: a hold comment keeps it; no comment -> check by hand.
  assert.equal(
    overrideUpdate(
      {
        key: 'p',
        value: '0.26.0',
        name: 'p',
        kind: 'whole',
        reason: 'Held at 0.26.0. 0.28.0 regressed for us.',
      },
      zero,
      GATE,
      NOW,
      exempt
    ),
    null
  )
  const pin = overrideUpdate(
    { key: 'p', value: '0.26.0', name: 'p', kind: 'whole', reason: null },
    zero,
    GATE,
    NOW,
    exempt
  )
  assert.equal(pin.reason, 'check by hand')
  assert.equal(pin.newValue, '0.26.1')
})

test('resolveLockfileBases: any ancestor of HEAD compares; the trust anchor stays main', () => {
  const MAIN_MB = 'aaaa'
  const ancestorsOfHead = new Set([MAIN_MB, 'bbbb', 'origin/chore/bump-deps-x'])
  const git = (args) => {
    if (
      args[0] === 'merge-base' &&
      args[1] === 'HEAD' &&
      args[2] === 'origin/main'
    ) {
      return `${MAIN_MB}\n`
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      if (ancestorsOfHead.has(args[2]) && args[3] === 'HEAD') {
        return ''
      }
      throw new Error('exit 1')
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  assert.deepEqual(resolveLockfileBases(undefined, git), {
    compareBase: MAIN_MB,
    trustAnchor: MAIN_MB,
  })
  assert.deepEqual(resolveLockfileBases('origin/chore/bump-deps-x', git), {
    compareBase: 'origin/chore/bump-deps-x',
    trustAnchor: MAIN_MB,
  })
  assert.throws(
    () => resolveLockfileBases('cccc', git),
    /not an ancestor of HEAD/
  )
  assert.throws(
    () =>
      resolveLockfileBases('bbbb', () => {
        throw new Error('no origin/main')
      }),
    /trust anchor/
  )
})

test('overrideUpdate: a hold comment stops every kind; a commented exact pin is a hold; tilde stays in its minor', () => {
  const exempt = () => false
  const up = (o, v) => overrideUpdate(o, v, GATE, NOW, exempt)
  const ws = view({ '8.22.0': 500, '8.22.1': 300, '8.22.2': 100 })
  // The lift probe from the review.
  assert.equal(
    up(
      {
        key: 'ws@<=8.22.0',
        value: '8.22.0',
        name: 'ws',
        kind: 'range',
        reason: 'Do not lift: 8.22.1 breaks the relay',
      },
      ws
    ),
    null
  )
  assert.equal(
    up(
      {
        key: 'ws',
        value: '^8.22.0',
        name: 'ws',
        kind: 'whole',
        reason: 'Held at 8.22.0 until the relay is fixed.',
      },
      ws
    ),
    null
  )
  assert.equal(
    up(
      {
        key: 'a>ws',
        value: '~8.22.0',
        name: 'ws',
        kind: 'path',
        reason: 'Do not bump: regression in 8.22.1',
      },
      ws
    ),
    null
  )
  // Any comment on an exact whole-package pin is a hold.
  assert.equal(
    up(
      {
        key: 'ws',
        value: '8.22.0',
        name: 'ws',
        kind: 'whole',
        reason: 'Pinned for the relay tests.',
      },
      ws
    ),
    null
  )
  // No comment: check by hand. A path pin with a neutral comment: check by hand.
  assert.equal(
    up(
      { key: 'ws', value: '8.22.0', name: 'ws', kind: 'whole', reason: null },
      ws
    ).reason,
    'check by hand'
  )
  assert.equal(
    up(
      {
        key: 'a>ws',
        value: '8.22.0',
        name: 'ws',
        kind: 'path',
        reason: 'Dedupe with the root.',
      },
      ws
    ).reason,
    'check by hand'
  )
  // Tilde: same major AND minor; caret: same major.
  const lib = view({ '1.2.3': 900, '1.2.9': 300, '1.5.0': 200, '2.0.0': 100 })
  assert.equal(
    up({ key: 'x', value: '~1.2.3', name: 'x', kind: 'whole' }, lib).newValue,
    '~1.2.9'
  )
  assert.equal(
    up({ key: 'x', value: '^1.2.3', name: 'x', kind: 'whole' }, lib).newValue,
    '^1.5.0'
  )
  assert.equal(
    up({ key: 'x', value: '~1.2.9', name: 'x', kind: 'whole' }, lib),
    null
  )
})

test('provenanceVerdict: auto needs verified provenance on both sides', () => {
  const info = (repository, path) => ({ repository, path })
  const same = info(
    'https://github.com/vitejs/vite',
    '.github/workflows/publish.yml'
  )
  const ok = provenanceVerdict(
    'vite@8.3.7',
    { has: true, info: same },
    { has: true, info: same }
  )
  assert.deepEqual(ok, { flags: [], compromise: [], verified: true })
  // Neither side: no flag, but not verified (a clean version then needs approval).
  assert.deepEqual(
    provenanceVerdict(
      'i18next@27.1.1',
      { has: false, info: null },
      { has: false, info: null }
    ),
    { flags: [], compromise: [], verified: false }
  )
  // Only the fresh side: not verified either.
  assert.equal(
    provenanceVerdict(
      'x',
      { has: false, info: null },
      { has: true, info: same }
    ).verified,
    false
  )
  // Dropped or changed: compromise class.
  const dropped = provenanceVerdict(
    'x',
    { has: true, info: same },
    { has: false, info: null }
  )
  assert.equal(dropped.compromise.length, 1)
  const moved = provenanceVerdict(
    'x',
    { has: true, info: same },
    {
      has: true,
      info: info(
        'https://github.com/evil/vite',
        '.github/workflows/publish.yml'
      ),
    }
  )
  assert.equal(moved.compromise.length, 1)
  assert.equal(moved.verified, false)
  // Unreadable: a red flag (blocks this version), not the compromise class.
  const unreadable = provenanceVerdict(
    'x',
    { has: true, info: same },
    { has: true, info: { error: 'timeout' } }
  )
  assert.equal(unreadable.flags.length, 1)
  assert.equal(unreadable.compromise.length, 0)
  assert.equal(unreadable.verified, false)
})
