// Runs the size-limit checks from `.size-limit.json` against a built checkout.
//
//   node scripts/size-measure.mjs <checkout-root> <output.json>
//
// The PR checkout always supplies the config and the size-limit binary. Paths are
// rewritten to point at <checkout-root>, so the base commit is measured with exactly
// the same checks as the PR, even when the base has no size-limit setup of its own.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [root, out] = process.argv.slice(2)
if (!root || !out) {
  console.error('usage: size-measure.mjs <checkout-root> <output.json>')
  process.exit(2)
}

const checks = JSON.parse(readFileSync('.size-limit.json', 'utf8')).map(
  (check) => ({ ...check, path: resolve(root, check.path) })
)
const configPath = join(tmpdir(), `size-limit-${process.pid}.json`)
writeFileSync(configPath, JSON.stringify(checks))

const result = spawnSync(
  'pnpm',
  ['exec', 'size-limit', '--config', configPath, '--json'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
)
// size-limit prints bundler warnings to stderr and the JSON report to stdout.
// A budget failure exits non-zero but still prints valid JSON, so only a missing
// or unparsable report is a real error.
try {
  const report = JSON.parse(result.stdout)
  writeFileSync(out, JSON.stringify(report, null, 2))
  process.exit(result.status ?? 0)
} catch {
  console.error(result.stdout, result.stderr)
  process.exit(2)
}
