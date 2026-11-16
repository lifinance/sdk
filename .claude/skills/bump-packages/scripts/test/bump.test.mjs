// Unit tests for the pure helpers of bump.mjs (in lib.js). No network, no git.
// Run: node --test <skill>/scripts/test/*.test.mjs

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addFastTrackBump,
  appliedLines,
  bumpSpec,
  changesetText,
  checkText,
  editExcludesDetailed,
  EXIT,
  fitPrBlock,
  groupCommits,
  lockstepKey,
  lockstepWaits,
  majorLine,
  majorTargets,
  mergeItems,
  newPrBody,
  ownReasons,
  packageManagerValue,
  parseChangesetLine,
  plain,
  PR_END,
  PR_START,
  prBlock,
  replaceOverride,
  replacePrBlock,
  reuseChangesets,
  setDependencySpec,
  setPackageManager,
  terminalText,
  whereText,
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

test('reuseChangesets: a rerun moves the version in the changeset of the branch', () => {
  const ethereum = {
    file: '.changeset/bump-packages-2026-11-09-widget-provider-ethereum.md',
    text: "---\n'@jumperexchange/widget-provider-ethereum': patch\n---\n\nMove to `viem` 2.57.17.\nThe Ethereum provider now asks for `wagmi` 3.7.11 or later.\n",
  }
  const i18n = {
    file: '.changeset/update-i18n-runtime-deps-2026-11-09.md',
    text: '---\n"@lifi/wallet-management": patch\n"@lifi/widget": patch\n---\n\nUpdate `i18next` to 27.0.1 and `react-i18next` to 18.0.1.\n',
  }
  const { edits, rest } = reuseChangesets(
    [ethereum, i18n],
    [
      {
        pkg: '@jumperexchange/widget-provider-ethereum',
        dep: 'viem',
        version: '2.57.19',
      },
      {
        pkg: '@jumperexchange/widget-provider-ethereum',
        dep: 'wagmi',
        version: '3.8.0',
      },
      { pkg: '@lifi/widget', dep: 'i18next', version: '27.1.1' },
      { pkg: '@lifi/wallet-management', dep: 'i18next', version: '27.1.1' },
      // Not in a changeset of this package: it stays for a new file.
      { pkg: '@lifi/widget-checkout', dep: 'i18next', version: '27.1.1' },
      { pkg: '@lifi/widget', dep: 'motion', version: '14.12.0' },
    ]
  )
  assert.deepEqual(edits, [
    {
      file: ethereum.file,
      // A peer floor ("3.7.11 or later") is not a dependency version.
      text: "---\n'@jumperexchange/widget-provider-ethereum': patch\n---\n\nMove to `viem` 2.57.19.\nThe Ethereum provider now asks for `wagmi` 3.7.11 or later.\n",
    },
    {
      file: i18n.file,
      text: '---\n"@lifi/wallet-management": patch\n"@lifi/widget": patch\n---\n\nUpdate `i18next` to 27.1.1 and `react-i18next` to 18.0.1.\n',
    },
  ])
  assert.deepEqual(rest, [
    {
      pkg: '@jumperexchange/widget-provider-ethereum',
      dep: 'wagmi',
      version: '3.8.0',
    },
    { pkg: '@lifi/widget-checkout', dep: 'i18next', version: '27.1.1' },
    { pkg: '@lifi/widget', dep: 'motion', version: '14.12.0' },
  ])
})

