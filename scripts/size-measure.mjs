// Usage: node scripts/size-measure.mjs <checkout-root> <output.json> [--ignore-missing]
// Exit codes: 0 = within budget, 1 = over budget or a check not measured, 2 = failed.
// The config and size-limit come from this repo, so the base is measured with the PR's
// checks even when the base has no size-limit setup of its own.
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECK_TIMEOUT_MS = 10 * 60 * 1000

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const sizeLimitBin = join(repoRoot, 'node_modules', 'size-limit', 'bin.js')
const [root, out, ...flags] = process.argv.slice(2)
if (!root || !out) {
  console.error(
    'usage: size-measure.mjs <checkout-root> <output.json> [--ignore-missing]'
  )
  process.exit(2)
}

const toRoot = (path) =>
  Array.isArray(path)
    ? path.map((item) => resolve(root, item))
    : resolve(root, path)

let checks
try {
  checks = JSON.parse(
    readFileSync(join(repoRoot, '.size-limit.json'), 'utf8')
  ).map((check) => ({
    ...check,
    ...(check.path && { path: toRoot(check.path) }),
    ...(check.import &&
      typeof check.import === 'object' && {
        import: Object.fromEntries(
          Object.entries(check.import).map(([file, spec]) => [
            toRoot(file),
            spec,
          ])
        ),
      }),
  }))
} catch (error) {
  console.error(`Cannot read .size-limit.json: ${error.message}`)
  process.exit(2)
}

const ignoreMissing = flags.includes('--ignore-missing')
const tempDir = mkdtempSync(join(tmpdir(), 'size-limit-'))
// The same esbuild that size-limit bundles with, so the breakdown matches its bundle.
const esbuild = createRequire(
  join(
    realpathSync(join(repoRoot, 'node_modules', '@size-limit', 'esbuild')),
    'index.js'
  )
)('esbuild')

const run = (configPath) =>
  new Promise((done) => {
    const child = spawn(
      process.execPath,
      [
        sizeLimitBin,
        '--config',
        configPath,
        '--json',
        ...(ignoreMissing ? ['--ignore-missing'] : []),
      ],
      { cwd: repoRoot, timeout: CHECK_TIMEOUT_MS }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => done({ status: null, stdout, stderr, error }))
    child.on('close', (status, signal) =>
      done({ status, signal, stdout, stderr })
    )
  })

const packageNames = new Map()
const packageOf = (file) => {
  let dir = dirname(file)
  const visited = []
  while (dir !== dirname(dir)) {
    if (packageNames.has(dir)) {
      break
    }
    visited.push(dir)
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
      if (name) {
        packageNames.set(dir, name)
        break
      }
    }
    dir = dirname(dir)
  }
  const name = packageNames.get(dir) ?? '(other)'
  for (const path of visited) {
    packageNames.set(path, name)
  }
  return name
}

// Minified bytes per package in the bundle, used by the report to explain a change.
const breakdown = async (check, index) => {
  if (!check.import || check.disablePlugins?.includes('@size-limit/esbuild')) {
    return undefined
  }
  const imports =
    typeof check.import === 'string'
      ? { [check.path]: check.import }
      : check.import
  const loader = Object.entries(imports)
    .map(([file, spec], at) =>
      spec === '*'
        ? `import * as all${at} from ${JSON.stringify(file)}\nconsole.log(all${at})`
        : `import ${spec} from ${JSON.stringify(file)}\nconsole.log(${spec.replace(/[{}]/g, '').trim()})`
    )
    .join('\n')
  const entry = join(tempDir, `breakdown-${index}.js`)
  writeFileSync(entry, loader)
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    treeShaking: true,
    external: check.ignore ?? [],
    outdir: join(tempDir, `breakdown-${index}`),
    absWorkingDir: resolve(root),
    logLevel: 'silent',
  })
  const packages = {}
  for (const output of Object.values(result.metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      const file = resolve(root, input)
      const name = existsSync(file) ? packageOf(file) : '(other)'
      packages[name] = (packages[name] ?? 0) + bytesInOutput
    }
  }
  return packages
}

// One process per check, so a check that cannot be bundled only loses its own row.
const measure = async (check, index) => {
  const configPath = join(tempDir, `${index}.json`)
  writeFileSync(configPath, JSON.stringify([check]))
  const [result, packages] = await Promise.all([
    run(configPath),
    breakdown(check, index).catch(() => undefined),
  ])
  // size-limit prints bundler warnings to stderr and the JSON report to stdout.
  // A budget failure exits non-zero but still prints a valid JSON array.
  let parsed = null
  try {
    parsed = JSON.parse(result.stdout)
  } catch {}
  if (Array.isArray(parsed) && parsed.length > 0 && result.status !== null) {
    return {
      row: { ...parsed[0], ...(packages && { packages }) },
      overBudget: result.status !== 0,
    }
  }
  if (Array.isArray(parsed) && parsed.length === 0 && ignoreMissing) {
    return { row: null }
  }
  console.error(`Check failed: ${check.name}`)
  console.error(
    result.error ?? result.stderr,
    result.signal ?? '',
    result.stdout
  )
  return { row: { name: check.name }, failed: true }
}

const results = new Array(checks.length)
let next = 0
const worker = async () => {
  while (next < checks.length) {
    const index = next++
    results[index] = await measure(checks[index], index)
  }
}

try {
  await Promise.all(
    Array.from(
      { length: Math.min(availableParallelism(), checks.length) },
      worker
    )
  )
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

const failed = results.filter((result) => result.failed).length
if (failed > 0 && failed === checks.length) {
  process.exit(2)
}
const report = results.map((result) => result.row).filter(Boolean)
writeFileSync(out, JSON.stringify(report, null, 2))
process.exit(failed > 0 || results.some((result) => result.overBudget) ? 1 : 0)
