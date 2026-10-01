import { ChainId, ChainType } from '@lifi/types'
import { describe, expect, it } from 'vitest'
import { findProvider } from './findProvider.js'

const provider = (type: ChainType, chainIds?: ChainId[]) => ({ type, chainIds })

describe('findProvider', () => {
  const evm = provider(ChainType.EVM)
  const bitcoin = provider(ChainType.UTXO)
  const zcash = provider(ChainType.UTXO, [ChainId.ZEC])
  const providers = [evm, bitcoin, zcash]

  it('returns the provider that lists the chain', () => {
    expect(findProvider(providers, ChainType.UTXO, ChainId.ZEC)).toBe(zcash)
  })

  it('falls back to the provider of the type that lists no chains', () => {
    expect(findProvider(providers, ChainType.UTXO, ChainId.BTC)).toBe(bitcoin)
    expect(findProvider(providers, ChainType.UTXO)).toBe(bitcoin)
    expect(findProvider(providers, ChainType.EVM, ChainId.ARB)).toBe(evm)
  })

  it('does not depend on the order of the list', () => {
    expect(findProvider([zcash, bitcoin], ChainType.UTXO)).toBe(bitcoin)
    expect(findProvider([zcash, bitcoin], ChainType.UTXO, ChainId.ZEC)).toBe(
      zcash
    )
  })

  it('returns undefined when no provider serves the chain', () => {
    expect(findProvider([zcash], ChainType.UTXO)).toBeUndefined()
    expect(findProvider([zcash], ChainType.UTXO, ChainId.BTC)).toBeUndefined()
    expect(findProvider(providers, ChainType.SVM, ChainId.SOL)).toBeUndefined()
  })
})
