// Fixture tests for lib.js. Run: node --test <skill>/scripts/test
// The fixtures are real files from the three repos (pnpm-workspace.yaml, a trimmed
// `pnpm outdated` output from widget) and a small two-document lockfile.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ageHours,
  breakingLines,
  classify,
  cmpRaw,
  groupOutdated,
  isExcluded,
  isStopJump,
  npmrcRouting,
  parseExcludes,
  parseLock,
  parseSelector,
  satisfies,
  yamlList,
  yamlMap,
} from '../lib.js'

const fx = (name) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name),
    'utf8'
  )

test('satisfies follows node-semver for the range forms in these repos', () => {
  const cases = [
    ['26.7.2', '^26.5.2', true],
    ['27.0.0', '^26.5.2', false],
    ['0.5.3', '^0.5.0', true],
    ['0.6.0', '^0.5.0', false],
    ['0.4.9', '^0.5.0', false],
    ['0.0.4', '^0.0.3', false],
    ['2.0.0', '>=1.0.0 <2.0.0', false],
    ['1.9.9', '>=1.0.0 <2.0.0', true],
    ['6.0.3', '^5 || ^6 || ^7', true],
    ['26.5.2', '>= 27.0.0', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.9.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['3.0.0', '*', true],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.5.0', '1.2.3 - 1.6', true],
    ['1.7.0', '1.2.3 - 1.6', false],
    ['1.3.0', '>1.2', true],
    ['1.2.9', '>1.2', false],
    ['1.2.9', '<=1.2', true],
    ['8.22.1', '>=8.21.1', true],
  ]
  for (const [v, r, want] of cases) {
    assert.equal(satisfies(v, r), want, `${v} in ${r}`)
  }
})

test('satisfies returns null for values that are not ranges', () => {
  for (const r of [
    'npm:foo@1',
    'workspace:*',
    '$foo',
    '-',
    'catalog:',
    'link:../x',
  ]) {
    assert.equal(satisfies('1.0.0', r), null, r)
  }
})

test('cmp orders prereleases by SemVer rules', () => {
  assert.equal(cmpRaw('1.0.0-beta.10', '1.0.0-beta.9'), 1)
  assert.equal(cmpRaw('1.0.0-alpha', '1.0.0-alpha.1'), -1)
  assert.equal(cmpRaw('1.0.0-1', '1.0.0-alpha'), -1)
  assert.equal(cmpRaw('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(cmpRaw('2.57.17', '2.57.16'), 1)
})

test('classify treats 0.x minors and 0.0.x patches as breaking', () => {
  assert.equal(classify('1.2.3', '1.2.4').safe, true)
  assert.equal(classify('1.2.3', '1.3.0').safe, true)
  assert.equal(classify('1.2.3', '2.0.0').bumpType, 'major')
  assert.equal(classify('0.5.0', '0.6.0').reason, 'zerox-minor')
  assert.equal(classify('0.5.0', '0.5.1').safe, true)
  assert.equal(classify('0.0.3', '0.0.4').safe, false)
})

test('parseSelector classifies every override selector of the three repos', () => {
  const cases = {
    viem: { name: 'viem', kind: 'whole' },
    '@reown/appkit': { name: '@reown/appkit', kind: 'whole' },
    'ws@>=7.0.0 <8.0.0': { name: 'ws', kind: 'range' },
    'ws@<=8.22.0': { name: 'ws', kind: 'range' },
    'es-toolkit@1': { name: 'es-toolkit', kind: 'range' },
    'sharp@<0.35.5': { name: 'sharp', kind: 'range' },
    '@reown/appkit>@walletconnect/universal-provider': {
      name: '@walletconnect/universal-provider',
      kind: 'path',
    },
    'miniflare>zod': { name: 'zod', kind: 'path' },
    '@lifi/data-types>@lifi/types': { name: '@lifi/types', kind: 'path' },
    'foo@1>bar': { name: 'bar', kind: 'path' },
    'foo>vue': { name: 'vue', kind: 'path' },
    'ws@>8': { name: 'ws', kind: 'range' },
    'ws@> 8': { name: 'ws', kind: 'range' },
  }
  for (const [sel, want] of Object.entries(cases)) {
    assert.deepEqual(parseSelector(sel), want, sel)
  }
})

test('yamlMap and yamlList read the real pnpm-workspace.yaml files', () => {
  for (const repo of ['sdk', 'widget', 'jumper-widget']) {
    const yaml = fx(`workspace-${repo}.yaml`)
    const pkgs = yamlList(yaml, 'packages')
    assert.ok(pkgs.length >= 1, `${repo} packages`)
    const overrides = yamlMap(yaml, 'overrides')
    // Every override line in the file must be parsed, or a hold could be lost.
    const block = yaml.split(/^overrides:\s*$/m)[1]?.split(/^\S/m)[0] ?? ''
    const lines = block
      .split('\n')
      .filter((l) => /^\s+\S/.test(l) && !/^\s*#/.test(l))
    assert.equal(overrides.length, lines.length, `${repo} overrides`)
    const excludes = yamlList(yaml, 'minimumReleaseAgeExclude')
    assert.ok(excludes.includes('@lifi/*'), `${repo} excludes @lifi/*`)
  }
  const widget = yamlMap(fx('workspace-widget.yaml'), 'overrides')
  const polyfills = widget.find((o) => o.key === 'vite-plugin-node-polyfills')
  assert.equal(polyfills.value, '0.26.0')
  assert.match(polyfills.reason, /Held at 0\.26\.0/)
})

test('exclude matchers handle globs and exact versions', () => {
  const m = parseExcludes([
    '@lifi/*',
    'wagmi@3.7.7',
    'webpack@4.47.0 || 5.102.1',
  ])
  assert.equal(isExcluded(m, '@lifi/sdk', '9.9.9'), true)
  assert.equal(isExcluded(m, 'wagmi', '3.7.7'), true)
  assert.equal(isExcluded(m, 'wagmi', '3.7.8'), false)
  assert.equal(isExcluded(m, 'webpack', '5.102.1'), true)
  assert.equal(isExcluded(m, 'viem', '2.57.17'), false)
})

test('parseLock reads only the project document and keeps peer variants', () => {
  const text = fx('lock-two-docs.yaml')
  const pkgs = parseLock(text)
  assert.equal(pkgs.has('pnpm'), false, 'pnpm itself is not a project package')
  assert.deepEqual([...pkgs.get('wagmi')].sort(), ['2.19.5', '3.7.7'])
  assert.deepEqual([...pkgs.get('@scope/pkg')], ['1.2.3'])
  const snaps = parseLock(text, 'snapshots')
  assert.equal(
    snaps.get('wagmi').size,
    3,
    'two peer variants of 3.7.7 plus 2.19.5'
  )
  // A lockfile with one document still works.
  const single = text.split(/^---\s*$/m).filter((d) => d.trim())[1]
  assert.equal(parseLock(single).get('viem').has('2.57.7'), true)
})

test('groupOutdated splits pnpm keys like next@16.4.2 and "(dev)" by name and version', () => {
  const groups = groupOutdated(JSON.parse(fx('outdated-widget.json')))
  assert.ok(groups.has('next@16.4.2'))
  assert.ok(groups.has('next@15.5.28'))
  const polyfills = groups.get('vite-plugin-node-polyfills@0.26.0')
  assert.ok(polyfills, 'the plain and the (dev) key merge into one group')
  assert.ok(polyfills.dependentPackages.length >= 2)
  assert.ok(
    [...groups.keys()].some((k) => /^viem@\d/.test(k)),
    'plain keys get @current'
  )
})

test('ageHours floors, so a version just under the gate never counts as aged', () => {
  const now = Date.parse('2026-11-09T12:00:00Z')
  assert.equal(ageHours('2026-11-08T12:24:00Z', now), 23.6)
  assert.ok(ageHours('2026-11-08T12:01:00Z', now) < 24)
  assert.equal(ageHours('2026-11-08T12:00:00Z', now), 24)
  assert.equal(ageHours('not a date', now), null)
})

test('breakingLines and isStopJump: 0.x moves stop only through an open override', () => {
  assert.deepEqual(
    [...breakingLines(['0.3.1', '0.4.0', '0.0.7', '2.1.0'])].sort(),
    ['0.0.7', '0.3', '0.4', '2']
  )
  const none = new Set()
  const zeroX = { name: 'foo', realMajor: false }
  const major = { name: 'bar', realMajor: true }
  assert.equal(
    isStopJump(zeroX, none, none),
    false,
    'transitive 0.x line: review only'
  )
  assert.equal(
    isStopJump(zeroX, new Set(['foo']), none),
    true,
    '0.x line through an open override'
  )
  assert.equal(isStopJump(major, none, none), true, 'real major')
  assert.equal(
    isStopJump(major, none, new Set(['bar'])),
    false,
    'approved major'
  )
})

test('yaml reader: a key with a comment and a sequence at column 0', () => {
  assert.deepEqual(yamlList('packages:\n- a\n- b\nnext: 1', 'packages'), [
    'a',
    'b',
  ])
  const m = yamlMap('overrides: # note\n  foo: 1.2.3\nnext: 1', 'overrides')
  assert.deepEqual(
    m.map((o) => [o.key, o.value]),
    [['foo', '1.2.3']]
  )
})

test('prerelease rules follow node-semver', () => {
  assert.equal(satisfies('1.0.0-rc.1', '^1.0.0'), false)
  assert.equal(satisfies('1.0.0-rc.2', '>=1.0.0-rc.1 <2'), true)
  assert.equal(classify('2.0.0-beta.3', '2.0.0').safe, false)
  assert.deepEqual(parseSelector('vite>esbuild@>=0.18'), {
    name: 'esbuild',
    kind: 'path',
  })
})

test('npmrcRouting: only packages that npm gets from registry.npmjs.org are fetched directly', () => {
  const direct = npmrcRouting([
    '# user\n@corp:registry=https://npm.corp.example/\n',
    '@lifi:registry=https://registry.npmjs.org\n; comment\n',
  ])
  assert.equal(direct('viem'), true)
  assert.equal(direct('@lifi/sdk'), true)
  assert.equal(direct('@corp/tool'), false)
  const mirror = npmrcRouting(['registry = "https://mirror.example/npm/"\n'])
  assert.equal(mirror('viem'), false)
  const env = npmrcRouting([], { npm_config_registry: 'https://other.example' })
  assert.equal(env('viem'), false)
  // The project file comes last and wins.
  assert.equal(
    npmrcRouting([
      'registry=https://mirror.example/',
      'registry=https://registry.npmjs.org/',
    ])('viem'),
    true
  )
})
