import type { LiFiStep, StatusResponse } from '@lifi/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStatus } from '../../../actions/getStatus.js'
import type { SDKClient } from '../../../types/core.js'
import type { StatusManager } from '../../StatusManager.js'
import { waitForTransactionStatus } from './waitForTransactionStatus.js'

vi.mock('../../../actions/getStatus.js', () => ({
  getStatus: vi.fn(),
}))

describe('waitForTransactionStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(getStatus).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops polling when the status API returns FAILED', async () => {
    vi.mocked(getStatus)
      .mockResolvedValueOnce({ status: 'FAILED' } as StatusResponse)
      .mockResolvedValueOnce({
        status: 'DONE',
        receiving: {},
      } as StatusResponse)

    const step = {
      action: {
        fromChainId: 1,
        toChainId: 137,
        fromAddress: '0x0000000000000000000000000000000000000001',
      },
      tool: 'across',
    } as LiFiStep

    const promise = waitForTransactionStatus(
      {} as SDKClient,
      { updateAction: vi.fn() } as unknown as StatusManager,
      '0xabc',
      step,
      'RECEIVING_CHAIN',
      1000
    )
    const expectation = expect(promise).rejects.toThrow('Transaction failed.')

    await vi.advanceTimersByTimeAsync(1000)

    await expectation
    expect(getStatus).toHaveBeenCalledTimes(1)
  })
})
