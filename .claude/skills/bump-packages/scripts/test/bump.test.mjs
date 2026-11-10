// Unit tests for the pure helpers of bump.mjs (in lib.js). No network, no git.
// Run: node --test <skill>/scripts/test/*.test.mjs

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bumpSpec,
  changesetText,
  EXIT,
  editExcludesDetailed,
  groupCommits,
  newPrBody,
  PR_END,
  PR_START,
  packageManagerValue,
  parseChangesetLine,
  prBlock,
  replaceOverride,
  replacePrBlock,
  setDependencySpec,
  setPackageManager,
  wrapLines,
} from '../bump-helpers.js'
import { yamlList } from '../lib.js'

const editExcludesText = (yaml, opts) => editExcludesDetailed(yaml, opts).text

const WS = `packages:
  - 'packages/*'
# pnpm drops comments between the items, so the rationale lives here:
#   - 2026-11-09: fast-track viem@2.57.17 (all checks pass).
#   - 2026-11-09: fast-track motion@14.12.0, framer-motion@14.12.0.
#   - Keep '@bigmi/*' and '@lifi/*'.
minimumReleaseAgeExclude:
  - '@bigmi/*'
  - '@lifi/*'
  - viem@2.57.17
  - motion@14.12.0
  - framer-motion@14.12.0
overrides:
  viem: '^2.57.17'
  'ws@<=8.22.0': 8.22.0
  '@lifi/data-types>@lifi/types': ^18.13.0
`

test('editExcludes: add sorted and quoted, remove stale entries and their comment lines', () => {
  const out = editExcludesText(WS, {
    add: ['@dynamic-labs/sdk@4.5.1', 'i18next@27.1.1'],
    remove: ['viem@2.57.17', '@lifi/*'],
    comment:
      '#   - 2026-11-10: fast-track @dynamic-labs/sdk@4.5.1, i18next@27.1.1.',
  })
  assert.deepEqual(yamlList(out, 'minimumReleaseAgeExclude'), [
    '@bigmi/*',
    '@lifi/*',
    '@dynamic-labs/sdk@4.5.1',
    'framer-motion@14.12.0',
    'i18next@27.1.1',
    'motion@14.12.0',
  ])
  assert.match(
    out,
    /^ {2}- '@dynamic-labs\/sdk@4\.5\.1'$/m,
    'scoped entries are quoted'
  )
  assert.match(out, /^ {2}- i18next@27\.1\.1$/m)
  assert.doesNotMatch(
    out,
    /viem@2\.57\.17 \(all checks pass\)/,
    'the comment of the removed entry is gone'
  )
  assert.match(
    out,
    /motion@14\.12\.0, framer-motion@14\.12\.0\.$/m,
    'a comment that still names a kept entry stays'
  )
  assert.match(out, /Keep '@bigmi\/\*'/)
  // The new comment is the last line above the key.
  assert.match(
    out,
    /fast-track @dynamic-labs\/sdk@4\.5\.1, i18next@27\.1\.1\.\nminimumReleaseAgeExclude:/
  )
  // The rest of the file is unchanged.
  assert.equal(out.split('overrides:')[1], WS.split('overrides:')[1])
  // Nothing to do: same text.
  assert.equal(editExcludesText(WS, {}), WS)
  // No key yet: a new block at the end.
  const fresh = editExcludesText('packages:\n  - a\n', {
    add: ['x@1.0.0'],
    comment: '# why',
  })
  assert.deepEqual(yamlList(fresh, 'minimumReleaseAgeExclude'), ['x@1.0.0'])
})

test('replaceOverride keeps the quote style and touches only that line', () => {
  const lift = replaceOverride(
    WS,
    'ws@<=8.22.0',
    '8.22.0',
    'ws@<=8.22.2',
    '8.22.2'
  )
  assert.match(lift, /^ {2}'ws@<=8\.22\.2': 8\.22\.2$/m)
  const floor = replaceOverride(
    WS,
    '@lifi/data-types>@lifi/types',
    '^18.13.0',
    '@lifi/data-types>@lifi/types',
    '^18.16.0'
  )
  assert.match(floor, /^ {2}'@lifi\/data-types>@lifi\/types': \^18\.16\.0$/m)
  const viem = replaceOverride(WS, 'viem', '^2.57.17', 'viem', '^2.57.20')
  assert.match(viem, /^ {2}viem: '\^2\.57\.20'$/m)
  assert.equal(replaceOverride(WS, 'nope', '1', 'nope', '2'), null)
  assert.equal(
    replaceOverride(WS, 'viem', '^2.0.0', 'viem', '^2.1.0'),
    null,
    'the value must match'
  )
})

