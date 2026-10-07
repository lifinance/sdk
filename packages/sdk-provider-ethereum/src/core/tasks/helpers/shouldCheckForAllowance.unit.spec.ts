import {
  type ExecutionAction,
  type LiFiStepExtended,
  StatusManager,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { shouldCheckForAllowance } from './shouldCheckForAllowance.js'

const TX_HASH = `0x${'ab'.repeat(32)}`

const buildStep = (
  swapAction?: Omit<ExecutionAction, 'type'>
): LiFiStepExtended =>
  ({
    type: 'lifi',
    id: 'step-1',
    tool: 'lifi',
    action: {
      fromChainId: 1,
      toChainId: 1,
      fromAddress: '0xaaaa000000000000000000000000000000000001',
      fromAmount: '1000000',
      fromToken: {
        address: '0xcccc000000000000000000000000000000000003',
        chainId: 1,
      },
    },
    estimate: {
      approvalAddress: '0xbbbb000000000000000000000000000000000002',
      gasCosts: [],
      feeCosts: [],
    },
    execution: {
      status: 'PENDING',
      actions: swapAction ? [{ type: 'SWAP', ...swapAction }] : [],
    },
  }) as unknown as LiFiStepExtended

// `findAction` only reads `step.execution`; no route state is needed.
const statusManager = new StatusManager('route-1')

const check = (swapAction?: Omit<ExecutionAction, 'type'>): boolean =>
  shouldCheckForAllowance(buildStep(swapAction), false, false, statusManager)

describe('shouldCheckForAllowance', () => {
  it('checks the allowance when there is no swap action yet', () => {
    expect(check()).toBe(true)
  })

  it('skips the allowance for an action with only stored bytes (txHex)', () => {
    expect(check({ status: 'PENDING', txHex: '0x02f8' })).toBe(false)
  })

  it('skips the allowance for an action with only a taskId', () => {
    expect(check({ status: 'PENDING', taskId: TX_HASH })).toBe(false)
  })

  it('skips the allowance for a FAILED hash without txFinal (unknown outcome)', () => {
    expect(check({ status: 'FAILED', txHash: TX_HASH })).toBe(false)
  })

  it('checks the allowance again after a final failure', () => {
    expect(check({ status: 'FAILED', txHash: TX_HASH, txFinal: true })).toBe(
      true
    )
  })

  it('checks the allowance again after a final batch or relay failure (taskId)', () => {
    expect(check({ status: 'FAILED', taskId: TX_HASH, txFinal: true })).toBe(
      true
    )
  })
})
