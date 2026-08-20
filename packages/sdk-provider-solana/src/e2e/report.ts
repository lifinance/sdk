/**
 * Three outcomes, kept distinct on purpose.
 *
 * `skip` is an environment fact - no route, below a minimum, missing
 * credentials. `fail` is the only one that means the SDK misbehaved, and the
 * only one that should fail a run.
 */
export type LegOutcome = 'pass' | 'skip' | 'fail'

export type LegResult = {
  label: string
  outcome: LegOutcome
  reason?: string
  durationMs?: number
  signature?: string
}

const LABELS: Record<LegOutcome, string> = {
  pass: 'PASS',
  skip: 'SKIP',
  fail: 'FAIL',
}

export function formatReport(results: LegResult[]): string {
  const lines = results.map((result) => {
    const duration =
      result.durationMs === undefined ? '' : ` ${result.durationMs}ms`
    const signature = result.signature ? ` ${result.signature}` : ''
    const reason = result.reason ? ` - ${result.reason}` : ''
    return `  ${LABELS[result.outcome]}  ${result.label}${duration}${signature}${reason}`
  })

  const count = (outcome: LegOutcome): number =>
    results.filter((result) => result.outcome === outcome).length

  return [
    '',
    'E2E result:',
    ...lines,
    '',
    `  ${count('pass')} passed, ${count('skip')} skipped, ${count('fail')} failed`,
    '',
  ].join('\n')
}

export function hasFailures(results: LegResult[]): boolean {
  return results.some((result) => result.outcome === 'fail')
}