test('bumpSpec and setDependencySpec: keep the prefix, change only the named section', () => {
  assert.equal(bumpSpec('^1.2.3', '1.4.0'), '^1.4.0')
  assert.equal(bumpSpec('~1.2.3', '1.2.9'), '~1.2.9')
  assert.equal(bumpSpec('1.2.3', '1.2.4'), '1.2.4')
  for (const s of [
    '>=1.2.3',
    'workspace:*',
    'npm:foo@1',
    'catalog:',
    '^1 || ^2',
    '*',
    'latest',
    '1.x',
  ]) {
    assert.equal(bumpSpec(s, '9.9.9'), null, s)
  }
  const pkg = `{
  "name": "x",
  "dependencies": {
    "viem": "^2.57.7",
    "wagmi": "3.7.7"
  },
  "peerDependencies": {
    "viem": "^2.0.0"
  }
}
`
  const out = setDependencySpec(pkg, 'dependencies', 'viem', '^2.57.17')
  assert.match(out, /"dependencies": \{\n {4}"viem": "\^2\.57\.17"/)
  assert.match(
    out,
    /"peerDependencies": \{\n {4}"viem": "\^2\.0\.0"/,
    'peer range unchanged'
  )
  assert.equal(setDependencySpec(pkg, 'devDependencies', 'viem', '1'), null)
  assert.equal(
    setDependencySpec(pkg, 'dependencies', 'vie', '1'),
    null,
    'exact name only'
  )
})

test('packageManagerValue matches what corepack wrote for pnpm 12.6.0', () => {
  // `npm view pnpm@12.6.0 dist.integrity`, and the packageManager value that corepack
  // wrote for it in lifinance/sdk.
  const integrity =
    'sha512-PvaPlRyxEawgS0paFvCy3fDaVqluBBPoHYVdnwtV75JnFHCQKOHNAMQFwsX7e56OxNxGd3yAXQNzwvL/AP0g7A=='
  assert.equal(
    packageManagerValue('12.6.0', integrity),
    'pnpm@12.6.0+sha512.3ef68f951cb111ac204b4a5a16f0b2ddf0da56a96e0413e81d855d9f0b55ef926714709028e1cd00c405c2c5fb7b9e8ec4dc46777c805d0373c2f2ff00fd20ec'
  )
  assert.equal(packageManagerValue('12.6.0', 'sha1-abc'), null)
  assert.equal(
    setPackageManager(
      '{\n  "packageManager": "pnpm@12.6.0+sha512.aa",\n  "x": 1\n}',
      'pnpm@12.18.0+sha512.bb'
    ),
    '{\n  "packageManager": "pnpm@12.18.0+sha512.bb",\n  "x": 1\n}'
  )
})

test('changesetText: one patch per package, one line per dependency', () => {
  const text = changesetText([
    { pkg: '@lifi/sdk', dep: 'viem', version: '2.57.17' },
    { pkg: '@lifi/sdk-provider-ethereum', dep: 'viem', version: '2.57.17' },
    { pkg: '@lifi/sdk', dep: '@lifi/types', version: '18.16.0' },
  ])
  assert.equal(
    text,
    '---\n"@lifi/sdk": patch\n"@lifi/sdk-provider-ethereum": patch\n---\n\nUpdate `@lifi/types` to 18.16.0.\nUpdate `viem` to 2.57.17.\n'
  )
  assert.deepEqual(parseChangesetLine('@lifi/types 18.13.0→18.16.0'), {
    dep: '@lifi/types',
    from: '18.13.0',
    version: '18.16.0',
  })
  assert.equal(parseChangesetLine('nonsense'), null)
})

test('groupCommits: excludes first, then bump, CI, and the lockfile last', () => {
  const files = [
    'pnpm-lock.yaml',
    'packages/sdk/package.json',
    'pnpm-workspace.yaml',
    '.changeset/bump-packages-2026-11-10.md',
    '.github/workflows/ci.yaml',
    'examples/node/pnpm-lock.yaml',
    'examples/node/package.json',
    'packages/sdk/src/version.ts',
  ]
  const { commits, unexpected } = groupCommits(files, {
    excludeAddFiles: ['pnpm-workspace.yaml'],
    packageManagerFiles: ['package.json'],
    pnpmTarget: '12.18.0',
  })
  assert.deepEqual(
    commits.map((c) => [c.id, c.message]),
    [
      ['excludes', 'chore: allow fresh releases past the release-age gate'],
      ['bump', 'chore: bump packages'],
      ['ci', 'ci: bump GitHub Actions and CI tools'],
      ['lockfile', 'chore: bump pnpm to 12.18.0 and regenerate the lockfile'],
    ]
  )
  assert.deepEqual(commits[3].files, [
    'examples/node/pnpm-lock.yaml',
    'package.json',
    'pnpm-lock.yaml',
  ])
  assert.deepEqual(unexpected, ['packages/sdk/src/version.ts'])
  const none = groupCommits([])
  assert.deepEqual(none.commits, [])
  assert.equal(
    groupCommits(['pnpm-lock.yaml']).commits[0].message,
    'chore: regenerate the lockfile'
  )
})

test('wrapLines keeps commit body lines at 100 characters or less', () => {
  const long = Array.from({ length: 40 }, (_, i) => `pkg${i}@1.2.${i}`).join(
    ', '
  )
  for (const l of wrapLines(long).split('\n')) {
    assert.ok(l.length <= 100, l)
  }
})

test('prBlock, replacePrBlock and newPrBody: one stateless block between markers', () => {
  const state = {
    packages: [
      {
        name: '@mysten/sui',
        where: 'packages/sui',
        from: '^2.36.0',
        to: '^2.39.1',
        bump: 'minor',
      },
    ],
    excludes: ['vite@8.3.7'],
    overrides: [{ key: 'axios', from: '^1.20.0', to: '^1.21.0' }],
    toolchain: ['pnpm 12.14.0 → 12.18.0'],
  }
  const r = {
    needsUser: [
      {
        kind: 'major',
        name: 'i18next',
        project: '.',
        text: '26.5.2 → 27.0.1 (major).',
        flag: '--majors i18next',
      },
    ],
    lockfile: { majors: [], singleCopy: ['viem 2.57.17'] },
    audit: { before: { high: 2, low: 1 }, after: { high: 0, low: 1 } },
    checks: [{ name: 'build', ok: true, seconds: 40 }],
    skippedChecks: ['knip:check'],
  }
  const block = prBlock(state, r)
  assert.ok(block.startsWith(PR_START) && block.endsWith(PR_END))
  assert.match(
    block,
    /\| `@mysten\/sui` \| packages\/sui \| \^2\.36\.0 \| \^2\.39\.1 \| minor \|/
  )
  assert.match(
    block,
    /### Allowed past the release-age gate\n\n- `vite@8\.3\.7`/
  )
  assert.match(block, /- `axios`: `\^1\.20\.0` → `\^1\.21\.0`/)
  assert.match(
    block,
    /Needs the user:\n\n- `i18next`: 26\.5\.2 → 27\.0\.1 \(major\)\. Apply: `--majors i18next`/
  )
  assert.match(block, /3 advisories before, 1 after/)
  assert.match(block, /skipped \(they also fail on main\): `knip:check`/)
  // A long list is cut.
  const many = {
    ...state,
    excludes: Array.from({ length: 5 }, (_, i) => `x@1.0.${i}`),
  }
  assert.match(prBlock(many, r, 2), /… and 3 more\./)
  // The second run replaces the block; the text around it stays.
  const body = `Intro by a person.\n\n${block}\n\nOutro.`
  const next = replacePrBlock(body, prBlock({ ...state, excludes: [] }, r))
  assert.equal(next.split(PR_START).length, 2, 'one block')
  assert.match(next, /^Intro by a person\.\n\n/)
  assert.match(next, /\n\nOutro\.$/)
  assert.doesNotMatch(next, /vite@8\.3\.7/)
  // An old body without markers gets the block once.
  assert.equal(replacePrBlock('Old text.', block), `Old text.\n\n${block}\n`)
  // A new PR with the template shape.
  const template =
    '## Which Linear task is linked to this PR?\n\n## Why was it implemented this way?\n\n## Checklist before requesting a review\n- [ ] I have performed a self-review\n- [ ] Tests pass\n- [ ] Docs updated\n'
  const pr = newPrBody(block, template)
  assert.match(pr, /^## Which Linear task is linked to this PR\?\n\nNone\./)
  assert.match(
    pr,
    /## Visual showcase \(Screenshots or Videos\)\n\nNot applicable\./
  )
  assert.match(
    pr,
    /- \[x\] I have performed a self-review\n- \[x\] Tests pass\n- \[ \] Docs updated/
  )
  assert.equal(newPrBody(block, null), `${block}\n`)
})

test('exit codes', () => {
  assert.deepEqual(EXIT, {
    ok: 0,
    cannotRun: 2,
    lockfileStop: 3,
    checkFailed: 4,
  })
})
