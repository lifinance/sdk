// Runs the size-limit checks from `.size-limit.json` against a built checkout.
//
//   node scripts/size-measure.mjs <checkout-root> <output.json> [--skip-missing]
//
// --skip-missing drops checks whose file does not exist in <checkout-root>. The base
// commit uses it, so a PR that adds a package still gets deltas for everything else.
//
// The PR checkout always supplies the config and the size-limit binary. Paths are
// rewritten to point at <checkout-root>, so the base commit is measured with exactly
// the same checks as the PR, even when the base has no size-limit setup of its own.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [root, out, ...flags] = process.argv.slice(2)
const skipMissing = flags.includes('--skip-missing')
if (!root || !out) {
  console.error(
    'usage: size-measure.mjs <checkout-root> <output.json> [--skip-missing]'
  )
  process.exit(2)
}

const checks = JSON.parse(readFileSync('.size-limit.json', 'utf8'))
  .map((check) => ({ ...check, path: resolve(root, check.path) }))
  .filter((check) => !skipMissing || existsSync(check.path))
const configPath = join(tmpdir(), `size-limit-${process.pid}.json`)
writeFileSync(configPath, JSON.stringify(checks))

const result = spawnSync(
  'pnpm',
  ['exec', 'size-limit', '--config', configPath, '--json'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
)
// size-limit prints bundler warnings to stderr and the JSON report to stdout.
// A budget failure exits non-zero but still prints a valid JSON array, so only a
// missing report, a non-array report (`{ "error": ... }`) or a killed process is
// a real error.
let report
try {
  report = JSON.parse(result.stdout ?? '')
} catch {
  report = null
}
if (!Array.isArray(report) || result.status === null) {
  console.error(result.stdout, result.stderr, result.signal)
  process.exit(2)
}
writeFileSync(out, JSON.stringify(report, null, 2))
process.exit(result.status)
