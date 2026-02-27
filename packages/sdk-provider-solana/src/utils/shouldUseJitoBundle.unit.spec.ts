import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { shouldUseJitoBundle } from './shouldUseJitoBundle.js'

const oneTx = [{}] as Transaction[]
const twoTxs = [{}, {}] as Transaction[]

describe('shouldUseJitoBundle', () => {
  it('returns false when single transaction and jitoBundle not enabled', () => {
    expect(shouldUseJitoBundle({}, oneTx)).toBe(false)
    expect(shouldUseJitoBundle({ jitoBundle: false }, oneTx)).toBe(false)
  })

  it('returns false when single transaction and jitoBundle enabled', () => {
    expect(shouldUseJitoBundle({ jitoBundle: true }, oneTx)).toBe(false)
  })

  it('returns true when multiple transactions and jitoBundle enabled', () => {
    expect(shouldUseJitoBundle({ jitoBundle: true }, twoTxs)).toBe(true)
  })

  it('throws when multiple transactions and jitoBundle not enabled', () => {
    expect(() => shouldUseJitoBundle({}, twoTxs)).toThrow(TransactionError)
    expect(() => shouldUseJitoBundle({}, twoTxs)).toThrow(
      'Received 2 transactions but Jito bundle is not enabled'
    )

    const err = (() => {
      try {
        shouldUseJitoBundle({ jitoBundle: false }, twoTxs)
      } catch (e) {
        return e
      }
    })() as TransactionError

    expect(err).toBeInstanceOf(TransactionError)
    expect(err.code).toBe(LiFiErrorCode.TransactionUnprepared)
  })
})