test('reuseChangesets: no changeset of the branch, or one without front matter', () => {
  const u = [{ pkg: '@lifi/sdk', dep: 'viem', version: '2.57.19' }]
  assert.deepEqual(reuseChangesets([], u), { edits: [], rest: u })
  assert.deepEqual(
    reuseChangesets(
      [{ file: '.changeset/x.md', text: 'Update `viem` to 2.57.17.\n' }],
      u
    ),
    { edits: [], rest: u }
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
    removedExcludes: ['viem@2.57.17'],
    overrides: [
      { key: 'axios', from: '^1.20.0', to: '^1.21.0', project: '.' },
      {
        key: 'axios',
        from: '^1.20.0',
        to: '^1.21.0',
        project: 'examples/node',
      },
    ],
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
    checks: [
      { name: 'build', ok: true, seconds: 40 },
      { name: 'knip:check', ok: false, accepted: true, seconds: 3 },
    ],
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
  assert.match(block, /- `axios`: `\^1\.20\.0` → `\^1\.21\.0`\n/)
  assert.match(
    block,
    /- `axios`: `\^1\.20\.0` → `\^1\.21\.0` \(examples\/node\)\n/,
    'the override of an extra project names the project'
  )
  assert.match(block, /### Aged exclude entries removed\n\n- `viem@2\.57\.17`/)
  assert.match(
    block,
    /Needs the user:\n\n- `i18next`: 26\.5\.2 → 27\.0\.1 \(major\)\. Apply: `--majors i18next`/
  )
  assert.match(block, /3 advisories before, 1 after/)
  assert.match(
    block,
    /`knip:check` FAIL \(fails on main too; accepted with --skip-check\) \(3 s\)/
  )
  // Without the baseline's proof, a failure is only "FAIL".
  const unproved = prBlock(state, {
    ...r,
    checks: [{ name: 'knip:check', ok: false, seconds: 3 }],
  })
  assert.doesNotMatch(unproved, /fails on main/)
  // A long list is cut.
  const many = {
    ...state,
    excludes: Array.from({ length: 5 }, (_, i) => `x@1.0.${i}`),
  }
  assert.match(prBlock(many, r, 2), /… and 3 more\./)
  // M4: each run removes every block and stray marker and appends one; the text of
  // people stays.
  const body = `Intro by a person.\n\n${block}\n\nOutro.`
  let next = replacePrBlock(body, prBlock({ ...state, excludes: [] }, r))
  next = replacePrBlock(`${next}\n${PR_END} stray`, block)
  next = replacePrBlock(next, prBlock({ ...state, excludes: [] }, r))
  assert.equal(next.split(PR_START).length, 2, 'one block after three runs')
  assert.equal(next.split(PR_END).length, 2)
  assert.match(
    next,
    /^Intro by a person\.\n\nOutro\.\n\n stray\n\n<!-- bump-packages:start -->/
  )
  assert.doesNotMatch(next, /vite@8\.3\.7/)
  assert.equal(replacePrBlock('Old text.', block), `Old text.\n\n${block}\n`)
  // M4: untrusted text cannot open a comment or end the block; a long item is capped.
  const evil = prBlock(state, {
    ...r,
    needsUser: [
      { name: 'x', text: plain(`a ${PR_END} <!-- b`), flag: null },
      { name: 'y', text: 'z'.repeat(400) },
    ],
  })
  assert.equal(evil.split(PR_END).length, 2)
  assert.match(evil, /- `x`: a &lt;!-- bump-packages:end --&gt; &lt;!-- b\n/)
  assert.match(evil, /- `y`: z{299}…\n/)
  // M4: a block that does not fit is cut at a line end, with a note.
  const cut = fitPrBlock(block, 200)
  assert.ok(cut.length <= 200)
  assert.match(
    cut,
    /The full lists are in the run output\.\n\n<!-- bump-packages:end -->$/
  )
  assert.equal(fitPrBlock(block, 1e6), block)
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

test('checkText: the three verdicts, an accepted failure, and a check that did not run', () => {
  const c = {
    name: 'check:types',
    ok: false,
    seconds: 9,
    log: '/o/check-check-types.log',
  }
  assert.equal(
    checkText({ ...c, verdict: 'regression' }),
    'check:types FAIL (regression) (9s)'
  )
  assert.equal(
    checkText({
      ...c,
      verdict: 'fails-on-main',
      baselineLog: '/o/baseline/check-check-types.log',
    }),
    'check:types FAIL (also fails on main; compare /o/check-check-types.log with /o/baseline/check-check-types.log) (9s)'
  )
  assert.equal(
    checkText({
      ...c,
      verdict: 'unknown',
      baselineWhy: 'pnpm install failed on main',
    }),
    'check:types FAIL (baseline unknown: pnpm install failed on main) (9s)'
  )
  assert.equal(
    checkText({ ...c, verdict: 'fails-on-main', accepted: true }),
    'check:types FAIL (fails on main too; accepted with --skip-check) (9s)'
  )
  assert.equal(
    checkText({ name: 'test', ok: false, notRun: 'build failed' }),
    'test not run (build failed)'
  )
  assert.equal(
    checkText({ name: 'build', ok: true, seconds: 3 }),
    'build ok (3s)'
  )
})

test('appliedLines and whereText: every applied item, one line each', () => {
  assert.equal(whereText(['packages/widget']), ' (packages/widget)')
  assert.equal(
    whereText(['packages/widget', 'a', 'b']),
    ' (packages/widget and 2 more projects)'
  )
  assert.equal(whereText(['.', 'a']), ' (root and 1 more project)')
  assert.deepEqual(
    appliedLines({
      bumps: [
        {
          name: 'viem',
          from: '1',
          to: '2',
          where: ['.'],
          project: 'examples/node',
        },
      ],
      majors: [],
      overrides: [],
      removedExcludes: [],
      approved: [],
      actions: [],
      tools: [],
    }),
    ['viem 1 → 2 (examples/node)'],
    'the root of an extra project is that project'
  )
  assert.deepEqual(
    appliedLines({
      bumps: [{ name: 'a', from: '1', to: '2', where: ['.'], fastTrack: true }],
      fastTracks: [
        { project: '.', spec: 'a@2' },
        { project: '.', spec: 'viem@3' },
        { project: 'examples/node', spec: 'viem@3' },
      ],
      majors: [],
      overrides: [],
      removedExcludes: [],
      approved: [],
      actions: [],
      tools: [],
    }),
    ['viem@3 fast-track (lockfile only)', 'a 1 → 2 (root) fast-track'],
    'a fast-track that only the lockfile moves gets one line'
  )
  const lines = appliedLines({
    bumps: [
      {
        name: 'zustand',
        from: '5.1.0',
        to: '5.2.0',
        where: ['packages/widget'],
      },
    ],
    majors: [
      {
        name: 'kleur',
        from: '3.0.3',
        to: '4.1.5',
        where: ['packages/lib'],
        major: true,
      },
    ],
    overrides: [
      { key: 'axios', value: '^1.21.0', newKey: 'axios', newValue: '^1.21.1' },
    ],
    removedExcludes: ['viem@2.57.17'],
    approved: ['x@1.0.1'],
    actions: [{ repo: 'actions/checkout', from: 'v4.1.0', to: 'v4.2.0' }],
    tools: [{ pkg: 'wrangler', from: '4.158.0', to: '4.159.0' }],
    pnpm: { from: '12.14.0', to: '12.18.0' },
  })
  assert.deepEqual(lines, [
    'zustand 5.1.0 → 5.2.0 (packages/widget)',
    'kleur 3.0.3 → 4.1.5 (packages/lib) major',
    'override axios: ^1.21.0 → ^1.21.1',
    'removed the aged exclude entry viem@2.57.17',
    'approved exclude entry x@1.0.1',
    'action actions/checkout v4.1.0 → v4.2.0',
    'CI tool wrangler 4.158.0 → 4.159.0',
    'pnpm 12.14.0 → 12.18.0',
  ])
})

test('majorTargets and majorLine: --majors never writes into a held project', () => {
  const names = {
    'examples/vue': 'vue',
    'examples/svelte': 'svelte',
    'packages/widget': 'widget',
  }
  const where = Object.keys(names)
  const nameOf = (w) => names[w]
  assert.deepEqual(majorTargets(where, undefined, nameOf), {
    where,
    kept: [],
    stale: false,
  })
  const held = { name: 'typescript', projects: ['vue', 'svelte'], reason: 'x' }
  assert.deepEqual(majorTargets(where, held, nameOf), {
    where: ['packages/widget'],
    kept: ['examples/vue', 'examples/svelte'],
    stale: false,
  })
  // Every project held, or a hold without projects: all folders, and the entry is stale.
  assert.deepEqual(majorTargets(['examples/vue'], held, nameOf), {
    where: ['examples/vue'],
    kept: [],
    stale: true,
  })
  assert.equal(
    majorTargets(where, { name: 'typescript', reason: 'x' }, nameOf).stale,
    true
  )
  assert.equal(majorLine('6.0.1'), '6')
  assert.equal(majorLine('0.5.2'), '0.5')
})

test('lockstepWaits: aged siblings wait for a sibling whose same version is too young', () => {
  // The real widget case (19:40 UTC): six @dynamic-labs/* packages had an aged 5.15.0,
  // @dynamic-labs/sdk-react-core 5.15.0 was 23.9 h old.
  const six = [
    'ethereum',
    'ethereum-aa',
    'solana',
    'sui',
    'wallet-connector-core',
    'zerodev-extension',
  ].map((n) => ({ name: `@dynamic-labs/${n}`, from: '5.14.0', to: '5.15.0' }))
  const bumps = [...six, { name: 'zustand', from: '5.1.0', to: '5.2.0' }]
  const others = [
    {
      name: '@dynamic-labs/sdk-react-core',
      current: '5.14.0',
      freshVersions: [{ version: '5.15.0', eligibleInHours: 0.1 }],
    },
  ]
  const keyOf = (n) => lockstepKey(n, () => null)
  const r = lockstepWaits(bumps, others, keyOf)
  assert.deepEqual(
    r.keep.map((b) => b.name),
    ['zustand']
  )
  assert.deepEqual(r.waits, [
    {
      key: '@dynamic-labs/*',
      version: '5.15.0',
      blocker: '@dynamic-labs/sdk-react-core',
      inHours: 0.1,
      names: six.map((b) => b.name),
    },
  ])
  // A sibling that moves to the same version in this run (a fast-track): no wait.
  const together = lockstepWaits(
    [
      ...bumps,
      { name: '@dynamic-labs/sdk-react-core', from: '5.14.0', to: '5.15.0' },
    ],
    others,
    keyOf
  )
  assert.equal(together.waits.length, 0)
  // Another current version, or another scope: no wait.
  assert.equal(
    lockstepWaits(six, [{ ...others[0], current: '5.13.0' }], keyOf).waits
      .length,
    0
  )
  // Unscoped families come from the family table.
  const fam = (n) =>
    lockstepKey(n, (x) => (/^(next|@next\/.+)$/.test(x) ? 'next' : null))
  assert.equal(fam('next'), 'next')
  assert.equal(fam('@next/env'), 'next')
  assert.equal(fam('@other/x'), '@other/*')
})

test('summary text: one version is named once, one item for many projects, no entities', () => {
  const one = ['viem@2.57.19']
  assert.deepEqual(ownReasons(['viem@2.57.19 (3.9 h)'], one), ['(3.9 h)'])
  assert.deepEqual(ownReasons(['viem@2.57.19'], one), [''])
  assert.deepEqual(
    ownReasons(['viem@2.57.19: publisher changed a → b', 'other: x'], one),
    ['publisher changed a → b', 'other: x']
  )
  // A family keeps the names: each reason says which member.
  const two = ['motion@14.12.0', 'framer-motion@14.12.0']
  assert.deepEqual(ownReasons(['motion@14.12.0 (2 h)'], two), [
    'motion@14.12.0 (2 h)',
  ])
  const item = (project, text = 't') => ({
    kind: 'approve',
    project,
    name: 'viem',
    text,
    flag: '--approve viem@2.57.19',
  })
  assert.deepEqual(mergeItems([item('.'), item('examples/node')]), [
    { ...item('root, examples/node') },
  ])
  assert.equal(mergeItems([item('.'), item('examples/node', 'u')]).length, 2)
  assert.deepEqual(mergeItems([item('examples/node')]), [item('examples/node')])
  assert.equal(
    terminalText(plain('a <b@x.com> c')),
    'a <b@x.com> c',
    'the PR text keeps the entities; the terminal does not'
  )
  assert.match(plain('<!--'), /^&lt;!--$/)
})

test('addFastTrackBump: the fresh version replaces the aged bump in the same folders', () => {
  const aged = { name: 'viem', where: ['a', 'b'], from: '1.0.0', to: '1.0.1' }
  const other = { name: 'ms', where: ['a'], from: '2.0.0', to: '2.0.1' }
  const fresh = (where) => ({
    name: 'viem',
    where,
    from: '1.0.0',
    to: '1.0.2',
    fastTrack: true,
  })
  assert.deepEqual(addFastTrackBump([aged, other], fresh(['a', 'b'])), [
    other,
    fresh(['a', 'b']),
  ])
  // A folder that the fresh bump does not cover keeps the aged bump.
  assert.deepEqual(addFastTrackBump([aged], fresh(['a'])), [
    { ...aged, where: ['b'] },
    fresh(['a']),
  ])
  assert.deepEqual(addFastTrackBump([other], fresh(['a'])), [
    other,
    fresh(['a']),
  ])
})
