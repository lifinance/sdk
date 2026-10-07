// Usage: node scripts/size-measure.mjs <checkout-root> <output.json> [--ignore-missing]
// Exit codes: 0 = within budget, 1 = over budget or a check not measured, 2 = failed.
// The config and size-limit come from this repo, so the base is measured with the PR's
// checks even when the base has no size-limit setup of its own.
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
const ignoreMissing = flags.includes('--ignore-missing')

// size-limit also accepts bare package names as import keys; only file paths move.
const isFile = (key) =>
  key.startsWith('.') ||
  key.startsWith('/') ||
  (key.includes('/') && /\.[cm]?[jt]sx?$/.test(key))
const toRoot = (path) =>
  Array.isArray(path)
    ? path.map((item) => resolve(root, item))
    : resolve(root, path)

const prepare = (check) => {
  const prepared = { ...check }
  if (check.path) {
    prepared.path = toRoot(check.path)
  }
  if (check.import && typeof check.import === 'object') {
    const entries = Object.entries(check.import)
      .map(([key, spec]) => [isFile(key) ? toRoot(key) : key, spec])
      // A base without one of the files is measured with the files it has.
      .filter(([key]) => !ignoreMissing || !isFile(key) || existsSync(key))
    if (!entries.length) {
      return null
    }
    prepared.import = Object.fromEntries(entries)
  }
  return prepared
}

let checks
try {
  checks = JSON.parse(
    readFileSync(join(repoRoot, '.size-limit.json'), 'utf8')
  ).map(prepare)
} catch (error) {
  console.error(`Cannot read .size-limit.json: ${error.message}`)
  process.exit(2)
}

const tempDir = mkdtempSync(join(tmpdir(), 'size-limit-'))

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

// The config is a module so that size-limit's own esbuild build saves its metafile.
const writeConfig = (check, index) => {
  const configPath = join(tempDir, `${index}.mjs`)
  const metafilePath = join(tempDir, `${index}.metafile.json`)
  writeFileSync(
    configPath,
    `import { writeFileSync } from 'node:fs'
export default [{
  ...${JSON.stringify(check)},
  modifyEsbuildConfig(config) {
    config.plugins = [...(config.plugins ?? []), {
      name: 'save-metafile',
      setup(build) {
        build.onEnd((result) => {
          if (result.metafile) {
            writeFileSync(${JSON.stringify(metafilePath)}, JSON.stringify(result.metafile))
          }
        })
      },
    }]
    return config
  },
}]
`
  )
  return { configPath, metafilePath }
}

const manifests = new Map()
const packageOf = (file) => {
  let dir = dirname(file)
  const visited = []
  while (dir !== dirname(dir) && !manifests.has(dir)) {
    visited.push(dir)
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'))
      if (name) {
        manifests.set(dir, { name, version })
        break
      }
    }
    dir = dirname(dir)
  }
  const found = manifests.get(dir) ?? { name: '(other)' }
  for (const path of visited) {
    manifests.set(path, found)
  }
  return found
}

// Minified bytes per package, and the versions of packages bundled more than once.
const breakdown = (metafilePath) => {
  const metafile = JSON.parse(readFileSync(metafilePath, 'utf8'))
  const packages = {}
  const versions = {}
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      const file = resolve(repoRoot, input)
      const { name, version } = existsSync(file)
        ? packageOf(file)
        : { name: '(other)' }
      packages[name] = (packages[name] ?? 0) + bytesInOutput
      if (version) {
        versions[name] ??= new Set()
        versions[name].add(version)
      }
    }
  }
  const copies = Object.fromEntries(
    Object.entries(versions)
      .filter(([, set]) => set.size > 1)
      .map(([name, set]) => [name, [...set].sort()])
  )
  return { packages, ...(Object.keys(copies).length && { copies }) }
}

// One process per check, so a check that cannot be bundled only loses its own row.
const measure = async (check, index) => {
  if (!check) {
    return { row: null }
  }
  const { configPath, metafilePath } = writeConfig(check, index)
  const result = await run(configPath)
  // size-limit prints bundler warnings to stderr and the JSON report to stdout.
  // A budget failure exits non-zero but still prints a valid JSON array.
  let parsed = null
  try {
    parsed = JSON.parse(result.stdout)
  } catch {}
  if (Array.isArray(parsed) && parsed.length > 0 && result.status !== null) {
    let details = {}
    if (existsSync(metafilePath)) {
      try {
        details = breakdown(metafilePath)
      } catch (error) {
        console.error(`Breakdown failed: ${check.name}: ${error.message}`)
        details = { breakdownError: true }
      }
    }
    return {
      row: { ...parsed[0], ...details },
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
