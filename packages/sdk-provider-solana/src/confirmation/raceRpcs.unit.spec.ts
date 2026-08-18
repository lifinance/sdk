import { sleep } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { raceRpcs } from './raceRpcs.js'
import type { ConfirmationOutcome } from './types.js'

const confirmed = <T>(value: T): ConfirmationOutcome<T> => ({
  kind: 'confirmed',
  value,
})
const notConfirmed = <T>(): ConfirmationOutcome<T> => ({
  kind: 'not-confirmed',
})

describe('raceRpcs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns rpc-unavailable with no errors when the RPC list is empty', async () => {
    await expect(raceRpcs([], async () => notConfirmed())).resolves.toEqual({
      kind: 'rpc-unavailable',
      errors: [],
    })
  })

  it('returns the first confirmation and aborts the remaining branches', async () => {
    const aborted: string[] = []

    const result = await raceRpcs(['fast', 'slow'], async (rpc, signal) => {
      if (rpc === 'fast') {
        return confirmed('status')
      }
      signal.addEventListener('abort', () => aborted.push(rpc), { once: true })
      await sleep(50)
      return notConfirmed<string>()
    })

    expect(result).toEqual({ kind: 'confirmed', value: 'status' })
    expect(aborted).toEqual(['slow'])
  })

  it('returns not-confirmed when at least one branch polled and saw nothing', async () => {
    const result = await raceRpcs(['good', 'broken'], async (rpc) => {
      if (rpc === 'broken') {
        throw new Error('connection refused')
      }
      return notConfirmed<string>()
    })

    expect(result).toEqual({ kind: 'not-confirmed' })
  })

  it('returns rpc-unavailable with every error when all branches throw', async () => {
    const result = await raceRpcs(['a', 'b'], async (rpc) => {
      throw new Error(`${rpc} failed`)
    })

    expect(result.kind).toBe('rpc-unavailable')
    if (result.kind !== 'rpc-unavailable') {
      throw new Error('unreachable')
    }
    expect(result.errors.map((error) => error.message).sort()).toEqual([
      'a failed',
      'b failed',
    ])
  })

  it('still reports a confirmation that arrives in the same tick as the settle', async () => {
    const result = await raceRpcs(['only'], async () => confirmed('status'))

    expect(result).toEqual({ kind: 'confirmed', value: 'status' })
  })

  it('wraps a non-Error rejection so the caller always gets an Error', async () => {
    const result = await raceRpcs(['a'], async () => {
      throw 'plain string'
    })

    expect(result.kind).toBe('rpc-unavailable')
    if (result.kind !== 'rpc-unavailable') {
      throw new Error('unreachable')
    }
    expect(result.errors[0]).toBeInstanceOf(Error)
    expect(result.errors[0].message).toBe('plain string')
  })

  it('waits for a slow confirmation instead of reporting the fast not-confirmed', async () => {
    const result = await raceRpcs(['fast', 'slow'], async (rpc) => {
      if (rpc === 'fast') {
        return notConfirmed<string>()
      }
      await sleep(20)
      return confirmed('status')
    })
    expect(result).toEqual({ kind: 'confirmed', value: 'status' })
  })
})
