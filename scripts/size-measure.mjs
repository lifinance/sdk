// Runs the size-limit checks from `.size-limit.json` against a built checkout.
//
//   node scripts/size-measure.mjs <checkout-root> <output.json> [--ignore-missing]
//
// Exit codes: 0 = all checks within budget, 1 = a budget is exceeded or a check
// produced no output, 2 = the measurement itself failed.
//
// Each check runs in its own size-limit process. One check that cannot be bundled
// (for example, it imports an export the base commit does not have) then only loses
// its own row, not the whole report. It is reported with a name and no size.
//
// --ignore-missing is passed to size-limit. It drops checks whose files do not exist
// in <checkout-root>. The base commit uses it, so a PR that adds a package still gets
// deltas for everything else.
//
// The PR checkout always supplies the config and the size-limit binary. Paths are
// rewritten to point at <checkout-root>, so the base commit is measured with exactly
// the same checks as the PR, even when the base has no size-limit setup of its own.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The repo root holds .size-limit.json and the size-limit install, whatever the cwd.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
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
    path: resolve(root, check.path),
  }))
} catch (error) {
  console.error(`Cannot read .size-limit.json: ${error.message}`)
  process.exit(2)
}

const tempDir = mkdtempSync(join(tmpdir(), 'size-limit-'))
const extraArgs = flags.includes('--ignore-missing') ? ['--ignore-missing'] : []
const report = []
let failed = 0
let budgetFailed = false

try {
  for (const [index, check] of checks.entries()) {
    const configPath = join(tempDir, `${index}.json`)
    writeFileSync(configPath, JSON.stringify([check]))
    const result = spawnSync(
      'pnpm',
      ['exec', 'size-limit', '--config', configPath, '--json', ...extraArgs],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      }
    )
    // size-limit prints bundler warnings to stderr and the JSON report to stdout.
    // A budget failure exits non-zero but still prints a valid JSON array.
    let parsed = null
    try {
      parsed = JSON.parse(result.stdout ?? '')
    } catch {}
    if (Array.isArray(parsed) && parsed.length > 0 && result.status !== null) {
      report.push(parsed[0])
      budgetFailed ||= result.status !== 0
    } else if (
      Array.isArray(parsed) &&
      parsed.length === 0 &&
      extraArgs.length > 0
    ) {
      // Dropped by --ignore-missing: the base has no files for this check.
    } else {
      failed += 1
      console.error(`Check failed: ${check.name}`)
      console.error(
        result.error ?? result.stderr ?? '',
        result.signal ?? '',
        result.stdout ?? ''
      )
      report.push({ name: check.name })
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

// No check could be measured at all: there is no report worth writing.
if (failed > 0 && failed === checks.length) {
  process.exit(2)
}
writeFileSync(out, JSON.stringify(report, null, 2))
process.exit(failed > 0 || budgetFailed ? 1 : 0)
