import { describe, expect, it } from 'vitest'
import { formatReport, hasFailures, type LegResult } from './report.js'

const results: LegResult[] = [
  { label: 'USDC->USDT', outcome: 'pass', durationMs: 4200, signature: 'sig1' },
  { label: 'WBTC->SOL', outcome: 'skip', reason: 'below aggregator minimum' },
  { label: 'SOL->USDC', outcome: 'fail', reason: 'TransactionExpired (1018)' },
]

describe('formatReport', () => {
  it('shows every leg with its outcome', () => {
    const report = formatReport(results)
    expect(report).toContain('USDC->USDT')
    expect(report).toContain('WBTC->SOL')
    expect(report).toContain('SOL->USDC')
  })

  it('shows the reason for skipped and failed legs', () => {
    const report = formatReport(results)
    expect(report).toContain('below aggregator minimum')
    expect(report).toContain('TransactionExpired (1018)')
  })

  it('counts the three outcomes separately', () => {
    // A skipped leg is not a passing leg. Collapsing them lets a run where 10
    // of 12 legs found no route look like a green matrix.
    const report = formatReport(results)
    expect(report).toMatch(/1 passed/)
    expect(report).toMatch(/1 skipped/)
    expect(report).toMatch(/1 failed/)
  })

  it('renders an empty result set without crashing', () => {
    expect(() => formatReport([])).not.toThrow()
    expect(formatReport([])).toMatch(/0 passed/)
  })
})

describe('hasFailures', () => {
  it('is true when any leg failed', () => {
    expect(hasFailures(results)).toBe(true)
  })

  it('is false when legs only passed or skipped', () => {
    // A skip is an environment fact, not a defect. A matrix of passes and
    // skips must not fail the suite.
    expect(
      hasFailures([
        { label: 'a', outcome: 'pass' },
        { label: 'b', outcome: 'skip', reason: 'no route' },
      ])
    ).toBe(false)
  })
})
