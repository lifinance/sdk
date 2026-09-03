import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  getPermitData,
  hash,
  type PermitTransferFrom,
} from './signatureTransfer.js'

// Canonical Permit2, same address on every chain.
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
const CHAIN_ID = 42161
// An arbitrary spender that is NOT the LI.FI proxy — the whole point of
// exposing these builders publicly.
const SPENDER = '0x5E325eDA8064b456f4781070C0738d849c824258' as Address // Uniswap UniversalRouter (arb)
const TOKEN = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Address // USDC.arb

const permit: PermitTransferFrom = {
  permitted: { token: TOKEN, amount: 1_000_000n },
  spender: SPENDER,
  nonce: 0n,
  deadline: 1_788_432_108n,
}

describe('signatureTransfer builders (generic spender)', () => {
  it('binds the domain to Permit2 and the message to the given spender', () => {
    const data = getPermitData(permit, PERMIT2, CHAIN_ID)
    expect(data.domain.verifyingContract).toBe(PERMIT2)
    expect(data.domain.chainId).toBe(CHAIN_ID)
    expect(data.message.spender).toBe(SPENDER)
    expect(data.types.PermitTransferFrom).toBeDefined()
  })

  it('produces a deterministic EIP-712 hash', () => {
    // If the typed-data wiring silently changes, this hash moves.
    expect(hash(permit, PERMIT2, CHAIN_ID)).toBe(
      hash(permit, PERMIT2, CHAIN_ID)
    )
    // A different spender must produce a different digest.
    const other = hash({ ...permit, spender: TOKEN }, PERMIT2, CHAIN_ID)
    expect(other).not.toBe(hash(permit, PERMIT2, CHAIN_ID))
  })
})
