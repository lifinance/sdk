// Usage: node scripts/size-measure.mjs <checkout-root> <output.json> [--ignore-missing]
// Exit codes: 0 = within budget, 1 = over budget or a check not measured, 2 = failed.
// The config and size-limit come from this repo, so the base is measured with the PR's
// checks even when the base has no size-limit setup of its own.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

let checks
try {
  checks = JSON.parse(
    readFileSync(join(repoRoot, '.size-limit.json'), 'utf8')
  ).map((check) => ({
    ...check,
    path: Array.isArray(check.path)
      ? check.path.map((path) => resolve(root, path))
      : resolve(root, check.path),
  }))
} catch (error) {
  console.error(`Cannot read .size-limit.json: ${error.message}`)
  process.exit(2)
}

const ignoreMissing = flags.includes('--ignore-missing')
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

// One process per check, so a check that cannot be bundled only loses its own row.
const measure = async (check, index) => {
  const configPath = join(tempDir, `${index}.json`)
  writeFileSync(configPath, JSON.stringify([check]))
  const result = await run(configPath)
  // size-limit prints bundler warnings to stderr and the JSON report to stdout.
  // A budget failure exits non-zero but still prints a valid JSON array.
  let parsed = null
  try {
    parsed = JSON.parse(result.stdout)
  } catch {}
  if (Array.isArray(parsed) && parsed.length > 0 && result.status !== null) {
    return { row: parsed[0], overBudget: result.status !== 0 }
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
